import { moveItem } from "./reorder";
import { effectiveCssZoom } from "./drag";
import { motionReduced, playBounded } from "./motion";
import {
  TAB_FLICK_SPEED,
  TAB_LIFT_SCALE,
  TAB_PX_PRECISION,
  TAB_REDUCED_FADE_MS,
  TAB_RUBBER_BAND,
  TAB_SET_DOWN_PX,
  TAB_SPRING,
  TAB_UNIT_PRECISION,
  TAB_VELOCITY_WINDOW_MS,
} from "./motionTokens";
import {
  PointerVelocity,
  SpringAnimator,
  rubberBand,
  springSettleTime,
} from "./spring";
import { StripMorph, type MorphBox } from "./stripMorph";

type Axis = "x" | "y";
type Point = { x: number; y: number };
export type SortableMotionItem = { id: string; start: number; size: number };

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

/** The face of a tab visual: its glass element, or the visual itself. */
function faceOf(visual: HTMLElement): HTMLElement {
  return (
    (visual.hasAttribute("data-sortable-glass")
      ? visual
      : visual.querySelector<HTMLElement>("[data-sortable-glass]")) ?? visual
  );
}

type MotionEntry = {
  outer: HTMLElement;
  visual: HTMLElement;
  /** The visual's own opacity, put back when it is shown again. */
  opacity: string;
  zoom: number;
};

/**
 * Freeze the small tab visual before taking it out of its theme/zoom context.
 * The copy carries no face of its own: the floating face is a layer under it
 * (so it can fade into the tab's resting look as the copy lands).
 */
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
    // The face is painted by the layer under the copy. The motion box can
    // be taller than the rounded face; painting it would add a rim.
    if (original.hasAttribute("data-sortable-glass") || original === visual)
      Object.assign(clone.style, {
        background: "transparent",
        backdropFilter: "",
        webkitBackdropFilter: "",
        borderColor: "transparent",
        boxShadow: "none",
      });
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
    opacity: "1",
    visibility: "visible",
  });
  return copy;
}

type LiftChannels = "lift" | "dx" | "dy" | "fade" | "face";

type Preview = {
  element: HTMLElement;
  lifter: HTMLElement;
  face: HTMLElement;
  rest: HTMLElement;
  zoom: number;
  width: number;
  height: number;
  left: number;
  top: number;
  /** Its y follows the strip's rubber band rather than the pointer. */
  banded: boolean;
  dropping: boolean;
  springs: SpringAnimator<LiftChannels>;
  flight: SpringAnimator<"x" | "y">;
};

/** What happens to the floating copy once the tab is let go. */
export type SortableLanding =
  /** It flies to the tab's place (a reorder, a cancel, a drop nowhere). */
  | { kind: "fly"; velocity: Point }
  /** The workspace took it from outside the strip: it fades where it is. */
  | { kind: "fade" }
  /** It was let go onto another entry, which now shows it: it is gone. */
  | { kind: "dissolve" };

/**
 * Moves a floating tab copy and its siblings' visuals; outer hit boxes stay
 * put. Pick-up lifts the copy on a spring; inside the strip it follows the
 * pointer across and rubber-bands up and down; siblings make room on
 * interruptible springs; the drop flies the copy to its slot with the
 * pointer's speed and the strip morphs to its new shape (stripMorph.ts).
 */
export class SortableMotion {
  private entries = new Map<string, MotionEntry>();
  private source: {
    id: string;
    axis: Axis;
    grab: Point;
    start: Point;
    /** Where the visual sat, for the rubber band. */
    restTop: number;
    band: number;
  } | null = null;
  private preview: Preview | null = null;
  /** The part torn off the dragged item, faded in its place. */
  private torn: HTMLElement | null = null;
  private velocity = new PointerVelocity(TAB_VELOCITY_WINDOW_MS);
  private landing: SortableLanding | null = null;
  /** Tabs kept hidden while the copy is away from them, and how to show them. */
  private hidden = new Map<HTMLElement, string>();
  private morph = new StripMorph();
  /** A split making room for a tab held over it, mid-drag. */
  private hint = new StripMorph();
  /** Sibling offsets last asked for, so unchanged siblings are not rewritten. */
  private offsets = new Map<string, number>();
  /** Called once the copy has landed or gone. */
  onLanded: (() => void) | null = null;
  /** A copy still flying home or fading after its drop, and how to end it now. */
  private flying: { end: () => void } | null = null;

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
          opacity: child.style.opacity,
          zoom: effectiveCssZoom(child),
        });
    }
    const visualBounds = visual.getBoundingClientRect();
    const outerBounds = outer.getBoundingClientRect();
    this.source = {
      id,
      axis,
      grab: { x: point.x - visualBounds.left, y: point.y - visualBounds.top },
      start: point,
      restTop: visualBounds.top,
      band: Math.max(1, outerBounds.height),
    };
    this.velocity.reset();
  }

  /** Delay cloning until pickup, keeping ordinary tab clicks inexpensive. */
  activate(point: Point) {
    if (!this.source || this.preview) return;
    const entry = this.entries.get(this.source.id);
    if (!entry) return;
    this.showPreview(entry.visual, entry.zoom, point);
    // Keep the real focused tab mounted and focusable throughout pickup.
    this.hide(entry.visual);
    const preview = this.preview as Preview | null;
    if (!preview) return;
    // The copy starts exactly over the tab (the pointer has moved past the
    // threshold since the press), catches up with the pointer and lifts.
    const { start } = this.source;
    const reduced = motionReduced();
    preview.springs.to(
      { lift: 1, dx: 0 },
      {
        from: { dx: start.x - point.x },
        velocity: { dx: 0 },
        instant: reduced,
      },
    );
    this.velocity.add(point.x, point.y, performance.now());
  }

  private hide(element: HTMLElement) {
    if (!this.hidden.has(element))
      this.hidden.set(element, element.style.opacity);
    element.style.opacity = "0";
  }

  private reveal(element: HTMLElement, fade = false) {
    const opacity = this.hidden.get(element);
    if (opacity === undefined) return;
    this.hidden.delete(element);
    element.style.opacity = opacity;
    if (fade && element.isConnected && typeof element.animate === "function")
      playBounded(element, [{ opacity: 0 }, { opacity: 1 }], {
        duration: TAB_REDUCED_FADE_MS,
        easing: "linear",
      });
  }

  /**
   * The pointer left the strip holding a part of the item (a split's
   * segment): the floating copy becomes that part, drawn exactly where the
   * part was, and pops to the pointer; the rest of the item stays in place
   * with the part faded.
   */
  tearOff(part: HTMLElement, point: Point) {
    const source = this.source;
    const entry = source ? this.entries.get(source.id) : undefined;
    const previous = this.preview;
    if (!source || !entry || this.torn || !previous) return;
    const visual = entry.visual.getBoundingClientRect();
    const bounds = part.getBoundingClientRect();
    // Where the part is drawn now inside the floating copy.
    const lift = previous.springs.state();
    const scale = 1 + (TAB_LIFT_SCALE - 1) * lift.lift.value;
    const drawnLeft =
      previous.left + lift.dx.value + (bounds.left - visual.left) * scale;
    const drawnTop =
      previous.top + lift.dy.value + (bounds.top - visual.top) * scale;
    const clamp = (value: number, size: number) =>
      Math.max(0, Math.min(size, value));
    source.grab = {
      x: clamp(point.x - drawnLeft, bounds.width),
      y: clamp(point.y - drawnTop, bounds.height),
    };
    previous.springs.cancel();
    previous.element.remove();
    this.preview = null;
    this.showPreview(part, entry.zoom, point, false);
    this.reveal(entry.visual);
    entry.visual.dataset.sortableTorn = "true";
    part.dataset.sortableTornPart = "true";
    this.torn = part;
    const preview = this.preview as Preview | null;
    if (!preview) return;
    preview.springs.to(
      { lift: 1, dx: 0, dy: 0 },
      {
        from: {
          lift: lift.lift.value,
          dx: drawnLeft - preview.left,
          dy: drawnTop - preview.top,
        },
        velocity: { lift: 0, dx: 0, dy: 0 },
        springs: { dx: TAB_SPRING.pop, dy: TAB_SPRING.pop },
        instant: motionReduced(),
      },
    );
  }

  private showPreview(
    visual: HTMLElement,
    zoom: number,
    point: Point,
    banded = true,
  ) {
    if (!this.source) return;
    const bounds = visual.getBoundingClientRect();
    const copy = copyVisual(visual);
    const face = faceOf(visual);
    const faceBounds = face.getBoundingClientRect();
    const computed = getComputedStyle(face);
    const element = document.createElement("div");
    element.dataset.sortablePreview = this.source.id;
    // Native Chromium paints above the app webview. Its existing overlay
    // observer snapshots only intersecting pages and restores them on removal.
    element.dataset.nativeBrowserOccluded = "true";
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    const width = bounds.width / zoom;
    const height = bounds.height / zoom;
    Object.assign(element.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${width}px`,
      height: `${height}px`,
      margin: "0",
      padding: "0",
      border: "0",
      borderRadius: computed.borderRadius,
      background: "transparent",
      boxShadow: "none",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "2147483647",
      zoom: String(zoom / effectiveCssZoom(document.body)),
      willChange: "transform",
    });
    // Layers under the copy, at the face's own box: the lift's shadow, the
    // floating face, and the tab's resting fill it lands into.
    const layer = (name: string) => {
      const node = document.createElement("div");
      node.dataset.sortableLayer = name;
      Object.assign(node.style, {
        position: "absolute",
        left: `${(faceBounds.left - bounds.left) / zoom}px`,
        top: `${(faceBounds.top - bounds.top) / zoom}px`,
        width: `${faceBounds.width / zoom}px`,
        height: `${faceBounds.height / zoom}px`,
        borderRadius: computed.borderRadius,
        pointerEvents: "none",
      });
      return node;
    };
    const shadow = layer("shadow");
    shadow.style.boxShadow =
      computed.getPropertyValue("--aven-tab-lift-shadow").trim() ||
      "0 6px 16px -4px rgb(0 0 0 / 0.4)";
    shadow.style.opacity = "0";
    const faceLayer = layer("face");
    // A solid face, the material menus float on (`--aven-popup`), lit along
    // its top edge: a translucent one let the tabs it passes over read
    // through it, and a moving backdrop blur is costly every frame.
    const solid =
      computed.getPropertyValue("--aven-popup").trim() ||
      computed.getPropertyValue("--aven-tab-drag-surface").trim() ||
      computed.getPropertyValue("--color-background-base").trim();
    Object.assign(faceLayer.style, {
      background: solid || computed.backgroundColor,
      boxShadow: computed.getPropertyValue("--aven-specular").trim(),
    });
    const rest = layer("rest");
    rest.style.opacity = "0";
    const lifter = document.createElement("div");
    lifter.dataset.sortableLift = "";
    Object.assign(lifter.style, {
      position: "absolute",
      inset: "0",
      transformOrigin: `${this.source.grab.x / zoom}px ${this.source.grab.y / zoom}px`,
    });
    lifter.append(shadow, faceLayer, rest, copy);
    element.append(lifter);
    const springs = new SpringAnimator<LiftChannels>(
      {
        lift: { spring: TAB_SPRING.lift, precision: TAB_UNIT_PRECISION },
        dx: { spring: TAB_SPRING.lift, precision: TAB_PX_PRECISION },
        dy: { spring: TAB_SPRING.pop, precision: TAB_PX_PRECISION },
        fade: { spring: TAB_SPRING.lift, precision: TAB_UNIT_PRECISION },
        face: { spring: TAB_SPRING.lift, precision: TAB_UNIT_PRECISION },
      },
      { lift: 0, dx: 0, dy: 0, fade: 1, face: 1 },
      ({ lift, dx, dy, fade, face }) => [
        [
          lifter,
          {
            transform: `translate3d(${dx / zoom}px, ${dy / zoom}px, 0px) scale(${1 + (TAB_LIFT_SCALE - 1) * lift})`,
            opacity: String(fade),
          },
        ],
        [shadow, { opacity: String(Math.max(0, Math.min(1, lift))) }],
        [faceLayer, { opacity: String(face) }],
        [rest, { opacity: String(1 - face) }],
      ],
    );
    const preview: Preview = {
      element,
      lifter,
      face: faceLayer,
      rest,
      zoom,
      width: bounds.width,
      height: bounds.height,
      left: NaN,
      top: NaN,
      banded,
      dropping: false,
      springs,
      flight: new SpringAnimator<"x" | "y">(
        {
          x: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
          y: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        },
        { x: 0, y: 0 },
        ({ x, y }) => [
          [
            element,
            { transform: `translate3d(${x / zoom}px, ${y / zoom}px, 0)` },
          ],
        ],
      ),
    };
    this.preview = preview;
    this.place(point, banded);
    document.body.append(element);
  }

  /** Where the copy's box goes for a pointer at `point`. */
  private place(point: Point, banded: boolean) {
    const source = this.source;
    const preview = this.preview;
    if (!source || !preview) return;
    const left = point.x - source.grab.x;
    const top = banded
      ? source.restTop +
        rubberBand(point.y - source.start.y, source.band, TAB_RUBBER_BAND)
      : point.y - source.grab.y;
    if (preview.banded !== banded && Number.isFinite(preview.top)) {
      // Into or out of the rubber band: the copy pops to its new place from
      // where it is drawn.
      const now = preview.springs.state().dy;
      preview.springs.to(
        { dy: 0 },
        {
          from: { dy: now.value + preview.top - top },
          velocity: { dy: now.velocity },
          springs: { dy: TAB_SPRING.pop },
          instant: motionReduced(),
        },
      );
    }
    preview.banded = banded;
    if (preview.left === left && preview.top === top) return;
    preview.element.style.transform = `translate3d(${left / preview.zoom}px, ${top / preview.zoom}px, 0)`;
    preview.left = left;
    preview.top = top;
  }

  /**
   * Over an entry it would join, the copy dissolves into the half of that
   * entry the entry now previews it in; leaving, it comes back to the pointer.
   */
  dropping(into: DOMRect | null) {
    const preview = this.preview;
    if (!preview || preview.dropping === (into !== null)) return;
    preview.dropping = into !== null;
    const reduced = motionReduced();
    if (!into) {
      preview.springs.to(
        { dx: 0, dy: 0, fade: 1, lift: 1 },
        { instant: reduced },
      );
      return;
    }
    // The right half of the entry, where the joining tab will stand.
    const centreX = into.left + (into.width * 3) / 4;
    const centreY = into.top + into.height / 2;
    preview.springs.to(
      {
        dx: centreX - (preview.left + preview.width / 2),
        dy: centreY - (preview.top + preview.height / 2),
        fade: 0,
        lift: 0,
      },
      { instant: reduced },
    );
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
    this.velocity.add(point.x, point.y, performance.now());
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
    // A copy pulled along the strip rubber-bands up and down; out of the
    // strip (or torn off it) it follows the pointer.
    this.place(point, axis === "x" && inStrip && !this.torn);
    const reduced = motionReduced();
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
      const offset = offsets.get(id) ?? 0;
      // Only the dragged copy changes on most frames. Retargeting an
      // unchanged sibling would restart its spring for nothing.
      if ((this.offsets.get(id) ?? 0) === offset) continue;
      this.offsets.set(id, offset);
      this.morph
        .springs(entry.visual, axis)
        .to({ x: offset }, { instant: reduced });
    }
  }

  /**
   * The tab is let go: the copy stops following the pointer, the strip is
   * measured as drawn (siblings mid-spring included, with their speed) and
   * put back at rest, ready for `settle` after React lays out the result.
   */
  release(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
  ) {
    const source = this.source;
    if (!source) return;
    const entry = this.entries.get(source.id);
    const velocity = new Map<string, number>();
    for (const [id, item] of this.entries)
      if (id !== source.id)
        velocity.set(id, this.morph.velocityOf(item.visual));
    this.releasedVelocity = velocity;
    this.morph.capture(container, nodes, [
      this.torn ? this.torn : entry?.visual,
    ]);
    this.morph.reset();
    this.hint.reset();
    this.hint.forget();
    this.offsets.clear();
    for (const { outer, visual } of this.entries.values()) {
      delete outer.dataset.sortableMoving;
      delete visual.dataset.sortableDragging;
      delete visual.dataset.sortableInStrip;
      delete visual.dataset.sortableTorn;
    }
    if (this.torn) delete this.torn.dataset.sortableTornPart;
    this.pointerVelocity = this.velocity.velocity(performance.now());
  }

  private releasedVelocity = new Map<string, number>();
  private pointerVelocity: Point = { x: 0, y: 0 };

  /** How the copy ends, decided once the drop's outcome is known. */
  land(landing: SortableLanding) {
    this.landing = landing;
  }

  /** The pointer's speed at release, px/s. */
  releaseVelocity(): Point {
    return this.pointerVelocity;
  }

  /** The box the entry `id` was drawn in before the last drop, once. */
  takeOrigin(id: string): MorphBox | null {
    return this.morph.takeOrigin(id);
  }

  /**
   * After React has laid out the strip the drop made: the strip morphs from
   * what was drawn, and the copy flies to where its tab now stands (or fades
   * or dissolves), handing over to the real tab when it lands.
   */
  settle(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
  ) {
    const source = this.source;
    const landing = this.landing ?? { kind: "fade" as const };
    this.landing = null;
    const id = source?.id ?? "";
    const partId = this.torn?.dataset.splitSegment ?? null;
    const destinationId = partId ?? id;
    // Where the copy lands: its entry, or (still in a split) its segment.
    let target: HTMLElement | null = null;
    if (landing.kind === "fly") {
      target = visualOf(nodes.get(destinationId)) ?? null;
      if (!target && container)
        for (const segment of container.querySelectorAll<HTMLElement>(
          "[data-split-segment]",
        ))
          if (segment.dataset.splitSegment === destinationId) target = segment;
      if (target && target.getBoundingClientRect().width <= 0) target = null;
    }
    // Measured before the strip starts morphing: where the tab stands at
    // rest, and the fill it rests on.
    const box = target?.getBoundingClientRect() ?? null;
    const restFill = target
      ? getComputedStyle(faceOf(target)).backgroundColor
      : "transparent";
    const exclude = new Set<string>(
      target
        ? [
            `entry:${destinationId}`,
            `tab:${destinationId}`,
            `fill:${destinationId}`,
          ]
        : [],
    );
    this.morph.play(container, nodes, {
      exclude,
      velocity: this.releasedVelocity,
    });
    this.releasedVelocity = new Map();
    const preview = this.preview;
    this.preview = null;
    this.source = null;
    this.torn = null;
    const done = () => {
      for (const element of [...this.hidden.keys()]) this.reveal(element);
      const landed = this.onLanded;
      landed?.();
    };
    if (!preview) {
      done();
      this.entries.clear();
      return;
    }
    const reduced = motionReduced();
    let setDown: ReturnType<typeof setTimeout> | undefined;
    const remove = () => {
      clearTimeout(setDown);
      if (this.flying === flying) this.flying = null;
      preview.springs.cancel();
      preview.flight.cancel();
      preview.element.remove();
    };
    // A new press, or the strip going away, ends the landing at once.
    const flying = {
      end: () => {
        remove();
        done();
      },
    };
    this.flying = flying;
    // The dragged tab's own visual, if it is still in the strip and is not
    // where the copy lands, shows again as the copy goes.
    const original = this.entries.get(id)?.visual;
    if (!target) {
      if (original && original.isConnected) this.reveal(original, !reduced);
      preview.springs.to({ fade: 0, lift: 0 }, { instant: reduced });
      preview.springs.onSettle(() => {
        remove();
        done();
      });
      this.entries.clear();
      return;
    }
    if (original && original !== target) this.reveal(original);
    this.hide(target);
    // The resting look it lands into: the tab's own fill where it stands.
    preview.rest.style.background = restFill;
    const x = box!.left + (box!.width - preview.width) / 2;
    const y = box!.top + (box!.height - preview.height) / 2;
    const throwSpeed =
      landing.kind === "fly"
        ? Math.hypot(landing.velocity.x, landing.velocity.y)
        : 0;
    const spring =
      throwSpeed > TAB_FLICK_SPEED ? TAB_SPRING.flick : TAB_SPRING.move;
    preview.flight.jump({ x: preview.left, y: preview.top });
    const sameSize =
      Math.abs(box!.width - preview.width) < 2 &&
      Math.abs(box!.height - preview.height) < 2;
    if (reduced) {
      // Reduce motion: the tab is simply back, with nothing animated.
      remove();
      this.reveal(target);
      done();
      this.entries.clear();
      return;
    }
    const velocity =
      landing.kind === "fly"
        ? // A copy held in the rubber band was not moving with the pointer's
          // vertical speed.
          { x: landing.velocity.x, y: preview.banded ? 0 : landing.velocity.y }
        : { x: 0, y: 0 };
    preview.flight.to(
      { x, y },
      { velocity, springs: { x: spring, y: spring } },
    );
    // Carried, then set down: the copy keeps its face and lift while it
    // travels (it passes over other tabs), and settles into the tab's own
    // look once it is within a few pixels of its place.
    preview.springs.to({ dx: 0, dy: 0, fade: 1 });
    const near =
      Math.max(
        springSettleTime(spring, preview.left, x, velocity.x, TAB_SET_DOWN_PX),
        springSettleTime(spring, preview.top, y, velocity.y, TAB_SET_DOWN_PX),
      ) * 1000;
    let waiting = 2;
    const landed = () => {
      if (--waiting > 0) return;
      remove();
      this.reveal(target!);
      done();
    };
    setDown = setTimeout(() => {
      preview.springs.to({ lift: 0, face: 0 });
      // A copy that is not the tab's size crossfades into it as it is set
      // down.
      if (!sameSize) {
        preview.springs.to({ fade: 0 });
        this.reveal(target!, true);
      }
      preview.springs.onSettle(landed);
    }, near);
    preview.flight.onSettle(landed);
    this.entries.clear();
  }

  /** Measures the strip before a change made outside a drag (Separate split). */
  get morphing(): StripMorph {
    return this.morph;
  }

  /**
   * The entry a held tab would join changed: measure the strip's contents
   * now, so a split that makes room for it (or gives the room back) moves
   * its segments rather than jumping, once React draws the change.
   */
  hintChanged(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
    entries: readonly (string | null | undefined)[],
    readBounds?: (element: HTMLElement) => DOMRect,
  ) {
    if (!this.source || motionReduced()) return;
    // Only entries with keyed parts can move them; others cost no reads.
    if (
      !entries.some((id) =>
        id ? nodes.get(id)?.querySelector("[data-morph]") : null,
      )
    )
      return;
    const entry = this.entries.get(this.source.id);
    this.hint.capture(container, nodes, [this.torn ?? entry?.visual], {
      partsOnly: true,
      readBounds,
    });
  }

  /** After React drew a hint change: its segments glide. */
  playHint(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
  ) {
    if (this.hint.pending) this.hint.play(container, nodes);
  }

  /** Ends everything at once: no copy, every tab back at rest. */
  cancel() {
    const busy = this.flying !== null || this.preview !== null;
    this.flying?.end();
    this.flying = null;
    this.morph.reset();
    this.morph.forget();
    this.hint.reset();
    this.hint.forget();
    this.offsets.clear();
    if (this.preview) {
      this.preview.springs.cancel();
      this.preview.flight.cancel();
      this.preview.element.remove();
      this.preview = null;
    }
    for (const element of [...this.hidden.keys()]) this.reveal(element);
    for (const { outer, visual } of this.entries.values()) {
      delete outer.dataset.sortableMoving;
      delete visual.dataset.sortableDragging;
      delete visual.dataset.sortableInStrip;
      delete visual.dataset.sortableTorn;
    }
    if (this.torn) delete this.torn.dataset.sortableTornPart;
    this.torn = null;
    this.entries.clear();
    this.source = null;
    this.landing = null;
    // A copy that was still out has gone: whoever waits for it may go on.
    if (busy) this.onLanded?.();
  }
}
