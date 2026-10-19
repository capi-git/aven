/**
 * One word for where each chat's work stands, worked out from what happened;
 * the user never sets it. The sidebar shows it on each row and the project
 * board sorts chats into columns by it.
 *
 * In order, the first that applies:
 * - **Needs you**: the chat waits on your approval or answer, or its team
 *   paused for you there (the one rule in `teamAttention`).
 * - **Working**, or the team's own word (**Racing**, **Discussing**,
 *   **Orchestrating**): a turn of its own is running, or a team it started,
 *   leads or belongs to is running.
 * - **Review**: a turn left changes that were not kept, undone or shipped
 *   since; or a race it started is ready to compare.
 * - **Shipped**: its changes went out through Ship it, and nothing newer
 *   waits for review.
 * - Nothing: an idle chat with nothing pending shows no word.
 */
import type { ChatReview } from "./chatReview";
import type { Session } from "./session";
import { holdUpHint, sessionHoldUps } from "./sessionHoldUp";
import type { ShippedChat } from "./shippedChats";
import { teamIsLive, type TeamKind, type TeamRun } from "./teamRuns";

export type ChatStatusWord =
  | "needs-you"
  | "working"
  | "racing"
  | "discussing"
  | "orchestrating"
  | "review"
  | "shipped";

export const CHAT_STATUS_LABEL: Readonly<Record<ChatStatusWord, string>> = {
  "needs-you": "Needs you",
  working: "Working",
  racing: "Racing",
  discussing: "Discussing",
  orchestrating: "Orchestrating",
  review: "Review",
  shipped: "Shipped",
};

/** What each word means, for its tooltip. */
export const CHAT_STATUS_HINT: Readonly<Record<ChatStatusWord, string>> = {
  "needs-you": "Waiting on your approval or answer",
  working: "Working on your request",
  racing: "Racing: several agents work on the same message",
  discussing: "Talking a question through with another chat",
  orchestrating: "A lead is sharing out the work to agents",
  review: "Has changes for you to review",
  shipped: "Its changes were shipped",
};

/**
 * What each working chat waits on, for its status tooltip in place of the
 * word's own hint: a retry, the usage limit or helper agents (see
 * `holdUpHint`). Chats with nothing holding them up are left out.
 */
export function chatHoldUpHints(
  sessions: readonly Session[],
  now = Date.now(),
): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const session of sessions) {
    const hint = holdUpHint(sessionHoldUps(session), now);
    if (hint) hints[session.id] = hint;
  }
  return hints;
}

/** The tooltip for a chat's word: what holds a working chat up, if anything. */
export function chatStatusHint(word: ChatStatusWord, holdUp?: string): string {
  return holdUp && chatStage(word) === "working"
    ? holdUp
    : CHAT_STATUS_HINT[word];
}

/** The board's four columns, which the words fall into. */
export type ChatStage = "needs-you" | "working" | "review" | "shipped";

export function chatStage(word: ChatStatusWord): ChatStage {
  return word === "racing" || word === "discussing" || word === "orchestrating"
    ? "working"
    : word;
}

const TEAM_WORD: Readonly<Record<TeamKind, ChatStatusWord>> = {
  discuss: "discussing",
  race: "racing",
  orchestrate: "orchestrating",
};

export type ChatStatusFacts = {
  /** Its own approval or question, or its team waits on you there. */
  needsYou?: boolean;
  /** A turn of its own is in flight. */
  working?: boolean;
  /** The kind of running team it started, leads or belongs to. */
  team?: TeamKind;
  /** A race it belongs to has no agent working and waits to be compared. */
  teamReady?: boolean;
  /** When its unreviewed changes were first seen as they are. */
  reviewAt?: number;
  /** When its changes last shipped. */
  shippedAt?: number;
};

/** The word for one chat, or null for none. */
export function chatStatusWord(facts: ChatStatusFacts): ChatStatusWord | null {
  if (facts.needsYou) return "needs-you";
  if (facts.team) return TEAM_WORD[facts.team];
  if (facts.working) return "working";
  if (facts.teamReady) return "review";
  if (
    facts.reviewAt !== undefined &&
    (facts.shippedAt === undefined || facts.reviewAt > facts.shippedAt)
  )
    return "review";
  if (facts.shippedAt !== undefined) return "shipped";
  return null;
}

/**
 * Whether a chat's changes went out through Ship it with nothing newer
 * left to review, as its word "Shipped" says.
 */
export function changesShipped(
  reviewAt: number | undefined,
  shippedAt: number | undefined,
): boolean {
  return chatStatusWord({ reviewAt, shippedAt }) === "shipped";
}

/** Every chat of a team: the one it started from and its members. */
function teamChats(team: TeamRun): string[] {
  return [
    ...(team.origin.sessionId ? [team.origin.sessionId] : []),
    ...team.members.map((member) => member.sessionId),
  ];
}

/**
 * The word for every chat that has one, from sets the workspace already
 * keeps: `working` (its busy set: a turn in flight, or a worker's lead),
 * `needsYou` (`attentionSessionIds`), the teams, and the review and ship
 * records. Chats with no word are left out.
 */
export function chatStatuses({
  working,
  needsYou,
  teams,
  reviews,
  shipped,
}: {
  working: ReadonlySet<string>;
  needsYou: ReadonlySet<string>;
  teams: readonly TeamRun[];
  reviews: Readonly<Record<string, Pick<ChatReview, "at">>>;
  shipped: Readonly<Record<string, Pick<ShippedChat, "at">>>;
}): Record<string, ChatStatusWord> {
  const facts = new Map<string, ChatStatusFacts>();
  const of = (id: string) => {
    let entry = facts.get(id);
    if (!entry) facts.set(id, (entry = {}));
    return entry;
  };
  for (const id of needsYou) of(id).needsYou = true;
  for (const id of working) of(id).working = true;
  // Newest team last, so it decides a chat that was in two.
  const ordered = [...teams].sort((a, b) => a.startedAt - b.startedAt);
  for (const team of ordered) {
    for (const id of teamChats(team)) {
      if (team.status === "running") of(id).team = team.kind;
      // A team that waits on you only words the chats still at work in it;
      // the chat it waits on reads Needs you.
      else if (teamIsLive(team) && working.has(id)) of(id).team = team.kind;
      else if (team.status === "ready") of(id).teamReady = true;
    }
  }
  for (const [id, review] of Object.entries(reviews))
    of(id).reviewAt = review.at;
  for (const [id, ship] of Object.entries(shipped)) of(id).shippedAt = ship.at;
  const words: Record<string, ChatStatusWord> = {};
  for (const [id, entry] of facts) {
    const word = chatStatusWord(entry);
    if (word) words[id] = word;
  }
  return words;
}
