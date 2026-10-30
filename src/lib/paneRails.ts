import {
  healRails,
  isRailed,
  layoutLeaves,
  leafIds,
  neighborLeafId,
  unrailed,
  validRail,
  type FocusDir,
  type LayoutNode,
} from "./layout";
import { stepPane } from "./paneDock";

export { healRails, isRailed };

/**
 * Collapsed panes. A pane dragged past its smallest useful size, or
 * collapsed from its menu, folds to a slim rail beside its neighbours
 * instead of vanishing: the rail shows its tabs and one click opens it at
 * the size it had. A node on a rail keeps that size as `rail`, a share of
 * its split; the split's `sizes` hold what is drawn now (paneFit.ts gives a
 * rail its fixed width at any window size).
 *
 * Every split keeps at least one pane open, and the arrangement itself (a
 * lone pane) is never on a rail.
 */

type SplitNode = Extract<LayoutNode, { type: "split" }>;

/** The least share a rail can open to, or a neighbour be left with. */
const SHARE_FLOOR = 0.08;
/** What a pane just collapsed keeps of its split until it is drawn. */
const RAIL_SHARE = 0.02;

/** Leaves drawn on a rail: their own node, or one holding them, collapsed. */
export function railedLeafIds(layout: LayoutNode | null): string[] {
  if (!layout) return [];
  const out: string[] = [];
  const walk = (node: LayoutNode, railed: boolean) => {
    const here = railed || isRailed(node);
    if (node.type === "leaf") {
      if (here) out.push(node.id);
      return;
    }
    for (const child of node.children) walk(child, here);
  };
  // The arrangement itself is never collapsed.
  if (layout.type === "leaf") return [];
  for (const child of layout.children) walk(child, false);
  return out;
}

/** Leaves drawn open, in arrangement order. */
export function openLeafIds(layout: LayoutNode | null): string[] {
  if (!layout) return [];
  const railed = new Set(railedLeafIds(layout));
  return leafIds(layout).filter((id) => !railed.has(id));
}

function mapSplit(
  node: LayoutNode,
  id: string,
  update: (split: SplitNode) => LayoutNode,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (node.id === id) return update(node);
  const children = node.children.map((child) => mapSplit(child, id, update));
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node;
}

function normalized(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0
    ? sizes.map((size) => size / total)
    : sizes.map(() => 1 / sizes.length);
}

/**
 * Open the child at `index` of `split` to the share it had, taken first
 * from the open panes beside it and, if they have too little, from every
 * open pane in the split.
 */
function openChild(split: SplitNode, index: number): SplitNode {
  const child = split.children[index];
  if (!child || child.rail === undefined) return split;
  const sizes = normalized(
    split.sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 0)),
  );
  const target = Math.min(
    1 - SHARE_FLOOR,
    Math.max(SHARE_FLOOR, validRail(child.rail) ? child.rail : 0.5),
  );
  const open = (at: number) =>
    at !== index && !!split.children[at] && !isRailed(split.children[at]);
  const give = (donors: number[], need: number) => {
    const spare = donors.map((at) => Math.max(0, sizes[at] - SHARE_FLOOR));
    const available = spare.reduce((sum, value) => sum + value, 0);
    const taken = Math.min(need, available);
    if (taken <= 0) return 0;
    donors.forEach((at, i) => {
      sizes[at] -= (taken * spare[i]) / available;
    });
    return taken;
  };
  let need = Math.max(0, target - sizes[index]);
  need -= give([index - 1, index + 1].filter(open), need);
  if (need > 1e-9)
    need -= give(split.children.map((_, at) => at).filter(open), need);
  sizes[index] = target - Math.max(0, need);
  const children = split.children.map((node, at) =>
    at === index ? unrailed(node) : node,
  );
  return { ...split, children, sizes: normalized(sizes) };
}

/** Open the collapsed node `id` (a pane, or panes collapsed together). */
export function restoreRail(layout: LayoutNode, id: string): LayoutNode {
  const find = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf") return node;
    const index = node.children.findIndex(
      (child) => child.id === id && isRailed(child),
    );
    if (index >= 0) return openChild(node, index);
    const children = node.children.map(find);
    return children.some((child, at) => child !== node.children[at])
      ? { ...node, children }
      : node;
  };
  return find(layout);
}

/**
 * Open every collapsed node holding leaf `id`, so the pane is on screen:
 * selecting a tab (from the strip, search or the sidebar) shows it.
 */
export function unrailLeaf(layout: LayoutNode, id: string): LayoutNode {
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf" || !leafIds(node).includes(id)) return node;
    const index = node.children.findIndex((child) =>
      leafIds(child).includes(id),
    );
    let next: SplitNode = node;
    if (index >= 0 && isRailed(node.children[index]))
      next = openChild(node, index);
    const children = next.children.map((child, at) =>
      at === index ? walk(child) : child,
    );
    return children.some((child, at) => child !== next.children[at])
      ? { ...next, children }
      : next;
  };
  return walk(layout);
}

/**
 * Collapse one side of a divider to a rail ("Collapse left pane"): the side
 * keeps its share for when it opens again, and the pane across the divider
 * takes its room. Nothing changes when that would leave the split with no
 * pane open.
 */
export function railSide(
  layout: LayoutNode,
  splitId: string,
  index: number,
  side: "before" | "after",
): LayoutNode {
  return mapSplit(layout, splitId, (split) => {
    if (!Number.isInteger(index) || index < 0) return split;
    if (index >= split.children.length - 1) return split;
    const at = side === "before" ? index : index + 1;
    const across = side === "before" ? index + 1 : index;
    const child = split.children[at];
    if (isRailed(child)) return split;
    if (split.children.every((node, i) => i === at || isRailed(node)))
      return split;
    const sizes = normalized(split.sizes);
    const share = sizes[at];
    sizes[at] = Math.min(RAIL_SHARE, share);
    // The pane across the divider takes the room if it is open; otherwise
    // every open pane shares it.
    if (!isRailed(split.children[across])) sizes[across] += share - sizes[at];
    else {
      const open = split.children
        .map((_, i) => i)
        .filter((i) => i !== at && !isRailed(split.children[i]));
      open.forEach((i) => (sizes[i] += (share - sizes[at]) / open.length));
    }
    const children = split.children.map((node, i): LayoutNode =>
      i === at ? { ...node, rail: share } : node,
    );
    return { ...split, children, sizes: normalized(sizes) };
  });
}

/** Every collapsed pane in `splitId` opened, all its panes the same size. */
export function evenSplit(layout: LayoutNode, splitId: string): LayoutNode {
  return mapSplit(layout, splitId, (split) => ({
    ...split,
    children: split.children.map(unrailed),
    sizes: split.children.map(() => 1 / split.children.length),
  }));
}

/** The open pane nearest `id`, to take focus when `id` is collapsed. */
export function nearestOpenLeaf(
  layout: LayoutNode | null,
  id: string,
): string | undefined {
  if (!layout) return undefined;
  const open = new Set(openLeafIds(layout));
  if (open.has(id)) return id;
  const leaves = layoutLeaves(layout);
  const from = leaves.find((entry) => entry.id === id);
  const centre = (rect: { x: number; y: number; w: number; h: number }) => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  });
  const origin = from ? centre(from.rect) : { x: 0, y: 0 };
  return leaves
    .filter((entry) => open.has(entry.id))
    .map((entry) => {
      const point = centre(entry.rect);
      return {
        id: entry.id,
        distance: Math.hypot(point.x - origin.x, point.y - origin.y),
      };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.id;
}

/**
 * The open pane `step` along from `id` in layout order, as the next and
 * previous pane keys step: collapsed panes are passed over, staying
 * collapsed until chosen themselves.
 */
export function stepOpenPane(
  layout: LayoutNode | null,
  id: string,
  step: number,
): string | null {
  return layout ? stepPane(openLeafIds(layout), id, step) : null;
}

/** The open pane beside `id` toward `dir`, past any collapsed one. */
export function openNeighborLeafId(
  layout: LayoutNode | null,
  id: string,
  dir: FocusDir,
): string | null {
  return layout
    ? neighborLeafId(layout, id, dir, new Set(openLeafIds(layout)))
    : null;
}

/**
 * Where ⌘⌥ and an arrow take focus: within the split of the tab in front
 * (a chat beside its terminal) first, then the open pane of the workspace
 * that way. The tab's own split is asked only while its pane is the one
 * focused: with a page focused, the last chat's split is somewhere else.
 */
export function focusDirTarget(
  view: { layout: LayoutNode | null; focusedId: string },
  tab: { id: string; layout: LayoutNode; focusedId: string } | undefined,
  dir: FocusDir,
): { inner: string } | { pane: string } | null {
  const inner =
    tab && tab.id === view.focusedId
      ? neighborLeafId(tab.layout, tab.focusedId, dir)
      : null;
  if (inner) return { inner };
  const pane = openNeighborLeafId(view.layout, view.focusedId, dir);
  return pane ? { pane } : null;
}
