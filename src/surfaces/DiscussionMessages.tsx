import { memo, useState, type CSSProperties } from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { Check } from "../chrome/icons";
import type { DiscussionStance } from "../lib/discussionStance";
import { isLongReply } from "../lib/discussionThread";
import type { DiscussionVoice } from "../lib/discussionVoices";
import type { MascotReactionKind } from "../lib/mascotReactions";
import { AgentMarkdown } from "./AgentMarkdown";
import "./DiscussionMessages.css";

/**
 * The pieces of a discussion's conversation shared by its page and by the
 * chat that started it: each side's message with its mascot, name and
 * stance, the answering side typing, and the round dividers.
 */

const STANCE_LABEL: Record<DiscussionStance, string> = {
  agree: "Agrees",
  pushback: "Pushes back",
};

/** How a mascot reacts as a reply lands: a nod, or a head-tilt. */
export const STANCE_REACTION: Record<DiscussionStance, MascotReactionKind> = {
  agree: "nod",
  pushback: "tilt",
};

/** A tiny mark beside a reply's name: a check when it agrees, ↔ when not. */
export function StanceMark({ stance }: { stance: DiscussionStance }) {
  return (
    <span
      className="discussion-stance"
      data-discussion-stance={stance}
      title={STANCE_LABEL[stance]}
      aria-label={STANCE_LABEL[stance]}
      role="img"
    >
      {stance === "agree" ? (
        <Check className="size-2.5" strokeWidth={2.5} />
      ) : (
        "↔"
      )}
    </span>
  );
}

/** Markdown in a bubble, folded behind Show more when it is long. */
export function Foldable({
  className,
  text,
  cwd,
  onOpenFile,
}: {
  className: string;
  text: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
}) {
  const long = isLongReply(text);
  const [open, setOpen] = useState(false);
  const folded = long && !open;
  return (
    <>
      <div className={className} data-folded={folded || undefined}>
        <AgentMarkdown text={text} cwd={cwd} onOpenFile={onOpenFile} />
      </div>
      {long ? (
        <button
          type="button"
          className="discussion-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

/**
 * One side's finished reply: its mascot, its name with the stance mark, and
 * the reply in a bubble tinted with its colour (the opening side on the
 * left, the responding side on the right). `text` is null when the reply
 * can't be read here.
 */
export const DiscussionMessage = memo(function DiscussionMessage({
  as: Tag = "li",
  voice,
  turn,
  text,
  stance,
  reaction = null,
  reactionId,
  cwd,
  onOpenFile,
}: {
  as?: "li" | "div";
  voice: DiscussionVoice;
  turn: number;
  text: string | null;
  stance: DiscussionStance | null;
  reaction?: MascotReactionKind | null;
  reactionId?: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <Tag
      className="discussion-message"
      data-side={voice.side}
      data-discussion-message={turn}
      data-stance={stance ?? undefined}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <DiscussionAvatar
        voice={voice}
        reaction={reaction}
        reactionId={reactionId}
      />
      <div className="discussion-message-body">
        <span className="discussion-message-name">
          {voice.name}
          {stance ? <StanceMark stance={stance} /> : null}
        </span>
        {text ? (
          <Foldable
            className="discussion-bubble"
            text={text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        ) : (
          <p className="discussion-bubble discussion-bubble-missing">
            {text === null
              ? `“${voice.title}” isn't open in this window, so its reply can't be shown here.`
              : "No reply text."}
          </p>
        )}
      </div>
    </Tag>
  );
});

/** The side answering now: its mascot stepping and three pixels taking turns. */
export const DiscussionTyping = memo(function DiscussionTyping({
  as: Tag = "li",
  voice,
}: {
  as?: "li" | "div";
  voice: DiscussionVoice;
}) {
  return (
    <Tag
      className="discussion-message"
      data-side={voice.side}
      data-discussion-typing={voice.side}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <DiscussionAvatar voice={voice} typing />
      <div className="discussion-message-body">
        <span className="discussion-message-name">{voice.name}</span>
        <div
          className="discussion-bubble discussion-typing"
          role="status"
          aria-label={`${voice.name} is replying`}
        >
          <span className="discussion-dot" />
          <span className="discussion-dot" />
          <span className="discussion-dot" />
        </div>
      </div>
    </Tag>
  );
});

/** "Round 2 of 3", between hairlines. */
export function DiscussionRound({
  as: Tag = "li",
  round,
  rounds,
}: {
  as?: "li" | "div";
  round: number;
  rounds: number;
}) {
  return (
    <Tag className="discussion-round" data-discussion-round={round}>
      Round {round} of {rounds}
    </Tag>
  );
}
