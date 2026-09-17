import { leafIds, type WorkspaceTab } from "./layout";

/** Explicit close buttons belong to their leaf, even in an unfocused tab. */
export function resolvePaneCloseTab(
  tabs: readonly WorkspaceTab[],
  activeTabId: string,
  paneId?: string,
): WorkspaceTab | undefined {
  return paneId === undefined
    ? tabs.find((tab) => tab.id === activeTabId)
    : tabs.find((tab) => leafIds(tab.layout).includes(paneId));
}
