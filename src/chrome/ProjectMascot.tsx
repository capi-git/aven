import type { CSSProperties } from "react";
import { AVEN_MARK_SUMMIT_COLOR } from "../lib/avenMark";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import {
  MASCOT_GRID,
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  MASCOT_TWINKLE_PATH,
  mascotEyeInk,
  projectMascot,
  summitBlendsIn,
  type MascotFrame,
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

/*
 * Shading is drawn as overlays on the body colour rather than mixed colours,
 * so it follows any colour, a CSS variable included, and costs nothing to
 * work out.
 */
const VIEW_BOX = `0 0 ${MASCOT_GRID} ${MASCOT_GRID}`;
const SHADE = "#000000";
const SHADE_OPACITY = 0.38;
const LIGHT = "#ffffff";
const LIGHT_OPACITY = 0.48;
const EYE = "#121215";
/** Eyes on a dark mascot. */
const PALE_EYE = "#f4f4f6";
/** The summit on a mascot already close to Aven's blue. */
const PALE_SUMMIT = "#f3f6ff";
const PALE_SUMMIT_OPACITY = 0.92;

type Look = { pale: boolean; ink: ReturnType<typeof mascotEyeInk> };

/** One frame's paths: the body in the mascot colour, then its overlays. */
function Frame({ frame, look }: { frame: MascotFrame; look: Look }) {
  const { pale, ink } = look;
  return (
    <>
      <path d={frame.body} />
      {frame.shade ? (
        <path d={frame.shade} fill={SHADE} fillOpacity={SHADE_OPACITY} />
      ) : null}
      {frame.light ? (
        <path d={frame.light} fill={LIGHT} fillOpacity={LIGHT_OPACITY} />
      ) : null}
      {frame.eyes ? (
        <path
          className="mascot-eyes"
          data-ink={ink}
          d={frame.eyes}
          fill={ink === "light" ? PALE_EYE : EYE}
        />
      ) : null}
      {frame.glint ? <path d={frame.glint} fill={LIGHT} /> : null}
      {frame.summit ? (
        <path
          className="mascot-summit"
          data-pale={pale || undefined}
          d={frame.summit}
          fill={pale ? PALE_SUMMIT : AVEN_MARK_SUMMIT_COLOR}
          fillOpacity={pale ? PALE_SUMMIT_OPACITY : undefined}
        />
      ) : null}
    </>
  );
}

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
  const look: Look = {
    pale: summitBlendsIn(color, AVEN_MARK_SUMMIT_COLOR),
    ink: mascotEyeInk(color),
  };
  if (reaction) {
    const blinks = reaction === "shrug" || reaction === "tilt";
    return (
      <svg
        key={reactionId ?? reaction}
        aria-hidden
        viewBox={VIEW_BOX}
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
          <Frame frame={mascot.restFrame} look={look} />
          {blinks ? (
            // Closed lids: the body colour, shaded, over the eyes.
            <g className="mascot-blink">
              <path d={mascot.blinkPath} />
              <path
                d={mascot.blinkPath}
                fill={SHADE}
                fillOpacity={SHADE_OPACITY}
              />
            </g>
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
      viewBox={VIEW_BOX}
      shapeRendering="crispEdges"
      className={`${className} ${active ? "mascot-active" : ""}`}
      fill="currentColor"
      style={color ? { color } : undefined}
    >
      {active ? (
        <>
          <g className="mascot-rest">
            <Frame frame={mascot.restFrame} look={look} />
          </g>
          <g className="mascot-talk">
            <Frame frame={mascot.talkFrame} look={look} />
          </g>
        </>
      ) : (
        <Frame frame={mascot.restFrame} look={look} />
      )}
    </svg>
  );
}
