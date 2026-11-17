import { stripAnsi } from "./devServerUrls";
import { logError } from "./errors";
import type { FsEntry } from "./fs";
import { IS_WIN } from "./platform";
import { killPty, spawnPty, subscribePty, writePty } from "./pty";

/**
 * A project's Setup and Run scripts. Setup prepares a new copy (installs
 * packages, copies an env file) and runs by itself the first time the copy is
 * shown; Run scripts start the app or a dev server on request. Both are
 * saved per project, so every copy of a project shares them.
 */

export type ScriptKind = "setup" | "run";
export type ScriptRunState = "running" | "done" | "failed" | "stopped";

export type ScriptRun = {
  key: string;
  kind: ScriptKind;
  name: string;
  command: string;
  cwd: string;
  state: ScriptRunState;
  code: number | null;
  /** Raw terminal output, newest kept when it grows past the budget. */
  output: string;
};

const SETUP_KEY = "aven.setupScripts";
const SETUP_RAN_KEY = "aven.setupRan";
const OUTPUT_BUDGET = 200_000;

function readMap(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* A full quota keeps the value for this window only. */
  }
}

export function isValidScriptCommand(command: unknown): command is string {
  return (
    typeof command === "string" &&
    !!command.trim() &&
    !/[\x00-\x1f\x7f]/.test(command)
  );
}

export function loadSetupScript(project: string): string {
  const value = readMap(SETUP_KEY)[project];
  return isValidScriptCommand(value) ? value : "";
}

export function saveSetupScript(project: string, command: string) {
  const all = readMap(SETUP_KEY);
  if (command.trim()) all[project] = command.trim();
  else delete all[project];
  writeMap(SETUP_KEY, all);
  notify();
}

export function setupRanIn(copy: string): boolean {
  return readMap(SETUP_RAN_KEY)[copy] === true;
}

function markSetupRan(copy: string) {
  writeMap(SETUP_RAN_KEY, { ...readMap(SETUP_RAN_KEY), [copy]: true });
}

/** A likely setup command from the files at a project's root. */
export function suggestSetupCommand(entries: readonly FsEntry[]): string {
  const names = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));
  if (names.has("pnpm-lock.yaml")) return "pnpm install";
  if (names.has("bun.lockb") || names.has("bun.lock")) return "bun install";
  if (names.has("yarn.lock")) return "yarn install";
  if (names.has("package.json")) return "npm install";
  if (names.has("Cargo.toml")) return "cargo fetch";
  if (names.has("uv.lock")) return "uv sync";
  if (names.has("requirements.txt")) return "pip install -r requirements.txt";
  if (names.has("Gemfile")) return "bundle install";
  return "";
}

/**
 * Terminal output as plain lines: colours removed, and a carriage return
 * (a progress bar redrawing its line) keeps only what was written last.
 */
export function plainScriptOutput(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const parts = line.split("\r");
      let last = parts.pop() ?? "";
      while (!stripAnsi(last).trim() && parts.length) last = parts.pop() ?? "";
      return stripAnsi(last);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** The line typed into the shell: the command, then leave with its status. */
export function scriptShellLine(command: string, windows = IS_WIN): string {
  return windows ? `${command}; exit $LASTEXITCODE\r` : `${command}; exit $?\r`;
}

export function scriptKey(kind: ScriptKind, cwd: string, name: string) {
  return `${kind}:${cwd}:${name}`;
}

// --- Running scripts -------------------------------------------------------

const runs = new Map<string, ScriptRun>();
const ptys = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

function patch(key: string, change: Partial<ScriptRun>) {
  const run = runs.get(key);
  if (!run) return;
  runs.set(key, { ...run, ...change });
  notify();
}

export function subscribeScripts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever a run or a saved script changes; for useSyncExternalStore. */
export function scriptsVersion(): number {
  return version;
}

export function scriptRun(key: string): ScriptRun | undefined {
  return runs.get(key);
}

export function scriptRunsIn(cwd: string, kind?: ScriptKind): ScriptRun[] {
  return [...runs.values()].filter(
    (run) => run.cwd === cwd && (!kind || run.kind === kind),
  );
}

/** Starts a script in its own hidden shell. A running one is left alone. */
export async function runScript(
  kind: ScriptKind,
  name: string,
  command: string,
  cwd: string,
): Promise<void> {
  if (!isValidScriptCommand(command)) return;
  const key = scriptKey(kind, cwd, name);
  if (runs.get(key)?.state === "running") return;
  const id = `aven-script-${crypto.randomUUID()}`;
  ptys.set(key, id);
  runs.set(key, {
    key,
    kind,
    name,
    command,
    cwd,
    state: "running",
    code: null,
    output: "",
  });
  if (kind === "setup") markSetupRan(cwd);
  notify();
  const decoder = new TextDecoder();
  const unsubscribe = subscribePty(
    id,
    (data) => {
      if (ptys.get(key) !== id) return;
      const run = runs.get(key);
      if (!run) return;
      const output = run.output + decoder.decode(data, { stream: true });
      patch(key, {
        output:
          output.length > OUTPUT_BUDGET ? output.slice(-OUTPUT_BUDGET) : output,
      });
    },
    (code) => {
      unsubscribe();
      if (ptys.get(key) !== id) return;
      ptys.delete(key);
      patch(key, { state: code === 0 ? "done" : "failed", code });
    },
  );
  try {
    await spawnPty(id, cwd, 120, 30);
    await writePty(id, scriptShellLine(command));
  } catch (error) {
    unsubscribe();
    ptys.delete(key);
    logError(`Couldn't start the ${name} script`, error);
    patch(key, {
      state: "failed",
      output: `${runs.get(key)?.output ?? ""}${error instanceof Error ? error.message : String(error)}\n`,
    });
  }
}

export async function stopScript(key: string): Promise<void> {
  const id = ptys.get(key);
  if (!id) return;
  ptys.delete(key);
  patch(key, { state: "stopped" });
  await killPty(id);
}

/** Forgets a finished run, so its output no longer shows. */
export function clearScriptRun(key: string) {
  if (runs.get(key)?.state === "running") return;
  if (runs.delete(key)) notify();
}
