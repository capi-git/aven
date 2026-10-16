import {
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { useDiscussionChat } from "../hooks/useDiscussions";
import { pendingJumpIns, relayVoices } from "../lib/discussionChat";
import { replyStance } from "../lib/discussionStance";
import { discussionVoices } from "../lib/discussionVoices";
import { typingSide } from "../lib/discussionThread";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import type { DiscussionRelayMeta, HarnessId } from "../lib/session";
import {
  DiscussionMessage,
  DiscussionRound,
  DiscussionTyping,
  STANCE_REACTION,
} from "./DiscussionMessages";
import "./DiscussionInChat.css";

/**
 * A discussion in the chat that started it: the other agent's replies as
 * its bubbles on the right, this chat's own turns under its name, round
 * dividers, and, at the end, the other agent typing and what the user added
 * that has not reached this chat yet. Everything else in the transcript is
 * drawn as usual.
 */

/** This chat's provider and model, for messages from before both sides were recorded. */
function fallbackModel(
  harness: HarnessId | undefined,
  model: string | undefined,
) {
  return { harness: harness ?? "claude", model: model ?? "" };
}

/** A reply that appears this soon after it arrived has just landed. */
const LANDING_MS = 4_000;

/**
 * The nod or head-tilt a reply plays once as it lands here; never for a
 * reply that was already there when the chat was opened.
 */
function useLanding(
  kind: MascotReactionKind | null,
  arrivedAt: number | undefined,
  key: string,
): { kind: MascotReactionKind; id: string } | null {
  const [playing, setPlaying] = useState(
    () => !!kind && arrivedAt != null && Date.now() - arrivedAt < LANDING_MS,
  );
  useEffect(() => {
    if (!playing || !kind) return;
    const timer = window.setTimeout(
      () => setPlaying(false),
      MASCOT_REACTION_MS[kind] + 200,
    );
    return () => window.clearTimeout(timer);
  }, [kind, playing]);
  return playing && kind ? { kind, id: `${key}-${kind}` } : null;
}

/** The other agent's reply, as its message on the right. */
export const DiscussionPartnerReply = memo(function DiscussionPartnerReply({
  meta,
  text,
  arrivedAt,
  harness,
  model,
  cwd,
  onOpenFile,
}: {
  meta: DiscussionRelayMeta;
  text: string;
  arrivedAt?: number;
  harness?: HarnessId;
  model?: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
}) {
  const voice = relayVoices(meta, fallbackModel(harness, model)).b;
  const stance = useMemo(() => replyStance(text), [text]);
  const turn = meta.turn - 1;
  const landing = useLanding(
    stance ? STANCE_REACTION[stance] : null,
    arrivedAt,
    `${meta.id}-${turn}`,
  );
  return (
    <div className="discussion-chat-messages" data-discussion-partner={turn}>
      <DiscussionMessage
        as="div"
        voice={voice}
        turn={turn}
        text={text}
        stance={stance}
        reaction={landing?.kind ?? null}
        reactionId={landing?.id}
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});

/** "Round 2 of 3" in the chat. */
export function DiscussionChatRound({ meta }: { meta: DiscussionRelayMeta }) {
  return (
    <div className="discussion-chat-messages">
      <DiscussionRound
        as="div"
        round={Math.floor(meta.turn / 2) + 1}
        rounds={meta.rounds}
      />
    </div>
  );
}

/**
 * This chat's own turn in the discussion: its mascot and name above the
 * work and the reply, and a quiet rail in its colour beside them. The turn
 * itself is drawn as usual inside.
 */
export const DiscussionOwnTurn = memo(function DiscussionOwnTurn({
  meta,
  harness,
  model,
  children,
}: {
  meta: DiscussionRelayMeta;
  harness?: HarnessId;
  model?: string;
  children: ReactNode;
}) {
  const voice = relayVoices(meta, fallbackModel(harness, model)).a;
  return (
    <div
      className="discussion-chat-own"
      data-discussion-own={meta.turn}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <div className="discussion-chat-speaker" data-discussion-speaker="a">
        <DiscussionAvatar voice={voice} />
        <span className="discussion-chat-speaker-name">{voice.name}</span>
      </div>
      {children}
    </div>
  );
});

/**
 * The end of the chat while its discussion runs: the other agent typing,
 * and what the user added that waits for a relay to reach this chat. Reads
 * only that discussion, and only re-renders when it moves on.
 */
export const DiscussionChatTail = memo(function DiscussionChatTail({
  id,
  renderJumpIn,
}: {
  id: string;
  /** The user's own message bubble, with a note under it. */
  renderJumpIn: (key: string, text: string, note: string) => ReactNode;
}) {
  const discussion = useDiscussionChat(id);
  const voices = useMemo(
    () => (discussion ? discussionVoices(discussion) : null),
    [discussion],
  );
  if (!discussion || !voices) return null;
  const typing = typingSide(discussion) === "b";
  const pending = pendingJumpIns(discussion);
  if (!typing && !pending.length) return null;
  return (
    <div className="discussion-chat-tail" data-discussion-tail={id}>
      {typing ? (
        <div className="discussion-chat-messages">
          <DiscussionTyping as="div" voice={voices.b} />
        </div>
      ) : null}
      {pending.map((entry) =>
        renderJumpIn(
          entry.id,
          entry.text,
          entry.state === "unsent"
            ? "Not passed on: the discussion ended first"
            : "Goes to both with the next reply",
        ),
      )}
    </div>
  );
});
