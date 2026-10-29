import {
  browserIdForTab,
  normalizeBrowserWorkspace,
  type BrowserWorkspace,
} from "./personalWorkspace";

/**
 * One browser tab of this window, as an agent's `tabs` lists it: every
 * project's open browser (the projectless workspace included) and the tabs
 * this window's detached windows show. The native side adds the page's live
 * title and address, and works out whose it is for the asking chat.
 */
export type AgentBrowserTab = {
  /** The workspace surface: stable while the tab sleeps and wakes. */
  surfaceId: string;
  project: string;
  /** Empty for the workspace without a project. */
  projectName: string;
  title: string;
  url: string;
  /** The chat whose agent opened the page and builds on it. */
  agentChat?: string;
  /** That chat's name, so another chat can tell whose page it is. */
  agentName?: string;
  detached: boolean;
  onScreen: boolean;
};

/** What the native `tabs` request receives for each tab. */
export type AgentTabRecord = AgentBrowserTab & {
  nativeId?: string;
  asleep: boolean;
  /** In the asking chat's own project scope (its page grant). */
  scope: boolean;
};

export function agentBrowserTabs({
  workspaces,
  detached,
  onScreen,
  projectName,
  chatName,
}: {
  workspaces: Readonly<Record<string, BrowserWorkspace | undefined>>;
  detached: ReadonlySet<string>;
  onScreen: ReadonlySet<string>;
  projectName: (project: string) => string;
  chatName: (sessionId: string) => string | undefined;
}): AgentBrowserTab[] {
  return Object.entries(workspaces).flatMap(([project, saved]) => {
    if (!saved) return [];
    const workspace = normalizeBrowserWorkspace(saved);
    if (!workspace.open) return [];
    const name = projectName(project);
    return workspace.tabs.flatMap((tab) => {
      if (!tab.url) return [];
      const surfaceId = browserIdForTab(project, tab.id);
      const agentName = tab.agentChat ? chatName(tab.agentChat) : undefined;
      return [
        {
          surfaceId,
          project,
          projectName: name,
          title: tab.title ?? "",
          url: tab.url,
          ...(tab.agentChat ? { agentChat: tab.agentChat } : {}),
          ...(agentName ? { agentName } : {}),
          detached: detached.has(surfaceId),
          onScreen: onScreen.has(surfaceId),
        },
      ];
    });
  });
}

/**
 * The window's tabs for one asking chat: which have a live page (the rest
 * are asleep or were never shown), and which are in that chat's scope.
 */
export function agentTabRecords(
  tabs: readonly AgentBrowserTab[],
  nativeId: (surfaceId: string) => string | undefined,
  scope: ReadonlySet<string>,
): AgentTabRecord[] {
  return tabs.slice(0, 500).map((tab) => {
    const id = nativeId(tab.surfaceId);
    return {
      ...tab,
      ...(id ? { nativeId: id } : {}),
      asleep: !id,
      scope: scope.has(tab.surfaceId),
    };
  });
}
