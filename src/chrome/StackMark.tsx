import { memo } from "react";
import type { MarkTone } from "../lib/markTones";
import { STACK_PAGES, STACK_VIEW_BOX } from "../lib/stackMark";
import "./StackMark.css";

type Props = {
  /**
   * Its project's colour (`appearanceTone`). Grey, or none, is the text
   * colour, toned down.
   */
  tone?: MarkTone | null;
  /** The project is open in the sidebar: the back pages fan out. */
  open?: boolean;
  /** Sizes the mark (15px when not set). */
  className?: string;
};

/**
 * A project's mark: three pages stacked in its colour, the back two
 * fainter. While the project is open they fan out, turning from the front
 * page's bottom; otherwise the mark stays still. One small SVG, its colour
 * from the theme's mark tokens and its fan a CSS transform.
 */
export const StackMark = memo(function StackMark({
  tone,
  open = false,
  className = "",
}: Props) {
  return (
    <span
      className={`stack-mark ${className}`}
      data-tone={tone && tone !== "grey" ? tone : undefined}
      data-open={open || undefined}
      aria-hidden
    >
      <svg
        className="stack-mark-art"
        viewBox={STACK_VIEW_BOX}
        aria-hidden
        focusable="false"
      >
        {STACK_PAGES.map((page) => (
          <rect
            key={page.part}
            className={`stack-mark-${page.part}`}
            x={page.x}
            y={page.y}
            width={page.width}
            height={page.height}
            rx={page.radius}
          />
        ))}
      </svg>
    </span>
  );
});
