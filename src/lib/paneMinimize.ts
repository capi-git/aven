import {
  layoutLeaves,
  layoutSashes,
  type LayoutNode,
  type LayoutSash,
} from "./layout";

/** Hiding one side of a divider, offered by a pane on that side. */
export type PaneMinimize = { sash: LayoutSash; side: "before" | "after" };

/**
 * Which pane offers to hide which side of each divider: on each side, the
 * pane nearest the divider's top (for a column, the one beside the divider).
 * A side may hold several panes; hiding it hides them all.
 */
export function paneMinimizeControls(
  layout: LayoutNode | null,
): Map<string, PaneMinimize[]> {
  const controls = new Map<string, PaneMinimize[]>();
  if (!layout) return controls;
  const leaves = layoutLeaves(layout);
  for (const sash of layoutSashes(layout))
    for (const side of ["before", "after"] as const) {
      const index = sash.index + (side === "after" ? 1 : 0);
      const start = sash.sizes
        .slice(0, index)
        .reduce((sum, size) => sum + size, 0);
      const end = start + sash.sizes[index];
      const row = sash.dir === "right";
      const child = row
        ? {
            x: sash.group.x + start * sash.group.w,
            y: sash.group.y,
            w: (end - start) * sash.group.w,
            h: sash.group.h,
          }
        : {
            x: sash.group.x,
            y: sash.group.y + start * sash.group.h,
            w: sash.group.w,
            h: (end - start) * sash.group.h,
          };
      const id = leaves
        .filter(
          ({ rect }) =>
            rect.x >= child.x - 1e-6 &&
            rect.y >= child.y - 1e-6 &&
            rect.x + rect.w <= child.x + child.w + 1e-6 &&
            rect.y + rect.h <= child.y + child.h + 1e-6,
        )
        .sort(
          (a, b) =>
            a.rect.y - b.rect.y ||
            (row && side === "after"
              ? a.rect.x - b.rect.x
              : b.rect.x - a.rect.x),
        )[0]?.id;
      if (id) controls.set(id, [...(controls.get(id) ?? []), { sash, side }]);
    }
  return controls;
}

/** "Hide left pane", "Hide lower pane", … */
export function paneMinimizeLabel({ sash, side }: PaneMinimize): string {
  const before = side === "before";
  const direction =
    sash.dir === "right"
      ? before
        ? "left"
        : "right"
      : before
        ? "upper"
        : "lower";
  return `Hide ${direction} pane`;
}

export function paneMinimizeKey({ sash, side }: PaneMinimize): string {
  return `${sash.splitId}:${sash.index}:${side}`;
}
