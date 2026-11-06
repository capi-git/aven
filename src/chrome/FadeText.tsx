import type { ReactNode } from "react";
import { useFadeCut, useMiddleCut } from "../hooks/useSoftCut";

/**
 * A one-line label that, when it runs out of room, fades out over its last
 * 1.5em instead of ending in "…" (after Rune's `truncate_fade`). The whole
 * text stays in the label, for copying and for readers.
 */
export function FadeText({
  className,
  children,
  title,
}: {
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const ref = useFadeCut<HTMLSpanElement>();
  return (
    <span
      ref={ref}
      className={className ? `fade-cut ${className}` : "fade-cut"}
      title={title}
    >
      <span className="fade-cut-text">{children}</span>
    </span>
  );
}

/**
 * A path or file name that keeps both ends when it runs out of room,
 * "…" standing in for the middle (after Rune's `truncate_middle`). Its
 * tooltip has the whole of it.
 */
export function MiddleText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const [ref, shown] = useMiddleCut<HTMLSpanElement>(text);
  return (
    <span
      ref={ref}
      className={className ? `middle-cut ${className}` : "middle-cut"}
      title={shown === text ? undefined : text}
      aria-label={shown === text ? undefined : text}
    >
      {shown}
    </span>
  );
}
