import { memo, type CSSProperties } from "react";
import { agentRole } from "../lib/agentRoles";
import type { DiscussionVoice } from "../lib/discussionVoices";
import { projectSigil } from "../lib/dotSigils";
import type { MascotReactionKind } from "../lib/mascotReactions";
import { DotMark } from "./DotMark";
import "./DiscussionAvatar.css";

/**
 * One side's face in a discussion: its mark on a small grey tile, with a
 * letter for the role it was brought in with. A light sweeps across it while
 * that side is typing; a reaction plays once when `reaction` is set (a tick
 * at the end, a nod or a lean when a reply lands); otherwise it is still.
 */
export const DiscussionAvatar = memo(function DiscussionAvatar({
  voice,
  size = "small",
  typing = false,
  reaction = null,
  reactionId,
}: {
  voice: DiscussionVoice;
  size?: "small" | "large";
  typing?: boolean;
  /** A one-shot reaction to play; null shows the mark still. */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its animation. */
  reactionId?: string;
}) {
  return (
    <span
      className="discussion-avatar"
      data-discussion-avatar={voice.side}
      data-size={size}
      data-typing={typing || undefined}
      data-mascot={voice.mascot}
      data-role={voice.role}
      title={`${voice.name} · ${voice.persona}`}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
      aria-hidden
    >
      <DotMark
        sigil={projectSigil(voice.mascot, voice.sessionId)}
        state={typing && !reaction ? "working" : "still"}
        reaction={reaction}
        reactionId={reactionId}
        className="discussion-avatar-sprite"
      />
      {voice.role ? (
        // The role it was brought in with, as its first letter.
        <span className="discussion-avatar-role">
          {agentRole(voice.role).name[0]}
        </span>
      ) : null}
    </span>
  );
});
