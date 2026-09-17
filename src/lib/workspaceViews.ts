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
): WorkspaceViewSnapshot {
  const allowed = new Set(uniqueIds(ids));
  const preferred = allowed.has(fallback) ? fallback : ([...allowed][0] ?? "");
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
    new Set([...allowed, ...Object.keys(rawGroups)]),
  );
  const originalOwners = layout ? leafIds(layout) : [];
  const reserved = new Set(originalOwners.filter((id) => allowed.has(id)));
  const groups: Record<string, string[]> = Object.create(null);
  const claimed = new Set<string>();
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
    const members = [...groups[focusedId], ...unassigned];
    const at = members.indexOf(focusedId) + 1;
    members.splice(at, 0, ...newcomers);
    groups[focusedId] = members;
    if (newcomers.length) {
      order = order.filter((id) => !newIds.has(id));
      order.splice(order.indexOf(focusedId) + 1, 0, ...newcomers);
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
  const next = resolveWorkspaceSnapshot(value, ids, fallback, initialLayout);
  const restore = value?.restoreView;
  if (!restore || typeof restore !== "object" || Array.isArray(restore))
    return next;
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
    return next;
  const snapshot = resolveWorkspaceSnapshot(
    restore,
    ids,
    restore.focusedId || fallback,
  );
  return snapshot.layout ? { ...next, restoreView: snapshot } : next;
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

/** Combine whole pane groups, retaining the destination's selected tab. */
export function combineWorkspaceGroups(
  view: WorkspaceView,
  sourceId: string,
  targetId: string,
): WorkspaceView {
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

/** Expand temporarily; restore exact surviving pane groups and proportions. */
export function toggleWorkspaceExpansion(
  view: WorkspaceView,
  id: string,
  fallbackSessionId?: string,
): WorkspaceView {
  if (!workspaceGroupOwner(view, id) || !view.layout) return view;
  const current = resolveWorkspaceView(view, view.order, view.focusedId);
  if (current.layout && leafIds(current.layout).length > 1) {
    const { restoreView: _previous, ...snapshot } = current;
    return { ...collapseWorkspaceView(current, id), restoreView: snapshot };
  }
  if (current.restoreView) {
    const restored = resolveWorkspaceView(
      current.restoreView,
      current.order,
      current.restoreView.focusedId,
    );
    // Keep the page whose Restore control was clicked visible in its split.
    return selectWorkspaceView(restored, id);
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
