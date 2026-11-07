import { memo, type CSSProperties } from "react";
import {
  AGENT_GLASS,
  AGENT_STATE_FACES,
  agentFacePaths,
  type AgentFace,
  type AgentGrid,
  type AgentOutfit,
  type AgentState,
} from "../lib/agentMark";
import type { MarkTone } from "../lib/markTones";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
// The marks' shared box, sizes and colour tokens, wherever one is drawn.
import "./DotMark.css";
import "./AgentMark.css";

export type { AgentOutfit, AgentState } from "../lib/agentMark";

// The middle band of the 100-unit square: the screen is wider than tall.
const VIEW_BOX = "0 14 100 72";
// One face at every size: small marks draw its dots bigger, so they read
// as the same shapes, bolder (AgentMark.css).
const GRIDS: readonly AgentGrid[] = ["large"];

/** Each face's paths at each density, worked out once. */
const PATHS = Object.fromEntries(
  GRIDS.map((grid) => [
    grid,
    Object.fromEntries(
      (
        ["prompt", "squares", "narrow", "chevron", "happy", "cross"] as const
      ).map((face) => [face, agentFacePaths(grid, face)]),
    ),
  ]),
) as Record<AgentGrid, Record<AgentFace, { lit: string; cursor: string }>>;

/** A reaction's face over the state's while it plays. */
function reactionFace(
  reaction: MascotReactionKind | null,
): AgentFace | undefined {
  if (reaction === "cheer") return "happy";
  if (reaction === "slump" || reaction === "shrug") return "squares";
  return undefined;
}

type Props = {
  /** What the agent is doing (`still` when not set). */
  state?: AgentState;
  /**
   * Its colour: its project's for Avos, a bot and a chat, its role's for a
   * teammate. Grey, or none, is the text colour. What needs you is amber,
   * what's ready green, whatever its colour.
   */
  tone?: MarkTone | null;
  /** Its role's outfit (`agentOutfit`), said as `data-outfit` only. */
  outfit?: AgentOutfit;
  /**
   * A one-shot reaction to a turn's end or a reply: a happy face and a hop
   * when it completed, its eyes going red when it failed or was stopped, a
   * nod or a lean.
   */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its motion. */
  reactionId?: string;
  /**
   * How far into its loops it starts, in seconds (`agentPhase`), so agents
   * side by side look about and blink out of step.
   */
  phase?: number;
  /** Its screen alone, faint: a place for a teammate still to come. */
  vacant?: boolean;
  /** Sizes the mark (15px when not set). */
  className?: string;
  style?: CSSProperties;
};

/**
 * An agent's mark, Bot: a little screen of dots with a face lit on it (see
 * `AgentState`), in the agent's colour. Its glass and face are still SVG;
 * what moves are a few small layers, by transform and opacity only: the
 * whole screen for a reaction (`.agent-bob`), its face (`.agent-eyes`), a
 * prompt's cursor, the light running round its edge while it works
 * (`.agent-comet`), and its frame and glow while it needs you or is ready.
 * So a page full of marks costs little and nothing runs per frame in
 * script.
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
  const face = reactionFace(reaction) ?? AGENT_STATE_FACES[state];
  return (
    <span
      key={reaction ? (reactionId ?? reaction) : undefined}
      className={`dot-mark agent-mark ${className}`}
      data-agent={state}
      data-face={face}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      data-outfit={outfit}
      data-reaction={reaction ?? undefined}
      data-vacant={vacant || undefined}
      style={own}
      aria-hidden
    >
      <span className="agent-bob">
        {state === "working" && !vacant ? <i className="agent-comet" /> : null}
        <span className="agent-screen">
          <i className="agent-glow" />
          <svg
            className="agent-body"
            viewBox={VIEW_BOX}
            aria-hidden
            focusable="false"
          >
            <path className="agent-head agent-glass" d={AGENT_GLASS} />
          </svg>
          {vacant ? null : (
            <span className="agent-eyes" data-mood={face}>
              <svg viewBox={VIEW_BOX} aria-hidden focusable="false">
                {GRIDS.map((grid) => (
                  <g key={grid} className={`agent-face agent-face-${grid}`}>
                    <path className="agent-eye" d={PATHS[grid][face].lit} />
                    {PATHS[grid][face].cursor ? (
                      <path
                        className="agent-cursor"
                        d={PATHS[grid][face].cursor}
                      />
                    ) : null}
                  </g>
                ))}
              </svg>
            </span>
          )}
          <i className="agent-ring" />
        </span>
      </span>
    </span>
  );
});
