import { listenerGroup } from "./listenerGroup";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { WorkspaceTab } from "./layout";
import type { WorkspaceReturnPlacement } from "./workspaceArrangement";
import { leafIds } from "./layout";
import { browserIdForTab } from "./personalWorkspace";
import { resolveWorkspaceView, type WorkspaceView } from "./workspaceViews";
import {
  getRegisteredAgentBrowserPage,
  registerAgentBrowserPage,
} from "./agentBrowser";
import {
  flushComposerDrafts,
  readComposerDraft,
  importComposerDraft,
} from "./composerDrafts";
import {
  captureEditorDrafts,
  restoreEditorDrafts,
  retainTransferredBrowser,
  retainTransferredTerminal,
  captureTerminalScreens,
  restoreTerminalScreens,
  type EditorTransferDraft,
  type DetachedDrafts,
} from "./workspaceTransfers";
import {
  SESSION_PIP_CALLBACKS,
  captureSessionPipTheme,
  validSessionPipAction,
  type SessionPaneProps,
  type SessionPictureInPictureState,
  type SessionPipTheme,
} from "./sessionPictureInPicture";
import { allModels, getModelSnapshot } from "./models";
import { registerWorkspaceDraftFlusher } from "./workspaceDraftFlush";
import type { Session } from "./session";

export type DetachedBrowser = {
  project?: string;
  id: string;
  tabId: string;
  url: string;
  title?: string;
  favicon?: string;
  nativeId?: string;
};
export type DetachedWorkspaceState = {
  title: string;
  cwd: string;
  originalSurfaceIds?: string[];
  returnPlacement?: WorkspaceReturnPlacement;
  closedSurfaceIds?: string[];
  tabs: WorkspaceTab[];
  browsers: DetachedBrowser[];
  view: WorkspaceView;
  sessions: SessionPictureInPictureState[];
  theme?: SessionPipTheme;
  drafts?: DetachedDrafts;
  editorDrafts?: Record<string, EditorTransferDraft>;
  canNewSession?: boolean;
  terminalScreens?: Record<string, string>;
  dirtyFileIds?: string[];
  transferToken?: string;
};
export type DetachedWorkspaceSnapshot = {
  id: string;
  state: DetachedWorkspaceState;
  pinned: boolean;
  returnToken?: string;
  remaining?: DetachedWorkspaceState;
};
export type WorkspaceDropPoint = { screenX: number; screenY: number };
export const nativeWorkspaceWindow = {
  open: (
    state: DetachedWorkspaceState,
    target?: string,
    point?: WorkspaceDropPoint,
  ) =>
    invoke<DetachedWorkspaceSnapshot>("workspace_window_open", {
      state,
      target,
      point,
    }),
  update: (
    id: string,
    sessions: SessionPictureInPictureState[],
    theme?: SessionPipTheme,
  ) =>
    invoke<void>("workspace_window_update", {
      id,
      sessions,
      theme: theme ?? null,
    }),
  getState: (id?: string) =>
    invoke<DetachedWorkspaceSnapshot>("workspace_window_get_state", { id }),
  ready: (token: string) => invoke<void>("workspace_window_ready", { token }),
  action: (sessionId: string, action: string, args: unknown[]) =>
    invoke<void>("workspace_window_action", { sessionId, action, args }),
  ack: (token: string, state?: DetachedWorkspaceState, error?: string) =>
    invoke<void>("workspace_window_ack", { token, state, error }),
  freeze: (id: string) =>
    invoke<DetachedWorkspaceSnapshot>("workspace_window_freeze", { id }),
  resume: (id: string) => invoke<void>("workspace_window_resume", { id }),
  checkpoint: (state: DetachedWorkspaceState) =>
    invoke<void>("workspace_window_checkpoint", { state }),
  return: () => invoke<void>("workspace_window_return"),
  returnSelection: (
    state: DetachedWorkspaceState,
    remaining: DetachedWorkspaceState,
  ) => invoke<void>("workspace_window_return_selection", { state, remaining }),
  close: (id: string) => invoke<void>("workspace_window_close", { id }),
  pinned: (pinned: boolean, id?: string) =>
    invoke<void>("workspace_window_set_pinned", { pinned, id }),
  show: (id: string) => invoke<void>("workspace_window_show", { id }),
  list: () => invoke<DetachedWorkspaceSnapshot[]>("workspace_window_list"),
  visibility: (sessionIds: string[]) =>
    invoke<void>("workspace_window_visibility", { sessionIds }),
  focus: (
    id: string,
    sessionId?: string,
    url?: string,
    browser?: DetachedBrowser,
  ) => invoke<void>("workspace_window_focus", { id, sessionId, url, browser }),
  newSession: () => invoke<void>("workspace_window_new_session"),
  recover: () => invoke<void>("workspace_window_recover"),
  listen: <T>(name: string, receive: (value: T) => void) =>
    getCurrentWebview().listen<T>(name, (e) => receive(e.payload)),
};
export function detachedSessionIds(state: DetachedWorkspaceState): string[] {
  const leaves = new Set(state.tabs.flatMap((tab) => leafIds(tab.layout)));
  return state.sessions
    .filter((s) => leaves.has(s.session.id))
    .map((s) => s.session.id);
}
export function detachedTerminalIds(state: DetachedWorkspaceState): string[] {
  return state.tabs.flatMap((tab) =>
    [...tab.editorPanes, ...tab.terminalPanes].flatMap((p) =>
      p.files.filter((f) => f.terminal).map((f) => f.id),
    ),
  );
}
export function detachedSurfaceIds(state: DetachedWorkspaceState): string[] {
  return [...state.tabs.map((t) => t.id), ...state.browsers.map((b) => b.id)];
}
/** Keep both split trees when appending a group to another window. */
export function mergeDetachedWorkspaces(
  a: DetachedWorkspaceState,
  b: DetachedWorkspaceState,
): DetachedWorkspaceState {
  if (a.cwd !== b.cwd)
    throw new Error(
      "Choose a window in the same project before combining these tabs.",
    );
  const unique = <T extends { id: string }>(values: T[]) => [
    ...new Map(values.map((v) => [v.id, v])).values(),
  ];
  const tabs = unique([...a.tabs, ...b.tabs]),
    browsers = unique([...a.browsers, ...b.browsers]);
  const ids = [...tabs.map((t) => t.id), ...browsers.map((t) => t.id)];
  const overlap = detachedSurfaceIds(a).some((id) =>
    detachedSurfaceIds(b).includes(id),
  );
  if (overlap) throw new Error("These tabs already belong to this window.");
  const layout =
    a.view.layout && b.view.layout
      ? {
          type: "split" as const,
          id: crypto.randomUUID(),
          dir: "right" as const,
          children: [a.view.layout, b.view.layout],
          sizes: [0.5, 0.5],
        }
      : (a.view.layout ?? b.view.layout);
  return {
    ...a,
    // Combined windows no longer have one unambiguous original placement.
    returnPlacement: undefined,
    tabs,
    browsers,
    view: resolveWorkspaceView(
      {
        layout,
        focusedId: b.view.focusedId,
        order: [...a.view.order, ...b.view.order],
        groups: { ...a.view.groups, ...b.view.groups },
      },
      ids,
      b.view.focusedId,
    ),
    originalSurfaceIds: [
      ...new Set([
        ...(a.originalSurfaceIds ?? detachedSurfaceIds(a)),
        ...(b.originalSurfaceIds ?? detachedSurfaceIds(b)),
      ]),
    ],
    sessions: [
      ...new Map(
        [...a.sessions, ...b.sessions].map((s) => [s.session.id, s]),
      ).values(),
    ],
    drafts: { ...a.drafts, ...b.drafts },
    editorDrafts: { ...a.editorDrafts, ...b.editorDrafts },
    terminalScreens: { ...a.terminalScreens, ...b.terminalScreens },
    dirtyFileIds: [
      ...new Set([...(a.dirtyFileIds ?? []), ...(b.dirtyFileIds ?? [])]),
    ],
  };
}
type Options = {
  sessions: Session[];
  sessionProps: Partial<SessionPaneProps>;
  onReturned: (state: DetachedWorkspaceState) => void | Promise<void>;
  onCheckpoint?: (state: DetachedWorkspaceState) => void;
  onError?: (error: string) => void;
  onUpdatePlan?: (sessionId: string, blockId: string, text: string) => void;
  onNewSession?: (
    windowId: string,
    cwd: string,
  ) => Promise<DetachedWorkspaceState>;
};
export function useDetachedWorkspaces(options: Options) {
  const openRef = useRef<
    (state: DetachedWorkspaceState, target?: string) => Promise<string>
  >(async () => {
    throw new Error("Workspace is opening");
  });
  const latest = useRef(options);
  latest.current = options;
  const busyTargets = useRef(new Set<string>());
  const movingSurfaces = useRef(new Set<string>());
  const entries = useRef(new Map<string, DetachedWorkspaceSnapshot>());
  const [snapshots, setSnapshots] = useState<DetachedWorkspaceSnapshot[]>([]);
  const [nativeBrowserIds, setNativeBrowserIds] = useState<
    Record<string, string>
  >({});
  const [visibility, setVisibility] = useState<Record<string, string[]>>({});
  const streamTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const sent = useRef(
    new Map<
      string,
      {
        sessions: Session[];
        recents: SessionPaneProps["recents"] | undefined;
        catalog: number;
      }
    >(),
  );
  const pending = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const ready = useRef<Promise<unknown>>(Promise.resolve());
  const report = useCallback(
    (reason: unknown) =>
      latest.current.onError?.(
        reason instanceof Error ? reason.message : String(reason),
      ),
    [],
  );
  const publish = () => setSnapshots([...entries.current.values()]);
  const snapshotSessions = useCallback(
    (ids: string[]) =>
      latest.current.sessions
        .filter((s) => ids.includes(s.id))
        .map(
          (session) =>
            ({
              session,
              recents: latest.current.sessionProps.recents ?? [],
              hideProjectPicker: latest.current.sessionProps.hideProjectPicker,
              draft: readComposerDraft(session.id),
              catalog: allModels(),
              catalogVersion: getModelSnapshot(),
              actions: SESSION_PIP_CALLBACKS.filter(
                (name) =>
                  typeof latest.current.sessionProps[name] === "function",
              ),
            }) satisfies SessionPictureInPictureState,
        ),
    [],
  );
  const returnWindow = useCallback(async (id: string) => {
    if (!entries.current.has(id)) return;
    if (pending.current.has(id))
      throw new Error("This window is already returning.");
    const finished = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.current.delete(id);
        reject(
          new Error(
            "The detached window has not returned. It remains open so your work is preserved.",
          ),
        );
      }, 20000);
      pending.current.set(id, { resolve, reject, timer });
    });
    // Disposal may reject while the native close invocation is still pending.
    void finished.catch(() => undefined);
    try {
      await nativeWorkspaceWindow.close(id);
    } catch (reason) {
      const p = pending.current.get(id);
      if (p) {
        clearTimeout(p.timer);
        pending.current.delete(id);
        p.reject(new Error(String(reason)));
      }
    }
    await finished;
  }, []);
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const accept = (entry: DetachedWorkspaceSnapshot) => {
      if (disposed) return;
      for (const b of entry.state.browsers)
        if (b.nativeId) registerAgentBrowserPage(b.id, b.nativeId);
      entries.current.set(entry.id, entry);
      publish();
    };
    const listeners = listenerGroup([
      nativeWorkspaceWindow.listen<{ id: string; cwd: string }>(
        "workspace-window-new-session",
        (value) => {
          if (
            !entries.current.has(value.id) ||
            !latest.current.onNewSession ||
            busyTargets.current.has(value.id)
          )
            return;
          void latest.current
            .onNewSession(value.id, value.cwd)
            .then((state) => openRef.current(state, value.id))
            .catch(report);
        },
      ),
      nativeWorkspaceWindow.listen<{ id: string; sessionIds: string[] }>(
        "workspace-window-visibility",
        (value) =>
          setVisibility((v) =>
            (v[value.id] ?? []).join("\0") === value.sessionIds.join("\0")
              ? v
              : { ...v, [value.id]: value.sessionIds },
          ),
      ),
      nativeWorkspaceWindow.listen<DetachedWorkspaceSnapshot>(
        "workspace-window-checkpoint",
        (entry) => {
          if (!entries.current.has(entry.id)) return;
          accept(entry);
          latest.current.onCheckpoint?.(entry.state);
        },
      ),
      nativeWorkspaceWindow.listen<DetachedWorkspaceSnapshot>(
        "workspace-window-returned",
        (entry) => {
          void (async () => {
            try {
              restoreEditorDrafts(entry.state.editorDrafts);
              restoreTerminalScreens(entry.state.terminalScreens);
              for (const [id, draft] of Object.entries(
                entry.state.drafts ?? {},
              ))
                importComposerDraft(id, draft);
              setNativeBrowserIds((current) => ({
                ...current,
                ...Object.fromEntries(
                  entry.state.browsers.flatMap((b) =>
                    b.nativeId ? [[b.id, b.nativeId]] : [],
                  ),
                ),
              }));
              await latest.current.onReturned(entry.state);
              if (entry.returnToken)
                await nativeWorkspaceWindow.ack(entry.returnToken, entry.state);
              for (const b of entry.state.browsers)
                if (b.nativeId) retainTransferredBrowser(b.nativeId, false);
              for (const id of detachedTerminalIds(entry.state))
                retainTransferredTerminal(id, false);
              if (entry.remaining)
                entries.current.set(entry.id, {
                  id: entry.id,
                  state: entry.remaining,
                  pinned: entry.pinned,
                });
              else entries.current.delete(entry.id);
              setVisibility((v) => {
                const n = { ...v };
                if (entry.remaining)
                  n[entry.id] = (n[entry.id] ?? []).filter((id) =>
                    detachedSessionIds(entry.remaining!).includes(id),
                  );
                else delete n[entry.id];
                return n;
              });
              publish();
              const p = pending.current.get(entry.id);
              if (p) {
                clearTimeout(p.timer);
                pending.current.delete(entry.id);
                p.resolve();
              }
            } catch (reason) {
              if (entry.returnToken)
                await nativeWorkspaceWindow
                  .ack(entry.returnToken, undefined, String(reason))
                  .catch(() => {});
              throw reason;
            }
          })().catch(report);
        },
      ),
      nativeWorkspaceWindow.listen<{
        windowId: string;
        id: string;
        action: string;
        args: unknown[];
      }>("workspace-window-action", (action) => {
        const entry = entries.current.get(action.windowId);
        if (!entry) return;
        const updatePlan =
          action.action === "onUpdatePlan" &&
          detachedSessionIds(entry.state).includes(action.id) &&
          action.args[0] === action.id &&
          typeof action.args[1] === "string" &&
          typeof action.args[2] === "string";
        if (
          !updatePlan &&
          !validSessionPipAction(
            action,
            new Set(detachedSessionIds(entry.state)),
          )
        )
          return;
        const callback =
          action.action === "onUpdatePlan"
            ? latest.current.onUpdatePlan
            : latest.current.sessionProps[
                action.action as keyof SessionPaneProps
              ];
        if (typeof callback === "function")
          void Promise.resolve(
            (callback as (...args: unknown[]) => unknown)(...action.args),
          ).catch(report);
      }),
    ]);
    cleanups.push(listeners.dispose);
    ready.current = listeners.ready.then(async () => {
      if (disposed) throw new Error("The workspace owner was disposed.");
      for (const entry of await nativeWorkspaceWindow.list()) accept(entry);
    });
    // Report without converting a failed setup into successful readiness.
    // open/return callers must not act without their event bridge.
    void ready.current.catch(report);
    cleanups.push(
      registerWorkspaceDraftFlusher(async () => {
        await ready.current;
        await Promise.all([...entries.current.keys()].map(returnWindow));
      }),
    );
    return () => {
      disposed = true;
      clearTimeout(streamTimer.current);
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("The workspace owner was disposed before return completed."));
      }
      pending.current.clear();
      cleanups.forEach((fn) => fn());
    };
  }, [report, returnWindow]);
  useEffect(() => {
    if (!entries.current.size || streamTimer.current) return;
    streamTimer.current = setTimeout(() => {
      streamTimer.current = undefined;
      for (const entry of entries.current.values()) {
        const ids = detachedSessionIds(entry.state);
        const sessions = latest.current.sessions.filter((s) =>
          ids.includes(s.id),
        );
        const recents = latest.current.sessionProps.recents;
        const catalog = getModelSnapshot();
        const previous = sent.current.get(entry.id);
        if (
          previous &&
          previous.catalog === catalog &&
          previous.recents === recents &&
          previous.sessions.length === sessions.length &&
          previous.sessions.every((session, i) => session === sessions[i])
        )
          continue;
        sent.current.set(entry.id, { sessions, recents, catalog });
        void nativeWorkspaceWindow
          .update(entry.id, snapshotSessions(ids), entry.state.theme)
          .catch((reason) => {
            sent.current.delete(entry.id);
            report(reason);
          });
      }
    }, 100);
  }, [options.sessions, options.sessionProps, snapshotSessions, report]);
  const open = useCallback(
    async (
      input: DetachedWorkspaceState,
      target?: string,
      point?: WorkspaceDropPoint,
    ) => {
      await ready.current;
      if (target && busyTargets.current.has(target))
        throw new Error(
          "This window is still moving tabs. Try again in a moment.",
        );
      const moving = detachedSurfaceIds(input);
      if (moving.some((id) => movingSurfaces.current.has(id)))
        throw new Error("These tabs are already moving.");
      if (target) busyTargets.current.add(target);
      moving.forEach((id) => movingSurfaces.current.add(id));
      try {
        flushComposerDrafts();
        const ids = new Set(input.tabs.flatMap((t) => leafIds(t.layout)));
        const files = new Set(
          input.tabs.flatMap((t) =>
            [...t.editorPanes, ...t.terminalPanes].flatMap((p) =>
              p.files.map((f) => f.path),
            ),
          ),
        );
        const state: DetachedWorkspaceState = {
          ...input,
          canNewSession: !!latest.current.onNewSession,
          originalSurfaceIds:
            input.originalSurfaceIds ?? detachedSurfaceIds(input),
          sessions: snapshotSessions([...ids]),
          theme: captureSessionPipTheme(),
          editorDrafts: captureEditorDrafts(files),
          drafts: Object.fromEntries(
            [...ids].flatMap((id) => {
              const d = readComposerDraft(id);
              return d ? [[id, d]] : [];
            }),
          ),
          terminalScreens: captureTerminalScreens(detachedTerminalIds(input)),
          // Keep live pages, but let the destination initialize unopened URLs.
          // Waiting here cannot mount an unvisited source pane and blocks groups.
          browsers: input.browsers.map((b) => ({
            ...b,
            nativeId: b.nativeId ?? getRegisteredAgentBrowserPage(b.id),
          })),
        };
        for (const b of state.browsers)
          if (b.nativeId) retainTransferredBrowser(b.nativeId);
        for (const id of detachedTerminalIds(state))
          retainTransferredTerminal(id);
        try {
          const merged = target
            ? mergeDetachedWorkspaces(
                (await nativeWorkspaceWindow.freeze(target)).state,
                state,
              )
            : state;
          const entry = await nativeWorkspaceWindow.open(merged, target, point);
          entries.current.set(entry.id, entry);
          publish();
          return entry.id;
        } catch (reason) {
          for (const b of state.browsers)
            if (b.nativeId) retainTransferredBrowser(b.nativeId, false);
          for (const id of detachedTerminalIds(state))
            retainTransferredTerminal(id, false);
          if (target)
            await nativeWorkspaceWindow.resume(target).catch(() => {});
          window.dispatchEvent(new Event("supermono:browser-layout-reset"));
          throw reason;
        }
      } finally {
        if (target) busyTargets.current.delete(target);
        moving.forEach((id) => movingSurfaces.current.delete(id));
      }
    },
    [snapshotSessions],
  );
  openRef.current = open;
  const showSession = useCallback(async (id: string) => {
    const entry = [...entries.current.values()].find((e) =>
      detachedSessionIds(e.state).includes(id),
    );
    if (!entry) return false;
    await nativeWorkspaceWindow.focus(entry.id, id);
    return true;
  }, []);
  const openForSession = useCallback(
    async (id: string, url: string): Promise<string | null> => {
      const entry = [...entries.current.values()].find((e) =>
        detachedSessionIds(e.state).includes(id),
      );
      if (!entry) return null;
      let browser = entry.state.browsers.find((b) => b.url === url);
      if (!browser) {
        const tabId = crypto.randomUUID();
        browser = {
          id: browserIdForTab(entry.state.cwd, tabId),
          tabId,
          url,
          project: entry.state.cwd,
        };
      }
      await nativeWorkspaceWindow.focus(entry.id, id, undefined, browser);
      return browser.id;
    },
    [],
  );
  const openBrowserForSession = useCallback(
    async (id: string, browser: DetachedBrowser) => {
      const entry = [...entries.current.values()].find((e) =>
        detachedSessionIds(e.state).includes(id),
      );
      if (!entry) return false;
      await nativeWorkspaceWindow.focus(entry.id, id, undefined, browser);
      return true;
    },
    [],
  );
  return {
    openBrowserForSession,
    states: new Map(snapshots.map((s) => [s.id, s.state])),
    activeVisibleSessionIds: new Set(Object.values(visibility).flat()),
    focusedSessionIds: new Set(Object.values(visibility).flat()),
    showSession,
    openForSession,
    windows: snapshots.map((s) => ({
      id: s.id,
      label: s.state.title || "Workspace",
    })),
    snapshots,
    detachedSurfaceIds: new Set(
      snapshots.flatMap((s) => detachedSurfaceIds(s.state)),
    ),
    detachedSessionIds: new Set(
      snapshots.flatMap((s) => detachedSessionIds(s.state)),
    ),
    nativeBrowserIds,
    open,
    show: nativeWorkspaceWindow.show,
    returnWindow,
  };
}
