import { discardEditorDrafts } from "../lib/workspaceTransfers";
import { sessionWorkCwd } from "../lib/session";
import { useBootSplashReady } from "../lib/bootSplash";
import { selectWorkspaceArrangement } from "../lib/workspaceArrangement";
import { flushSync } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import { TitleBar, type Tab } from "../chrome/TitleBar";
import { sessionModelIdentity } from "../lib/sessionLabels";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../lib/terminalClose";
import { killPty } from "../lib/pty";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrowserPane } from "./BrowserPane";
import { SessionPane } from "./SessionPane";
import { FilePane } from "./FilePane";
import {
  WorkspaceStage,
  workspaceSurfaceDropAt,
  type WorkspaceSurfaceDropTarget,
} from "./WorkspaceStage";
import { nativeBrowser } from "../lib/browser";
import { browserIdForTab } from "../lib/personalWorkspace";
import { installInAppLinks } from "../lib/inAppLinks";
import {
  leaf,
  leafIds,
  newFileTab,
  placePane,
  removePane,
  type EditorPane,
  type FilePaneTab,
  type WorkspaceTab,
} from "../lib/layout";
import {
  closeWorkspaceViews,
  resolveWorkspaceView,
  selectWorkspaceView,
  splitWorkspaceView,
  toggleWorkspaceExpansion,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  combineWorkspaceGroups,
} from "../lib/workspaceViews";
import {
  nativeWorkspaceWindow,
  detachedSessionIds,
  detachedTerminalIds,
  detachedSurfaceIds,
  openDetachedFileForSession,
  type DetachedFileRequest,
  type DetachedWorkspaceState,
  type DetachedWorkspaceSnapshot,
} from "../lib/detachedWorkspaces";
import {
  applySessionPipTheme,
  SESSION_PIP_CALLBACKS,
  type SessionPaneProps,
} from "../lib/sessionPictureInPicture";
import { prepareSessionPipViewMetadata } from "../lib/sessionPipViewMetadata";
import {
  flushComposerDrafts,
  readComposerDraft,
  restoreComposerDraft,
  subscribeComposerDrafts,
} from "../lib/composerDrafts";
import {
  captureEditorDrafts,
  captureTerminalScreens,
  restoreEditorDrafts,
  restoreTerminalScreens,
  subscribeEditorDrafts,
} from "../lib/workspaceTransfers";
import "./DetachedWorkspace.css";
import type { EditorNavigation, EditorNavigationTarget } from "../lib/search";

/** A renderer, never an App: every agent action returns to the one owner. */
export function DetachedWorkspace() {
  const [envelope, setEnvelope] = useState<DetachedWorkspaceSnapshot | null>(
    null,
  );
  const current = useRef(envelope);
  current.current = envelope;
  const [error, setError] = useState<string | null>(null);
  const [editorNavigation, setEditorNavigation] =
    useState<EditorNavigationTarget | null>(null);
  const editorNavigationToken = useRef(0);
  // Incoming state applies its parent theme before this content commit.
  useBootSplashReady(!!envelope || !!error);
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const visibilityKey = useRef("");
  const [focused, setFocused] = useState(false);
  // WK document visibility is useful for notification read state, but native
  // Chromium can occlude WK. It must never collapse this window's layout.
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const stageHost = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    id: string;
    target: WorkspaceSurfaceDropTarget | null;
  } | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    target: WorkspaceSurfaceDropTarget | null;
  } | null>(null);
  const [readyNatives, setReadyNatives] = useState<Set<string>>(new Set());
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const leaving = useRef(false);
  const report = useCallback(
    (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    [],
  );
  const collect = useCallback(() => {
    const state = current.current?.state;
    if (!state) return null;
    flushComposerDrafts();
    return {
      ...state,
      drafts: Object.fromEntries(
        detachedSessionIds(state).flatMap((id) => {
          const draft = readComposerDraft(id);
          return draft ? [[id, draft]] : [];
        }),
      ),
      editorDrafts: captureEditorDrafts(
        new Set(
          state.tabs.flatMap((t) =>
            [...t.editorPanes, ...t.terminalPanes].flatMap((p) =>
              p.files.map((f) => f.path),
            ),
          ),
        ),
      ),
      terminalScreens: captureTerminalScreens(detachedTerminalIds(state)),
    };
  }, []);
  const checkpoint = useCallback(async () => {
    clearTimeout(checkpointTimer.current);
    checkpointTimer.current = undefined;
    const state = collect();
    if (state) await nativeWorkspaceWindow.checkpoint(state);
  }, [collect]);
  const scheduleCheckpoint = useCallback(() => {
    if (checkpointTimer.current) return;
    checkpointTimer.current = setTimeout(() => {
      checkpointTimer.current = undefined;
      void checkpoint().catch(report);
    }, 150);
  }, [checkpoint, report]);
  const change = useCallback(
    (update: (state: DetachedWorkspaceState) => DetachedWorkspaceState) => {
      const e = current.current;
      if (!e) return;
      const next = { ...e, state: update(e.state) };
      current.current = next;
      setEnvelope(next);
      scheduleCheckpoint();
    },
    [scheduleCheckpoint],
  );
  const leave = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    flushSync(() => setFrozen(true));
    try {
      await checkpoint();
      await nativeWorkspaceWindow.return();
    } catch (reason) {
      report(reason);
      leaving.current = false;
      setFrozen(false);
    }
  }, [checkpoint, report]);
  const returnSelection = useCallback(
    async (ids: string[]) => {
      if (leaving.current) return;
      const before = current.current?.state;
      if (!before) return;
      if (ids.length === detachedSurfaceIds(before).length) {
        await leave();
        return;
      }
      leaving.current = true;
      flushSync(() => setFrozen(true));
      try {
        await checkpoint();
        const state = collect();
        if (!state) return;
        const chosen = new Set(ids),
          other = detachedSurfaceIds(state).filter((id) => !chosen.has(id));
        const subset = (ids: string[]): DetachedWorkspaceState => {
          const allowed = new Set(ids);
          const tabs = state.tabs.filter((t) => allowed.has(t.id));
          const sessions = new Set(tabs.flatMap((t) => leafIds(t.layout)));
          return {
            ...state,
            tabs,
            browsers: state.browsers.filter((b) => allowed.has(b.id)),
            sessions: state.sessions.filter((s) => sessions.has(s.session.id)),
            view: selectWorkspaceArrangement(state.view, ids),
            originalSurfaceIds: ids,
            closedSurfaceIds: [],
          };
        };
        const selected = subset(ids),
          remaining = {
            ...subset(other),
            closedSurfaceIds: state.closedSurfaceIds,
          };
        await nativeWorkspaceWindow.returnSelection(selected, remaining);
        change((latest) => {
          const sessionIds = new Set(
            remaining.sessions.map((s) => s.session.id),
          );
          return {
            ...remaining,
            sessions: latest.sessions.filter((s) =>
              sessionIds.has(s.session.id),
            ),
            theme: latest.theme,
          };
        });
      } catch (reason) {
        report(reason);
      } finally {
        leaving.current = false;
        setFrozen(false);
      }
    },
    [leave, checkpoint, collect, change, report],
  );
  const openFile = useCallback(
    (
      path: string,
      options: Partial<FilePaneTab> = {},
      navigation?: EditorNavigation,
    ) => {
      change((state) => {
        const active =
          state.tabs.find((t) => t.id === state.view.focusedId) ??
          state.tabs[0];
        const activeSession = state.sessions.find(
          (s) => s.session.id === active?.focusedId,
        )?.session;
        const file = {
          ...newFileTab(
            path,
            activeSession ? sessionWorkCwd(activeSession) : state.cwd,
          ),
          ...options,
        };
        if (active) {
          const pane =
            active.editorPanes.find((p) => p.id === active.focusedId) ??
            active.editorPanes[0];
          const existing = pane?.files.find(
            (f) =>
              f.path === file.path &&
              !f.review &&
              !f.plan &&
              !f.terminal &&
              !Object.keys(options).length,
          );
          const nextPane: EditorPane = pane
            ? {
                ...pane,
                files: existing ? pane.files : [...pane.files, file],
                activeFileId: existing?.id ?? file.id,
              }
            : { id: crypto.randomUUID(), files: [file], activeFileId: file.id };
          const tab = {
            ...active,
            focusedId: nextPane.id,
            editorPanes: pane
              ? active.editorPanes.map((p) => (p.id === pane.id ? nextPane : p))
              : [...active.editorPanes, nextPane],
            layout: pane
              ? active.layout
              : placePane(
                  active.layout,
                  nextPane.id,
                  active.focusedId,
                  "right",
                ),
          };
          return {
            ...state,
            tabs: state.tabs.map((t) => (t.id === active.id ? tab : t)),
            view: selectWorkspaceView(state.view, active.id),
          };
        }
        const pane = {
          id: crypto.randomUUID(),
          files: [file],
          activeFileId: file.id,
        };
        const tab: WorkspaceTab = {
          id: crypto.randomUUID(),
          kind: "session",
          layout: leaf(pane.id),
          focusedId: pane.id,
          editorPanes: [pane],
          terminalPanes: [],
        };
        const ids = [...detachedSurfaceIds(state), tab.id];
        return {
          ...state,
          tabs: [...state.tabs, tab],
          view: selectWorkspaceView(
            resolveWorkspaceView(state.view, ids, state.view.focusedId),
            tab.id,
          ),
        };
      });
      if (navigation) {
        editorNavigationToken.current += 1;
        setEditorNavigation({
          path,
          ...navigation,
          token: editorNavigationToken.current,
        });
      }
    },
    [change],
  );
  const openUrl = useCallback(
    (url: string) => {
      change((state) => {
        const existing = state.browsers.find((b) => b.url === url);
        if (existing)
          return {
            ...state,
            view: selectWorkspaceView(state.view, existing.id),
          };
        const tabId = crypto.randomUUID();
        const browser = {
          id: browserIdForTab(state.cwd, tabId),
          tabId,
          url,
          project: state.cwd,
        };
        const ids = [...detachedSurfaceIds(state), browser.id];
        return {
          ...state,
          browsers: [...state.browsers, browser],
          view: selectWorkspaceView(
            resolveWorkspaceView(state.view, ids, state.view.focusedId),
            browser.id,
          ),
        };
      });
    },
    [change],
  );
  const openUrlRef = useRef(openUrl);
  openUrlRef.current = openUrl;
  const closeSurface = useCallback(
    async (id: string) => {
      const state = current.current?.state;
      if (!state) return;
      const tab = state.tabs.find((t) => t.id === id);
      const dirty = new Set(state.dirtyFileIds ?? []);
      const files = tab
        ? [...tab.editorPanes, ...tab.terminalPanes].flatMap((p) => p.files)
        : [];
      if (
        files.some((f) => dirty.has(f.id)) &&
        !(await ask("Close this tab with unsaved file edits?", {
          title: "Aven",
          kind: "warning",
        }))
      )
        return;
      if (!(await confirmCloseTerminals(files))) return;
      discardEditorDrafts(files.filter((file) => !file.terminal));
      const browser = state.browsers.find((b) => b.id === id);
      if (browser?.nativeId) await nativeBrowser.close(browser.nativeId);
      await Promise.all(
        files.filter((f) => f.terminal).map((f) => killPty(f.id)),
      );
      change((s) => ({
        ...s,
        tabs: s.tabs.filter((t) => t.id !== id),
        browsers: s.browsers.filter((b) => b.id !== id),
        closedSurfaceIds: [...new Set([...(s.closedSurfaceIds ?? []), id])],
        view: closeWorkspaceViews(
          s.view,
          [id],
          s.view.order.find((other) => other !== id) ?? "",
        ),
      }));
    },
    [change],
  );
  const closeLeaf = useCallback(
    (tabId: string, paneId: string) => {
      const tab = current.current?.state.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const layout = removePane(tab.layout, paneId);
      if (!layout) {
        void closeSurface(tabId).catch(report);
        return;
      }
      change((s) => ({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                layout,
                focusedId:
                  t.focusedId === paneId ? leafIds(layout)[0] : t.focusedId,
                editorPanes: t.editorPanes.filter((p) => p.id !== paneId),
                terminalPanes: t.terminalPanes.filter((p) => p.id !== paneId),
              }
            : t,
        ),
      }));
    },
    [change, closeSurface, report],
  );
  const closeFile = useCallback(
    async (tabId: string, paneId: string, fileId: string) => {
      const state = current.current?.state;
      const tab = state?.tabs.find((t) => t.id === tabId);
      const pane =
        tab &&
        [...tab.editorPanes, ...tab.terminalPanes].find((p) => p.id === paneId);
      const file = pane?.files.find((f) => f.id === fileId);
      if (!file || !pane) return;
      if (
        state?.dirtyFileIds?.includes(fileId) &&
        !(await ask("Close this file with unsaved edits?", {
          title: "Aven",
          kind: "warning",
        }))
      )
        return;
      if (file.terminal) {
        if (!(await confirmCloseTerminal(file))) return;
        await killPty(file.id);
      }
      if (!file.terminal) discardEditorDrafts([file]);
      if (pane.files.length === 1) {
        closeLeaf(tabId, paneId);
        return;
      }
      const update = (p: EditorPane) => {
        if (p.id !== paneId) return p;
        const files = p.files.filter((f) => f.id !== fileId);
        return {
          ...p,
          files,
          activeFileId:
            p.activeFileId === fileId ? files[0].id : p.activeFileId,
        };
      };
      change((s) => ({
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                editorPanes: t.editorPanes.map(update),
                terminalPanes: t.terminalPanes.map(update),
              }
            : t,
        ),
      }));
    },
    [change, closeLeaf],
  );
  useEffect(
    () =>
      installInAppLinks(
        {
          openUrl,
          openFile: (path, navigation) => openFile(path, {}, navigation),
        },
        report,
      ),
    [openUrl, openFile, report],
  );
  useEffect(() => {
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const accept = (next: DetachedWorkspaceSnapshot) => {
      if (disposed || !next.state.transferToken) return;
      const old = current.current;
      // Owner streams replace sessions/theme only. Local UI changes remain
      // authoritative until an explicit append transaction supplies a new token.
      const incoming =
        old && old.state.transferToken === next.state.transferToken
          ? {
              ...next,
              state: {
                ...old.state,
                sessions: next.state.sessions,
                theme: next.state.theme,
              },
            }
          : next;
      restoreEditorDrafts(incoming.state.editorDrafts);
      restoreTerminalScreens(incoming.state.terminalScreens);
      for (const session of incoming.state.sessions) {
        prepareSessionPipViewMetadata(session);
        restoreComposerDraft(
          session.session.id,
          incoming.state.drafts?.[session.session.id] ?? session.draft,
        );
      }
      if (incoming.state.theme) applySessionPipTheme(incoming.state.theme);
      current.current = incoming;
      setEnvelope(incoming);
    };
    void Promise.all([
      nativeWorkspaceWindow.listen<DetachedWorkspaceSnapshot>(
        "workspace-window-state",
        accept,
      ),
      nativeWorkspaceWindow.listen(
        "workspace-window-return-requested",
        () => void leave(),
      ),
      nativeWorkspaceWindow.listen<{ token: string }>(
        "workspace-window-freeze",
        ({ token }) => {
          flushSync(() => setFrozen(true));
          void checkpoint()
            .then(() =>
              nativeWorkspaceWindow.ack(token, collect() ?? undefined),
            )
            .catch((reason) =>
              nativeWorkspaceWindow.ack(token, undefined, String(reason)),
            );
        },
      ),
      nativeWorkspaceWindow.listen("workspace-window-resume", () => {
        leaving.current = false;
        flushSync(() => setFrozen(false));
        window.dispatchEvent(new Event("supermono:browser-layout-reset"));
      }),
      nativeWorkspaceWindow.listen<{
        sessionId?: string;
        url?: string;
        browser?: import("../lib/detachedWorkspaces").DetachedBrowser;
        file?: DetachedFileRequest;
        requestToken?: string;
        expiresAt?: number;
      }>("workspace-window-focus", (value) => {
        if (value.url) openUrlRef.current(value.url);
        if (value.browser)
          change((state) => {
            const browser = value.browser!;
            const exists = state.browsers.some((b) => b.id === browser.id);
            return {
              ...state,
              browsers: exists
                ? state.browsers.map((b) =>
                    b.id === browser.id ? { ...b, url: browser.url } : b,
                  )
                : [...state.browsers, browser],
              view: selectWorkspaceView(
                resolveWorkspaceView(
                  state.view,
                  [
                    ...detachedSurfaceIds(state),
                    ...(exists ? [] : [browser.id]),
                  ],
                  state.view.focusedId,
                ),
                browser.id,
              ),
            };
          });
        if (value.file && value.sessionId) {
          const file = value.file;
          void (async () => {
            try {
              if (value.expiresAt != null && Date.now() >= value.expiresAt)
                throw new Error(
                  "This file request expired. Try opening the file again.",
                );
              if (disposed || frozenRef.current || leaving.current)
                throw new Error(
                  "This task window is moving. Try opening the file again in a moment.",
                );
              const before = current.current?.state;
              if (!before) throw new Error("The task window is not ready.");
              const next = openDetachedFileForSession(
                before,
                value.sessionId!,
                file.path,
              );
              if (next === before)
                throw new Error("The task is no longer in this window.");
              flushSync(() => {
                change(() => next);
                if (file.line) {
                  editorNavigationToken.current += 1;
                  setEditorNavigation({
                    path: file.path,
                    line: file.line,
                    column: file.column,
                    token: editorNavigationToken.current,
                  });
                }
              });
              await checkpoint();
              if (value.expiresAt != null && Date.now() >= value.expiresAt)
                throw new Error(
                  "This file request expired while the task window was responding.",
                );
              if (disposed || frozenRef.current || leaving.current)
                throw new Error(
                  "The task window changed while opening the file. Try again.",
                );
              // No state payload: a file acknowledgement must not hide Chromium
              // using the workspace transfer acknowledgement's state side effect.
              if (value.requestToken)
                await nativeWorkspaceWindow.ack(value.requestToken);
            } catch (reason) {
              if (value.requestToken)
                await nativeWorkspaceWindow
                  .ack(value.requestToken, undefined, String(reason))
                  .catch(report);
              else report(reason);
            }
          })();
        }
        if (value.sessionId && !value.url && !value.browser && !value.file)
          change((state) => {
            const tab = state.tabs.find((t) =>
              leafIds(t.layout).includes(value.sessionId!),
            );
            return tab
              ? {
                  ...state,
                  tabs: state.tabs.map((t) =>
                    t.id === tab.id ? { ...t, focusedId: value.sessionId! } : t,
                  ),
                  view: selectWorkspaceView(state.view, tab.id),
                }
              : state;
          });
      }),
      getCurrentWindow().onFocusChanged(({ payload }) => setFocused(payload)),
    ])
      .then(async (callbacks) => {
        if (disposed) {
          callbacks.forEach((fn) => fn());
          return;
        }
        cleanup.push(...callbacks);
        accept(await nativeWorkspaceWindow.getState());
        setFocused(await getCurrentWindow().isFocused());
      })
      .catch(report);
    const visibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    cleanup.push(() =>
      document.removeEventListener("visibilitychange", visibility),
    );
    cleanup.push(
      subscribeComposerDrafts(scheduleCheckpoint),
      subscribeEditorDrafts(scheduleCheckpoint),
    );
    return () => {
      disposed = true;
      clearTimeout(checkpointTimer.current);
      cleanup.forEach((fn) => fn());
    };
  }, [leave, report, scheduleCheckpoint, change, checkpoint, collect]);
  useEffect(() => {
    const state = envelope?.state;
    const token = state?.transferToken;
    if (
      !token ||
      !state ||
      state.browsers.some((b) => b.nativeId && !readyNatives.has(b.nativeId))
    )
      return;
    // useEffect runs after the React commit. The native window stays hidden
    // until this acknowledgement, so a paint-frame gate would deadlock on macOS.
    void nativeWorkspaceWindow.ready(token).catch(report);
  }, [envelope?.state.transferToken, readyNatives, report]);
  useEffect(() => {
    const state = envelope?.state;
    if (!state) return;
    const active = new Set(state.view.layout ? leafIds(state.view.layout) : []);
    const ids =
      focused && documentVisible
        ? state.tabs
            .filter((t) => active.has(t.id))
            .flatMap((t) => leafIds(t.layout))
            .filter((id) => state.sessions.some((s) => s.session.id === id))
        : [];
    const key = ids.join("\0");
    if (visibilityKey.current === key) return;
    visibilityKey.current = key;
    void nativeWorkspaceWindow.visibility(ids).catch(report);
  }, [
    focused,
    documentVisible,
    envelope?.state.view,
    envelope?.state.tabs,
    envelope?.state.sessions,
    report,
  ]);
  if (!envelope)
    return (
      <main className="detached-workspace">
        <p>{error ?? "Opening workspace…"}</p>
      </main>
    );
  const { state } = envelope;
  const updateTab = (id: string, fn: (tab: WorkspaceTab) => WorkspaceTab) =>
    change((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === id ? fn(t) : t)),
    }));
  const updateFilePane = (
    tab: WorkspaceTab,
    paneId: string,
    fn: (pane: EditorPane) => EditorPane,
  ) =>
    updateTab(tab.id, (t) => ({
      ...t,
      editorPanes: t.editorPanes.map((p) => (p.id === paneId ? fn(p) : p)),
      terminalPanes: t.terminalPanes.map((p) => (p.id === paneId ? fn(p) : p)),
    }));
  const action = (id: string, name: string, args: unknown[]) =>
    void nativeWorkspaceWindow.action(id, name, args).catch(report);
  const active = new Set(state.view.layout ? leafIds(state.view.layout) : []);
  const titleTabs: Tab[] = state.tabs.map((tab) => {
    const ids = leafIds(tab.layout);
    const sessions = state.sessions
      .filter((s) => ids.includes(s.session.id))
      .map((s) => s.session);
    const focused = sessions.find((s) => s.id === tab.focusedId) ?? sessions[0];
    const files = [...tab.editorPanes, ...tab.terminalPanes].flatMap(
      (p) => p.files,
    );
    return {
      id: tab.id,
      project: state.cwd.split("/").pop() ?? state.cwd,
      projectPath: state.cwd,
      title: focused?.title ?? "",
      more: sessions.filter((s) => s.id !== focused?.id).map((s) => s.title),
      sessionCount: sessions.length,
      harnesses: [...new Set(sessions.map((s) => s.harness))],
      busyHarnesses: [
        ...new Set(sessions.filter((s) => s.busy).map((s) => s.harness)),
      ],
      models: sessions.map(sessionModelIdentity),
      files: files.map(
        (f) => f.plan?.title ?? f.path.split("/").pop() ?? f.path,
      ),
      multiPane: ids.length > 1,
      fileFocused: !sessions.some((s) => s.id === tab.focusedId),
      terminal: !sessions.length && files.some((f) => f.terminal),
      dirty: files.some((f) => state.dirtyFileIds?.includes(f.id)),
      groupId: tab.groupId,
    };
  });
  const dragMove = (id: string, x: number, y: number) => {
    const stage = stageHost.current?.querySelector<HTMLElement>(
      ":scope > [data-workspace-stage]",
    );
    const target = stage
      ? workspaceSurfaceDropAt(stage, x, y, id, dragRef.current?.target)
      : null;
    dragRef.current = { id, target };
    setDrag({ id, target });
  };
  const dragEnd = (id: string, _x: number, _y: number, cancelled: boolean) => {
    const target = dragRef.current?.target;
    dragRef.current = null;
    setDrag(null);
    if (cancelled || !target) return false;
    change((s) => ({
      ...s,
      view:
        target.edge === "tab"
          ? moveWorkspaceTab(s.view, id, target.id, target.index)
          : splitWorkspaceView(s.view, id, target.edge, target.id),
    }));
    return true;
  };
  const headers = Object.entries(state.view.groups).map(([id, members]) => ({
    id,
    content: (
      <TitleBar
        paneLocal
        paneFocused={state.view.focusedId === id}
        tabs={titleTabs.filter((t) => members.includes(t.id))}
        activeId={id}
        cwd={state.cwd}
        browserOpen={state.browsers.some((b) => members.includes(b.id))}
        browserActive={state.browsers.some((b) => b.id === id)}
        browserTabs={state.browsers
          .filter((b) => members.includes(b.id))
          .map((b) => ({
            id: b.id,
            title: b.title || "Browser",
            favicon: b.favicon,
          }))}
        surfaceOrder={members}
        visibleIds={active.size > 1 ? [id] : []}
        groupId={id}
        groupLabel={state.title}
        onToggleSidebar={() => {}}
        onSelect={(selected) =>
          change((s) => ({ ...s, view: selectWorkspaceView(s.view, selected) }))
        }
        onSelectBrowser={(selected) => {
          if (selected)
            change((s) => ({
              ...s,
              view: selectWorkspaceView(s.view, selected),
            }));
        }}
        onClose={(selected) => void closeSurface(selected).catch(report)}
        onCloseBrowser={(selected) => {
          if (selected) void closeSurface(selected).catch(report);
        }}
        onCloseMany={(ids) =>
          void (async () => {
            for (const id of ids) await closeSurface(id);
          })().catch(report)
        }
        onReorder={(ids) =>
          change((s) => ({
            ...s,
            view: reorderWorkspaceGroup(s.view, id, ids),
          }))
        }
        onReorderSurfaces={(ids) =>
          change((s) => ({
            ...s,
            view: reorderWorkspaceGroup(s.view, id, ids),
          }))
        }
        onSplitTab={(selected, edge, target) =>
          change((s) => ({
            ...s,
            view: splitWorkspaceView(s.view, selected, edge, target ?? id),
          }))
        }
        onNewView={(selected) =>
          change((s) => ({
            ...s,
            view: splitWorkspaceView(s.view, selected, "right", id),
          }))
        }
        onSurfaceDragMove={dragMove}
        onSurfaceDragEnd={dragEnd}
        combineTargets={Object.keys(state.view.groups)
          .filter((other) => other !== id)
          .map((other) => ({
            id: other,
            label:
              state.browsers.find((b) => b.id === other)?.title ??
              titleTabs.find((t) => t.id === other)?.title ??
              "Tab group",
          }))}
        onCombineWith={(target) =>
          change((s) => ({
            ...s,
            view: combineWorkspaceGroups(s.view, id, target),
          }))
        }
        onReturnTabToWindow={(selected) => void returnSelection([selected])}
        onReturnGroupToWindow={() => void returnSelection(members)}
        onNew={() => void nativeWorkspaceWindow.newSession().catch(report)}
        onNewBrowser={() => openUrl("")}
        onGroupPictureInPicture={() =>
          void nativeWorkspaceWindow.pinned(true).catch(report)
        }
      />
    ),
  }));
  const surfaces = [
    ...state.browsers.map((browser) => ({
      id: browser.id,
      content: (
        <BrowserPane
          id={browser.id}
          attachedNativeId={browser.nativeId}
          initialUrl={browser.url}
          visible={active.has(browser.id) && !frozen}
          onClose={() => void closeSurface(browser.id).catch(report)}
          onFocus={() =>
            change((s) => ({
              ...s,
              view: selectWorkspaceView(s.view, browser.id),
            }))
          }
          onNativeReady={(nativeId) => {
            setReadyNatives((set) =>
              set.has(nativeId) ? set : new Set([...set, nativeId]),
            );
            if (
              current.current?.state.browsers.find((b) => b.id === browser.id)
                ?.nativeId !== nativeId
            )
              change((s) => ({
                ...s,
                browsers: s.browsers.map((b) =>
                  b.id === browser.id ? { ...b, nativeId } : b,
                ),
              }));
          }}
          onUrlChange={(url) =>
            change((s) => ({
              ...s,
              browsers: s.browsers.map((b) =>
                b.id === browser.id ? { ...b, url } : b,
              ),
            }))
          }
          onTitleChange={(title) =>
            change((s) => ({
              ...s,
              browsers: s.browsers.map((b) =>
                b.id === browser.id ? { ...b, title } : b,
              ),
            }))
          }
          onFaviconChange={(favicon) =>
            change((s) => ({
              ...s,
              browsers: s.browsers.map((b) =>
                b.id === browser.id ? { ...b, favicon } : b,
              ),
            }))
          }
          expanded={!!state.view.restoreView}
          onToggleExpand={() =>
            change((s) => ({
              ...s,
              view: toggleWorkspaceExpansion(s.view, browser.id),
            }))
          }
        />
      ),
    })),
    ...state.tabs.map((tab) => ({
      id: tab.id,
      content: (
        <WorkspaceStage
          layout={tab.layout}
          focusedId={tab.focusedId}
          visible={active.has(tab.id)}
          onFocus={(id) => updateTab(tab.id, (t) => ({ ...t, focusedId: id }))}
          onLayoutChange={(layout) =>
            updateTab(tab.id, (t) => ({ ...t, layout }))
          }
          dragging={false}
          dragTarget={null}
          surfaces={leafIds(tab.layout).flatMap((id) => {
            const session = state.sessions.find((s) => s.session.id === id);
            if (session) {
              const callbacks = Object.fromEntries(
                SESSION_PIP_CALLBACKS.filter((name) =>
                  session.actions?.includes(name),
                ).map((name) => [
                  name,
                  (...args: unknown[]) => {
                    action(id, name, args);
                    return name === "onCompactContext" ? true : undefined;
                  },
                ]),
              ) as Partial<SessionPaneProps>;
              const props = {
                ...callbacks,
                session: session.session,
                recents: session.recents,
                hideProjectPicker: session.hideProjectPicker,
                reviewUndoLocked: session.reviewUndoLocked,
                visible: active.has(tab.id),
                focused:
                  tab.focusedId === id && state.view.focusedId === tab.id,
                composerFocused: focused,
                inSplit: leafIds(tab.layout).length > 1,
                onFocus: () =>
                  updateTab(tab.id, (t) => ({ ...t, focusedId: id })),
                onClose: () => closeLeaf(tab.id, id),
                onOpenFile: (path: string, navigation?: EditorNavigation) =>
                  openFile(path, {}, navigation),
                onOpenUrl: openUrl,
                onOpenDiff: (path?: string) =>
                  openFile(path ?? session.session.cwd, {
                    review: true,
                    changes: !path,
                  }),
                onOpenPlan: (sessionId: string, blockId: string) =>
                  openFile("Plan", {
                    plan: { sessionId, blockId, title: "Plan" },
                  }),
                onNewTerminal: () =>
                  openFile("Terminal", {
                    terminal: true,
                    cwd: sessionWorkCwd(session.session),
                  }),
              } as SessionPaneProps;
              return [{ id, content: <SessionPane {...props} /> }];
            }
            const pane = [...tab.editorPanes, ...tab.terminalPanes].find(
              (p) => p.id === id,
            );
            if (!pane) return [];
            const props: ComponentProps<typeof FilePane> = {
              pane,
              focused: tab.focusedId === id,
              dirtyFileIds: new Set(state.dirtyFileIds ?? []),
              fileErrorCounts: new Map(),
              editorNavigation,
              sessions: state.sessions.map((s) => s.session),
              onFocus: () =>
                updateTab(tab.id, (t) => ({ ...t, focusedId: id })),
              onSelectFile: (_, fileId) =>
                updateFilePane(tab, id, (p) => ({
                  ...p,
                  activeFileId: fileId,
                })),
              onCloseFile: (_, fileId) => {
                void closeFile(tab.id, id, fileId).catch(report);
              },
              onReorderFiles: (_, ids) =>
                updateFilePane(tab, id, (p) => ({
                  ...p,
                  files: ids.flatMap((fid) =>
                    p.files.filter((f) => f.id === fid),
                  ),
                })),
              onDirtyChange: (fileId, dirty) =>
                change((s) => ({
                  ...s,
                  dirtyFileIds: dirty
                    ? [...new Set([...(s.dirtyFileIds ?? []), fileId])]
                    : (s.dirtyFileIds ?? []).filter((id) => id !== fileId),
                })),
              onErrorCountChange: () => {},
              onOpenFile: (path: string, navigation?: EditorNavigation) =>
                openFile(path, {}, navigation),
              onUpdatePlan: (sessionId, blockId, text) =>
                action(sessionId, "onUpdatePlan", [sessionId, blockId, text]),
              onBuildPlan: (sessionId, blockId, target) =>
                action(sessionId, "onBuildPlan", [sessionId, blockId, target]),
              onTerminalMetaChange: (fileId, patch) =>
                updateFilePane(tab, id, (p) => ({
                  ...p,
                  files: p.files.map((f) =>
                    f.id === fileId
                      ? {
                          ...f,
                          ...patch,
                          foreground: patch.foreground ?? undefined,
                        }
                      : f,
                  ),
                })),
            };
            return [{ id, content: <FilePane {...props} /> }];
          })}
        />
      ),
    })),
  ];
  return (
    <main
      ref={stageHost}
      className="detached-workspace"
      inert={frozen}
      aria-busy={frozen}
    >
      <header
        className="detached-workspace-toolbar"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && event.button === 0)
            void getCurrentWindow().startDragging();
        }}
      >
        <span>{state.title}</span>
        <div className="detached-workspace-toolbar-actions">
          <button onClick={() => openUrl("")} title="New browser tab">
            ＋ Browser
          </button>
          <button
            onClick={() => void nativeWorkspaceWindow.recover().catch(report)}
            title="Move this window onto a connected display"
          >
            Recover position
          </button>
          <button
            aria-pressed={envelope.pinned}
            onClick={() =>
              void nativeWorkspaceWindow.pinned(!envelope.pinned).catch(report)
            }
          >
            Keep on top
          </button>
          <button onClick={() => void leave()}>Return to workspace</button>
        </div>
      </header>
      {error && (
        <div role="alert" className="detached-workspace-error">
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {state.view.layout ? (
        <WorkspaceStage
          layout={state.view.layout}
          focusedId={state.view.focusedId}
          visible={true}
          surfaces={surfaces}
          onFocus={(id) =>
            change((s) => ({ ...s, view: selectWorkspaceView(s.view, id) }))
          }
          onLayoutChange={(layout) =>
            change((s) => ({ ...s, view: { ...s.view, layout } }))
          }
          dragTarget={drag?.target ?? null}
          dragging={!!drag}
          headers={headers}
        />
      ) : (
        <div className="detached-workspace-empty">
          <p>This window has no open tabs.</p>
          <button onClick={() => openUrl("")}>New browser tab</button>
          <button onClick={() => void leave()}>Return to workspace</button>
        </div>
      )}
    </main>
  );
}
