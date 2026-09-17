import { invoke } from "@tauri-apps/api/core";

export type RunScript = { id: string; name: string; command: string };
const RUN_KEY = "monocode.personal.runScripts";
/** A saved terminal action is a single user-entered line, without terminal control bytes. */
export function isValidRunCommand(command: unknown): command is string {
  return (
    typeof command === "string" &&
    !!command.trim() &&
    !/[\x00-\x1f\x7f]/.test(command)
  );
}
function isRunScript(row: unknown): row is RunScript {
  if (!row || typeof row !== "object") return false;
  const value = row as Partial<RunScript>;
  return (
    typeof value.id === "string" &&
    !!value.id.trim() &&
    typeof value.name === "string" &&
    !!value.name.trim() &&
    isValidRunCommand(value.command)
  );
}
export function loadRunScripts(cwd: string): RunScript[] {
  try {
    const rows = JSON.parse(localStorage.getItem(RUN_KEY) || "{}")[cwd];
    return Array.isArray(rows) ? rows.filter(isRunScript) : [];
  } catch {
    return [];
  }
}
export function saveRunScripts(cwd: string, scripts: RunScript[]) {
  let value: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(RUN_KEY) || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) value = raw;
  } catch {
    /* Replace only malformed preference data. */
  }
  try {
    localStorage.setItem(
      RUN_KEY,
      JSON.stringify({ ...value, [cwd]: scripts.filter(isRunScript) }),
    );
  } catch {
    /* Current window retains the user's commands. */
  }
}

/** Keep the supplied repository transport and SSH account alias intact. */
export function routedCloneUrl(
  raw: string,
): string {
  const value = raw.trim();
  if (/\s/.test(value))
    throw new Error(
      "Enter a repository URL without spaces or control characters.",
    );
  const ssh = value.match(/^git@github(?:\.com|-personal|-work):([^\s?#]+)$/);
  let slug = ssh?.[1];
  if (!slug) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Enter a repository HTTPS or SSH URL.");
    }
    if (url.username && url.protocol !== "ssh:")
      throw new Error("Use a repository URL without credentials.");
    if (url.password)
      throw new Error("Use a repository URL without credentials.");
    if (url.search || url.hash)
      throw new Error("Use a repository URL without a query or fragment.");
    if (
      url.hostname === "github.com" ||
      url.hostname === "github-personal" ||
      url.hostname === "github-work"
    ) {
      if (url.protocol !== "https:" && url.protocol !== "ssh:")
        throw new Error("Use HTTPS or SSH for GitHub.");
      if (url.port || (url.username && url.username !== "git"))
        throw new Error("Use the standard GitHub repository URL.");
      slug = url.pathname.replace(/^\//, "");
    } else {
      if (!["https:", "ssh:"].includes(url.protocol))
        throw new Error("Use an HTTPS or SSH repository URL.");
      return value;
    }
  }
  slug = slug.replace(/\/$/, "").replace(/\.git$/, "");
  if (!validGithubSlug(slug))
    throw new Error("Enter a GitHub owner/repository URL.");
  return value;
}

function validGithubSlug(slug: string) {
  return (
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) &&
    slug.split("/").every((part) => part !== "." && part !== "..")
  );
}

export type PersonalProjectInfo = {
  root: string;
  branch: string | null;
  remoteUrl: string | null;
  defaultBranch: string | null;
};
export function personalProjectInfo(cwd: string) {
  return invoke<PersonalProjectInfo>("personal_project_info", { cwd });
}
export function githubCompareUrl(
  remote: string,
  base: string,
  head: string,
  title: string,
  body: string,
): string {
  if (/\s/.test(remote.trim()))
    throw new Error("This project needs a valid GitHub remote.");
  const ssh = remote
    .trim()
    .match(/^git@github(?:\.com|-personal|-work):([^\s]+)$/);
  let slug = ssh?.[1];
  if (!slug) {
    let url: URL;
    try {
      url = new URL(remote);
    } catch {
      throw new Error("This project needs a GitHub remote.");
    }
    if (
      !["github.com", "github-personal", "github-work"].includes(url.hostname)
    )
      throw new Error("This project needs a GitHub remote.");
    if (
      !["https:", "ssh:"].includes(url.protocol) ||
      url.password ||
      url.port ||
      (url.username && (url.protocol !== "ssh:" || url.username !== "git")) ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use a GitHub HTTPS or SSH remote without credentials, query, or fragment.",
      );
    slug = url.pathname.replace(/^\//, "");
  }
  slug = slug.replace(/\/$/, "").replace(/\.git$/, "");
  if (!validGithubSlug(slug))
    throw new Error("The GitHub remote is not a repository URL.");
  base = base.trim();
  head = head.trim();
  if (!base || !head) throw new Error("Choose a base and head branch.");
  if (base === head)
    throw new Error("Choose a base branch different from your current branch.");
  const url = new URL(
    `https://github.com/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  url.searchParams.set("expand", "1");
  if (title.trim()) url.searchParams.set("title", title.trim());
  if (body.trim()) url.searchParams.set("body", body.trim());
  return url.toString();
}
