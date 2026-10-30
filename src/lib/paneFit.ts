import {
  leafIds,
  type LayoutNode,
  type LayoutRect,
  type SplitDir,
  type WorkspaceTab,
} from "./layout";
import { isRailed } from "./paneRails";

/**
 * Panes laid out in the stage's own CSS pixels. A split's `sizes` say how
 * its panes share the room; this gives each open pane at least the room it
 * needs to be usable and a collapsed one a rail of fixed width, so no pane
 * is ever squeezed out of sight, whatever the window's size. Pixels here
 * are CSS pixels, so the minimums grow with the interface zoom.
 */

/** How wide (or tall) a collapsed pane's rail is. */
export const PANE_RAIL_PX = 28;

/** The least room each kind of pane needs to be read and typed in. */
export const PANE_MIN_PX = {
  chat: 240,
  page: 200,
  file: 200,
  terminal: 160,
} as const;
export type PaneKind = keyof typeof PANE_MIN_PX;
export const DEFAULT_PANE_MIN_PX = 200;

/** The least room the pane whose tab in front is `id` needs. */
export type PaneMinimum = (id: string) => number;
export const defaultPaneMinimum: PaneMinimum = () => DEFAULT_PANE_MIN_PX;

export type FitLeaf = {
  id: string;
  /** In stage pixels. */
  rect: LayoutRect;
  /**
   * Drawn as a rail: the collapsed node holding it (itself, or panes
   * collapsed together), and the axis the rail is thin along.
   */
  rail?: { owner: string; axis: "x" | "y" };
};

/** A divider between two open-or-collapsed children of a split. */
export type FitSash = {
  splitId: string;
  /** Between child `index` and `index + 1`. */
  index: number;
  dir: SplitDir;
  /** The split's box, in stage pixels. */
  group: LayoutRect;
  /** Each child's length along the split, in pixels. */
  lengths: number[];
  /** The least length each child needs as drawn (a rail's is its width). */
  mins: number[];
  /** The least length each child needs open, a collapsed one included. */
  opens: number[];
  railed: boolean[];
};

export type LayoutFit = {
  width: number;
  height: number;
  leaves: FitLeaf[];
  sashes: FitSash[];
  /** Some pane is drawn other than its share says (a rail, or a minimum). */
  adjusted: boolean;
};

const axisOf = (dir: SplitDir) => (dir === "right" ? "x" : "y");

/** The least room `node` needs along `axis`. */
export function minAlong(
  node: LayoutNode,
  axis: "x" | "y",
  minimum: PaneMinimum,
): number {
  if (node.type === "leaf") return Math.max(PANE_RAIL_PX, minimum(node.id));
  const along = axisOf(node.dir) === axis;
  const each = node.children.map((child) =>
    isRailed(child) ? PANE_RAIL_PX : minAlong(child, axis, minimum),
  );
  return along
    ? each.reduce((sum, value) => sum + value, 0)
    : Math.max(0, ...each);
}

/**
 * Share `total` between children: a rail its fixed width, the open ones in
 * proportion to their weights, but none below its minimum while the room
 * allows (water-filling). With too little room for every minimum, the
 * open ones share it in proportion to their minimums, so none vanishes.
 */
export function distributeLengths(
  total: number,
  weights: readonly number[],
  mins: readonly number[],
  railed: readonly boolean[],
): { lengths: number[]; adjusted: boolean } {
  const count = weights.length;
  const lengths = new Array<number>(count).fill(0);
  const open = weights.map((_, i) => i).filter((i) => !railed[i]);
  if (!open.length) {
    lengths.fill(total / Math.max(1, count));
    return { lengths, adjusted: true };
  }
  const rails = count - open.length;
  railed.forEach((on, i) => {
    if (on) lengths[i] = PANE_RAIL_PX;
  });
  const free = Math.max(open.length, total - rails * PANE_RAIL_PX);
  const weight = (i: number) =>
    Number.isFinite(weights[i]) && weights[i] > 0 ? weights[i] : 1 / count;
  const needed = open.reduce((sum, i) => sum + mins[i], 0);
  if (needed >= free) {
    for (const i of open) lengths[i] = (free * mins[i]) / needed;
    return { lengths, adjusted: true };
  }
  const fixed = new Set<number>();
  for (let round = 0; round <= open.length; round++) {
    const loose = open.filter((i) => !fixed.has(i));
    const remaining = free - [...fixed].reduce((sum, i) => sum + mins[i], 0);
    const share = loose.reduce((sum, i) => sum + weight(i), 0);
    const short = loose.filter(
      (i) => (remaining * weight(i)) / share < mins[i] - 1e-9,
    );
    if (!short.length) {
      for (const i of loose) lengths[i] = (remaining * weight(i)) / share;
      break;
    }
    short.forEach((i) => fixed.add(i));
  }
  for (const i of fixed) lengths[i] = mins[i];
  return { lengths, adjusted: rails > 0 || fixed.size > 0 };
}

/** Lay `layout` out in a `width` × `height` stage. */
export function fitLayout(
  layout: LayoutNode,
  width: number,
  height: number,
  minimum: PaneMinimum = defaultPaneMinimum,
): LayoutFit {
  const fit: LayoutFit = {
    width,
    height,
    leaves: [],
    sashes: [],
    adjusted: false,
  };
  const place = (
    node: LayoutNode,
    rect: LayoutRect,
    rail?: FitLeaf["rail"],
  ) => {
    if (node.type === "leaf") {
      fit.leaves.push({ id: node.id, rect, ...(rail ? { rail } : {}) });
      return;
    }
    const axis = axisOf(node.dir);
    const span = axis === "x" ? rect.w : rect.h;
    const railed = node.children.map(isRailed);
    const opens = node.children.map((child) => minAlong(child, axis, minimum));
    const mins = opens.map((open, i) => (railed[i] ? PANE_RAIL_PX : open));
    const { lengths, adjusted } = distributeLengths(
      span,
      node.sizes,
      mins,
      railed,
    );
    if (adjusted) fit.adjusted = true;
    let offset = 0;
    node.children.forEach((child, i) => {
      // Dividers inside a rail resize nothing a person can see.
      if (i > 0 && !rail)
        fit.sashes.push({
          splitId: node.id,
          index: i - 1,
          dir: node.dir,
          group: rect,
          lengths,
          mins,
          opens,
          railed,
        });
      const childRect: LayoutRect =
        axis === "x"
          ? { x: rect.x + offset, y: rect.y, w: lengths[i], h: rect.h }
          : { x: rect.x, y: rect.y + offset, w: rect.w, h: lengths[i] };
      offset += lengths[i];
      place(
        child,
        childRect,
        rail ?? (railed[i] ? { owner: child.id, axis } : undefined),
      );
    });
  };
  place(layout, { x: 0, y: 0, w: width, h: height });
  return fit;
}

/** A leaf's place as shares of the stage, as `layoutLeaves` gives. */
export function fitShares(fit: LayoutFit): Map<string, LayoutRect> {
  const round = (value: number) => Math.round(value * 1e6) / 1e6;
  return new Map(
    fit.leaves.map((leaf) => [
      leaf.id,
      {
        x: round(leaf.rect.x / fit.width),
        y: round(leaf.rect.y / fit.height),
        w: round(leaf.rect.w / fit.width),
        h: round(leaf.rect.h / fit.height),
      },
    ]),
  );
}

/** Where a divider stands, in pixels from its split's start. */
export function sashOffset(sash: FitSash): number {
  return sash.lengths
    .slice(0, sash.index + 1)
    .reduce((sum, length) => sum + length, 0);
}

/**
 * How far below its minimum a pane must be dragged before it collapses:
 * past half its minimum, so a drag that only meant to make it small stops
 * at the minimum, and a drag toward the edge folds it.
 */
export function collapseThreshold(min: number): number {
  return Math.max(PANE_RAIL_PX + 12, min / 2);
}

export type SashResize = {
  layout: LayoutNode;
  /** Which side of the divider is on a rail after this. */
  railed: { before: boolean; after: boolean };
};

function replaceSplit(
  node: LayoutNode,
  id: string,
  update: (split: Extract<LayoutNode, { type: "split" }>) => LayoutNode,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (node.id === id) return update(node);
  const children = node.children.map((child) =>
    replaceSplit(child, id, update),
  );
  return children.some((child, at) => child !== node.children[at])
    ? { ...node, children }
    : node;
}

/**
 * The divider `sash` (as laid out when the drag began) moved to `offset`
 * pixels from its split's start. Neither pane goes below its minimum; one
 * dragged past its collapse threshold folds to a rail, and a rail dragged
 * out past it opens at its minimum. The split's shares become what is drawn,
 * and a pane that collapses keeps its share from before for when it opens.
 * A rail across the divider from a pane that folds stays a rail unless the
 * divider was taken past its threshold too, so nudging the divider between
 * two rails opens neither; the split always keeps a pane open.
 */
export function resizeSash(
  layout: LayoutNode,
  sash: FitSash,
  offset: number,
): SashResize {
  const i = sash.index;
  const lengths = [...sash.lengths];
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const start = lengths.slice(0, i).reduce((sum, length) => sum + length, 0);
  const pair = lengths[i] + lengths[i + 1];
  // A rail being dragged out needs its open minimum, not its width.
  const minBefore = sash.opens[i];
  const minAfter = sash.opens[i + 1];
  // Collapsing one side opens the other, so the split keeps a pane open.
  const wanted = offset - start;
  let before = wanted;
  let railBefore = false;
  let railAfter = false;
  if (before < collapseThreshold(minBefore)) {
    railBefore = true;
    before = PANE_RAIL_PX;
  } else if (pair - before < collapseThreshold(minAfter)) {
    railAfter = true;
    before = pair - PANE_RAIL_PX;
  } else {
    const low = minBefore;
    const high = pair - minAfter;
    before =
      low <= high
        ? Math.min(high, Math.max(low, before))
        : (pair * minBefore) / (minBefore + minAfter);
  }
  lengths[i] = before;
  lengths[i + 1] = pair - before;
  const kept = { before: false, after: false };
  const next = replaceSplit(layout, sash.splitId, (split) => {
    const othersOpen = split.children.some(
      (child, at) => at !== i && at !== i + 1 && child.rail === undefined,
    );
    const children = split.children.map((child, at): LayoutNode => {
      if (at !== i && at !== i + 1) return child;
      const collapse = at === i ? railBefore : railAfter;
      if (!collapse) {
        if (child.rail === undefined) return child;
        const length = at === i ? wanted : pair - wanted;
        if (othersOpen && length < collapseThreshold(sash.opens[at])) {
          kept[at === i ? "before" : "after"] = true;
          return child;
        }
        const { rail: _rail, ...open } = child;
        return open;
      }
      const share =
        child.rail ??
        (sash.lengths[at] > PANE_RAIL_PX + 1
          ? sash.lengths[at] / total
          : 1 / split.children.length);
      return { ...child, rail: share };
    });
    return {
      ...split,
      children,
      sizes: lengths.map((length) => length / total),
    };
  });
  return {
    layout: next,
    railed: {
      before: railBefore || kept.before,
      after: railAfter || kept.after,
    },
  };
}

/**
 * A key press on a divider: move it by `delta` pixels, stopping at the
 * panes' minimums. Pressing on against a pane at its minimum collapses it,
 * and pressing away from a rail opens it at its minimum.
 */
export function stepSash(
  layout: LayoutNode,
  sash: FitSash,
  delta: number,
): SashResize {
  const i = sash.index;
  const start = sash.lengths.slice(0, i).reduce((sum, value) => sum + value, 0);
  const before = sash.lengths[i];
  const after = sash.lengths[i + 1];
  const pair = before + after;
  let offset = start + before + delta;
  if (sash.railed[i] && delta > 0) offset = start + sash.opens[i];
  else if (sash.railed[i + 1] && delta < 0)
    offset = start + pair - sash.opens[i + 1];
  else if (delta < 0 && before <= sash.opens[i] + 0.5) offset = start;
  else if (delta > 0 && after <= sash.opens[i + 1] + 0.5) offset = start + pair;
  return resizeSash(layout, sash, offset);
}

/** What a workspace tab shows, for the room its pane needs. */
export function workspaceTabPaneKind(
  tab: Pick<WorkspaceTab, "layout" | "editorPanes" | "terminalPanes">,
): PaneKind {
  const files = new Set(tab.editorPanes.map((pane) => pane.id));
  const terminals = new Set((tab.terminalPanes ?? []).map((pane) => pane.id));
  const ids = leafIds(tab.layout);
  if (ids.some((id) => !files.has(id) && !terminals.has(id))) return "chat";
  if (ids.every((id) => terminals.has(id))) return "terminal";
  return "file";
}

/**
 * Where a divider inside a tab's own split (a chat beside its terminal)
 * stands, as a share of its group, for the pointer at `pointer`. `origin`
 * and `span` are the group's start and length in the viewport's pixels, as
 * the pointer is; `zoom` the CSS zoom between them and the tree's own
 * pixels, in which each pane of the pair keeps `min` (or half the pair, when
 * the pair has less than two minimums). `before` and `after` bound the pair.
 */
export function innerSashBoundary({
  pointer,
  origin,
  span,
  zoom = 1,
  before,
  after,
  min,
}: {
  pointer: number;
  origin: number;
  span: number;
  zoom?: number;
  before: number;
  after: number;
  min: number;
}): number {
  if (span <= 0) return (before + after) / 2;
  const local = span / (zoom > 0 ? zoom : 1);
  const least = Math.min(min / local, (after - before) / 2);
  return Math.min(
    after - least,
    Math.max(before + least, (pointer - origin) / span),
  );
}
