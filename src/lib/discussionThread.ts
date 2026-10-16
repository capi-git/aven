/**
 * The conversation page of a discussion: both chats' replies as one thread.
 *
 * Nothing here is stored twice. The discussion store says who took part, the
 * topic, how many turns have finished and how it ended; each reply is read
 * from the transcript of the chat that wrote it, exactly as the broker reads
 * the reply it relays (`discussionReply`). Only finished turns are shown, so
 * a reply streaming in one chat never changes the thread; the page shows that
 * side typing instead.
 */
import {
  discussionEndNote,
  discussionReply,
  speakingSide,
  type Discussion,
  type DiscussionSide,
} from "./discussions";
import type { Block } from "./session";

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
 * replies, then the closing note once it has ended. Items equal to one in
 * `previous` are that same object, and an unchanged thread is `previous`
 * itself, so a re-render with the same content renders nothing new.
 */
export function buildDiscussionThread(
  discussion: Discussion,
  transcripts: DiscussionTranscripts,
  previous: readonly DiscussionThreadItem[] = [],
): readonly DiscussionThreadItem[] {
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
  for (let turn = 0; turn < finished; turn += 1) {
    if (turn % 2 === 0) divider(turn);
    const side: DiscussionSide = turn % 2 === 0 ? "a" : "b";
    const blocks = transcripts[side];
    const text = blocks ? discussionReply(blocks, discussion.id, turn) : null;
    built.push({
      kind: "reply",
      key: `turn-${turn}`,
      side,
      turn,
      text: text === null ? null : text.trim(),
    });
  }
  // A round that has started but has no reply yet still gets its divider,
  // so the typing side sits under the right round.
  if (!ended && finished < discussion.rounds * 2 && finished % 2 === 0)
    divider(finished);
  if (ended)
    built.push({
      kind: "closing",
      key: "closing",
      text: discussionEndNote(discussion),
      completed: discussion.ended?.kind === "completed",
    });

  const before = new Map(previous.map((item) => [item.key, item]));
  const items = built.map((item) => {
    const old = before.get(item.key);
    return old && sameItem(old, item) ? old : item;
  });
  return items.length === previous.length &&
    items.every((item, index) => item === previous[index])
    ? previous
    : items;
}

/** The side answering now, or null while paused or once it has ended. */
export function typingSide(discussion: Discussion): DiscussionSide | null {
  return discussion.status === "active" ? speakingSide(discussion) : null;
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
