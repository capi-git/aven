import { memo, type CSSProperties } from "react";
import {
  AGENT_BOX,
  AGENT_PATHS,
  HATS,
  OUTFIT_PATHS,
  eyesPath,
  type AgentOutfit,
  type AgentState,
} from "../lib/agentMark";
import type { MarkTone } from "../lib/markTones";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import "./AgentMark.css";

export type { AgentOutfit, AgentState } from "../lib/agentMark";

const VIEW_BOX = `0 0 ${AGENT_BOX} ${AGENT_BOX}`;

type Mood = "open" | "wide" | "squint" | "closed";

const MOODS: Readonly<Record<AgentState, Mood>> = {
  still: "open",
  watching: "open",
  resting: "closed",
  working: "squint",
  needs: "wide",
};

/** Each mood's eyes, big and small, worked out once. */
const EYES: Readonly<Record<Mood, readonly [string, string]>> = {
  open: [eyesPath("open"), eyesPath("open", true)],
  wide: [eyesPath("wide"), eyesPath("wide", true)],
  squint: [eyesPath("squint"), eyesPath("squint", true)],
  closed: [eyesPath("closed"), eyesPath("closed", true)],
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
  /** What it wears at 28 px and up, by its role (`agentOutfit`). */
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
 * An agent's mark, Bot: a little robot in the agent's colour with a dark
 * face plate, two glowing eyes and a light on its antenna (see
 * `AgentState`). Below 24 px its eyes and antenna are bigger and its bolts
 * go; at 28 px and up it wears its role's outfit. The body is one still
 * SVG; only three small parts move (the whole bot's bob, its eyes, its
 * light, and while it works one key), each by transform or opacity, so a
 * page full of marks costs little and nothing runs per frame in script.
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
  const mood = MOODS[state];
  return (
    <span
      key={reaction ? (reactionId ?? reaction) : undefined}
      className={`dot-mark agent-mark ${className}`}
      data-agent={state}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      data-outfit={outfit}
      data-hatted={outfit && HATS.has(outfit) ? "" : undefined}
      data-reaction={reaction ?? undefined}
      data-vacant={vacant || undefined}
      style={own}
      aria-hidden
    >
      <span className="agent-bob">
        <svg
          className="agent-body"
          viewBox={VIEW_BOX}
          aria-hidden
          focusable="false"
        >
          <path className="agent-bolts" d={AGENT_PATHS.bolts} />
          <path className="agent-head" d={AGENT_PATHS.head} />
          <path className="agent-plate" d={AGENT_PATHS.plate} />
          <path className="agent-stalk" d={AGENT_PATHS.stalk} />
          {state === "working" && !vacant ? (
            <path className="agent-keys" d={AGENT_PATHS.keys} />
          ) : null}
          {state === "resting" && !vacant ? (
            <path className="agent-z" d={AGENT_PATHS.z} />
          ) : null}
          {outfit && !vacant ? (
            <g className="agent-outfit">
              {OUTFIT_PATHS[outfit].map((part, index) => (
                <path key={index} className={`agent-${part.kind}`} d={part.d} />
              ))}
            </g>
          ) : null}
        </svg>
        {vacant ? null : (
          <span className="agent-eyes" data-mood={mood}>
            <svg viewBox={VIEW_BOX} aria-hidden focusable="false">
              <path className="agent-eye-big" d={EYES[mood][0]} />
              <path className="agent-eye-small" d={EYES[mood][1]} />
            </svg>
          </span>
        )}
        <i className="agent-light" />
        {state === "working" && !vacant ? <i className="agent-key" /> : null}
      </span>
    </span>
  );
});
