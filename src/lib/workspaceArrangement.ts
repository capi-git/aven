import { leafIds, placePane, type LayoutNode } from "./layout";
import {
  closeWorkspaceViews,
  combineWorkspaceGroups,
  resolveWorkspaceView,
  reorderWorkspaceGroup,
  workspaceGroupOwner,
  selectWorkspaceView,
  restoreWorkspaceSplit,
  type WorkspaceView,
  type WorkspaceViewSnapshot,
  type ViewEdge,
} from "./workspaceViews";

/** Keep the actual split arrangement and tab order for a transferred selection. */
export function selectWorkspaceArrangement(
  view: WorkspaceView,
  ids: string[],
): WorkspaceView {
  return resolveWorkspaceView(
    view,
    ids,
    ids.includes(view.focusedId) ? view.focusedId : (ids[0] ?? ""),
  );
}

export type WorkspaceReturnPlacement = {
  before: WorkspaceView;
  remaining: WorkspaceView;
  incoming: WorkspaceView;
};

/** A return may restore this geometry only while both sides still match. */
export function captureWorkspaceReturnPlacement(
  before: WorkspaceView,
  ids: string[],
): WorkspaceReturnPlacement {
  return {
    before,
    remaining: closeWorkspaceViews(before, ids, before.focusedId),
    incoming: selectWorkspaceArrangement(before, ids),
  };
}

function arrangementStructure(view: WorkspaceView): string {
  const snapshot = (value: WorkspaceViewSnapshot) => {
    const layout = (node: LayoutNode | null): unknown =>
      !node
        ? null
        : node.type === "leaf"
          ? (value.groups[node.id] ?? [node.id])
          : {
              dir: node.dir,
              // Repeated normalization can change only the last floating-point bits.
              sizes: node.sizes.map((size) => Math.round(size * 1e9) / 1e9),
              children: node.children.map(layout),
            };
    return { order: value.order, layout: layout(value.layout) };
  };
  // Active tabs own the leaves, so compare ordered group members, not owner IDs.
  return JSON.stringify([
    snapshot(view),
    view.restoreView ? snapshot(view.restoreView) : null,
    Object.values(view.hiddenGroups ?? {}).sort((a, b) =>
      a.join("\0").localeCompare(b.join("\0")),
    ),
  ]);
}

/** Preserve a normal round trip without overwriting work rearranged in either window. */
export function restoreWorkspaceArrangement(
  current: WorkspaceView,
  incoming: WorkspaceView,
  placement?: WorkspaceReturnPlacement,
): WorkspaceView {
  const order = [...current.order, ...incoming.order];
  if (
    !placement ||
    order.length !== placement.before.order.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !placement.before.order.includes(id)) ||
    arrangementStructure(current) !==
      arrangementStructure(placement.remaining) ||
    arrangementStructure(incoming) !== arrangementStructure(placement.incoming)
  )
    return mergeWorkspaceArrangements(current, incoming);
  let restored = resolveWorkspaceView(
    placement.before,
    order,
    incoming.focusedId,
  );
  // Retain each window's active tabs while putting their groups back in place.
  for (const id of [
    ...(current.layout ? leafIds(current.layout) : []),
    ...(incoming.layout ? leafIds(incoming.layout) : []),
  ])
    // A source left with only hidden tabs may temporarily reveal one. The
    // unchanged round trip should put that group back into its hidden state.
    if (workspaceGroupOwner(restored, id))
      restored = selectWorkspaceView(restored, id);
  return selectWorkspaceView(restored, incoming.focusedId);
}

/** A returned window is inserted beside existing work; neither side is replaced. */
export function mergeWorkspaceArrangements(
  current: WorkspaceView,
  incoming: WorkspaceView,
): WorkspaceView {
  // A deliberate merge replaces the old restoration geometry. Reveal hidden
  // groups in their own panes before building that new arrangement.
  if (Object.keys(current.hiddenGroups ?? {}).length)
    current = restoreWorkspaceSplit(current);
  if (Object.keys(incoming.hiddenGroups ?? {}).length)
    incoming = restoreWorkspaceSplit(incoming);
  const remaining = closeWorkspaceViews(
    current,
    incoming.order,
    current.focusedId,
  );
  const order = [...remaining.order, ...incoming.order];
  const layout =
    remaining.layout && incoming.layout
      ? {
          type: "split" as const,
          id: crypto.randomUUID(),
          dir: "right" as const,
          children: [remaining.layout, incoming.layout],
          sizes: [0.5, 0.5],
        }
      : (remaining.layout ?? incoming.layout);
  return resolveWorkspaceView(
    {
      layout,
      order,
      focusedId: incoming.focusedId,
      groups: { ...remaining.groups, ...incoming.groups },
    },
    order,
    incoming.focusedId,
  );
}

export function moveWorkspaceGroup(
  view: WorkspaceView,
  groupId: string,
  targetId: string,
  edge: ViewEdge | "tab",
  index?: number,
): WorkspaceView {
  const original = view;
  if (Object.keys(view.hiddenGroups ?? {}).length)
    view = restoreWorkspaceSplit(view);
  const owner = workspaceGroupOwner(view, groupId);
  const target = workspaceGroupOwner(view, targetId);
  if (!owner || !target || owner === target || !view.layout) return original;
  if (edge === "tab") {
    const combined = combineWorkspaceGroups(view, owner, target);
    if (index === undefined) return combined;
    const members = [...view.groups[target]];
    const at = Number.isFinite(index)
      ? Math.max(0, Math.min(members.length, Math.trunc(index)))
      : members.length;
    members.splice(at, 0, ...view.groups[owner]);
    return reorderWorkspaceGroup(combined, target, members);
  }
  return {
    ...view,
    restoreView: undefined,
    layout: placePane(
      view.layout,
      owner,
      target,
      edge === "up" ? "top" : edge === "down" ? "bottom" : edge,
    ),
    focusedId: owner,
  };
}
