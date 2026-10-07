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

/**
 * A scheduled agent starts an ordinary chat on a timetable while Aven is
 * running. Schedules and their run history live in local storage, shared by
 * every Aven window; `claimScheduledSlot` makes sure only one window fires
 * each due time.
 */
export type ScheduleRule =
  /** `days` are 0 (Sunday) to 6; `time` is local "HH:MM". */
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "interval"; hours: number };

export type ScheduledAgent = {
  id: string;
  name: string;
  prompt: string;
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
};

export const SCHEDULE_MIN_HOURS = 1;
export const SCHEDULE_MAX_HOURS = 24;
export const SCHEDULED_RUN_LIMIT = 100;
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
  };
}

/** Newest first, at most `SCHEDULED_RUN_LIMIT`. */
export function trimScheduledRuns(
  runs: readonly ScheduledRun[],
): ScheduledRun[] {
  return [...runs]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, SCHEDULED_RUN_LIMIT);
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

export function saveScheduledRun(run: ScheduledRun) {
  runs.write(
    trimScheduledRuns([
      ...runs.read().filter((item) => item.id !== run.id),
      run,
    ]),
  );
}

export function updateScheduledRun(id: string, patch: Partial<ScheduledRun>) {
  const all = runs.read();
  if (!all.some((run) => run.id === id)) return;
  runs.write(all.map((run) => (run.id === id ? { ...run, ...patch } : run)));
}

export const subscribeScheduledRuns = runs.subscribe;

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

/** Mark runs nobody will settle (a closed window, a lost turn) as failed. */
export function expireStaleScheduledRuns(now = Date.now()) {
  const all = runs.read();
  const stale = all.filter(
    (run) =>
      run.status === "running" &&
      now - run.startedAt >= SCHEDULED_RUN_TIMEOUT_MS,
  );
  if (!stale.length) return;
  const ids = new Set(stale.map((run) => run.id));
  runs.write(
    all.map((run) =>
      ids.has(run.id)
        ? {
            ...run,
            status: "failed" as const,
            finishedAt: now,
            error:
              "Aven stopped waiting for this run. Open the chat to see where it got to.",
          }
        : run,
    ),
  );
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

/** Why a schedule cannot start right now, or null when it can. */
export async function scheduledAgentProblem(
  agent: ScheduledAgent,
  checks: ScheduledAgentChecks = defaultChecks,
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
  if (!agent.project || !(await checks.folderExists(agent.project)))
    return `The project folder ${agent.project || "(none)"} could not be opened.`;
  return null;
}

export type DueCheck = {
  now: number;
  claim: (slot: string) => Promise<boolean>;
  fire: (agent: ScheduledAgent) => void;
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
}: DueCheck): Promise<number> {
  expireStaleScheduledRuns(now);
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
// The palette asks the Automations view to open a blank automation.

const EDITOR_REQUEST = "aven:scheduled-agent-editor";
let editorRequested = false;

export function requestScheduleEditor() {
  editorRequested = true;
  window.dispatchEvent(new Event(EDITOR_REQUEST));
}

/** True once per request. */
export function takeScheduleEditorRequest(): boolean {
  const requested = editorRequested;
  editorRequested = false;
  return requested;
}

export function subscribeScheduleEditorRequest(listener: () => void) {
  window.addEventListener(EDITOR_REQUEST, listener);
  return () => window.removeEventListener(EDITOR_REQUEST, listener);
}
