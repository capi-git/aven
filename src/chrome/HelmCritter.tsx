import { memo, type CSSProperties } from "react";
import type { HelmPose } from "../lib/composerHelm";
import {
  MASCOT_GRID,
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  MASCOT_TWINKLE_PATH,
  RESTING_ZZZ_PATHS,
  mascotFrame,
  mascotPath,
  projectMascot,
  type MascotFrame,
  type ProjectMascot,
} from "../lib/projectMascots";
import { MascotFrameShapes, mascotLook } from "./ProjectMascot";

/**
 * The helm's critter: the project's own pixel critter (the sprites the
 * sidebar, Home and tabs use) in a pose for what the message box is doing.
 * Everything is drawn on the critter's 12-cell grid, so it stays crisp at
 * any size, and its props (the zzz, the laptop, the sparkle, the sweat drop)
 * sit just outside that grid.
 *
 * Nothing here runs a frame loop: the only repeating motion, typing at the
 * laptop, is two stepped CSS frames (ComposerHelm.css), paused with the rest
 * of the helm while the window is hidden or the motion is reduced.
 */

/** Where the eyes look: left at your text, up at the dialog, down at the laptop. */
type Gaze = "ahead" | "left" | "up" | "down";

const GAZE: Record<Gaze, [number, number]> = {
  ahead: [0, 0],
  left: [-1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * The rows with each eye moved one cell toward `gaze`, where the cell it
 * moves into is part of the face (not empty, not another eye). Matches the
 * mock-ups' glance; a critter whose eyes have no room keeps them still.
 */
export function gazeRows(
  rows: readonly string[],
  gaze: Gaze,
): readonly string[] {
  const [dx, dy] = GAZE[gaze];
  if (!dx && !dy) return rows;
  const grid = rows.map((row) => row.split(""));
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] !== "e") continue;
      const target = grid[y + dy]?.[x + dx];
      if (!target || target === "." || target === "e") continue;
      out[y][x] = target;
      out[y + dy][x + dx] = "e";
    }
  return out.map((row) => row.join(""));
}

/** The eyes shut: each eye cell drawn as shade. */
export function closedRows(rows: readonly string[]): readonly string[] {
  return rows.map((row) => row.replace(/e/g, "="));
}

const frames = new Map<string, MascotFrame>();

function frameOf(
  mascot: ProjectMascot,
  base: "rest" | "talk",
  variant: Gaze | "closed",
): MascotFrame {
  const key = `${mascot.name}:${base}:${variant}`;
  let frame = frames.get(key);
  if (!frame) {
    const rows = base === "rest" ? mascot.rest : mascot.talk;
    frame = mascotFrame(
      variant === "closed" ? closedRows(rows) : gazeRows(rows, variant),
    );
    frames.set(key, frame);
  }
  return frame;
}

/** A tiny laptop held in front of the critter while the agent works. */
const LAPTOP = {
  case: mascotPath(
    [
      ".##########.",
      ".#........#.",
      ".#........#.",
      ".#........#.",
      "############",
    ],
    0,
    6,
  ),
  screen: mascotPath(
    ["..........", "#.##.#.#..", ".#..#.#.##", "#.#..#..#."],
    1,
    6,
  ),
  base: mascotPath([".==========."], 0, 11),
};

/** "zzz" above the right shoulder, at two thirds of a critter pixel. */
const ZZZ_SCALE = 2 / 3;

type Props = {
  /** The project folder whose critter this is; null outside a project. */
  project: string;
  /** The critter's name; falls back to the one hashed from `project`. */
  name?: string | null;
  color?: string;
  pose: HelmPose;
  className?: string;
  style?: CSSProperties;
};

export const HelmCritter = memo(function HelmCritter({
  project,
  name,
  color,
  pose,
  className = "",
  style,
}: Props) {
  const mascot = projectMascot(project, name);
  const look = mascotLook(color);
  const gaze: Gaze | "closed" =
    pose === "rest"
      ? "closed"
      : pose === "typing" || pose === "error"
        ? "left"
        : pose === "hover"
          ? "up"
          : pose === "running"
            ? "down"
            : "ahead";
  const running = pose === "running";
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      shapeRendering="crispEdges"
      overflow="visible"
      className={`helm-critter ${className}`}
      data-pose={pose}
      data-critter={mascot.name}
      fill="currentColor"
      style={{ ...(color ? { color } : {}), ...style }}
    >
      {running ? (
        <>
          <g className="helm-critter-frame helm-critter-frame-a">
            <MascotFrameShapes
              frame={frameOf(mascot, "rest", "down")}
              look={look}
            />
          </g>
          <g className="helm-critter-frame helm-critter-frame-b">
            <MascotFrameShapes
              frame={frameOf(mascot, "talk", "down")}
              look={look}
            />
          </g>
          <g className="helm-critter-laptop">
            <path className="helm-laptop-case" d={LAPTOP.case} />
            <path className="helm-laptop-screen" d={LAPTOP.screen} />
            <path className="helm-laptop-base" d={LAPTOP.base} />
          </g>
        </>
      ) : (
        <g className="helm-critter-body">
          <MascotFrameShapes
            frame={frameOf(mascot, "rest", gaze)}
            look={look}
          />
        </g>
      )}
      {pose === "rest" ? (
        <g
          className="helm-critter-zzz"
          transform={`translate(${MASCOT_GRID - 1} -${8}) scale(${ZZZ_SCALE})`}
        >
          {RESTING_ZZZ_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      ) : null}
      {pose === "done" ? (
        <>
          <path className="helm-critter-sparkle" d={MASCOT_SPARKLE_PATH} />
          <path className="helm-critter-twinkle" d={MASCOT_TWINKLE_PATH} />
        </>
      ) : null}
      {pose === "error" ? (
        <path className="helm-critter-sweat" d={MASCOT_SWEAT_PATH} />
      ) : null}
    </svg>
  );
});

/** The paper plane the critter holds: the message box's Send. */
export const PLANE_PATHS = {
  wing: mascotPath([
    "........##",
    "......###.",
    "....####..",
    "..#####...",
    "####.##...",
    "...#.#....",
    "....##....",
    ".....#....",
  ]),
  fold: mascotPath([
    "..........",
    "..........",
    "..........",
    ".......#..",
    "....#.....",
    "....#.....",
    "..........",
    "..........",
  ]),
} as const;

export function PaperPlane({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 8"
      shapeRendering="crispEdges"
      className={`helm-plane-art ${className}`}
    >
      <path className="helm-plane-wing" d={PLANE_PATHS.wing} />
      <path className="helm-plane-fold" d={PLANE_PATHS.fold} />
    </svg>
  );
}
