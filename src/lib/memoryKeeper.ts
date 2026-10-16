import { formatLineDiff } from "./memoryKeeperFormat";
import { projectMemoryKey } from "./projectMemory";
import { normalizeProjectPath } from "./recents";
import type { RateLimitProvider } from "./rateLimits";
import type { UsageForecastSnapshot } from "./usageHistory";

/**
 * The memory keeper: with the user's consent, Aven fills a project's memory
 * once the project gets going and keeps its own sections current. This module
 * holds each project's consent, what the keeper last wrote, its last change
 * (for the note and Undo) and the rules for when it may run. Every window
 * shares it through storage.
 */

export const MEMORY_KEEPER_KEY = "aven.memoryKeeper.v1";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An update runs after this many finished turns in the project… */
export const KEEPER_TURN_BATCH = 8;
/** …or once a day when the project was used since the last pass. */
export const KEEPER_DAILY_MS = DAY;
/** Never more than one pass an hour per project, whether it worked or not. */
export const KEEPER_MIN_INTERVAL_MS = HOUR;
/** A pass that started longer ago than this is taken to have died with its window. */
export const KEEPER_RUN_LEASE_MS = 5 * MINUTE;
/** A provider window this full counts as near its limit. */
export const KEEPER_USAGE_CEILING = 90;
/** The last change shows as new in the sidebar for this long. */
export const KEEPER_NOTE_MS = DAY;

export type KeeperKind = "fill" | "update";

export type KeeperChange = {
  at: number;
  kind: KeeperKind;
  added: number;
  removed: number;
  /** The whole memory before the change, for Undo. */
  before: string;
  /** The keeper's block before the change; restored by Undo. */
  baselineBefore: string | null;
  /** The memory version the change produced. */
  updatedAt: number;
  /** The user has opened the memory since. */
  seen: boolean;
  undone?: boolean;
};

export type KeeperProject = {
  /** The project's folder, for passes started from the stored list. */
  path?: string;
  /** Unset until the user answers; "off" also after Not now. */
  consent?: "on" | "off";
  /** When Aven offered to keep the memory; shown until answered. */
  offeredAt?: number;
  /** When the user turned it on; turns are counted from here at first. */
  enabledAt?: number;
  /** The keeper's block as it last wrote it. */
  baseline?: string;
  /** The last pass that finished, written or not. */
  lastRunAt?: number;
  /** The last pass that started, finished or failed. */
  lastAttemptAt?: number;
  running?: { since: number; owner: string };
  /** A short reason the last pass failed; cleared by the next success. */
  lastError?: string;
  /** "Claude · Haiku 4.5" */
  model?: string;
  change?: KeeperChange;
  /** A pass the user asked for (Turn on, Refresh now), for whichever window runs it. */
  requested?: { at: number; manual: boolean };
};

type Store = { version: 1; projects: Record<string, KeeperProject> };

const EMPTY_STORE: Store = { version: 1, projects: {} };
const EMPTY_PROJECT: KeeperProject = Object.freeze({});
const PROJECT_LIMIT = 200;

let cache: Store = EMPTY_STORE;
let cacheRaw: string | null | undefined;
const listeners = new Set<() => void>();

function parse(raw: string | null): Store {
  if (!raw) return EMPTY_STORE;
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (
      parsed?.version !== 1 ||
      !parsed.projects ||
      typeof parsed.projects !== "object"
    )
      return EMPTY_STORE;
    return { version: 1, projects: parsed.projects };
  } catch {
    return EMPTY_STORE;
  }
}

function read(): Store {
  let raw: string | null;
  try {
    raw = localStorage.getItem(MEMORY_KEEPER_KEY);
  } catch {
    return cache;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = parse(raw);
  }
  return cache;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function write(store: Store) {
  // Keep the projects touched most recently; old ones lose nothing important.
  const entries = Object.entries(store.projects);
  if (entries.length > PROJECT_LIMIT) {
    const touched = (project: KeeperProject) =>
      Math.max(
        project.lastAttemptAt ?? 0,
        project.offeredAt ?? 0,
        project.enabledAt ?? 0,
      );
    entries.sort(([, a], [, b]) => touched(b) - touched(a));
    store = {
      version: 1,
      projects: Object.fromEntries(entries.slice(0, PROJECT_LIMIT)),
    };
  }
  const raw = JSON.stringify(store);
  cache = store;
  try {
    localStorage.setItem(MEMORY_KEEPER_KEY, raw);
    cacheRaw = raw;
  } catch {
    // Without storage the keeper still works in this window until it closes.
  }
  emit();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== MEMORY_KEEPER_KEY) return;
  read();
  emit();
}

export function subscribeMemoryKeeper(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

/** Stable while nothing changes, so it can back `useSyncExternalStore`. */
export function getKeeperProject(path: string): KeeperProject {
  return read().projects[projectMemoryKey(path)] ?? EMPTY_PROJECT;
}

/** Every project the keeper knows, keyed by `projectMemoryKey`. */
export function keeperProjects(): Readonly<Record<string, KeeperProject>> {
  return read().projects;
}

export function updateKeeperProject(
  path: string,
  update: (project: KeeperProject) => KeeperProject,
): KeeperProject {
  const store = read();
  const key = projectMemoryKey(path);
  const current = store.projects[key] ?? EMPTY_PROJECT;
  const updated = update(current);
  if (updated === current) return current;
  const folder = normalizeProjectPath(path);
  const next = updated.path === folder ? updated : { ...updated, path: folder };
  write({ version: 1, projects: { ...store.projects, [key]: next } });
  return next;
}

/** Test seam. */
export function resetMemoryKeeperCache() {
  cache = EMPTY_STORE;
  cacheRaw = undefined;
}

/** Ask once: the first time the project is worked in while its memory is empty. */
export function offerMemoryKeeper(path: string, now = Date.now()) {
  updateKeeperProject(path, (project) =>
    project.consent || project.offeredAt
      ? project
      : { ...project, offeredAt: now },
  );
}

/** True while the offer waits for an answer. */
export function keeperOfferPending(project: KeeperProject): boolean {
  return !project.consent && project.offeredAt != null;
}

/**
 * Turn keeping on or off. Turning it on asks for a pass straight away
 * (it fills the memory when the keeper has nothing there yet).
 */
export function setMemoryKeeper(path: string, on: boolean, now = Date.now()) {
  updateKeeperProject(path, (project) =>
    on
      ? {
          ...project,
          consent: "on",
          enabledAt: project.consent === "on" ? project.enabledAt : now,
          offeredAt: undefined,
          requested: { at: now, manual: false },
        }
      : {
          ...project,
          consent: "off",
          offeredAt: undefined,
          requested: undefined,
        },
  );
}

/** Refresh now: a full pass, outside the hourly limit. */
export function requestKeeperRefresh(path: string, now = Date.now()) {
  updateKeeperProject(path, (project) =>
    project.consent === "on"
      ? { ...project, requested: { at: now, manual: true } }
      : project,
  );
}

/** A request that will not run (keeping is off, nothing to do) is dropped. */
export function clearKeeperRequest(path: string) {
  updateKeeperProject(path, (project) =>
    project.requested ? { ...project, requested: undefined } : project,
  );
}

export function markKeeperChangeSeen(path: string) {
  updateKeeperProject(path, (project) =>
    project.change && !project.change.seen
      ? { ...project, change: { ...project.change, seen: true } }
      : project,
  );
}

/** The change to show in the sidebar: recent, not undone and not yet seen. */
export function unseenKeeperChange(
  project: KeeperProject,
  now: number,
): KeeperChange | null {
  const change = project.change;
  if (!change || change.seen || change.undone) return null;
  return now - change.at <= KEEPER_NOTE_MS ? change : null;
}

export type KeeperSkip =
  | "off"
  | "running"
  | "no-model"
  | "busy"
  | "usage"
  | "hourly"
  | "removed"
  | "nothing-new";

export type KeeperDecision = { run: KeeperKind } | { skip: KeeperSkip };

/**
 * Whether a pass runs now, and which. A pass needs consent, a model, an idle
 * project and a provider with room to spare; it runs at most once an hour.
 * With no keeper section yet it fills; afterwards it updates after
 * `KEEPER_TURN_BATCH` finished turns, or a day after the last pass once the
 * project was used. What the user asks for runs sooner: Refresh now
 * (`manual`) fills again, and turning keeping on (`requested`) fills an empty
 * memory, both outside the hourly limit and the usage check. Nothing runs
 * while an agent works in the project.
 */
export function keeperDecision(input: {
  project: KeeperProject;
  /** The memory holds the keeper's block. */
  hasBlock: boolean;
  /** Finished turns in the project since the last pass. */
  turnsSince: number;
  now: number;
  projectBusy: boolean;
  nearLimit: boolean;
  modelAvailable: boolean;
  manual?: boolean;
  requested?: boolean;
}): KeeperDecision {
  const { project, now, hasBlock } = input;
  if (project.consent !== "on") return { skip: "off" };
  if (
    project.running &&
    now - project.running.since >= 0 &&
    now - project.running.since < KEEPER_RUN_LEASE_MS
  )
    return { skip: "running" };
  if (!input.modelAvailable) return { skip: "no-model" };
  if (input.projectBusy) return { skip: "busy" };
  if (input.manual || (input.requested && !hasBlock)) return { run: "fill" };
  if (input.nearLimit) return { skip: "usage" };
  if (
    project.lastAttemptAt != null &&
    now - project.lastAttemptAt < KEEPER_MIN_INTERVAL_MS
  )
    return { skip: "hourly" };
  // The user removed the keeper's sections: they are not put back.
  if (!hasBlock)
    return project.baseline ? { skip: "removed" } : { run: "fill" };
  if (input.turnsSince >= KEEPER_TURN_BATCH) return { run: "update" };
  const since = project.lastRunAt ?? project.enabledAt ?? 0;
  if (input.turnsSince > 0 && now - since >= KEEPER_DAILY_MS)
    return { run: "update" };
  return { skip: "nothing-new" };
}

/**
 * Whether the provider is close to a usage limit: Aven's own forecast warns,
 * or a window it last read is at least `KEEPER_USAGE_CEILING` percent full
 * and has not reset since.
 */
export function providerNearLimit(
  provider: RateLimitProvider,
  forecasts: UsageForecastSnapshot,
  now: number,
): boolean {
  if (forecasts.warnings[provider]) return true;
  const latest = forecasts.providers[provider]?.latest ?? {};
  return Object.values(latest).some(
    (sample) =>
      sample != null &&
      sample.used >= KEEPER_USAGE_CEILING &&
      (sample.resetsAt == null || sample.resetsAt > now),
  );
}

/** "2 h ago" style, shared by the editor and the sidebar note. */
export function keeperAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Updated by Aven 2 h ago · +2 −1 lines" */
export function keeperChangeText(change: KeeperChange, now: number): string {
  return `Updated by Aven ${keeperAgo(change.at, now)} · ${formatLineDiff(change)}`;
}

/** The sidebar row's tooltip line for a change made within the last day. */
export function keeperRowNote(project: KeeperProject, now: number): string {
  const change = project.change;
  if (!change || change.undone || now - change.at > KEEPER_NOTE_MS) return "";
  return `Memory updated by Aven ${keeperAgo(change.at, now)} (${formatLineDiff(change)})`;
}
