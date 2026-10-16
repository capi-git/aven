import { leafIds, type WorkspaceTab } from "./layout";

/**
 * Both split levels matter: a retained offscreen tab or floating placeholder
 * is not a transcript. A discussion shows its partner's replies in the chat
 * that started it (`companions`: that chat → its partners), and its page
 * shows both chats', so either on screen counts as showing those chats.
 */
export function visibleActivitySessionIds({
  workspaceVisible,
  visibleSurfaceIds,
  tabs,
  sessionIds,
  floatingSessionIds,
  companions,
}: {
  workspaceVisible: boolean;
  visibleSurfaceIds: readonly string[];
  tabs: readonly WorkspaceTab[];
  sessionIds: ReadonlySet<string>;
  floatingSessionIds: readonly string[];
  companions?: ReadonlyMap<string, readonly string[]>;
}): Set<string> {
  const visible = new Set<string>();
  if (!workspaceVisible) return visible;
  const surfaces = new Set(visibleSurfaceIds);
  const floating = new Set(floatingSessionIds);
  const show = (id: string) => {
    if (!sessionIds.has(id) || floating.has(id)) return;
    visible.add(id);
    for (const partner of companions?.get(id) ?? [])
      if (sessionIds.has(partner) && !floating.has(partner))
        visible.add(partner);
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
