import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { setGrabbing, suppressTextSelection } from "../lib/drag";
import { captureDropGhost } from "../lib/dropGhost";
import { moveItem } from "../lib/reorder";
import {
  SortableMotion,
  type SortableMotionPositions,
} from "../lib/sortableMotion";

const THRESHOLD = 5;
/**
 * An item's drop zone is its middle half: a quarter of it at each end
 * reorders, but never less than `DROP_ON_EDGE` pixels, so a narrow item
 * still leaves room to move past it.
 */
const DROP_ON_INSET = 0.25;
const DROP_ON_EDGE = 16;
/**
 * Once a delayed drop zone arms, it reaches this much further towards each
 * end, so a pointer resting on its boundary does not flicker between a
 * drop and a reorder.
 */
const DROP_ON_HOLD = 8;
const SCROLL_EDGE = 28;

/** DOM screen coordinates in CSS pixels; never substitute client coordinates. */
export type SortablePointerPosition = { screenX: number; screenY: number };

/**
 * A part of an item that a drag can pull out of the strip on its own: a
 * split entry's segment. Moving along the strip still moves the whole
 * item; once the pointer leaves the strip the part is torn off, the
 * floating copy shows only it, and the drop is the consumer's to place.
 */
export type SortablePart = { id: string; element: HTMLElement };

/**
 * A drag that started on a part, for the consumer's move and end callbacks
 * (others get none).
 */
export type SortablePartDrag = {
  /** The part pressed. */
  part: string;
  /** The pointer has left the strip: the part is torn off the item. */
  torn: boolean;
  /** The pointer is over the strip. */
  inStrip: boolean;
  /**
   * The item a torn-off part is armed to drop onto. The drop goes to
   * `onDropOnItem` with the part; the consumer only tidies up.
   */
  target?: string;
};

export type SortableDropTarget = {
  kind: "tab" | "group";
  id: string;
  /** False when the drop is refused — the target is flagged, not acted on. */
  allowed: boolean;
};

export type SortableOptions = {
  axis?: "x" | "y";
  /** Pick up the visual and shift siblings, preserving outer hit boxes. */
  animate?: boolean;
  /** Called once the pointer crosses the drag threshold. */
  onActivate?: (id: string) => void;
  onDragMove?: (
    id: string,
    x: number,
    y: number,
    pointer: SortablePointerPosition,
    part?: SortablePartDrag,
  ) => void;
  /**
   * Returning true consumes the drop instead of reordering the strip. A
   * torn-off part never reorders the strip.
   */
  onDragEnd?: (
    id: string,
    x: number,
    y: number,
    cancelled: boolean,
    pointer: SortablePointerPosition,
    part?: SortablePartDrag,
  ) => boolean;
  /** `part` names a torn-off part dropped onto the item. */
  onDropOnItem?: (draggedId: string, targetId: string, part?: string) => void;
  /**
   * Which items take a drop onto them (with `onDropOnItem`). Others are
   * never targets: the pointer over them reorders as usual. All items do
   * when absent. A torn-off part is named by `part`; over the strip it can
   * drop onto items too (never onto its own item or a group).
   */
  isDropTarget?: (
    draggedId: string,
    targetId: string,
    part?: string,
  ) => boolean;
  /**
   * How long, in milliseconds, the pointer rests on an item's drop zone
   * before a drop onto it arms. Until then the pointer there reorders as
   * usual, so a quick pass over an item never drops onto it; once armed,
   * the zone holds a little past its edges. 0 (the default) arms at once.
   */
  dropOnDelay?: number;
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
  part: SortablePart | null;
  torn: boolean;
  /** The item whose drop zone the pointer rests on, until it arms. */
  arming: { id: string; since: number } | null;
};

type ReadBounds = (element: HTMLElement) => DOMRect;

/** Reuse geometry within one update, never across scroll or layout changes. */
function measureBounds(): ReadBounds {
  const bounds = new Map<HTMLElement, DOMRect>();
  return (element) => {
    let rect = bounds.get(element);
    if (!rect) {
      rect = element.getBoundingClientRect();
      bounds.set(element, rect);
    }
    return rect;
  };
}

function sameDropTarget(
  previous: SortableDropTarget | null,
  next: SortableDropTarget | null,
): boolean {
  return (
    previous === next ||
    (previous?.id === next?.id &&
      previous?.kind === next?.kind &&
      previous?.allowed === next?.allowed)
  );
}

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
  const isDropTargetRef = useRef(options.isDropTarget);
  isDropTargetRef.current = options.isDropTarget;
  const dropOnDelayRef = useRef(options.dropOnDelay ?? 0);
  dropOnDelayRef.current = options.dropOnDelay ?? 0;
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

  const inStrip = useCallback(
    (x: number, y: number, readBounds: ReadBounds) => {
      const bounds = container.current
        ? [readBounds(container.current)]
        : [...nodes.current.values()].map(readBounds);
      return bounds.some(
        (rect) =>
          rect.width > 0 &&
          rect.height > 0 &&
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom,
      );
    },
    [],
  );

  const setItemRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const setGroupDropRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) groupNodes.current.set(id, el);
    else groupNodes.current.delete(id);
  }, []);

  const indexAt = useCallback(
    (draggedId: string, x: number, y: number, readBounds: ReadBounds) => {
      const pos = axis === "x" ? x : y;
      let next = 0;
      // The destination is an insertion slot after removing the source. Its
      // own midpoint must not advance a rightward drag into its neighbor.
      for (const id of idsRef.current) {
        if (id === draggedId) continue;
        const node = nodes.current.get(id);
        if (!node) continue;
        const rect = readBounds(node);
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
    (
      draggedId: string,
      x: number,
      y: number,
      readBounds: ReadBounds,
      /** An armed item, whose zone holds a little wider. */
      held: string | null = null,
      /** A torn-off part: it drops onto items only. */
      part?: string,
    ): SortableDropTarget | null => {
      const target = (
        kind: "tab" | "group",
        id: string,
      ): SortableDropTarget => ({
        kind,
        id,
        allowed: canDropOnRef.current?.(draggedId, kind, id) ?? true,
      });
      for (const [groupId, el] of part === undefined
        ? groupNodes.current
        : []) {
        const rect = readBounds(el);
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
        if (
          isDropTargetRef.current &&
          !(part === undefined
            ? isDropTargetRef.current(draggedId, id)
            : isDropTargetRef.current(draggedId, id, part))
        )
          continue;
        const node = nodes.current.get(id);
        if (!node) continue;
        const rect = readBounds(node);
        const size = axis === "x" ? rect.width : rect.height;
        const edge = Math.min(
          Math.max(size * DROP_ON_INSET, DROP_ON_EDGE),
          size / 2,
        );
        const inset = id === held ? Math.max(0, edge - DROP_ON_HOLD) : edge;
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
    (id: string, event: ReactPointerEvent, part?: SortablePart) => {
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
        part: part ?? null,
        torn: false,
        arming: null,
      };
      drag.current = state;
      handle.setPointerCapture(event.pointerId);
      const restoreSelection = suppressTextSelection();

      let scrollFrame: number | null = null;
      let armTimer: ReturnType<typeof setTimeout> | null = null;
      /** Look again once a drop zone the pointer rests on has armed. */
      const armLater = (wait: number) => {
        if (armTimer !== null) clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armTimer = null;
          if (drag.current?.active) scheduleDragFrame();
        }, Math.ceil(wait));
      };
      /** Where the pointer is now; a part leaving the strip tears off. */
      const locate = (current: DragState, readBounds: ReadBounds) => {
        current.inStrip = inStrip(current.x, current.y, readBounds);
        if (current.part && !current.inStrip && !current.torn) {
          current.torn = true;
          if (animate) motion.current.tearOff(current.part.element, current);
        }
        current.toIndex = indexAt(id, current.x, current.y, readBounds);
        const delay = dropOnDelayRef.current;
        const armed =
          current.dropTarget?.kind === "tab" ? current.dropTarget.id : null;
        let target =
          current.torn && !current.inStrip
            ? null
            : dropTargetAt(
                id,
                current.x,
                current.y,
                readBounds,
                delay > 0 ? armed : null,
                current.torn ? current.part?.id : undefined,
              );
        // A delayed zone arms once the pointer has rested on it; until then
        // the pointer there reorders.
        if (target?.kind !== "tab" || delay <= 0) current.arming = null;
        else if (target.id !== armed) {
          const now = performance.now();
          if (current.arming?.id !== target.id)
            current.arming = { id: target.id, since: now };
          const wait = current.arming.since + delay - now;
          if (wait > 0) {
            armLater(wait);
            target = null;
          }
        }
        current.dropTarget = target;
      };
      /** A drag that started on a part reports it; others pass nothing. */
      const partOf = (current: DragState): [SortablePartDrag] | [] =>
        current.part
          ? [
              {
                part: current.part.id,
                torn: current.torn,
                inStrip: current.inStrip,
                ...(current.torn &&
                current.dropTarget?.kind === "tab" &&
                current.dropTarget.allowed
                  ? { target: current.dropTarget.id }
                  : {}),
              },
            ]
          : [];
      const updateTarget = (readBounds: ReadBounds) => {
        const current = drag.current;
        if (!current?.active) return;
        const previousIndex =
          current.inStrip && !current.torn ? current.toIndex : null;
        const previousTarget = current.dropTarget;
        locate(current, readBounds);
        // Workspace drop callbacks read stationary pane/header geometry. Run
        // them before transform writes so that hit testing stays one read phase.
        onDragMoveRef.current?.(
          id,
          current.x,
          current.y,
          { screenX: current.screenX, screenY: current.screenY },
          ...partOf(current),
        );
        // A torn-off part leaves the item and its neighbours where they are.
        if (animate) {
          motion.current.move(
            idsRef.current,
            current,
            current.dropTarget ? from : current.toIndex,
            current.inStrip && !current.torn,
            readBounds,
          );
          motion.current.dropping(current.dropTarget?.kind === "tab");
        }
        const nextIndex =
          current.inStrip && !current.torn ? current.toIndex : null;
        if (nextIndex !== previousIndex) setToIndex(nextIndex);
        // Pointer motion inside the same target only moves visual children;
        // it must not re-render every tab and its contents each display frame.
        if (!sameDropTarget(previousTarget, current.dropTarget))
          setDropTarget(current.dropTarget);
      };
      const scrollContainerAt = (readBounds: ReadBounds) => {
        const current = drag.current;
        if (!current) return null;
        const candidates = [
          ...document.querySelectorAll<HTMLElement>(
            "[data-sortable-scroll-container]",
          ),
        ];
        if (container.current && !candidates.includes(container.current))
          candidates.push(container.current);
        for (const element of candidates) {
          const rect = readBounds(element);
          if (
            rect.width > 0 &&
            rect.height > 0 &&
            current.x >= rect.left &&
            current.x <= rect.right &&
            current.y >= rect.top &&
            current.y <= rect.bottom
          )
            return { element, rect };
        }
        return null;
      };
      const scrollSpeed = (element: HTMLElement, rect: DOMRect) => {
        const current = drag.current;
        if (!current?.active) return 0;
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
          const readBounds = measureBounds();
          const scroll = scrollContainerAt(readBounds);
          const speed = scroll ? scrollSpeed(scroll.element, scroll.rect) : 0;
          let scrolled = false;
          if (scroll && speed) {
            const { element } = scroll;
            const previous =
              axis === "x" ? element.scrollLeft : element.scrollTop;
            if (axis === "x") element.scrollLeft += speed;
            else element.scrollTop += speed;
            scrolled =
              previous !==
              (axis === "x" ? element.scrollLeft : element.scrollTop);
          }
          updateTarget(scrolled ? measureBounds() : readBounds);
          // Scroll snapping, rounding or a changed overflow boundary can
          // prevent movement. Do not leave an idle drag in a permanent loop.
          if (scrolled) scheduleDragFrame();
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
          if (animate) motion.current.activate(current);
          setGrabbing(true);
          setDraggingId(id);
          setToIndex(from);
          onActivateRef.current?.(id);
        }
        scheduleDragFrame();
      };
      const onScroll = () => {
        if (drag.current?.active) scheduleDragFrame();
      };

      const onUp = (ev: PointerEvent) => {
        const current = drag.current;
        if (!current || ev.pointerId !== current.pointerId) return;
        current.x = ev.clientX;
        current.y = ev.clientY;
        current.screenX = ev.screenX;
        current.screenY = ev.screenY;
        if (current.active) locate(current, measureBounds());
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
        window.removeEventListener("scroll", onScroll, true);
        handle.removeEventListener("lostpointercapture", onCancel);
        cleanupDrag.current = null;
        if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
        if (armTimer !== null) clearTimeout(armTimer);
        armTimer = null;
        const current = drag.current;
        // A tab let go outside its strip may land in a pane; measure its
        // look before the motion below puts it back.
        const ghost =
          commit && current?.active && (current.torn || !current.inStrip)
            ? captureDropGhost(
                current.torn && current.part
                  ? current.part.element
                  : nodes.current.get(current.id),
              )
            : null;
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
          ...partOf(current),
        );
        if (consumed) ghost?.fade();
        if (
          consumed ||
          current.torn ||
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
            const part = current.torn ? current.part?.id : undefined;
            if (part === undefined)
              onDropOnItemRef.current?.(current.id, current.dropTarget.id);
            else
              onDropOnItemRef.current?.(
                current.id,
                current.dropTarget.id,
                part,
              );
          } else {
            onDropOnGroupRef.current?.(current.id, current.dropTarget.id);
          }
          return;
        }
        // A torn-off part is the consumer's to place.
        if (current.torn) return;
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
      window.addEventListener("scroll", onScroll, {
        capture: true,
        passive: true,
      });
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
