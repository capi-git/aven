import { ArrowDownLeft, ArrowUpRight, Minus, X } from "../chrome/icons";
import { MOD } from "../lib/platform";
import type { TeamKind } from "../lib/teamRuns";
import { TEAM_NOUN } from "../lib/teamWatch";

/**
 * What the panel's header offers where it is shown: shrink to a pill and
 * pop out (in the window), back to the window (popped out), and close.
 */
export type TeamPanelControls = {
  onShrink?: () => void;
  /** ↗ : out into a window of its own. */
  onPopOut?: () => void;
  /** ↙ : back into the window that owns the team. */
  onPopIn?: () => void;
  onClose?: () => void;
  /** The header is the window's own title bar (a popped-out panel). */
  windowDrag?: boolean;
};

/**
 * The panel's top line: what it shows, then its controls. In the window it
 * is the handle the panel is dragged by; popped out, it drags the window.
 */
export function TeamPanelBar({
  title,
  fullTitle,
  kind,
  controls,
}: {
  title: string;
  fullTitle?: string;
  /** What it shows, to say what keeps going once it is closed. */
  kind?: TeamKind | null;
  controls?: TeamPanelControls;
}) {
  const closeTitle = kind
    ? `Close (${MOD}W). The ${TEAM_NOUN[kind]} keeps going.`
    : `Close (${MOD}W)`;
  const drag = controls?.windowDrag ? { "data-tauri-drag-region": "" } : {};
  return (
    <div className="discussion-float-bar" data-discussion-drag {...drag}>
      <span
        className="discussion-float-title"
        title={fullTitle ?? title}
        {...drag}
      >
        {title}
      </span>
      {controls?.onShrink ? (
        <button
          type="button"
          className="discussion-float-control"
          aria-label="Shrink to a pill"
          title="Shrink to a pill"
          data-discussion-shrink
          data-team-shrink
          onClick={controls.onShrink}
        >
          <Minus className="size-3.5" />
        </button>
      ) : null}
      {controls?.onPopOut ? (
        <button
          type="button"
          className="discussion-float-control"
          aria-label="Open in a separate window"
          title="Open in a separate window you can move anywhere"
          data-team-pop-out
          onClick={controls.onPopOut}
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      ) : null}
      {controls?.onPopIn ? (
        <button
          type="button"
          className="discussion-float-control"
          aria-label="Put back in its Aven window"
          title="Put back in its Aven window"
          data-team-pop-in
          onClick={controls.onPopIn}
        >
          <ArrowDownLeft className="size-3.5" />
        </button>
      ) : null}
      {controls?.onClose ? (
        <button
          type="button"
          className="discussion-float-control"
          aria-label="Close"
          title={closeTitle}
          data-discussion-close
          data-team-close
          onClick={controls.onClose}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
