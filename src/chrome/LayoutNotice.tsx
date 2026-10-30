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
 * A quiet notice under the panes' title rows after a tab moves into or out
 * of a split, or a split comes apart: what happened, in a line, and Undo.
 * It never takes focus, waits while pointed at or focused, and goes on its
 * own. It is cut out of a native page under it
 * (`data-native-browser-occluded`), so it shows over a page too.
 *
 * Screen readers hear it from one live region that stays mounted, whose
 * words change, since a region mounted with its words already in it is
 * often not read. `shown` false (Settings open, say) keeps the region and
 * hides only the pill.
 */
export function LayoutNotice({
  notice,
  shown = true,
  onUndo,
  onDismiss,
}: {
  notice: LayoutNoticeState | null;
  shown?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {notice?.text ?? ""}
      </div>
      {notice && shown ? (
        <NoticePill
          key={notice.id}
          notice={notice}
          onUndo={onUndo}
          onDismiss={onDismiss}
        />
      ) : null}
    </>
  );
}

/**
 * One notice's pill. Keyed by the notice, so whether it is held (pointed
 * at, focused) starts afresh with each one: a pill taken away under the
 * pointer, by Undo or its cross, never leaves the next one held for good.
 */
function NoticePill({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: LayoutNoticeState;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const held = pointed || focused;
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismiss.current(), LAYOUT_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [held]);
  return (
    <div
      className="aven-layout-notice"
      data-layout-notice
      data-native-browser-occluded="true"
      onPointerEnter={() => setPointed(true)}
      onPointerLeave={() => setPointed(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
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
