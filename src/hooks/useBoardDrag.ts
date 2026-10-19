import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  effectiveCssZoom,
  setGrabbing,
  suppressTextSelection,
} from "../lib/drag";

/** How far the pointer moves before a press becomes a drag. */
const THRESHOLD = 5;

/** What a press must not start a drag from: its own controls and fields. */
const NO_DRAG = "input, textarea, select, a, [data-no-drag]";

/**
 * Drag a board card to another column with the pointer. The card follows the
 * pointer (transform only) while the column under it is marked with
 * `data-drop-target`; letting go over another column calls `onDrop`, and
 * Escape or letting go elsewhere puts it back. The click that ends a drag
 * never opens the card. Move to in the card's menu does the same from the
 * keyboard. Returns the handler for each card's `onPointerDown`.
 */
export function useBoardDrag(
  root: RefObject<HTMLElement | null>,
  onDrop: (cardId: string, column: string) => void,
): (event: ReactPointerEvent<HTMLElement>, cardId: string) => void {
  const drop = useRef(onDrop);
  drop.current = onDrop;
  /** Ends the drag under way, if any, as cancelled. */
  const abort = useRef<(() => void) | null>(null);
  useEffect(() => () => abort.current?.(), []);

  return useCallback(
    (event: ReactPointerEvent<HTMLElement>, cardId: string) => {
      if (event.button !== 0 || abort.current) return;
      if ((event.target as Element).closest(NO_DRAG)) return;
      const card = event.currentTarget;
      const from = card.closest<HTMLElement>("[data-board-column]")?.dataset
        .boardColumn;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let over: HTMLElement | null = null;
      let restoreSelection: (() => void) | null = null;

      const columnAt = (x: number, y: number) =>
        [
          ...(root.current?.querySelectorAll<HTMLElement>(
            "[data-board-column]",
          ) ?? []),
        ].find((column) => {
          const rect = column.getBoundingClientRect();
          return (
            x >= rect.left &&
            x <= rect.right &&
            y >= rect.top &&
            y <= rect.bottom
          );
        }) ?? null;
      const mark = (next: HTMLElement | null) => {
        const target = next?.dataset.boardColumn === from ? null : next;
        if (over === target) return;
        over?.removeAttribute("data-drop-target");
        over = target;
        over?.setAttribute("data-drop-target", "");
      };
      const move = (moved: PointerEvent) => {
        if (moved.pointerId !== pointerId) return;
        const dx = moved.clientX - startX;
        const dy = moved.clientY - startY;
        if (!active) {
          if (Math.hypot(dx, dy) < THRESHOLD) return;
          active = true;
          card.setAttribute("data-dragging", "");
          restoreSelection = suppressTextSelection();
          setGrabbing(true);
        }
        const zoom = effectiveCssZoom(card) || 1;
        card.style.transform = `translate(${dx / zoom}px, ${dy / zoom}px)`;
        mark(columnAt(moved.clientX, moved.clientY));
      };
      const end = (cancelled: boolean) => {
        detach();
        if (!active) return;
        const target = over;
        mark(null);
        card.removeAttribute("data-dragging");
        setGrabbing(false);
        restoreSelection?.();
        const column = target?.dataset.boardColumn;
        if (!cancelled && column) drop.current(cardId, column);
        card.style.transform = "";
        // The click that ends a drag lands on the card: swallow it.
        const swallow = (click: Event) => {
          click.stopPropagation();
          click.preventDefault();
        };
        card.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(
          () => card.removeEventListener("click", swallow, { capture: true }),
          0,
        );
      };
      const up = (released: PointerEvent) => {
        if (released.pointerId === pointerId) end(false);
      };
      const cancel = (cancelled: PointerEvent) => {
        if (cancelled.pointerId === pointerId) end(true);
      };
      const key = (pressed: KeyboardEvent) => {
        if (pressed.key !== "Escape" || !active) return;
        pressed.preventDefault();
        pressed.stopPropagation();
        end(true);
      };
      const detach = () => {
        abort.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key, true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key, true);
      abort.current = () => end(true);
    },
    [root],
  );
}
