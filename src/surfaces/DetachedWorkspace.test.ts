// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedWorkspace } from "./DetachedWorkspace";
import { nativeWorkspaceWindow } from "../lib/detachedWorkspaces";
import { leaf, newTab } from "../lib/layout";
import { resolveWorkspaceView } from "../lib/workspaceViews";
import { installInAppLinks } from "../lib/inAppLinks";

vi.mock("./BrowserPane", () => ({
  BrowserPane: ({ id, visible }: { id: string; visible: boolean }) =>
    createElement("div", {
      "data-test-browser": id,
      "data-presented": String(visible),
    }),
}));
vi.mock("./SessionPane", () => ({ SessionPane: () => null }));
vi.mock("./FilePane", () => ({
  FilePane: ({ pane, editorNavigation }: any) =>
    createElement("div", {
      "data-test-file": pane.files.find(
        (file: any) => file.id === pane.activeFileId,
      )?.path,
      "data-navigation": JSON.stringify(editorNavigation),
    }),
}));
vi.mock("../chrome/TitleBar", () => ({ TitleBar: () => null }));
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
        { id: "selected", title: "Selected", url: "https://example.com" },
        { id: "background", title: "Background", url: "https://example.org" },
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
        runtimeMode: "bypass",
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
