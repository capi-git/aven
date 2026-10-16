import { memo, type CSSProperties } from "react";
import type { DiscussionVoice } from "../lib/discussionVoices";
import { ProjectMascot } from "./ProjectMascot";
import "./DiscussionAvatar.css";

/**
 * One side's face in a discussion: its pixel mascot in its provider's colour
 * on a small tinted tile. It steps between its two frames while that side is
 * typing, plays a single happy hop when `cheerId` is set, and is otherwise
 * still.
 */
export const DiscussionAvatar = memo(function DiscussionAvatar({
  voice,
  size = "small",
  typing = false,
  cheerId = null,
}: {
  voice: DiscussionVoice;
  size?: "small" | "large";
  typing?: boolean;
  /** Identifies one end-of-discussion hop; null shows the mascot still. */
  cheerId?: string | null;
}) {
  return (
    <span
      className="discussion-avatar"
      data-discussion-avatar={voice.side}
      data-size={size}
      data-typing={typing || undefined}
      data-mascot={voice.mascot}
      title={`${voice.name} · ${voice.persona}`}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
      aria-hidden
    >
      <ProjectMascot
        project={voice.sessionId}
        name={voice.mascot}
        color={voice.color}
        active={typing && !cheerId}
        reaction={cheerId ? "cheer" : null}
        reactionId={cheerId ?? undefined}
        className="discussion-avatar-sprite"
      />
    </span>
  );
});
