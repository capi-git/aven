import { isTauri } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { logError } from "./errors";
import { loadProjectFilesIfStale, peekLastProjectFiles } from "./fileIndex";
import { basename, inspectPaths, type ProjectFile } from "./fs";
import { parseFileLink } from "./inAppLinks";
import {
  joinPath,
  looksLikeFilePath,
  pathKey,
  resolveWorkspacePath,
  slash,
} from "./paths";
import { IS_WIN } from "./platform";
import { looksLikeProject } from "./recents";
import { revealFile } from "./revealFile";
import type { EditorNavigation, OpenFileFn } from "./search";
import type { Block } from "./session";

/**
 * A file named in an agent's reply: a Markdown link, an inline `name.ext`
 * or `path:line`, or a code block's file label.
 *
 * Absolute and `~/` paths are taken as written. A bare name (`llms.txt`) is
 * looked up, in order, among the files this chat's agent touched (newest
 * first), then in the project's file index when exactly one file matches,
 * and only then joined onto the project folder. A relative path with folders
 * means the project folder's file when that exists, else the same lookup.
 */
export type FileReference = {
  /** The file Aven would open: the real one when it knows it. */
  path: string;
  navigation?: EditorNavigation;
  /** The path as the reply wrote it, without its line. */
  written: string;
  /**
   * How `path` was found: as written (absolute or `~/`), a file this chat
   * touched, the project's file index, or a plain join onto the project
   * folder that may not exist.
   */
  source: "written" | "chat" | "index" | "join";
};

/** Resolves references for one chat turn, or for a project with no chat. */
export type FileReferences = {
  readonly cwd?: string;
  /** Files the chat touched, in the order a reference prefers them. */
  readonly touched: readonly string[];
  resolve(href: string): FileReference | undefined;
};

type Candidate = { path: string; source: FileReference["source"] };

type Relative = {
  /** Normalized: no leading `./`, no empty segments. */
  text: string;
  /** Has `.` or `..` segments: only a join onto the project means anything. */
  plain: boolean;
};

const FAILED_TOOL = new Set(["failed", "error", "declined"]);
/** The most candidate paths one click checks on disk. */
const MAX_CHECKED = 12;
/** Cached results per resolver before it starts over. */
const MAX_CACHED = 500;

/**
 * Full paths in the tool calls of `blocks` (reads, edits, previews), newest
 * first, each once. Failed calls are left out: a failed read is often the
 * wrong guess the agent then corrected.
 */
export function touchedFilePaths(
  blocks: readonly Block[],
  cwd?: string,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let index = blocks.length - 1; index >= 0; index--) {
    const tool = blocks[index]!.tool;
    const raw = tool?.preview?.path?.trim();
    if (!raw || FAILED_TOOL.has(tool?.status?.toLowerCase() ?? "")) continue;
    const path = resolveWorkspacePath(raw, cwd);
    if (!path || path === "~") continue;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

const turnPaths = new WeakMap<
  readonly Block[],
  { cwd?: string; paths: readonly string[] }
>();

/** `touchedFilePaths` for one turn, cached while the turn is unchanged. */
export function turnFilePaths(
  turn: readonly Block[],
  cwd?: string,
): readonly string[] {
  const cached = turnPaths.get(turn);
  if (cached && cached.cwd === cwd) return cached.paths;
  const paths = touchedFilePaths(turn, cwd);
  turnPaths.set(turn, { cwd, paths });
  return paths;
}

/** One chat's references: each turn prefers its own files, then earlier ones. */
export type ChatFileReferences = {
  readonly cwd?: string;
  /** References for the turn at `index` (in the chat's turns); the whole chat when unknown. */
  forTurn(index?: number): FileReferences;
};

/** `turns[i]` is what turn `i` touched, newest first (see `turnFilePaths`). */
export function chatFileReferences(
  cwd: string | undefined,
  turns: readonly (readonly string[])[],
): ChatFileReferences {
  const byTurn = new Map<number, FileReferences>();
  return {
    cwd,
    forTurn(index) {
      const at =
        index === undefined || index < 0 || index >= turns.length
          ? turns.length - 1
          : index;
      let references = byTurn.get(at);
      if (!references) {
        references = fileReferences(cwd, touchedFromTurn(turns, at));
        byTurn.set(at, references);
      }
      return references;
    },
  };
}

/** This turn's files and earlier ones, newest first, then later turns'. */
function touchedFromTurn(
  turns: readonly (readonly string[])[],
  at: number,
): string[] {
  const order: (readonly string[])[] = [];
  for (let index = at; index >= 0; index--) order.push(turns[index]!);
  for (let index = turns.length - 1; index > at; index--)
    order.push(turns[index]!);
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const list of order) {
    for (const path of list) {
      const key = pathKey(path);
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(path);
    }
  }
  return paths;
}

/**
 * A resolver that remembers its answers until the project's file listing
 * changes. It only peeks at a listing already loaded; it never starts a scan.
 */
export function fileReferences(
  cwd: string | undefined,
  touched: readonly string[] = [],
): FileReferences {
  let listing: readonly ProjectFile[] | null = null;
  const cache = new Map<string, FileReference | undefined>();
  return {
    cwd,
    touched,
    resolve(href) {
      const files = cwd ? peekLastProjectFiles(cwd) : null;
      if (files !== listing || cache.size >= MAX_CACHED) {
        listing = files;
        cache.clear();
      }
      if (cache.has(href)) return cache.get(href);
      const reference = resolveFileReference(href, { cwd, touched, files });
      cache.set(href, reference);
      return reference;
    },
  };
}

const projectReferences = new Map<string, FileReferences>();
const MAX_PROJECTS = 8;

/** The shared resolver for Markdown outside a chat (notes, previews, Inbox). */
export function projectFileReferences(cwd?: string): FileReferences {
  const key = cwd ?? "";
  let references = projectReferences.get(key);
  if (!references) {
    references = fileReferences(cwd);
    projectReferences.set(key, references);
    for (const old of projectReferences.keys()) {
      if (projectReferences.size <= MAX_PROJECTS) break;
      projectReferences.delete(old);
    }
  }
  return references;
}

/** What `href` names, from what is known now. Never reads the disk. */
export function resolveFileReference(
  href: string,
  context: {
    cwd?: string;
    touched: readonly string[];
    files?: readonly ProjectFile[] | null;
  },
): FileReference | undefined {
  const parsed = parseFileLink(href);
  const bare = parsed ? undefined : bareFileLocation(href);
  const link = parsed ?? bare;
  if (!link) return undefined;
  const navigation = link.navigation ? { navigation: link.navigation } : {};
  // Absolute and home paths resolve exactly as they always have.
  const written = resolveWorkspacePath(link.value);
  if (written) {
    return {
      path: written,
      written: link.value,
      source: "written",
      ...navigation,
    };
  }
  const relative = relativeReference(link.value);
  if (!relative) return undefined;
  const [best] = referenceCandidates(relative, context, false).candidates;
  if (!best) return undefined;
  // `example.com:8080` reads like `App.tsx:12`. Only a file Aven knows of
  // makes it a link.
  if (bare && best.source !== "chat" && best.source !== "index")
    return undefined;
  return { ...best, written: link.value, ...navigation };
}

/** `App.tsx:12` or `App.tsx:12:3`: a bare file name with a line. */
const BARE_LOCATION =
  /^([^\s:/\\#?%]+\.[A-Za-z][A-Za-z0-9+]{0,11}):(\d+)(?::(\d+))?$/;

/**
 * A bare name with a line, which `parseFileLink` takes for a URL scheme
 * (`App.tsx:` could be one), so it never names a file on its own.
 */
function bareFileLocation(
  href: string,
): { value: string; navigation: EditorNavigation } | undefined {
  const match = href.trim().match(BARE_LOCATION);
  const line = match ? Number(match[2]) : 0;
  if (!match || !(line > 0)) return undefined;
  return {
    value: match[1]!,
    navigation: { line, ...(match[3] ? { column: Number(match[3]) } : {}) },
  };
}

function relativeReference(value: string): Relative | undefined {
  const normalized = slash(value);
  if (!looksLikeFilePath(normalized)) return undefined;
  const parts = normalized.split("/").filter(Boolean);
  while (parts[0] === ".") parts.shift();
  if (parts.length === 0) return undefined;
  return {
    text: parts.join("/"),
    plain: parts.some((part) => part === "." || part === ".."),
  };
}

/**
 * Where a relative reference may point, best first. `onDisk` orders them for
 * a click, which checks each on disk: there a path with folders that exists
 * under the project wins outright. While rendering, only the file index can
 * say that.
 */
function referenceCandidates(
  relative: Relative,
  {
    cwd,
    touched,
    files,
  }: {
    cwd?: string;
    touched: readonly string[];
    files?: readonly ProjectFile[] | null;
  },
  onDisk: boolean,
): { candidates: Candidate[]; indexMatches: readonly ProjectFile[] } {
  const joined = cwd && cwd !== "~" ? joinPath(cwd, relative.text) : undefined;
  const join: Candidate | undefined = joined
    ? { path: joined, source: "join" }
    : undefined;
  if (relative.plain)
    return { candidates: join ? [join] : [], indexMatches: [] };

  const indexMatches = files
    ? files.filter((file) => endsWithPath(file.relative, relative.text))
    : [];
  const indexedJoin = joined
    ? indexMatches.find((file) => pathKey(file.path) === pathKey(joined))
    : undefined;
  const candidates: Candidate[] = [];
  // A path with folders names a place. When the file is there, it wins.
  if (relative.text.includes("/")) {
    if (onDisk && join) candidates.push(join);
    else if (indexedJoin)
      candidates.push({ path: indexedJoin.path, source: "index" });
  }
  for (const path of touched) {
    if (endsWithPath(path, relative.text))
      candidates.push({ path, source: "chat" });
  }
  if (indexMatches.length === 1)
    candidates.push({ path: indexMatches[0]!.path, source: "index" });
  if (indexedJoin) candidates.push({ path: indexedJoin.path, source: "index" });
  if (join) candidates.push(join);

  const seen = new Set<string>();
  return {
    candidates: candidates.filter((candidate) => {
      const key = pathKey(candidate.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    indexMatches,
  };
}

/** `path` is `tail` or ends with `/tail`. */
function endsWithPath(path: string, tail: string): boolean {
  const normalized = slash(path).replace(/\/+$/, "");
  const fold =
    IS_WIN || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
  const full = fold ? normalized.toLowerCase() : normalized;
  const end = fold ? tail.toLowerCase() : tail;
  return full === end || full.endsWith(`/${end}`);
}

export type LocatedFile =
  { path: string; navigation?: EditorNavigation } | { missing: string };

/**
 * The file a clicked reference names, checked on disk with a fresh project
 * listing, or a plain sentence saying why there is none. When the disk cannot
 * be checked, the best guess from rendering stands.
 */
export async function locateFileReference(
  reference: FileReference,
  references: FileReferences,
): Promise<LocatedFile> {
  const found = (path: string): LocatedFile => ({
    path,
    ...(reference.navigation ? { navigation: reference.navigation } : {}),
  });
  if (reference.source === "written") {
    const existing = await firstExisting([reference.path]);
    return existing === null
      ? { missing: `${basename(reference.path)} isn't at that location.` }
      : found(reference.path);
  }
  const relative = relativeReference(reference.written);
  if (!relative) return found(reference.path);
  const { cwd, touched } = references;
  // What the chat touched (and, for a path with folders, the project
  // folder's own file) comes first whatever the index says: check that
  // before waiting on a project scan.
  const first = referenceCandidates(relative, { cwd, touched }, true)
    .candidates.filter(
      (candidate) =>
        candidate.source === "chat" ||
        (candidate.source === "join" && relative.text.includes("/")),
    )
    .map((candidate) => candidate.path)
    .slice(0, MAX_CHECKED);
  const early = await firstExisting(first);
  if (early === undefined) return found(reference.path);
  if (early !== null) return found(early);

  const files =
    cwd && looksLikeProject(cwd)
      ? await loadProjectFilesIfStale(cwd).catch(() => null)
      : null;
  const { candidates, indexMatches } = referenceCandidates(
    relative,
    { cwd, touched, files },
    true,
  );
  const checked = new Set(first.map(pathKey));
  const existing = await firstExisting(
    candidates
      .map((candidate) => candidate.path)
      .filter((path) => !checked.has(pathKey(path)))
      .slice(0, MAX_CHECKED),
  );
  if (existing === undefined) return found(reference.path);
  if (existing !== null) return found(existing);
  return {
    missing:
      indexMatches.length > 1
        ? `There's more than one ${relative.text} in this project.`
        : `Couldn't find ${relative.text} in this project.`,
  };
}

/** The first of `paths` that exists; null when none does, undefined when unknown. */
async function firstExisting(
  paths: readonly string[],
): Promise<string | null | undefined> {
  if (paths.length === 0) return null;
  try {
    // One call per path keeps each answer with its path (`~/` comes back expanded).
    const found = await Promise.all(paths.map((path) => inspectPaths([path])));
    const index = found.findIndex((infos) => infos.length > 0);
    return index < 0 ? null : paths[index]!;
  } catch {
    return undefined;
  }
}

function sayMissing(text: string) {
  void message(text, { title: "File not found", kind: "info" }).catch(() => {});
}

/**
 * Open a clicked reference, never a tab for a file that is not there. Outside
 * the desktop app nothing can be checked, so it opens as written.
 */
export function openFileReference(
  reference: FileReference,
  references: FileReferences,
  open: OpenFileFn,
): void {
  if (!isTauri()) {
    open(reference.path, reference.navigation);
    return;
  }
  void locateFileReference(reference, references)
    .then((located) => {
      if ("missing" in located) sayMissing(located.missing);
      else open(located.path, located.navigation);
    })
    .catch((error: unknown) => logError("open file reference", error));
}

/** Show a reference in Finder or File Explorer, once it is found. */
export function revealFileReference(
  reference: FileReference,
  references: FileReferences,
): void {
  if (!isTauri()) {
    revealFile(reference.path, "reveal file link");
    return;
  }
  void locateFileReference(reference, references)
    .then((located) => {
      if ("missing" in located) sayMissing(located.missing);
      else revealFile(located.path, "reveal file link");
    })
    .catch((error: unknown) => logError("reveal file reference", error));
}
