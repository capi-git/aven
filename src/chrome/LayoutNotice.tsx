import { useEffect, useRef, useState } from "react";
import { X } from "./icons";
import "./LayoutNotice.css";

/** A short notice saying where a moved tab went, with Undo. */
export type LayoutNoticeState = {
  id: number;
  text: string;
  /** Undo is offered while the move is still the last layout change. */
  canUndo: boolean;
};

/** How long a notice stays, unless pointed at or focused. */
export const LAYOUT_NOTICE_MS = 6000;

/**
 * A quiet notice at the foot of the workspace after a tab moves into or out
 * of a split, or a split comes apart: what happened, in a line, and Undo.
 * It never takes focus, waits while pointed at, and goes on its own. It is
 * cut out of a native page under it (`data-native-browser-occluded`), so it
 * shows over a page too.
 */
export function LayoutNotice({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: LayoutNoticeState | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [held, setHeld] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!notice || held) return;
    const timer = window.setTimeout(() => dismiss.current(), LAYOUT_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, held]);
  if (!notice) return null;
  return (
    <div
      key={notice.id}
      role="status"
      aria-live="polite"
      className="aven-layout-notice"
      data-layout-notice
      data-native-browser-occluded="true"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <p className="aven-layout-notice-text">{notice.text}</p>
      {notice.canUndo ? (
        <button
          type="button"
          className="aven-layout-notice-undo"
          onClick={onUndo}
        >
          Undo
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        className="aven-layout-notice-dismiss"
        onClick={onDismiss}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
