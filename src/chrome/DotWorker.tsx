import type { CSSProperties } from "react";
import "./DotWorker.css";

const GRID = 7;
const CENTRE = (GRID - 1) / 2;

/** The dots of a 7 by 7 grid that fall inside a circle, with a wave delay. */
const DOTS = Array.from({ length: GRID * GRID }, (_, i) => {
  const x = i % GRID;
  const y = Math.floor(i / GRID);
  return { x, y, d: Math.hypot(x - CENTRE, y - CENTRE) };
})
  .filter(({ d }) => d <= CENTRE + 0.35)
  .map(({ x, y }) => ({
    x,
    y,
    // A diagonal wave crosses the ball, top left to bottom right.
    delay: ((x + y) / ((GRID - 1) * 2)) * 1.2,
  }));

/**
 * The quiet working mark some people prefer to Bot in the message box: a
 * small round cluster of grey dots that shimmers in a wave while the agent
 * works. Settings › Appearance › Working mark chooses it.
 */
export function DotWorker({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`dot-worker ${className}`}
      viewBox={`0 0 ${GRID} ${GRID}`}
      aria-hidden
    >
      {DOTS.map(({ x, y, delay }) => (
        <circle
          key={`${x}:${y}`}
          cx={x + 0.5}
          cy={y + 0.5}
          r={0.32}
          style={{ animationDelay: `${delay}s` } as CSSProperties}
        />
      ))}
    </svg>
  );
}
