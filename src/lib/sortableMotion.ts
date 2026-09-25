import { moveItem } from "./reorder";
import { effectiveCssZoom } from "./drag";

type Axis = "x" | "y";
type Point = { x: number; y: number };
export type SortableMotionItem = { id: string; start: number; size: number };
type CapturedPosition = { left: number; top: number };
export type SortableMotionPositions = Map<string, CapturedPosition>;

/** Project variable-size items into their new slots without moving hit boxes. */
export function sortableMotionOffsets(
  items: readonly SortableMotionItem[],
  draggedId: string,
  toIndex: number,
): Map<string, number> {
  const from = items.findIndex((item) => item.id === draggedId);
  if (from < 0 || !items.length) return new Map();
  const gaps = items
    .slice(1)
    .map((item, index) => item.start - items[index].start - items[index].size);
  const reordered = moveItem(
    [...items],
    from,
    Math.max(0, Math.min(items.length - 1, toIndex)),
  );
  const offsets = new Map<string, number>();
  let start = items[0].start;
  reordered.forEach((item, index) => {
    offsets.set(item.id, start - item.start);
    start += item.size + (gaps[index] ?? 0);
  });
  return offsets;
}

function visualOf(node: HTMLElement | undefined): HTMLElement | undefined {
  return node
    ? [...node.children].find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute("data-sortable-motion"),
      )
    : undefined;
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type MotionEntry = {
  outer: HTMLElement;
  visual: HTMLElement;
  transform: string;
  transition: string;
  zoom: number;
};

/** Owns only a dedicated visual child; registered outer nodes never transform. */
export class SortableMotion {
  private entries = new Map<string, MotionEntry>();
  private animations = new Set<Animation>();
  private source: {
    id: string;
    axis: Axis;
    grab: number;
    inset: number;
  } | null = null;

  begin(
    nodes: ReadonlyMap<string, HTMLElement>,
    id: string,
    point: Point,
    axis: Axis,
  ) {
    this.cancel();
    const outer = nodes.get(id);
    const visual = visualOf(outer);
    if (!outer || !visual) return;
    for (const [itemId, node] of nodes) {
      const child = visualOf(node);
      if (child)
        this.entries.set(itemId, {
          outer: node,
          visual: child,
          transform: child.style.transform,
          transition: child.style.transition,
          zoom: effectiveCssZoom(child),
        });
    }
    const bounds = outer.getBoundingClientRect();
    const visualBounds = visual.getBoundingClientRect();
    const start = axis === "x" ? visualBounds.left : visualBounds.top;
    this.source = {
      id,
      axis,
      grab: (axis === "x" ? point.x : point.y) - start,
      inset: start - (axis === "x" ? bounds.left : bounds.top),
    };
  }

  move(
    ids: readonly string[],
    point: Point,
    toIndex: number,
    inStrip: boolean,
  ) {
    const source = this.source;
    if (!source) return;
    const axis = source.axis;
    const items = ids.flatMap((id) => {
      const entry = this.entries.get(id);
      if (!entry) return [];
      const bounds = entry.outer.getBoundingClientRect();
      return [
        {
          id,
          start: axis === "x" ? bounds.left : bounds.top,
          size: axis === "x" ? bounds.width : bounds.height,
        },
      ];
    });
    const offsets = inStrip
      ? sortableMotionOffsets(items, source.id, toIndex)
      : new Map<string, number>();
    const sourceStart = items.find((item) => item.id === source.id)?.start;
    for (const [id, entry] of this.entries) {
      const dragged = id === source.id;
      if (dragged) {
        entry.outer.dataset.sortableMoving = "true";
        entry.visual.dataset.sortableDragging = "true";
        entry.visual.dataset.sortableInStrip = String(inStrip);
      }
      if (!inStrip) {
        entry.visual.style.transform = entry.transform;
        continue;
      }
      const viewportOffset = dragged
        ? (axis === "x" ? point.x : point.y) -
          (sourceStart ?? 0) -
          source.grab -
          source.inset
        : (offsets.get(id) ?? 0);
      const offset = viewportOffset / entry.zoom;
      entry.visual.style.transform =
        axis === "x"
          ? `translate3d(${offset}px, 0, 0)`
          : `translate3d(0, ${offset}px, 0)`;
    }
  }

  capture(): SortableMotionPositions {
    return new Map(
      [...this.entries].map(([id, { visual }]) => {
        const { left, top } = visual.getBoundingClientRect();
        return [id, { left, top }];
      }),
    );
  }

  /** Reset without starting CSS transitions before React commits the order. */
  reset() {
    for (const { outer, visual, transform } of this.entries.values()) {
      visual.style.transition = "none";
      visual.style.transform = transform;
      delete outer.dataset.sortableMoving;
      delete visual.dataset.sortableDragging;
      delete visual.dataset.sortableInStrip;
    }
    this.source = null;
  }

  settle(
    positions: SortableMotionPositions,
    nodes: ReadonlyMap<string, HTMLElement>,
  ) {
    if (!reducedMotion()) {
      for (const [id, previous] of positions) {
        const visual = visualOf(nodes.get(id));
        if (!visual || typeof visual.animate !== "function") continue;
        const bounds = visual.getBoundingClientRect();
        const viewportX = previous.left - bounds.left;
        const viewportY = previous.top - bounds.top;
        if (Math.abs(viewportX) < 0.5 && Math.abs(viewportY) < 0.5) continue;
        const zoom = effectiveCssZoom(visual);
        const x = viewportX / zoom;
        const y = viewportY / zoom;
        const animation = visual.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: visual.style.transform || "none" },
          ],
          { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        this.animations.add(animation);
        animation.onfinish = () => {
          this.animations.delete(animation);
          animation.cancel();
        };
        animation.oncancel = () => this.animations.delete(animation);
      }
    }
    this.finishReset();
  }

  finishReset() {
    for (const { visual, transition } of this.entries.values())
      visual.style.transition = transition;
    this.entries.clear();
  }

  cancel() {
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    this.reset();
    this.finishReset();
  }
}
