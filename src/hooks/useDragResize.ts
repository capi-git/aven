import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { suppressTextSelection } from "../lib/drag";

const DRAG_FRAME_DEADLINE_MS = 16;

type Options = {
  enabled?: boolean;
  min: number;
  direction?: "left" | "right";
  max: () => number;
  defaultWidth: number;
  initial: number;
  onCommit?: (width: number) => void;
};

function clampTo(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Drag a pane's width by writing the DOM directly so React re-renders can't fight the cursor. */
export function useDragResize({
  enabled = true,
  direction = "right",
  min,
  max,
  defaultWidth,
  initial,
  onCommit,
}: Options) {
  const minRef = useRef(min);
  minRef.current = min;
  const maxRef = useRef(max);
  maxRef.current = max;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const defaultRef = useRef(defaultWidth);
  defaultRef.current = defaultWidth;

  const clamp = useCallback((value: number) => {
    return clampTo(value, minRef.current, maxRef.current());
  }, []);

  const [width, setWidth] = useState(() => clamp(initial));
  const [dragging, setDragging] = useState(false);
  const paneRef = useRef<HTMLElement | null>(null);
  const widthRef = useRef(width);
  const stopDrag = useRef<(() => void) | null>(null);

  const apply = (next: number) => {
    widthRef.current = next;
    const pane = paneRef.current;
    const value = `${next}px`;
    if (pane && pane.style.width !== value) {
      pane.style.width = value;
      // Native browser siblings need the committed geometry immediately;
      // ResizeObserver/RAF can be throttled while Chromium covers WK.
      window.dispatchEvent(new Event("supermono:workspace-layout"));
    }
  };

  const setPaneRef = useCallback((el: HTMLElement | null) => {
    paneRef.current = el;
    if (el) el.style.width = `${widthRef.current}px`;
  }, []);

  const commit = (next: number) => {
    const value = clamp(next);
    apply(value);
    setWidth(value);
    onCommitRef.current?.(value);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || event.button !== 0) return;
    stopDrag.current?.();
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startW = widthRef.current;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(pointerId);
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    document.documentElement.classList.add("is-resizing");

    let pendingWidth = startW;
    let frame: number | null = null;
    let fallback: number | null = null;
    const cancelPaint = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (fallback !== null) window.clearTimeout(fallback);
      frame = null;
      fallback = null;
    };
    const flush = () => {
      cancelPaint();
      apply(pendingWidth);
    };
    const readPointer = (ev: PointerEvent) => {
      pendingWidth = clamp(
        startW + (ev.clientX - startX) * (direction === "left" ? -1 : 1),
      );
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      readPointer(ev);
      if (
        frame === null &&
        fallback === null &&
        pendingWidth !== widthRef.current
      ) {
        frame = requestAnimationFrame(flush);
        fallback = window.setTimeout(flush, DRAG_FRAME_DEADLINE_MS);
      }
    };

    const stop = () => {
      if (stopDrag.current !== stop) return;
      stopDrag.current = null;
      cancelPaint();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", stop);
      handle.removeEventListener("lostpointercapture", stop);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commit(pendingWidth);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // The OS may coalesce the last move into release, especially at a native
      // browser boundary. Save the release position rather than an older frame.
      readPointer(ev);
      stop();
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) stop();
    };

    stopDrag.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", stop);
    handle.addEventListener("lostpointercapture", stop);
  };

  useEffect(() => () => stopDrag.current?.(), []);
  useEffect(() => {
    if (!enabled) stopDrag.current?.();
  }, [enabled]);

  const onDoubleClick = () => {
    commit(defaultRef.current);
  };

  return {
    width,
    dragging,
    setPaneRef,
    setWidth: commit,
    onPointerDown,
    onDoubleClick,
  };
}
