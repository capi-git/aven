import { memo, type CSSProperties } from "react";
import {
  AGENT_DOTS,
  type AgentOutfit,
  type AgentState,
} from "../lib/agentMark";
import { DOT_VIEW_BOX } from "../lib/dotSigils";
import type { MarkTone } from "../lib/markTones";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import "./AgentMark.css";

export type { AgentOutfit, AgentState } from "../lib/agentMark";

type Mood = "open" | "wide" | "squint" | "closed";

const MOODS: Readonly<Record<AgentState, Mood>> = {
  still: "open",
  watching: "open",
  resting: "closed",
  working: "squint",
  needs: "wide",
};

type Props = {
  /** What the agent is doing (`still` when not set). */
  state?: AgentState;
  /**
   * Its colour: its project's for Avos, a bot and a chat, its role's for a
   * teammate. Grey, or none, is the text colour. Its eyes and light turn
   * amber while it needs you.
   */
  tone?: MarkTone | null;
  /** Its role's outfit (`agentOutfit`), said as `data-outfit` only. */
  outfit?: AgentOutfit;
  /**
   * A one-shot reaction to a turn's end or a reply: a happy hop when it
   * completed, a slump when it failed, a blink, a nod or a lean.
   */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its motion. */
  reactionId?: string;
  /**
   * How far into its loops it starts, in seconds (`agentPhase`), so agents
   * side by side bob and blink out of step.
   */
  phase?: number;
  /** Its outline alone, faint: a place for a teammate still to come. */
  vacant?: boolean;
  /** Sizes the mark (15px when not set). */
  className?: string;
  style?: CSSProperties;
};

/**
 * An agent's mark, Bot: a little robot drawn in the work dots' 5×5 grid
 * (`AGENT_ROWS`), in the agent's colour, with two glowing eyes and a light
 * on its antenna, the rest of the grid faint (see `AgentState`). The body
 * is one still SVG; only a few small parts move (the whole bot's bob, its
 * eyes, its light, and while it works one lit foot), each by transform or
 * opacity, so a page full of marks costs little and nothing runs per frame
 * in script.
 *
 * It is a `.dot-mark` too, so the sizes callers give their marks, and the
 * mark colour tokens, apply to it as they do to the other marks.
 */
export const AgentMark = memo(function AgentMark({
  state = "still",
  tone,
  outfit,
  reaction = null,
  reactionId,
  phase = 0,
  vacant = false,
  className = "",
  style,
}: Props) {
  const own: CSSProperties | undefined =
    reaction || phase
      ? ({
          ...style,
          ...(reaction
            ? { "--agent-reaction-ms": `${MASCOT_REACTION_MS[reaction]}ms` }
            : {}),
          ...(phase ? { "--agent-phase": `${-phase}s` } : {}),
        } as CSSProperties)
      : style;
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
        <svg
          className="agent-body"
          viewBox={DOT_VIEW_BOX}
          aria-hidden
          focusable="false"
        >
          <path className="agent-grid" d={AGENT_DOTS.grid} />
          <path className="agent-head" d={AGENT_DOTS.head} />
        </svg>
        {vacant ? null : (
          <span className="agent-eyes" data-mood={MOODS[state]}>
            <svg viewBox={DOT_VIEW_BOX} aria-hidden focusable="false">
              <path className="agent-eye" d={AGENT_DOTS.eyes} />
            </svg>
          </span>
        )}
        <i className="agent-light" />
        {state === "working" && !vacant ? <i className="agent-key" /> : null}
      </span>
    </span>
  );
});
