import { normalizeBrowserUrl } from "./browser";
import { placeAgentBrowserView, type WorkspaceView } from "./workspaceViews";
import {
  addRetainedBrowserTab,
  keepBrowserTab,
  normalizeBrowserWorkspace,
  selectBrowserTab,
  type BrowserWorkspace,
} from "./personalWorkspace";

export type AgentBrowserOpenOptions = {
  newTab?: boolean;
  focus?: boolean;
  /** False keeps the user's panes as they are: no move, split or selection. */
  arrange?: boolean;
};

export type AgentBrowserPlacement = { activate: false; arrange: boolean };

/** Both window adapters use the same reuse, concurrency and background policy. */
export function createAgentBrowserRouter() {
  const pending = new Map<string, Set<Promise<string>>>();
  return {
    open<T extends { id: string; url: string }>(
      scope: string,
      url: string,
      options: AgentBrowserOpenOptions | undefined,
      adapter: {
        tabs: () => readonly T[];
        preferredId?: string;
        reuse: (tab: T, placement: AgentBrowserPlacement) => Promise<string>;
        create: (
          url: string,
          placement: AgentBrowserPlacement,
        ) => Promise<string>;
      },
    ): Promise<string> {
      const target = normalizeBrowserUrl(url);
      const key = JSON.stringify([scope, target]);
      const operations = pending.get(key) ?? new Set<Promise<string>>();
      const existingOperation = operations.values().next().value;
      if (!options?.newTab && existingOperation) return existingOperation;
      const operation = Promise.resolve()
        .then(() => {
          const placement: AgentBrowserPlacement = {
            activate: false,
            arrange: options?.arrange !== false,
          };
          const existing = options?.newTab
            ? undefined
            : matchingAgentBrowserTab(adapter.tabs(), url, adapter.preferredId);
          return existing
            ? adapter.reuse(existing, placement)
            : adapter.create(target, placement);
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

/** A window may add a background tab while preserving every pane selection. */
export function presentAgentBrowserView(
  view: WorkspaceView,
  id: string,
  browserIds: readonly string[],
  requesterId?: string,
  arrange = true,
): WorkspaceView {
  return arrange
    ? placeAgentBrowserView(view, id, browserIds, requesterId)
    : view;
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
