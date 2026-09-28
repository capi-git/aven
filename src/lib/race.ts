import { invoke } from "@tauri-apps/api/core";
import { isEqualOrInside } from "./paths";
import type { HarnessId, Session } from "./session";

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
      race.state === "running" &&
      race.lanes.some((lane) => isEqualOrInside(path, lane.path)),
  );
}

/** The project a Race lane folder, or a path inside one, was copied from. */
export function raceLaneProject(path: string): string | undefined {
  return read().find((race) =>
    race.lanes.some((lane) => isEqualOrInside(path, lane.path)),
  )?.project;
}

type RaceCheckout = Pick<
  Session,
  "cwd" | "worktreeCwd" | "branch" | "providerSessionId" | "pendingSwitch"
>;

/** Includes follow-up chats that share a lane but have their own session ID. */
export function usesRaceCheckout(
  session: RaceCheckout,
  race: RaceRecord,
): boolean {
  return race.lanes.some((lane) =>
    isEqualOrInside(session.worktreeCwd ?? session.cwd, lane.path),
  );
}

/** A finished lane continues in its original project with a fresh provider. */
export function releaseRaceCheckout<T extends RaceCheckout>(
  session: T,
  race: RaceRecord,
): T {
  if (!usesRaceCheckout(session, race)) return session;
  return {
    ...session,
    cwd: race.lanes.some((lane) => isEqualOrInside(session.cwd, lane.path))
      ? race.project
      : session.cwd,
    branch: undefined,
    worktreeCwd: undefined,
    providerSessionId: undefined,
    ...(session.pendingSwitch
      ? {
          pendingSwitch: {
            ...session.pendingSwitch,
            fromProviderSessionId: undefined,
          },
        }
      : {}),
  };
}

const finishing = new Set<string>();

export function isFinishingRaceCheckout(path: string): boolean {
  return read().some(
    (race) =>
      finishing.has(race.id) &&
      race.lanes.some((lane) => isEqualOrInside(path, lane.path)),
  );
}

/** Stop every writer before reading its final diff or deleting its checkout. */
export async function finishRace(
  race: RaceRecord,
  keep: RaceSelection | null,
): Promise<void> {
  if (finishing.has(race.id))
    throw new Error("This race is already finishing.");
  if (getRace(race.id)?.state !== "running")
    throw new Error("This race has already finished.");
  const host = raceWorkspace();
  if (!host)
    throw new Error(
      "The race workspace is unavailable. Reopen it and try again.",
    );
  const choices = keep ? raceChoices(race, keep) : [];
  if (keep && !choices.length)
    throw new Error("Choose at least one file to keep.");
  finishing.add(race.id);
  try {
    await host.settle(race);
    if (keep) await raceHost.apply(race.root, race.base, choices);
    let cleanupError: string | undefined;
    try {
      await raceHost.cleanup(race.root, race.lanes);
    } catch (error) {
      cleanupError = `Copies were not all removed: ${String(error)}`;
    }
    updateRace(race.id, {
      state: keep ? "kept" : "discarded",
      error: cleanupError,
    });
    await host.release(race);
  } finally {
    finishing.delete(race.id);
  }
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
  settle: (race: RaceRecord) => Promise<void>;
  release: (race: RaceRecord) => Promise<void>;
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
