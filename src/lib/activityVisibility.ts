import { leafIds, type WorkspaceTab } from "./layout";

/**
 * Both split levels matter: a retained offscreen tab or floating placeholder
 * is not a transcript. A discussion's page on screen shows both of its
 * chats' replies, so it counts as showing those chats.
 */
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
  const show = (id: string) => {
    if (sessionIds.has(id) && !floating.has(id)) visible.add(id);
  };
  for (const tab of tabs) {
    if (!surfaces.has(tab.id)) continue;
    for (const id of leafIds(tab.layout)) {
      show(id);
      const pane = tab.editorPanes.find((entry) => entry.id === id);
      const page = pane?.files.find(
        (file) => file.id === pane.activeFileId,
      )?.discussion;
      if (page) {
        show(page.a);
        show(page.b);
      }
    }
  }
  return visible;
}
