import type { WorkConflict } from "../lib/workConflicts";
import "./SharedWork.css";

/**
 * A small amber mark on a sidebar row whose chat is editing a file another
 * working chat edits, or runs a second copy of a dev server. Its label says
 * which.
 */
export function WorkConflictMark({ conflict }: { conflict?: WorkConflict }) {
  if (!conflict) return null;
  return (
    <span
      className="work-conflict-mark"
      data-work-conflict={conflict.kind}
      role="img"
      aria-label={conflict.label}
      title={conflict.label}
    />
  );
}
