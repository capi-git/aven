import { useEffect, useRef, type PointerEvent } from "react";
import { BrowserPane } from "./BrowserPane";
import { requestAddToChat } from "../lib/quoteDraft";
import {
  browserIdForProject,
  type BrowserWorkspace,
} from "../lib/personalWorkspace";

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
    const originalCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    document.body.dataset.personalResizing = "true";
    const move = (e: globalThis.PointerEvent) => {
      const bounds = parent.getBoundingClientRect();
      next = clamp((bounds.right - e.clientX) / bounds.width);
      el.style.width = `${next * 100}%`;
    };
    const finish = () => {
      document.body.style.cursor = originalCursor;
      delete document.body.dataset.personalResizing;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      cleanup.current = null;
      onChange({ ratio: next });
    };
    cleanup.current = finish;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
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
