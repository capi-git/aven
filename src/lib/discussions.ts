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
 *
 * Jumping in: the user can add a message for both chats from the
 * discussion's panel or the starting chat's message box. It is stored with the discussion as an interjection
 * tied to the first turn whose relay has not been sent yet, and rides two
 * relays: that turn's, to the chat speaking next, and the following one, to
 * its partner. Both chats therefore see it exactly once, in order, without
 * any turn being interrupted or any extra message being sent.
 */
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readAgentRole, roleBrief, type AgentRoleId } from "./agentRoles";
import { logError } from "./errors";
import { isPreparingHandoff } from "./handoff";
import {
  HARNESS_TITLE,
  hasPendingApproval,
  sessionNeedsInput,
  type Block,
  type DiscussionRelayMeta,
  type DiscussionWrapUpMeta,
  type HarnessId,
  type Session,
} from "./session";

export const DISCUSSIONS_KEY = "aven.discussions";
/**
 * Finished discussions each window keeps to open again, newest first. A
 * finished one also goes when the chat that started it is deleted or
 * archived (`forgetChat`, `forgetArchived`).
 */
export const DISCUSSION_HISTORY_LIMIT = 100;
/** The longest topic a discussion keeps; a longer one is not started. */
export const DISCUSSION_TOPIC_LIMIT = 16_000;
export const DISCUSSION_MIN_ROUNDS = 1;
export const DISCUSSION_MAX_ROUNDS = 6;
export const DISCUSSION_DEFAULT_ROUNDS = 3;
/** Longest reply relayed as is; longer replies are shortened, with a note. */
export const RELAY_CHAR_LIMIT = 8_000;
/**
 * Rounds a discussion can reach by continuing it from its page. Starting one
 * offers up to `DISCUSSION_MAX_ROUNDS`.
 */
export const DISCUSSION_ROUNDS_LIMIT = 12;
/** Longest message the user can add to a discussion. */
export const INTERJECTION_CHAR_LIMIT = 1_500;
/** Messages the user can add to one discussion; they persist with it. */
export const INTERJECTION_LIMIT = 10;
/** Items in each list of a discussion's wrap-up. */
export const SUMMARY_ITEM_LIMIT = 4;
/** Longest wrap-up item kept. */
export const SUMMARY_ITEM_CHARS = 160;

export type DiscussionSide = "a" | "b";

export type DiscussionParty = {
  sessionId: string;
  harness: HarnessId;
  /** Model display name, e.g. "GPT-5". */
  model: string;
  /** Chat title without the provider prefix. */
  title: string;
  cwd: string;
  /**
   * The role the other chat was brought in with (side B only): added once
   * to its first relayed message, kept with this discussion alone.
   */
  role?: AgentRoleId;
};

export type DiscussionStatus = "active" | "paused" | "ended";

/** Why a discussion ended; `side` names the chat that caused it. */
export type DiscussionEnding = {
  kind: "completed" | "stopped" | "cancelled";
  side?: DiscussionSide;
};

/**
 * A message the user added for both chats during a discussion. It is
 * not in either transcript the way replies are, so it is kept here.
 */
export type DiscussionInterjection = {
  id: string;
  text: string;
  /**
   * The turn whose relay first carries it, to the chat speaking then; the
   * next turn's relay carries it on to the other chat.
   */
  turn: number;
  at: number;
};

/**
 * Where a finished discussion landed, written once by the cheapest model
 * (see `discussionWrapUp`). Only discussions that used up their rounds get
 * one; stopped ones never do.
 */
export type DiscussionSummary =
  /** Waiting for the window that drives it. */
  | { status: "pending" }
  /** A model is summing up now. */
  | { status: "running"; since: number }
  | { status: "done"; agreed: string[]; open: string[]; model: string }
  /** No cheap model, or the call failed: the page shows no lists. */
  | { status: "failed" };

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
  /** What the user added for both chats, oldest first. */
  interjections?: DiscussionInterjection[];
  /** Where it landed, once it has used up its rounds. */
  summary?: DiscussionSummary;
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

/** The rounds the composer's Discuss mode offers first: the last ones used. */
export const DISCUSSION_ROUNDS_KEY = "aven.discussionRounds";

export function loadDiscussionRounds(): number {
  try {
    const raw = localStorage.getItem(DISCUSSION_ROUNDS_KEY);
    return raw ? clampRounds(Number(raw)) : DISCUSSION_DEFAULT_ROUNDS;
  } catch {
    return DISCUSSION_DEFAULT_ROUNDS;
  }
}

export function saveDiscussionRounds(rounds: number) {
  try {
    localStorage.setItem(DISCUSSION_ROUNDS_KEY, String(clampRounds(rounds)));
  } catch {
    // Unavailable storage only loses the preference.
  }
}

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

/**
 * The user's messages this turn's relay carries: those its partner already
 * saw (`carried`, sent before the partner's reply) and those added since
 * (`fresh`, after it). Every message rides exactly two relays, one to each
 * chat.
 */
export function relayInterjections(
  discussion: Discussion,
  turn = discussion.settled,
): { carried: DiscussionInterjection[]; fresh: DiscussionInterjection[] } {
  const all = discussion.interjections ?? [];
  return {
    carried: all.filter((entry) => entry.turn === turn - 1),
    fresh: all.filter((entry) => entry.turn === turn),
  };
}

function userAdds(entry: DiscussionInterjection): string {
  return entry.text.includes("\n")
    ? `The user adds:\n\n${entry.text}`
    : `The user adds: ${entry.text}`;
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
  const { carried, fresh } = relayInterjections(discussion);
  const parts: string[] = [];
  if (turn <= 1)
    parts.push(framing(sender, discussion.rounds), `Topic: ${topic}`);
  const brief = partnerBrief(discussion);
  if (brief) parts.push(brief);
  if (turn === 0) {
    parts.push(...fresh.map(userAdds));
    return parts.join("\n\n");
  }
  parts.push(...carried.map(userAdds));
  // A continued discussion whose last reply can't be read sends only the
  // user's message.
  if (discussion.relay) {
    parts.push(`${partyLabel(sender)} says:`, discussion.relay);
    if (discussion.truncated)
      parts.push(
        `[Aven shortened this message to ${limit.toLocaleString("en-US")} characters.]`,
      );
  }
  parts.push(...fresh.map(userAdds));
  const last = turn >= discussion.rounds * 2 - 2;
  parts.push(
    `(Round ${discussionRound(discussion)} of ${discussion.rounds}.${
      last ? " This is your last reply in this discussion." : ""
    })`,
  );
  return parts.join("\n\n");
}

/**
 * The partner's role, said once: in the first message it receives (turn 1,
 * its first reply), and never again.
 */
function partnerBrief(discussion: Discussion): string | null {
  const role = discussion.b.role;
  return role && discussion.settled === 1
    ? roleBrief(role, "in this discussion")
    : null;
}

/**
 * What the receiving transcript shows for this turn's relay: the other
 * chat's reply (or the topic). The partner chat sees the user's own
 * messages around it in the order the agent reads them, and its role in
 * its first one; the chat that started it shows the user's messages as
 * their own messages instead (`added` in `relayBlockMeta`), so its text is
 * the reply alone.
 */
export function relayDisplayText(discussion: Discussion): string {
  if (speakingSide(discussion) === "a") return discussion.relay;
  const { carried, fresh } = relayInterjections(discussion);
  const added = (entry: DiscussionInterjection) => `You added: ${entry.text}`;
  const brief = partnerBrief(discussion);
  return [
    ...(brief ? [brief] : []),
    ...carried.map(added),
    ...(discussion.relay ? [discussion.relay] : []),
    ...fresh.map(added),
  ].join("\n\n");
}

/** The user-side block this turn adds to the receiving transcript. */
export function relayBlockMeta(discussion: Discussion): DiscussionRelayMeta {
  const side = speakingSide(discussion);
  const self = discussionParty(discussion, side);
  const partner = discussionParty(discussion, otherSide(side));
  const { carried, fresh } = relayInterjections(discussion);
  const text = (entry: DiscussionInterjection) => entry.text;
  const added =
    side === "a" && (carried.length || fresh.length)
      ? {
          ...(carried.length ? { before: carried.map(text) } : {}),
          ...(fresh.length ? { after: fresh.map(text) } : {}),
        }
      : null;
  return {
    id: discussion.id,
    turn: discussion.settled,
    rounds: discussion.rounds,
    partner: {
      harness: partner.harness,
      model: partner.model,
      title: partner.title,
      cwd: partner.cwd,
      sessionId: partner.sessionId,
    },
    self: {
      sessionId: self.sessionId,
      harness: self.harness,
      model: self.model,
    },
    ...(added ? { added } : {}),
    ...(discussion.truncated ? { truncated: true } : {}),
  };
}

/**
 * The other chat's last reply, copied into the chat that started the
 * discussion when it ends: that reply is never relayed there. Shaped like
 * the relay that would have carried it, at the turn after it.
 */
export function finalReplyMeta(
  discussion: Discussion,
  truncated: boolean,
  at: number,
): DiscussionRelayMeta {
  const meta = relayBlockMeta({ ...discussion, truncated });
  return { ...meta, at };
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
    case "cancelled":
      return `Discussion ended: ${title} was stopped.`;
    default:
      return done > 0
        ? `Discussion stopped after ${plural(done, "round")} of ${discussion.rounds}.`
        : `Discussion stopped during round 1 of ${discussion.rounds}.`;
  }
}

/**
 * What the closing note in the chat that started a discussion carries, so
 * its transcript can show where they landed: only for a discussion that
 * used up its rounds, with the lists once they are written. Stopped ones
 * are never summed up, so they get nothing.
 */
export function discussionWrapUpMeta(
  discussion: Discussion,
): DiscussionWrapUpMeta | undefined {
  if (discussion.status !== "ended" || discussion.ended?.kind !== "completed")
    return undefined;
  const { summary } = discussion;
  return {
    id: discussion.id,
    settled: discussion.settled,
    ...(summary?.status === "done"
      ? { agreed: summary.agreed, open: summary.open }
      : {}),
  };
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
  const next: Discussion = {
    ...discussion,
    status: "ended",
    reason: undefined,
    ended,
    notes: discussion.preview ? [] : ["a", "b"],
    updatedAt: now,
  };
  // Only a discussion that used up its rounds is summed up.
  if (ended.kind === "completed" && !discussion.preview)
    next.summary = { status: "pending" };
  else delete next.summary;
  return next;
}

/**
 * Apply the speaking chat's finished turn. A reply moves the discussion to the
 * other chat (or ends it after the last round); stopping the turn ends it; an
 * error, or a turn with nothing to relay, pauses it so the user can decide.
 * Resuming after an error sends the same message again.
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
  if (outcome.status === "failed") {
    const failed: Discussion = {
      ...discussion,
      status: "paused",
      delivered: false,
      reason: `“${discussionParty(discussion, side).title}” ran into an error. Resume to try again.`,
      updatedAt: now,
    };
    delete failed.blockedBy;
    return failed;
  }
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

/**
 * What sending a message to both chats does now:
 * - `queue`: it goes with the next relay; the turn under way is left alone.
 * - `resume`: the paused discussion continues, with the message.
 * - `extend`: the last reply is under way, so one more round carries it.
 * - `continue`: it has ended; one more round from where it stopped starts
 *   with the message.
 */
export type JumpInPlan =
  | {
      kind: "queue" | "resume" | "extend" | "continue";
      /** The turn whose relay carries it first. */
      turn: number;
      /** The rounds the discussion will have. */
      rounds: number;
    }
  | { kind: "blocked"; reason: string };

export function jumpInPlan(discussion: Discussion): JumpInPlan {
  if (discussion.preview)
    return { kind: "blocked", reason: "A preview can't take messages." };
  if ((discussion.interjections?.length ?? 0) >= INTERJECTION_LIMIT)
    return {
      kind: "blocked",
      reason: `You've added ${INTERJECTION_LIMIT} messages, the most one discussion keeps.`,
    };
  const ended = discussion.status === "ended";
  const { settled } = discussion;
  // A relay already sent (the turn under way) keeps its message; anything
  // new goes with the next one.
  const turn = !ended && discussion.delivered ? settled + 1 : settled;
  // Ended: the round it stopped in is finished first when the responding
  // chat was interrupted, so the message still reaches both chats.
  const rounds = ended
    ? Math.floor((settled + 1) / 2) + 1
    : turn >= discussion.rounds * 2
      ? discussion.rounds + 1
      : discussion.rounds;
  if (rounds > DISCUSSION_ROUNDS_LIMIT)
    return {
      kind: "blocked",
      reason: `This discussion has had ${plural(DISCUSSION_ROUNDS_LIMIT, "round")}, the most one can have.`,
    };
  const kind = ended
    ? "continue"
    : rounds > discussion.rounds
      ? "extend"
      : discussion.status === "paused"
        ? "resume"
        : "queue";
  return { kind, turn, rounds };
}

/** The user's message as stored: trimmed and capped. */
export function capInterjection(text: string): string {
  return capRelay(text, INTERJECTION_CHAR_LIMIT).text;
}

/** Add the user's message as `jumpInPlan` describes. */
export function interjectDiscussion(
  discussion: Discussion,
  input: { id: string; text: string; now: number },
): Discussion {
  const plan = jumpInPlan(discussion);
  const text = capInterjection(input.text);
  if (plan.kind === "blocked" || !text) return discussion;
  const ended = discussion.status === "ended";
  // A message that never reached anyone before the end goes first now.
  const earlier = (discussion.interjections ?? []).map((entry) =>
    ended && entry.turn > plan.turn ? { ...entry, turn: plan.turn } : entry,
  );
  const next: Discussion = {
    ...discussion,
    rounds: plan.rounds,
    interjections: [
      ...earlier,
      { id: input.id, text, turn: plan.turn, at: input.now },
    ],
    status: "active",
    updatedAt: input.now,
  };
  delete next.reason;
  delete next.blockedBy;
  if (ended) {
    // The reply to pass on is read back from its chat when the turn is sent
    // (`continuationRelay`); the opening turn passes the topic again.
    next.delivered = false;
    next.relay =
      discussion.settled === 0 ? capRelay(discussion.topic).text : "";
    delete next.truncated;
    delete next.ended;
    delete next.notes;
    delete next.summary;
  }
  return next;
}

/**
 * The reply a continued discussion passes on, read from the chat that wrote
 * it: once a discussion ends Aven no longer keeps it. Null when that chat is
 * not open here; "" when it has no reply to pass on.
 */
export function continuationRelay(
  discussion: Discussion,
  sessions: readonly Session[],
): { text: string; truncated: boolean } | null {
  const turn = discussion.settled - 1;
  if (turn < 0)
    return { text: capRelay(discussion.topic).text, truncated: false };
  const writer = discussionParty(discussion, turn % 2 === 0 ? "a" : "b");
  const session = sessions.find((entry) => entry.id === writer.sessionId);
  if (!session) return null;
  return capRelay(discussionReply(session.blocks, discussion.id, turn) ?? "");
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

/**
 * Copy where a discussion landed into the closing note for that ending in
 * the chat that started it, so the transcript keeps the lists after Aven
 * stops keeping the discussion. The same session when there is no such
 * note or it already has them.
 */
export function captureDiscussionWrapUp(
  session: Session,
  wrapUp: DiscussionWrapUpMeta,
): Session {
  if (!wrapUp.agreed || !wrapUp.open) return session;
  let index = -1;
  for (let at = session.blocks.length - 1; at >= 0; at -= 1) {
    const meta = session.blocks[at].discussionEnd;
    if (meta?.id === wrapUp.id && meta.settled === wrapUp.settled) {
      index = at;
      break;
    }
  }
  if (index < 0) return session;
  const block = session.blocks[index];
  const saved = block.discussionEnd!;
  if (
    sameItems(saved.agreed, wrapUp.agreed) &&
    sameItems(saved.open, wrapUp.open)
  )
    return session;
  const blocks = session.blocks.slice();
  blocks[index] = {
    ...block,
    discussionEnd: { ...saved, agreed: wrapUp.agreed, open: wrapUp.open },
  };
  return { ...session, blocks };
}

function sameItems(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  return (
    !!left &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
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
  /** The partner's role for this discussion, if any. */
  role?: AgentRoleId;
  /** Development builds: show the animation only; nothing is sent. */
  preview?: boolean;
};

/** What the composer's Discuss mode needs from the window that drives discussions. */
export type DiscussionHost = {
  options(sessionId: string): {
    /** Why this chat cannot start one now. */
    blocked?: string;
    candidates: DiscussionCandidate[];
  };
  /** Starts it and opens its conversation page; returns why it could not start, or null. */
  start(request: DiscussionStartRequest): string | null;
  /** Shows the discussion's conversation page, opening it where needed. */
  open?(id: string): void;
  /** Shows `side`'s chat in this window, as its sidebar row does. */
  show?(id: string, side: DiscussionSide): void;
  /**
   * Shows `side`'s chat and sends it, as the user, a message asking it to
   * carry out the plan the discussion landed on, loading that chat first if
   * it was parked. Resolves why it could not, or null.
   */
  build?(
    id: string,
    side: DiscussionSide,
  ): string | null | Promise<string | null>;
  /** Development builds offer a preview of the sidebar animation. */
  preview?: boolean;
};

// --- Planner -------------------------------------------------------------------

/**
 * Without a way to load chats, every chat that isn't loaded counts as one
 * that couldn't be, as before: tests and other windows plan this way.
 */
const ALL_CHATS_UNAVAILABLE: ReadonlySet<string> = {
  has: () => true,
} as unknown as ReadonlySet<string>;

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
      /** The starting chat's note on a finished discussion: where they landed. */
      wrapUp?: DiscussionWrapUpMeta;
    }
  | { kind: "recover"; id: string; turn: number; reply: string }
  | { kind: "redeliver"; id: string }
  /**
   * A chat it needs is not loaded (a new partner has no tab, so it was
   * parked): load it, then carry on. Only a chat that can't be loaded
   * pauses the discussion or drops its note.
   */
  | { kind: "load"; id: string; sessionId: string }
  /** It used up its rounds: sum up where it landed, once. */
  | { kind: "summarise"; id: string };

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
  /** Chats this window tried to load and could not (deleted, or gone). */
  unavailable: ReadonlySet<string> = ALL_CHATS_UNAVAILABLE,
): DiscussionAction[] {
  const actions: DiscussionAction[] = [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const discussion of discussions) {
    if (discussion.owner !== owner || discussion.preview) continue;
    const { id } = discussion;
    if (discussion.status === "ended") {
      if (discussion.summary?.status === "pending")
        actions.push({ kind: "summarise", id });
      for (const side of discussion.notes ?? []) {
        const chat = discussionParty(discussion, side).sessionId;
        const session = byId.get(chat);
        if (!session && !unavailable.has(chat)) {
          actions.push({ kind: "load", id, sessionId: chat });
          continue;
        }
        // A note waits for the chat to be idle, so it never splits a reply.
        if (session?.busy) continue;
        // Only the chat that started it shows where they landed.
        const wrapUp = side === "a" ? discussionWrapUpMeta(discussion) : null;
        actions.push({
          kind: "note",
          id,
          side,
          ...(session ? { sessionId: session.id } : {}),
          text: discussionEndNote(discussion),
          ...(wrapUp ? { wrapUp } : {}),
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
      actions.push(
        unavailable.has(missing.sessionId)
          ? {
              kind: "pause",
              id,
              reason: `“${missing.title}” couldn't be opened. Open it from the sidebar to continue.`,
              blockedBy: missing.sessionId,
            }
          : { kind: "load", id, sessionId: missing.sessionId },
      );
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

// --- Keeping chats loaded ------------------------------------------------------

/**
 * Discussions whose chats this window keeps loaded without a tab: running
 * or paused, or ended with a closing note still to post. A finished one
 * lets them go.
 */
export function keptDiscussions(
  discussions: readonly Discussion[],
  owner?: string,
): Discussion[] {
  return discussions.filter(
    (discussion) =>
      !discussion.preview &&
      (owner === undefined || discussion.owner === owner) &&
      (discussion.status !== "ended" || (discussion.notes ?? []).length > 0),
  );
}

/** The chats `keptDiscussions` keeps loaded. */
export function keptDiscussionChats(
  discussions: readonly Discussion[],
  owner?: string,
): string[] {
  return keptDiscussions(discussions, owner).flatMap((discussion) => [
    discussion.a.sessionId,
    discussion.b.sessionId,
  ]);
}

/**
 * The chat that started each kept discussion, and its partner: the
 * starting chat shows the partner's replies, so it on screen shows both.
 */
export function discussionCompanions(
  discussions: readonly Discussion[],
): Map<string, string[]> {
  const companions = new Map<string, string[]>();
  for (const discussion of keptDiscussions(discussions)) {
    const list = companions.get(discussion.a.sessionId) ?? [];
    list.push(discussion.b.sessionId);
    companions.set(discussion.a.sessionId, list);
  }
  return companions;
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

function readParty(value: unknown, withRole = false): DiscussionParty | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sessionId = text(record.sessionId, 200);
  const harness = text(record.harness, 40);
  const model = text(record.model, 200);
  const title = text(record.title, 500);
  const cwd = text(record.cwd, 4096);
  if (!sessionId || !harness || !HARNESS_IDS.has(harness)) return null;
  if (model == null || title == null || cwd == null) return null;
  const role = withRole ? readAgentRole(record.role) : undefined;
  return {
    sessionId,
    harness: harness as HarnessId,
    model,
    title,
    cwd,
    ...(role ? { role } : {}),
  };
}

/** Restore one persisted discussion, or null when it is not one. */
export function readDiscussion(value: unknown): Discussion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 200);
  const owner = text(record.owner, 200);
  const a = readParty(record.a);
  // Only the chat brought in has a role.
  const b = readParty(record.b, true);
  const topic = text(record.topic, RELAY_CHAR_LIMIT * 2);
  const relay = text(record.relay, RELAY_CHAR_LIMIT * 2);
  const status = record.status;
  const settled = record.settled;
  if (!id || !owner || !a || !b || topic == null || relay == null) return null;
  if (status !== "active" && status !== "paused" && status !== "ended")
    return null;
  if (typeof settled !== "number" || !Number.isInteger(settled) || settled < 0)
    return null;
  // Continuing from the page can take a discussion past the chip's six.
  const storedRounds = Number(record.rounds);
  const rounds = Number.isFinite(storedRounds)
    ? Math.min(
        DISCUSSION_ROUNDS_LIMIT,
        Math.max(DISCUSSION_MIN_ROUNDS, Math.round(storedRounds)),
      )
    : DISCUSSION_DEFAULT_ROUNDS;
  if (settled > rounds * 2) return null;
  const interjections = readInterjections(record.interjections, rounds);
  const summary = status === "ended" ? readSummary(record.summary) : null;
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
    ...(interjections.length ? { interjections } : {}),
    ...(summary ? { summary } : {}),
    startedAt: Number(record.startedAt) || 0,
    updatedAt: Number(record.updatedAt) || 0,
  };
}

function readInterjections(
  value: unknown,
  rounds: number,
): DiscussionInterjection[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry): DiscussionInterjection[] => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const id = text(record.id, 200);
      const said = text(record.text, INTERJECTION_CHAR_LIMIT + 1);
      const { turn } = record;
      if (!id || !said?.trim()) return [];
      if (
        typeof turn !== "number" ||
        !Number.isInteger(turn) ||
        turn < 0 ||
        turn > rounds * 2
      )
        return [];
      return [{ id, text: said, turn, at: Number(record.at) || 0 }];
    })
    .slice(0, INTERJECTION_LIMIT);
}

function readItems(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .flatMap((item) => {
      const line = text(item, SUMMARY_ITEM_CHARS + 1);
      return line?.trim() ? [line] : [];
    })
    .slice(0, SUMMARY_ITEM_LIMIT);
}

function readSummary(value: unknown): DiscussionSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  switch (record.status) {
    case "pending":
    case "failed":
      return { status: record.status };
    case "running":
      return { status: "running", since: Number(record.since) || 0 };
    case "done": {
      const agreed = readItems(record.agreed);
      const open = readItems(record.open);
      const model = text(record.model, 200) ?? "";
      return agreed && open ? { status: "done", agreed, open, model } : null;
    }
    default:
      return null;
  }
}

/** A closing note's wrap-up meta as stored with its transcript, or null. */
export function readDiscussionWrapUpMeta(
  value: unknown,
): DiscussionWrapUpMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = text(record.id, 200);
  const { settled } = record;
  if (!id || typeof settled !== "number" || !Number.isInteger(settled))
    return null;
  if (settled < 0) return null;
  const agreed = readItems(record.agreed);
  const open = readItems(record.open);
  return {
    id,
    settled,
    ...(agreed && open ? { agreed, open } : {}),
  };
}

const ENDINGS = new Set(["completed", "stopped", "cancelled"]);

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

/** Why a discussion paused for no one chat; shown after "Paused". */
export const RELOAD_REASON =
  "Its window reloaded or closed. Resume to continue.";

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
  /** What this window last wrote, so an unchanged save writes nothing. */
  private written: string | null | undefined;

  constructor(
    private readonly storage: DiscussionStorage | undefined,
    readonly owner: string,
    private readonly now: () => number = Date.now,
  ) {
    // A reload loses the turns in flight: show this window's discussions
    // paused rather than lost.
    let changed = false;
    this.list = readAll(storage).map((discussion) => {
      if (discussion.owner !== owner) return discussion;
      // A summary under way when the window went is written again, once.
      if (discussion.summary?.status === "running") {
        changed = true;
        discussion = { ...discussion, summary: { status: "pending" } };
      }
      // Finished ones an earlier version kept carry fields they no longer need.
      if (isHistory(discussion)) {
        const kept = compactHistory(discussion, discussion.updatedAt);
        if (JSON.stringify(kept) !== JSON.stringify(discussion)) changed = true;
        return kept;
      }
      if (discussion.summary?.status === "pending") return discussion;
      if (discussion.status !== "active") return discussion;
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
    // A longer one would not be read back after a reload.
    if (input.topic.length > DISCUSSION_TOPIC_LIMIT)
      throw new Error(
        `A discussion's topic can be up to ${DISCUSSION_TOPIC_LIMIT.toLocaleString("en-US")} characters. Shorten it to start.`,
      );
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

  /**
   * The user added a message for both chats from the page: it goes with the
   * next relay, resumes a paused discussion or continues an ended one for
   * one more round (see `jumpInPlan`). Returns why it could not, or null.
   */
  interject(id: string, text: string): string | null {
    const current = this.get(id);
    if (!current) return "This discussion is no longer available.";
    const plan = jumpInPlan(current);
    if (plan.kind === "blocked") return plan.reason;
    if (!text.trim()) return "Write something to add.";
    this.adopt(id);
    this.change(id, (discussion) =>
      interjectDiscussion(discussion, {
        id: crypto.randomUUID(),
        text,
        now: this.now(),
      }),
    );
    return null;
  }

  /** A continued discussion's reply to pass on, read back from its chat. */
  recoverRelay(id: string, relay: { text: string; truncated: boolean }) {
    this.change(id, (discussion) => {
      if (discussion.status === "ended" || discussion.delivered)
        return discussion;
      if (discussion.relay === relay.text) return discussion;
      const next = { ...discussion, relay: relay.text };
      if (relay.truncated) next.truncated = true;
      else delete next.truncated;
      return next;
    });
  }

  /** Start summing up: true when this call claimed it. */
  claimSummary(id: string): boolean {
    let claimed = false;
    this.change(id, (discussion) => {
      if (
        discussion.status !== "ended" ||
        discussion.summary?.status !== "pending"
      )
        return discussion;
      claimed = true;
      return {
        ...discussion,
        summary: { status: "running", since: this.now() },
      };
    });
    return claimed;
  }

  /**
   * The summary is written. It is kept only while the discussion is still
   * the one summed up: ended, after `settled` turns, and not continued since.
   */
  finishSummary(id: string, settled: number, summary: DiscussionSummary) {
    this.change(id, (discussion) =>
      discussion.status === "ended" &&
      discussion.settled === settled &&
      discussion.summary?.status === "running"
        ? { ...discussion, summary }
        : discussion,
    );
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
        : {
            ...discussion,
            a,
            // The role belongs to the discussion, not to the chat.
            b: discussion.b.role ? { ...b, role: discussion.b.role } : b,
          },
    );
  }

  /**
   * Both notes posted: the discussion is finished. It stays as history for
   * as long as the chat that started it exists (`forgetChat`), so its card
   * and panel can always be opened again. The record stays small: replies
   * are read from the chats' transcripts, so only who took part, the topic,
   * what the user added, how it ended and where they landed are kept.
   */
  notePosted(id: string, side: DiscussionSide) {
    const current = this.get(id);
    if (!current || !this.owns(current)) return;
    const notes = (current.notes ?? []).filter((entry) => entry !== side);
    if (notes.length > 0) {
      this.change(id, (discussion) => ({ ...discussion, notes }));
      return;
    }
    if (current.preview) {
      this.remove(id);
      return;
    }
    this.commit(
      this.list.map((discussion) =>
        discussion.id === id
          ? compactHistory(current, Math.max(this.now(), current.updatedAt))
          : discussion,
      ),
    );
  }

  /**
   * A chat was deleted. A discussion it started goes with it, wherever it
   * is driven; one it only answered in is stopped while it runs, and kept
   * once finished, since the chat that started it holds the replies.
   */
  forgetChat(sessionId: string) {
    for (const discussion of [...this.list]) {
      if (discussion.a.sessionId === sessionId) {
        this.adopt(discussion.id);
        this.remove(discussion.id);
      } else if (
        discussion.b.sessionId === sessionId &&
        discussion.status !== "ended"
      )
        this.stop(discussion.id);
    }
  }

  /**
   * A chat was archived: the finished discussions it started go, as its
   * other history is put away. Ones still running are left to finish.
   */
  forgetArchived(sessionId: string) {
    const gone = new Set(
      this.list
        .filter(
          (discussion) =>
            discussion.a.sessionId === sessionId &&
            this.owns(discussion) &&
            isHistory(discussion),
        )
        .map((discussion) => discussion.id),
    );
    if (gone.size)
      this.commit(this.list.filter((discussion) => !gone.has(discussion.id)));
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
    this.list = keepRecentHistory(list, this.owner);
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
      const raw = written.length ? JSON.stringify(written) : null;
      // Unchanged since this window last wrote it: nothing to write.
      if (raw !== this.written) {
        if (raw) this.storage.setItem(DISCUSSIONS_KEY, raw);
        else this.storage.removeItem(DISCUSSIONS_KEY);
        this.written = raw;
      }
      this.persisted = new Set(
        [...mine.keys()].filter((id) => !yielded.has(id)),
      );
      if (yielded.size)
        this.list = this.list.map(
          (discussion) => yielded.get(discussion.id) ?? discussion,
        );
    } catch (error) {
      // Storage full or unavailable: the discussion still runs in this
      // window, but would not survive a reload.
      this.written = undefined;
      logError("Couldn't save discussions", error);
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

/**
 * `list` with only this window's newest `DISCUSSION_HISTORY_LIMIT`
 * finished discussions: running ones, those with a note still to post and
 * other windows' are left alone.
 */
export function keepRecentHistory(
  list: readonly Discussion[],
  owner: string,
  limit = DISCUSSION_HISTORY_LIMIT,
): readonly Discussion[] {
  const history = list.filter(
    (discussion) => discussion.owner === owner && isHistory(discussion),
  );
  if (history.length <= limit) return list;
  const kept = new Set(
    [...history]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
      .map((discussion) => discussion.id),
  );
  return list.filter(
    (discussion) =>
      discussion.owner !== owner ||
      !isHistory(discussion) ||
      kept.has(discussion.id),
  );
}

/** Finished, with both closing notes posted: kept only to be shown again. */
export function isHistory(discussion: Discussion): boolean {
  return discussion.status === "ended" && (discussion.notes ?? []).length === 0;
}

/** A finished discussion as it is kept: without what only a running one needs. */
function compactHistory(discussion: Discussion, now: number): Discussion {
  const kept: Discussion = {
    ...discussion,
    notes: [],
    relay: "",
    delivered: false,
    updatedAt: now,
  };
  delete kept.truncated;
  delete kept.reason;
  delete kept.blockedBy;
  return kept;
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
