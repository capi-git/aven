import { ArrowDownLeft, ArrowUpRight, Minus, X } from "../chrome/icons";

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
  controls,
  closeTitle = "Close (the team goes on)",
}: {
  title: string;
  fullTitle?: string;
  controls?: TeamPanelControls;
  closeTitle?: string;
}) {
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
          aria-label="Open in its own window"
          title="Open in its own window, to move anywhere"
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
          aria-label="Back to its window"
          title="Back to the window it runs in"
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
