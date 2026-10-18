import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripVertical, X } from "./icons";
import { isTextTruncated } from "../lib/truncatedTitle";

export const PANE_DRAG_LABEL = "Drag to move or split this pane";

type Props = {
  name: string;
  /** Shown on hover in place of a cut-off name, e.g. "Title · Model". */
  tooltip?: string;
  /** The pane's provider or project mark, or a file's icon. */
  icon: ReactNode;
  /** The focused pane's strip takes the active tab fill. */
  focused: boolean;
  closeTitle: string;
  onClose: () => void;
  /** The whole strip is the handle; absent where the pane cannot move. */
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
};

/**
 * A pane's own bar while it shares a tab with another pane: one tab in the
 * shared tab style, laid out above the pane's content so it never covers it.
 * Panes that already draw a tab row (files, terminals) use that row instead.
 */
export function PaneNameStrip({
  name,
  tooltip,
  icon,
  focused,
  closeTitle,
  onClose,
  onDragStart,
}: Props) {
  const label = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const draggable = onDragStart ? "true" : undefined;
  return (
    <div
      role="group"
      aria-label={name}
      data-pane-strip
      className={`aven-tab-bar flex min-w-0 shrink-0 touch-none select-none ${
        onDragStart ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !onDragStart) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]"))
          return;
        onDragStart(event);
      }}
    >
      <div className="aven-tab-strip flex min-w-0 flex-1 items-center">
        {onDragStart ? (
          <span
            aria-hidden
            title={PANE_DRAG_LABEL}
            className="grid h-full w-5 shrink-0 place-items-center text-content/35 hover:text-content/70"
          >
            <GripVertical className="size-3.5" strokeWidth={1.75} aria-hidden />
          </span>
        ) : null}
        <div
          data-active={focused}
          data-closable="true"
          data-draggable={draggable}
          className="aven-tab aven-tab-slot group relative flex h-full shrink items-center"
        >
          <div className="aven-tab-motion">
            <div className="aven-tab-button flex min-w-0 flex-1 items-center">
              {icon}
              <span
                ref={label}
                data-pane-strip-label
                title={tooltip ?? (cut ? name : undefined)}
                className="aven-tab-label min-w-0 flex-1 truncate"
                onPointerEnter={() => setCut(isTextTruncated(label.current))}
              >
                {name}
              </span>
            </div>
            <button
              type="button"
              title={closeTitle}
              aria-label="Close pane"
              data-no-drag
              className="aven-tab-close"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="size-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
