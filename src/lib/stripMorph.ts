import { effectiveCssZoom } from "./drag";
import { motionReduced } from "./motion";
import {
  TAB_PX_PRECISION,
  TAB_SPRING,
  TAB_UNIT_PRECISION,
} from "./motionTokens";
import { SpringAnimator, applyFrame } from "./spring";

/**
 * A strip changing shape in one motion (FLIP). Before a change (a drop, a
 * split coming apart) the strip is measured; after React lays out the new
 * strip, everything that is still there is drawn where it was and springs
 * to its new place, keeping any speed it had.
 *
 * What moves is found by key, so a tab keeps its identity across forms:
 *
 * - `entry:<id>` — a strip entry's motion visual (`[data-sortable-motion]`
 *   of each sortable item). An entry that is there before and after moves
 *   as a whole.
 * - `tab:<id>` (`data-morph`) — a tab's content: a single tab's button, a
 *   split's segment, or the segment a combine is previewing. Content that
 *   changed entry (a tab becoming a segment, a segment becoming a tab)
 *   glides from its old centre to its new one.
 * - `fill:<id>` (`data-morph`) — a split's pill. It stretches from the box
 *   it had (or the box of the tab it grew out of) by translate and scaleX
 *   on a layer of its own, so no text is ever scaled.
 *
 * Only transform and opacity animate; every spring is bounded (spring.ts).
 */

/** Where an entry stood before a morph, and how fast it was moving (px/s). */
export type MorphOrigin = {
  left: number;
  top: number;
  width: number;
  height: number;
  velocity: number;
};

export type MorphBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type MorphPart = {
  box: MorphBox;
  entry: string | null;
  kind: "content" | "fill";
  /** Its corner radius, for the clip that widens grown content. */
  radius: string;
};
export type MorphSnapshot = {
  entries: Map<string, MorphBox>;
  parts: Map<string, MorphPart>;
};

export type MorphStep =
  | { kind: "entry"; id: string; dx: number; velocity: number }
  /**
   * `clip` is how much of each side starts hidden: content that grew is laid
   * out at its new width and opens from its old one, so a wider label or a
   * lit segment's fill never spills past where it was.
   */
  | { kind: "content"; key: string; dx: number; clip: number }
  | { kind: "fill"; key: string; dx: number; scale: number }
  | { kind: "appear"; key: string; entry: boolean };

export const MORPH_ATTRIBUTE = "data-morph";

const boxOf = (rect: DOMRect): MorphBox => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
});

function visualOf(node: HTMLElement | undefined): HTMLElement | undefined {
  return node
    ? [...node.children].find(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.hasAttribute("data-sortable-motion"),
      )
    : undefined;
}

/**
 * Measures every entry and keyed part in one read pass. Parts inside
 * `skip` (a dragged tab's hidden original) are left out, so a key it shares
 * with what is shown in its place (a combine's preview) is the shown one.
 */
export function snapshotStrip(
  container: HTMLElement | null,
  nodes: ReadonlyMap<string, HTMLElement>,
  skip: readonly (Element | null | undefined)[] = [],
  {
    skipOwnMotion = false,
    readBounds = (element) => element.getBoundingClientRect(),
  }: {
    /** Leave out parts inside `[data-morph-own]`: they move on their own. */
    skipOwnMotion?: boolean;
    /** Geometry already read this frame, reused. */
    readBounds?: (element: HTMLElement) => DOMRect;
  } = {},
): MorphSnapshot {
  const entries = new Map<string, MorphBox>();
  const parts = new Map<string, MorphPart>();
  for (const [id, node] of nodes) {
    const visual = visualOf(node);
    if (!visual || !visual.isConnected) continue;
    const rect = readBounds(visual);
    if (rect.width > 0) entries.set(id, boxOf(rect));
  }
  if (container) {
    const entryOf = new Map<Element, string>();
    for (const [id, node] of nodes) entryOf.set(node, id);
    for (const element of container.querySelectorAll<HTMLElement>(
      `[${MORPH_ATTRIBUTE}]`,
    )) {
      if (skip.some((root) => root && root.contains(element))) continue;
      if (skipOwnMotion && element.closest("[data-morph-own]")) continue;
      const key = element.getAttribute(MORPH_ATTRIBUTE)!;
      const rect = readBounds(element);
      if (rect.width <= 0) continue;
      let entry: string | null = null;
      for (
        let node: Element | null = element;
        node && node !== container;
        node = node.parentElement
      ) {
        const id = entryOf.get(node);
        if (id !== undefined) {
          entry = id;
          break;
        }
      }
      const kind = key.startsWith("fill:") ? "fill" : "content";
      parts.set(key, {
        box: boxOf(rect),
        entry,
        kind,
        radius:
          kind === "content" ? getComputedStyle(element).borderRadius : "",
      });
    }
  }
  return { entries, parts };
}

const centre = (box: MorphBox) => box.left + box.width / 2;

/**
 * What moves from `before` to `after`, along x. `exclude` names entries and
 * parts something else takes care of (a dragged tab's copy flying home);
 * `velocity` carries an entry's speed (px/s) at the moment it was measured.
 * Also returns, for each entry after, the box it grew out of, so the
 * highlight under the tab in front can glide from there.
 */
export function planStripMorph(
  before: MorphSnapshot,
  after: MorphSnapshot,
  {
    exclude = new Set<string>(),
    velocity = new Map<string, number>(),
  }: {
    exclude?: ReadonlySet<string>;
    velocity?: ReadonlyMap<string, number>;
  } = {},
): { steps: MorphStep[]; origins: Map<string, MorphOrigin> } {
  const steps: MorphStep[] = [];
  const origins = new Map<string, MorphOrigin>();
  const moved = new Map<string, number>();
  for (const [id, box] of after.entries) {
    const was = before.entries.get(id);
    if (!was || exclude.has(`entry:${id}`)) continue;
    const speed = velocity.get(id) ?? 0;
    origins.set(id, { ...was, velocity: speed });
    const dx = was.left - box.left;
    moved.set(id, dx);
    if (Math.abs(dx) >= 0.5 || Math.abs(speed) > 1)
      steps.push({ kind: "entry", id, dx, velocity: speed });
  }
  // The tabs each entry holds, for a pill growing out of one of them.
  const members = new Map<string, string[]>();
  for (const [key, part] of after.parts)
    if (part.kind === "content" && part.entry !== null) {
      const list = members.get(part.entry) ?? [];
      list.push(key.slice("tab:".length));
      members.set(part.entry, list);
    }
  const fillOrigin = (key: string, entry: string) =>
    before.parts.get(key)?.box ??
    (members.get(entry) ?? [])
      .map(
        (tab) =>
          before.parts.get(`fill:${tab}`)?.box ?? before.entries.get(tab),
      )
      .find((box): box is MorphBox => box !== undefined);
  // A new entry with nothing of its own seen before fades in as a whole.
  const appearing = new Set<string>();
  for (const id of after.entries.keys()) {
    if (before.entries.has(id) || exclude.has(`entry:${id}`)) continue;
    const seen = [...after.parts].some(
      ([key, part]) =>
        part.entry === id &&
        (before.parts.has(key) ||
          (part.kind === "fill" && fillOrigin(key, id) !== undefined)),
    );
    if (!seen) {
      appearing.add(id);
      steps.push({ kind: "appear", key: `entry:${id}`, entry: true });
    }
  }
  for (const [key, part] of after.parts) {
    if (exclude.has(key)) continue;
    if (part.entry !== null && appearing.has(part.entry)) continue;
    const carried =
      part.entry !== null ? (moved.get(part.entry) ?? null) : null;
    if (part.kind === "content") {
      const was = before.parts.get(key);
      if (!was) {
        // New content in an entry that moved as a whole simply moves with it.
        if (carried === null) steps.push({ kind: "appear", key, entry: false });
        continue;
      }
      const dx = centre(was.box) - centre(part.box) - (carried ?? 0);
      const clip = Math.max(0, (part.box.width - was.box.width) / 2);
      if (Math.abs(dx) >= 0.5 || clip >= 0.5)
        steps.push({ kind: "content", key, dx, clip });
      continue;
    }
    const entry = part.entry ?? key.slice("fill:".length);
    const was = fillOrigin(key, entry);
    if (!was) {
      if (carried === null) steps.push({ kind: "appear", key, entry: false });
      continue;
    }
    if (!origins.has(entry)) origins.set(entry, { ...was, velocity: 0 });
    const dx = was.left - part.box.left - (carried ?? 0);
    const scale = part.box.width > 0 ? was.width / part.box.width : 1;
    if (Math.abs(dx) >= 0.5 || Math.abs(scale - 1) > 0.002)
      steps.push({ kind: "fill", key, dx, scale });
  }
  return { steps, origins };
}

type MorphChannels = "x" | "sx" | "o" | "c";

/**
 * Plays strip morphs and the sibling springs of a drag, one spring set per
 * element, so a new motion on an element always starts from where it is
 * drawn and how fast it is going.
 */
export class StripMorph {
  private animators = new Map<
    HTMLElement,
    {
      animator: SpringAnimator<MorphChannels>;
      restore: {
        transform: string;
        opacity: string;
        origin: string;
        clip: string;
      };
    }
  >();
  private before: MorphSnapshot | null = null;
  private origins = new Map<string, MorphOrigin>();

  /**
   * The spring set of an element, made on first use. With `radius`, it also
   * draws a clip (channel `c`, px hidden at each side) with those corners.
   */
  springs(
    element: HTMLElement,
    axis: "x" | "y" = "x",
    radius?: string,
    /** A pill's fill: it always draws its scale, so every frame's
        transform lists the same functions (WebKit and Chromium then
        interpolate them piece by piece). */
    stretches = false,
  ) {
    let found = this.animators.get(element);
    if (!found) {
      const zoom = effectiveCssZoom(element) || 1;
      const restore = {
        transform: element.style.transform,
        opacity: element.style.opacity,
        origin: element.style.transformOrigin,
        clip: element.style.clipPath,
      };
      const corner = radius ? ` round ${radius}` : "";
      const render = ({
        x,
        sx,
        o,
        c,
      }: Readonly<Record<MorphChannels, number>>): Keyframe => ({
        transform:
          axis === "x"
            ? `translate3d(${x / zoom}px, 0, 0)${stretches ? ` scaleX(${sx})` : ""}`
            : `translate3d(0, ${x / zoom}px, 0)`,
        opacity: String(o),
        ...(radius !== undefined
          ? {
              clipPath: `inset(0px ${Math.max(0, c) / zoom}px 0px ${Math.max(0, c) / zoom}px${corner})`,
            }
          : {}),
      });
      const animator = new SpringAnimator<MorphChannels>(
        {
          x: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
          sx: { spring: TAB_SPRING.move, precision: TAB_UNIT_PRECISION },
          o: { spring: TAB_SPRING.lift, precision: TAB_UNIT_PRECISION },
          c: { spring: TAB_SPRING.move, precision: TAB_PX_PRECISION },
        },
        { x: 0, sx: 1, o: 1, c: 0 },
        (values) => [[element, render(values)]],
        // At rest where it belongs, an element keeps its own style.
        (values) => {
          if (
            values.x === 0 &&
            values.sx === 1 &&
            values.o === 1 &&
            values.c === 0
          ) {
            element.style.transform = restore.transform;
            element.style.opacity = restore.opacity;
            element.style.clipPath = restore.clip;
          } else applyFrame(element, render(values));
        },
      );
      found = { animator, restore };
      this.animators.set(element, found);
    }
    return found.animator;
  }

  /** The value and speed an element's spring has now (x only). */
  velocityOf(element: HTMLElement): number {
    return this.animators.get(element)?.animator.state().x.velocity ?? 0;
  }

  /** Puts every element back as it was, without motion. */
  reset() {
    for (const [element, { animator, restore }] of this.animators) {
      animator.cancel();
      element.style.transform = restore.transform;
      element.style.opacity = restore.opacity;
      element.style.transformOrigin = restore.origin;
      element.style.clipPath = restore.clip;
    }
    this.animators.clear();
  }

  private partsOnly = false;

  /**
   * Measures the strip before a change; `play` after React lays it out.
   * With `partsOnly`, only content inside entries moves (a split making room
   * for a tab held over it, mid-drag), and parts that move on their own
   * (`[data-morph-own]`) are left alone.
   */
  capture(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
    skip: readonly (Element | null | undefined)[] = [],
    {
      partsOnly = false,
      readBounds,
    }: {
      partsOnly?: boolean;
      readBounds?: (element: HTMLElement) => DOMRect;
    } = {},
  ) {
    this.partsOnly = partsOnly;
    this.before = snapshotStrip(container, nodes, skip, {
      skipOwnMotion: partsOnly,
      readBounds,
    });
    return this.before;
  }

  get pending(): boolean {
    return this.before !== null;
  }

  /** Drops a measurement that no change followed. */
  forget() {
    this.before = null;
  }

  /**
   * The box the entry `id` grew out of in the last morph, once: the
   * highlight under the tab in front glides from there.
   */
  takeOrigin(id: string): MorphOrigin | null {
    const box = this.origins.get(id) ?? null;
    this.origins.delete(id);
    return box;
  }

  /** Drops every origin: they belong to the commit that played the morph. */
  forgetOrigins() {
    this.origins.clear();
  }

  play(
    container: HTMLElement | null,
    nodes: ReadonlyMap<string, HTMLElement>,
    options: {
      exclude?: ReadonlySet<string>;
      velocity?: ReadonlyMap<string, number>;
    } = {},
  ): MorphSnapshot | null {
    const before = this.before;
    this.before = null;
    if (!before) return null;
    this.reset();
    const partsOnly = this.partsOnly;
    const after = snapshotStrip(container, nodes, [], {
      skipOwnMotion: partsOnly,
    });
    const planned = planStripMorph(before, after, options);
    const steps = partsOnly
      ? planned.steps.filter((step) => step.kind === "content")
      : planned.steps;
    if (!partsOnly) this.origins = planned.origins;
    if (motionReduced()) return after;
    const elementOf = (key: string): HTMLElement | null => {
      if (key.startsWith("entry:"))
        return visualOf(nodes.get(key.slice("entry:".length))) ?? null;
      for (const element of container?.querySelectorAll<HTMLElement>(
        `[${MORPH_ATTRIBUTE}]`,
      ) ?? [])
        if (element.getAttribute(MORPH_ATTRIBUTE) === key) return element;
      return null;
    };
    for (const step of steps) {
      const element =
        step.kind === "entry"
          ? elementOf(`entry:${step.id}`)
          : elementOf(step.key);
      if (!element) continue;
      const springs = this.springs(
        element,
        "x",
        step.kind === "content" && step.clip > 0
          ? after.parts.get(step.key)?.radius || "0px"
          : undefined,
        step.kind === "fill",
      );
      if (step.kind === "entry")
        springs.to(
          { x: 0 },
          { from: { x: step.dx }, velocity: { x: step.velocity } },
        );
      else if (step.kind === "content")
        springs.to(
          { x: 0, c: 0 },
          { from: { x: step.dx, c: step.clip }, velocity: { x: 0, c: 0 } },
        );
      else if (step.kind === "fill") {
        element.style.transformOrigin = "0 50%";
        springs.to(
          { x: 0, sx: 1 },
          { from: { x: step.dx, sx: step.scale }, velocity: { x: 0, sx: 0 } },
        );
      } else springs.to({ o: 1 }, { from: { o: 0 }, velocity: { o: 0 } });
      springs.onSettle(() => {
        const found = this.animators.get(element);
        if (!found || found.animator !== springs || springs.running) return;
        element.style.transform = found.restore.transform;
        element.style.opacity = found.restore.opacity;
        element.style.transformOrigin = found.restore.origin;
        element.style.clipPath = found.restore.clip;
        this.animators.delete(element);
      });
    }
    return after;
  }
}
