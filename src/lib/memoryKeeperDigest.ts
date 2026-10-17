import { invoke } from "@tauri-apps/api/core";
import type { ActivityEntry } from "./activity";
import {
  gitBranches,
  gitHistory,
  listDir,
  type FsEntry,
  type GitBranches,
  type GitHistory,
} from "./fs";
import { cleanUntrusted, clip, isSecretFileName } from "./memoryKeeperSafety";
import { projectKey, projectName } from "./paths";
import { memoryProjectFor } from "./projectMemory";

/**
 * The compact text the keeper's model reads about a project. Aven builds it
 * itself from a fixed list of files and git, so the model needs no tools and
 * never sees anything else: no environment files, keys or credentials, no
 * file outside the list, and every excerpt redacted and capped.
 */

/** A top-level file as native code read it: never through a link. */
export type KeeperFile = { name: string; text: string; truncated: boolean };

export type DigestSources = {
  listDir: (path: string) => Promise<FsEntry[]>;
  /**
   * The named files directly in `root`. Native code skips links, secret
   * names, folders, binary files and files over 1 MB.
   */
  readFiles: (
    root: string,
    names: string[],
    maxBytes: number,
  ) => Promise<KeeperFile[]>;
  gitHistory: (cwd: string, limit: number) => Promise<GitHistory>;
  gitBranches: (cwd: string) => Promise<GitBranches>;
};

// Looked up when called, so importing this module never touches native code.
export const NATIVE_DIGEST_SOURCES: DigestSources = {
  listDir: (path) => listDir(path),
  readFiles: (root, names, maxBytes) =>
    invoke<KeeperFile[]>("memory_keeper_read_files", {
      root,
      names,
      maxBytes,
    }),
  gitHistory: (cwd, limit) => gitHistory(cwd, limit),
  gitBranches: (cwd) => gitBranches(cwd),
};

export const DIGEST_MAX_CHARS = 12_000;
/** The most read from one file; enough for any manifest Aven summarises. */
const FILE_READ_BYTES = 64 * 1024;
const LISTING_MAX = 60;

type Reader = "text" | "package" | "make" | "just";
type Wanted = { names: RegExp; label?: string; max: number; read: Reader };

/** The files read, in the order they appear. Matched at the project's top level. */
const WANTED: readonly Wanted[] = [
  {
    names: /^readme(?:\.(?:md|markdown|rst|txt))?$/i,
    max: 2_500,
    read: "text",
  },
  { names: /^agents\.md$/i, max: 2_500, read: "text" },
  { names: /^claude\.md$/i, max: 2_000, read: "text" },
  { names: /^contributing\.md$/i, max: 1_200, read: "text" },
  { names: /^package\.json$/i, max: 2_000, read: "package" },
  { names: /^deno\.jsonc?$/i, max: 1_000, read: "text" },
  { names: /^cargo\.toml$/i, max: 1_500, read: "text" },
  { names: /^pyproject\.toml$/i, max: 1_500, read: "text" },
  { names: /^requirements\.txt$/i, max: 800, read: "text" },
  { names: /^go\.mod$/i, max: 800, read: "text" },
  { names: /^gemfile$/i, max: 800, read: "text" },
  { names: /^composer\.json$/i, max: 1_000, read: "text" },
  { names: /^package\.swift$/i, max: 800, read: "text" },
  { names: /^mix\.exs$/i, max: 800, read: "text" },
  { names: /^build\.gradle(?:\.kts)?$/i, max: 800, read: "text" },
  { names: /^(?:gnu)?makefile$/i, max: 800, read: "make" },
  { names: /^justfile$/i, max: 800, read: "just" },
  { names: /^taskfile\.ya?ml$/i, max: 800, read: "text" },
  {
    names: /^(?:docker-)?compose\.ya?ml$|^docker-compose\.ya?ml$/i,
    max: 800,
    read: "text",
  },
  { names: /^pnpm-workspace\.yaml$/i, max: 400, read: "text" },
  { names: /^turbo\.json$/i, max: 600, read: "text" },
  {
    names:
      /^(?:\.nvmrc|\.node-version|\.python-version|\.tool-versions|rust-toolchain(?:\.toml)?|mise\.toml|\.ruby-version)$/i,
    max: 200,
    read: "text",
  },
];

const LOCKFILES: readonly [RegExp, string][] = [
  [/^pnpm-lock\.yaml$/, "pnpm"],
  [/^yarn\.lock$/, "yarn"],
  [/^bun\.lockb?$/, "bun"],
  [/^package-lock\.json$/, "npm"],
  [/^cargo\.lock$/i, "cargo"],
  [/^poetry\.lock$/, "poetry"],
  [/^uv\.lock$/, "uv"],
  [/^pipfile\.lock$/i, "pipenv"],
  [/^gemfile\.lock$/i, "bundler"],
  [/^go\.sum$/, "go modules"],
];

function names(value: unknown, max: number): string {
  if (!value || typeof value !== "object") return "";
  const keys = Object.keys(value as Record<string, unknown>);
  const shown = keys.slice(0, max).join(", ");
  return keys.length > max ? `${shown}, … (${keys.length} in all)` : shown;
}

/** package.json as what matters: name, package manager, scripts, dependency names. */
export function summarizePackageJson(text: string): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return text;
  }
  const out: string[] = [];
  for (const key of ["name", "type", "packageManager"] as const)
    if (typeof pkg[key] === "string") out.push(`${key}: ${pkg[key]}`);
  if (pkg.engines && typeof pkg.engines === "object")
    out.push(
      `engines: ${Object.entries(pkg.engines as Record<string, unknown>)
        .map(([name, range]) => `${name} ${String(range)}`)
        .join(", ")}`,
    );
  if (Array.isArray(pkg.workspaces))
    out.push(`workspaces: ${pkg.workspaces.slice(0, 10).join(", ")}`);
  if (pkg.scripts && typeof pkg.scripts === "object") {
    out.push("scripts:");
    for (const [name, command] of Object.entries(
      pkg.scripts as Record<string, unknown>,
    ).slice(0, 30))
      out.push(`  ${name}: ${clip(String(command), 160)}`);
  }
  const deps = names(pkg.dependencies, 30);
  if (deps) out.push(`dependencies: ${deps}`);
  const devDeps = names(pkg.devDependencies, 30);
  if (devDeps) out.push(`devDependencies: ${devDeps}`);
  return out.join("\n");
}

/** A Makefile's or justfile's recipe names; their bodies are not needed. */
export function recipeNames(text: string, kind: "make" | "just"): string {
  const pattern =
    kind === "make"
      ? /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/
      : /^@?([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+[^:\n]*)?:(?!=)/;
  const found = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match && !match[1].startsWith(".")) found.add(match[1]);
  }
  return found.size ? `recipes: ${[...found].slice(0, 40).join(", ")}` : "";
}

function excerpt(text: string, wanted: Wanted): string {
  const raw =
    wanted.read === "package"
      ? summarizePackageJson(text)
      : wanted.read === "make" || wanted.read === "just"
        ? recipeNames(text, wanted.read)
        : text;
  return cleanUntrusted(raw, wanted.max);
}

/** Top-level names, folders marked, without ignored or secret-looking entries. */
function listing(entries: readonly FsEntry[]): string {
  const shown = entries
    .filter(
      (entry) =>
        !entry.ignored &&
        entry.name !== ".git" &&
        !isSecretFileName(entry.name),
    )
    .map((entry) => (entry.isDir ? `${entry.name}/` : entry.name));
  const head = shown.slice(0, LISTING_MAX).join(", ");
  return shown.length > LISTING_MAX ? `${head}, … (${shown.length})` : head;
}

/**
 * The project digest for a first fill: the top-level listing, the package
 * managers in use, then the readable files from `WANTED`.
 */
export async function buildProjectDigest(
  project: string,
  sources: DigestSources = NATIVE_DIGEST_SOURCES,
): Promise<string> {
  const entries = await sources.listDir(project).catch(() => [] as FsEntry[]);
  const parts: string[] = [`Project folder: ${projectName(project)}`];
  const top = listing(entries);
  if (top) parts.push(`Top level: ${top}`);
  const managers = [
    ...new Set(
      entries.flatMap((entry) =>
        LOCKFILES.filter(([pattern]) => pattern.test(entry.name)).map(
          ([, name]) => name,
        ),
      ),
    ),
  ];
  if (managers.length) parts.push(`Lockfiles for: ${managers.join(", ")}`);
  const docs = entries.find(
    (entry) => entry.isDir && /^docs?$/i.test(entry.name) && !entry.ignored,
  );
  if (docs) {
    const inside = await sources.listDir(docs.path).catch(() => []);
    const docNames = inside
      .filter(
        (entry) => !entry.isDir && /\.(?:md|mdx|rst|txt)$/i.test(entry.name),
      )
      .filter((entry) => !isSecretFileName(entry.name))
      .map((entry) => entry.name)
      .slice(0, 20);
    if (docNames.length) parts.push(`${docs.name}/: ${docNames.join(", ")}`);
  }

  const files = WANTED.flatMap((wanted) => {
    const entry = entries.find(
      (candidate) =>
        !candidate.isDir &&
        wanted.names.test(candidate.name) &&
        !isSecretFileName(candidate.name),
    );
    return entry ? [{ wanted, entry }] : [];
  });
  const read = new Map(
    (
      await sources
        .readFiles(
          project,
          files.map(({ entry }) => entry.name),
          FILE_READ_BYTES,
        )
        .catch(() => [] as KeeperFile[])
    ).map((file) => [file.name, file.text]),
  );
  for (const { wanted, entry } of files) {
    const text = read.get(entry.name);
    const body = text ? excerpt(text, wanted) : "";
    if (body) parts.push(`### ${entry.name}\n${body}`);
  }
  return clip(parts.join("\n\n"), DIGEST_MAX_CHARS);
}

function day(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The branch, other branches (most recently active first) and recent commit
 * subjects. Commit messages are untrusted text like any file.
 */
export async function buildGitDigest(
  project: string,
  sources: DigestSources = NATIVE_DIGEST_SOURCES,
  limit = 20,
): Promise<string> {
  const [history, branches] = await Promise.all([
    sources.gitHistory(project, limit).catch(() => null),
    sources.gitBranches(project).catch(() => null),
  ]);
  if (!history?.commits.length && !branches?.branches.length) return "";
  const out: string[] = [];
  if (branches?.current)
    out.push(
      `Current branch: ${branches.current}${branches.detached ? " (detached)" : ""}`,
    );
  const recent: string[] = [];
  for (const commit of history?.commits ?? [])
    for (const ref of commit.refs)
      if (ref.kind === "local" && !recent.includes(ref.name))
        recent.push(ref.name);
  for (const branch of branches?.branches ?? [])
    if (!branch.remote && !recent.includes(branch.name))
      recent.push(branch.name);
  const others = recent.filter((name) => name !== branches?.current);
  if (others.length)
    out.push(`Other branches, recent first: ${others.slice(0, 12).join(", ")}`);
  const commits = (history?.commits ?? []).slice(0, limit);
  if (commits.length) {
    out.push("Recent commits, newest first:");
    for (const commit of commits) {
      const refs = commit.refs
        .filter((ref) => ref.kind === "local")
        .map((ref) => ref.name);
      out.push(
        `- ${day(commit.timestamp * 1000)} ${clip(commit.subject, 140)}${refs.length ? ` [${refs.join(", ")}]` : ""}`,
      );
    }
  }
  return cleanUntrusted(out.join("\n"), 3_000);
}

/** Finished turns in `project` after `since`, newest first. */
export function projectTurns(
  entries: readonly ActivityEntry[],
  project: string,
  since: number,
): ActivityEntry[] {
  const key = projectKey(project);
  return entries.filter((entry) => {
    if (entry.createdAt <= since) return false;
    if (entry.outcome !== "completed" && entry.outcome !== "failed")
      return false;
    // A team counts once, by its own entry, not by each member's turn.
    if (entry.team?.member) return false;
    const owner = memoryProjectFor(entry.cwd);
    return owner != null && projectKey(owner) === key;
  });
}

/**
 * What recent chats in the project did: each finished turn's title and the
 * opening of its final reply, as the activity ledger keeps them.
 */
export function recentWorkDigest(
  entries: readonly ActivityEntry[],
  project: string,
  since: number,
  limit = 12,
): string {
  const turns = projectTurns(entries, project, since)
    .filter((entry) => entry.outcome === "completed" || entry.summary)
    .slice(0, limit)
    .reverse();
  const lines = turns.map((entry) => {
    const what = [entry.title, entry.summary]
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(": ");
    const failed = entry.outcome === "failed" ? " (failed)" : "";
    return `- ${day(entry.createdAt)}${failed} ${clip(what, 300)}`;
  });
  return cleanUntrusted(lines.join("\n"), 3_500);
}
