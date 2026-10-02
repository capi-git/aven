import { useEffect, useRef, type PointerEvent } from "react";
import { BrowserPane } from "./BrowserPane";
import { requestAddToChat } from "../lib/quoteDraft";
import {
  browserIdForProject,
  type BrowserWorkspace,
} from "../lib/personalWorkspace";

const DRAG_FRAME_DEADLINE_MS = 16;

type Props = {
  project: string;
  state: BrowserWorkspace;
  visible: boolean;
  onChange: (patch: Partial<BrowserWorkspace>) => void;
};

export function PersonalBrowserDock({
  project,
  state,
  visible,
  onChange,
}: Props) {
  const dock = useRef<HTMLDivElement>(null);
  const shown = state.mode === "split" || state.expanded;
  const fullWidth = state.mode === "tab" || state.expanded;
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const clamp = (ratio: number) => Math.max(0.25, Math.min(0.7, ratio));
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = dock.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    cleanup.current?.();
    let next = state.ratio;
    let painted = el.style.width;
    // The split's own width does not change while its divider moves. Measure
    // once: reading layout after each width write forces a synchronous reflow
    // of the whole workspace on every pointer event.
    const bounds = parent.getBoundingClientRect();
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    document.body.dataset.personalResizing = "true";
    document.documentElement.classList.add("is-resizing");
    let frame: number | null = null;
    let fallback: number | null = null;
    const cancelPaint = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (fallback !== null) window.clearTimeout(fallback);
      frame = null;
      fallback = null;
    };
    // One width write per frame, however many pointer events arrive.
    const paint = () => {
      cancelPaint();
      const width = `${next * 100}%`;
      if (width === painted) return;
      painted = width;
      el.style.width = width;
      // The native page follows now; its ResizeObserver/RAF path can be
      // throttled while the native view covers WebKit.
      window.dispatchEvent(new Event("supermono:workspace-layout"));
    };
    const read = (e: globalThis.PointerEvent) => {
      if (bounds.width > 0)
        next = clamp((bounds.right - e.clientX) / bounds.width);
    };
    const move = (e: globalThis.PointerEvent) => {
      read(e);
      if (frame !== null || fallback !== null) return;
      frame = requestAnimationFrame(paint);
      fallback = window.setTimeout(paint, DRAG_FRAME_DEADLINE_MS);
    };
    const finish = () => {
      cancelPaint();
      document.body.style.cursor = originalCursor;
      delete document.body.dataset.personalResizing;
      document.documentElement.classList.remove("is-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      cleanup.current = null;
      paint();
      onChange({ ratio: next });
    };
    // Release may carry a final move the OS coalesced into it.
    const up = (e: globalThis.PointerEvent) => {
      read(e);
      finish();
    };
    cleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    window.addEventListener("blur", finish, { once: true });
  };

  return (
    <div
      ref={dock}
      className="personal-browser-dock"
      data-expanded={fullWidth}
      hidden={!shown}
      aria-hidden={!shown}
      inert={!shown || undefined}
      style={{ width: fullWidth ? "100%" : `${state.ratio * 100}%` }}
    >
      {!fullWidth && (
        <div
          role="separator"
          aria-label="Resize browser split"
          aria-orientation="vertical"
          aria-valuenow={Math.round(state.ratio * 100)}
          aria-valuemin={25}
          aria-valuemax={70}
          tabIndex={0}
          className="personal-browser-divider"
          onPointerDown={startResize}
          onDoubleClick={() => onChange({ ratio: 0.44 })}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            onChange({
              ratio: clamp(
                state.ratio + (event.key === "ArrowLeft" ? 0.05 : -0.05),
              ),
            });
          }}
        />
      )}
      <BrowserPane
        id={browserIdForProject(project)}
        initialUrl={state.url}
        visible={visible && shown}
        expanded={fullWidth}
        onToggleExpand={() =>
          onChange(
            fullWidth
              ? { mode: "split", expanded: false }
              : { mode: "tab", expanded: true },
          )
        }
        onClose={() => onChange({ open: false })}
        onUrlChange={(url) => onChange({ url })}
        onAddToChat={(text, attachments) => {
          onChange({ expanded: false });
          requestAnimationFrame(() =>
            requestAddToChat(text, "plain", attachments),
          );
        }}
      />
    </div>
  );
}
