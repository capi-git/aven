import { memo, type CSSProperties } from "react";
import {
  CROSS_ROWS,
  DOT_VIEW_BOX,
  GRID_DIAGONAL_PATHS,
  GRID_PATH,
  TICK_ROWS,
  diagonalPaths,
  litCells,
  litPath,
  sigilByKey,
  type DotSigil,
} from "../lib/dotSigils";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import type { MarkTone } from "../lib/markTones";
import "./DotMark.css";

/**
 * What a mark shows:
 * - `still`: its sigil, unmoving (lists: the sidebar, tabs, search).
 * - `idle`: its sigil breathing slowly, for an agent waiting on you.
 * - `working`: a light sweeping across it, corner to corner.
 * - `needs`: a quicker breath and an amber dot in its corner.
 * - `done`: its dots reshaped into a tick, with a green dot.
 * - `error`: a cross, with a red dot.
 */
export type DotMarkState =
  "still" | "idle" | "working" | "needs" | "done" | "error";

type Props = {
  /** The sigil, or its key. */
  sigil: DotSigil | string;
  state?: DotMarkState;
  /**
   * A one-shot reaction to a turn's end: a completed turn shows the tick, a
   * failed one the cross, and each moves the dots once.
   */
  reaction?: MascotReactionKind | null;
  /** Identifies one reaction, so a new one restarts its motion. */
  reactionId?: string;
  /**
   * `square`: the whole grid always drawn, plain enough to read as a
   * square, so the mark keeps one footprint whatever its sigil (the
   * message box's corner). Elsewhere a mark is its sigil.
   */
  frame?: "square";
  /**
   * The colour its lit dots take: its project's (`appearanceTone`). Grey,
   * or none, is the plain mark in the text colour. Unlit dots stay grey.
   */
  tone?: MarkTone | null;
  /** Sizes the mark (15px when not set). */
  className?: string;
  style?: CSSProperties;
};

const STATUS: Partial<Record<DotMarkState, true>> = {
  needs: true,
  done: true,
  error: true,
};

const FALLBACK: DotSigil = { key: "custom", label: "Mark", rows: [] };

/**
 * One of Aven's marks: a 5×5 grid of round dots in the theme's text colour,
 * its sigil lit in its project's colour (a small mark draws only the
 * sigil). One small SVG; every state is CSS on its paths (opacity,
 * transform and stroke colour), so nothing runs per frame in script, and a
 * still mark draws two paths.
 */
export const DotMark = memo(function DotMark({
  sigil,
  state = "still",
  reaction = null,
  reactionId,
  frame,
  tone,
  className = "",
  style,
}: Props) {
  const drawn =
    typeof sigil === "string" ? (sigilByKey(sigil) ?? FALLBACK) : sigil;
  const shown: DotMarkState =
    reaction === "cheer" ? "done" : reaction === "slump" ? "error" : state;
  const rows =
    shown === "done" ? TICK_ROWS : shown === "error" ? CROSS_ROWS : drawn.rows;
  const reshaped = rows !== drawn.rows;
  const working = shown === "working";
  return (
    <span
      key={reaction ? (reactionId ?? reaction) : undefined}
      className={`dot-mark ${className}`}
      data-state={shown}
      data-sigil={drawn.key}
      data-reaction={reaction ?? undefined}
      data-frame={frame}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      style={
        reaction
          ? ({
              ...style,
              "--dot-mark-reaction-ms": `${MASCOT_REACTION_MS[reaction]}ms`,
            } as CSSProperties)
          : style
      }
      aria-hidden
    >
      <svg
        className="dot-mark-art"
        viewBox={DOT_VIEW_BOX}
        aria-hidden
        focusable="false"
      >
        {working ? (
          <WorkingDots rows={rows} />
        ) : (
          <>
            <path className="dot-mark-grid" d={GRID_PATH} />
            {reshaped ? (
              <path className="dot-mark-was" d={litPath(drawn.rows)} />
            ) : null}
            <path className="dot-mark-lit" d={litPath(rows)} />
          </>
        )}
      </svg>
      {STATUS[shown] ? <i className="dot-mark-status" /> : null}
    </span>
  );
});

const workingPaths = new Map<string, readonly string[]>();

/** The grid and the lit dots by diagonal, each diagonal lit in turn. */
function WorkingDots({ rows }: { rows: readonly string[] }) {
  const key = rows.join("");
  let lit = workingPaths.get(key);
  if (!lit) {
    lit = diagonalPaths(litCells(rows));
    workingPaths.set(key, lit);
  }
  return (
    <>
      {GRID_DIAGONAL_PATHS.map((d, index) => (
        <path
          key={`g${index}`}
          className="dot-mark-grid-d"
          d={d}
          style={{ "--d": index } as CSSProperties}
        />
      ))}
      {lit.map((d, index) =>
        d ? (
          <path
            key={`l${index}`}
            className="dot-mark-lit-d"
            d={d}
            style={{ "--d": index } as CSSProperties}
          />
        ) : null,
      )}
    </>
  );
}
