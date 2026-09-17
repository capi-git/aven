import { leafIds, type WorkspaceTab } from "./layout";

/** Both split levels matter: a retained offscreen tab or floating placeholder is not a transcript. */
export function visibleActivitySessionIds({
  workspaceVisible,
  visibleSurfaceIds,
  tabs,
  sessionIds,
  floatingSessionIds,
}: {
  workspaceVisible: boolean;
  visibleSurfaceIds: readonly string[];
  tabs: readonly WorkspaceTab[];
  sessionIds: ReadonlySet<string>;
  floatingSessionIds: readonly string[];
}): Set<string> {
  const visible = new Set<string>();
  if (!workspaceVisible) return visible;
  const surfaces = new Set(visibleSurfaceIds);
  const floating = new Set(floatingSessionIds);
  for (const tab of tabs) {
    if (!surfaces.has(tab.id)) continue;
    for (const id of leafIds(tab.layout))
      if (sessionIds.has(id) && !floating.has(id)) visible.add(id);
  }
  return visible;
}
