import { leafIds, type LayoutNode } from "./layout";
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
  /**
   * The window remembers the tab but does not show its project (it is open
   * in another window): listed only if this window has a page for it.
   */
  elsewhere?: true;
};

/** What the native `tabs` request receives for each tab. */
export type AgentTabRecord = Omit<AgentBrowserTab, "elsewhere"> & {
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
  shown,
}: {
  workspaces: Readonly<Record<string, BrowserWorkspace | undefined>>;
  detached: ReadonlySet<string>;
  onScreen: ReadonlySet<string>;
  projectName: (project: string) => string;
  chatName: (sessionId: string) => string | undefined;
  /**
   * Whether this window shows the project: every window remembers every
   * project's tabs, but another window's are only copies here.
   */
  shown?: (project: string) => boolean;
}): AgentBrowserTab[] {
  return Object.entries(workspaces).flatMap(([project, saved]) => {
    if (!saved) return [];
    const workspace = normalizeBrowserWorkspace(saved);
    if (!workspace.open) return [];
    const name = projectName(project);
    const here = shown?.(project) ?? true;
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
          ...(here || detached.has(surfaceId)
            ? {}
            : { elsewhere: true as const }),
        },
      ];
    });
  });
}

/**
 * The projects whose browser tabs a window shows: the project in front and
 * those of the chats in its workspace tabs.
 */
export function shownBrowserProjects(
  current: string,
  tabs: readonly { layout: LayoutNode }[],
  sessions: readonly { id: string; cwd: string }[],
): Set<string> {
  const chats = new Set(tabs.flatMap((tab) => leafIds(tab.layout)));
  return new Set([
    current,
    ...sessions.flatMap((session) =>
      chats.has(session.id) ? [session.cwd] : [],
    ),
  ]);
}

/**
 * The window's tabs for one asking chat: which have a live page (the rest
 * are asleep or were never shown), and which are in that chat's scope. A
 * tab of a project this window does not show is left out unless the window
 * has a page for it, so a tab another window shows (or closed) is never
 * listed, or loaded again, as this window's.
 */
export function agentTabRecords(
  tabs: readonly AgentBrowserTab[],
  nativeId: (surfaceId: string) => string | undefined,
  scope: ReadonlySet<string>,
): AgentTabRecord[] {
  return tabs
    .flatMap(({ elsewhere, ...tab }) => {
      const id = nativeId(tab.surfaceId);
      const inScope = scope.has(tab.surfaceId);
      if (elsewhere && !id && !inScope) return [];
      return [
        {
          ...tab,
          ...(id ? { nativeId: id } : {}),
          asleep: !id,
          scope: inScope,
        },
      ];
    })
    .slice(0, 500);
}

/**
 * Make sure a tab has a page to read, without changing what the user sees.
 * A tab with a page is left as it is; one in a window detached from this
 * one is loaded there, since this window holds no page for it; any other
 * is loaded out of sight here.
 */
export async function reachAgentTab(
  surfaceId: string,
  {
    registered,
    detached,
    loadDetached,
    load,
  }: {
    registered: (surfaceId: string) => boolean;
    detached: (surfaceId: string) => boolean;
    /** False when no detached window holds the tab any more. */
    loadDetached: (surfaceId: string) => Promise<boolean>;
    load: (surfaceId: string) => void;
  },
): Promise<void> {
  if (registered(surfaceId)) return;
  if (!detached(surfaceId)) return load(surfaceId);
  if (!(await loadDetached(surfaceId)))
    throw new Error("That tab's window has closed.");
}
