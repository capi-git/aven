import { normalizeBrowserUrl } from "./browser";
import { leafIds, type LayoutNode } from "./layout";
import { placeAgentBrowserView, type WorkspaceView } from "./workspaceViews";
import {
  addRetainedBrowserTab,
  keepBrowserTab,
  normalizeBrowserWorkspace,
  selectBrowserTab,
  updateBrowserTab,
  type BrowserTab,
  type BrowserWorkspace,
  type NormalizedBrowserWorkspace,
} from "./personalWorkspace";

export type AgentBrowserOpenOptions = {
  newTab?: boolean;
  focus?: boolean;
  /** False keeps the user's panes as they are: no move, split or selection. */
  arrange?: boolean;
  /**
   * The chat asking. Its own page (`agentChat`) is reused for its next page
   * on the same site; a page it creates becomes its own.
   */
  chat?: string;
};

export type AgentBrowserPlacement = { activate: false; arrange: boolean };

/**
 * What an open does to the chat's own page it lands on: reload it at the
 * same address, or navigate it to the new one. Another page is only shown.
 */
export type AgentPageRefresh = "reload" | "navigate";

/** The page an agent's open landed on, and what to do to it. */
export type AgentBrowserOpened = { id: string; refresh?: AgentPageRefresh };

type AgentPageCandidate = { id: string; url: string; agentChat?: string };

function opened(
  value: string | AgentBrowserOpened,
  refresh?: AgentPageRefresh,
): AgentBrowserOpened {
  if (typeof value !== "string") return value;
  return refresh ? { id: value, refresh } : { id: value };
}

/** Both window adapters use the same reuse, concurrency and background policy. */
export function createAgentBrowserRouter() {
  const pending = new Map<string, Set<Promise<AgentBrowserOpened>>>();
  return {
    open<T extends AgentPageCandidate>(
      scope: string,
      url: string,
      options: AgentBrowserOpenOptions | undefined,
      adapter: {
        tabs: () => readonly T[];
        preferredId?: string;
        reuse: (
          tab: T,
          placement: AgentBrowserPlacement,
          refresh?: AgentPageRefresh,
        ) => Promise<string | AgentBrowserOpened>;
        create: (
          url: string,
          placement: AgentBrowserPlacement,
        ) => Promise<string | AgentBrowserOpened>;
      },
    ): Promise<AgentBrowserOpened> {
      const target = normalizeBrowserUrl(url);
      const key = JSON.stringify([scope, target]);
      const operations =
        pending.get(key) ?? new Set<Promise<AgentBrowserOpened>>();
      const existingOperation = operations.values().next().value;
      if (!options?.newTab && existingOperation) return existingOperation;
      const operation = Promise.resolve()
        .then(async () => {
          const placement: AgentBrowserPlacement = {
            activate: false,
            arrange: options?.arrange !== false,
          };
          const existing = agentPageFor(
            adapter.tabs(),
            url,
            options?.chat,
            adapter.preferredId,
            { newTab: options?.newTab },
          );
          return existing
            ? opened(
                await adapter.reuse(existing.tab, placement, existing.refresh),
                existing.refresh,
              )
            : opened(await adapter.create(target, placement));
        })
        .finally(() => {
          operations.delete(operation);
          if (!operations.size && pending.get(key) === operations)
            pending.delete(key);
        });
      operations.add(operation);
      pending.set(key, operations);
      return operation;
    },
  };
}

/**
 * The tab of the chat an agent's page was asked for from: the asking chat's
 * own, else (a worker, which has no tab) its lead's.
 */
export function agentRequesterTab(
  tabs: readonly { id: string; layout: LayoutNode }[],
  chats: readonly (string | undefined)[],
): string | undefined {
  for (const chat of chats) {
    if (!chat) continue;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(chat));
    if (tab) return tab.id;
  }
  return undefined;
}

/**
 * Where an agent's page goes: a browser pane already open (one showing the
 * same server first), never the asking chat's own pane while one is open.
 * With `arrange` off it only joins such a pane as a background tab, and
 * otherwise waits where it was added, every pane selection kept.
 */
export function presentAgentBrowserView(
  view: WorkspaceView,
  id: string,
  browserIds: readonly string[],
  requesterId?: string,
  arrange = true,
  sameServerIds: readonly string[] = [],
): WorkspaceView {
  return placeAgentBrowserView(view, id, browserIds, requesterId, {
    sameSite: sameServerIds,
    background: !arrange,
  });
}

/** An emitted request succeeds only after delivery and the owner's checkpoint. */
export function reserveAgentBrowserOpen(
  id: string,
  send: () => Promise<void>,
  release: () => void,
) {
  let resolve!: (id: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let delivered = false;
  let confirmed = false;
  let settled = false;
  const finish = (reason?: Error) => {
    if (settled || (!reason && (!delivered || !confirmed))) return;
    settled = true;
    clearTimeout(timer);
    release();
    if (reason) reject(reason);
    else resolve(id);
  };
  const timer = setTimeout(
    () =>
      finish(
        new Error(
          "The task window did not confirm the browser tab. Try opening it again.",
        ),
      ),
    8000,
  );
  void Promise.resolve()
    .then(() => (settled ? undefined : send()))
    .then(
      () => {
        delivered = true;
        finish();
      },
      (reason) =>
        finish(reason instanceof Error ? reason : new Error(String(reason))),
    );
  return {
    promise,
    confirm: () => {
      confirmed = true;
      finish();
    },
    fail: (reason: Error) => finish(reason),
  };
}

/** Only search the caller's already-authorized workspace. Keep query/hash identity. */
export function matchingAgentBrowserTab<T extends { id: string; url: string }>(
  tabs: readonly T[],
  url: string,
  preferredId?: string,
): T | undefined {
  const target = normalizeBrowserUrl(url);
  const matches = (tab: T) => {
    try {
      return normalizeBrowserUrl(tab.url) === target;
    } catch {
      // A blank new tab or an old invalid saved address is never a match.
      return false;
    }
  };
  const preferred = tabs.find((tab) => tab.id === preferredId);
  return preferred && matches(preferred) ? preferred : tabs.find(matches);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether two addresses are the same site for an agent's page: the same
 * scheme, host and port, with the loopback names counting as one host. Any
 * route, file, query string or fragment on it is the same work. Another
 * local server is not: it may stop, or be another app.
 */
export function sameAgentSite(a: string, b: string): boolean {
  try {
    const one = new URL(a);
    const two = new URL(b);
    const host = (url: URL) =>
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
        ? "localhost"
        : url.hostname.toLowerCase();
    return (
      one.protocol === two.protocol &&
      one.port === two.port &&
      host(one) === host(two)
    );
  } catch {
    return false;
  }
}

/** The address's path, without its query or fragment. */
function pagePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * The page an agent's open lands on, without a new tab:
 * - a page at the same address: the chat's own is reloaded, any other is
 *   only shown (a page the user opened is never navigated by an open);
 * - else the chat's own page on the same site, navigated to the address (the
 *   one in front first, else the newest), so one page is built on.
 * With `newTab` the agent wants a second page: only the chat's own page at
 * the same path on the same site is reused (reloaded, or navigated to a new
 * query or fragment), since a copy of it shows nothing new; any other path
 * or site gets a new tab, for alternatives side by side.
 * Undefined means a new tab. A page the user kept or took over has no
 * `agentChat`, so it is never navigated.
 */
export function agentPageFor<T extends AgentPageCandidate>(
  tabs: readonly T[],
  url: string,
  chat?: string,
  preferredId?: string,
  { newTab = false }: { newTab?: boolean } = {},
): { tab: T; refresh?: AgentPageRefresh } | undefined {
  const own = (tab: T) => !!chat && tab.agentChat === chat;
  const mine = tabs.filter(own);
  const exactOwn = matchingAgentBrowserTab(mine, url, preferredId);
  if (exactOwn) return { tab: exactOwn, refresh: "reload" };
  const target = normalizeBrowserUrl(url);
  const path = pagePath(target);
  const site = mine.filter(
    (tab) =>
      sameAgentSite(tab.url, target) && (!newTab || pagePath(tab.url) === path),
  );
  const page =
    site.find((tab) => tab.id === preferredId) ?? site[site.length - 1];
  if (newTab) return page ? { tab: page, refresh: "navigate" } : undefined;
  const exact = matchingAgentBrowserTab(tabs, url, preferredId);
  if (exact) return { tab: exact };
  return page ? { tab: page, refresh: "navigate" } : undefined;
}

/**
 * An agent's open in a workspace's browser state. A repeated open selects
 * the live tab; the chat's own page is reloaded at the same address or
 * navigated to another on its site (`refresh`), and otherwise a new tab,
 * owned by the chat, is added. `newTab` adds one unless the chat already
 * has its own page at that path (`agentPageFor`).
 */
export function openAgentBrowserTab(
  state: BrowserWorkspace,
  url: string,
  options: AgentBrowserOpenOptions = {},
  createId: () => string = () => crypto.randomUUID(),
): {
  tab: BrowserTab;
  workspace: NormalizedBrowserWorkspace;
  refresh?: AgentPageRefresh;
} {
  const current = normalizeBrowserWorkspace(state);
  const preserveFocus = (
    workspace: ReturnType<typeof normalizeBrowserWorkspace>,
  ) =>
    options.focus === false
      ? {
          ...workspace,
          activeTabId: current.activeTabId ?? workspace.activeTabId,
          url: current.activeTabId ? current.url : workspace.url,
          expanded: current.expanded,
        }
      : workspace;
  const existing = agentPageFor(
    current.tabs,
    url,
    options.chat,
    current.activeTabId ?? undefined,
    { newTab: options.newTab },
  );
  if (existing) {
    const { tab, refresh } = existing;
    // The page shows the new address at once, so an overlapping open finds
    // it; the page itself is navigated once it is ready.
    const moved =
      refresh === "navigate"
        ? updateBrowserTab(current, tab.id, { url: normalizeBrowserUrl(url) })
        : current;
    const workspace = preserveFocus(
      selectBrowserTab(keepBrowserTab(moved, tab.id), tab.id),
    );
    return {
      tab: workspace.tabs.find((page) => page.id === tab.id) ?? tab,
      workspace,
      ...(refresh ? { refresh } : {}),
    };
  }
  const tab = {
    id: createId(),
    url: normalizeBrowserUrl(url),
    kept: true,
    ...(options.chat ? { agentChat: options.chat } : {}),
  };
  return {
    tab,
    workspace: preserveFocus(addRetainedBrowserTab(current, tab)),
  };
}
