import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { DiscussionHostContext } from "../chrome/DiscussionWrapUpNote";
import { useDiscussionCard } from "../hooks/useDiscussions";
import { relayVoices } from "../lib/discussionChat";
import {
  completedRounds,
  discussionRound,
  discussionStore,
  type Discussion,
  type DiscussionSide,
} from "../lib/discussions";
import { replyStance } from "../lib/discussionStance";
import {
  discussionVoices,
  providerShortName,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import type { DiscussionRelayMeta, HarnessId } from "../lib/session";
import { DiscussionMessage, STANCE_REACTION } from "./DiscussionMessages";
import "./DiscussionInChat.css";

/**
 * A discussion in the chat that started it: one live card after the topic
 * stands for the whole conversation, which plays out in its floating panel.
 * "Show in chat" unfolds the raw turns.
 */

/** This chat's provider and model, for messages from before both sides were recorded. */
function fallbackModel(
  harness: HarnessId | undefined,
  model: string | undefined,
) {
  return { harness: harness ?? "claude", model: model ?? "" };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * What the card calls each side: "Claude" and "Codex", or their models when
 * both are the same provider.
 */
export function cardNames(
  a: Pick<DiscussionVoice, "harness" | "name">,
  b: Pick<DiscussionVoice, "harness" | "name">,
): Record<DiscussionSide, string> {
  if (a.harness !== b.harness)
    return {
      a: providerShortName(a.harness),
      b: providerShortName(b.harness),
    };
  return { a: a.name, b: b.name };
}

/** The card's state and words for a discussion as it stands. */
export function cardView(
  discussion: Discussion,
  names: Record<DiscussionSide, string>,
): {
  state: "live" | "needs-you" | "done" | "stopped";
  title: string;
  badge?: string;
  line: string;
} {
  const pair = `${names.a} and ${names.b}`;
  if (discussion.status === "ended") {
    const done = completedRounds(discussion);
    return discussion.ended?.kind === "completed"
      ? {
          state: "done",
          title: `Discussed for ${plural(discussion.rounds, "round")}`,
          line: pair,
        }
      : {
          state: "stopped",
          title:
            done > 0
              ? `Discussion stopped after ${plural(done, "round")} of ${discussion.rounds}`
              : "Discussion stopped",
          line: pair,
        };
  }
  const round = `Round ${discussionRound(discussion)} of ${discussion.rounds}`;
  if (discussion.status === "paused")
    return {
      state: "needs-you",
      title: `${pair} are discussing`,
      badge: "Needs you",
      line: discussion.reason ?? round,
    };
  const settled = discussion.settled;
  const writer: DiscussionSide = (settled - 1) % 2 === 0 ? "a" : "b";
  const speaker: DiscussionSide = settled % 2 === 0 ? "a" : "b";
  const latest =
    settled > 0 ? discussion.relay.trim().split(/\s+/).join(" ") : "";
  return {
    state: "live",
    title: `${pair} are discussing`,
    badge: round,
    line: latest
      ? `${names[writer]}: “${latest}”`
      : `${names[speaker]} is replying…`,
  };
}

/** A side's mascot on a tile tinted with its colour. */
function Tile({ voice }: { voice: DiscussionVoice }) {
  return (
    <span
      className="discussion-card-tile"
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <DiscussionAvatar voice={voice} />
    </span>
  );
}

/**
 * The live card in the chat that started a discussion, after its topic:
 * both mascots, "Claude and Codex are discussing", the round and the latest
 * line, with Watch and Stop; in amber when it needs you, with a way to the
 * chat it waits for; "Discussed for 4 rounds" with Open once it is done.
 * It reads that discussion by id and re-renders only when what it shows
 * changes. "Show in chat" unfolds the turns it stands for.
 */
export const DiscussionCard = memo(function DiscussionCard({
  id,
  meta,
  spanKey,
  expanded,
  onToggle,
  harness,
  model,
}: {
  id: string;
  /** The relay that opens its span, for when the discussion is gone. */
  meta: DiscussionRelayMeta;
  spanKey: string;
  expanded: boolean;
  onToggle: (spanKey: string) => void;
  harness?: HarnessId;
  model?: string;
}) {
  const host = useContext(DiscussionHostContext);
  const discussion = useDiscussionCard(id);
  const voices = useMemo(
    () =>
      discussion
        ? discussionVoices(discussion)
        : relayVoices(meta, fallbackModel(harness, model)),
    [discussion, harness, meta, model],
  );
  const names = useMemo(() => cardNames(voices.a, voices.b), [voices]);
  const view = discussion
    ? cardView(discussion, names)
    : {
        state: "done" as const,
        title: "Discussion",
        badge: undefined,
        line: `${names.a} and ${names.b}`,
      };
  const blocked: DiscussionSide | null = !discussion?.blockedBy
    ? null
    : discussion.blockedBy === discussion.a.sessionId
      ? "a"
      : discussion.blockedBy === discussion.b.sessionId
        ? "b"
        : null;
  const finished = view.state === "done" || view.state === "stopped";
  return (
    <div className="discussion-card-row">
      <div
        className="discussion-card"
        data-discussion-card={id}
        data-state={view.state}
        style={{ "--discussion-voice": voices.b.color } as CSSProperties}
      >
        <span className="discussion-card-duo" aria-hidden>
          <Tile voice={voices.a} />
          <span className="discussion-card-link">• • •</span>
          <Tile voice={voices.b} />
        </span>
        <div className="discussion-card-text">
          <div className="discussion-card-head">
            <span className="discussion-card-title">{view.title}</span>
            {view.badge ? (
              <span
                className="discussion-card-badge"
                data-discussion-card-badge={view.state}
              >
                {view.badge}
              </span>
            ) : null}
          </div>
          <div className="discussion-card-line" title={view.line}>
            {view.line}
          </div>
          <button
            type="button"
            className="discussion-card-toggle"
            data-discussion-card-toggle
            aria-expanded={expanded}
            onClick={() => onToggle(spanKey)}
          >
            {expanded ? "Hide in chat" : "Show in chat"}
          </button>
        </div>
        {host && discussion ? (
          <div className="discussion-card-actions">
            {view.state === "needs-you" && blocked && host.show ? (
              <button
                type="button"
                className="discussion-card-button"
                data-discussion-card-goto={blocked}
                onClick={() => host.show!(id, blocked)}
              >
                Go to {names[blocked]}
              </button>
            ) : view.state === "needs-you" ? (
              <button
                type="button"
                className="discussion-card-button"
                data-discussion-card-resume
                onClick={() => discussionStore().resume(id)}
              >
                Resume
              </button>
            ) : null}
            {host.open ? (
              <button
                type="button"
                className="discussion-card-button"
                data-discussion-card-watch
                onClick={() => host.open!(id)}
              >
                {finished ? "Open" : "Watch"}
              </button>
            ) : null}
            {!finished ? (
              <button
                type="button"
                className="discussion-card-button"
                data-variant="ghost"
                data-discussion-card-stop
                onClick={() => discussionStore().stop(id)}
              >
                Stop
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

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

/**
 * The other agent's last reply, copied into the chat that started the
 * discussion when it ended, as its message on the right. Shown when the
 * discussion's turns are unfolded in the chat.
 */
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
