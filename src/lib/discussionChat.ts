/**
 * A discussion as it plays out in the chat that started it (side A).
 *
 * That chat receives every relay on an even turn, so its transcript already
 * holds the whole conversation: the topic, its own replies, and the other
 * chat's replies as relayed messages, with what the user added kept on each
 * relay (`added`). The other chat's last reply, never relayed, is copied in
 * when the discussion ends (`discussionReply`). Everything here reads one
 * message at a time from its own marks; nothing scans the transcript or the
 * discussion store while it renders.
 */
import {
  speakingSide,
  type Discussion,
  type DiscussionParty,
  type DiscussionSide,
} from "./discussions";
import { discussionVoices, type DiscussionVoice } from "./discussionVoices";
import { resolveModel } from "./models";
import type { Block, DiscussionRelayMeta, HarnessId } from "./session";

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

/** The round a relayed message opens in the starting chat, 1-based. */
export function relayRound(meta: DiscussionRelayMeta): number {
  return Math.floor(meta.turn / 2) + 1;
}

const voiceCache = new WeakMap<
  DiscussionRelayMeta,
  Record<DiscussionSide, DiscussionVoice>
>();

/**
 * Both sides' voices for a relayed message: this chat (A) and the other
 * one (B), with the same mascots the discussion's page uses. Messages from
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
 * The last relay the starting chat has received: the turn its latest relay
 * carried. A discussion that used up its rounds counts its copied-in last
 * reply as one more.
 */
export function lastStartingChatRelay(discussion: Discussion): number {
  const { settled } = discussion;
  if (discussion.status === "ended" && discussion.ended?.kind === "completed")
    return settled;
  if (speakingSide(discussion) === "a")
    return discussion.delivered ? settled : settled - 2;
  return settled - 1;
}

export type PendingJumpIn = {
  id: string;
  text: string;
  /** Waiting for a relay, or never passed on because it ended first. */
  state: "queued" | "unsent";
};

/**
 * What the user added that the starting chat does not show yet: a message
 * appears there with the relay that carries it to that chat (on the turn
 * it was added for, or the next one), so until then it waits at the end of
 * the transcript.
 */
export function pendingJumpIns(discussion: Discussion): PendingJumpIn[] {
  const shown = lastStartingChatRelay(discussion);
  const ended = discussion.status === "ended";
  return (discussion.interjections ?? [])
    .filter((entry) => entry.turn + (entry.turn % 2) > shown)
    .map((entry) => ({
      id: entry.id,
      text: entry.text,
      state: ended ? "unsent" : "queued",
    }));
}
