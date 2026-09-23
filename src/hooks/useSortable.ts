import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../lib/drag";
import { moveItem } from "../lib/reorder";
import {
  SortableMotion,
  type SortableMotionPositions,
} from "../lib/sortableMotion";

const THRESHOLD = 5;
const DROP_ON_INSET = 0.25;
const SCROLL_EDGE = 28;

/** DOM screen coordinates in CSS pixels; never substitute client coordinates. */
export type SortablePointerPosition = { screenX: number; screenY: number };

export type SortableDropTarget = {
  kind: "tab" | "group";
  id: string;
  /** False when the drop is refused — the target is flagged, not acted on. */
  allowed: boolean;
};

export type SortableOptions = {
  axis?: "x" | "y";
  /** Move direct [data-sortable-motion] children, preserving outer hit boxes. */
  animate?: boolean;
  /** Called once the pointer crosses the drag threshold. */
  onActivate?: (id: string) => void;
  onDragMove?: (
    id: string,
    x: number,
    y: number,
    pointer: SortablePointerPosition,
  ) => void;
  /** Returning true consumes the drop instead of reordering the strip. */
  onDragEnd?: (
    id: string,
    x: number,
    y: number,
    cancelled: boolean,
    pointer: SortablePointerPosition,
  ) => boolean;
  onDropOnItem?: (draggedId: string, targetId: string) => void;
  onDropOnGroup?: (draggedId: string, groupId: string) => void;
  canDropOn?: (
    draggedId: string,
    kind: "tab" | "group",
    targetId: string,
  ) => boolean;
};

type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  screenX: number;
  screenY: number;
  inStrip: boolean;
  toIndex: number;
  dropTarget: SortableDropTarget | null;
};

function optionsOf(
  axisOrOptions: "x" | "y" | SortableOptions | undefined,
): SortableOptions {
  if (axisOrOptions == null) return { axis: "x" };
  if (axisOrOptions === "x" || axisOrOptions === "y")
    return { axis: axisOrOptions };
  return { axis: "x", ...axisOrOptions };
}

export function useSortable(
  ids: string[],
  onReorder: (ids: string[], movedId?: string) => void,
  axisOrOptions: "x" | "y" | SortableOptions = "x",
) {
  const options = optionsOf(axisOrOptions);
  const axis = options.axis ?? "x";
  const animateRef = useRef(options.animate === true);
  animateRef.current = options.animate === true;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const onDropOnItemRef = useRef(options.onDropOnItem);
  onDropOnItemRef.current = options.onDropOnItem;
  const onDropOnGroupRef = useRef(options.onDropOnGroup);
  onDropOnGroupRef.current = options.onDropOnGroup;
  const onActivateRef = useRef(options.onActivate);
  onActivateRef.current = options.onActivate;
  const onDragMoveRef = useRef(options.onDragMove);
  onDragMoveRef.current = options.onDragMove;
  const onDragEndRef = useRef(options.onDragEnd);
  onDragEndRef.current = options.onDragEnd;
  const canDropOnRef = useRef(options.canDropOn);
  canDropOnRef.current = options.canDropOn;
  const container = useRef<HTMLElement | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const groupNodes = useRef(new Map<string, HTMLElement>());
  const drag = useRef<DragState | null>(null);
  const suppressClickUntil = useRef(0);
  const cleanupDrag = useRef<(() => void) | null>(null);
  const motion = useRef(new SortableMotion());
  const settling = useRef<SortableMotionPositions | null>(null);
  useLayoutEffect(() => {
    if (!settling.current) return;
    const positions = settling.current;
    settling.current = null;
    motion.current.settle(positions, nodes.current);
  });
  useEffect(
    () => () => {
      cleanupDrag.current?.();
      settling.current = null;
      motion.current.cancel();
    },
    [],
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [toIndex, setToIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<SortableDropTarget | null>(null);

  const setContainerRef = useCallback((element: HTMLElement | null) => {
    container.current = element;
  }, []);

  const inStrip = useCallback((x: number, y: number) => {
    const bounds = container.current
      ? [container.current.getBoundingClientRect()]
      : [...nodes.current.values()].map((node) => node.getBoundingClientRect());
    return bounds.some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom,
    );
  }, []);

  const setItemRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const setGroupDropRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) groupNodes.current.set(id, el);
    else groupNodes.current.delete(id);
  }, []);

  const indexAt = useCallback(
    (draggedId: string, x: number, y: number) => {
      const pos = axis === "x" ? x : y;
      let next = 0;
      // The destination is an insertion slot after removing the source. Its
      // own midpoint must not advance a rightward drag into its neighbor.
      for (const id of idsRef.current) {
        if (id === draggedId) continue;
        const rect = nodes.current.get(id)?.getBoundingClientRect();
        if (!rect) continue;
        const mid =
          axis === "x"
            ? rect.left + rect.width / 2
            : rect.top + rect.height / 2;
        if (pos < mid) break;
        next += 1;
      }
      return next;
    },
    [axis],
  );

  const dropTargetAt = useCallback(
    (draggedId: string, x: number, y: number): SortableDropTarget | null => {
      const target = (
        kind: "tab" | "group",
        id: string,
      ): SortableDropTarget => ({
        kind,
        id,
        allowed: canDropOnRef.current?.(draggedId, kind, id) ?? true,
      });
      for (const [groupId, el] of groupNodes.current) {
        const rect = el.getBoundingClientRect();
        if (
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom
        ) {
          return target("group", groupId);
        }
      }
      if (!onDropOnItemRef.current) return null;
      for (const id of idsRef.current) {
        if (id === draggedId) continue;
        const rect = nodes.current.get(id)?.getBoundingClientRect();
        if (!rect) continue;
        const inset =
          axis === "x"
            ? rect.width * DROP_ON_INSET
            : rect.height * DROP_ON_INSET;
        const inCenter =
          axis === "x"
            ? x >= rect.left + inset &&
              x <= rect.right - inset &&
              y >= rect.top &&
              y <= rect.bottom
            : y >= rect.top + inset &&
              y <= rect.bottom - inset &&
              x >= rect.left &&
              x <= rect.right;
        if (inCenter) return target("tab", id);
      }
      return null;
    },
    [axis],
  );

  const onItemPointerDown = useCallback(
    (id: string, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      if (idsRef.current.length < 2 && !onDragEndRef.current) return;
      if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
        return;
      }
      const handle = event.currentTarget as HTMLElement;
      const from = idsRef.current.indexOf(id);
      if (from < 0) return;
      cleanupDrag.current?.();
      settling.current = null;
      motion.current.cancel();
      const animate = animateRef.current;
      if (animate)
        motion.current.begin(
          nodes.current,
          id,
          { x: event.clientX, y: event.clientY },
          axis,
        );
      // A new press is intentional, even immediately after a previous drag.
      suppressClickUntil.current = 0;

      const state: DragState = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        active: false,
        screenX: event.screenX,
        screenY: event.screenY,
        inStrip: true,
        toIndex: from,
        dropTarget: null,
      };
      drag.current = state;
      handle.setPointerCapture(event.pointerId);
      const restoreSelection = suppressTextSelection();

      let scrollFrame: number | null = null;
      const updateTarget = () => {
        const current = drag.current;
        if (!current?.active) return;
        current.inStrip = inStrip(current.x, current.y);
        current.toIndex = indexAt(id, current.x, current.y);
        current.dropTarget = dropTargetAt(id, current.x, current.y);
        if (animate)
          motion.current.move(
            idsRef.current,
            current,
            current.dropTarget ? from : current.toIndex,
            current.inStrip,
          );
        setToIndex(current.inStrip ? current.toIndex : null);
        setDropTarget(current.dropTarget);
        onDragMoveRef.current?.(id, current.x, current.y, {
          screenX: current.screenX,
          screenY: current.screenY,
        });
      };
      const scrollContainerAt = () => {
        const current = drag.current;
        if (!current) return null;
        const candidates = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-sortable-scroll-container]",
          ),
        ];
        if (container.current && !candidates.includes(container.current))
          candidates.push(container.current);
        return (
          candidates.find((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              current.x >= rect.left &&
              current.x <= rect.right &&
              current.y >= rect.top &&
              current.y <= rect.bottom
            );
          }) ?? null
        );
      };
      const scrollSpeed = () => {
        const element = scrollContainerAt();
        const current = drag.current;
        if (!element || !current?.active) return 0;
        const rect = element.getBoundingClientRect();
        const cross = axis === "x" ? current.y : current.x;
        if (
          cross < (axis === "x" ? rect.top : rect.left) ||
          cross > (axis === "x" ? rect.bottom : rect.right)
        )
          return 0;
        const pos = axis === "x" ? current.x : current.y;
        const start = axis === "x" ? rect.left : rect.top;
        const end = axis === "x" ? rect.right : rect.bottom;
        if (pos < start || pos > end) return 0;
        const offset = axis === "x" ? element.scrollLeft : element.scrollTop;
        const maximum =
          axis === "x"
            ? element.scrollWidth - element.clientWidth
            : element.scrollHeight - element.clientHeight;
        if (pos < start + SCROLL_EDGE && offset > 0)
          return -12 * (1 - (pos - start) / SCROLL_EDGE);
        if (pos > end - SCROLL_EDGE && offset < maximum)
          return 12 * (1 - (end - pos) / SCROLL_EDGE);
        return 0;
      };
      // Pointer input and edge autoscroll share one frame. High-rate pointer
      // events only replace coordinates, never repeat DOM hit testing.
      const scheduleDragFrame = () => {
        if (scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = null;
          const element = scrollContainerAt();
          const speed = scrollSpeed();
          if (element && speed) {
            if (axis === "x") element.scrollLeft += speed;
            else element.scrollTop += speed;
          }
          updateTarget();
          if (element && speed) scheduleDragFrame();
        });
      };
      const onMove = (ev: PointerEvent) => {
        const current = drag.current;
        if (!current || current.id !== id || ev.pointerId !== current.pointerId)
          return;
        current.x = ev.clientX;
        current.y = ev.clientY;
        current.screenX = ev.screenX;
        current.screenY = ev.screenY;
        if (!current.active) {
          if (
            Math.hypot(
              ev.clientX - current.startX,
              ev.clientY - current.startY,
            ) < THRESHOLD
          ) {
            return;
          }
          current.active = true;
          setGrabbing(true);
          setDraggingId(id);
          setToIndex(from);
          onActivateRef.current?.(id);
        }
        scheduleDragFrame();
      };

      const onUp = (ev: PointerEvent) => {
        const current = drag.current;
        if (!current || ev.pointerId !== current.pointerId) return;
        current.x = ev.clientX;
        current.y = ev.clientY;
        current.screenX = ev.screenX;
        current.screenY = ev.screenY;
        current.inStrip = inStrip(current.x, current.y);
        current.toIndex = indexAt(id, current.x, current.y);
        current.dropTarget = dropTargetAt(id, current.x, current.y);
        stop(true);
      };
      const onCancel = (event?: Event) => {
        if (
          event instanceof PointerEvent &&
          event.pointerId !== state.pointerId
        )
          return;
        stop(false);
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          stop(false);
        }
      };

      function stop(commit: boolean) {
        if (!drag.current) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("blur", onCancel);
        handle.removeEventListener("lostpointercapture", onCancel);
        cleanupDrag.current = null;
        if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
        const current = drag.current;
        if (animate) {
          settling.current = current?.active ? motion.current.capture() : null;
          motion.current.reset();
        }
        drag.current = null;
        restoreSelection();
        setGrabbing(false);
        setDraggingId(null);
        setToIndex(null);
        setDropTarget(null);
        try {
          handle.releasePointerCapture(state.pointerId);
        } catch {
          /* already released */
        }
        if (!current?.active) {
          if (animate) motion.current.finishReset();
          return;
        }
        suppressClickUntil.current = performance.now() + 400;
        const consumed = onDragEndRef.current?.(
          current.id,
          current.x,
          current.y,
          !commit,
          { screenX: current.screenX, screenY: current.screenY },
        );
        if (
          consumed ||
          !current.inStrip ||
          (commit && current.dropTarget?.allowed)
        ) {
          settling.current = null;
          if (animate) motion.current.finishReset();
        }
        if (!commit || consumed) return;
        if (current.dropTarget) {
          // A refused target still swallows the drop: the tab stays put rather
          // than reordering into a group it cannot join.
          if (!current.dropTarget.allowed) return;
          if (current.dropTarget.kind === "tab") {
            onDropOnItemRef.current?.(current.id, current.dropTarget.id);
          } else {
            onDropOnGroupRef.current?.(current.id, current.dropTarget.id);
          }
          return;
        }
        // Outside/invalid releases must never fall back to a horizontal reorder.
        if (!current.inStrip) return;
        const list = idsRef.current;
        const fromIndex = list.indexOf(current.id);
        if (fromIndex >= 0 && current.toIndex !== fromIndex) {
          onReorderRef.current(
            moveItem(list, fromIndex, current.toIndex),
            current.id,
          );
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
      window.addEventListener("blur", onCancel);
      handle.addEventListener("lostpointercapture", onCancel);
      cleanupDrag.current = onCancel;
    },
    [axis, dropTargetAt, indexAt, inStrip],
  );

  const consumeClick = useCallback(() => {
    const suppressed = performance.now() < suppressClickUntil.current;
    suppressClickUntil.current = 0;
    return suppressed;
  }, []);

  return {
    draggingId,
    fromIndex: draggingId ? ids.indexOf(draggingId) : null,
    toIndex: draggingId && !dropTarget ? toIndex : null,
    dropTarget: draggingId ? dropTarget : null,
    setContainerRef,
    setItemRef,
    setGroupDropRef,
    onItemPointerDown,
    consumeClick,
  };
}
