import "./DotSpinner.css";

const DOTS = 8;

/**
 * A ring of grey dots, brightest at its head, turning in steps while
 * something works (a script, a pull request's checks). Still under Reduce
 * motion; paused while the window is hidden.
 */
export function DotSpinner({ size = 12 }: { size?: number }) {
  return (
    <svg
      className="dot-spinner"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {Array.from({ length: DOTS }, (_, i) => {
        const angle = (i / DOTS) * Math.PI * 2 - Math.PI / 2;
        return (
          <circle
            key={i}
            cx={12 + Math.cos(angle) * 8.5}
            cy={12 + Math.sin(angle) * 8.5}
            r={2.1}
            fill="currentColor"
            opacity={0.2 + (0.8 * i) / (DOTS - 1)}
          />
        );
      })}
    </svg>
  );
}
