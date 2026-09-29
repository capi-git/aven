import {
  browserIdForTab,
  type BrowserTab,
  type NormalizedBrowserWorkspace,
} from "./personalWorkspace";

/** Omitted targets mean the active page; stale explicit targets never do. */
export function resolveBrowserTabTarget(
  workspace: NormalizedBrowserWorkspace,
  cwd: string,
  surfaceId?: string,
): BrowserTab | undefined {
  return workspace.tabs.find((tab) =>
    surfaceId === undefined
      ? tab.id === workspace.activeTabId
      : browserIdForTab(cwd, tab.id) === surfaceId,
  );
}
