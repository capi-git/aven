// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaf, leafIds, type WorkspaceTab } from "./layout";
import { resolveWorkspaceView } from "./workspaceViews";
import { captureWorkspaceReturnPlacement } from "./workspaceArrangement";
import {
  mergeDetachedWorkspaces,
  nativeWorkspaceWindow,
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
  runtimeMode: "bypass",
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
      onError,
    });
    return null;
  }
  const render = () => act(async () => root.render(createElement(Harness)));
  it("rolls back partial listener failure and refuses an unobserved native open", async () => {
    const cleanup = vi.fn();
    let late!: (fn: () => void) => void;
    vi.mocked(nativeWorkspaceWindow.listen)
      .mockResolvedValueOnce(cleanup)
      .mockRejectedValueOnce(new Error("listener setup failed"))
      .mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
    await render();
    await expect(api.open(state("a"))).rejects.toThrow("listener setup failed");
    expect(onError).toHaveBeenCalledExactlyOnceWith("listener setup failed");
    expect(nativeWorkspaceWindow.open).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    const releaseLate = vi.fn();late(releaseLate);await Promise.resolve();
    expect(releaseLate).toHaveBeenCalledTimes(1);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    listeners = new Map();
    sessions = [session("a"), session("b")];
    returned = vi.fn();
    onError.mockClear();
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
    for (const name of ["update", "ack", "resume", "close"] as const)
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
    expect(
      merged.view.layout!.type === "split" && merged.view.layout.children[1],
    ).toEqual(b.view.layout);
    expect(merged.browsers[0].nativeId).toBe("existing-cef");
    expect(merged.editorDrafts).toEqual(b.editorDrafts);
    expect(() =>
      mergeDetachedWorkspaces(a, { ...b, cwd: "/different" }),
    ).toThrow("same project");
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
});
