import { createDevOutputScanner, stripAnsi } from "./devServerUrls";
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
  /** When it started, and when it ended once it has. */
  startedAt?: number;
  endedAt?: number;
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
  if (names.has("Package.swift")) return "swift package resolve";
  return "";
}

/**
 * Likely Run commands from the files at a project's root, for projects that
 * are not run through package.json: a build script, a Swift package, a Mac
 * app's Xcode project, a Makefile or a Rust crate. A folder with its own
 * build script and an Info.plist builds a Mac app, so "Build and open" builds
 * it and opens the newest app it made.
 */
export function suggestRunCommands(
  entries: readonly FsEntry[],
  windows = IS_WIN,
): { name: string; command: string }[] {
  const files = new Set(entries.filter((e) => !e.isDir).map((e) => e.name));
  const xcode = entries.find((e) => e.isDir && e.name.endsWith(".xcodeproj"));
  const hints: { name: string; command: string }[] = [];
  if (!windows && files.has("build.sh")) {
    if (files.has("Info.plist"))
      hints.push({
        name: "Build and open",
        command: './build.sh && open "$(ls -td build/*.app | head -n 1)"',
      });
    hints.push({ name: "Build", command: "./build.sh" });
  }
  if (xcode && !/["$`\\]/.test(xcode.name))
    hints.push({
      name: "Xcode build",
      command: `xcodebuild -project "${xcode.name}" build`,
    });
  if (files.has("Package.swift")) {
    hints.push({ name: "swift run", command: "swift run" });
    hints.push({ name: "swift test", command: "swift test" });
  }
  if (files.has("Makefile")) hints.push({ name: "make", command: "make" });
  if (files.has("Cargo.toml"))
    hints.push({ name: "cargo run", command: "cargo run" });
  return hints;
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
    startedAt: Date.now(),
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
      patch(key, {
        state: code === 0 ? "done" : "failed",
        code,
        endedAt: Date.now(),
      });
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
      endedAt: Date.now(),
      output: `${runs.get(key)?.output ?? ""}${error instanceof Error ? error.message : String(error)}\n`,
    });
  }
}

export async function stopScript(key: string): Promise<void> {
  const id = ptys.get(key);
  if (!id) return;
  ptys.delete(key);
  patch(key, { state: "stopped", endedAt: Date.now() });
  await killPty(id);
}

/** Forgets a finished run, so its output no longer shows. */
export function clearScriptRun(key: string) {
  if (runs.get(key)?.state === "running") return;
  if (runs.delete(key)) notify();
}

/** The terminals of scripts still running, for telling their work apart. */
export function runningScriptPtys(): string[] {
  return [...ptys.entries()]
    .filter(([key]) => runs.get(key)?.state === "running")
    .map(([, id]) => id);
}

/**
 * The port a run announced (Vite's `Local: http://localhost:5173/`), the
 * app's own page first; null when its output names none.
 */
export function scriptRunPort(run: Pick<ScriptRun, "output">): number | null {
  if (!run.output) return null;
  const scanner = createDevOutputScanner();
  const signals = [...scanner.push(run.output), ...scanner.finish()].flatMap(
    (signal) => (signal.kind === "address" ? [signal.address] : []),
  );
  const page =
    signals.find((address) => address.strength === "strong") ?? signals[0];
  return page?.port ?? null;
}

/** The run in `cwd` that ended last, if any. */
export function lastEndedRun(
  runs: readonly ScriptRun[],
): ScriptRun | undefined {
  return runs
    .filter((run) => run.state !== "running" && run.endedAt != null)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
}

/** "41m", "2h 5m", "30s": how long a run has gone on. */
export function runDuration(
  startedAt: number | undefined,
  now: number,
): string {
  if (startedAt == null || !Number.isFinite(startedAt)) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** The end of a running command's row: ":5173 · 41m", or just "12m". */
export function runningRowEnd(run: ScriptRun, now: number): string {
  const port = scriptRunPort(run);
  const duration = runDuration(run.startedAt, now);
  return [port != null ? `:${port}` : "", duration].filter(Boolean).join(" · ");
}
