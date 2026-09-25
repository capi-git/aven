import { invoke } from "@tauri-apps/api/core";
import type { HarnessId } from "./session";

/**
 * A race runs one prompt through several agents, each in its own git
 * worktree created by the host (see src-tauri/src/race.rs). The record
 * lives in local storage so a race can still be compared, kept or cleaned
 * up after Aven restarts.
 */
export type RaceLaneRecord = {
  sessionId: string;
  harness: HarnessId;
  model: string;
  label: string;
  path: string;
  branch: string;
};

export type RaceState = "running" | "kept" | "discarded";

export type RaceRecord = {
  id: string;
  project: string;
  root: string;
  base: string;
  prompt: string;
  createdAt: number;
  /** The base includes the project's uncommitted changes. */
  uncommitted: boolean;
  /** Untracked project files were not copied into the lanes. */
  untracked: boolean;
  lanes: RaceLaneRecord[];
  state: RaceState;
  error?: string;
};

export const RACE_MIN_LANES = 2;
export const RACE_MAX_LANES = 4;

const STORAGE_KEY = "aven.races.v1";
const CHANGE_EVENT = "aven:races-changed";
let cache: { raw: string | null; races: RaceRecord[] } | null = null;

function read(): RaceRecord[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (cache && cache.raw === raw) return cache.races;
  let races: RaceRecord[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) races = parsed.filter(isRaceRecord);
  } catch {
    races = [];
  }
  cache = { raw, races };
  return races;
}

function isRaceRecord(value: unknown): value is RaceRecord {
  if (!value || typeof value !== "object") return false;
  const race = value as Partial<RaceRecord>;
  return (
    typeof race.id === "string" &&
    typeof race.project === "string" &&
    typeof race.root === "string" &&
    typeof race.base === "string" &&
    typeof race.prompt === "string" &&
    Array.isArray(race.lanes) &&
    race.lanes.every(
      (lane) =>
        !!lane &&
        typeof lane.sessionId === "string" &&
        typeof lane.path === "string" &&
        typeof lane.branch === "string",
    )
  );
}

function write(races: RaceRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(races));
  } catch {
    // Storage full or unavailable: the in-memory race still works this session.
  }
  cache = null;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function listRaces(): RaceRecord[] {
  return read();
}

export function getRace(id: string): RaceRecord | undefined {
  return read().find((race) => race.id === id);
}

export function saveRace(race: RaceRecord) {
  write([...read().filter((item) => item.id !== race.id), race]);
}

export function updateRace(id: string, patch: Partial<RaceRecord>) {
  const races = read();
  if (!races.some((race) => race.id === id)) return;
  write(races.map((race) => (race.id === id ? { ...race, ...patch } : race)));
}

export function subscribeRaces(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * A running race's lane keeps its separate copy across restarts. Without
 * this, restoring the chat would point its agent at the real project.
 */
export function isLiveRaceWorktree(path: string | undefined): boolean {
  if (!path) return false;
  return read().some(
    (race) =>
      race.state === "running" && race.lanes.some((lane) => lane.path === path),
  );
}

/** Appended to the prompt each lane receives. */
export function racePrompt(prompt: string, laneCount: number): string {
  return `${prompt}\n\n(Aven is giving this same task to ${laneCount} agents, each in its own copy of the project on a separate branch. Work only in the current directory. Do not push, switch branches, or edit the original project; the results will be compared and the user will keep one.)`;
}

export type RaceBase = {
  root: string;
  base: string;
  uncommitted: boolean;
  untracked: boolean;
};
export type RaceFile = {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  binary: boolean;
};
export type RaceDiff = {
  files: RaceFile[];
  additions: number;
  deletions: number;
};
export type RaceFileDiff = { original: string | null; current: string | null };

export const raceHost = {
  prepare: (cwd: string) => invoke<RaceBase>("race_prepare", { cwd }),
  createLane: (root: string, raceId: string, slot: number, base: string) =>
    invoke<{ path: string; branch: string }>("race_worktree_create", {
      root,
      raceId,
      slot,
      base,
    }),
  diff: (worktree: string, base: string) =>
    invoke<RaceDiff>("race_diff", { worktree, base }),
  fileDiff: (worktree: string, base: string, path: string) =>
    invoke<RaceFileDiff>("race_file_diff", { worktree, base, path }),
  apply: (
    root: string,
    base: string,
    choices: { worktree: string; paths: string[] }[],
  ) => invoke<void>("race_apply", { root, base, choices }),
  cleanup: (root: string, lanes: { path: string; branch: string }[]) =>
    invoke<void>("race_cleanup", { root, lanes }),
};

/** Which lane each changed file is kept from; absent means not kept. */
export type RaceSelection = Record<string, number>;

/** Every file a lane changed, taken from that lane. */
export function selectLane(
  diffs: ReadonlyArray<RaceDiff | undefined>,
  lane: number,
): RaceSelection {
  const selection: RaceSelection = {};
  for (const file of diffs[lane]?.files ?? []) selection[file.path] = lane;
  return selection;
}

/** Group the chosen files by lane for the host's apply command. */
export function raceChoices(
  race: RaceRecord,
  selection: RaceSelection,
): { worktree: string; paths: string[] }[] {
  return race.lanes
    .map((lane, index) => ({
      worktree: lane.path,
      paths: Object.entries(selection)
        .filter(([, chosen]) => chosen === index)
        .map(([path]) => path)
        .sort(),
    }))
    .filter((choice) => choice.paths.length > 0);
}

/** Changed paths across lanes, with the lanes that touched each one. */
export function raceFileRows(
  diffs: ReadonlyArray<RaceDiff | undefined>,
): { path: string; lanes: number[] }[] {
  const rows = new Map<string, number[]>();
  diffs.forEach((diff, lane) => {
    for (const file of diff?.files ?? []) {
      const lanes = rows.get(file.path) ?? [];
      lanes.push(lane);
      rows.set(file.path, lanes);
    }
  });
  return [...rows.entries()]
    .map(([path, lanes]) => ({ path, lanes }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Interface actions that need the workspace (stopping agents, opening chats)
// are supplied by App so the race view does not need props threaded through
// every pane.

export type RaceWorkspace = {
  stop: (sessionIds: string[]) => void;
  openChat: (sessionId: string) => void;
};

let workspace: RaceWorkspace | null = null;

export function installRaceWorkspace(next: RaceWorkspace) {
  workspace = next;
  return () => {
    if (workspace === next) workspace = null;
  };
}

export function raceWorkspace(): RaceWorkspace | null {
  return workspace;
}
