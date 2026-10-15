/**
 * Discussions: two chats talking to each other, only because the user asked.
 *
 * Aven is the broker. Neither agent gets a tool to message the other, and an
 * agent can never start a discussion. Aven sends the topic to the first chat
 * (A), and each time a chat's turn ends it relays that chat's final reply to
 * the other one as a clearly labelled user-side message, until the rounds are
 * used up or something stops it. Relays happen only at turn end, never while
 * a reply streams.
 *
 * This module is pure apart from `DiscussionStore`'s storage: the state, the
 * relay rules, the prompts and the planner the broker hook
 * (`useDiscussionBroker`) executes.
 *
 * Queued messages: when a relay is due and the receiving chat is busy with
 * another turn or has the user's own messages queued, the discussion pauses
 * rather than slipping into that queue. The user has taken over that chat;
 * Resume continues once they are done. This never interleaves relays with the
 * user's own follow-ups and never steers a running turn.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPreparingHandoff } from "./handoff";
import {
  HARNESS_TITLE,
  hasPendingApproval,
  sessionNeedsInput,
  type Block,
  type DiscussionRelayMeta,
  type HarnessId,
  type Session,
} from "./session";

export const DISCUSSIONS_KEY = "aven.discussions";
export const DISCUSSION_MIN_ROUNDS = 1;
export const DISCUSSION_MAX_ROUNDS = 6;
export const DISCUSSION_DEFAULT_ROUNDS = 3;
/** Longest reply relayed as is; longer replies are shortened, with a note. */
export const RELAY_CHAR_LIMIT = 8_000;

export type DiscussionSide = "a" | "b";

export type DiscussionParty = {
  sessionId: string;
  harness: HarnessId;
  /** Model display name, e.g. "GPT-5". */
  model: string;
  /** Chat title without the provider prefix. */
  title: string;
  cwd: string;
};

export type DiscussionStatus = "active" | "paused" | "ended";

/** Why a discussion ended; `side` names the chat that caused it. */
export type DiscussionEnding = {
  kind: "completed" | "stopped" | "failed" | "cancelled" | "closed";
  side?: DiscussionSide;
};

export type Discussion = {
  id: string;
  /** Window label that drives this discussion; other windows only show it. */
  owner: string;
  a: DiscussionParty;
  b: DiscussionParty;
  topic: string;
  /** Each round is one reply from A and one from B. */
  rounds: number;
  /** Finished turns. A speaks on even turns, B on odd ones. */
  settled: number;
  /** What the speaking chat receives this turn: the topic or the other reply. */
  relay: string;
  truncated?: boolean;
  /** The speaking chat has been sent `relay`. */
  delivered: boolean;
  status: DiscussionStatus;
  /** Why it is paused, in plain language. */
  reason?: string;
  /** The chat it paused for; once that chat is free the reason says so. */
  blockedBy?: string;
  ended?: DiscussionEnding;
  /** Chats still owed the closing note (posted once each is idle). */
  notes?: DiscussionSide[];
  /** Development preview: shown only, never relays or persists. */
  preview?: true;
  startedAt: number;
  updatedAt: number;
};

export type DiscussionOutcome = {
  status: "completed" | "failed" | "cancelled";
  text: string;
};

// --- Derived state -----------------------------------------------------------

export function clampRounds(value: number): number {
  if (!Number.isFinite(value)) return DISCUSSION_DEFAULT_ROUNDS;
  return Math.min(
    DISCUSSION_MAX_ROUNDS,
    Math.max(DISCUSSION_MIN_ROUNDS, Math.round(value)),
  );
}

/** The chat whose turn it is (or whose reply is being relayed). */
export function speakingSide(discussion: Discussion): DiscussionSide {
  return discussion.settled % 2 === 0 ? "a" : "b";
}

export function otherSide(side: DiscussionSide): DiscussionSide {
  return side === "a" ? "b" : "a";
}

export function discussionParty(
  discussion: Discussion,
  side: DiscussionSide,
): DiscussionParty {
  return side === "a" ? discussion.a : discussion.b;
}

export function discussionSideOf(
  discussion: Discussion,
  sessionId: string,
): DiscussionSide | null {
  if (discussion.a.sessionId === sessionId) return "a";
  if (discussion.b.sessionId === sessionId) return "b";
  return null;
}

/** The round in progress, 1-based. */
export function discussionRound(discussion: Discussion): number {
  return Math.min(discussion.rounds, Math.floor(discussion.settled / 2) + 1);
}

/** Rounds in which both chats have replied. */
export function completedRounds(discussion: Discussion): number {
  return Math.min(discussion.rounds, Math.floor(discussion.settled / 2));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Shorten a reply to the relay limit, preferring a word boundary. */
export function capRelay(
  text: string,
  limit = RELAY_CHAR_LIMIT,
): { text: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return { text: trimmed, truncated: false };
  let cut = trimmed.slice(0, limit);
  const space = cut.search(/\s\S*$/);
  if (space > limit * 0.9) cut = cut.slice(0, space);
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

// --- Prompts -----------------------------------------------------------------

function partyLabel(party: DiscussionParty): string {
  return `${party.model} in “${party.title}”`;
}

function framing(other: DiscussionParty, rounds: number): string {
  return [
    `The user would like you to discuss a topic with another agent: ${describeParty(other)}.`,
    `Aven relays messages between you. Your reply here is sent to them, and their reply comes back to you as a message. You cannot contact them any other way, and they only see what you write in your reply. The discussion lasts ${plural(rounds, "round")}. Keep each reply focused and conversational.`,
  ].join("\n\n");
}

function describeParty(other: DiscussionParty): string {
  return `${other.model} (${HARNESS_TITLE[other.harness]}) in the chat “${other.title}”`;
}

/** Exactly what the speaking chat's agent receives this turn. */
export function relayPrompt(
  discussion: Discussion,
  limit = RELAY_CHAR_LIMIT,
): string {
  const sender = discussionParty(
    discussion,
    otherSide(speakingSide(discussion)),
  );
  const turn = discussion.settled;
  const topic = capRelay(discussion.topic, limit).text;
  if (turn === 0)
    return `${framing(sender, discussion.rounds)}\n\nTopic: ${topic}`;
  const parts: string[] = [];
  if (turn === 1)
    parts.push(framing(sender, discussion.rounds), `Topic: ${topic}`);
  parts.push(`${partyLabel(sender)} says:`, discussion.relay);
  if (discussion.truncated)
    parts.push(
      `[Aven shortened this message to ${limit.toLocaleString("en-US")} characters.]`,
    );
  const last = turn >= discussion.rounds * 2 - 2;
  parts.push(
    `(Round ${discussionRound(discussion)} of ${discussion.rounds}.${
      last ? " This is your last reply in this discussion." : ""
    })`,
  );
  return parts.join("\n\n");
}

/** The user-side block this turn adds to the receiving transcript. */
export function relayBlockMeta(discussion: Discussion): DiscussionRelayMeta {
  const partner = discussionParty(
    discussion,
    otherSide(speakingSide(discussion)),
  );
  return {
    id: discussion.id,
    turn: discussion.settled,
    rounds: discussion.rounds,
    partner: {
      harness: partner.harness,
      model: partner.model,
      title: partner.title,
      cwd: partner.cwd,
    },
    ...(discussion.truncated ? { truncated: true } : {}),
  };
}

/** The short closing note Aven posts in both chats; no model is asked. */
export function discussionEndNote(discussion: Discussion): string {
  const ending = discussion.ended ?? { kind: "stopped" as const };
  const title = ending.side
    ? `“${discussionParty(discussion, ending.side).title}”`
    : "a chat";
  const done = completedRounds(discussion);
  switch (ending.kind) {
    case "completed":
      return `Discussion ended after ${plural(discussion.rounds, "round")}.`;
    case "failed":
      return `Discussion ended: ${title} ran into an error.`;
    case "cancelled":
      return `Discussion ended: ${title} was stopped.`;
    case "closed":
      return `Discussion ended: ${title} was closed.`;
    default:
      return done > 0
        ? `Discussion stopped after ${plural(done, "round")} of ${discussion.rounds}.`
        : `Discussion stopped during round 1 of ${discussion.rounds}.`;
  }
}

// --- Transitions -------------------------------------------------------------

export function createDiscussion(input: {
  id: string;
  owner: string;
  a: DiscussionParty;
  b: DiscussionParty;
  topic: string;
  rounds: number;
  now: number;
  preview?: boolean;
}): Discussion {
  return {
    id: input.id,
    owner: input.owner,
    a: input.a,
    b: input.b,
    topic: input.topic.trim(),
    rounds: clampRounds(input.rounds),
    settled: 0,
    relay: capRelay(input.topic).text,
    delivered: false,
    status: "active",
    ...(input.preview ? { preview: true as const } : {}),
    startedAt: input.now,
    updatedAt: input.now,
  };
}

export function endDiscussion(
  discussion: Discussion,
  ended: DiscussionEnding,
  now: number,
): Discussion {
  if (discussion.status === "ended") return discussion;
  return {
    ...discussion,
    status: "ended",
    reason: undefined,
    ended,
    notes: discussion.preview ? [] : ["a", "b"],
    updatedAt: now,
  };
}

/**
 * Apply the speaking chat's finished turn. A reply moves the discussion to the
 * other chat (or ends it after the last round); errors and stops end it; a
 * turn with nothing to relay pauses it so the user can decide.
 */
export function settleDiscussion(
  discussion: Discussion,
  outcome: DiscussionOutcome,
  now: number,
): Discussion {
  if (discussion.status === "ended") return discussion;
  const side = speakingSide(discussion);
  if (outcome.status === "cancelled")
    return endDiscussion(discussion, { kind: "cancelled", side }, now);
  if (outcome.status === "failed")
    return endDiscussion(discussion, { kind: "failed", side }, now);
  const reply = outcome.text.trim();
  if (!reply)
    return {
      ...discussion,
      status: "paused",
      reason: `“${discussionParty(discussion, side).title}” finished without a reply to pass on.`,
      updatedAt: now,
    };
  const settled = discussion.settled + 1;
  if (settled >= discussion.rounds * 2)
    return endDiscussion(
      { ...discussion, settled },
      { kind: "completed" },
      now,
    );
  const capped = capRelay(reply);
  const next: Discussion = {
    ...discussion,
    settled,
    relay: capped.text,
    delivered: false,
    updatedAt: now,
  };
  if (capped.truncated) next.truncated = true;
  else delete next.truncated;
  return next;
}

export const READY_REASON = "Ready to continue.";

export function pauseDiscussion(
  discussion: Discussion,
  reason: string,
  now: number,
  blockedBy?: string,
): Discussion {
  if (discussion.status !== "active") return discussion;
  const paused: Discussion = {
    ...discussion,
    status: "paused",
    reason,
    updatedAt: now,
  };
  if (blockedBy) paused.blockedBy = blockedBy;
  else delete paused.blockedBy;
  return paused;
}

export function resumeDiscussion(
  discussion: Discussion,
  now: number,
): Discussion {
  if (discussion.status !== "paused") return discussion;
  const resumed: Discussion = {
    ...discussion,
    status: "active",
    reason: undefined,
    updatedAt: now,
  };
  delete resumed.blockedBy;
  return resumed;
}

// --- Transcript --------------------------------------------------------------

/**
 * The speaking chat's final reply to the relayed message for `turn`: its last
 * assistant text before the next turn starts. Null when that relay was never
 * added to this transcript; "" when it was but no reply followed.
 */
export function discussionReply(
  blocks: readonly Block[],
  id: string,
  turn: number,
): string | null {
  let start = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const meta = blocks[index].discussion;
    if (meta?.id === id && meta.turn === turn) {
      start = index;
      break;
    }
  }
  if (start < 0) return null;
  let reply = "";
  for (let index = start + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    // A new turn (not a steer) starts with a timestamped user message.
    if (block.role === "user" && block.startedAt != null) break;
    if (block.role === "assistant" && block.text.trim()) reply = block.text;
  }
  return reply;
}

// --- Readiness -----------------------------------------------------------------

/** Why a chat cannot take a discussion turn, or start or join a discussion. */
export type DiscussionBlocker =
  | "unsupported"
  | "discussing"
  | "approval"
  | "question"
  | "working"
  | "queued"
  | "card"
  | "switching";

/** Completes "“Title” …" or "This chat …". */
export const BLOCKER_PHRASE: Record<DiscussionBlocker, string> = {
  unsupported: "can't take part in a discussion",
  discussing: "is already in a discussion",
  approval: "needs your approval",
  question: "has a question for you",
  working: "is busy with another turn",
  queued: "has your messages queued",
  card: "has a card waiting to be sent",
  switching: "is switching providers",
};

/** A short label for a chat row in the picker. */
export const BLOCKER_LABEL: Record<DiscussionBlocker, string> = {
  unsupported: "Can't join",
  discussing: "In a discussion",
  approval: "Needs approval",
  question: "Has a question",
  working: "Working",
  queued: "Messages queued",
  card: "Card waiting",
  switching: "Switching provider",
};

function turnBlocker(session: Session): DiscussionBlocker | null {
  if (hasPendingApproval(session.blocks)) return "approval";
  if (session.pendingQuestion) return "question";
  if (session.busy) return "working";
  if (session.queuedMessages?.length) return "queued";
  // A relay is sent like a message, which would use up the chip.
  if (session.handoffCard || session.noteCard || session.inboxCard)
    return "card";
  if (isPreparingHandoff(session)) return "switching";
  return null;
}

/** Why this chat cannot take a discussion turn right now, or null. */
export function deliveryBlocker(session: Session): string | null {
  const blocker = turnBlocker(session);
  return blocker ? BLOCKER_PHRASE[blocker] : null;
}

/** Why this chat cannot start or join a discussion now, or null. */
export function discussionBlocker(
  session: Session,
  discussions: readonly Discussion[],
): DiscussionBlocker | null {
  if (session.inboxAsk || session.orchestrationLeadId) return "unsupported";
  if (
    discussions.some(
      (discussion) =>
        discussion.status !== "ended" &&
        discussionSideOf(discussion, session.id),
    )
  )
    return "discussing";
  return turnBlocker(session);
}

/** A chat the user can pick to discuss with. */
export type DiscussionCandidate = {
  sessionId: string;
  title: string;
  harness: HarnessId;
  /** Model display name. */
  model: string;
  cwd: string;
  blocked?: DiscussionBlocker;
};

export type DiscussionPartnerChoice =
  | { kind: "chat"; sessionId: string }
  | { kind: "new"; harness: HarnessId; model: string };

export type DiscussionStartRequest = {
  /** The chat the user started from; it speaks first. */
  sessionId: string;
  partner: DiscussionPartnerChoice;
  topic: string;
  rounds: number;
  /** Development builds: show the animation only; nothing is sent. */
  preview?: boolean;
};

/** What the composer's picker needs from the window that drives discussions. */
export type DiscussionHost = {
  options(sessionId: string): {
    /** Why this chat cannot start one now. */
    blocked?: string;
    candidates: DiscussionCandidate[];
  };
  /** Starts it; returns why it could not start, or null. */
  start(request: DiscussionStartRequest): string | null;
  /** Development builds offer a preview of the sidebar animation. */
  preview?: boolean;
};

// --- Planner -------------------------------------------------------------------

export type DiscussionAction =
  | { kind: "deliver"; id: string; sessionId: string }
  | {
      kind: "pause";
      id: string;
      reason: string;
      /** The chat it waits for, so the reason can change once it is free. */
      blockedBy?: string;
    }
  | { kind: "ready"; id: string }
  | {
      kind: "note";
      id: string;
      side: DiscussionSide;
      /** Absent when the chat is gone; the note is then only marked done. */
      sessionId?: string;
      text: string;
    }
  | { kind: "recover"; id: string; turn: number; reply: string }
  | { kind: "redeliver"; id: string };

/**
 * What the owning window should do now. Pure: the broker runs it whenever
 * discussions or the chats in them change, and executes the actions.
 * `inFlight` holds discussions whose delivered turn this window is awaiting.
 */
export function planDiscussions(
  discussions: readonly Discussion[],
  owner: string,
  sessions: readonly Session[],
  inFlight: ReadonlySet<string>,
): DiscussionAction[] {
  const actions: DiscussionAction[] = [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const discussion of discussions) {
    if (discussion.owner !== owner || discussion.preview) continue;
    const { id } = discussion;
    if (discussion.status === "ended") {
      for (const side of discussion.notes ?? []) {
        const session = byId.get(discussionParty(discussion, side).sessionId);
        // A note waits for the chat to be idle, so it never splits a reply.
        if (session?.busy) continue;
        actions.push({
          kind: "note",
          id,
          side,
          ...(session ? { sessionId: session.id } : {}),
          text: discussionEndNote(discussion),
        });
      }
      continue;
    }
    if (discussion.status === "paused") {
      const waitedFor = discussion.blockedBy
        ? byId.get(discussion.blockedBy)
        : undefined;
      if (waitedFor && !deliveryBlocker(waitedFor))
        actions.push({ kind: "ready", id });
      continue;
    }
    if (discussion.status !== "active") continue;
    const a = byId.get(discussion.a.sessionId);
    const b = byId.get(discussion.b.sessionId);
    if (!a || !b) {
      const missing = !a ? discussion.a : discussion.b;
      actions.push({
        kind: "pause",
        id,
        reason: `“${missing.title}” isn't open in this window. Open it to continue.`,
        blockedBy: missing.sessionId,
      });
      continue;
    }
    const waiting = sessionNeedsInput(a)
      ? "a"
      : sessionNeedsInput(b)
        ? "b"
        : null;
    if (waiting) {
      actions.push({
        kind: "pause",
        id,
        reason: `“${discussionParty(discussion, waiting).title}” ${deliveryBlocker(
          waiting === "a" ? a : b,
        )}.`,
        blockedBy: (waiting === "a" ? a : b).id,
      });
      continue;
    }
    const side = speakingSide(discussion);
    const speaker = side === "a" ? a : b;
    const party = discussionParty(discussion, side);
    if (!discussion.delivered) {
      const blocker = deliveryBlocker(speaker);
      actions.push(
        blocker
          ? {
              kind: "pause",
              id,
              reason: `“${party.title}” ${blocker}.`,
              blockedBy: speaker.id,
            }
          : { kind: "deliver", id, sessionId: speaker.id },
      );
      continue;
    }
    if (inFlight.has(id)) continue;
    // Sent before a reload (or the turn was otherwise lost to this window).
    if (speaker.busy) {
      actions.push({
        kind: "pause",
        id,
        reason: `“${party.title}” is busy with another turn.`,
        blockedBy: speaker.id,
      });
      continue;
    }
    const reply = discussionReply(speaker.blocks, id, discussion.settled);
    actions.push(
      reply
        ? { kind: "recover", id, turn: discussion.settled, reply }
        : { kind: "redeliver", id },
    );
  }
  return actions;
}

// --- Sidebar -----------------------------------------------------------------

/** Serializable sidebar data: which rows are talking, and who answers. */
export type SidebarDiscussion = {
  id: string;
  a: { sessionId: string; title: string };
  b: { sessionId: string; title: string };
  speaking: DiscussionSide;
  paused: boolean;
};

export function sidebarDiscussions(
  discussions: readonly Discussion[],
): SidebarDiscussion[] {
  return discussions
    .filter((discussion) => discussion.status !== "ended")
    .map((discussion) => ({
      id: discussion.id,
      a: { sessionId: discussion.a.sessionId, title: discussion.a.title },
      b: { sessionId: discussion.b.sessionId, title: discussion.b.title },
      speaking: speakingSide(discussion),
      paused: discussion.status === "paused",
    }));
}

/** One sidebar row's part in a discussion. */
export type SidebarTalk = {
  id: string;
  partnerId: string;
  partnerTitle: string;
  /** This row's agent is answering now. */
  speaking: boolean;
  paused: boolean;
};

export function sidebarTalks(
  discussions: readonly SidebarDiscussion[],
): Map<string, SidebarTalk> {
  const talks = new Map<string, SidebarTalk>();
  for (const discussion of discussions) {
    for (const side of ["a", "b"] as const) {
      const self = discussion[side];
      const partner = discussion[otherSide(side)];
      if (talks.has(self.sessionId)) continue;
      talks.set(self.sessionId, {
        id: discussion.id,
        partnerId: partner.sessionId,
        partnerTitle: partner.title,
        speaking: discussion.speaking === side,
        paused: discussion.paused,
      });
    }
  }
  return talks;
}

// --- Persistence ---------------------------------------------------------------

type DiscussionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const HARNESS_IDS = new Set<string>(Object.keys(HARNESS_TITLE));

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function readParty(value: unknown): DiscussionParty | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionId = text(record.sessionId, 200);
  const harness = text(record.harness, 40);
  const model = text(record.model, 200);
  const title = text(record.title, 500);
  const cwd = text(record.cwd, 4096);
  if (!sessionId || !harness || !HARNESS_IDS.has(harness)) return null;
  if (model == null || title == null || cwd == null) return null;
  return { sessionId, harness: harness as HarnessId, model, title, cwd };
}

/** Restore one persisted discussion, or null when it is not one. */
export function readDiscussion(value: unknown): Discussion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 200);
  const owner = text(record.owner, 200);
  const a = readParty(record.a);
  const b = readParty(record.b);
  const topic = text(record.topic, RELAY_CHAR_LIMIT * 2);
  const relay = text(record.relay, RELAY_CHAR_LIMIT * 2);
  const status = record.status;
  const settled = record.settled;
  if (!id || !owner || !a || !b || topic == null || relay == null) return null;
  if (status !== "active" && status !== "paused" && status !== "ended")
    return null;
  if (typeof settled !== "number" || !Number.isInteger(settled) || settled < 0)
    return null;
  const rounds = clampRounds(Number(record.rounds));
  if (settled > rounds * 2) return null;
  const ended = readEnding(record.ended);
  const notes = Array.isArray(record.notes)
    ? record.notes.filter(
        (side): side is DiscussionSide => side === "a" || side === "b",
      )
    : undefined;
  const reason = text(record.reason, 1000);
  const blockedBy = text(record.blockedBy, 200);
  return {
    id,
    owner,
    a,
    b,
    topic,
    rounds,
    settled,
    relay,
    ...(record.truncated === true ? { truncated: true } : {}),
    delivered: record.delivered === true,
    status,
    ...(reason ? { reason } : {}),
    ...(blockedBy && status === "paused" ? { blockedBy } : {}),
    ...(status === "ended" && ended ? { ended } : {}),
    ...(status === "ended" ? { notes: notes ?? [] } : {}),
    startedAt: Number(record.startedAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
  };
}

const ENDINGS = new Set([
  "completed",
  "stopped",
  "failed",
  "cancelled",
  "closed",
]);

function readEnding(value: unknown): DiscussionEnding | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || !ENDINGS.has(record.kind)) return null;
  return {
    kind: record.kind as DiscussionEnding["kind"],
    ...(record.side === "a" || record.side === "b"
      ? { side: record.side }
      : {}),
  };
}

function readAll(storage: DiscussionStorage | undefined): Discussion[] {
  try {
    const raw = storage?.getItem(DISCUSSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => readDiscussion(value) ?? []);
  } catch {
    return [];
  }
}

export const RELOAD_REASON =
  "Paused when its window reloaded or closed. Resume to continue.";

/**
 * Discussions for every window, shared through `aven.discussions`. A window
 * changes only the discussions it owns and mirrors the rest for display. One
 * owned by another window is adopted when the user stops or resumes it here,
 * so a discussion never stays stuck to a window that closed. Concurrent
 * writes to the same discussion resolve to the newest.
 */
export class DiscussionStore {
  private list: readonly Discussion[];
  private readonly listeners = new Set<() => void>();
  /** This window's discussions as last written, to notice removals elsewhere. */
  private persisted = new Set<string>();

  constructor(
    private readonly storage: DiscussionStorage | undefined,
    readonly owner: string,
    private readonly now: () => number = Date.now,
  ) {
    // A reload loses the turns in flight: show this window's discussions
    // paused rather than lost.
    let changed = false;
    this.list = readAll(storage).map((discussion) => {
      if (discussion.owner !== owner || discussion.status !== "active")
        return discussion;
      changed = true;
      return pauseDiscussion(discussion, RELOAD_REASON, this.now());
    });
    this.persisted = new Set(
      this.list
        .filter((discussion) => this.owns(discussion))
        .map((discussion) => discussion.id),
    );
    if (changed) this.save();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = (): readonly Discussion[] => this.list;

  get(id: string): Discussion | undefined {
    return this.list.find((discussion) => discussion.id === id);
  }

  /** The unfinished discussion this chat is in, if any. */
  forSession(sessionId: string): Discussion | undefined {
    return this.list.find(
      (discussion) =>
        discussion.status !== "ended" &&
        discussionSideOf(discussion, sessionId) !== null,
    );
  }

  owns(discussion: Discussion): boolean {
    return discussion.owner === this.owner;
  }

  start(input: {
    id?: string;
    a: DiscussionParty;
    b: DiscussionParty;
    topic: string;
    rounds: number;
    preview?: boolean;
  }): Discussion {
    if (input.a.sessionId === input.b.sessionId)
      throw new Error("A chat can't discuss with itself.");
    for (const party of [input.a, input.b])
      if (this.forSession(party.sessionId))
        throw new Error(`“${party.title}” is already in a discussion.`);
    if (!input.topic.trim()) throw new Error("Add a topic to discuss.");
    const discussion = createDiscussion({
      id: input.id ?? crypto.randomUUID(),
      owner: this.owner,
      a: input.a,
      b: input.b,
      topic: input.topic,
      rounds: input.rounds,
      now: this.now(),
      preview: input.preview,
    });
    this.commit([...this.list, discussion]);
    return discussion;
  }

  private change(id: string, next: (discussion: Discussion) => Discussion) {
    const current = this.get(id);
    if (!current || !this.owns(current)) return;
    const updated = next(current);
    if (updated === current) return;
    const stamped = {
      ...updated,
      updatedAt: Math.max(this.now(), current.updatedAt),
    };
    this.commit(
      this.list.map((discussion) =>
        discussion.id === id ? stamped : discussion,
      ),
    );
  }

  /** Take over a discussion another window owns. */
  adopt(id: string) {
    const current = this.get(id);
    if (!current || this.owns(current)) return;
    const adopted = {
      ...current,
      owner: this.owner,
      updatedAt: Math.max(this.now(), current.updatedAt + 1),
    };
    this.commit(
      this.list.map((discussion) =>
        discussion.id === id ? adopted : discussion,
      ),
    );
  }

  markDelivered(id: string) {
    this.change(id, (discussion) =>
      discussion.delivered ? discussion : { ...discussion, delivered: true },
    );
  }

  redeliver(id: string) {
    this.change(id, (discussion) =>
      discussion.delivered ? { ...discussion, delivered: false } : discussion,
    );
  }

  /** The turn that started after `turn` turns finished has ended. */
  settle(id: string, turn: number, outcome: DiscussionOutcome) {
    this.change(id, (discussion) =>
      discussion.settled === turn
        ? settleDiscussion(discussion, outcome, this.now())
        : discussion,
    );
  }

  pause(id: string, reason: string, blockedBy?: string) {
    this.change(id, (discussion) =>
      pauseDiscussion(discussion, reason, this.now(), blockedBy),
    );
  }

  /** The chat it paused for is free again. */
  ready(id: string) {
    this.change(id, (discussion) => {
      if (discussion.status !== "paused" || !discussion.blockedBy)
        return discussion;
      const ready = { ...discussion, reason: READY_REASON };
      delete ready.blockedBy;
      return ready;
    });
  }

  /** This window is going away: its turns in flight go with it. */
  pauseAll(reason = RELOAD_REASON) {
    for (const discussion of this.list)
      if (
        this.owns(discussion) &&
        !discussion.preview &&
        discussion.status === "active"
      )
        this.pause(discussion.id, reason);
  }

  resume(id: string) {
    this.adopt(id);
    this.change(id, (discussion) => resumeDiscussion(discussion, this.now()));
  }

  /** The user pressed Stop discussion. */
  stop(id: string) {
    const current = this.get(id);
    if (current?.preview && this.owns(current)) {
      this.remove(id);
      return;
    }
    this.adopt(id);
    this.end(id, { kind: "stopped" });
  }

  end(id: string, ended: DiscussionEnding) {
    this.change(id, (discussion) =>
      endDiscussion(discussion, ended, this.now()),
    );
  }

  /** Keep names current as chats are retitled or switch models. */
  refreshParties(id: string, a: DiscussionParty, b: DiscussionParty) {
    this.change(id, (discussion) =>
      samePartyLabel(discussion.a, a) && samePartyLabel(discussion.b, b)
        ? discussion
        : { ...discussion, a, b },
    );
  }

  notePosted(id: string, side: DiscussionSide) {
    const current = this.get(id);
    if (!current || !this.owns(current)) return;
    const notes = (current.notes ?? []).filter((entry) => entry !== side);
    if (notes.length === 0) {
      this.remove(id);
      return;
    }
    this.change(id, (discussion) => ({ ...discussion, notes }));
  }

  remove(id: string) {
    const current = this.get(id);
    if (!current || !this.owns(current)) return;
    this.commit(this.list.filter((discussion) => discussion.id !== id));
  }

  /** Development preview: swap who is answering. */
  flipPreviews() {
    const list = this.list.map((discussion) =>
      discussion.preview && this.owns(discussion)
        ? {
            ...discussion,
            settled: (discussion.settled + 1) % (discussion.rounds * 2),
          }
        : discussion,
    );
    if (list.some((discussion, index) => discussion !== this.list[index]))
      this.commit(list);
  }

  /** Another window changed `aven.discussions`: mirror it. */
  sync() {
    const stored = new Map(
      readAll(this.storage).map((discussion) => [discussion.id, discussion]),
    );
    const next: Discussion[] = [];
    for (const discussion of this.list) {
      if (discussion.preview) {
        next.push(discussion);
        continue;
      }
      if (!this.owns(discussion)) continue;
      const there = stored.get(discussion.id);
      // Adopted by another window, or ended and cleared there.
      if (taken(there, discussion, this.owner)) continue;
      if (!there && this.persisted.has(discussion.id)) continue;
      next.push(discussion);
      stored.delete(discussion.id);
    }
    for (const discussion of stored.values())
      if (discussion.owner !== this.owner) next.push(discussion);
    if (JSON.stringify(next) === JSON.stringify(this.list)) return;
    this.list = next;
    this.persisted = new Set(
      next
        .filter((discussion) => this.owns(discussion) && !discussion.preview)
        .map((discussion) => discussion.id),
    );
    this.emit();
  }

  private commit(list: readonly Discussion[]) {
    this.list = list;
    this.save();
    this.emit();
  }

  private save() {
    if (!this.storage) return;
    try {
      const mine = new Map(
        this.list
          .filter((discussion) => this.owns(discussion) && !discussion.preview)
          .map((discussion) => [discussion.id, discussion]),
      );
      const written: Discussion[] = [];
      const yielded = new Map<string, Discussion>();
      for (const there of readAll(this.storage)) {
        const own = mine.get(there.id);
        if (own) {
          if (taken(there, own, this.owner)) yielded.set(there.id, there);
          continue;
        }
        // This window's own entries that are gone here were removed here.
        if (there.owner !== this.owner) written.push(there);
      }
      for (const discussion of mine.values())
        written.push(yielded.get(discussion.id) ?? discussion);
      if (written.length)
        this.storage.setItem(DISCUSSIONS_KEY, JSON.stringify(written));
      else this.storage.removeItem(DISCUSSIONS_KEY);
      this.persisted = new Set(
        [...mine.keys()].filter((id) => !yielded.has(id)),
      );
      if (yielded.size)
        this.list = this.list.map(
          (discussion) => yielded.get(discussion.id) ?? discussion,
        );
    } catch {
      // Storage full or unavailable: the discussion still runs in this window.
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

/** Another window wrote this discussion as its own, at least as recently. */
function taken(
  there: Discussion | undefined,
  own: Discussion,
  owner: string,
): boolean {
  return !!there && there.owner !== owner && there.updatedAt >= own.updatedAt;
}

function samePartyLabel(left: DiscussionParty, right: DiscussionParty) {
  return (
    left.sessionId === right.sessionId &&
    left.harness === right.harness &&
    left.model === right.model &&
    left.title === right.title &&
    left.cwd === right.cwd
  );
}

let shared: DiscussionStore | null = null;
let ownerOverride: string | null = null;

/** The label of the window this code runs in; it owns what it starts. */
function currentWindowLabel(): string {
  if (ownerOverride) return ownerOverride;
  try {
    return isTauri() ? getCurrentWindow().label : "main";
  } catch {
    return "main";
  }
}

/** This window's discussion store. */
export function discussionStore(): DiscussionStore {
  if (shared) return shared;
  const storage =
    typeof localStorage === "undefined" ? undefined : localStorage;
  const store = new DiscussionStore(storage, currentWindowLabel());
  shared = store;
  if (typeof window !== "undefined" && window.addEventListener)
    window.addEventListener("storage", (event) => {
      if (event.key === DISCUSSIONS_KEY && shared === store) store.sync();
    });
  return store;
}

/** Tests: forget the shared store, optionally as another window. */
export function resetDiscussionStore(owner: string | null = null) {
  shared = null;
  ownerOverride = owner;
}
