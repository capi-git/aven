import { invoke, isTauri } from "@tauri-apps/api/core";
import { listDir } from "./fs";
import {
  harnessUnavailableHint,
  isHarnessAvailable,
  probeHarnessAvailability,
} from "./harness/availability";
import { resolveModel } from "./models";
import { isRuntimeMode, type RuntimeMode } from "./runtimeMode";
import { HARNESSES, type Block, type HarnessId } from "./session";
import {
  normalizeAutomationReview,
  type AutomationReview,
} from "./automationReview";

/**
 * A scheduled agent starts a chat on a timetable while Aven is running. The
 * chat belongs to the run: it stays inside Automations, out of the chats
 * list and the tabs, until you open it as a chat. Schedules and their run
 * history live in local storage, shared by every Aven window;
 * `claimScheduledSlot` makes sure only one window fires each due time.
 */
export type ScheduleRule =
  /** `days` are 0 (Sunday) to 6; `time` is local "HH:MM". */
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "interval"; hours: number };

export type ScheduledAgent = {
  id: string;
  name: string;
  prompt: string;
  /** Project folder; empty for an automation that is in no project. */
  project: string;
  harness: HarnessId;
  model: string;
  runtimeMode: RuntimeMode;
  schedule: ScheduleRule;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  /** Epoch ms of the next due time; null when the rule never fires. */
  nextRunAt: number | null;
};

export type ScheduledRunStatus =
  "running" | "completed" | "failed" | "cancelled";

export type ScheduledRun = {
  id: string;
  scheduleId: string;
  name: string;
  project: string;
  /** Absent when the run could not start. */
  sessionId?: string;
  status: ScheduledRunStatus;
  summary: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /**
   * When its latest turn started: the run's own, or a later one sent from
   * its card. A turn is given up on four hours after this, not after the
   * run started.
   */
  turnStartedAt?: number;
  /**
   * The run's chat stays in Automations: set on every run started since runs
   * stayed there. Runs from before keep their chats where they were, among
   * the project's chats.
   */
  inAutomations?: true;
  /**
   * You chose Open as chat: the run's chat is an ordinary chat from then on,
   * listed with the project's chats. Until then it is the run's alone.
   */
  openedAsChat?: true;
  /** Something the run left for you to review or publish (the Inbox card). */
  review?: AutomationReview;
};

export const SCHEDULE_MIN_HOURS = 1;
export const SCHEDULE_MAX_HOURS = 24;
/** Runs kept in all, and for each automation; older ones are let go. */
export const SCHEDULED_RUN_LIMIT = 300;
export const SCHEDULED_RUNS_PER_AUTOMATION = 50;
export const SCHEDULED_SUMMARY_LIMIT = 600;
/** A run that has not settled after this long is recorded as failed. */
export const SCHEDULED_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];

const HOUR_MS = 60 * 60 * 1000;
const TIME = /^(\d{2}):(\d{2})$/;

// ---------------------------------------------------------------------------
// Timing

function parseTime(time: string): { hours: number; minutes: number } | null {
  const match = TIME.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * The first due time strictly after `from`, in local time. A weekly time that
 * falls in a daylight-saving gap runs at the shifted wall time that day; a
 * repeated hour runs once, at its first occurrence.
 */
export function nextRunAt(schedule: ScheduleRule, from: Date): number | null {
  if (schedule.kind === "interval") {
    return from.getTime() + clampHours(schedule.hours) * HOUR_MS;
  }
  const time = parseTime(schedule.time);
  const days = new Set(schedule.days);
  if (!time || days.size === 0) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
      time.hours,
      time.minutes,
    );
    if (days.has(candidate.getDay()) && candidate.getTime() > from.getTime())
      return candidate.getTime();
  }
  return null;
}

/**
 * The due time after one that has just fired. Due times missed while Aven was
 * closed are skipped rather than replayed, so a late check runs at most once.
 */
export function followingRunAt(
  schedule: ScheduleRule,
  dueAt: number,
  now: number,
): number | null {
  if (schedule.kind === "interval") {
    const step = clampHours(schedule.hours) * HOUR_MS;
    const missed = Math.max(0, Math.floor((now - dueAt) / step));
    return dueAt + (missed + 1) * step;
  }
  return nextRunAt(schedule, new Date(Math.max(dueAt, now)));
}

function clampHours(hours: number): number {
  if (!Number.isFinite(hours)) return SCHEDULE_MIN_HOURS;
  return Math.min(
    SCHEDULE_MAX_HOURS,
    Math.max(SCHEDULE_MIN_HOURS, Math.round(hours)),
  );
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAY_LABELS = DAY_NAMES;

function sameDays(days: number[], expected: number[]): boolean {
  return (
    days.length === expected.length &&
    expected.every((day) => days.includes(day))
  );
}

/** "Weekdays at 09:00", "Every 3 hours". */
export function describeSchedule(schedule: ScheduleRule): string {
  if (schedule.kind === "interval") {
    const hours = clampHours(schedule.hours);
    return hours === 1 ? "Every hour" : `Every ${hours} hours`;
  }
  if (schedule.days.length === 0) return "No days selected";
  const days = sameDays(schedule.days, EVERY_DAY)
    ? "Every day"
    : sameDays(schedule.days, WEEKDAYS)
      ? "Weekdays"
      : [...schedule.days]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((day) => DAY_NAMES[day])
          .join(", ");
  return `${days} at ${schedule.time}`;
}

/** "Today 09:00", "Tomorrow 14:30", "Mon 3 Nov 09:00". */
export function formatRunTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const days = Math.round((startOfDay - startOfToday) / (24 * HOUR_MS));
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} ${time}`;
}

// ---------------------------------------------------------------------------
// Stored data

export function normalizeScheduleRule(value: unknown): ScheduleRule | null {
  if (!value || typeof value !== "object") return null;
  const rule = value as Record<string, unknown>;
  if (rule.kind === "interval") {
    if (typeof rule.hours !== "number") return null;
    return { kind: "interval", hours: clampHours(rule.hours) };
  }
  if (rule.kind !== "weekly") return null;
  if (typeof rule.time !== "string" || !parseTime(rule.time)) return null;
  const days = Array.isArray(rule.days)
    ? [
        ...new Set(
          rule.days.filter(
            (day): day is number =>
              Number.isInteger(day) && day >= 0 && day <= 6,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];
  return { kind: "weekly", days, time: rule.time };
}

export function normalizeScheduledAgent(value: unknown): ScheduledAgent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const schedule = normalizeScheduleRule(item.schedule);
  if (
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.name !== "string" ||
    typeof item.prompt !== "string" ||
    typeof item.project !== "string" ||
    typeof item.model !== "string" ||
    !HARNESSES.includes(item.harness as HarnessId) ||
    !schedule
  )
    return null;
  const finite = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : undefined;
  const lastRunAt = finite(item.lastRunAt);
  const next = finite(item.nextRunAt);
  return {
    id: item.id,
    name: item.name,
    prompt: item.prompt,
    project: item.project,
    harness: item.harness as HarnessId,
    model: item.model,
    runtimeMode: isRuntimeMode(item.runtimeMode)
      ? item.runtimeMode
      : "supervised",
    schedule,
    enabled: item.enabled !== false,
    createdAt: finite(item.createdAt) ?? 0,
    ...(lastRunAt != null ? { lastRunAt } : {}),
    nextRunAt:
      next ??
      (schedule.kind === "weekly" && schedule.days.length === 0
        ? null
        : nextRunAt(schedule, new Date())),
  };
}

const RUN_STATUSES: ScheduledRunStatus[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
];

export function normalizeScheduledRun(value: unknown): ScheduledRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Record<string, unknown>;
  if (
    typeof run.id !== "string" ||
    !run.id ||
    typeof run.scheduleId !== "string" ||
    typeof run.name !== "string" ||
    typeof run.project !== "string" ||
    !RUN_STATUSES.includes(run.status as ScheduledRunStatus) ||
    typeof run.startedAt !== "number" ||
    !Number.isFinite(run.startedAt)
  )
    return null;
  const review = normalizeAutomationReview(run.review);
  return {
    id: run.id,
    scheduleId: run.scheduleId,
    name: run.name,
    project: run.project,
    ...(typeof run.sessionId === "string" && run.sessionId
      ? { sessionId: run.sessionId }
      : {}),
    status: run.status as ScheduledRunStatus,
    summary: typeof run.summary === "string" ? run.summary : "",
    ...(typeof run.error === "string" && run.error ? { error: run.error } : {}),
    startedAt: run.startedAt,
    ...(typeof run.finishedAt === "number" && Number.isFinite(run.finishedAt)
      ? { finishedAt: run.finishedAt }
      : {}),
    ...(typeof run.turnStartedAt === "number" &&
    Number.isFinite(run.turnStartedAt)
      ? { turnStartedAt: run.turnStartedAt }
      : {}),
    ...(run.inAutomations === true ? { inAutomations: true as const } : {}),
    ...(run.openedAsChat === true ? { openedAsChat: true as const } : {}),
    ...(review ? { review } : {}),
  };
}

/**
 * Newest first: at most `SCHEDULED_RUNS_PER_AUTOMATION` runs kept in
 * Automations for each automation, so a busy one never pushes a quiet one's
 * runs out, and at most `SCHEDULED_RUN_LIMIT` in all. A run still running,
 * or with a card waiting for you, is always kept. Runs from before runs
 * stayed in Automations count only towards the overall limit, which is
 * above the 100 an earlier Aven kept.
 */
export function trimScheduledRuns(
  runs: readonly ScheduledRun[],
): ScheduledRun[] {
  const perAutomation = new Map<string, number>();
  const kept: ScheduledRun[] = [];
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const pinned = run.status === "running" || run.review?.status === "open";
    const count = perAutomation.get(run.scheduleId) ?? 0;
    if (
      !pinned &&
      ((run.inAutomations && count >= SCHEDULED_RUNS_PER_AUTOMATION) ||
        kept.length >= SCHEDULED_RUN_LIMIT)
    )
      continue;
    if (run.inAutomations) perAutomation.set(run.scheduleId, count + 1);
    kept.push(run);
  }
  return kept;
}

/** The opening of the agent's final reply, short enough for a list. */
export function runSummary(
  text: string,
  limit = SCHEDULED_SUMMARY_LIMIT,
): string {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.search(/\s\S*$/);
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The last visible assistant message of a turn. */
export function finalAssistantText(blocks: readonly Block[]): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.role === "user" && !block.internal) break;
    if (block.role === "assistant" && !block.internal && block.text.trim())
      return block.text;
  }
  return "";
}

type Store<T> = {
  read: () => T[];
  write: (items: T[]) => void;
  subscribe: (listener: () => void) => () => void;
};

function createStore<T>(
  key: string,
  event: string,
  normalize: (value: unknown) => T | null,
): Store<T> {
  let cache: { raw: string | null; items: T[] } | null = null;
  return {
    read() {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        raw = null;
      }
      if (cache && cache.raw === raw) return cache.items;
      let items: T[] = [];
      try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed))
          items = parsed
            .map(normalize)
            .filter((item): item is T => item != null);
      } catch {
        items = [];
      }
      cache = { raw, items };
      return items;
    },
    write(items) {
      try {
        localStorage.setItem(key, JSON.stringify(items));
      } catch {
        // Storage full or unavailable: nothing else to fall back to.
      }
      cache = null;
      window.dispatchEvent(new Event(event));
    },
    subscribe(listener) {
      const onStorage = (storage: StorageEvent) => {
        if (!storage.key || storage.key === key) {
          cache = null;
          listener();
        }
      };
      window.addEventListener(event, listener);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(event, listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

const schedules = createStore(
  "aven.scheduledAgents.v1",
  "aven:scheduled-agents-changed",
  normalizeScheduledAgent,
);
const runs = createStore(
  "aven.scheduledRuns.v1",
  "aven:scheduled-runs-changed",
  normalizeScheduledRun,
);

export function listScheduledAgents(): ScheduledAgent[] {
  return schedules.read();
}

export function getScheduledAgent(id: string): ScheduledAgent | undefined {
  return schedules.read().find((item) => item.id === id);
}

export function saveScheduledAgent(agent: ScheduledAgent) {
  const all = schedules.read();
  schedules.write(
    all.some((item) => item.id === agent.id)
      ? all.map((item) => (item.id === agent.id ? agent : item))
      : [...all, agent],
  );
}

export function updateScheduledAgent(
  id: string,
  patch: Partial<ScheduledAgent>,
) {
  const all = schedules.read();
  if (!all.some((item) => item.id === id)) return;
  schedules.write(
    all.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  );
}

export function deleteScheduledAgent(id: string) {
  schedules.write(schedules.read().filter((item) => item.id !== id));
}

/** Turning a schedule back on starts from now, never from a stale due time. */
export function setScheduledAgentEnabled(
  id: string,
  enabled: boolean,
  now = Date.now(),
) {
  const agent = getScheduledAgent(id);
  if (!agent) return;
  updateScheduledAgent(id, {
    enabled,
    nextRunAt: enabled
      ? nextRunAt(agent.schedule, new Date(now))
      : agent.nextRunAt,
  });
}

export const subscribeScheduledAgents = schedules.subscribe;

let sortedRuns: { source: ScheduledRun[]; runs: ScheduledRun[] } | null = null;

/** Newest first. The same array is returned until the store changes. */
export function listScheduledRuns(): ScheduledRun[] {
  const source = runs.read();
  if (sortedRuns?.source !== source)
    sortedRuns = { source, runs: trimScheduledRuns(source) };
  return sortedRuns.runs;
}

export function getScheduledRun(id: string): ScheduledRun | undefined {
  return runs.read().find((run) => run.id === id);
}

type TrimmedRunsListener = (runs: ScheduledRun[]) => void;
const trimmedRunListeners = new Set<TrimmedRunsListener>();

/**
 * Called with the runs a save let go. Their chats lose the run that held
 * them; the workspace archives them rather than let them reappear among
 * the project's chats.
 */
export function onScheduledRunsTrimmed(listener: TrimmedRunsListener) {
  trimmedRunListeners.add(listener);
  return () => void trimmedRunListeners.delete(listener);
}

export function saveScheduledRun(run: ScheduledRun) {
  const all = [...runs.read().filter((item) => item.id !== run.id), run];
  const kept = trimScheduledRuns(all);
  runs.write(kept);
  if (kept.length === all.length) return;
  const ids = new Set(kept.map((item) => item.id));
  const dropped = all.filter((item) => !ids.has(item.id));
  for (const listener of trimmedRunListeners) listener(dropped);
}

export function updateScheduledRun(id: string, patch: Partial<ScheduledRun>) {
  const all = runs.read();
  if (!all.some((run) => run.id === id)) return;
  runs.write(all.map((run) => (run.id === id ? { ...run, ...patch } : run)));
}

export const subscribeScheduledRuns = runs.subscribe;

/** A run whose chat is still its own, in Automations. */
export function holdsChat(
  run: ScheduledRun,
): run is ScheduledRun & { sessionId: string } {
  return !!run.sessionId && !!run.inAutomations && !run.openedAsChat;
}

/**
 * The run that holds a chat, while the chat is still the run's: it stays in
 * Automations and out of the chats list and the tabs. Undefined for every
 * other chat, including a run's chat you opened as a chat and the chats of
 * runs from before runs stayed in Automations, which stay ordinary chats.
 */
export function automationRunForChat(
  sessionId: string | undefined,
  all: readonly ScheduledRun[] = listScheduledRuns(),
): ScheduledRun | undefined {
  if (!sessionId) return undefined;
  return all.find((run) => run.sessionId === sessionId && holdsChat(run));
}

let chatIds: { source: ScheduledRun[]; ids: ReadonlySet<string> } | null = null;

/**
 * Chats that belong to automation runs, kept out of chat lists, Home and
 * the palette. The chats of runs from before runs stayed in Automations are
 * not among them: they stay where they were, and their runs are listed under
 * their automation as well. The same set is returned until the runs change.
 */
export function automationChatIds(): ReadonlySet<string> {
  const source = listScheduledRuns();
  if (chatIds?.source !== source)
    chatIds = {
      source,
      ids: new Set(
        source.flatMap((run) => (holdsChat(run) ? [run.sessionId] : [])),
      ),
    };
  return chatIds.ids;
}

/** Rows (chats) with the automation runs' own chats left out. */
export function withoutAutomationChats<T extends { id: string }>(
  rows: readonly T[],
  hidden: ReadonlySet<string> = automationChatIds(),
): T[] {
  return hidden.size ? rows.filter((row) => !hidden.has(row.id)) : [...rows];
}

/**
 * The chats a save let go of that should be archived: chats that were their
 * run's own, that no run still holds, and that are not open anywhere (a tab,
 * or loaded for a turn). A chat from before runs stayed in Automations, or
 * one opened as a chat, is never archived.
 */
export function chatsToArchive(
  dropped: readonly ScheduledRun[],
  open: ReadonlySet<string>,
  held: ReadonlySet<string> = automationChatIds(),
): string[] {
  return [
    ...new Set(
      dropped.flatMap((run) =>
        holdsChat(run) && !held.has(run.sessionId) && !open.has(run.sessionId)
          ? [run.sessionId]
          : [],
      ),
    ),
  ];
}

/**
 * The Activity row for a run's notice when the run has no chat to point at
 * (it could not start): its id names the run, and opening it shows the run.
 */
const NOTICE_CHAT = "aven-automation-run-";
export function automationNoticeChatId(runId: string): string {
  return `${NOTICE_CHAT}${runId}`;
}
export function runIdOfNoticeChat(sessionId: string): string | undefined {
  return sessionId.startsWith(NOTICE_CHAT)
    ? sessionId.slice(NOTICE_CHAT.length) || undefined
    : undefined;
}

/**
 * The run that opening a chat (from any list, Activity or a banner) should
 * show in Automations instead: the run whose own chat it is, or the run a
 * notice names. Undefined for every other chat.
 */
export function automationRunTarget(sessionId: string): string | undefined {
  return runIdOfNoticeChat(sessionId) ?? automationRunForChat(sessionId)?.id;
}

/** Open as chat: from now on the run's chat is listed with the others. */
export function markRunOpenedAsChat(id: string) {
  updateScheduledRun(id, { openedAsChat: true });
}

/** Done (you acted on it) or dismissed: the card leaves the Inbox. */
export function resolveRunReview(
  id: string,
  status: "done" | "dismissed",
  now = Date.now(),
) {
  const run = getScheduledRun(id);
  if (!run?.review || run.review.status !== "open") return;
  updateScheduledRun(id, {
    review: { ...run.review, status, resolvedAt: now },
  });
}

/** Runs with a card waiting in the Inbox, newest card first. */
export function openReviewRuns(
  all: readonly ScheduledRun[] = listScheduledRuns(),
): ScheduledRun[] {
  return all
    .filter((run) => run.review?.status === "open")
    .sort((a, b) => b.review!.postedAt - a.review!.postedAt);
}

/**
 * Read state key and timestamp in the shared seen store (the key predates the
 * Automations view, so it keeps its "scheduled:" prefix); a finished run reads
 * as new again.
 */
export function scheduledRunSeenEntry(run: ScheduledRun) {
  return {
    key: `scheduled:${run.id}`,
    updatedAt: new Date(run.finishedAt ?? run.startedAt).toISOString(),
  };
}

/**
 * Mark runs nobody will settle (a closed window, a lost turn) as failed,
 * four hours after their latest turn started. Returns the runs it failed.
 */
export function expireStaleScheduledRuns(now = Date.now()): ScheduledRun[] {
  return failRunningRuns(
    (run) =>
      now - (run.turnStartedAt ?? run.startedAt) >= SCHEDULED_RUN_TIMEOUT_MS,
    "Aven stopped waiting for this run. Open it to see where it got to.",
    now,
  );
}

/**
 * Mark runs whose latest turn started before this window loaded as failed:
 * Aven quit during them, so nothing will settle them. Only the first window
 * of a launch asks, so a run another window is taking is left alone.
 * Returns the runs it failed.
 */
export function failInterruptedScheduledRuns(
  loadedAt: number,
  now = Date.now(),
): ScheduledRun[] {
  return failRunningRuns(
    (run) => (run.turnStartedAt ?? run.startedAt) < loadedAt,
    "Interrupted when Aven quit. Open it to see where it got to.",
    now,
  );
}

function failRunningRuns(
  due: (run: ScheduledRun) => boolean,
  error: string,
  now: number,
): ScheduledRun[] {
  const all = runs.read();
  const stale = all.filter((run) => run.status === "running" && due(run));
  if (!stale.length) return [];
  const failed = new Map(
    stale.map((run) => [
      run.id,
      { ...run, status: "failed" as const, finishedAt: now, error },
    ]),
  );
  runs.write(all.map((run) => failed.get(run.id) ?? run));
  return [...failed.values()];
}

// ---------------------------------------------------------------------------
// Firing

/**
 * Several Aven windows check the same schedules. The host records each due
 * slot once per process, so only the first window to ask runs it.
 */
export async function claimScheduledSlot(slot: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke<boolean>("scheduled_agent_claim", { slot });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Keeping the computer awake

const KEEP_AWAKE_KEY = "aven.automations.keepAwake";
const KEEP_AWAKE_EVENT = "aven:automations-keep-awake-changed";

export function loadKeepAwake(): boolean {
  try {
    return localStorage.getItem(KEEP_AWAKE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveKeepAwake(on: boolean) {
  try {
    if (on) localStorage.setItem(KEEP_AWAKE_KEY, "1");
    else localStorage.removeItem(KEEP_AWAKE_KEY);
  } catch {
    // Storage unavailable: the switch falls back to off.
  }
  window.dispatchEvent(new Event(KEEP_AWAKE_EVENT));
}

export function subscribeKeepAwake(listener: () => void) {
  const onStorage = (storage: StorageEvent) => {
    if (!storage.key || storage.key === KEEP_AWAKE_KEY) listener();
  };
  window.addEventListener(KEEP_AWAKE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(KEEP_AWAKE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Only worth holding off sleep while something is waiting to run. */
export function wantsKeepAwake(
  on: boolean,
  agents: readonly ScheduledAgent[],
): boolean {
  return on && agents.some((agent) => agent.enabled);
}

export async function setSystemKeepAwake(enabled: boolean) {
  if (!isTauri()) return;
  try {
    await invoke("scheduled_agents_keep_awake", { enabled });
  } catch {
    // An older host without the command just sleeps as before.
  }
}

export type ScheduledAgentChecks = {
  probe: () => Promise<void>;
  installed: (harness: HarnessId) => boolean;
  folderExists: (path: string) => Promise<boolean>;
};

const defaultChecks: ScheduledAgentChecks = {
  probe: () => probeHarnessAvailability(),
  installed: isHarnessAvailable,
  folderExists: (path) =>
    listDir(path).then(
      () => true,
      () => false,
    ),
};

/**
 * Why a schedule cannot start right now, or null when it can. `folder` is
 * where it runs: its project, or the chats folder for one in no project.
 */
export async function scheduledAgentProblem(
  agent: ScheduledAgent,
  checks: ScheduledAgentChecks = defaultChecks,
  folder = agent.project,
): Promise<string | null> {
  if (!agent.prompt.trim()) return "This schedule has no prompt.";
  try {
    await checks.probe();
  } catch {
    // Fall through with whatever availability is already known.
  }
  if (!checks.installed(agent.harness))
    return harnessUnavailableHint(agent.harness);
  if (resolveModel(agent.harness, agent.model).harness !== agent.harness)
    return "The chosen model is no longer available. Edit the schedule to pick another.";
  if (!folder || !(await checks.folderExists(folder)))
    return agent.project
      ? `The project folder ${agent.project} could not be opened.`
      : "The folder for chats outside a project could not be opened.";
  return null;
}

export type DueCheck = {
  now: number;
  claim: (slot: string) => Promise<boolean>;
  fire: (agent: ScheduledAgent) => void;
  /** Runs given up on in this check, to tell you about. */
  expired?: (runs: ScheduledRun[]) => void;
};

/**
 * Fire every enabled schedule whose due time has passed, once. The next due
 * time is written before the agent starts, so a slow start or another
 * window's check cannot run it twice.
 */
export async function runDueScheduledAgents({
  now,
  claim,
  fire,
  expired,
}: DueCheck): Promise<number> {
  const given = expireStaleScheduledRuns(now);
  if (given.length) expired?.(given);
  let fired = 0;
  for (const agent of listScheduledAgents()) {
    const dueAt = agent.nextRunAt;
    if (!agent.enabled || dueAt == null || dueAt > now) continue;
    if (!(await claim(`${agent.id}:${dueAt}`))) continue;
    const current = getScheduledAgent(agent.id);
    if (!current?.enabled || current.nextRunAt !== dueAt) continue;
    updateScheduledAgent(agent.id, {
      lastRunAt: now,
      nextRunAt: followingRunAt(current.schedule, dueAt, now),
    });
    fire(current);
    fired += 1;
  }
  return fired;
}

// ---------------------------------------------------------------------------
// Requests the Automations view takes when it opens, or at once when it is
// open: a blank automation (from the palette, or a folder's +), or one run
// (an Activity entry, the Inbox card, a notification for a run's chat).

export type AutomationsRequest =
  { kind: "new"; project?: string } | { kind: "run"; runId: string };

const VIEW_REQUEST = "aven:scheduled-agent-editor";
let pendingRequest: AutomationsRequest | null = null;

function request(next: AutomationsRequest) {
  pendingRequest = next;
  window.dispatchEvent(new Event(VIEW_REQUEST));
}

/** A blank automation, in `project` when given. */
export function requestScheduleEditor(project?: string) {
  request(project === undefined ? { kind: "new" } : { kind: "new", project });
}

/** One run's conversation, under its automation. */
export function requestAutomationRun(runId: string) {
  request({ kind: "run", runId });
}

/** The pending request, once. */
export function takeAutomationsRequest(): AutomationsRequest | null {
  const taken = pendingRequest;
  pendingRequest = null;
  return taken;
}

export function subscribeAutomationsRequest(listener: () => void) {
  window.addEventListener(VIEW_REQUEST, listener);
  return () => window.removeEventListener(VIEW_REQUEST, listener);
}
