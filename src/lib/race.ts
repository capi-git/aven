import { invoke } from "@tauri-apps/api/core";
import { isEqualOrInside } from "./paths";
import type { Attachment, Block, HarnessId, Session } from "./session";

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

/**
 * What a kept race brought into the project, and why, when the kept lane
 * is the one the cheap model suggested.
 */
export type RaceOutcome =
  | { kind: "lane"; lane: number; files: number; why?: string }
  | { kind: "mix"; files: number };

/** One lane's changes as last read: files, lines added and removed. */
export type RaceLaneStats = {
  files: number;
  additions: number;
  deletions: number;
};

/**
 * Which lane the cheap model would keep, and its one-line reason. A failed
 * suggestion is kept too, so the card can say so instead of asking again.
 */
export type RaceSuggestion =
  | { status: "running"; since: number }
  | { status: "done"; lane: number; why: string; model: string; at: number }
  | { status: "failed"; at: number };

/** The chat a race was started from, and the block its card follows. */
export type RaceOrigin = { sessionId: string; blockId: string };

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
  /** Per-file choices made so far, so reopening the overview keeps them. */
  picks?: RaceSelection;
  /** Set once kept. */
  outcome?: RaceOutcome;
  /** When the race was kept or discarded. */
  finishedAt?: number;
  /**
   * The chat the race was started from, which keeps your message and the
   * race's card. Absent for a race started from the command palette.
   */
  origin?: RaceOrigin;
  /** Each lane's changes as last read, by lane; null until read. */
  stats?: (RaceLaneStats | null)[];
  /** The cheap model's pick, once asked for. */
  suggestion?: RaceSuggestion;
};

export const RACE_MIN_LANES = 2;
export const RACE_MAX_LANES = 4;
/** Finished races kept for reopening; running ones are always kept. */
export const RACE_FINISHED_KEPT = 20;

const STORAGE_KEY = "aven.races.v1";
const CHANGE_EVENT = "aven:races-changed";

/**
 * Parsed once per storage, then kept in memory: every chat pane, tab title
 * and recent-projects check asks about races on each render. Writes here
 * replace the copy directly; another window's writes arrive as a `storage`
 * event and are read again.
 */
let cache: { storage: Storage | null; races: RaceRecord[] } | null = null;
let listening = false;

function currentStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function forgetOnOtherWindowsWrite() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key === STORAGE_KEY) cache = null;
  });
}

function read(): RaceRecord[] {
  const storage = currentStorage();
  if (cache && cache.storage === storage) return cache.races;
  forgetOnOtherWindowsWrite();
  let races: RaceRecord[] = [];
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) races = parsed.filter(isRaceRecord);
  } catch {
    races = [];
  }
  cache = { storage, races };
  return races;
}

/** Running races and the newest finished ones, in their saved order. */
export function pruneRaces(races: readonly RaceRecord[]): RaceRecord[] {
  const finished = races
    .filter((race) => race.state !== "running")
    .sort(
      (a, b) =>
        (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt) ||
        b.createdAt - a.createdAt,
    );
  const kept = new Set(finished.slice(0, RACE_FINISHED_KEPT));
  return races.filter((race) => race.state === "running" || kept.has(race));
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

function write(next: RaceRecord[]) {
  const races = pruneRaces(next);
  const storage = currentStorage();
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(races));
  } catch {
    // Storage full or unavailable: the in-memory race still works this session.
  }
  cache = { storage, races };
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function listRaces(): RaceRecord[] {
  return read();
}

export function getRace(id: string): RaceRecord | undefined {
  return read().find((race) => race.id === id);
}

/** The race and lane whose checkout is at `path`, if any. */
export function raceLaneAtPath(
  path: string,
): { race: RaceRecord; lane: RaceLaneRecord } | undefined {
  for (const race of read()) {
    const lane = race.lanes.find((item) => isEqualOrInside(path, item.path));
    if (lane) return { race, lane };
  }
  return undefined;
}

/** The race and lane a session belongs to, if it is a race agent. */
export function raceLaneFor(
  sessionId: string,
): { race: RaceRecord; lane: RaceLaneRecord } | undefined {
  for (const race of read()) {
    const lane = race.lanes.find((item) => item.sessionId === sessionId);
    if (lane) return { race, lane };
  }
  return undefined;
}

export function saveRace(race: RaceRecord) {
  write([...read().filter((item) => item.id !== race.id), race]);
}

export function updateRace(id: string, patch: Partial<RaceRecord>) {
  const races = read();
  if (!races.some((race) => race.id === id)) return;
  write(races.map((race) => (race.id === id ? { ...race, ...patch } : race)));
}

/**
 * Remember each lane's changes as last read. Writes only when a number
 * moved, so the overview's refreshes and the card's reads after each lane's
 * turn do not rewrite the record (and re-render its readers) for nothing.
 */
export function noteRaceStats(
  id: string,
  stats: ReadonlyArray<RaceDiff | undefined>,
) {
  const race = getRace(id);
  if (!race || race.state !== "running") return;
  const next = race.lanes.map((_, lane) => {
    const diff = stats[lane];
    const before = race.stats?.[lane] ?? null;
    if (!diff) return before;
    return {
      files: diff.files.length,
      additions: diff.additions,
      deletions: diff.deletions,
    };
  });
  const same = next.every((entry, lane) => {
    const before = race.stats?.[lane] ?? null;
    return (
      entry === before ||
      (!!entry &&
        !!before &&
        entry.files === before.files &&
        entry.additions === before.additions &&
        entry.deletions === before.deletions)
    );
  });
  if (!same) updateRace(id, { stats: next });
}

/** The race started from this chat's message block, if any. */
export function raceForBlock(blockId: string): RaceRecord | undefined {
  return read().find((race) => race.origin?.blockId === blockId);
}

/** All races, unchanged (the same array) until one is saved. */
export function racesSnapshot(): readonly RaceRecord[] {
  return read();
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

/** Each lane folder and the commit its race started from. */
export function raceLaneBases(): Record<string, string> {
  const bases: Record<string, string> = {};
  for (const race of read())
    for (const lane of race.lanes) bases[lane.path] = race.base;
  return bases;
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

/**
 * What to keep: one lane's whole result, or the files picked per lane. A
 * whole lane is read again once its agent has stopped, so files it wrote
 * after the overview last refreshed are kept too.
 */
export type RaceKeep = { lane: number } | { files: RaceSelection };

/** Stop every writer before reading its final diff or deleting its checkout. */
export async function finishRace(
  race: RaceRecord,
  keep: RaceKeep | null,
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
  if (keep && "files" in keep && !raceChoices(race, keep.files).length)
    throw new Error("Choose at least one file to keep.");
  if (keep && "lane" in keep && !race.lanes[keep.lane])
    throw new Error("That agent is no longer part of this race.");
  finishing.add(race.id);
  try {
    await host.settle(race);
    let outcome: RaceOutcome | undefined;
    if (keep) {
      let selection: RaceSelection;
      if ("lane" in keep) {
        // Read after the agents stopped: the last refresh can be seconds old.
        const final = await raceHost.diff(
          race.lanes[keep.lane].path,
          race.base,
        );
        selection = selectLane([final], 0);
        for (const path of Object.keys(selection)) selection[path] = keep.lane;
        const suggested = getRace(race.id)?.suggestion;
        outcome = {
          kind: "lane",
          lane: keep.lane,
          files: Object.keys(selection).length,
          // Why, when you kept the lane the cheap model would have kept.
          ...(suggested?.status === "done" && suggested.lane === keep.lane
            ? { why: suggested.why }
            : {}),
        };
      } else {
        selection = keep.files;
        outcome = { kind: "mix", files: Object.keys(selection).length };
      }
      const choices = raceChoices(race, selection);
      if (!choices.length)
        throw new Error("This agent's copy has no changes to keep.");
      await raceHost.apply(race.root, race.base, choices);
    }
    let cleanupError: string | undefined;
    try {
      await raceHost.cleanup(race.root, race.lanes);
    } catch (error) {
      cleanupError = `Copies were not all removed: ${String(error)}`;
    }
    updateRace(race.id, {
      state: keep ? "kept" : "discarded",
      error: cleanupError,
      outcome,
      finishedAt: Date.now(),
    });
    await host.release(race);
  } finally {
    finishing.delete(race.id);
  }
}

/**
 * Your message in the chat a race was sent from: kept there as you wrote
 * it, followed by the race's card. Shown only; that chat's agent never gets
 * it, since the lanes do the work.
 */
export function raceOriginBlock(
  raceId: string,
  text: string,
  attachments: readonly Attachment[] = [],
  at = Date.now(),
): Block {
  return {
    id: crypto.randomUUID(),
    role: "system",
    text,
    startedAt: at,
    team: { kind: "race", id: raceId },
    ...(attachments.length ? { attachments: [...attachments] } : {}),
  };
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
  /** Open the chat, restoring it into a tab when none holds it. */
  openChat: (sessionId: string) => void;
  /** Show the race's overview, from wherever the user is. */
  compare: (raceId: string) => void;
  /** Send the race's task to one lane's chat again, in its copy. */
  retry: (race: RaceRecord, lane: number) => void;
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
