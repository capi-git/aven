import { normalizeBrowserUrl } from "./browser";
import {
  addRetainedBrowserTab,
  keepBrowserTab,
  normalizeBrowserWorkspace,
  selectBrowserTab,
  type BrowserWorkspace,
} from "./personalWorkspace";

export type AgentBrowserOpenOptions = { newTab?: boolean; focus?: boolean };

/** Concurrent tasks in one project share an in-flight open, including transfers. */
export function coalesceAgentBrowserOpen(
  pending: Map<string, Promise<string>>,
  project: string,
  url: string,
  options: AgentBrowserOpenOptions | undefined,
  open: () => Promise<string>,
): Promise<string> {
  if (options?.newTab) return open();
  const key = JSON.stringify([project, normalizeBrowserUrl(url)]);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = Promise.resolve()
    .then(open)
    .finally(() => {
      if (pending.get(key) === operation) pending.delete(key);
    });
  pending.set(key, operation);
  return operation;
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

/** Repeated agent opens select a live tab without navigating or replacing it. */
export function openAgentBrowserTab(
  state: BrowserWorkspace,
  url: string,
  options: AgentBrowserOpenOptions = {},
  createId: () => string = () => crypto.randomUUID(),
) {
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
  const existing = options.newTab
    ? undefined
    : matchingAgentBrowserTab(
        current.tabs,
        url,
        current.activeTabId ?? undefined,
      );
  if (existing) {
    return {
      tab: existing,
      workspace: preserveFocus(
        selectBrowserTab(keepBrowserTab(current, existing.id), existing.id),
      ),
    };
  }
  const tab = { id: createId(), url: normalizeBrowserUrl(url), kept: true };
  return {
    tab,
    workspace: preserveFocus(addRetainedBrowserTab(current, tab)),
  };
}
