/**
 * The conversation page of a discussion: both chats' replies as one thread.
 *
 * Nothing here is stored twice. The discussion store says who took part, the
 * topic, how many turns have finished and how it ended; each reply is read
 * from the transcript of the chat that wrote it, exactly as the broker reads
 * the reply it relays (`discussionReply`). Only finished turns are shown, so
 * a reply streaming in one chat never changes the thread; the page shows that
 * side typing instead. What the user added from the page is kept with the
 * discussion and shown where the chats read it: just before the reply of the
 * turn whose relay first carried it.
 */
import { replyStance, type DiscussionStance } from "./discussionStance";
import {
  discussionEndNote,
  discussionReply,
  speakingSide,
  type Discussion,
  type DiscussionInterjection,
  type DiscussionSide,
} from "./discussions";
import type { Block } from "./session";

/**
 * Where a message the user added stands: passed on, waiting for a relay
 * (`queued`), or never passed on because the discussion ended first.
 */
export type UserMessageState = "sent" | "queued" | "unsent";

export type DiscussionThreadItem =
  /** The user's topic, opening the conversation. */
  | { kind: "topic"; key: string; text: string }
  | { kind: "round"; key: string; round: number; rounds: number }
  /**
   * One chat's finished reply. `text` is null when that chat's transcript is
   * not open in this window, so the reply cannot be read here.
   */
  | {
      kind: "reply";
      key: string;
      side: DiscussionSide;
      turn: number;
      text: string | null;
      /** Whether it agrees with the reply before it, from its first words. */
      stance: DiscussionStance | null;
    }
  /** Something the user added for both chats from the page. */
  | {
      kind: "user";
      key: string;
      text: string;
      /** The turn whose relay first carries it. */
      turn: number;
      state: UserMessageState;
    }
  /** Aven's closing note, the same text both chats received. */
  | { kind: "closing"; key: string; text: string; completed: boolean };

export type DiscussionTranscripts = {
  /** Each side's transcript; absent when that chat is not open here. */
  a?: readonly Block[];
  b?: readonly Block[];
};

function sameItem(
  left: DiscussionThreadItem | undefined,
  right: DiscussionThreadItem,
): boolean {
  if (!left || left.kind !== right.kind || left.key !== right.key) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return Object.keys(b).every((key) => a[key] === b[key]);
}

/**
 * The thread in reading order: the topic, then each round's divider and its
 * replies, each preceded by what the user added for it, then anything still
 * waiting for a relay, then the closing note once it has ended. Items equal
 * to one in `previous` are that same object, and an unchanged thread is
 * `previous` itself, so a re-render with the same content renders nothing
 * new.
 */
export function buildDiscussionThread(
  discussion: Discussion,
  transcripts: DiscussionTranscripts,
  previous: readonly DiscussionThreadItem[] = [],
): readonly DiscussionThreadItem[] {
  const before = new Map(previous.map((item) => [item.key, item]));
  const built: DiscussionThreadItem[] = [
    { kind: "topic", key: "topic", text: discussion.topic },
  ];
  const ended = discussion.status === "ended";
  // A development preview only pretends to take turns: nothing was said.
  const finished = discussion.preview
    ? 0
    : Math.min(discussion.settled, discussion.rounds * 2);
  const divider = (turn: number) => {
    const round = Math.floor(turn / 2) + 1;
    built.push({
      kind: "round",
      key: `round-${round}`,
      round,
      rounds: discussion.rounds,
    });
  };
  const added = discussion.interjections ?? [];
  const user = (entry: DiscussionInterjection) =>
    built.push({
      kind: "user",
      key: `you-${entry.id}`,
      text: entry.text,
      turn: entry.turn,
      state: userMessageState(discussion, entry),
    });
  for (let turn = 0; turn < finished; turn += 1) {
    if (turn % 2 === 0) divider(turn);
    for (const entry of added) if (entry.turn === turn) user(entry);
    const side: DiscussionSide = turn % 2 === 0 ? "a" : "b";
    const blocks = transcripts[side];
    // The other chat may no longer be loaded once it is over: the chat that
    // started it received each of its replies.
    const read = blocks
      ? discussionReply(blocks, discussion.id, turn)
      : side === "b" && transcripts.a
        ? relayedReply(transcripts.a, discussion.id, turn)
        : null;
    const text = read === null ? null : read.trim();
    const key = `turn-${turn}`;
    const old = before.get(key);
    // The stance is read once per reply text, not on every streamed token.
    const stance =
      old?.kind === "reply" && old.text === text
        ? old.stance
        : turn > 0 && text
          ? replyStance(text)
          : null;
    built.push({ kind: "reply", key, side, turn, text, stance });
  }
  // A round that has started but has no reply yet still gets its divider,
  // so the typing side sits under the right round.
  if (!ended && finished < discussion.rounds * 2 && finished % 2 === 0)
    divider(finished);
  // The turn under way first, then what waits for a later relay.
  for (const entry of added) if (entry.turn === finished) user(entry);
  for (const entry of added) if (entry.turn > finished) user(entry);
  if (ended)
    built.push({
      kind: "closing",
      key: "closing",
      text: discussionEndNote(discussion),
      completed: discussion.ended?.kind === "completed",
    });

  const items = built.map((item) => {
    const old = before.get(item.key);
    return old && sameItem(old, item) ? old : item;
  });
  return items.length === previous.length &&
    items.every((item, index) => item === previous[index])
    ? previous
    : items;
}

/**
 * The other chat's reply for `turn`, as the chat that started the
 * discussion received it: the relay that carried it there, or the last
 * reply copied in when it ended. Null when it never arrived there.
 */
export function relayedReply(
  blocks: readonly Block[],
  id: string,
  turn: number,
): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    const meta =
      block.role === "user"
        ? block.discussion
        : block.role === "system"
          ? block.discussionReply
          : undefined;
    if (meta?.id === id && meta.turn === turn + 1 && !meta.replyShown)
      return block.text;
  }
  return null;
}

/** Whether a message the user added has reached a chat yet. */
export function userMessageState(
  discussion: Discussion,
  entry: DiscussionInterjection,
): UserMessageState {
  const reached =
    entry.turn < discussion.settled ||
    (entry.turn === discussion.settled && discussion.delivered);
  if (reached) return "sent";
  return discussion.status === "ended" ? "unsent" : "queued";
}

/** Waiting behind the turn under way: shown after the typing side. */
export function waitsForNextTurn(
  discussion: Discussion,
  item: DiscussionThreadItem,
): boolean {
  return (
    item.kind === "user" &&
    discussion.status !== "ended" &&
    item.turn > discussion.settled
  );
}

/** The side answering now, or null while paused or once it has ended. */
export function typingSide(discussion: Discussion): DiscussionSide | null {
  return discussion.status === "active" ? speakingSide(discussion) : null;
}

export type DiscussionReplyItem = Extract<
  DiscussionThreadItem,
  { kind: "reply" }
>;

/** The reply keys in a thread. */
export function replyKeys(items: readonly DiscussionThreadItem[]): Set<string> {
  return new Set(
    items.flatMap((item) => (item.kind === "reply" ? [item.key] : [])),
  );
}

/**
 * Replies in `items` that `known` has not seen, in reading order. `known`
 * then holds them too, so each reply arrives once however often the thread
 * is rebuilt. Seed `known` with the replies already there when the page
 * opened, and those never arrive at all.
 */
export function arrivedReplies(
  items: readonly DiscussionThreadItem[],
  known: Set<string>,
): DiscussionReplyItem[] {
  const arrived: DiscussionReplyItem[] = [];
  for (const item of items) {
    if (item.kind !== "reply" || known.has(item.key)) continue;
    known.add(item.key);
    arrived.push(item);
  }
  return arrived;
}

/** Each side's last reply in the thread, for its end-of-discussion hop. */
export function lastReplyKeys(
  items: readonly DiscussionThreadItem[],
): ReadonlySet<string> {
  const last = new Map<DiscussionSide, string>();
  for (const item of items)
    if (item.kind === "reply") last.set(item.side, item.key);
  return new Set(last.values());
}

/** Replies longer than this many characters or lines start folded. */
export const LONG_REPLY_CHARS = 900;
export const LONG_REPLY_LINES = 14;

/** Whether a reply is long enough to start folded behind Show more. */
export function isLongReply(text: string): boolean {
  if (text.length > LONG_REPLY_CHARS) return true;
  let lines = 1;
  for (const character of text)
    if (character === "\n" && ++lines > LONG_REPLY_LINES) return true;
  return false;
}
