/**
 * A discussion in the chat that started it (side A).
 *
 * That chat receives every relay on an even turn, so its transcript holds
 * the whole conversation: the topic, its own replies, and the other chat's
 * replies as relayed messages, with what the user added kept on each relay
 * (`added`). The other chat's last reply, never relayed, is copied in when
 * the discussion ends (`discussionReply`). The transcript folds that span
 * into one live card after the topic (`discussionSpans`); everything here
 * reads each message's own marks, never the discussion store.
 */
import type { DiscussionParty, DiscussionSide } from "./discussions";
import { discussionVoices, type DiscussionVoice } from "./discussionVoices";
import { resolveModel } from "./models";
import type {
  Block,
  DiscussionRelayMeta,
  DiscussionWrapUpMeta,
  HarnessId,
} from "./session";

/**
 * A relayed message in the chat that started the discussion: the topic
 * (turn 0) or the other chat's reply (later even turns). Null for any other
 * block, including relays in the other chat, which shows them as before.
 */
export function startingChatRelay(
  block: Block | undefined,
): DiscussionRelayMeta | null {
  const meta = block?.role === "user" ? block.discussion : undefined;
  return meta && meta.turn % 2 === 0 ? meta : null;
}

/**
 * Aven's rows that close the discussion in the starting chat: the other
 * chat's last reply and the closing note with where they landed. They sit
 * after the last turn's own footer.
 */
export function isDiscussionAside(block: Block): boolean {
  return (
    block.role === "system" && !!(block.discussionReply || block.discussionEnd)
  );
}

const voiceCache = new WeakMap<
  DiscussionRelayMeta,
  Record<DiscussionSide, DiscussionVoice>
>();

/**
 * Both sides' voices for a relayed message: this chat (A) and the other
 * one (B), with the same mascots the discussion's panel uses. Messages from
 * before both sides were recorded fall back to this chat's own model. The
 * same object for the same message, so components keyed on it stay put.
 */
export function relayVoices(
  meta: DiscussionRelayMeta,
  fallback: { harness: HarnessId; model: string },
): Record<DiscussionSide, DiscussionVoice> {
  const cached = voiceCache.get(meta);
  if (cached) return cached;
  const self = meta.self ?? {
    sessionId: "",
    harness: fallback.harness,
    model: resolveModel(fallback.harness, fallback.model).name,
  };
  const a: DiscussionParty = {
    sessionId: self.sessionId,
    harness: self.harness,
    model: self.model,
    title: "",
    cwd: "",
  };
  const b: DiscussionParty = {
    sessionId: meta.partner.sessionId ?? meta.partner.title,
    harness: meta.partner.harness,
    model: meta.partner.model,
    title: meta.partner.title,
    cwd: meta.partner.cwd ?? "",
  };
  const voices = discussionVoices({ a, b });
  voiceCache.set(meta, voices);
  return voices;
}

/**
 * A discussion's span in the chat that started it: the turns from its topic
 * (or, for a discussion continued after something else, its next relay) to
 * its closing note, which fold into one card.
 */
export type DiscussionSpan = {
  /** Stable while the span grows: the discussion and its first turn. */
  key: string;
  id: string;
  /** The relay that opens the span. */
  meta: DiscussionRelayMeta;
  /** Turn indexes, inclusive. */
  start: number;
  end: number;
  /** It opens with the topic, which stays shown as the user's message. */
  topic: boolean;
  /** The closing note's wrap-up, once it ended after its rounds. */
  closing?: DiscussionWrapUpMeta;
};

/**
 * The discussion spans in a chat's turns, by each turn index they cover. A
 * span is a run of turns each opened by a relay of the same discussion to
 * this chat; anything else the chat did in between ends it. Linear in the
 * turns, and only a span's last turn is read for its closing note.
 */
export function discussionSpans(
  turns: readonly (readonly Block[])[],
  userBlock: (turn: readonly Block[]) => Block | undefined,
): Map<number, DiscussionSpan> {
  const spans = new Map<number, DiscussionSpan>();
  let current: DiscussionSpan | null = null;
  const close = () => {
    if (!current) return;
    for (const block of turns[current.end]) {
      const end = block.role === "system" ? block.discussionEnd : undefined;
      if (end?.id === current.id) current.closing = end;
    }
    for (let index = current.start; index <= current.end; index += 1)
      spans.set(index, current);
    current = null;
  };
  turns.forEach((turn, index) => {
    const meta = startingChatRelay(userBlock(turn));
    if (current && meta?.id === current.id && index === current.end + 1) {
      current.end = index;
      return;
    }
    close();
    if (meta)
      current = {
        key: `${meta.id}:${index}`,
        id: meta.id,
        meta,
        start: index,
        end: index,
        topic: meta.turn === 0,
      };
  });
  close();
  return spans;
}
