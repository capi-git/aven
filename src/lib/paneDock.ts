/**
 * Docking a tab into the workspace's panes, as in Cydonia: the title row or
 * the middle of a pane stacks the tab there; within a quarter of an edge it
 * splits that side. The preview is that half of the pane, inset 4px with 6px
 * corners, and it glides between zones in 150ms; a pane a drop makes grows
 * from the preview to its place in the same time.
 *
 * Portions adapted from Cydonia (github.com/crabtalk/cydonia) and bezel
 * (github.com/crabtalk/bezel), Copyright (c) 2026 clearloop (bezel also
 * Wing), MIT. See NOTICE.
 */

import type { LayoutRect } from "./layout";

export type DockEdge = "left" | "right" | "up" | "down";
export type DockZone = DockEdge | "join";
export type DockRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** How near an edge, as a share of the pane, splits that side. */
export const DOCK_EDGE_ZONE = 0.25;
/** A pointer resting on the line keeps what it shows until it moves this far past. */
export const DOCK_ZONE_HOLD = 0.02;
export const DOCK_PREVIEW_INSET = 4;
export const DOCK_PREVIEW_RADIUS = 6;
/** The preview's glide between zones and a new pane's growth from it. */
export const DOCK_TWEEN_MS = 150;
export const DOCK_EASE = "cubic-bezier(0, 0, 0.58, 1)";

/**
 * Where a pointer over a pane's body docks: the nearest edge, measured as a
 * share of the pane's width or height, splits when it is within a quarter;
 * anything further in stacks ("join"). Corners pick the nearer edge. Null
 * outside the pane.
 *
 * Adapted from bezel's `docking::zone`. Unlike bezel, a zone the pointer was
 * already showing holds for a further 2% so a hand at rest on the line does
 * not flicker the preview.
 */
export function dockZone(
  rect: DockRect,
  x: number,
  y: number,
  previous?: DockZone | null,
): DockZone | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    x < rect.left ||
    x > rect.left + rect.width ||
    y < rect.top ||
    y > rect.top + rect.height
  )
    return null;
  const across = (x - rect.left) / rect.width;
  const down = (y - rect.top) / rect.height;
  const edges: Array<[DockEdge, number]> = [
    ["left", across],
    ["right", 1 - across],
    ["up", down],
    ["down", 1 - down],
  ];
  const [nearest, distance] = edges.reduce((best, next) =>
    next[1] < best[1] ? next : best,
  );
  if (previous && previous !== "join") {
    const held = edges.find(([edge]) => edge === previous)!;
    if (
      held[1] < DOCK_EDGE_ZONE + DOCK_ZONE_HOLD &&
      held[1] <= distance + DOCK_ZONE_HOLD
    )
      return previous;
  }
  const limit =
    previous === "join" ? DOCK_EDGE_ZONE - DOCK_ZONE_HOLD : DOCK_EDGE_ZONE;
  return distance < limit ? nearest : "join";
}

/** The share of a pane a zone's preview covers, before its inset. */
export function dockZoneFraction(zone: DockZone): LayoutRect {
  switch (zone) {
    case "left":
      return { x: 0, y: 0, w: 0.5, h: 1 };
    case "right":
      return { x: 0.5, y: 0, w: 0.5, h: 1 };
    case "up":
      return { x: 0, y: 0, w: 1, h: 0.5 };
    case "down":
      return { x: 0, y: 0.5, w: 1, h: 0.5 };
    default:
      return { x: 0, y: 0, w: 1, h: 1 };
  }
}

/**
 * The preview for a zone: that half of the pane (all of it to stack),
 * inset 4px, or less where the pane is too small for that.
 *
 * Adapted from bezel's `docking::preview_bounds`.
 */
export function dockPreview(rect: DockRect, zone: DockZone): DockRect {
  const share = dockZoneFraction(zone);
  const area = {
    left: rect.left + share.x * rect.width,
    top: rect.top + share.y * rect.height,
    width: share.w * rect.width,
    height: share.h * rect.height,
  };
  const inset = Math.max(
    0,
    Math.min(DOCK_PREVIEW_INSET, area.width / 2, area.height / 2),
  );
  return {
    left: area.left + inset,
    top: area.top + inset,
    width: area.width - 2 * inset,
    height: area.height - 2 * inset,
  };
}

/** How much two boxes share: their intersection over their union. */
export function dockOverlap(a: DockRect, b: DockRect): number {
  const width =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  if (width <= 0 || height <= 0) return 0;
  const shared = width * height;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

/**
 * A clip that shows only `from` of an element laid out at `to`, with the
 * preview's corners: where a pane grows from as it arrives. Every inset is
 * kept within the element.
 */
export function dockClip(
  from: DockRect,
  to: DockRect,
  radius = DOCK_PREVIEW_RADIUS,
): string {
  const clamp = (value: number, span: number) =>
    Math.max(0, Math.min(span, value));
  const top = clamp(from.top - to.top, to.height);
  const left = clamp(from.left - to.left, to.width);
  const bottom = clamp(
    to.top + to.height - (from.top + from.height),
    to.height,
  );
  const right = clamp(to.left + to.width - (from.left + from.width), to.width);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

/** The pane on each side across a seam from `id`: the one sharing most of it. */
export function seamNeighbours(
  leaves: ReadonlyArray<{ id: string; rect: LayoutRect }>,
  id: string,
): Partial<Record<DockEdge, string>> {
  const here = leaves.find((leaf) => leaf.id === id)?.rect;
  if (!here) return {};
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const shared = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const best: Partial<Record<DockEdge, { id: string; shared: number }>> = {};
  for (const leaf of leaves) {
    if (leaf.id === id) continue;
    const r = leaf.rect;
    const rows = shared(here.y, here.y + here.h, r.y, r.y + r.h);
    const columns = shared(here.x, here.x + here.w, r.x, r.x + r.w);
    const sides: Array<[DockEdge, boolean, number]> = [
      ["left", near(r.x + r.w, here.x), rows],
      ["right", near(r.x, here.x + here.w), rows],
      ["up", near(r.y + r.h, here.y), columns],
      ["down", near(r.y, here.y + here.h), columns],
    ];
    for (const [side, touches, amount] of sides)
      if (touches && amount > 1e-6 && amount > (best[side]?.shared ?? 0))
        best[side] = { id: leaf.id, shared: amount };
  }
  return Object.fromEntries(
    Object.entries(best).map(([side, found]) => [side, found!.id]),
  );
}

/**
 * The pane `step` along from `current` in layout order (left to right, each
 * column top to bottom), wrapping at either end. Null with fewer than two.
 */
export function stepPane(
  order: readonly string[],
  current: string | null | undefined,
  step: number,
): string | null {
  if (order.length < 2) return null;
  const at = current ? order.indexOf(current) : -1;
  if (at < 0) return step < 0 ? order[order.length - 1] : order[0];
  const length = order.length;
  return order[(((at + step) % length) + length) % length];
}
