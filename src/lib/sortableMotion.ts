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
  appliedTransform: string;
  transition: string;
  opacity: string;
  zoom: number;
};

/** Freeze the small tab visual before taking it out of its theme/zoom context. */
function copyVisual(visual: HTMLElement): HTMLElement {
  const copy = visual.cloneNode(true) as HTMLElement;
  const originals = [visual, ...visual.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  for (const [index, original] of originals.entries()) {
    const clone = copies[index];
    if (!(clone instanceof HTMLElement || clone instanceof SVGElement))
      continue;
    const computed = getComputedStyle(original);
    for (let property = 0; property < computed.length; property += 1) {
      const name = computed.item(property);
      clone.style.setProperty(name, computed.getPropertyValue(name));
    }
    // A visual snapshot is neither a second drop target nor an accessible tab.
    for (const attribute of [...clone.attributes]) {
      if (
        attribute.name.startsWith("data-") ||
        attribute.name === "id" ||
        attribute.name === "autofocus"
      )
        clone.removeAttribute(attribute.name);
    }
    clone.style.setProperty("pointer-events", "none", "important");
    clone.style.setProperty("transition", "none", "important");
    clone.style.setProperty("animation", "none", "important");
    clone.style.setProperty("outline", "none", "important");
  }
  Object.assign(copy.style, {
    position: "relative",
    boxSizing: "border-box",
    inset: "auto",
    width: "100%",
    height: "100%",
    minWidth: "0",
    maxWidth: "none",
    minHeight: "0",
    maxHeight: "none",
    margin: "0",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    zoom: "1",
    visibility: "visible",
  });
  return copy;
}

/** Moves a floating tab visual and sibling children; outer hit boxes stay put. */
export class SortableMotion {
  private entries = new Map<string, MotionEntry>();
  private animations = new Set<Animation>();
  private source: {
    id: string;
    axis: Axis;
    grab: Point;
  } | null = null;
  private preview: {
    element: HTMLElement;
    zoom: number;
    left: number;
    top: number;
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
          appliedTransform: child.style.transform,
          transition: child.style.transition,
          opacity: child.style.opacity,
          zoom: effectiveCssZoom(child),
        });
    }
    const visualBounds = visual.getBoundingClientRect();
    this.source = {
      id,
      axis,
      grab: { x: point.x - visualBounds.left, y: point.y - visualBounds.top },
    };
  }

  /** Delay cloning until pickup, keeping ordinary tab clicks inexpensive. */
  activate(point: Point) {
    if (!this.source || this.preview) return;
    const entry = this.entries.get(this.source.id);
    if (!entry) return;
    const { visual, zoom } = entry;
    const bounds = visual.getBoundingClientRect();
    const copy = copyVisual(visual);
    const computed = getComputedStyle(visual);
    const surface =
      computed.getPropertyValue("--aven-tab-drag-surface").trim() ||
      computed.getPropertyValue("--color-background-base").trim();
    const element = document.createElement("div");
    element.dataset.sortablePreview = this.source.id;
    // Native Chromium paints above the app webview. Its existing overlay
    // observer snapshots only intersecting pages and restores them on removal.
    element.dataset.nativeBrowserOccluded = "true";
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    Object.assign(element.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${bounds.width / zoom}px`,
      height: `${bounds.height / zoom}px`,
      margin: "0",
      padding: "0",
      border: "0",
      borderRadius: computed.borderRadius,
      background: surface || "transparent",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "2147483647",
      zoom: String(zoom / effectiveCssZoom(document.body)),
      willChange: "transform",
    });
    element.append(copy);
    this.preview = { element, zoom, left: NaN, top: NaN };
    this.movePreview(point);
    document.body.append(element);
    // Keep the real focused tab mounted and focusable throughout pickup.
    visual.style.opacity = "0";
  }

  private movePreview(point: Point) {
    if (!this.source || !this.preview) return;
    const { element, zoom } = this.preview;
    const left = point.x - this.source.grab.x;
    const top = point.y - this.source.grab.y;
    if (this.preview.left === left && this.preview.top === top) return;
    element.style.transform = `translate3d(${left / zoom}px, ${top / zoom}px, 0)`;
    this.preview.left = left;
    this.preview.top = top;
  }

  move(
    ids: readonly string[],
    point: Point,
    toIndex: number,
    inStrip: boolean,
    readBounds: (element: HTMLElement) => DOMRect = (element) =>
      element.getBoundingClientRect(),
  ) {
    const source = this.source;
    if (!source) return;
    const axis = source.axis;
    const items = ids.flatMap((id) => {
      const entry = this.entries.get(id);
      if (!entry) return [];
      const bounds = readBounds(entry.outer);
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
    this.movePreview(point);
    for (const [id, entry] of this.entries) {
      const dragged = id === source.id;
      if (dragged) {
        if (entry.outer.dataset.sortableMoving !== "true")
          entry.outer.dataset.sortableMoving = "true";
        if (entry.visual.dataset.sortableDragging !== "true")
          entry.visual.dataset.sortableDragging = "true";
        if (entry.visual.dataset.sortableInStrip !== String(inStrip))
          entry.visual.dataset.sortableInStrip = String(inStrip);
        continue;
      }
      if (!inStrip) {
        if (entry.appliedTransform !== entry.transform) {
          entry.visual.style.transform = entry.transform;
          entry.appliedTransform = entry.transform;
        }
        continue;
      }
      const viewportOffset = offsets.get(id) ?? 0;
      const offset = viewportOffset / entry.zoom;
      const transform =
        axis === "x"
          ? `translate3d(${offset}px, 0, 0)`
          : `translate3d(0, ${offset}px, 0)`;
      // Only the dragged visual changes on most frames. Rewriting every
      // sibling's identical style still invalidates style in the webview.
      // Track the assigned value: browsers normalize CSS lengths on readback.
      if (entry.appliedTransform !== transform) {
        entry.visual.style.transform = transform;
        entry.appliedTransform = transform;
      }
    }
  }

  capture(): SortableMotionPositions {
    return new Map(
      [...this.entries].map(([id, { visual }]) => {
        if (id === this.source?.id && this.preview)
          return [id, { left: this.preview.left, top: this.preview.top }];
        const { left, top } = visual.getBoundingClientRect();
        return [id, { left, top }];
      }),
    );
  }

  /** Reset without starting CSS transitions before React commits the order. */
  reset() {
    this.preview?.element.remove();
    this.preview = null;
    for (const { outer, visual, transform, opacity } of this.entries.values()) {
      visual.style.transition = "none";
      visual.style.transform = transform;
      visual.style.opacity = opacity;
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
      // Read the new layout as one batch before animations write transforms.
      const pending = [...positions].flatMap(([id, previous]) => {
        const visual = visualOf(nodes.get(id));
        if (!visual || typeof visual.animate !== "function") return [];
        const bounds = visual.getBoundingClientRect();
        const viewportX = previous.left - bounds.left;
        const viewportY = previous.top - bounds.top;
        if (Math.abs(viewportX) < 0.5 && Math.abs(viewportY) < 0.5) return [];
        const zoom = effectiveCssZoom(visual);
        const x = viewportX / zoom;
        const y = viewportY / zoom;
        return [{ visual, x, y }];
      });
      for (const { visual, x, y } of pending) {
        const animation = visual.animate(
          [
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: visual.style.transform || "none" },
          ],
          { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
        this.animations.add(animation);
        // Canceling a settling animation rejects its finished promise even
        // though oncancel runs. A new gesture or unmount is normal cleanup.
        void animation.finished?.catch(() => {});
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
