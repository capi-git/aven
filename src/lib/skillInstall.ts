import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { invalidateProjectFiles } from "./fileIndex";
import { invalidateSkills } from "./skills";

/**
 * Adding skills from the web with the `skills` CLI (`npx skills add`). The
 * native side runs it without a shell and streams its output; this module
 * reads what the user typed, builds each step's request, and turns the CLI's
 * output into a skill list, a result, or an error in plain words.
 */

/** `global` is `~/.agents/skills`; `project` is the project's `.agents/skills`. */
export type SkillInstallScope = "global" | "project";

/** What the user typed, read as something the CLI can install from. */
export type SkillSource =
  /** `cli` goes to `skills add`; `preselect` is the one skill they named. */
  | { kind: "repo"; cli: string; label: string; preselect?: string }
  /** A bare name, looked up on skills.sh first. */
  | { kind: "name"; query: string; label: string };

export type SkillSourceResult =
  { ok: true; source: SkillSource } | { ok: false; error: string };

export type ListedSkill = { name: string; description: string };
export type FoundSkill = { source: string; name: string };

export type SkillsCliAction = "find" | "list" | "add";
export type SkillsCliRequest = {
  runId: string;
  action: SkillsCliAction;
  source: string;
  global?: boolean;
  skills?: string[];
  allSkills?: boolean;
  cwd?: string;
};
export type SkillsCliOutcome = {
  status:
    "finished" | "missingNode" | "timedOut" | "cancelled" | "failedToStart";
  code: number | null;
  stdout: string;
  stderr: string;
  /** Requested skills whose SKILL.md this run wrote (checked on disk). */
  installed: string[];
};
export type InstallEntry = {
  name?: string;
  status: string;
  error?: string;
  reason?: string;
};

export const SKILLS_OUTPUT_EVENT = "skills-cli-output";
export const NODE_MISSING =
  "Install Node.js to add skills from the web, then try again.";
export const SOURCE_HINT = "Use owner/repo, a GitHub link, or a skill name.";

const MAX_SOURCE = 200;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A skill name Aven may pass to `--skill` (mirrors the native check). */
const CHOOSABLE = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/;

function repoPath(parts: string[]): boolean {
  return (
    parts.length >= 2 &&
    parts.length <= 12 &&
    OWNER.test(parts[0]) &&
    parts.slice(1).every((part) => SEGMENT.test(part))
  );
}

/**
 * Accepts `owner/repo`, `owner/repo/path`, `owner/repo@skill`, a GitHub link,
 * a skills.sh link, or a bare skill name. Anything with spaces, shell
 * characters, other hosts, local paths, or a leading `-` is refused.
 */
export function parseSkillSource(raw: string): SkillSourceResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter owner/repo or a GitHub link." };
  if (text.length > MAX_SOURCE || !/^[\x21-\x7e]+$/.test(text)) {
    return { ok: false, error: SOURCE_HINT };
  }
  const link =
    /^(?:https:\/\/)?(?:www\.)?(github\.com|skills\.sh)\/(.*)$/i.exec(text);
  if (link) {
    const host = link[1].toLowerCase();
    const parts = link[2].replace(/\/+$/, "").split("/");
    if (!repoPath(parts)) return { ok: false, error: SOURCE_HINT };
    const repo = parts[1].replace(/\.git$/i, "");
    const label = `${parts[0]}/${repo}`;
    if (host === "skills.sh") {
      // skills.sh pages are owner/repo/skill; install from the repository.
      if (parts.length > 3) return { ok: false, error: SOURCE_HINT };
      return {
        ok: true,
        source: {
          kind: "repo",
          cli: label,
          label,
          ...(parts[2] ? { preselect: parts[2] } : {}),
        },
      };
    }
    return {
      ok: true,
      source: {
        kind: "repo",
        cli: `https://github.com/${parts.join("/")}`,
        label,
      },
    };
  }
  if (text.includes(":") || text.startsWith("-")) {
    return { ok: false, error: SOURCE_HINT };
  }
  const at = /^([^@]+)@([^@]+)$/.exec(text);
  if (at) {
    const parts = at[1].split("/");
    if (parts.length !== 2 || !repoPath(parts) || !CHOOSABLE.test(at[2])) {
      return { ok: false, error: SOURCE_HINT };
    }
    return {
      ok: true,
      source: { kind: "repo", cli: at[1], label: at[1], preselect: at[2] },
    };
  }
  if (text.includes("/")) {
    const parts = text.replace(/\/+$/, "").split("/");
    if (!repoPath(parts)) return { ok: false, error: SOURCE_HINT };
    const cli = parts.join("/");
    return { ok: true, source: { kind: "repo", cli, label: cli } };
  }
  if (NAME.test(text)) {
    return { ok: true, source: { kind: "name", query: text, label: text } };
  }
  return { ok: false, error: SOURCE_HINT };
}

// CSI (colors, cursor), OSC (titles, links), and lone two-byte escapes.
const ANSI =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Output as lines, with color codes and spinner redraws removed. */
export function outputLines(text: string): string[] {
  return stripAnsi(text)
    .split("\n")
    .map((line) =>
      (line.replace(/\r+$/, "").split("\r").pop() ?? "").trimEnd(),
    );
}

/** The CLI's guide bar, Unicode or plain (`|` on older Windows consoles). */
const BAR = /^\s*[│|┃]/;
/** The closing line of a step list (`└  Use --skill …`). */
const END = /^\s*[└—]/;
/** A step marker and its spacing (`◇  Found 2 skills`). */
const SYMBOL = /^\s*(?:[◇◆●○■▲└┌├╰]|[*•x!oT—])\s+/;

/**
 * Skills named by `skills add <source> --list`. Under "Available Skills" each
 * skill is a name line followed by a further-indented description line,
 * optionally inside a guide bar (`│`) and under group titles.
 */
export function parseSkillList(output: string): ListedSkill[] {
  const lines = outputLines(output);
  const header = lines.findIndex((line) => /Available Skills/i.test(line));
  if (header < 0) return [];
  const rows: { indent: number; text: string }[] = [];
  for (const line of lines.slice(header + 1)) {
    if (/Use --skill/i.test(line) || END.test(line)) break;
    const body = line.replace(BAR, "");
    const text = body.trim();
    if (!text) continue;
    const indent = body.length - body.trimStart().length;
    // Unindented, unbarred lines are group titles ("General").
    if (indent === 0) continue;
    rows.push({ indent, text });
  }
  if (rows.length === 0) return [];
  const nameIndent = Math.min(...rows.map((row) => row.indent));
  const skills: ListedSkill[] = [];
  const seen = new Set<string>();
  let current: ListedSkill | null = null;
  for (const row of rows) {
    if (row.indent === nameIndent) {
      current = seen.has(row.text) ? null : { name: row.text, description: "" };
      if (current) {
        seen.add(current.name);
        skills.push(current);
      }
    } else if (current && !current.description) {
      current.description = row.text;
    }
  }
  return skills;
}

/** Results of `skills find <name>`: `owner/repo@skill  1.2K installs`. */
export function parseFindResults(output: string): FoundSkill[] {
  const found: FoundSkill[] = [];
  for (const line of outputLines(output)) {
    const match =
      /^([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+)(?:\/[A-Za-z0-9._-]+)*@(.+?)(?:\s+[\d.,]+[KMB]?\s+installs?)?$/.exec(
        line.trim(),
      );
    if (match) found.push({ source: match[1], name: match[2].trim() });
  }
  return found;
}

/** The most-installed result whose skill is called exactly `query`. */
export function pickFoundSkill(
  results: readonly FoundSkill[],
  query: string,
): FoundSkill | null {
  const wanted = query.trim().toLowerCase();
  return results.find((result) => result.name.toLowerCase() === wanted) ?? null;
}

/** The `--json` result: one entry per skill, or one unnamed failure. */
export function parseInstallJson(stdout: string): InstallEntry[] | null {
  const text = stdout.trim();
  const start = text.startsWith("[") ? 0 : text.lastIndexOf("\n[") + 1;
  if (!text || (start === 0 && !text.startsWith("["))) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (entry): entry is InstallEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as InstallEntry).status === "string",
    );
  } catch {
    return null;
  }
}

/** Ticked by default: just the skill they named, if the source has it. */
export function initialSelection(
  listed: readonly ListedSkill[],
  preselect?: string,
): Set<string> {
  const wanted = preselect?.toLowerCase();
  const named = wanted
    ? listed.find((skill) => skill.name.toLowerCase() === wanted)
    : undefined;
  return new Set(named ? [named.name] : listed.map((skill) => skill.name));
}

export function findRequest(runId: string, query: string): SkillsCliRequest {
  return { runId, action: "find", source: query };
}

export function listRequest(runId: string, source: string): SkillsCliRequest {
  return { runId, action: "list", source };
}

export function installRequest(input: {
  runId: string;
  source: string;
  scope: SkillInstallScope;
  cwd: string;
  listed: readonly ListedSkill[];
  selected: ReadonlySet<string>;
}):
  | { ok: true; request: SkillsCliRequest; names: string[] }
  | { ok: false; error: string } {
  const names = input.listed
    .map((skill) => skill.name)
    .filter((name) => input.selected.has(name));
  if (names.length === 0) {
    return { ok: false, error: "Choose at least one skill to add." };
  }
  const allSkills = names.length === input.listed.length;
  // Only a chosen subset is passed as `--skill` arguments.
  const unsafe = allSkills
    ? undefined
    : names.find((name) => !CHOOSABLE.test(name) || name.endsWith(" "));
  if (unsafe) {
    return {
      ok: false,
      error: `Aven can't choose “${unsafe}” on its own. Add every skill from this source instead.`,
    };
  }
  const project = input.scope === "project";
  return {
    ok: true,
    names,
    request: {
      runId: input.runId,
      action: "add",
      source: input.source,
      global: !project,
      skills: names,
      allSkills,
      ...(project ? { cwd: input.cwd } : {}),
    },
  };
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} skills`;
}

export function successLine(
  names: readonly string[],
  scope: SkillInstallScope,
): string {
  return `Added ${listNames(names)} ${
    scope === "global" ? "for all projects" : "to this project"
  }`;
}

/** The CLI's own reason, without its guide bars and step symbols. */
function lastReason(text: string): string {
  const lines = outputLines(text)
    .map((line) =>
      line
        .replace(BAR, "")
        .replace(SYMBOL, "")
        .replace(/^\s*(?:npm\s+(?:ERR!|error)\s*)/i, "")
        .trim(),
    )
    .filter((line) => line && !line.startsWith("$ npx "));
  const reason =
    [...lines]
      .reverse()
      .find((line) => /error|fail|could not|cannot|unable/i.test(line)) ??
    lines[lines.length - 1] ??
    "";
  return reason.length > 160 ? `${reason.slice(0, 157)}…` : reason;
}

/** A failed step in plain words. `label` names the source. */
export function cliFailureText(
  outcome: SkillsCliOutcome,
  label: string,
): string {
  if (outcome.status === "missingNode") return NODE_MISSING;
  if (outcome.status === "timedOut") {
    return "This took too long, so Aven stopped it. Check your connection and try again.";
  }
  if (outcome.status === "failedToStart") {
    return "Aven couldn't start the skills installer. Try again.";
  }
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  if (/EBADENGINE|Unsupported engine/i.test(text)) {
    return "Update Node.js to version 22 or newer to add skills from the web.";
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo/i.test(
      text,
    )
  ) {
    return "Couldn't reach the internet. Check your connection and try again.";
  }
  if (
    /Failed to clone|Repository not found|could not read Username|Authentication failed|404 Not Found/i.test(
      text,
    )
  ) {
    return `Couldn't find ${label} on GitHub. Check the name, or make sure the repository is public.`;
  }
  if (/No valid skills found|No skills found/i.test(text)) {
    return `${label} doesn't contain any skills.`;
  }
  if (/npm\s+(?:ERR!|error)/i.test(text)) {
    return "Couldn't download the skills installer. Check your connection and try again.";
  }
  const reason = lastReason(text);
  return reason
    ? `The skills installer stopped: ${reason}`
    : "The skills installer stopped without saying why.";
}

/**
 * What an install did. The on-disk check and the CLI's own result are both
 * trusted: the CLI can call a skill failed when one agent lacks a global
 * folder even though the shared copy was written.
 */
export function installResult(
  outcome: SkillsCliOutcome,
  requested: readonly string[],
  label: string,
): { added: string[]; error: string | null } {
  if (outcome.status !== "finished") {
    return { added: [], error: cliFailureText(outcome, label) };
  }
  const entries = parseInstallJson(outcome.stdout) ?? [];
  const reported = new Set(
    entries
      .filter((entry) => entry.status === "installed" && entry.name)
      .map((entry) => entry.name!.toLowerCase()),
  );
  const verified = new Set(outcome.installed.map((name) => name.toLowerCase()));
  const added = requested.filter(
    (name) =>
      verified.has(name.toLowerCase()) || reported.has(name.toLowerCase()),
  );
  const missing = requested.filter((name) => !added.includes(name));
  if (missing.length === 0) return { added, error: null };
  const entry =
    entries.find(
      (item) =>
        item.name && missing.includes(item.name) && item.status !== "installed",
    ) ?? entries.find((item) => !item.name);
  const why = entry?.error ?? entry?.reason;
  const error =
    added.length === 0
      ? why && !/^Installation failed$/i.test(why)
        ? `Couldn't add ${listNames(missing)}: ${why}`
        : cliFailureText(outcome, label)
      : `${listNames(missing)} couldn't be added${why ? `: ${why}` : "."}`;
  return { added, error };
}

/** Make the next `/` list read the folders again. */
export function forgetSkillListsAfterInstall(
  scope: SkillInstallScope,
  cwd: string,
): void {
  if (scope === "global") {
    // Personal skills show up in every project.
    invalidateSkills();
    return;
  }
  invalidateSkills({ cwd });
  invalidateProjectFiles(cwd);
}

/** Run one CLI step, passing each output line to `onLine` as it arrives. */
export async function runSkillsCli(
  request: SkillsCliRequest,
  onLine: (line: string) => void,
): Promise<SkillsCliOutcome> {
  const unlisten = await listen<{ runId: string; line: string }>(
    SKILLS_OUTPUT_EVENT,
    (event) => {
      if (event.payload.runId === request.runId) onLine(event.payload.line);
    },
  );
  try {
    return await invoke<SkillsCliOutcome>("skills_cli_run", { request });
  } finally {
    unlisten();
  }
}

export async function cancelSkillsCli(runId: string): Promise<void> {
  await invoke("skills_cli_cancel", { runId });
}
