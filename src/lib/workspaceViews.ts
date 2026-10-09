import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  leaf,
  leafIds,
  placePane,
  replaceLeafId,
  removePane,
  type LayoutNode,
  type PaneEdge,
} from "./layout";

const STORAGE_KEY = "supermono.workspaceViews.v1";
export type ViewEdge = "left" | "right" | "up" | "down";
export type WorkspaceViewSnapshot = {
  layout: LayoutNode | null;
  focusedId: string;
  order: string[];
  /** Each visible active leaf owns its pane’s ordered tabs. */
  groups: Record<string, string[]>;
};
export type WorkspaceView = WorkspaceViewSnapshot & {
  /** One validated split snapshot; never contains another restore snapshot. */
  restoreView?: WorkspaceViewSnapshot;
  /** Edge where a temporary pane minimization can be restored. */
  minimizedEdge?: ViewEdge;
  /** Tucked panes retain their own tab strips until the split is restored. */
  hiddenGroups?: Record<string, string[]>;
};

/** A view arranges existing tabs; it never owns or closes their sessions/pages. */
export function pruneViewLayout(
  value: unknown,
  allowed: Set<string>,
  seen = new Set<string>(),
  depth = 0,
): LayoutNode | null {
  if (!value || typeof value !== "object" || depth > 20) return null;
  const node = value as Partial<LayoutNode>;
  if (node.type === "leaf") {
    if (
      typeof node.id !== "string" ||
      !allowed.has(node.id) ||
      seen.has(node.id)
    )
      return null;
    seen.add(node.id);
    return leaf(node.id);
  }
  if (
    node.type !== "split" ||
    !Array.isArray(node.children) ||
    !["right", "down"].includes(node.dir ?? "")
  )
    return null;
  const children: LayoutNode[] = [],
    sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = pruneViewLayout(child, allowed, seen, depth + 1);
    if (!next) return;
    children.push(next);
    const weight = node.sizes?.[index];
    sizes.push(
      typeof weight === "number" && Number.isFinite(weight) && weight > 0
        ? weight
        : 1,
    );
  });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return {
    type: "split",
    id: typeof node.id === "string" ? node.id : `view-${depth}`,
    dir: node.dir!,
    children,
    sizes: sizes.map((n) => n / total),
  };
}

function uniqueIds(value: unknown, allowed?: Set<string>): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string =>
              typeof id === "string" && (!allowed || allowed.has(id)),
          ),
        ),
      ]
    : [];
}

/** Prefer the next tab at the vacated position, then the previous tab. */
function promotedTab(
  members: string[],
  removed: string,
  remaining: Set<string>,
): string | undefined {
  const index = members.indexOf(removed);
  return (
    members.slice(index + 1).find((id) => remaining.has(id)) ??
    members
      .slice(0, Math.max(0, index))
      .reverse()
      .find((id) => remaining.has(id)) ??
    members.find((id) => remaining.has(id))
  );
}

function resolveWorkspaceSnapshot(
  value: Partial<WorkspaceViewSnapshot> | undefined,
  ids: readonly string[],
  fallback: string,
  initialLayout?: LayoutNode,
  excluded = new Set<string>(),
  assignmentId?: string,
): WorkspaceViewSnapshot {
  const allowed = new Set(uniqueIds(ids));
  const selectable = [...allowed].filter((id) => !excluded.has(id));
  const preferred = selectable.includes(fallback)
    ? fallback
    : (selectable[0] ?? "");
  const storedOrder = uniqueIds(value?.order);
  let order = uniqueIds([...storedOrder, ...allowed], allowed);
  const rawGroups =
    value?.groups &&
    typeof value.groups === "object" &&
    !Array.isArray(value.groups)
      ? value.groups
      : {};
  // Keep a closed owner long enough to promote a surviving tab in its group.
  let layout = pruneViewLayout(
    value?.layout ?? initialLayout,
    new Set(
      [...allowed, ...Object.keys(rawGroups)].filter((id) => !excluded.has(id)),
    ),
  );
  const originalOwners = layout ? leafIds(layout) : [];
  const reserved = new Set(originalOwners.filter((id) => allowed.has(id)));
  const groups: Record<string, string[]> = Object.create(null);
  const claimed = new Set(excluded);
  const replacements = new Map<string, string>();
  for (const owner of originalOwners) {
    const originalMembers = uniqueIds(rawGroups[owner]);
    if (!originalMembers.includes(owner)) originalMembers.unshift(owner);
    const members = originalMembers.filter(
      (id) =>
        allowed.has(id) &&
        !claimed.has(id) &&
        (!reserved.has(id) || id === owner),
    );
    const active = members.includes(owner)
      ? owner
      : promotedTab(originalMembers, owner, new Set(members));
    if (!active) {
      layout = layout ? removePane(layout, owner) : null;
      continue;
    }
    groups[active] = members;
    members.forEach((id) => claimed.add(id));
    replacements.set(owner, active);
    if (owner !== active && layout)
      layout = replaceLeafId(layout, owner, active);
  }
  if (!layout && preferred) {
    layout = leaf(preferred);
    groups[preferred] = [preferred];
    claimed.add(preferred);
  }
  const visible = layout ? leafIds(layout) : [];
  const previousFocus = value?.focusedId
    ? replacements.get(value.focusedId)
    : undefined;
  const focusedId =
    previousFocus && visible.includes(previousFocus)
      ? previousFocus
      : visible.includes(preferred)
        ? preferred
        : (visible[0] ?? "");
  if (focusedId) {
    const assignmentOwner = assignmentId
      ? (Object.keys(groups).find((owner) =>
          groups[owner].includes(assignmentId),
        ) ?? focusedId)
      : focusedId;
    const recorded = new Set([
      ...storedOrder,
      ...Object.values(rawGroups).flatMap((members) => uniqueIds(members)),
    ]);
    const newcomers =
      value && Array.isArray(value.order)
        ? order.filter((id) => !recorded.has(id) && !claimed.has(id))
        : [];
    const newIds = new Set(newcomers);
    const unassigned = order.filter(
      (id) => !claimed.has(id) && !newIds.has(id),
    );
    const members = [...groups[assignmentOwner], ...unassigned];
    const after =
      assignmentId && members.includes(assignmentId)
        ? assignmentId
        : assignmentOwner;
    const at = members.indexOf(after) + 1;
    members.splice(at, 0, ...newcomers);
    groups[assignmentOwner] = members;
    if (newcomers.length) {
      order = order.filter((id) => !newIds.has(id));
      order.splice(order.indexOf(after) + 1, 0, ...newcomers);
    }
  }
  return { layout, focusedId, order, groups };
}

/** Validate the current layout and at most one expansion snapshot. */
export function resolveWorkspaceView(
  value: Partial<WorkspaceView> | undefined,
  ids: readonly string[],
  fallback: string,
  initialLayout?: LayoutNode,
): WorkspaceView {
  const restore = value?.restoreView;
  if (!restore || typeof restore !== "object" || Array.isArray(restore))
    return resolveWorkspaceSnapshot(value, ids, fallback, initialLayout);
  const groups =
    restore.groups &&
    typeof restore.groups === "object" &&
    !Array.isArray(restore.groups)
      ? restore.groups
      : {};
  // Reject malformed backups rather than turning them into a fabricated view.
  if (
    !pruneViewLayout(restore.layout, new Set([...ids, ...Object.keys(groups)]))
  )
    return resolveWorkspaceSnapshot(value, ids, fallback, initialLayout);
  const allowed = new Set(ids);
  const visibleLayout = pruneViewLayout(
    value?.layout,
    new Set([...ids, ...Object.keys(value?.groups ?? {})]),
  );
  const visibleIds = new Set(
    (visibleLayout ? leafIds(visibleLayout) : []).flatMap((owner) => [
      owner,
      ...uniqueIds(value?.groups?.[owner]),
    ]),
  );
  const rawHidden =
    value?.hiddenGroups &&
    typeof value.hiddenGroups === "object" &&
    !Array.isArray(value.hiddenGroups)
      ? value.hiddenGroups
      : {};
  const reserved = new Set(
    Object.keys(rawHidden).filter(
      (id) => allowed.has(id) && !visibleIds.has(id),
    ),
  );
  const hiddenGroups: Record<string, string[]> = Object.create(null);
  const hiddenIds = new Set<string>();
  for (const [owner, rawMembers] of Object.entries(rawHidden)) {
    const original = uniqueIds(rawMembers);
    if (!original.includes(owner)) original.unshift(owner);
    const members = original.filter(
      (id) =>
        allowed.has(id) &&
        !visibleIds.has(id) &&
        !hiddenIds.has(id) &&
        (!reserved.has(id) || id === owner),
    );
    const active = members.includes(owner)
      ? owner
      : promotedTab(original, owner, new Set(members));
    if (!active) continue;
    hiddenGroups[active] = members;
    members.forEach((id) => hiddenIds.add(id));
  }
  const next = resolveWorkspaceSnapshot(
    value,
    ids,
    fallback,
    initialLayout,
    hiddenIds,
  );
  // Once all tucked tabs close there is nothing left for a Restore control.
  if (Object.keys(rawHidden).length && !hiddenIds.size) return next;
  const snapshot = resolveWorkspaceSnapshot(
    restore,
    ids,
    restore.focusedId || fallback,
    undefined,
    undefined,
    next.focusedId,
  );
  if (!snapshot.layout) return next;
  // Closing the last visible pane must uncover a usable surviving pane.
  if (!next.layout && hiddenIds.size) return snapshot;
  const minimizedEdge = value?.minimizedEdge;
  return {
    ...next,
    restoreView: snapshot,
    ...(hiddenIds.size ? { hiddenGroups } : {}),
    ...(minimizedEdge && ["left", "right", "up", "down"].includes(minimizedEdge)
      ? { minimizedEdge }
      : {}),
  };
}

function revealHiddenWorkspaceTargets(
  view: WorkspaceView,
  ids: (string | undefined)[],
): WorkspaceView {
  return ids.some(
    (id) =>
      id &&
      Object.values(view.hiddenGroups ?? {}).some((members) =>
        members.includes(id),
      ),
  )
    ? restoreWorkspaceSplit(view)
    : view;
}

export function workspaceGroupOwner(
  view: WorkspaceView,
  id: string,
): string | undefined {
  return Object.keys(view.groups).find((owner) =>
    view.groups[owner].includes(id),
  );
}

export function selectWorkspaceView(
  view: WorkspaceView,
  id: string,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id]);
  const owner = workspaceGroupOwner(view, id);
  if (!owner || !view.layout) return view;
  if (owner === id)
    return view.focusedId === id ? view : { ...view, focusedId: id };
  const groups = { ...view.groups, [id]: view.groups[owner] };
  delete groups[owner];
  return {
    ...view,
    focusedId: id,
    layout: replaceLeafId(view.layout, owner, id),
    groups,
  };
}

/** Closing active tabs promotes neighbors in their own pane before removing it. */
export function closeWorkspaceViews(
  view: WorkspaceView,
  closingIds: string[],
  fallback: string,
): WorkspaceView {
  const closing = new Set(closingIds);
  return resolveWorkspaceView(
    view,
    view.order.filter((id) => !closing.has(id)),
    fallback,
  );
}

/** Extract membership without closing the underlying session or browser page. */
function detachWorkspaceTab(view: WorkspaceView, id: string): WorkspaceView {
  const owner = workspaceGroupOwner(view, id);
  if (!owner || !view.layout) return view;
  const previous = view.groups[owner];
  const members = previous.filter((member) => member !== id);
  const active =
    owner !== id ? owner : promotedTab(previous, id, new Set(members));
  const groups = { ...view.groups };
  delete groups[owner];
  if (active) groups[active] = members;
  const layout = active
    ? replaceLeafId(view.layout, owner, active)
    : removePane(view.layout, owner);
  return {
    ...view,
    layout,
    groups,
    focusedId:
      view.focusedId === owner
        ? (active ?? (layout ? leafIds(layout)[0] : ""))
        : view.focusedId,
  };
}

export function splitWorkspaceView(
  view: WorkspaceView,
  id: string,
  edge: ViewEdge,
  targetId?: string,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id, targetId]);
  const owner = workspaceGroupOwner(view, id);
  if (!owner || !view.layout) return view;
  const targetOwner = targetId
    ? workspaceGroupOwner(view, targetId)
    : undefined;
  const preferredTarget = targetOwner ?? view.focusedId;
  const paneEdge: PaneEdge =
    edge === "up" ? "top" : edge === "down" ? "bottom" : edge;
  if (view.groups[owner].length === 1) {
    const target =
      preferredTarget !== id
        ? preferredTarget
        : leafIds(view.layout).find((candidate) => candidate !== id);
    if (!target) return view;
    return {
      ...view,
      focusedId: id,
      layout: placePane(view.layout, id, target, paneEdge),
    };
  }
  const next = detachWorkspaceTab(view, id);
  if (!next.layout) return view;
  const remainingOwner = workspaceGroupOwner(
    next,
    view.groups[owner].find((member) => member !== id)!,
  );
  const target = preferredTarget === id ? remainingOwner : preferredTarget;
  if (!target || !leafIds(next.layout).includes(target)) return view;
  return {
    ...next,
    focusedId: id,
    layout: placePane(next.layout, id, target, paneEdge),
    groups: { ...next.groups, [id]: [id] },
  };
}

/** A header drop moves membership while keeping the destination's selected tab. */
export function moveWorkspaceTab(
  view: WorkspaceView,
  id: string,
  targetId: string,
  index?: number,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id, targetId]);
  const source = workspaceGroupOwner(view, id);
  const target = workspaceGroupOwner(view, targetId);
  if (!source || !target || !view.layout) return view;
  if (source === target) {
    if (index === undefined) return view;
    const members = view.groups[source].filter((member) => member !== id);
    const at = Number.isFinite(index)
      ? Math.max(0, Math.min(members.length, Math.trunc(index)))
      : members.length;
    members.splice(at, 0, id);
    return reorderWorkspaceGroup(view, source, members);
  }
  const next = detachWorkspaceTab(view, id);
  const members = [...next.groups[target]];
  const at =
    index !== undefined && Number.isFinite(index)
      ? Math.max(0, Math.min(members.length, Math.trunc(index)))
      : members.length;
  members.splice(at, 0, id);
  return {
    ...next,
    focusedId: target,
    groups: { ...next.groups, [target]: members },
  };
}

/**
 * Show a surface that an agent opened without covering the chat that asked
 * for it. Selecting it inside the chat's own pane is not enough: the next
 * interaction with that chat re-selects the chat and hides the page again.
 * With one pane, split to the right of the chat; with several, show it in
 * the first other pane. Without a known requester, select it where it is.
 */
export function revealBesideWorkspaceView(
  view: WorkspaceView,
  id: string,
  requesterId?: string,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id, requesterId]);
  if (!workspaceGroupOwner(view, id) || !view.layout) return view;
  // If the page already covers the chat's pane, uncover the chat first so
  // the pane keeps showing the conversation rather than another tab.
  if (
    requesterId &&
    workspaceGroupOwner(view, id) === id &&
    workspaceGroupOwner(view, requesterId) === id
  )
    view = selectWorkspaceView(view, requesterId);
  const owner = workspaceGroupOwner(view, id)!;
  if (!view.layout) return view;
  const panes = leafIds(view.layout);
  const requesterPane = requesterId
    ? workspaceGroupOwner(view, requesterId)
    : undefined;
  if (!requesterPane || !panes.includes(requesterPane))
    return selectWorkspaceView(view, id);
  if (owner !== requesterPane) return selectWorkspaceView(view, id);
  const other = panes.find((pane) => pane !== requesterPane);
  if (!other) return splitWorkspaceView(view, id, "right", requesterId);
  return selectWorkspaceView(moveWorkspaceTab(view, id, other), id);
}

/** Agent output joins the browser pane without changing the user's focus. */
export function placeAgentBrowserView(
  view: WorkspaceView,
  id: string,
  browserIds: readonly string[],
  requesterId?: string,
): WorkspaceView {
  if (!view.layout) return view;
  const peers = new Set(browserIds.filter((candidate) => candidate !== id));
  const hidden = Object.entries(view.hiddenGroups ?? {});
  if (hidden.some(([, members]) => members.includes(id))) return view;
  const owner = workspaceGroupOwner(view, id);
  if (!owner) return view;
  const hiddenBrowser = hidden.find(([, members]) =>
    members.some((member) => peers.has(member)),
  );
  const requester = requesterId && workspaceGroupOwner(view, requesterId);
  const panes = leafIds(view.layout);
  const browserPane = panes.find(
    (pane) =>
      pane !== requester &&
      view.groups[pane]?.some((member) => peers.has(member)),
  );
  // A tucked browser pane remains tucked. Keep its restore snapshot in sync
  // rather than expanding the user's current view to service a background task.
  if (!browserPane && hiddenBrowser && view.restoreView) {
    const [target, members] = hiddenBrowser;
    const next = detachWorkspaceTab(view, id);
    const restored = resolveWorkspaceView(
      view.restoreView,
      view.order,
      view.restoreView.focusedId,
    );
    return {
      ...next,
      focusedId: view.focusedId,
      hiddenGroups: { ...view.hiddenGroups, [target]: [...members, id] },
      restoreView: moveWorkspaceTab(restored, id, target),
    };
  }
  const target =
    browserPane ??
    (owner !== requester ? owner : panes.find((pane) => pane !== requester));
  let next = view;
  if (target) {
    if (owner !== target) next = moveWorkspaceTab(view, id, target);
    // Present beside the requesting chat, but do not replace a tab in the pane
    // the user is currently reading or typing into for a different task.
    if (view.focusedId === requesterId && target !== view.focusedId)
      next = selectWorkspaceView(next, id);
  } else if (requester) {
    next = splitWorkspaceView(view, id, "right", requester);
  }
  return next.focusedId === view.focusedId
    ? next
    : { ...next, focusedId: view.focusedId };
}

/** Combine whole pane groups, retaining the destination's selected tab. */
export function combineWorkspaceGroups(
  view: WorkspaceView,
  sourceId: string,
  targetId: string,
): WorkspaceView {
  const allGroups = { ...view.groups, ...view.hiddenGroups };
  const previousSource = Object.keys(allGroups).find((owner) =>
    allGroups[owner].includes(sourceId),
  );
  const previousTarget = Object.keys(allGroups).find((owner) =>
    allGroups[owner].includes(targetId),
  );
  if (!previousSource || !previousTarget || previousSource === previousTarget)
    return view;
  // This permanent operation clears the backup, so uncover any tucked panes first.
  if (view.hiddenGroups) view = restoreWorkspaceSplit(view);
  const source = workspaceGroupOwner(view, sourceId);
  const target = workspaceGroupOwner(view, targetId);
  if (!source || !target || source === target || !view.layout) return view;
  const layout = removePane(view.layout, source);
  if (!layout) return view;
  const groups = {
    ...view.groups,
    [target]: [...view.groups[target], ...view.groups[source]],
  };
  delete groups[source];
  // Combining is permanent; a previous expansion must not restore this pane.
  return { layout, focusedId: target, order: view.order, groups };
}

/** Reorder this group's slots while keeping every other tab in global order. */
export function reorderWorkspaceGroup(
  view: WorkspaceView,
  ownerId: string,
  ids: string[],
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [ownerId]);
  const owner = workspaceGroupOwner(view, ownerId);
  if (!owner) return view;
  const members = view.groups[owner];
  const allowed = new Set(members);
  const ordered = uniqueIds([...ids, ...members], allowed);
  let index = 0;
  const order = view.order.map((id) =>
    allowed.has(id) ? ordered[index++] : id,
  );
  return { ...view, order, groups: { ...view.groups, [owner]: ordered } };
}

/** Merge pane groups into the selected group's single view without closing tabs. */
export function collapseWorkspaceView(
  view: WorkspaceView,
  id: string,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id]);
  const owner = workspaceGroupOwner(view, id);
  if (!owner) return view;
  const members = uniqueIds([
    ...view.groups[owner],
    ...(view.layout ? leafIds(view.layout) : [])
      .filter((key) => key !== owner)
      .flatMap((key) => view.groups[key]),
    ...view.order,
  ]);
  return {
    layout: leaf(id),
    focusedId: id,
    order: members,
    groups: { [id]: members },
  };
}

function findWorkspaceSplit(
  node: LayoutNode,
  id: string,
): Extract<LayoutNode, { type: "split" }> | undefined {
  if (node.type === "leaf") return undefined;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findWorkspaceSplit(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Hide the adjacent subtree, retaining every tab and the original split. */
export function minimizeWorkspaceSide(
  view: WorkspaceView,
  splitId: string,
  index: number,
  side: "before" | "after",
): WorkspaceView {
  if (
    !view.layout ||
    !Number.isInteger(index) ||
    (side !== "before" && side !== "after")
  )
    return view;
  const current = resolveWorkspaceView(view, view.order, view.focusedId);
  if (!current.layout) return view;
  const split = findWorkspaceSplit(current.layout, splitId);
  if (!split || index < 0 || index >= split.children.length - 1) return view;

  const before = side === "before";
  const removedIndex = before ? index : index + 1;
  const receivingIndex = before ? index + 1 : index;
  const removed = leafIds(split.children[removedIndex]);
  const receiving = leafIds(split.children[receivingIndex]);
  const owner = before ? receiving[0] : receiving[receiving.length - 1];
  if (!owner || !removed.length) return view;

  const groups = { ...current.groups };
  const hiddenGroups = { ...current.hiddenGroups };
  removed.forEach((id) => {
    hiddenGroups[id] = groups[id];
    delete groups[id];
  });
  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "leaf") return node;
    if (node.id !== splitId)
      return { ...node, children: node.children.map(replace) };
    const children = node.children.filter((_, i) => i !== removedIndex);
    if (children.length === 1) return children[0];
    // Give the freed space to the adjacent sibling; unrelated panes stay put.
    const sizes = node.sizes.map((size, i) =>
      i === receivingIndex ? size + node.sizes[removedIndex] : size,
    );
    sizes.splice(removedIndex, 1);
    return { ...node, children, sizes };
  };
  const {
    restoreView,
    minimizedEdge: _edge,
    hiddenGroups: _hidden,
    ...snapshot
  } = current;
  return {
    ...current,
    layout: replace(current.layout),
    focusedId: removed.includes(current.focusedId) ? owner : current.focusedId,
    groups,
    hiddenGroups,
    restoreView: restoreView ?? snapshot,
    minimizedEdge:
      split.dir === "right"
        ? before
          ? "left"
          : "right"
        : before
          ? "up"
          : "down",
  };
}

/** Restore surviving pane groups and sizes, keeping the current tab visible. */
export function restoreWorkspaceSplit(view: WorkspaceView): WorkspaceView {
  if (!view.restoreView) return view;
  const current = resolveWorkspaceView(view, view.order, view.focusedId);
  if (!current.restoreView) return current;
  const restored = resolveWorkspaceView(
    current.restoreView,
    current.order,
    current.restoreView.focusedId,
  );
  return selectWorkspaceView(restored, current.focusedId);
}

/** Expand temporarily; restore exact surviving pane groups and proportions. */
export function toggleWorkspaceExpansion(
  view: WorkspaceView,
  id: string,
  fallbackSessionId?: string,
): WorkspaceView {
  view = revealHiddenWorkspaceTargets(view, [id]);
  if (!workspaceGroupOwner(view, id) || !view.layout) return view;
  const current = resolveWorkspaceView(view, view.order, view.focusedId);
  if (current.layout && leafIds(current.layout).length > 1) {
    const {
      restoreView,
      minimizedEdge,
      hiddenGroups: previousHidden,
      ...snapshot
    } = current;
    const selected = selectWorkspaceView(current, id);
    const hiddenGroups = { ...previousHidden };
    for (const [owner, members] of Object.entries(selected.groups))
      if (owner !== id) hiddenGroups[owner] = members;
    return {
      layout: leaf(id),
      focusedId: id,
      order: current.order,
      groups: { [id]: selected.groups[id] },
      hiddenGroups,
      restoreView: restoreView ?? snapshot,
      ...(minimizedEdge ? { minimizedEdge } : {}),
    };
  }
  if (current.restoreView) {
    // Keep the page whose Restore control was clicked visible in its split.
    return selectWorkspaceView(restoreWorkspaceSplit(current), id);
  }
  return fallbackSessionId && fallbackSessionId !== id
    ? splitWorkspaceView(current, fallbackSessionId, "left", id)
    : current;
}

function loadViews(): Record<string, WorkspaceView> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function useWorkspaceViews(
  key: string,
  ids: string[],
  requestedFocus: string,
  initialLayout?: LayoutNode,
) {
  const [saved, setSaved] = useState(loadViews);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const idsKey = ids.join("\0");
  const view = useMemo(
    () => resolveWorkspaceView(saved[key], ids, requestedFocus, initialLayout),
    [saved, key, idsKey, requestedFocus],
  );
  const current = useRef({ key, ids, requestedFocus, initialLayout });
  current.current = { key, ids, requestedFocus, initialLayout };
  const change = useCallback(
    (update: (view: WorkspaceView) => WorkspaceView) => {
      const { key, ids, requestedFocus, initialLayout } = current.current;
      setSaved((all) => {
        const before = resolveWorkspaceView(
          all[key],
          ids,
          requestedFocus,
          initialLayout,
        );
        const next = update(before);
        if (JSON.stringify(next) === JSON.stringify(all[key])) return all;
        return { ...all, [key]: next };
      });
    },
    [],
  );
  const focus = useCallback((key: string, id: string) => {
    setSaved((all) => {
      const context = current.current;
      const ids = [
        ...new Set([
          ...(context.key === key ? context.ids : (all[key]?.order ?? [])),
          id,
        ]),
      ];
      const before = resolveWorkspaceView(
        all[key],
        ids,
        id,
        context.key === key ? context.initialLayout : undefined,
      );
      return { ...all, [key]: selectWorkspaceView(before, id) };
    });
  }, []);
  /** Explicit restoration/transfer can target a workspace other than the current one. */
  const restore = useCallback((key: string, value: WorkspaceView) => {
    setSaved((all) => ({ ...all, [key]: value }));
  }, []);
  const get = useCallback((key: string) => {
    const value = savedRef.current[key];
    return resolveWorkspaceView(
      value,
      value?.order ?? [],
      value?.focusedId ?? "",
    );
  }, []);
  const requested = useRef({
    key,
    focus: requestedFocus,
    actual: view.focusedId,
  });
  useEffect(() => {
    const previous = requested.current;
    requested.current = { key, focus: requestedFocus, actual: view.focusedId };
    // Opening another workspace restores its own arrangement instead of
    // overwriting it with whichever session happened to be active before.
    // Explicit pane selection also wins over an older session/browser hint.
    // App mirrors actual focus into that hint; replaying both directions in
    // one commit would repeatedly swap focus between the two surfaces.
    if (
      previous.key === key &&
      previous.actual === view.focusedId &&
      previous.focus !== requestedFocus &&
      requestedFocus
    )
      change((view) => selectWorkspaceView(view, requestedFocus));
  }, [key, requestedFocus, view.focusedId, change]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      /* Keep the in-memory arrangement usable. */
    }
  }, [saved]);
  return { view, change, focus, restore, get };
}
