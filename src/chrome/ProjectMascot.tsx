import type { CSSProperties } from "react";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import {
  MASCOT_GRID,
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  MASCOT_TWINKLE_PATH,
  projectMascot,
} from "../lib/projectMascots";
import "./ProjectMascot.css";

type Props = {
  project: string;
  /** Project color; omit to inherit the surrounding text color. */
  color?: string;
  /** Explicit pick from the project menu; falls back to the hashed one. */
  name?: string | null;
  className?: string;
  /** Cycles the mascot's two frames while a turn is in flight. */
  active?: boolean;
  /** Plays a one-shot reaction to a turn's end instead of either frame loop. */
  reaction?: MascotReactionKind | null;
  /** Identifies the reaction, so a new one restarts its animation. */
  reactionId?: string;
};

/** Pixel mascot standing in for the project's color dot. */
export function ProjectMascot({
  project,
  color,
  name,
  className = "size-3 shrink-0",
  active = false,
  reaction = null,
  reactionId,
}: Props) {
  const mascot = projectMascot(project, name);
  if (reaction) {
    return (
      <svg
        key={reactionId ?? reaction}
        aria-hidden
        viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
        shapeRendering="crispEdges"
        overflow="visible"
        className={`${className} mascot-reacting`}
        data-reaction={reaction}
        fill="currentColor"
        style={
          {
            ...(color ? { color } : {}),
            "--mascot-reaction-ms": `${MASCOT_REACTION_MS[reaction]}ms`,
          } as CSSProperties
        }
      >
        <g className="mascot-body">
          <path d={mascot.restPath} />
          {reaction === "shrug" || reaction === "tilt" ? (
            <path className="mascot-blink" d={mascot.blinkPath} />
          ) : null}
        </g>
        {reaction === "cheer" ? (
          <>
            <path className="mascot-sparkle" d={MASCOT_SPARKLE_PATH} />
            <path className="mascot-twinkle" d={MASCOT_TWINKLE_PATH} />
          </>
        ) : null}
        {reaction === "slump" ? (
          <path className="mascot-sweat" d={MASCOT_SWEAT_PATH} />
        ) : null}
      </svg>
    );
  }
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      shapeRendering="crispEdges"
      className={`${className} ${active ? "mascot-active" : ""}`}
      fill="currentColor"
      style={color ? { color } : undefined}
    >
      {active ? (
        <>
          <path className="mascot-rest" d={mascot.restPath} />
          <path className="mascot-talk" d={mascot.talkPath} />
        </>
      ) : (
        <path d={mascot.restPath} />
      )}
    </svg>
  );
}
