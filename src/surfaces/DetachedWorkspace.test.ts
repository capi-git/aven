// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedWorkspace } from "./DetachedWorkspace";
import { nativeWorkspaceWindow } from "../lib/detachedWorkspaces";
import { leaf, newTab, splitPane } from "../lib/layout";
import { resolveWorkspaceView } from "../lib/workspaceViews";
import { installInAppLinks } from "../lib/inAppLinks";
import * as workspaceStage from "./WorkspaceStage";

const previews = vi.hoisted(() => ({ filePane: vi.fn(), titleBar: vi.fn() }));

vi.mock("./BrowserPane", () => ({
  BrowserPane: ({ id, visible, initialUrl }: { id: string; visible: boolean; initialUrl: string }) =>
    createElement("div", {
      "data-test-browser": id,
      "data-presented": String(visible),
      "data-url": initialUrl,
    }),
}));
vi.mock("./SessionPane", () => ({ SessionPane: () => null }));
vi.mock("./FilePane", () => ({
  FilePane: (props: any) => {
    previews.filePane(props);
    const { pane, editorNavigation } = props;
    return createElement("div", {
      "data-test-file": pane.files.find(
        (file: any) => file.id === pane.activeFileId,
      )?.path,
      "data-navigation": JSON.stringify(editorNavigation),
    });
  },
}));
vi.mock("../chrome/TitleBar", () => ({ TitleBar: (props: unknown) => { previews.titleBar(props); return null; } }));
vi.mock("../lib/inAppLinks", () => ({
  installInAppLinks: vi.fn(() => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async () => () => {},
    isFocused: async () => true,
  }),
}));

let root: Root;
let host: HTMLDivElement;
let listeners: Map<string, (value: any) => void>;
beforeEach(() => {
  previews.filePane.mockClear();
  previews.titleBar.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  listeners = new Map();
  vi.spyOn(nativeWorkspaceWindow, "listen").mockImplementation(
    async (name, callback) => {
      listeners.set(name, callback);
      return () => {
        listeners.delete(name);
      };
    },
  );
  vi.spyOn(nativeWorkspaceWindow, "getState").mockResolvedValue({
    id: "workspace-test",
    pinned: false,
    state: {
      cwd: "/project",
      title: "Group",
      tabs: [],
      sessions: [],
      transferToken: "transfer",
      browsers: [
        {
          id: "selected",
          tabId: "selected",
          title: "Selected",
          url: "https://example.com",
        },
        {
          id: "background",
          tabId: "background",
          title: "Background",
          url: "https://example.org",
        },
      ],
      view: {
        layout: leaf("selected"),
        focusedId: "selected",
        order: ["selected", "background"],
        groups: { selected: ["selected", "background"] },
      },
    },
  });
  for (const name of ["ready", "checkpoint", "ack", "visibility"] as const)
    vi.spyOn(nativeWorkspaceWindow, name).mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

it("focuses an existing browser without restoring a stale checkpoint address", async () => {
  await act(async () => root.render(createElement(DetachedWorkspace)));
  await act(async () => listeners.get("workspace-window-focus")!({
    browser: { id: "background", url: "https://old-preview.example/", title: "Stale title" },
  }));
  const browser = host.querySelector('[data-test-browser="background"]');
  expect(browser?.getAttribute("data-presented")).toBe("true");
  expect(browser?.getAttribute("data-url")).toBe("https://example.org");
  await act(async () => vi.advanceTimersByTime(150));
  expect(nativeWorkspaceWindow.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({
    browsers: expect.arrayContaining([expect.objectContaining({ id: "background", url: "https://example.org", title: "Background" })]),
  }));
});

it("keeps all detached file tabs after editing and saving and checkpoints their identities", async () => {
  const initial = await nativeWorkspaceWindow.getState();
  const files = ["a", "b", "c"].map((id) => ({ id, path: `/project/${id}.md`, cwd: "/project" }));
  const tab = {
    ...newTab("task"),
    layout: leaf("editor"), focusedId: "editor",
    editorPanes: [{ id: "editor", files, activeFileId: "c" }],
  };
  initial.state.tabs = [tab];
  initial.state.browsers = [];
  initial.state.view = resolveWorkspaceView(undefined, [tab.id], tab.id);
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const pane = () => previews.filePane.mock.calls.at(-1)![0];
  await act(async () => pane().onDirtyChange("a", true));
  expect(pane().pane.files).toEqual(files);
  expect(pane().dirtyFileIds.has("a")).toBe(true);
  await act(async () => pane().onDirtyChange("a", false));
  expect(pane().pane.files).toEqual(files);
  expect(pane().dirtyFileIds.has("a")).toBe(false);
  await act(async () => vi.advanceTimersByTime(150));
  expect(nativeWorkspaceWindow.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({
    tabs: [expect.objectContaining({ editorPanes: [{ id: "editor", activeFileId: "c", files }] })],
  }));
});

it("keeps detached browser previews and remembers their slot when returning to a conversation", async () => {
  const initial = await nativeWorkspaceWindow.getState();
  const tab = newTab("task");
  initial.state.tabs = [tab];
  initial.state.view = resolveWorkspaceView({
    layout: leaf("selected"), focusedId: "selected", order: [tab.id, "selected", "background"],
    groups: { selected: [tab.id, "selected", "background"] },
  }, [tab.id, "selected", "background"], "selected");
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const header = () => previews.titleBar.mock.calls.at(-1)![0];
  await act(async () => header().onSelect(tab.id));
  expect(header().browserPreviewId).toBe("selected");
  await act(async () => header().onKeepBrowser("selected"));
  expect(header().browserTabs.find((browser: { id: string }) => browser.id === "selected").kept).toBe(true);
});

it("renders detached drag feedback only when the dragged tab or destination changes", async () => {
  const hitTest = vi.spyOn(workspaceStage, "workspaceSurfaceDropAt");
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const header = () => previews.titleBar.mock.calls.at(-1)![0];
  const move = async (
    id: string,
    target: workspaceStage.WorkspaceSurfaceDropTarget | null,
  ) => {
    hitTest.mockReturnValue(target);
    await act(async () => header().onSurfaceDragMove(id, 260, 15));
  };
  const target = {
    id: "background",
    edge: "tab" as const,
    index: 0,
    orderIndex: 1,
  };
  await move("selected", target);
  const renders = previews.titleBar.mock.calls.length;
  await move("selected", { ...target });
  await move("selected", { ...target });
  expect(previews.titleBar).toHaveBeenCalledTimes(renders);

  const changes: Array<[
    string,
    workspaceStage.WorkspaceSurfaceDropTarget | null,
  ]> = [
    ["selected", { ...target, index: 1 }],
    ["selected", { ...target, index: 1, orderIndex: 2 }],
    [
      "selected",
      { ...target, id: "selected", index: 1, orderIndex: 2 },
    ],
    ["selected", { id: "selected", edge: "right" }],
    ["background", { id: "selected", edge: "right" }],
    ["background", null],
  ];
  for (const [index, [id, next]] of changes.entries()) {
    await move(id, next);
    expect(previews.titleBar).toHaveBeenCalledTimes(renders + index + 1);
  }
  await move("background", null);
  expect(previews.titleBar).toHaveBeenCalledTimes(renders + changes.length);
  await act(async () =>
    header().onSurfaceDragEnd("background", 260, 15, true),
  );
  expect(previews.titleBar).toHaveBeenCalledTimes(renders + changes.length + 1);
});

it("combines the two visible browser owners without promoting hidden Recent pages", async () => {
  const initial = await nativeWorkspaceWindow.getState();
  initial.state.browsers.push(
    { id: "target", tabId: "target", title: "Target", url: "https://target.test" },
    { id: "target-history", tabId: "target-history", title: "Target history", url: "https://history.test" },
    { id: "saved", tabId: "saved", title: "Saved", url: "https://saved.test", kept: true },
  );
  initial.state.view = {
    layout: splitPane(leaf("selected"), "selected", "right", "target"),
    focusedId: "selected",
    order: ["selected", "background", "saved", "target", "target-history"],
    groups: {
      selected: ["selected", "background", "saved"],
      target: ["target", "target-history"],
    },
  };
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const sourceHeader = previews.titleBar.mock.calls.find(([props]) => props.groupId === "selected")![0];
  await act(async () => sourceHeader.onCombineWith("target"));
  const combined = previews.titleBar.mock.calls.at(-1)![0];
  expect(combined.groupId).toBe("target");
  expect(combined.browserTabs.filter((browser: { kept?: boolean }) => browser.kept).map((browser: { id: string }) => browser.id)).toEqual(["selected", "target", "saved"]);
  expect(combined.browserTabs).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "background", kept: undefined, url: "https://example.org" }),
    expect.objectContaining({ id: "target-history", kept: undefined, url: "https://history.test" }),
  ]));
  expect(combined.browserTabs).toHaveLength(5);
  await act(async () => vi.advanceTimersByTime(150));
  expect(nativeWorkspaceWindow.checkpoint).toHaveBeenLastCalledWith(expect.objectContaining({
    view: expect.objectContaining({ groups: { target: ["target", "target-history", "selected", "background", "saved"] } }),
    browsers: expect.arrayContaining([
      expect.objectContaining({ id: "selected", kept: true }),
      expect.objectContaining({ id: "target", kept: true }),
      initial.state.browsers[1],
      initial.state.browsers[3],
    ]),
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.getElementById("boot-splash")?.remove();
  document.documentElement.style.removeProperty("--theme-background-color");
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the startup cover until parent theme and selected browser content commit", async () => {
  const splash = document.createElement("div");
  splash.id = "boot-splash";
  document.body.append(splash);
  const initial = await nativeWorkspaceWindow.getState();
  initial.state.theme = {
    scheme: "dark",
    variables: { "--theme-background-color": "#112233" },
  };
  let resolve!: (state: typeof initial) => void;
  vi.mocked(nativeWorkspaceWindow.getState).mockImplementation(
    () => new Promise((done) => (resolve = done)),
  );
  await act(async () => root.render(createElement(DetachedWorkspace)));
  await act(async () => vi.advanceTimersByTime(500));
  expect(splash.dataset.dismissed).toBeUndefined();
  expect(host.querySelector("[data-test-browser]")).toBeNull();
  await act(async () => resolve(initial));
  expect(host.querySelector('[data-test-browser="selected"]')).not.toBeNull();
  expect(
    document.documentElement.style.getPropertyValue("--theme-background-color"),
  ).toBe("#112233");
  expect(splash.dataset.dismissed).toBe("1");
  expect(nativeWorkspaceWindow.ready).toHaveBeenCalledWith("transfer");
  await act(async () => vi.advanceTimersByTime(430));
  expect(splash.isConnected).toBe(false);
});

it("opens an agent file in its detached task and forwards editor navigation without a duplicate tab", async () => {
  const initial = await nativeWorkspaceWindow.getState();
  initial.state.tabs = [newTab("task")];
  initial.state.sessions = [
    {
      session: {
        id: "task",
        title: "Task",
        cwd: "/project",
        harness: "codex",
        model: "gpt-5",
        modelSettings: {},
        runtimeMode: "full-access",
        blocks: [],
      },
      recents: [],
    },
  ];
  initial.state.view = resolveWorkspaceView(
    initial.state.view,
    ["selected", "background", initial.state.tabs[0].id],
    "selected",
  );
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const request = {
    requestToken: "open-file",
    sessionId: "task",
    file: { path: "/project/README.md", line: 12, column: 4 },
  };
  await act(async () => listeners.get("workspace-window-focus")!(request));
  const file = host.querySelector<HTMLElement>(
    '[data-test-file="/project/README.md"]',
  );
  expect(file).not.toBeNull();
  expect(JSON.parse(file!.dataset.navigation!)).toMatchObject({
    path: "/project/README.md",
    line: 12,
    column: 4,
    token: 1,
  });
  await act(async () => listeners.get("workspace-window-focus")!(request));
  await act(async () => vi.advanceTimersByTime(150));
  const checkpoint = vi.mocked(nativeWorkspaceWindow.checkpoint).mock
    .lastCall![0];
  expect(checkpoint.view.focusedId).toBe(initial.state.tabs[0].id);
  expect(checkpoint.tabs).toHaveLength(1);
  expect(
    checkpoint.tabs[0].editorPanes.flatMap((pane) => pane.files),
  ).toHaveLength(1);
  expect(checkpoint.browsers).toEqual(initial.state.browsers);
  expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith("open-file");
  await act(async () =>
    listeners.get("workspace-window-focus")!({
      ...request,
      requestToken: "expired-file",
      expiresAt: Date.now() - 1,
      file: { path: "/project/expired.md" },
    }),
  );
  expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
    "expired-file",
    undefined,
    expect.stringContaining("request expired"),
  );
  expect(
    host.querySelector('[data-test-file="/project/expired.md"]'),
  ).toBeNull();
  const links = vi.mocked(installInAppLinks).mock.lastCall![0];
  await act(async () =>
    links.openFile("/project/README.md", { line: 24, column: 2 }),
  );
  expect(JSON.parse(file!.dataset.navigation!)).toMatchObject({
    line: 24,
    column: 2,
  });
  await act(async () =>
    listeners.get("workspace-window-focus")!({
      ...request,
      sessionId: "missing",
      requestToken: "missing-file",
    }),
  );
  expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
    "missing-file",
    undefined,
    expect.stringContaining("no longer in this window"),
  );
  await act(async () =>
    listeners.get("workspace-window-freeze")!({ token: "freeze" }),
  );
  await act(async () =>
    listeners.get("workspace-window-focus")!({
      ...request,
      requestToken: "frozen-file",
    }),
  );
  expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
    "frozen-file",
    undefined,
    expect.stringContaining("window is moving"),
  );
});

it("uncovers a workspace startup error when the initial state request fails", async () => {
  const splash = document.createElement("div");
  splash.id = "boot-splash";
  document.body.append(splash);
  vi.mocked(nativeWorkspaceWindow.getState).mockRejectedValue(
    new Error("Owner closed"),
  );
  await act(async () => root.render(createElement(DetachedWorkspace)));
  expect(host.textContent).toContain("Owner closed");
  await act(async () => vi.advanceTimersByTime(430));
  expect(splash.isConnected).toBe(false);
});

it("keeps selected panes mounted behind native occlusion while transfer freezing still hides Chromium", async () => {
  await act(async () => root.render(createElement(DetachedWorkspace)));
  const selected = () =>
    host.querySelector<HTMLElement>('[data-test-browser="selected"]')!;
  const background = () =>
    host.querySelector<HTMLElement>('[data-test-browser="background"]')!;
  expect(selected().dataset.presented).toBe("true");
  expect(selected().closest("[hidden]")).toBeNull();
  expect(background().dataset.presented).toBe("false");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(selected().dataset.presented).toBe("true");
  expect(selected().closest("[hidden]")).toBeNull();
  await act(async () =>
    listeners.get("workspace-window-freeze")!({ token: "freeze" }),
  );
  expect(selected().dataset.presented).toBe("false");
  expect(nativeWorkspaceWindow.ack).toHaveBeenCalledWith(
    "freeze",
    expect.any(Object),
  );
  await act(async () => listeners.get("workspace-window-resume")!(undefined));
  expect(selected().dataset.presented).toBe("true");
  expect(background().dataset.presented).toBe("false");
});
