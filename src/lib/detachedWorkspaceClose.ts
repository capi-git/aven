import type { DetachedWorkspaceState } from "./detachedWorkspaces";

/** Forward close transitions once while keeping native snapshots cumulative. */
export function withNewDetachedCloses(
  previous: DetachedWorkspaceState | undefined,
  incoming: DetachedWorkspaceState,
): DetachedWorkspaceState {
  const liveIds = (state: DetachedWorkspaceState | undefined) =>
    new Set([
      ...(state?.tabs.map((tab) => tab.id) ?? []),
      ...(state?.browsers.map((browser) => browser.id) ?? []),
    ]);
  const live = liveIds(incoming);
  const previouslyLive = liveIds(previous);
  const alreadyClosed = new Set(previous?.closedSurfaceIds ?? []);
  const closed = incoming.closedSurfaceIds ?? [];
  const newlyClosed = closed.filter(
    (id) => !live.has(id) && (previouslyLive.has(id) || !alreadyClosed.has(id)),
  );
  return newlyClosed.length === closed.length
    ? incoming
    : { ...incoming, closedSurfaceIds: newlyClosed };
}
