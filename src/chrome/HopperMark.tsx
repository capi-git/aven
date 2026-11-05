import { memo, type CSSProperties } from "react";
import {
  HOPPER_BOX,
  HOPPER_GEOMETRY,
  hopperStepsPath,
  type HopperState,
} from "../lib/hopper";
import type { MarkTone } from "../lib/markTones";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import "./HopperMark.css";

export type { HopperState } from "../lib/hopper";

const VIEW_BOX = `0 0 ${HOPPER_BOX} ${HOPPER_BOX}`;
const BIG_STEPS = hopperStepsPath(HOPPER_GEOMETRY.big);
const SMALL_STEPS = hopperStepsPath(HOPPER_GEOMETRY.small);

type Props = {
  /** What the agent is doing (`still` when not set). */
  state?: HopperState;
  /**
   * The bright dot's colour: its project's for Avos, a bot and a chat, its
   * role's for a teammate. Grey, or none, is the text colour. Amber
   * replaces it while the agent needs you.
   */
  tone?: MarkTone | null;
  /**
   * A one-shot reaction to a turn's end or a reply: a hop on the top step
   * when it completed, a slump on the bottom one when it failed, a blink,
   * a nod or a lean.
   */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its motion. */
  reactionId?: string;
  /** The steps alone: a place for a teammate still to come. */
  vacant?: boolean;
  /** Sizes the mark (15px when not set). */
  className?: string;
  style?: CSSProperties;
};

/**
 * An agent's mark, Hopper: the logo's staircase in grey dots with one
 * bright dot living on it (see `HopperState`). Below 24 px it draws three
 * bigger steps. The steps are one still SVG path; only the dot moves, as a
 * transform and opacity animation on two small elements, so a page full of
 * marks costs little and nothing runs per frame in script.
 *
 * It is a `.dot-mark` too, so the sizes callers give their marks, and the
 * mark colour tokens, apply to it as they do to the other marks.
 */
export const HopperMark = memo(function HopperMark({
  state = "still",
  tone,
  reaction = null,
  reactionId,
  vacant = false,
  className = "",
  style,
}: Props) {
  return (
    <span
      key={reaction ? (reactionId ?? reaction) : undefined}
      className={`dot-mark hopper-mark ${className}`}
      data-hopper={state}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      data-reaction={reaction ?? undefined}
      data-vacant={vacant || undefined}
      style={
        reaction
          ? ({
              ...style,
              "--hopper-reaction-ms": `${MASCOT_REACTION_MS[reaction]}ms`,
            } as CSSProperties)
          : style
      }
      aria-hidden
    >
      <svg
        className="hopper-steps"
        viewBox={VIEW_BOX}
        aria-hidden
        focusable="false"
      >
        <path className="hopper-steps-big" d={BIG_STEPS} />
        <path className="hopper-steps-small" d={SMALL_STEPS} />
      </svg>
      {vacant ? null : (
        <span className="hopper-walk">
          <i className="hopper-dot" />
        </span>
      )}
    </span>
  );
});
