// @vitest-environment happy-dom
import { act, createElement, StrictMode, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, leafIds, type WorkspaceTab } from "./layout";
import { minimizeWorkspaceSide, resolveWorkspaceView } from "./workspaceViews";
import { browserIdForTab } from "./personalWorkspace";
import { captureWorkspaceReturnPlacement } from "./workspaceArrangement";
import {
  mergeDetachedWorkspaces,
  mergeDetachedSessionUpdate,
  nativeWorkspaceWindow,
  openDetachedFileForSession,
  useDetachedWorkspaces,
  type DetachedWorkspaceState,
  type DetachedWorkspaceSnapshot,
} from "./detachedWorkspaces";
import type { Session } from "./session";
import { registerAgentBrowserPage } from "./agentBrowser";
import {
  browserIsTransferred,
  retainTransferredBrowser,
} from "./workspaceTransfers";
vi.mock("./appLifecycle", () => ({ handleQuitRequested: vi.fn() }));
const session = (id: string): Session => ({
  id,
  title: id,
  harness: "codex",
  model: "gpt-5",
  modelSettings: {},
  runtimeMode: "full-access",
  cwd: "/project",
  blocks: [],
});
function state(id: string): DetachedWorkspaceState {
  const tab: WorkspaceTab = {
    id: `tab-${id}`,
    kind: "session",
    layout: leaf(id),
    focusedId: id,
    editorPanes: [],
    terminalPanes: [],
  };
  return {
    title: id,
    cwd: "/project",
    tabs: [tab],
    browsers: [],
    sessions: [{ session: session(id), recents: [] }],
    view: resolveWorkspaceView(undefined, [tab.id], tab.id),
  };
}
describe("detached workspace transactions", () => {
  let root: Root,
    host: HTMLDivElement,
    api: ReturnType<typeof useDetachedWorkspaces>;
  let listeners: Map<string, (payload: any) => void>,
    sessions: Session[],
    returned: (state: DetachedWorkspaceState) => void | Promise<void>;
  const recents: [] = [];
  const onError = vi.fn();
  const checkpointed = vi.fn();
  const pageCleanups: Array<() => void> = [];
  const retainedIds = [
    "native-live-group",
    "native-explicit-group",
    "native-failed-group",
  ];
  function Harness() {
    api = useDetachedWorkspaces({
      sessions,
      sessionProps: { recents, onSubmit: () => {} },
      onReturned: (state) => returned(state),
      onCheckpoint: checkpointed,
      onError,
    });
    return null;
  }
  const render = () => act(async () => root.render(createElement(Harness)));
  it("routes file requests to the detached task owner and leaves parent-owned tasks alone", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    await expect(
      api.openFileForSession("a", "/project/readme.md", {
        line: 12,
        column: 3,
      }),
    ).resolves.toBe(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith(
      "window-a",
      "a",
      undefined,
      undefined,
      {
        path: "/project/readme.md",
        line: 12,
        column: 3,
      },
      false,
    );
    await expect(
      api.openFileForSession("b", "/project/readme.md"),
    ).resolves.toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    focus.mockRejectedValue(new Error("Workspace window closed"));
    await expect(
      api.openFileForSession("a", "/project/readme.md"),
    ).rejects.toThrow("Workspace window closed");
  });
  it("reuses the detached window's matching browser without changing its URL or native identity", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    const existing = {
      id: "browser-existing",
      tabId: "existing",
      url: "https://EXAMPLE.com:443/mock?layout=wide#review",
      nativeId: "native-existing",
    };
    entry.state.browsers = [existing];
    const other = { id: "window-b", state: state("b"), pinned: false };
    other.state.browsers = [{ ...existing, id: "other-window-browser" }];
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([other, entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();

    await expect(
      api.openForSession("a", "https://example.com/mock?layout=wide#review"),
    ).resolves.toBe(existing.id);
    expect(focus).toHaveBeenCalledExactlyOnceWith(
      "window-a",
      "a",
      undefined,
      existing,
      undefined,
      false,
    );
    await expect(
      api.openForSession("parent-owned", existing.url),
    ).resolves.toBeNull();
    expect(focus).toHaveBeenCalledOnce();
  });
  it("keeps URL reuse and pending opens within each task's project in a mixed detached window", async () => {
    const mixed = mergeDetachedWorkspaces(state("a"), state("b"));
    mixed.sessions[1].session.cwd = "/another-project";
    const local = {
      id: "local-browser",
      tabId: "local",
      url: "https://example.com/mock",
    };
    const other = {
      ...local,
      id: "other-browser",
      tabId: "other",
      project: "/another-project",
    };
    mixed.browsers = [other, local];
    const entry = { id: "mixed-window", state: mixed, pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    await expect(api.openForSession("a", local.url)).resolves.toBe(local.id);
    await expect(api.openForSession("b", local.url)).resolves.toBe(other.id);
    expect(focus.mock.calls.map((call) => call[3]?.id)).toEqual([
      local.id,
      other.id,
    ]);
    let first!: Promise<string | null>,
      second!: Promise<string | null>,
      repeated!: Promise<string | null>;
    await act(async () => {
      first = api.openForSession("a", "https://example.com/new");
      second = api.openForSession("b", "https://example.com/new");
      repeated = api.openForSession("b", "https://example.com/new");
    });
    const browsers = focus.mock.calls.slice(2).map((call) => call[3]!);
    expect(browsers).toHaveLength(2);
    expect(browsers.map((browser) => browser.project)).toEqual([
      "/project",
      "/another-project",
    ]);
    for (const browser of browsers)
      expect(browser.id).toBe(browserIdForTab(browser.project!, browser.tabId));
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...mixed, browsers: [...mixed.browsers, ...browsers] },
      }),
    );
    await expect(Promise.all([first, second, repeated])).resolves.toEqual([
      browsers[0].id,
      browsers[1].id,
      browsers[1].id,
    ]);
  });
  it("focuses an exact browser-only detached surface without choosing another tab with the same URL", async () => {
    const first = {
      id: "browser-first",
      tabId: "first",
      url: "https://example.com/mock",
      nativeId: "native-first",
    };
    const second = {
      ...first,
      id: "browser-second",
      tabId: "second",
      nativeId: "native-second",
    };
    const entry = {
      id: "browser-only",
      state: {
        ...state("a"),
        sessions: [],
        tabs: [],
        browsers: [first, second],
      },
      pinned: false,
    };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    await expect(api.focusBrowser(second.id)).resolves.toBe(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith(
      entry.id,
      undefined,
      undefined,
      second,
      undefined,
      false,
    );
    await expect(api.focusBrowser("missing-browser")).resolves.toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    const returning = api.returnWindow(entry.id);
    await expect(api.focusBrowser(second.id)).rejects.toThrow(
      "moving between windows",
    );
    expect(focus).toHaveBeenCalledOnce();
    await act(async () => listeners.get("workspace-window-returned")!(entry));
    await returning;
    await expect(api.focusBrowser(second.id)).resolves.toBe(false);
  });
  it("coalesces browser opens until a checkpoint confirms the new tab", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    let first!: Promise<string | null>,
      second!: Promise<string | null>,
      later!: Promise<string | null>;
    const finished = vi.fn();
    await act(async () => {
      first = api.openForSession("a", "https://EXAMPLE.com:443/mock");
      second = api.openForSession("a", "https://example.com/mock");
      void first.then(finished);
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(finished).not.toHaveBeenCalled();
    const browser = focus.mock.calls[0][3]!;
    await act(async () => {
      // An unrelated, older checkpoint must not release a still-opening URL.
      listeners.get("workspace-window-checkpoint")!(entry);
      later = api.openForSession("a", "https://example.com/mock");
    });
    expect(focus).toHaveBeenCalledOnce();
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers: [browser] },
      }),
    );
    await expect(Promise.all([first, second, later])).resolves.toEqual([
      browser.id,
      browser.id,
      browser.id,
    ]);
    await expect(
      api.openForSession("a", "https://example.com/mock"),
    ).resolves.toBe(browser.id);
    expect(focus).toHaveBeenCalledTimes(2);
  });
  it("commits the owner's browser scope before a checkpoint-confirmed open resolves", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    let readScope!: () => string[];
    function ScopedOwner() {
      const [browserIds, setBrowserIds] = useState<string[]>([]);
      const browserIdsRef = useRef(browserIds);
      browserIdsRef.current = browserIds;
      readScope = () => browserIdsRef.current;
      api = useDetachedWorkspaces({
        sessions,
        sessionProps: { recents, onSubmit: () => {} },
        onCheckpoint: (checkpoint) => {
          // The owner publishes its scope from a functional state update,
          // just as App merges detached browser checkpoints into its workspace.
          setBrowserIds(() => {
            const next = checkpoint.browsers.map((browser) => browser.id);
            browserIdsRef.current = next;
            return next;
          });
        },
        onReturned: (snapshot) => returned(snapshot),
      });
      return null;
    }
    await act(async () => root.render(createElement(ScopedOwner)));
    let opening!: Promise<string | null>;
    await act(async () => {
      opening = api.openForSession("a", "https://example.com/mock");
    });
    const browser = focus.mock.calls[0][3]!;
    await act(async () => {
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers: [browser] },
      });
      // The browser host checks ownership immediately after open resolves,
      // before an ordinary batched React render can publish the new scope.
      const surfaceId = await opening;
      expect(readScope()).toContain(surfaceId);
    });
  });
  it("creates separate tabs when newTab is requested and preserves distinct URL destinations", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    let opens!: Array<Promise<string | null>>;
    await act(async () => {
      opens = [
        api.openForSession("a", "https://example.com/mock?view=one"),
        api.openForSession("a", "https://example.com/mock?view=one", {
          newTab: true,
        }),
        api.openForSession("a", "https://example.com/mock?view=two"),
        api.openForSession("a", "https://example.com/mock?view=one#details"),
      ];
    });
    const browsers = focus.mock.calls.map((call) => call[3]!);
    expect(browsers).toHaveLength(4);
    expect(new Set(browsers.map((browser) => browser.id)).size).toBe(4);
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers },
      }),
    );
    await expect(Promise.all(opens)).resolves.toEqual(
      browsers.map((browser) => browser.id),
    );
  });
  it("releases failed and timed-out opens so retries do not reuse stale IDs", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockRejectedValueOnce(new Error("Window unavailable"))
      .mockResolvedValue(undefined);
    await render();
    await expect(
      api.openForSession("a", "https://example.com/mock"),
    ).rejects.toThrow("Window unavailable");
    let retry!: Promise<string | null>;
    await act(async () => {
      retry = api.openForSession("a", "https://example.com/mock");
    });
    const timedOut = expect(retry).rejects.toThrow(
      "did not confirm the browser tab",
    );
    await act(async () => vi.advanceTimersByTimeAsync(8000));
    await timedOut;
    let successful!: Promise<string | null>;
    await act(async () => {
      successful = api.openForSession("a", "https://example.com/mock");
    });
    const browsers = focus.mock.calls.map((call) => call[3]!);
    expect(new Set(browsers.map((browser) => browser.id)).size).toBe(3);
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers: [browsers[2]] },
      }),
    );
    await expect(successful).resolves.toBe(browsers[2].id);
  });
  it("forgets closed browser tabs and cancels a close before the opening checkpoint", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    const existing = {
      id: "browser-closed",
      tabId: "closed",
      url: "https://example.com/mock",
    };
    entry.state.browsers = [existing];
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    await expect(api.openForSession("a", existing.url)).resolves.toBe(
      existing.id,
    );
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: {
          ...entry.state,
          browsers: [],
          closedSurfaceIds: [existing.id],
        },
      }),
    );
    let reopened!: Promise<string | null>;
    await act(async () => {
      reopened = api.openForSession("a", existing.url);
    });
    const browser = focus.mock.calls[1][3]!;
    expect(browser.id).not.toBe(existing.id);
    const closed = expect(reopened).rejects.toThrow("browser tab closed");
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: {
          ...entry.state,
          browsers: [],
          closedSurfaceIds: [existing.id, browser.id],
        },
      }),
    );
    await closed;
    let retry!: Promise<string | null>;
    await act(async () => {
      retry = api.openForSession("a", existing.url);
    });
    const latest = focus.mock.calls[2][3]!;
    expect(latest.id).not.toBe(browser.id);
    await act(async () =>
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers: [latest] },
      }),
    );
    await expect(retry).resolves.toBe(latest.id);
  });
  it("requires native focus success even if the browser checkpoint arrives first", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    let rejectFocus!: (reason: Error) => void;
    const focus = vi.spyOn(nativeWorkspaceWindow, "focus").mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectFocus = reject;
        }),
    );
    await render();
    let opening!: Promise<string | null>;
    await act(async () => {
      opening = api.openForSession("a", "https://example.com/mock");
    });
    const browser = focus.mock.calls[0][3]!;
    const failure = expect(opening).rejects.toThrow("Window closed");
    await act(async () => {
      listeners.get("workspace-window-checkpoint")!({
        ...entry,
        state: { ...entry.state, browsers: [browser] },
      });
      rejectFocus(new Error("Window closed"));
    });
    await failure;
  });
  it("cancels unconfirmed opens when their detached window returns", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    vi.spyOn(nativeWorkspaceWindow, "focus").mockResolvedValue(undefined);
    await render();
    let opening!: Promise<string | null>;
    await act(async () => {
      opening = api.openForSession("a", "https://example.com/mock");
    });
    const failure = expect(opening).rejects.toThrow("task window returned");
    await act(async () => listeners.get("workspace-window-returned")!(entry));
    await failure;
    await expect(
      api.openForSession("a", "https://example.com/mock"),
    ).resolves.toBeNull();
  });
  it("rejects browser opens while the detached window is returning", async () => {
    const entry = { id: "window-a", state: state("a"), pinned: false };
    vi.mocked(nativeWorkspaceWindow.list).mockResolvedValue([entry]);
    const focus = vi
      .spyOn(nativeWorkspaceWindow, "focus")
      .mockResolvedValue(undefined);
    await render();
    const returning = api.returnWindow(entry.id);
    await expect(
      api.openForSession("a", "https://example.com/mock"),
    ).rejects.toThrow("moving between windows");
    expect(focus).not.toHaveBeenCalled();
    await act(async () => listeners.get("workspace-window-returned")!(entry));
    await returning;
  });
  it("opens beside the requesting task and reuses its existing editor with drafts preserved", () => {
    const a = state("a"),
      b = state("b");
    const original = mergeDetachedWorkspaces(a, b);
    original.editorDrafts = {
      "/project/readme.md": {
        text: "unsaved",
        baseline: "saved",
        updatedAt: 1,
      },
    };
    const opened = openDetachedFileForSession(
      original,
      "a",
      "/project/readme.md",
    );
    expect(opened.view.focusedId).toBe("tab-a");
    expect(opened.tabs[1]).toBe(original.tabs[1]);
    expect(opened.tabs[0].editorPanes[0].files[0].path).toBe(
      "/project/readme.md",
    );
    expect(opened.editorDrafts).toBe(original.editorDrafts);
    const reopened = openDetachedFileForSession(
      opened,
      "a",
      "/project/readme.md",
    );
    expect(reopened.tabs[0].editorPanes[0].files).toEqual(
      opened.tabs[0].editorPanes[0].files,
    );
    expect(
      openDetachedFileForSession(original, "unknown", "/project/readme.md"),
    ).toBe(original);
  });

  it("prepares an agent file without changing the other chat or its focused pane", () => {
    const original = mergeDetachedWorkspaces(state("a"), state("b"));
    original.view.focusedId = "tab-b";
    const next = openDetachedFileForSession(
      original,
      "a",
      "/project/result.md",
      false,
    );
    expect(next.view).toBe(original.view);
    expect(next.tabs[0].focusedId).toBe("a");
    expect(next.tabs[1]).toBe(original.tabs[1]);
    expect(next.tabs[0].editorPanes[0].files[0].path).toBe(
      "/project/result.md",
    );
  });
  it("rolls back partial listener failure and refuses an unobserved native open", async () => {
    const cleanup = vi.fn();
    let late!: (fn: () => void) => void;
    vi.mocked(nativeWorkspaceWindow.listen)
      .mockResolvedValueOnce(cleanup)
      .mockRejectedValueOnce(new Error("listener setup failed"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve;
          }),
      );
    await render();
    await expect(api.open(state("a"))).rejects.toThrow("listener setup failed");
    await expect(
      api.openForSession("a", "https://example.com"),
    ).rejects.toThrow("listener setup failed");
    await expect(api.focusBrowser("browser")).rejects.toThrow(
      "listener setup failed",
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith("listener setup failed");
    expect(nativeWorkspaceWindow.open).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const releaseLate = vi.fn();
    late(releaseLate);
    await Promise.resolve();
    expect(releaseLate).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    listeners = new Map();
    sessions = [session("a"), session("b")];
    returned = vi.fn();
    onError.mockClear();
    checkpointed.mockClear();
    vi.spyOn(nativeWorkspaceWindow, "listen").mockImplementation(
      async (name, fn) => {
        listeners.set(name, fn);
        return () => {
          if (listeners.get(name) === fn) listeners.delete(name);
        };
      },
    );
    vi.spyOn(nativeWorkspaceWindow, "list").mockResolvedValue([]);
    vi.spyOn(nativeWorkspaceWindow, "open").mockImplementation(
      async (s, target) => ({
        id: target ?? `window-${s.title}`,
        state: s,
        pinned: false,
      }),
    );
    vi.spyOn(nativeWorkspaceWindow, "update").mockResolvedValue(true);
    for (const name of ["ack", "resume", "close"] as const)
      vi.spyOn(nativeWorkspaceWindow, name).mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    pageCleanups.splice(0).forEach((cleanup) => cleanup());
    retainedIds.forEach((id) => retainTransferredBrowser(id, false));
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("keeps the active event bridge ready without reporting StrictMode cleanup", async () => {
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(Harness))),
    );

    expect(nativeWorkspaceWindow.listen).toHaveBeenCalledTimes(10);
    expect(nativeWorkspaceWindow.list).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(5);
    expect(onError).not.toHaveBeenCalled();

    await act(async () => {
      await expect(api.open(state("a"))).resolves.toBe("window-a");
    });
    expect(api.windows).toEqual([{ id: "window-a", label: "a" }]);
    await act(async () => {
      listeners.get("workspace-window-returned")!({
        id: "window-a",
        state: state("a"),
        pinned: false,
        returnToken: "returned-a",
      });
    });
    expect(returned).toHaveBeenCalledOnce();
    expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
      "returned-a",
      state("a"),
    );
    expect(api.windows).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });
  it("ignores a superseded listener failure while the replacement owner remains usable", async () => {
    vi.mocked(nativeWorkspaceWindow.listen).mockRejectedValueOnce(
      new Error("stale listener setup failed"),
    );
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(Harness))),
    );

    expect(onError).not.toHaveBeenCalled();
    expect(listeners.size).toBe(5);
    await act(async () => {
      await expect(api.open(state("b"))).resolves.toBe("window-b");
    });
    expect(api.windows).toEqual([{ id: "window-b", label: "b" }]);
  });
  it("keeps both split arrangements, mixed browser identities, and drafts when combining windows", () => {
    const a = state("a"),
      b = state("b");
    b.browsers = [
      {
        id: "browser-b",
        tabId: "page",
        url: "https://example.com",
        nativeId: "existing-cef",
        kept: true,
      },
    ];
    b.view = resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "b-split",
          dir: "down",
          sizes: [0.25, 0.75],
          children: [leaf("tab-b"), leaf("browser-b")],
        },
        focusedId: "browser-b",
        groups: { "tab-b": ["tab-b"], "browser-b": ["browser-b"] },
        order: ["tab-b", "browser-b"],
      },
      ["tab-b", "browser-b"],
      "browser-b",
    );
    b.editorDrafts = {
      "/project/a.md": { text: "unsaved", baseline: "before", updatedAt: 1 },
    };
    a.returnPlacement = captureWorkspaceReturnPlacement(a.view, a.view.order);
    b.returnPlacement = captureWorkspaceReturnPlacement(b.view, b.view.order);
    const merged = mergeDetachedWorkspaces(a, b);
    expect(merged.returnPlacement).toBeUndefined();
    expect(leafIds(merged.view.layout!)).toEqual([
      "tab-a",
      "tab-b",
      "browser-b",
    ]);
    const mergedLayout = merged.view.layout;
    expect(mergedLayout?.type === "split" && mergedLayout.children[1]).toEqual(
      b.view.layout,
    );
    expect(merged.browsers[0].nativeId).toBe("existing-cef");
    expect(merged.browsers[0].kept).toBe(true);
    expect(merged.editorDrafts).toEqual(b.editorDrafts);
    expect(() =>
      mergeDetachedWorkspaces(a, { ...b, cwd: "/different" }),
    ).toThrow("same project");
  });
  it("keeps minimized tabs in their own panes when combining detached windows", () => {
    const a = state("a"),
      b = state("b");
    a.browsers = [
      {
        id: "browser-a",
        tabId: "page",
        url: "https://example.test",
        nativeId: "retained-page",
      },
    ];
    a.view = resolveWorkspaceView(
      {
        layout: {
          type: "split",
          id: "a-split",
          dir: "right",
          children: [leaf("tab-a"), leaf("browser-a")],
          sizes: [0.4, 0.6],
        },
        order: ["tab-a", "browser-a"],
        focusedId: "browser-a",
        groups: { "tab-a": ["tab-a"], "browser-a": ["browser-a"] },
      },
      ["tab-a", "browser-a"],
      "browser-a",
    );
    a.view = minimizeWorkspaceSide(a.view, "a-split", 0, "before");
    for (const [first, second] of [
      [a, b],
      [b, a],
    ]) {
      const merged = mergeDetachedWorkspaces(first, second);
      expect(leafIds(merged.view.layout!).sort()).toEqual([
        "browser-a",
        "tab-a",
        "tab-b",
      ]);
      expect(merged.view.groups["tab-a"]).toEqual(["tab-a"]);
      expect(merged.view.groups["browser-a"]).toEqual(["browser-a"]);
      expect(merged.browsers[0].nativeId).toBe("retained-page");
      expect(merged.view.hiddenGroups).toBeUndefined();
      expect(merged.view.restoreView).toBeUndefined();
    }
  });
  it("moves a five-browser group immediately, retaining live pages and leaving unvisited URLs for the destination", async () => {
    await render();
    const group = state("browser-group");
    group.tabs = [];
    group.sessions = [];
    group.browsers = Array.from({ length: 5 }, (_, i) => ({
      id: `group-browser-${i}`,
      tabId: `group-page-${i}`,
      url: `https://example.com/page-${i}`,
      ...(i === 0 ? { kept: true } : {}),
      ...(i === 1 ? { nativeId: "native-explicit-group" } : {}),
    }));
    const ids = group.browsers.map((browser) => browser.id);
    group.view = resolveWorkspaceView(
      {
        layout: leaf(ids[0]),
        focusedId: ids[0],
        groups: { [ids[0]]: ids },
        order: ids,
      },
      ids,
      ids[0],
    );
    pageCleanups.push(registerAgentBrowserPage(ids[0], "native-live-group"));
    vi.mocked(nativeWorkspaceWindow.open).mockImplementationOnce(
      async (transferred) => {
        // Retention must precede native open, which may unmount the source pane.
        expect(browserIsTransferred("native-live-group")).toBe(true);
        expect(browserIsTransferred("native-explicit-group")).toBe(true);
        return {
          id: "window-browser-group",
          state: transferred,
          pinned: false,
        };
      },
    );
    const startedAt = Date.now();
    let moving!: Promise<string>;
    await act(async () => {
      moving = api.open(group);
    });
    // Do not advance the fake clock: unopened panes can never register a page.
    expect(nativeWorkspaceWindow.open).toHaveBeenCalledOnce();
    expect(Date.now()).toBe(startedAt);
    await expect(moving).resolves.toBe("window-browser-group");
    expect(nativeWorkspaceWindow.open).toHaveBeenCalledWith(
      expect.objectContaining({
        browsers: group.browsers.map((browser, i) => ({
          ...browser,
          nativeId: i === 0 ? "native-live-group" : browser.nativeId,
        })),
        sessions: [],
        view: group.view,
      }),
      undefined,
      undefined,
    );
  });
  it("releases retained live pages after a failed move without replacing them or waiting for unvisited pages", async () => {
    await render();
    const group = state("failed-browser-group");
    group.browsers = [
      { id: "failed-live", tabId: "live", url: "https://example.com/live" },
      {
        id: "failed-unvisited",
        tabId: "unvisited",
        url: "https://example.com/unvisited",
      },
    ];
    pageCleanups.push(
      registerAgentBrowserPage("failed-live", "native-failed-group"),
    );
    vi.mocked(nativeWorkspaceWindow.open).mockImplementationOnce(async () => {
      expect(browserIsTransferred("native-failed-group")).toBe(true);
      throw new Error("Destination unavailable");
    });
    let moving!: Promise<string>;
    await act(async () => {
      moving = api.open(group);
      void moving.catch(() => {});
    });
    expect(nativeWorkspaceWindow.open).toHaveBeenCalledOnce();
    await expect(moving).rejects.toThrow("Destination unavailable");
    expect(browserIsTransferred("native-failed-group")).toBe(false);
    // A retry keeps the same ready native page; it does not restart that browser.
    await act(async () => {
      await api.open(group);
    });
    expect(nativeWorkspaceWindow.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        browsers: [
          { ...group.browsers[0], nativeId: "native-failed-group" },
          { ...group.browsers[1], nativeId: undefined },
        ],
      }),
      undefined,
      undefined,
    );
  });
  it("does not acknowledge return or drop ownership before the owner restores the view", async () => {
    await render();
    await act(async () => {
      await api.open(state("a"));
    });
    let finish!: () => void;
    returned = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const entry = {
      id: "window-a",
      state: state("a"),
      pinned: false,
      returnToken: "return-1",
    };
    await act(async () => listeners.get("workspace-window-returned")!(entry));
    expect(nativeWorkspaceWindow.ack).not.toHaveBeenCalled();
    expect(api.detachedSurfaceIds.has("tab-a")).toBe(true);
    await act(async () => finish());
    expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
      "return-1",
      entry.state,
    );
    expect(api.detachedSurfaceIds.has("tab-a")).toBe(false);
  });
  it("applies a detached close once across checkpoints and return without changing native snapshots", async () => {
    const initial = state("a");
    initial.browsers = [
      { id: "browser-a", tabId: "page-a", url: "https://example.test" },
    ];
    await render();
    await act(async () => {
      await api.open(initial);
    });
    const closed = {
      ...initial,
      tabs: [],
      browsers: [],
      closedSurfaceIds: ["tab-a", "browser-a"],
    };
    const entry = { id: "window-a", state: closed, pinned: false };
    await act(async () => {
      listeners.get("workspace-window-checkpoint")!(entry);
    });
    expect(checkpointed.mock.calls[0][0].closedSurfaceIds).toEqual([
      "tab-a",
      "browser-a",
    ]);
    await act(async () => {
      listeners.get("workspace-window-checkpoint")!(entry);
    });
    expect(checkpointed.mock.calls[1][0].closedSurfaceIds).toEqual([]);
    expect(api.states.get("window-a")?.closedSurfaceIds).toEqual([
      "tab-a",
      "browser-a",
    ]);
    await act(async () => {
      listeners.get("workspace-window-returned")!({
        ...entry,
        returnToken: "return-closed",
      });
    });
    expect(returned).toHaveBeenCalledExactlyOnceWith({
      ...closed,
      closedSurfaceIds: [],
    });
    expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
      "return-closed",
      closed,
    );
  });
  it("freezes and reads the destination's final checkpoint before appending, rejects overlapping moves", async () => {
    await render();
    await act(async () => {
      await api.open(state("a"));
    });
    const latest = state("a");
    latest.drafts = {
      a: { text: "last keystroke", attachments: [], updatedAt: 9 },
    };
    let thaw!: (value: DetachedWorkspaceSnapshot) => void;
    vi.spyOn(nativeWorkspaceWindow, "freeze").mockImplementation(
      () =>
        new Promise((resolve) => {
          thaw = resolve;
        }),
    );
    let first!: Promise<string>;
    await act(async () => {
      first = api.open(state("b"), "window-a");
    });
    await expect(api.open(state("b"), "window-a")).rejects.toThrow(
      "still moving",
    );
    await act(async () => {
      thaw({ id: "window-a", state: latest, pinned: false });
      await first;
    });
    expect(nativeWorkspaceWindow.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        drafts: expect.objectContaining(latest.drafts),
      }),
      "window-a",
      undefined,
    );
  });
  it("skips unchanged child updates across unrelated main rerenders and preserves child theme", async () => {
    await render();
    await act(async () => {
      await api.open(state("a"));
    });
    await render();
    await act(async () => vi.advanceTimersByTime(110));
    vi.mocked(nativeWorkspaceWindow.update).mockClear();
    await render();
    await act(async () => vi.advanceTimersByTime(110));
    await render();
    await act(async () => vi.advanceTimersByTime(110));
    expect(nativeWorkspaceWindow.update).not.toHaveBeenCalled();
    sessions = [sessions[0], { ...sessions[1], title: "changed elsewhere" }];
    await render();
    await act(async () => vi.advanceTimersByTime(110));
    expect(nativeWorkspaceWindow.update).not.toHaveBeenCalled();
  });
  it("sends only the changed session while the owner document is hidden", async () => {
    await render();
    await act(async () => {
      await api.open(mergeDetachedWorkspaces(state("a"), state("b")));
    });
    await act(async () => vi.advanceTimersByTimeAsync(110));
    vi.mocked(nativeWorkspaceWindow.update).mockClear();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    sessions = [{ ...sessions[0], title: "streamed reply" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledOnce();
    const [, update] = vi.mocked(nativeWorkspaceWindow.update).mock.calls[0];
    expect(update.sessionIds).toEqual(["a", "b"]);
    expect(update.sessions.map((item) => item.session.id)).toEqual(["a"]);
    expect(update.sessions[0].session.title).toBe("streamed reply");
    expect(update).not.toHaveProperty("theme");
  });

  it("allows one update in flight per child and coalesces to the latest state", async () => {
    await render();
    await act(async () => {
      await api.open(mergeDetachedWorkspaces(state("a"), state("b")));
    });
    await act(async () => vi.advanceTimersByTimeAsync(110));
    vi.mocked(nativeWorkspaceWindow.update).mockClear();
    let finish!: () => void;
    vi.mocked(nativeWorkspaceWindow.update).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
    );
    sessions = [{ ...sessions[0], title: "first" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    for (const title of ["middle", "final"]) {
      sessions = [{ ...sessions[0], title }, sessions[1]];
      await render();
      await act(async () => vi.advanceTimersByTimeAsync(110));
    }
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledOnce();
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTimeAsync(110));
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledTimes(2);
    const update = vi.mocked(nativeWorkspaceWindow.update).mock.calls[1][1];
    expect(update.sessions).toHaveLength(1);
    expect(update.sessions[0].session.title).toBe("final");
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "retries a declined in-flight update after append completes (success=%s)",
    async (succeed) => {
      await render();
      await act(async () => {
        await api.open(state("a"));
      });
      await act(async () => vi.advanceTimersByTimeAsync(110));
      vi.mocked(nativeWorkspaceWindow.update).mockClear();
      let finishUpdate!: (applied: boolean) => void;
      vi.mocked(nativeWorkspaceWindow.update).mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishUpdate = resolve;
          }),
      );
      sessions = [
        { ...sessions[0], title: "final during transfer" },
        sessions[1],
      ];
      await render();
      await act(async () => vi.advanceTimersByTimeAsync(110));
      vi.spyOn(nativeWorkspaceWindow, "freeze").mockResolvedValue({
        id: "window-a",
        state: state("a"),
        pinned: false,
      });
      let finishOpen!: () => void;
      vi.mocked(nativeWorkspaceWindow.open).mockImplementationOnce(
        (merged) =>
          new Promise((resolve, reject) => {
            finishOpen = () =>
              succeed
                ? resolve({
                    id: "window-a",
                    state: { ...merged, transferToken: "new" },
                    pinned: false,
                  })
                : reject(new Error("append rolled back"));
          }),
      );
      let append!: Promise<unknown>;
      await act(async () => {
        append = api.open(state("b"), "window-a").catch((error) => error);
      });
      await act(async () => finishUpdate(false));
      await act(async () => vi.advanceTimersByTimeAsync(110));
      expect(nativeWorkspaceWindow.update).toHaveBeenCalledOnce();
      await act(async () => {
        finishOpen();
        await append;
      });
      await act(async () => vi.advanceTimersByTimeAsync(110));
      expect(nativeWorkspaceWindow.update).toHaveBeenCalledTimes(2);
      const latest = vi.mocked(nativeWorkspaceWindow.update).mock.calls[1][1];
      expect(latest.sessionIds).toEqual(succeed ? ["a", "b"] : ["a"]);
      expect(
        latest.sessions.find((item) => item.session.id === "a")?.session.title,
      ).toBe("final during transfer");
    },
  );

  it("resends the queued latest state after a failed update", async () => {
    await render();
    await act(async () => {
      await api.open(state("a"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(110));
    vi.mocked(nativeWorkspaceWindow.update).mockClear();
    let fail!: (reason: Error) => void;
    vi.mocked(nativeWorkspaceWindow.update).mockImplementationOnce(
      () =>
        new Promise<boolean>((_, reject) => {
          fail = reject;
        }),
    );
    sessions = [{ ...sessions[0], title: "first" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    sessions = [{ ...sessions[0], title: "final" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    await act(async () => fail(new Error("temporary transport failure")));
    await act(async () => vi.advanceTimersByTimeAsync(110));
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(nativeWorkspaceWindow.update).mock.calls[1][1].sessions[0]
        .session.title,
    ).toBe("final");
  });

  it("does not publish a coalesced update after owner disposal", async () => {
    await render();
    await act(async () => {
      await api.open(state("a"));
    });
    let finish!: () => void;
    vi.mocked(nativeWorkspaceWindow.update).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(110));
    sessions = [{ ...sessions[0], title: "last" }, sessions[1]];
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(110));
    await act(async () => root.render(null));
    await act(async () => finish());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(nativeWorkspaceWindow.update).toHaveBeenCalledOnce();
  });
});

it("merges session deltas while retaining layout, drafts, theme and unchanged session identity", () => {
  const original: DetachedWorkspaceSnapshot = {
    id: "window",
    pinned: false,
    state: {
      ...mergeDetachedWorkspaces(state("a"), state("b")),
      transferToken: "current",
      theme: { scheme: "dark", variables: {} },
      drafts: { a: { text: "unsaved", attachments: [], updatedAt: 1 } },
    },
  };
  const updated = {
    ...original.state.sessions[0],
    session: { ...original.state.sessions[0].session, title: "new" },
  };
  const delta = {
    transferToken: "current",
    sessionIds: ["a", "b"],
    sessions: [updated],
  };
  const next = mergeDetachedSessionUpdate(original, delta);
  expect(next.state.sessions[0]).toBe(updated);
  expect(next.state.sessions[1]).toBe(original.state.sessions[1]);
  for (const key of ["tabs", "browsers", "view", "theme", "drafts"] as const)
    expect(next.state[key]).toBe(original.state[key]);
  expect(
    mergeDetachedSessionUpdate(original, { ...delta, transferToken: "old" }),
  ).toBe(original);
  expect(
    mergeDetachedSessionUpdate(original, { ...delta, sessionIds: ["missing"] }),
  ).toBe(original);
  expect(
    mergeDetachedSessionUpdate(original, {
      ...delta,
      sessions: [],
      sessionIds: ["b"],
    }).state.sessions,
  ).toEqual([original.state.sessions[1]]);
});

it("rejects a late pre-return delta without reintroducing removed sessions", () => {
  const remaining: DetachedWorkspaceSnapshot = {
    id: "window",
    pinned: false,
    state: { ...state("b"), transferToken: "same" },
  };
  expect(
    mergeDetachedSessionUpdate(remaining, {
      transferToken: "same",
      sessionIds: ["a", "b"],
      sessions: [{ session: session("a"), recents: [] }],
    }),
  ).toBe(remaining);
});
