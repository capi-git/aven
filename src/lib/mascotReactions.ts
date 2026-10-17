import {
  getActivitySnapshot,
  subscribeActivity,
  type ActivityEntry,
  type ActivityOutcome,
} from "./activity";
import { noteActiveDay } from "./activityStreak";
import { projectKey } from "./paths";

/**
 * One-shot mascot reactions to a turn's end: a happy hop when it completed, a
 * slump when it failed, a blink when it was stopped. A discussion's panel also
 * uses a nod and a head-tilt when a reply agrees or pushes back.
 *
 * A reaction plays once per turn end. A window reacts only to ledger entries
 * it sees arrive while it is watching, so a reload or a new window never
 * replays old ones, and it claims each entry in shared storage first, so only
 * one window plays it: the focused window straight away, otherwise the first
 * visible window once the focused one has had a moment to claim it.
 */
export type MascotReactionKind = "cheer" | "slump" | "shrug" | "nod" | "tilt";

export type MascotReaction = {
  /** The activity entry that ended the turn. */
  id: string;
  /** `projectKey` of the turn's folder. */
  key: string;
  sessionId: string;
  kind: MascotReactionKind;
  /** Wall-clock time the reaction started here. */
  startedAt: number;
};

/** How long each reaction runs; the mascot's CSS uses the same values. */
export const MASCOT_REACTION_MS: Readonly<Record<MascotReactionKind, number>> =
  { cheer: 900, slump: 1100, shrug: 700, nod: 640, tilt: 760 };
/** Reactions stay current a little longer than they run, then clear. */
const REACTION_LIFETIME_MS = 1200;
/** Entries older than this when first seen are history, not a turn ending now. */
export const REACTION_FRESH_MS = 15_000;
/** An unfocused window waits this long for the focused one to claim first. */
export const REACTION_CLAIM_GRACE_MS = 250;
export const REACTION_CLAIMS_KEY = "aven.mascotReactions.v1";
const CLAIM_LIMIT = 64;
const CLAIM_KEEP_MS = 10 * 60_000;

const KINDS: Partial<Record<ActivityOutcome, MascotReactionKind>> = {
  completed: "cheer",
  failed: "slump",
  stopped: "shrug",
};

export function reactionKindFor(
  outcome: ActivityOutcome,
): MascotReactionKind | null {
  return KINDS[outcome] ?? null;
}

/**
 * Finished turns among `entries` that `known` has not seen and that ended
 * within `REACTION_FRESH_MS` of `now`. Afterwards `known` holds exactly the
 * ids in `entries`, so it never grows past the ledger.
 */
export function newTurnEnds(
  entries: readonly ActivityEntry[],
  known: Set<string>,
  now: number,
): ActivityEntry[] {
  const fresh: ActivityEntry[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    ids.add(entry.id);
    if (known.has(entry.id) || !reactionKindFor(entry.outcome)) continue;
    if (Math.abs(now - entry.createdAt) <= REACTION_FRESH_MS) fresh.push(entry);
  }
  known.clear();
  for (const id of ids) known.add(id);
  // Oldest first, so the newest reaction for a project is the one left playing.
  return fresh.sort((a, b) => a.createdAt - b.createdAt);
}

type Claim = { id: string; at: number };

function readClaims(): Claim[] {
  const parsed: unknown = JSON.parse(
    localStorage.getItem(REACTION_CLAIMS_KEY) ?? "[]",
  );
  return Array.isArray(parsed)
    ? parsed.filter(
        (claim): claim is Claim =>
          typeof claim?.id === "string" && typeof claim?.at === "number",
      )
    : [];
}

/**
 * Marks a turn end as played in storage every window shares. False when
 * another window (or an earlier load of this one) already played it.
 */
export function claimReaction(id: string, now = Date.now()): boolean {
  let claims: Claim[];
  try {
    claims = readClaims();
  } catch {
    claims = [];
  }
  if (claims.some((claim) => claim.id === id)) return false;
  try {
    localStorage.setItem(
      REACTION_CLAIMS_KEY,
      JSON.stringify(
        [
          ...claims.filter((claim) => now - claim.at < CLAIM_KEEP_MS),
          { id, at: now },
        ].slice(-CLAIM_LIMIT),
      ),
    );
  } catch {
    // Without shared storage this window still plays it, once: it has now
    // seen the entry and never reacts to it again.
  }
  return true;
}

const listeners = new Set<() => void>();
const playing = new Map<string, MascotReaction>();
const timers = new Set<ReturnType<typeof setTimeout>>();
let known: Set<string> | null = null;
let stopLedger: (() => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function later(run: () => void, ms: number) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
}

function documentShown(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

function documentFocused(): boolean {
  try {
    return typeof document !== "undefined" && document.hasFocus();
  } catch {
    return false;
  }
}

function play(entry: ActivityEntry, kind: MascotReactionKind) {
  if (!claimReaction(entry.id)) return;
  const reaction: MascotReaction = {
    id: entry.id,
    key: projectKey(entry.cwd),
    sessionId: entry.sessionId,
    kind,
    startedAt: Date.now(),
  };
  playing.set(reaction.key, reaction);
  emit();
  later(() => {
    if (playing.get(reaction.key) !== reaction) return;
    playing.delete(reaction.key);
    emit();
  }, REACTION_LIFETIME_MS);
}

function onLedger() {
  if (!known) return;
  for (const entry of newTurnEnds(getActivitySnapshot(), known, Date.now())) {
    if (entry.outcome === "completed") noteActiveDay(entry.createdAt);
    const kind = reactionKindFor(entry.outcome);
    if (!kind || !entry.cwd || entry.cwd === "~") continue;
    if (documentShown() && documentFocused()) play(entry, kind);
    else
      later(() => {
        if (documentShown()) play(entry, kind);
      }, REACTION_CLAIM_GRACE_MS);
  }
}

function start() {
  // Everything already in the ledger is history for this window.
  known = new Set(getActivitySnapshot().map((entry) => entry.id));
  stopLedger = subscribeActivity(onLedger);
}

function stop() {
  stopLedger?.();
  stopLedger = null;
  known = null;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  playing.clear();
}

/** Watches the ledger only while something on screen can react. */
export function subscribeMascotReactions(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** The reaction playing for a project, if any. */
export function mascotReactionFor(
  key: string | null | undefined,
): MascotReaction | null {
  return (key && playing.get(key)) || null;
}
