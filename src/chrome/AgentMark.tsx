import { memo, type CSSProperties } from "react";
import type { AgentOutfit, AgentState } from "../lib/agentMark";
import type { MarkTone } from "../lib/markTones";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import { orbLook, type OrbActivity } from "../lib/orbLook";
import { ThinkingOrb } from "./ThinkingOrb";
// The marks' shared box, sizes and colour tokens, wherever one is drawn.
import "./DotMark.css";
import "./AgentMark.css";

export type { AgentOutfit, AgentState } from "../lib/agentMark";
export type { OrbActivity } from "../lib/orbLook";

type Props = {
  /** What the agent is doing (`still` when not set). */
  state?: AgentState;
  /**
   * What it works on, finer than `working`: thinking, searching, using a
   * browser, waiting on helpers. Read only while it works.
   */
  activity?: OrbActivity;
  /**
   * Its colour: its project's for a bot and a chat, its role's for a
   * teammate. Grey, or none, is the text colour. What needs you is amber,
   * what's ready green, whatever its colour.
   */
  tone?: MarkTone | null;
  /** Its role's outfit (`agentOutfit`), said as `data-outfit` only. */
  outfit?: AgentOutfit;
  /**
   * A one-shot reaction to a turn's end or a reply: a colour and a hop when
   * it completed, red when it failed or was stopped.
   */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its motion. */
  reactionId?: string;
  /** Kept for callers; orbs side by side start where they come into view. */
  phase?: number;
  /** Faint: a place for a teammate still to come. */
  vacant?: boolean;
  /** Sizes the mark (15px when not set). */
  className?: string;
  style?: CSSProperties;
};

/**
 * An agent's mark: a Thinking Orb (thinkingorbs.com) in the agent's
 * colour that says what it's doing: still at rest, the comet while it
 * watches, the running ring (or thinking, searching, using a browser)
 * while it works, blinking amber when it needs you and green when its
 * work is ready. A reaction tints it and hops it once.
 *
 * It is a `.dot-mark` too, so the sizes callers give their marks, and the
 * mark colour tokens, apply to it as they do to the other marks.
 */
export const AgentMark = memo(function AgentMark({
  state = "still",
  activity,
  tone,
  outfit,
  reaction = null,
  reactionId,
  vacant = false,
  className = "",
  style,
}: Props) {
  const own: CSSProperties | undefined = reaction
    ? ({
        ...style,
        "--agent-reaction-ms": `${MASCOT_REACTION_MS[reaction]}ms`,
      } as CSSProperties)
    : style;
  const { moving, ...look } = orbLook(
    vacant || reaction ? "still" : state,
    activity,
  );
  return (
    <span
      key={reaction ? (reactionId ?? reaction) : undefined}
      className={`dot-mark agent-mark ${className}`}
      data-agent={state}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      data-outfit={outfit}
      data-reaction={reaction ?? undefined}
      data-vacant={vacant || undefined}
      style={own}
      aria-hidden
    >
      <span className="agent-bob">
        <ThinkingOrb
          look={look}
          moving={moving}
          urgent={state === "working" || state === "needs"}
          className="agent-orb"
        />
      </span>
    </span>
  );
});
