import { normalizeBrowserUrl } from "./browser";
import {
  addRetainedBrowserTab,
  keepBrowserTab,
  normalizeBrowserWorkspace,
  selectBrowserTab,
  type BrowserWorkspace,
} from "./personalWorkspace";

export type AgentBrowserOpenOptions = { newTab?: boolean };

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
      workspace: selectBrowserTab(
        keepBrowserTab(current, existing.id),
        existing.id,
      ),
    };
  }
  const tab = { id: createId(), url: normalizeBrowserUrl(url), kept: true };
  return {
    tab,
    workspace: addRetainedBrowserTab({ ...current, mode: "tab" }, tab),
  };
}
