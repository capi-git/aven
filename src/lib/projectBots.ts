import { useSyncExternalStore } from "react";
import { isEqualOrInside, projectKey } from "./paths";
import { projectMascot } from "./projectMascots";
import { normalizeProjectPath } from "./recents";

/**
 * Project bots: a teammate per project that wakes up when something changes,
 * looks into it in its own copy of the project, and starts fixes there. Off
 * until the user turns one on. This module holds each project's bot (its
 * settings and what it is doing), keyed by `projectKey`, and the rules for
 * when it may wake. Every window shares it through storage; only the main
 * window drives bots (see `useProjectBots`).
 */

export const PROJECT_BOTS_KEY = "aven.projectBots.v1";

const MINUTE = 60_000;

/**
 * What can wake a bot. A new kind (GitHub, files changed outside Aven)
 * adds itself here, to `BOT_WAKE_KINDS`, to `BotEvent` and to the wake
 * message (see projectBotWake.ts).
 */
export type BotWakeKind = "chatFinished" | "devServer";

export type BotWakeKindInfo = {
  kind: BotWakeKind;
  /** The settings switch. */
  label: string;
};

export const BOT_WAKE_KINDS: readonly BotWakeKindInfo[] = [
  { kind: "chatFinished", label: "Look when a chat finishes" },
  { kind: "devServer", label: "Look when the dev server crashes" },
];

export type BotQuietHours = {
  on: boolean;
  /** Minutes after local midnight. */
  start: number;
  end: number;
};

export type BotLimits = {
  runsPerDay: number;
  /** Pause while the provider's weekly usage is at least this percent. */
  pauseAtPercent: number;
  quiet: BotQuietHours;
};

/**
 * What the bot may do on its own. Looking into things is always on; Aven's
 * browser follows the user's own setting, and other apps still ask per app.
 */
export type BotAbilities = {
  /** Change files in its own copy. Off: it only tells you what it found. */
  fix: boolean;
};

export type BotFixState = "ready" | "applied" | "discarded" | "gone";

/** Changes the bot made in its copy, waiting for the user's call. */
export type BotFix = {
  id: string;
  /** The commit the copy was synced to; the fix is the diff from it. */
  base: string;
  /** The user block of the bot chat's turn that made it; its card follows that turn. */
  turnId: string;
  files: number;
  additions: number;
  deletions: number;
  /** Changed paths, relative to the project, a few at most. */
  paths: string[];
  at: number;
  /** One line from the bot's reply. */
  summary?: string;
  /**
   * A fingerprint of exactly these changes, from the host: Apply applies
   * only a patch with this fingerprint, so what you review is what lands.
   */
  hash?: string;
  state: BotFixState;
  resolvedAt?: number;
  /** Why the last Apply did not go through, in plain words. */
  error?: string;
};

/** A job this bot is doing, so other windows and a restart know. */
export type BotJob = {
  /** The window driving it. */
  owner: string;
  since: number;
  /** Renewed while the job runs; an old one is taken to have died. */
  heartbeat: number;
};

export type BotSkip =
  | "off"
  | "paused"
  | "kind-off"
  | "quiet-hours"
  | "daily-cap"
  | "usage"
  | "busy"
  | "leased"
  | "fix-waiting";

/**
 * Where a bot works. Bots belong to one project for now; an overview bot for
 * all projects will join the same list later as "all", and entries this
 * build does not know are kept as they are.
 */
export type BotScope = "project" | "all";

export type ProjectBot = {
  scope: "project";
  /** The project's folder. */
  path: string;
  on: boolean;
  createdAt: number;
  /** A name the user gave it; the critter's name otherwise. */
  name?: string;
  /** Its one chat. */
  sessionId?: string;
  wakes: Record<BotWakeKind, boolean>;
  can: BotAbilities;
  /** Fixed defaults for now; kept per bot so they can be offered later. */
  limits: BotLimits;
  paused?: boolean;
  /** Its copy of the project. */
  copy?: { path: string; branch: string; root: string };
  /** The commit its copy was last synced to. */
  base?: string;
  fixes?: BotFix[];
  /** Wake-ups started today (local day). */
  runs?: { day: string; count: number };
  job?: BotJob;
  lastWake?: { at: number; label: string };
  /** Its latest one-line post, for Home and the sidebar's tooltip. */
  lastPost?: { at: number; text: string; quiet?: boolean };
  lastSkip?: { at: number; reason: BotSkip };
  lastError?: { at: number; text: string };
};

type Store = {
  version: 1;
  bots: Record<string, ProjectBot>;
  /** Bots of another scope, from a later build: written back untouched. */
  others: Record<string, unknown>;
};

export const BOT_DEFAULT_RUNS_PER_DAY = 15;
export const BOT_DEFAULT_PAUSE_PERCENT = 80;
export const BOT_DEFAULT_QUIET: BotQuietHours = {
  on: true,
  start: 23 * 60,
  end: 8 * 60,
};
/** A job whose window stopped renewing it for this long is over. */
export const BOT_JOB_STALE_MS = 3 * MINUTE;
/** Resolved fixes kept so their cards can still say what happened. */
const FIXES_KEPT = 12;
const PATHS_KEPT = 12;

const EMPTY_STORE: Store = { version: 1, bots: {}, others: {} };

export function defaultWakes(): Record<BotWakeKind, boolean> {
  return { chatFinished: true, devServer: true };
}

/** A new bot's settings: off until turned on, watching chats and the dev server. */
export function newProjectBot(path: string, now = Date.now()): ProjectBot {
  return {
    scope: "project",
    path: normalizeProjectPath(path),
    on: false,
    createdAt: now,
    wakes: defaultWakes(),
    can: { fix: true },
    limits: {
      runsPerDay: BOT_DEFAULT_RUNS_PER_DAY,
      pauseAtPercent: BOT_DEFAULT_PAUSE_PERCENT,
      quiet: { ...BOT_DEFAULT_QUIET },
    },
  };
}

function finite(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function text(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.slice(0, max)
    : undefined;
}

const FIX_STATES = new Set<BotFixState>([
  "ready",
  "applied",
  "discarded",
  "gone",
]);
const SKIPS = new Set<BotSkip>([
  "off",
  "paused",
  "kind-off",
  "quiet-hours",
  "daily-cap",
  "usage",
  "busy",
  "leased",
  "fix-waiting",
]);

function readFix(value: unknown): BotFix | null {
  if (!value || typeof value !== "object") return null;
  const fix = value as Partial<BotFix>;
  if (
    typeof fix.id !== "string" ||
    typeof fix.base !== "string" ||
    typeof fix.turnId !== "string" ||
    !FIX_STATES.has(fix.state as BotFixState)
  )
    return null;
  return {
    id: fix.id,
    base: fix.base,
    turnId: fix.turnId,
    files: finite(fix.files, 0, 1e6, 0),
    additions: finite(fix.additions, 0, 1e9, 0),
    deletions: finite(fix.deletions, 0, 1e9, 0),
    paths: Array.isArray(fix.paths)
      ? fix.paths
          .filter((path): path is string => typeof path === "string")
          .slice(0, PATHS_KEPT)
      : [],
    at: finite(fix.at, 0, 8.64e15, 0),
    ...(text(fix.summary, 300) ? { summary: text(fix.summary, 300) } : {}),
    ...(text(fix.hash, 100) ? { hash: text(fix.hash, 100) } : {}),
    state: fix.state as BotFixState,
    ...(typeof fix.resolvedAt === "number"
      ? { resolvedAt: fix.resolvedAt }
      : {}),
    ...(text(fix.error, 400) ? { error: text(fix.error, 400) } : {}),
  };
}

/**
 * A stored bot as this build knows it: unknown fields dropped, missing ones
 * filled from the defaults, numbers kept in range. Older or hand-edited
 * entries load rather than taking the sidebar down.
 */
export function readProjectBot(value: unknown): ProjectBot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ProjectBot> & Record<string, unknown>;
  if (raw.scope !== undefined && raw.scope !== "project") return null;
  if (typeof raw.path !== "string" || !raw.path.trim()) return null;
  const base = newProjectBot(raw.path, finite(raw.createdAt, 0, 8.64e15, 0));
  const wakes = { ...base.wakes };
  if (raw.wakes && typeof raw.wakes === "object")
    for (const info of BOT_WAKE_KINDS) {
      const on = (raw.wakes as Record<string, unknown>)[info.kind];
      if (typeof on === "boolean") wakes[info.kind] = on;
    }
  const fix = (raw.can as Record<string, unknown> | undefined)?.fix;
  const can = { fix: typeof fix === "boolean" ? fix : base.can.fix };
  const limits = raw.limits as Partial<BotLimits> | undefined;
  const quiet = limits?.quiet as Partial<BotQuietHours> | undefined;
  const copy = raw.copy as ProjectBot["copy"] | undefined;
  const runs = raw.runs as ProjectBot["runs"] | undefined;
  const job = raw.job as BotJob | undefined;
  const lastWake = raw.lastWake as ProjectBot["lastWake"] | undefined;
  const lastPost = raw.lastPost as ProjectBot["lastPost"] | undefined;
  const lastSkip = raw.lastSkip as ProjectBot["lastSkip"] | undefined;
  const lastError = raw.lastError as ProjectBot["lastError"] | undefined;
  const fixes = Array.isArray(raw.fixes)
    ? raw.fixes
        .map(readFix)
        .filter((fix): fix is BotFix => fix != null)
        .slice(-FIXES_KEPT)
    : [];
  return {
    ...base,
    on: raw.on === true,
    ...(text(raw.name, 40) ? { name: text(raw.name, 40)!.trim() } : {}),
    ...(text(raw.sessionId, 256)
      ? { sessionId: text(raw.sessionId, 256) }
      : {}),
    wakes,
    can,
    limits: {
      runsPerDay: finite(limits?.runsPerDay, 1, 200, base.limits.runsPerDay),
      pauseAtPercent: finite(
        limits?.pauseAtPercent,
        10,
        100,
        base.limits.pauseAtPercent,
      ),
      quiet: {
        on: typeof quiet?.on === "boolean" ? quiet.on : base.limits.quiet.on,
        start: finite(quiet?.start, 0, 1439, base.limits.quiet.start),
        end: finite(quiet?.end, 0, 1439, base.limits.quiet.end),
      },
    },
    ...(raw.paused === true ? { paused: true } : {}),
    ...(copy &&
    typeof copy.path === "string" &&
    typeof copy.branch === "string" &&
    typeof copy.root === "string"
      ? { copy: { path: copy.path, branch: copy.branch, root: copy.root } }
      : {}),
    ...(text(raw.base, 64) ? { base: text(raw.base, 64) } : {}),
    ...(fixes.length ? { fixes } : {}),
    ...(runs && typeof runs.day === "string" && typeof runs.count === "number"
      ? { runs: { day: runs.day, count: finite(runs.count, 0, 10_000, 0) } }
      : {}),
    ...(job &&
    typeof job.owner === "string" &&
    typeof job.since === "number" &&
    typeof job.heartbeat === "number"
      ? {
          job: { owner: job.owner, since: job.since, heartbeat: job.heartbeat },
        }
      : {}),
    ...(lastWake &&
    typeof lastWake.at === "number" &&
    typeof lastWake.label === "string"
      ? { lastWake: { at: lastWake.at, label: lastWake.label.slice(0, 200) } }
      : {}),
    ...(lastPost &&
    typeof lastPost.at === "number" &&
    typeof lastPost.text === "string"
      ? {
          lastPost: {
            at: lastPost.at,
            text: lastPost.text.slice(0, 200),
            ...(lastPost.quiet ? { quiet: true } : {}),
          },
        }
      : {}),
    ...(lastSkip &&
    typeof lastSkip.at === "number" &&
    SKIPS.has(lastSkip.reason)
      ? { lastSkip: { at: lastSkip.at, reason: lastSkip.reason } }
      : {}),
    ...(lastError &&
    typeof lastError.at === "number" &&
    typeof lastError.text === "string"
      ? { lastError: { at: lastError.at, text: lastError.text.slice(0, 300) } }
      : {}),
  };
}

function parse(raw: string | null): Store {
  if (!raw) return EMPTY_STORE;
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (
      parsed?.version !== 1 ||
      !parsed.bots ||
      typeof parsed.bots !== "object"
    )
      return EMPTY_STORE;
    const bots: Record<string, ProjectBot> = {};
    const others: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.bots)) {
      const bot = readProjectBot(value);
      if (bot) bots[projectKey(bot.path)] = bot;
      else if (
        value &&
        typeof value === "object" &&
        typeof (value as { scope?: unknown }).scope === "string" &&
        (value as { scope: string }).scope !== "project"
      )
        others[key] = value;
    }
    return { version: 1, bots, others };
  } catch {
    return EMPTY_STORE;
  }
}

let cache: Store = EMPTY_STORE;
let cacheRaw: string | null | undefined;
/** Session id → project key, for bots that are on. */
let chatIndex: Map<string, string> | null = null;
const listeners = new Set<() => void>();

function read(): Store {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PROJECT_BOTS_KEY);
  } catch {
    return cache;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    cache = parse(raw);
    chatIndex = null;
  }
  return cache;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function write(store: Store) {
  const raw = JSON.stringify({
    version: 1,
    bots: { ...store.others, ...store.bots },
  });
  cache = store;
  chatIndex = null;
  try {
    localStorage.setItem(PROJECT_BOTS_KEY, raw);
    cacheRaw = raw;
  } catch {
    // Without storage bots still work in this window until it closes.
  }
  emit();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== PROJECT_BOTS_KEY) return;
  read();
  emit();
}

export function subscribeProjectBots(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

/** Every bot, keyed by `projectKey`. Unchanged (the same object) until one is saved. */
export function projectBotsSnapshot(): Readonly<Record<string, ProjectBot>> {
  return read().bots;
}

/** The project's bot, or undefined when it never had one. */
export function getProjectBot(path: string): ProjectBot | undefined {
  return read().bots[projectKey(normalizeProjectPath(path))];
}

/** Bots that are on. */
export function activeProjectBots(): ProjectBot[] {
  return Object.values(read().bots).filter((bot) => bot.on);
}

export function anyProjectBotOn(): boolean {
  return Object.values(read().bots).some((bot) => bot.on);
}

/**
 * Change one project's bot. `update` gets the current bot (a new one, off,
 * when there is none) and returns the next, or the same object for no
 * change. Returns what was saved.
 */
export function updateProjectBot(
  path: string,
  update: (bot: ProjectBot) => ProjectBot,
): ProjectBot {
  const store = read();
  const key = projectKey(normalizeProjectPath(path));
  const current = store.bots[key] ?? newProjectBot(path);
  const next = update(current);
  if (next === current) return current;
  write({ ...store, bots: { ...store.bots, [key]: next } });
  return next;
}

/** Forget a project's bot entirely (the project was deleted). */
export function forgetProjectBot(path: string) {
  const store = read();
  const key = projectKey(normalizeProjectPath(path));
  if (!store.bots[key]) return;
  const bots = { ...store.bots };
  delete bots[key];
  write({ ...store, bots });
}

/** Test seam. */
export function resetProjectBotsCache() {
  cache = EMPTY_STORE;
  cacheRaw = undefined;
  chatIndex = null;
}

function chats(): Map<string, string> {
  read();
  if (chatIndex) return chatIndex;
  chatIndex = new Map();
  for (const [key, bot] of Object.entries(cache.bots))
    if (bot.on && bot.sessionId) chatIndex.set(bot.sessionId, key);
  return chatIndex;
}

/** The bot whose chat this is, while that bot is on. */
export function botForChat(
  sessionId: string | undefined,
): ProjectBot | undefined {
  if (!sessionId) return undefined;
  const key = chats().get(sessionId);
  return key ? cache.bots[key] : undefined;
}

export function isBotChat(sessionId: string | undefined): boolean {
  return !!sessionId && chats().has(sessionId);
}

/** What a bot's chat must be to run a turn: in its copy, on Claude, in auto. */
export type BotChatShape = {
  harness: string;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: string;
  worktreeCwd?: string;
  providerSessionId?: string;
  pendingSwitch?: unknown;
};

/**
 * The chat as its bot needs it, or null when it already is. `restart` says
 * its agent must start a new conversation (it moved into the copy or onto
 * Claude), which a busy chat cannot do until its turn ends.
 */
export function botChatInCopy<T extends BotChatShape>(
  chat: T,
  copy: string,
  claudeModel: () => string,
): { chat: T; restart: boolean } | null {
  const moved = chat.worktreeCwd !== copy;
  const otherApp = chat.harness !== "claude";
  if (!moved && !otherApp)
    return chat.runtimeMode === "auto"
      ? null
      : { chat: { ...chat, runtimeMode: "auto" }, restart: false };
  return {
    restart: true,
    chat: {
      ...chat,
      runtimeMode: "auto",
      worktreeCwd: copy,
      providerSessionId: undefined,
      pendingSwitch: undefined,
      ...(otherApp
        ? { harness: "claude", model: claudeModel(), modelSettings: {} }
        : {}),
    },
  };
}

/** Chats that belong to a bot that is on. */
export function botChatIds(): ReadonlySet<string> {
  return new Set(chats().keys());
}

/** A path inside a bot's copy of its project. */
export function isBotCopyPath(path: string | undefined): boolean {
  if (!path) return false;
  return Object.values(read().bots).some(
    (bot) => !!bot.copy && isEqualOrInside(path, bot.copy.path),
  );
}

export function useProjectBot(
  path: string | null | undefined,
): ProjectBot | undefined {
  const getSnapshot = () => (path ? getProjectBot(path) : undefined);
  return useSyncExternalStore(subscribeProjectBots, getSnapshot, getSnapshot);
}

/** Whether a fix belongs to this turn of the bot's chat (its card follows it). */
export function useBotTurnOwnsFix(
  path: string | undefined,
  turnId: string | undefined,
): boolean {
  const getSnapshot = () =>
    !!path && !!turnId && !!fixForTurn(getProjectBot(path), turnId);
  return useSyncExternalStore(subscribeProjectBots, getSnapshot, getSnapshot);
}

/** The project whose bot this chat is, while that bot is on. */
export function useBotChatProject(
  sessionId: string | undefined,
): string | undefined {
  const getSnapshot = () => botForChat(sessionId)?.path;
  return useSyncExternalStore(subscribeProjectBots, getSnapshot, getSnapshot);
}

export function useProjectBotsStore(): Readonly<Record<string, ProjectBot>> {
  return useSyncExternalStore(
    subscribeProjectBots,
    projectBotsSnapshot,
    projectBotsSnapshot,
  );
}

// ---------------------------------------------------------------------------
// Names

function capitalized(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

/** The critter's name, capitalised: "Jelly", "Fox". */
export function defaultBotName(path: string, mascot?: string | null): string {
  return capitalized(projectMascot(projectKey(path), mascot).name);
}

export function botName(
  bot: Pick<ProjectBot, "path" | "name">,
  mascot?: string | null,
): string {
  return bot.name?.trim() || defaultBotName(bot.path, mascot);
}

/**
 * What the bot does, in a few words, for under its name: "checks each chat
 * and fixes what breaks". It follows its switches.
 */
export function botJobLine(bot: Pick<ProjectBot, "wakes" | "can">): string {
  const { chatFinished, devServer } = bot.wakes;
  if (!chatFinished && !devServer)
    return bot.can.fix
      ? "looks into what you ask and fixes it"
      : "looks into what you ask";
  const watches =
    chatFinished && devServer
      ? "checks each chat and the dev server,"
      : chatFinished
        ? "checks each chat"
        : "watches the dev server";
  return `${watches} and ${bot.can.fix ? "fixes what breaks" : "tells you what breaks"}`;
}

/**
 * A git branch for the bot, `aven/bot/jelly-1a2b`: its name and a short tag
 * of its project, so two projects in one repository never share one.
 */
export function botBranch(name: string, path: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .replace(/-+$/g, "") || "bot";
  let hash = 0x811c9dc5;
  for (const char of projectKey(normalizeProjectPath(path))) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `aven/bot/${slug}-${hash.toString(16).padStart(8, "0").slice(0, 4)}`;
}

// ---------------------------------------------------------------------------
// Fixes

/** The fix waiting for the user's call, if any. */
export function pendingFix(
  bot: Pick<ProjectBot, "fixes"> | undefined,
): BotFix | undefined {
  return bot?.fixes?.find((fix) => fix.state === "ready");
}

export function fixForTurn(
  bot: Pick<ProjectBot, "fixes"> | undefined,
  turnId: string,
): BotFix | undefined {
  return bot?.fixes?.find((fix) => fix.turnId === turnId);
}

/** Whether a copy's changes now are exactly the ones a fix recorded. */
export function fixMatches(
  fix: Pick<BotFix, "hash">,
  diff: { hash?: string },
): boolean {
  return !!fix.hash && fix.hash === diff.hash;
}

/** Record a fix the bot just made, or the waiting one grown, at its newest turn. */
export function withReadyFix(
  bot: ProjectBot,
  fix: Omit<BotFix, "state" | "id"> & { id?: string },
): ProjectBot {
  const waiting = pendingFix(bot);
  const next: BotFix = {
    ...fix,
    id: waiting?.id ?? fix.id ?? crypto.randomUUID(),
    paths: fix.paths.slice(0, PATHS_KEPT),
    state: "ready",
  };
  const others = (bot.fixes ?? []).filter((item) => item.id !== next.id);
  return { ...bot, fixes: [...others, next].slice(-FIXES_KEPT) };
}

export function resolveFix(
  bot: ProjectBot,
  id: string,
  state: Exclude<BotFixState, "ready">,
  now = Date.now(),
): ProjectBot {
  if (!bot.fixes?.some((fix) => fix.id === id && fix.state === "ready"))
    return bot;
  return {
    ...bot,
    fixes: bot.fixes.map((fix) =>
      fix.id === id
        ? { ...fix, state, resolvedAt: now, error: undefined }
        : fix,
    ),
  };
}

export function noteFixError(
  bot: ProjectBot,
  id: string,
  error: string,
): ProjectBot {
  if (!bot.fixes?.some((fix) => fix.id === id)) return bot;
  return {
    ...bot,
    fixes: bot.fixes.map((fix) => (fix.id === id ? { ...fix, error } : fix)),
  };
}

// ---------------------------------------------------------------------------
// When a bot may wake

/** `yyyy-mm-dd` in local time: the daily cap starts again at local midnight. */
export function localDay(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function runsToday(bot: Pick<ProjectBot, "runs">, now: number): number {
  return bot.runs?.day === localDay(now) ? bot.runs.count : 0;
}

export function withRunCounted(bot: ProjectBot, now: number): ProjectBot {
  return {
    ...bot,
    runs: { day: localDay(now), count: runsToday(bot, now) + 1 },
  };
}

/** Whether `at` falls in the quiet hours, which may run past midnight. */
export function inQuietHours(quiet: BotQuietHours, at: number): boolean {
  if (!quiet.on || quiet.start === quiet.end) return false;
  const date = new Date(at);
  const minute = date.getHours() * 60 + date.getMinutes();
  return quiet.start < quiet.end
    ? minute >= quiet.start && minute < quiet.end
    : minute >= quiet.start || minute < quiet.end;
}

/** A job another window (or an earlier page) is still renewing. */
export function jobIsLive(job: BotJob | undefined, now: number): boolean {
  return (
    !!job && now - job.heartbeat >= 0 && now - job.heartbeat < BOT_JOB_STALE_MS
  );
}

export type BotWakeDecision =
  { run: true; kinds: BotWakeKind[] } | { skip: BotSkip };

/**
 * Whether the bot wakes for these kinds of event now. It needs to be on and
 * not paused, to want at least one of the kinds, to be outside its quiet
 * hours, under its daily run cap and under its usage pause; and it must not
 * be at work already, in this window (`busy`: the event waits) or another
 * (`leased`).
 */
export function botWakeDecision(input: {
  bot: ProjectBot;
  kinds: readonly BotWakeKind[];
  now: number;
  /** The provider's weekly usage, percent, when known. */
  weeklyUsed: number | null;
  busy: boolean;
  owner: string;
}): BotWakeDecision {
  const { bot, now } = input;
  if (!bot.on) return { skip: "off" };
  if (bot.paused) return { skip: "paused" };
  const kinds = [...new Set(input.kinds)].filter((kind) => bot.wakes[kind]);
  if (!kinds.length) return { skip: "kind-off" };
  // One fix at a time: what happens meanwhile waits until you apply it or
  // throw it away, then wakes the bot once.
  if (pendingFix(bot)) return { skip: "fix-waiting" };
  if (inQuietHours(bot.limits.quiet, now)) return { skip: "quiet-hours" };
  if (runsToday(bot, now) >= bot.limits.runsPerDay)
    return { skip: "daily-cap" };
  if (input.weeklyUsed != null && input.weeklyUsed >= bot.limits.pauseAtPercent)
    return { skip: "usage" };
  if (jobIsLive(bot.job, now) && bot.job?.owner !== input.owner)
    return { skip: "leased" };
  if (input.busy) return { skip: "busy" };
  return { run: true, kinds };
}

/** Skips that keep the event for later rather than dropping it. */
export function skipKeepsEvents(skip: BotSkip): boolean {
  return skip === "busy" || skip === "leased" || skip === "fix-waiting";
}

/** Why the bot did not wake, in plain words, for its header. */
export function botSkipText(skip: BotSkip): string {
  switch (skip) {
    case "quiet-hours":
      return "Skipped a check during quiet hours";
    case "daily-cap":
      return "Reached today's run limit";
    case "usage":
      return "Paused to save your weekly usage";
    case "paused":
      return "Paused";
    default:
      return "";
  }
}

/**
 * Claim the bot for a job in this window. Fails while another window's job
 * is live. Storage is shared by every window, so the claim is read and
 * written in one step.
 */
export function claimBotJob(path: string, owner: string, now = Date.now()) {
  let claimed = false;
  updateProjectBot(path, (bot) => {
    if (!bot.on) return bot;
    if (jobIsLive(bot.job, now) && bot.job?.owner !== owner) return bot;
    claimed = true;
    return {
      ...bot,
      job: {
        owner,
        since: bot.job?.owner === owner ? bot.job.since : now,
        heartbeat: now,
      },
    };
  });
  return claimed;
}

export function renewBotJob(path: string, owner: string, now = Date.now()) {
  updateProjectBot(path, (bot) =>
    bot.job?.owner === owner
      ? { ...bot, job: { ...bot.job, heartbeat: now } }
      : bot,
  );
}

export function releaseBotJob(path: string, owner: string) {
  updateProjectBot(path, (bot) =>
    bot.job?.owner === owner ? { ...bot, job: undefined } : bot,
  );
}

// ---------------------------------------------------------------------------
// Status

export type BotStatus =
  "watching" | "working" | "fix-ready" | "needs-you" | "paused";

export const BOT_STATUS_LABEL: Readonly<Record<BotStatus, string>> = {
  watching: "Watching",
  working: "Working",
  "fix-ready": "Fix ready",
  "needs-you": "Needs you",
  paused: "Paused",
};

/** The chat pill tone each status borrows (see ChatStatusPill.css). */
export const BOT_STATUS_STAGE: Readonly<Record<BotStatus, string>> = {
  watching: "shipped",
  working: "working",
  "fix-ready": "review",
  "needs-you": "needs-you",
  paused: "shipped",
};

export type BotChatState = {
  busy: boolean;
  /** An approval or question waits for the user. */
  needsInput: boolean;
};

/** The bot's one word: what it is doing, or what it waits for. */
export function botStatus(
  bot: ProjectBot,
  chat: BotChatState | undefined,
  now: number,
): BotStatus {
  if (chat?.needsInput) return "needs-you";
  if (chat?.busy || jobIsLive(bot.job, now)) return "working";
  if (pendingFix(bot)) return "fix-ready";
  if (bot.paused) return "paused";
  return "watching";
}

/** "Fix ready: 2 files" or its latest post, for Home's tile. */
export function botHeadline(bot: ProjectBot, status: BotStatus): string {
  const fix = pendingFix(bot);
  if (status === "fix-ready" && fix)
    return `Fix ready: ${fix.files} ${fix.files === 1 ? "file" : "files"}`;
  if (status === "watching" && bot.lastPost && !bot.lastPost.quiet)
    return bot.lastPost.text;
  return BOT_STATUS_LABEL[status];
}

/** Minutes after midnight as "11 pm", "8:30 am". */
export function formatClockMinutes(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute
    ? `${twelve}:${String(minute).padStart(2, "0")} ${suffix}`
    : `${twelve} ${suffix}`;
}
