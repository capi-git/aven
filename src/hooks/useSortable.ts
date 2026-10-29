import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
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
 * Marks a part of an item a drop can land beside (a split's segment), by
 * its id: a drop on the item's middle says which part was under the pointer
 * and on which side of it (`SortableDropAt`).
 */
export const SORTABLE_DROP_PART_ATTRIBUTE = "data-sortable-drop-part";
const SCROLL_EDGE = 28;
/** A drag frame WebKit holds back runs this late (ms) instead. */
const DRAG_FRAME_FALLBACK_MS = 16;

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

/**
 * Where on an item a drop lands: beside the part of it under the pointer
 * (`SORTABLE_DROP_PART_ATTRIBUTE`), on the side of it nearer the pointer.
 */
export type SortableDropAt = { part: string; side: "before" | "after" };

export type SortableDropTarget = {
  kind: "tab" | "group";
  id: string;
  /** False when the drop is refused — the target is flagged, not acted on. */
  allowed: boolean;
  /** An item with parts: the one under the pointer, and which side of it. */
  at?: SortableDropAt;
};

/**
 * Sortables on one channel take drops from one another's drags: a tab
 * dragged out of one bar and let go on the middle of another bar's item
 * joins that item, as it would one of its own bar's (the window's strip and
 * each pane's row of tabs). The bar dragging finds the target and arms it;
 * the bar holding the target previews the join and acts on the drop.
 */
export type SortableLink = {
  channel: string;
  /**
   * Whether `target`, one of this sortable's items, takes `moving` (an item
   * of another sortable on the channel, or the part of it pulled out). None
   * does when absent.
   */
  accepts?: (moving: string, target: string) => boolean;
  /** `moving`, from another sortable on the channel, let go on `target`. */
  onDrop?: (moving: string, target: string, at?: SortableDropAt) => void;
  /**
   * What `moving`, dragged from here, brings to an item of another sortable
   * that it would join: whatever that sortable's items draw as its preview
   * (`SortableIncoming.content`).
   */
  describe?: (moving: string) => unknown;
};

/** A drag from another sortable on the channel, over one of this one's items. */
export type SortableIncoming = {
  /** What is dragged: an item of that sortable, or the part of it pulled out. */
  moving: string;
  /** What that sortable says it brings (`SortableLink.describe`). */
  content: unknown;
  /**
   * The item it would join once armed; null once it has left the item, so
   * the preview plays out while the drag goes on.
   */
  target: SortableDropTarget | null;
  /**
   * The item whose middle it is over, armed or not: let go now, it joins
   * that item. A light hint shows it until the full preview arms.
   */
  over: string | null;
};

/** A sortable on a channel, as other sortables' drags see it. */
type LinkedZone = {
  channel: string;
  axis: "x" | "y";
  container: () => HTMLElement | null;
  ids: () => readonly string[];
  nodes: () => ReadonlyMap<string, HTMLElement>;
  accepts: (moving: string, target: string) => boolean;
  /** Preview a drag elsewhere joining one of its items, or stop (null). */
  show: (incoming: SortableIncoming | null) => void;
  drop: (moving: string, target: string, at?: SortableDropAt) => void;
};

/** Every mounted sortable on a channel, in mount order. */
const linkedZones = new Set<LinkedZone>();

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
   * torn-off part never reorders the strip. A drop another sortable on the
   * channel takes (onto one of its items) ends here as cancelled: the
   * consumer only tidies up.
   */
  onDragEnd?: (
    id: string,
    x: number,
    y: number,
    cancelled: boolean,
    pointer: SortablePointerPosition,
    part?: SortablePartDrag,
  ) => boolean;
  /**
   * `part` names a torn-off part dropped onto the item; `at`, the part of
   * the item it was let go beside, if the item has parts.
   */
  onDropOnItem?: (
    draggedId: string,
    targetId: string,
    part?: string,
    at?: SortableDropAt,
  ) => void;
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
   * before its preview of the drop arms. Until then the pointer there
   * reorders as usual and nothing is previewed, so a quick pass over an
   * item never flashes it; once armed, the zone holds a little past its
   * edges. Letting go on the zone drops onto the item, armed or not. 0
   * (the default) arms at once.
   */
  dropOnDelay?: number;
  /** Take drops from other sortables' drags, and drop onto their items. */
  link?: SortableLink;
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
  /** The sortable on the channel `dropTarget` is an item of; null: this one. */
  zone: LinkedZone | null;
  /** What the copy dissolves into: the target item, or its part. */
  into: HTMLElement | null;
  /**
   * The item whose middle the pointer is over and would join on release,
   * armed or not, and in which sortable (null: this one).
   */
  over: { id: string; zone: LinkedZone | null } | null;
  /** The target and hint last shown, and in which sortable. */
  shown: {
    target: SortableDropTarget | null;
    zone: LinkedZone | null;
    over: { id: string; zone: LinkedZone | null } | null;
  };
  part: SortablePart | null;
  torn: boolean;
  /**
   * The item whose drop zone the pointer rests on, until it arms: in which
   * sortable (null: this one), since when, and where the pointer was then.
   */
  arming: {
    id: string;
    zone: LinkedZone | null;
    since: number;
    x: number;
    y: number;
  } | null;
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
      previous?.allowed === next?.allowed &&
      previous?.at?.part === next?.at?.part &&
      previous?.at?.side === next?.at?.side)
  );
}

/**
 * The item whose drop zone (its middle) is under (x, y), among `ids` that
 * `takes` accepts: the item, the part of it under the pointer (if it has
 * parts) and the element the copy dissolves into. `held` is an armed item,
 * whose zone holds a little wider.
 */
function itemDropAt(
  ids: readonly string[],
  nodes: ReadonlyMap<string, HTMLElement>,
  axis: "x" | "y",
  x: number,
  y: number,
  readBounds: ReadBounds,
  held: string | null,
  takes: (id: string) => boolean,
): { id: string; at?: SortableDropAt; into: HTMLElement } | null {
  for (const id of ids) {
    if (!takes(id)) continue;
    const node = nodes.get(id);
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
    if (!inCenter) continue;
    const pos = axis === "x" ? x : y;
    for (const part of node.querySelectorAll<HTMLElement>(
      `[${SORTABLE_DROP_PART_ATTRIBUTE}]`,
    )) {
      const box = readBounds(part);
      const start = axis === "x" ? box.left : box.top;
      const length = axis === "x" ? box.width : box.height;
      if (length <= 0 || pos < start || pos > start + length) continue;
      return {
        id,
        at: {
          part: part.getAttribute(SORTABLE_DROP_PART_ATTRIBUTE) ?? "",
          side: pos < start + length / 2 ? "before" : "after",
        },
        into: part,
      };
    }
    return { id, into: node };
  }
  return null;
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
  const linkRef = useRef(options.link);
  linkRef.current = options.link;
  const channel = options.link?.channel ?? null;
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
  // A drag from another sortable on the channel, over (or near) an item here.
  const [incoming, setIncoming] = useState<SortableIncoming | null>(null);
  // The item of this sortable a release of its own drag would join.
  const [nearId, setNearId] = useState<string | null>(null);
  // How the other sortables' drags see this one.
  const selfZone = useRef<LinkedZone | null>(null);
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

  /**
   * Measures the strip before a change made outside a drag (a split coming
   * apart from its menu), so it morphs into its new shape once laid out.
   */
  const captureStripMorph = useCallback(() => {
    if (!animateRef.current || drag.current) return;
    motion.current.morphing.capture(container.current, nodes.current);
    morphing.current = true;
  }, []);

  // Lend this sortable's items to drags in other sortables on the channel.
  useEffect(() => {
    if (!channel) return;
    const zone: LinkedZone = {
      channel,
      axis,
      container: () => container.current,
      ids: () => idsRef.current,
      nodes: () => nodes.current,
      accepts: (moving, target) =>
        linkRef.current?.accepts?.(moving, target) ?? false,
      show: (next) =>
        setIncoming((previous) =>
          previous === next ||
          (previous &&
            next &&
            previous.moving === next.moving &&
            previous.content === next.content &&
            previous.over === next.over &&
            sameDropTarget(previous.target, next.target))
            ? previous
            : next,
        ),
      drop: (moving, target, at) => {
        // The target's preview is drawn: the strip morphs from it.
        captureStripMorph();
        const onDrop = linkRef.current?.onDrop;
        if (at) onDrop?.(moving, target, at);
        else onDrop?.(moving, target);
      },
    };
    selfZone.current = zone;
    linkedZones.add(zone);
    return () => {
      linkedZones.delete(zone);
      if (selfZone.current === zone) selfZone.current = null;
      setIncoming(null);
    };
  }, [channel, axis, captureStripMorph]);

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
    (
      draggedId: string,
      x: number,
      y: number,
      readBounds: ReadBounds,
      /**
       * An item whose middle the pointer is in and that takes the drop: a
       * release joins it, so the slot does not pass it. It stays on the
       * side of it the slot was on (`previous`) until the pointer reaches
       * its far edge.
       */
      hold: { id: string; previous: number } | null = null,
    ) => {
      const pos = axis === "x" ? x : y;
      let next = 0;
      let place = 0;
      // The destination is an insertion slot after removing the source. Its
      // own midpoint must not advance a rightward drag into its neighbor.
      for (const id of idsRef.current) {
        if (id === draggedId) continue;
        const at = place++;
        const node = nodes.current.get(id);
        if (!node) continue;
        let passed: boolean;
        if (id === hold?.id) passed = hold.previous > at;
        else {
          const rect = readBounds(node);
          const mid =
            axis === "x"
              ? rect.left + rect.width / 2
              : rect.top + rect.height / 2;
          passed = pos >= mid;
        }
        if (!passed) break;
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
    ): { target: SortableDropTarget; into: HTMLElement } | null => {
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
          return { target: target("group", groupId), into: el };
        }
      }
      if (!onDropOnItemRef.current) return null;
      const hit = itemDropAt(
        idsRef.current,
        nodes.current,
        axis,
        x,
        y,
        readBounds,
        held,
        (id) =>
          id !== draggedId &&
          (!isDropTargetRef.current ||
            (part === undefined
              ? isDropTargetRef.current(draggedId, id)
              : isDropTargetRef.current(draggedId, id, part))),
      );
      if (!hit) return null;
      return {
        target: { ...target("tab", hit.id), ...(hit.at ? { at: hit.at } : {}) },
        into: hit.into,
      };
    },
    [axis],
  );

  /**
   * The item of another sortable on the channel whose middle is under
   * (x, y) and takes `moving`. Over a sortable but not on a middle, none.
   * `held` is the armed item, whose zone holds a little wider.
   */
  const linkedDropAt = useCallback(
    (
      moving: string,
      x: number,
      y: number,
      readBounds: ReadBounds,
      held: { zone: LinkedZone; id: string } | null,
    ): {
      zone: LinkedZone;
      target: SortableDropTarget;
      into: HTMLElement;
    } | null => {
      const channel = linkRef.current?.channel;
      if (!channel) return null;
      for (const zone of linkedZones) {
        if (zone === selfZone.current || zone.channel !== channel) continue;
        const box = zone.container();
        if (!box) continue;
        const rect = readBounds(box);
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          x < rect.left ||
          x > rect.right ||
          y < rect.top ||
          y > rect.bottom
        )
          continue;
        const hit = itemDropAt(
          zone.ids(),
          zone.nodes(),
          zone.axis,
          x,
          y,
          readBounds,
          held?.zone === zone ? held.id : null,
          (id) => id !== moving && zone.accepts(moving, id),
        );
        if (!hit) return null;
        return {
          zone,
          target: {
            kind: "tab",
            id: hit.id,
            allowed: true,
            ...(hit.at ? { at: hit.at } : {}),
          },
          into: hit.into,
        };
      }
      return null;
    },
    [],
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
        zone: null,
        into: null,
        over: null,
        shown: { target: null, zone: null, over: null },
        part: part ?? null,
        torn: false,
        arming: null,
        at: null,
      };
      // Sortables on the channel whose items previewed this drag.
      const touched = new Set<LinkedZone>();
      drag.current = state;
      handle.setPointerCapture(event.pointerId);
      const restoreSelection = suppressTextSelection();

      let scrollFrame: number | null = null;
      let scrollFallback: ReturnType<typeof setTimeout> | null = null;
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
        const delay = dropOnDelayRef.current;
        const armed =
          current.dropTarget?.kind === "tab" ? current.dropTarget.id : null;
        const armedZone = current.zone;
        let hit =
          current.torn && !current.inStrip
            ? null
            : dropTargetAt(
                id,
                current.x,
                current.y,
                readBounds,
                delay > 0 && !armedZone ? armed : null,
                current.torn ? current.part?.id : undefined,
              );
        let zone: LinkedZone | null = null;
        // Out of its own strip, it can join another bar's tab.
        if (!hit && !current.inStrip) {
          const linked = linkedDropAt(
            movingOf(current),
            current.x,
            current.y,
            readBounds,
            delay > 0 && armedZone && armed
              ? { zone: armedZone, id: armed }
              : null,
          );
          if (linked) {
            hit = linked;
            zone = linked.zone;
          }
        }
        let target = hit?.target ?? null;
        // What shows is what a release does: on the middle of an item that
        // takes it, a release joins the item, so the slot does not move past
        // it and no line shows where it would stand; a light hint marks the
        // item at once.
        current.over = target?.kind === "tab" ? { id: target.id, zone } : null;
        current.toIndex = indexAt(
          id,
          current.x,
          current.y,
          readBounds,
          current.over && !zone
            ? { id: current.over.id, previous: current.toIndex }
            : null,
        );
        // A delayed zone's full preview arms once the pointer has rested on
        // it, so a quick pass never flashes it. Moving on within the zone
        // starts the rest again, so a slow pass never arms. Letting go on
        // the zone drops onto the item all the same.
        if (target?.kind !== "tab" || delay <= 0 || releasedAt !== undefined)
          current.arming = null;
        else if (target.id !== armed || zone !== armedZone) {
          const now = performance.now();
          if (
            current.arming?.id !== target.id ||
            current.arming.zone !== zone ||
            Math.hypot(
              current.x - current.arming.x,
              current.y - current.arming.y,
            ) > DROP_ON_STILL
          )
            current.arming = {
              id: target.id,
              zone,
              since: Math.min(movedAt, now),
              x: current.x,
              y: current.y,
            };
          const wait = current.arming.since + delay - now;
          if (wait > 0) {
            armLater(wait);
            target = null;
          }
        } else current.arming = null;
        current.dropTarget = target;
        current.zone = target ? zone : null;
        current.into = target ? (hit?.into ?? null) : null;
      };
      /** What moves: the item, or the part of it torn off. */
      const movingOf = (current: DragState) =>
        current.torn && current.part ? current.part.id : current.id;
      /** A drag that started on a part reports it; others pass nothing. */
      const partOf = (current: DragState): [SortablePartDrag] | [] =>
        current.part
          ? [
              {
                part: current.part.id,
                torn: current.torn,
                inStrip: current.inStrip,
                ...(current.torn &&
                !current.zone &&
                current.dropTarget?.kind === "tab" &&
                current.dropTarget.allowed
                  ? { target: current.dropTarget.id }
                  : {}),
              },
            ]
          : [];
      /** The box the copy dissolves into, while it would join an item. */
      const joinBox = (current: DragState, readBounds: ReadBounds) =>
        current.into &&
        current.dropTarget?.kind === "tab" &&
        current.dropTarget.allowed
          ? readBounds(current.into)
          : null;
      /**
       * Preview the item the drag would join (or none): here, as the
       * consumer's `dropTarget`; in another sortable on the channel, as
       * its `incoming`. One it has left plays its preview out.
       */
      const showTarget = (current: DragState, readBounds?: ReadBounds) => {
        const { target: was, zone: wasZone, over: wasOver } = current.shown;
        const next = current.dropTarget;
        const zone = current.zone;
        const over = current.over;
        const sameTarget = sameDropTarget(was, next) && wasZone === zone;
        const sameOver =
          wasOver?.id === over?.id && wasOver?.zone === over?.zone;
        if (sameTarget && sameOver) return;
        current.shown = { target: next, zone, over };
        // Other bars it was over, or is: each draws its hint and preview.
        const zones = new Set<LinkedZone>();
        for (const candidate of [wasZone, zone, wasOver?.zone, over?.zone])
          if (candidate) zones.add(candidate);
        if (zones.size) {
          const moving = movingOf(current);
          const content = linkRef.current?.describe?.(moving);
          for (const candidate of zones) {
            touched.add(candidate);
            candidate.show({
              moving,
              content,
              // One it has left keeps what it brings, to play out.
              target: candidate === zone ? next : null,
              over: over && candidate === over.zone ? over.id : null,
            });
          }
        }
        if (!sameTarget) {
          // The entry it would join here previews the result: measure
          // first, so what makes room moves into it.
          if (animate)
            motion.current.hintChanged(
              container.current,
              nodes.current,
              [wasZone ? null : was?.id, zone ? null : next?.id],
              readBounds,
            );
          setDropTarget(zone ? null : next);
        }
        if (!sameOver) setNearId(over && !over.zone ? over.id : null);
      };
      const updateTarget = (readBounds: ReadBounds) => {
        const current = drag.current;
        if (!current?.active) return;
        const previousIndex =
          current.inStrip && !current.torn ? current.toIndex : null;
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
          // Over an entry it would join, here or in another bar, the copy
          // goes into the entry's preview of the result.
          motion.current.dropping(
            joinBox(current, readBounds),
            current.dropTarget?.at?.side,
          );
        }
        const nextIndex =
          current.inStrip && !current.torn ? current.toIndex : null;
        if (nextIndex !== previousIndex) setToIndex(nextIndex);
        // Pointer motion inside the same target only moves visual children;
        // it must not re-render every tab and its contents each display frame.
        showTarget(current, readBounds);
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
        if (scrollFrame !== null || scrollFallback !== null) return;
        const run = () => {
          if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
          if (scrollFallback !== null) clearTimeout(scrollFallback);
          scrollFrame = null;
          scrollFallback = null;
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
        };
        scrollFrame = requestAnimationFrame(run);
        // WKWebView may hold animation frames back while a native page
        // covers much of it; the copy, its drop target and the preview must
        // keep up with the pointer all the same.
        scrollFallback = setTimeout(run, DRAG_FRAME_FALLBACK_MS);
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
        if (scrollFallback !== null) clearTimeout(scrollFallback);
        scrollFrame = null;
        scrollFallback = null;
        if (armTimer !== null) clearTimeout(armTimer);
        armTimer = null;
        const current = drag.current;
        const active = current?.active === true;
        // A bar gone since it armed takes nothing.
        if (current?.zone && !linkedZones.has(current.zone)) {
          current.dropTarget = null;
          current.zone = null;
          current.into = null;
        }
        // Let go on an item it joins, here or in another bar.
        const joined = Boolean(
          commit &&
          current?.active &&
          current.dropTarget?.kind === "tab" &&
          current.dropTarget.allowed,
        );
        if (joined && current) {
          // Let go on a middle before its preview armed: it shows now, so
          // the drop morphs from it as from an armed one, and the copy goes
          // into its half as it fades.
          if (
            !sameDropTarget(current.shown.target, current.dropTarget) ||
            current.shown.zone !== current.zone
          )
            flushSync(() => showTarget(current));
          if (animate)
            motion.current.dropping(
              joinBox(current, measureBounds()),
              current.dropTarget?.at?.side,
            );
        }
        // Another bar's item takes the drop.
        const linked = joined ? (current?.zone ?? null) : null;
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
        setNearId(null);
        try {
          handle.releasePointerCapture(state.pointerId);
        } catch {
          /* already released */
        }
        /** Other bars' previews of this drag go once it has landed. */
        const untouch = () => {
          for (const zone of touched) zone.show(null);
          touched.clear();
        };
        if (!current || !active) {
          if (animate) motion.current.cancel();
          untouch();
          return;
        }
        suppressClickUntil.current = performance.now() + 400;
        const consumed = onDragEndRef.current?.(
          current.id,
          current.x,
          current.y,
          !commit || linked !== null,
          { screenX: current.screenX, screenY: current.screenY },
          ...partOf(current),
        );
        if (animate) {
          // Taken by the workspace from outside the strip, the copy fades
          // where it was let go (its pane grows from the drop preview); let
          // go onto an entry, here or in another bar, that entry already
          // shows it; otherwise it flies to where its tab now stands, at the
          // pointer's speed (still, for Escape).
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
        if (linked && current.dropTarget) {
          // Its preview still drawn, the other bar measures itself and acts.
          linked.drop(
            movingOf(current),
            current.dropTarget.id,
            current.dropTarget.at,
          );
          untouch();
          return;
        }
        untouch();
        if (!commit || consumed) return;
        if (current.dropTarget) {
          // A refused target still swallows the drop: the tab stays put rather
          // than reordering into a group it cannot join.
          if (!current.dropTarget.allowed) return;
          if (current.dropTarget.kind === "tab") {
            const part = current.torn ? current.part?.id : undefined;
            const { id: target, at } = current.dropTarget;
            if (at) onDropOnItemRef.current?.(current.id, target, part, at);
            else if (part === undefined)
              onDropOnItemRef.current?.(current.id, target);
            else onDropOnItemRef.current?.(current.id, target, part);
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
    [axis, dropTargetAt, linkedDropAt, indexAt, inStrip],
  );

  const consumeClick = useCallback(() => {
    const suppressed = performance.now() < suppressClickUntil.current;
    suppressClickUntil.current = 0;
    return suppressed;
  }, []);

  /**
   * The pointer of the drag in progress is on the middle of an item it
   * would join on release, here or in another bar, armed or not: where
   * else it would go shows nothing.
   */
  const joining = useCallback(() => Boolean(drag.current?.over), []);

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
    // No line while a release would join an item rather than move.
    toIndex: draggingId && !dropTarget && !nearId ? toIndex : null,
    /**
     * The item a drag would join: this sortable's own drag, or one from
     * another bar on the channel (see `incoming`).
     */
    dropTarget: draggingId
      ? dropTarget
      : incoming && ids.includes(incoming.target?.id ?? "")
        ? incoming.target
        : null,
    /**
     * The item a release would join, its middle under the pointer, armed or
     * not (this sortable's own drag, or one from another bar): a light hint
     * until the full preview (`dropTarget`) arms.
     */
    joinHint: draggingId
      ? nearId
      : incoming?.over && ids.includes(incoming.over)
        ? incoming.over
        : null,
    /**
     * A drag from another bar on the channel over (or lately over) one of
     * this sortable's items; null with none, or during a drag of its own.
     */
    incoming: draggingId ? null : incoming,
    joining,
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
