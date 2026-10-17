import { memo, type CSSProperties } from "react";
import { agentRole } from "../lib/agentRoles";
import type { DiscussionVoice } from "../lib/discussionVoices";
import type { MascotReactionKind } from "../lib/mascotReactions";
import { ProjectMascot } from "./ProjectMascot";
import "./DiscussionAvatar.css";

/**
 * One side's face in a discussion: its pixel mascot in its provider's colour
 * on a small tinted tile, with a letter for the role it was brought in with. It steps between its two frames while that side is
 * typing, plays a single reaction (a hop at the end, a nod or a head-tilt
 * when a reply lands) when `reaction` is set, and is otherwise still.
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
  /** A one-shot reaction to play; null shows the mascot still. */
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
      <ProjectMascot
        project={voice.sessionId}
        name={voice.mascot}
        color={voice.color}
        active={typing && !reaction}
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
