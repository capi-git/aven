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
import { SortableMotion } from "../lib/sortableMotion";
import type { MorphOrigin } from "../lib/stripMorph";

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
/**
 * Arming waits for the pointer to rest: moving further than this (px) from
 * where it started waiting starts the wait again, so a slow pass through a
 * middle never arms.
 */
const DROP_ON_STILL = 4;
/**
 * Waiting that long still, the pointer is resting rather than passing: the
 * entry stays where it is (it would join it, not move past it) until it
 * arms or the pointer leaves its middle.
 */
const DROP_ON_REST = 60;
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

/**
 * What a press needs from its pointer event: a React event, or a DOM one
 * (a header lent to its tab's own toolbar listens on the DOM, since the
 * toolbar is portalled in from elsewhere in React's tree).
 */
export type SortablePress = Pick<
  PointerEvent,
  | "button"
  | "pointerId"
  | "clientX"
  | "clientY"
  | "screenX"
  | "screenY"
  | "target"
  | "currentTarget"
>;

/** How a press on something other than the item itself moves it. */
export type SortablePressOptions = {
  /** Keeps the pointer for the drag; the event's `currentTarget` by default. */
  handle?: HTMLElement;
  /**
   * Elements on the page that stand for the item (a page's title in its
   * pane's header): they hide with it while its copy is away.
   */
  stands?: readonly HTMLElement[];
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
  /**
   * The item whose drop zone the pointer rests on, until it arms: since
   * when, and where the pointer was then.
   */
  arming: { id: string; since: number; x: number; y: number } | null;
  /** When the pointer event not yet looked at happened (`eventTime`). */
  at: number | null;
};

/**
 * When a pointer event happened, on `performance.now()`'s clock. A busy page
 * can handle an event well after it: a rest is how long the pointer stayed,
 * not how long the page took to look. Engines that stamp events otherwise
 * (epoch time, or nothing) count from now.
 */
function eventTime(event: { timeStamp?: number }): number {
  const now = performance.now();
  const at = event.timeStamp;
  return typeof at === "number" && Number.isFinite(at) && at > 0 && at <= now
    ? at
    : now;
}

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
  // A drop waiting for React to lay out its result, and a change made
  // outside a drag (Separate split) measured before it.
  const settling = useRef(false);
  const morphing = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingPartId, setDraggingPartId] = useState<string | null>(null);
  const [toIndex, setToIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<SortableDropTarget | null>(null);
  // The tab whose copy is flying to its place after a drop. Its tab and the
  // highlight under it show once it lands.
  const [landingId, setLandingId] = useState<string | null>(null);
  motion.current.onLanded = () => setLandingId(null);
  // True through the layout effects of a commit whose strip a morph took
  // care of, so other strip motion (tabs growing in, closed ones
  // collapsing) leaves that change to it.
  const morphedThisCommit = useRef(false);
  useLayoutEffect(() => {
    motion.current.playHint(container.current, nodes.current);
    if (settling.current) {
      settling.current = false;
      morphing.current = false;
      morphedThisCommit.current = true;
      motion.current.settle(container.current, nodes.current);
    } else if (morphing.current) {
      morphing.current = false;
      morphedThisCommit.current = true;
      motion.current.morphing.play(container.current, nodes.current);
    }
  });
  useEffect(() => {
    morphedThisCommit.current = false;
    // Where entries stood before a morph matters only to the commit that
    // played it (the highlight reads it there); a later front change slides
    // as usual.
    motion.current.forgetOrigins();
  });
  useEffect(
    () => () => {
      cleanupDrag.current?.();
      settling.current = false;
      motion.current.onLanded = null;
      motion.current.cancel();
    },
    [],
  );

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
    (
      id: string,
      event: ReactPointerEvent | SortablePress,
      part?: SortablePart,
      press?: SortablePressOptions,
    ) => {
      if (event.button !== 0) return;
      if (idsRef.current.length < 2 && !onDragEndRef.current) return;
      if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
        return;
      }
      const handle = (press?.handle ?? event.currentTarget) as HTMLElement;
      const from = idsRef.current.indexOf(id);
      if (from < 0) return;
      cleanupDrag.current?.();
      settling.current = false;
      motion.current.cancel();
      const animate = animateRef.current;
      if (animate)
        motion.current.begin(
          nodes.current,
          id,
          { x: event.clientX, y: event.clientY },
          axis,
          part?.element,
          press?.stands,
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
        at: null,
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
      /**
       * Where the pointer is now; a part leaving the strip tears off. A
       * release is judged at `releasedAt`, when it happened.
       */
      const locate = (
        current: DragState,
        readBounds: ReadBounds,
        releasedAt?: number,
      ) => {
        // A rest starts when the pointer got where it is: at the event that
        // moved it there, else (the strip scrolled under it) now.
        const movedAt = current.at ?? performance.now();
        current.at = null;
        current.inStrip = inStrip(current.x, current.y, readBounds);
        if (current.part && !current.inStrip && !current.torn) {
          current.torn = true;
          setDraggingPartId(current.part.id);
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
        // the pointer there reorders. Moving on within the zone starts the
        // rest again, so a slow pass never arms.
        if (target?.kind !== "tab" || delay <= 0) current.arming = null;
        else if (target.id !== armed) {
          const now = releasedAt ?? performance.now();
          if (
            current.arming?.id !== target.id ||
            Math.hypot(
              current.x - current.arming.x,
              current.y - current.arming.y,
            ) > DROP_ON_STILL
          )
            current.arming = {
              id: target.id,
              since: Math.min(movedAt, now),
              x: current.x,
              y: current.y,
            };
          const wait = current.arming.since + delay - now;
          if (wait > 0) {
            armLater(wait);
            // Resting there, it is about to join, not to move past: the
            // entry keeps its place (and a release now moves nothing).
            if (now - current.arming.since >= DROP_ON_REST)
              current.toIndex = idsRef.current.indexOf(id);
            target = null;
          }
        } else current.arming = null;
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
          // Over an entry it would join, the copy goes into the entry's
          // preview of the result.
          const into =
            current.dropTarget?.kind === "tab" && current.dropTarget.allowed
              ? nodes.current.get(current.dropTarget.id)
              : undefined;
          motion.current.dropping(into ? readBounds(into) : null);
        }
        const nextIndex =
          current.inStrip && !current.torn ? current.toIndex : null;
        if (nextIndex !== previousIndex) setToIndex(nextIndex);
        // Pointer motion inside the same target only moves visual children;
        // it must not re-render every tab and its contents each display frame.
        if (!sameDropTarget(previousTarget, current.dropTarget)) {
          // The entry it would join previews the result: measure first, so
          // what makes room moves into it.
          if (animate)
            motion.current.hintChanged(
              container.current,
              nodes.current,
              [previousTarget?.id, current.dropTarget?.id],
              readBounds,
            );
          setDropTarget(current.dropTarget);
        }
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
        current.at = eventTime(ev);
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
        // Judged when it happened, not when a busy page got to it: a quick
        // pass let go on a middle still moves the tab.
        const releasedAt = eventTime(ev);
        current.at = releasedAt;
        if (current.active) locate(current, measureBounds(), releasedAt);
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
        const active = current?.active === true;
        // Measure the strip as drawn before React lays out the drop.
        if (animate && active)
          motion.current.release(container.current, nodes.current);
        drag.current = null;
        restoreSelection();
        setGrabbing(false);
        setDraggingId(null);
        setDraggingPartId(null);
        setToIndex(null);
        setDropTarget(null);
        try {
          handle.releasePointerCapture(state.pointerId);
        } catch {
          /* already released */
        }
        if (!current || !active) {
          if (animate) motion.current.cancel();
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
        if (animate) {
          // Taken by the workspace from outside the strip, the copy fades
          // where it was let go (its pane grows from the drop preview); let
          // go onto an entry, that entry already shows it; otherwise it flies
          // to where its tab now stands, at the pointer's speed (still, for
          // Escape).
          const joined =
            commit &&
            current.dropTarget?.kind === "tab" &&
            current.dropTarget.allowed;
          const fly = !(consumed && !current.inStrip) && !joined;
          motion.current.land(
            fly
              ? {
                  kind: "fly",
                  velocity: commit
                    ? motion.current.releaseVelocity()
                    : { x: 0, y: 0 },
                }
              : consumed && !current.inStrip
                ? { kind: "fade" }
                : { kind: "dissolve" },
          );
          settling.current = true;
          setLandingId(
            fly
              ? current.torn && current.part
                ? current.part.id
                : current.id
              : null,
          );
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

  /**
   * Measures the strip before a change made outside a drag (a split coming
   * apart from its menu), so it morphs into its new shape once laid out.
   */
  const captureStripMorph = useCallback(() => {
    if (!animateRef.current || drag.current) return;
    motion.current.morphing.capture(container.current, nodes.current);
    morphing.current = true;
  }, []);

  /**
   * The box the entry `id` stood in before this commit's drop or morph,
   * and the speed it had, once.
   */
  const takeOrigin = useCallback(
    (id: string): MorphOrigin | null => motion.current.takeOrigin(id),
    [],
  );

  const morphed = useCallback(() => morphedThisCommit.current, []);

  return {
    draggingId,
    /** A part torn off the dragged item (a split's segment), once torn. */
    draggingPartId: draggingId ? draggingPartId : null,
    landingId,
    fromIndex: draggingId ? ids.indexOf(draggingId) : null,
    toIndex: draggingId && !dropTarget ? toIndex : null,
    dropTarget: draggingId ? dropTarget : null,
    setContainerRef,
    setItemRef,
    setGroupDropRef,
    onItemPointerDown,
    consumeClick,
    captureStripMorph,
    takeOrigin,
    /** The strip change of this commit is being morphed (see above). */
    morphed,
  };
}
