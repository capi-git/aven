import {
  devPreviewsSnapshot,
  devServerIdentity,
  subscribeDevPreviews,
} from "./devPreviews";
import { logError } from "./errors";
import { inspectPaths, readTextFile } from "./fs";
import { joinPath } from "./paths";

/**
 * Starting a project's dev server from a preview tab that cannot reach it
 * (after a restart, say): which script would start it, running it in the
 * project's terminal the way Aven runs any terminal command, and telling
 * the tab when the server answers so it reloads once.
 */

/** A package script that starts a dev server, and how to run it. */
export type DevScript = {
  /** The script's name in package.json: "dev". */
  name: string;
  /** What the script runs: "vite", "python3 -m http.server 5180". */
  script: string;
  /** The line typed into the terminal: "npm run dev", "pnpm dev". */
  run: string;
};

/** Script names that start a dev server, in the order they are preferred. */
export const DEV_SCRIPT_NAMES = ["dev", "start", "serve"] as const;

const LOCKFILES = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

/**
 * The dev script in a package.json's text, run with the package manager
 * its lockfiles name (npm when none does), or null when there is none.
 */
export function devScriptFrom(
  packageJson: string,
  lockfiles: readonly string[] = [],
): DevScript | null {
  let scripts: unknown;
  try {
    scripts = (JSON.parse(packageJson) as { scripts?: unknown })?.scripts;
  } catch {
    return null;
  }
  if (!scripts || typeof scripts !== "object") return null;
  const table = scripts as Record<string, unknown>;
  const name = DEV_SCRIPT_NAMES.find((candidate) => {
    const value = table[candidate];
    return typeof value === "string" && value.trim() !== "";
  });
  if (!name) return null;
  const has = (file: string) => lockfiles.includes(file);
  const run = has("pnpm-lock.yaml")
    ? `pnpm ${name}`
    : has("yarn.lock")
      ? `yarn ${name}`
      : has("bun.lock") || has("bun.lockb")
        ? `bun run ${name}`
        : `npm run ${name}`;
  return { name, script: (table[name] as string).trim(), run };
}

/** The project's dev script, read from its package.json; null without one. */
export async function loadDevScript(
  project: string,
): Promise<DevScript | null> {
  let text: string;
  try {
    text = await readTextFile(joinPath(project, "package.json"));
  } catch {
    return null;
  }
  const found = await inspectPaths(
    LOCKFILES.map((file) => joinPath(project, file)),
  ).catch(() => []);
  return devScriptFrom(
    text,
    found.map((entry) => entry.name),
  );
}

/** A local development address: a loopback host, with or without a port. */
export function isLocalDevAddress(url: string): boolean {
  return /^https?:\/\/loopback:/.test(devServerIdentity(url) ?? "");
}

// --- Running it ------------------------------------------------------------

/**
 * Runs `command` in a new terminal in `project`'s terminal panel; false
 * when this window cannot (another project is on screen, or no panel).
 */
export type DevServerStarter = (project: string, command: string) => boolean;

let starter: DevServerStarter | null = null;

/** The workspace window installs how it runs a command in a project. */
export function installDevServerStarter(next: DevServerStarter): () => void {
  starter = next;
  return () => {
    if (starter === next) starter = null;
  };
}

/** Whether this window can start a project's dev server. */
export function canStartDevServers(): boolean {
  return starter !== null;
}

/** A server being started from a preview tab, until it answers. */
export type DevServerStart = {
  /** Its server, as `devServerIdentity` names it. */
  key: string;
  project: string;
  run: string;
  since: number;
  /** It answered: tabs on it reload once, then the start is finished. */
  ready: boolean;
};

/** How long a start is waited for before the tab offers to start it again. */
export const DEV_SERVER_START_MS = 60_000;

let starts: readonly DevServerStart[] = [];
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

function commit(next: readonly DevServerStart[]) {
  starts = next;
  if (!starts.some((start) => !start.ready)) {
    stopWatching?.();
    stopWatching = null;
  }
  for (const listener of [...listeners]) listener();
}

export function subscribeDevServerStarts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function devServerStartsSnapshot(): readonly DevServerStart[] {
  return starts;
}

/** The start for the server `url` is on, if one is under way or answered. */
export function devServerStartFor(
  list: readonly DevServerStart[],
  url: string,
): DevServerStart | undefined {
  const key = devServerIdentity(url);
  return key ? list.find((start) => start.key === key) : undefined;
}

/** A server announced itself in a terminal or agent: its starts answered. */
function markReady() {
  const live = new Set(
    devPreviewsSnapshot()
      .filter((preview) => preview.status === "live")
      .flatMap((preview) => devServerIdentity(preview.url) ?? []),
  );
  if (!starts.some((start) => !start.ready && live.has(start.key))) return;
  commit(
    starts.map((start) =>
      !start.ready && live.has(start.key) ? { ...start, ready: true } : start,
    ),
  );
}

/**
 * Starts the dev server the tab at `url` needs by running `script` in the
 * project's terminal. Returns false, starting nothing, when this window
 * cannot run it.
 */
export function startDevServer(
  project: string,
  script: Pick<DevScript, "run">,
  url: string,
  now = Date.now(),
): boolean {
  const key = devServerIdentity(url);
  if (!key || !starter) return false;
  try {
    if (!starter(project, script.run)) return false;
  } catch (error) {
    logError("Could not start the dev server", error);
    return false;
  }
  commit([
    ...starts.filter((start) => start.key !== key),
    { key, project, run: script.run, since: now, ready: false },
  ]);
  stopWatching ??= subscribeDevPreviews(markReady);
  markReady();
  return true;
}

/** The tab reloaded on it, or gave up waiting: the start is over. */
export function finishDevServerStart(key: string): void {
  if (!starts.some((start) => start.key === key)) return;
  commit(starts.filter((start) => start.key !== key));
}

/** Test seam. */
export function resetDevServerStarts(): void {
  starter = null;
  commit([]);
}
