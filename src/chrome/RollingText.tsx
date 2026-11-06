import { useRef } from "react";
import { useRollingText } from "../hooks/useRollingText";
import "./RollingText.css";

/**
 * A count or label whose changed characters roll as it changes, like an
 * odometer: "68%" to "69%" rolls only the 9 in. Give it the number it shows
 * as `value` and it rolls up as the number rises and down as it falls.
 * `trailing` suits a label pinned to its right edge.
 */
export function RollingText({
  text,
  value,
  trailing,
  className,
  title,
}: {
  text: string;
  value?: number;
  trailing?: boolean;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useRollingText(ref, text, value, trailing);
  return (
    <span
      ref={ref}
      className={className ? `rolling-text ${className}` : "rolling-text"}
      title={title}
    />
  );
}
