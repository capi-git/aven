// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelSnapshot,
} from "../lib/workspaceMenuPanel";
import { WorkspaceMenuPanelWindow } from "./WorkspaceMenuPanelWindow";

vi.mock("../lib/workspaceMenuPanel", () => ({
  nativeWorkspaceMenuPanel: {
    listen: vi.fn(),
    getState: vi.fn(),
    ready: vi.fn(),
    action: vi.fn(),
  },
}));

const initial: WorkspaceMenuPanelSnapshot = {
  title: "Open workspace",
  items: [
    { id: "browser", label: "Open browser" },
    { id: "finder", label: "Reveal in Finder", disabled: true },
  ],
  theme: {
    mode: "dark",
    accent: "#6cabdd",
    background: "#0b121a",
    text: "#ededed",
  },
};
let host: HTMLDivElement;
let root: Root;
let receive: (value: WorkspaceMenuPanelSnapshot) => void;
let stop: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  stop = vi.fn();
  receive = () => {};
  vi.mocked(nativeWorkspaceMenuPanel.listen).mockImplementation(
    async (_event, callback) => {
      receive = callback as typeof receive;
      return stop;
    },
  );
  vi.mocked(nativeWorkspaceMenuPanel.getState).mockResolvedValue(initial);
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockResolvedValue(undefined);
  vi.mocked(nativeWorkspaceMenuPanel.action).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.classList.remove("workspace-menu-panel-window");
  document.documentElement.style.removeProperty("color-scheme");
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it("paints the owner palette before showing and follows theme, enabled actions and Escape", async () => {
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockImplementation(async () => {
    expect(
      document.documentElement.classList.contains(
        "workspace-menu-panel-window",
      ),
    ).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(
      host
        .querySelector<HTMLElement>(".toolbar-panel")
        ?.style.getPropertyValue("--toolbar-panel-bg"),
    ).toBe("#0b121a");
  });
  await act(async () => root.render(createElement(WorkspaceMenuPanelWindow)));
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledOnce();
  expect(
    host.querySelector<HTMLButtonElement>('button[role="menuitem"]:disabled')
      ?.textContent,
  ).toContain("Finder");
  await act(async () =>
    receive({
      ...initial,
      items: [{ id: "browser", label: "Preview project" }],
      theme: {
        ...initial.theme,
        mode: "light",
        background: "#faf4e6",
        text: "#151515",
      },
    }),
  );
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(
    host
      .querySelector<HTMLElement>(".toolbar-panel")
      ?.style.getPropertyValue("--toolbar-panel-bg"),
  ).toBe("#faf4e6");
  expect(host.querySelector(".toolbar-panel")?.getAttribute("data-theme")).toBe(
    "light",
  );
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledOnce();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click(),
  );
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenLastCalledWith("browser");
  await act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenLastCalledWith("close");
});

it("keeps a live update when the initial snapshot resolves later", async () => {
  let resolve!: (value: WorkspaceMenuPanelSnapshot) => void;
  vi.mocked(nativeWorkspaceMenuPanel.getState).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(createElement(WorkspaceMenuPanelWindow)));
  await act(async () => receive({ ...initial, title: "Latest actions" }));
  await act(async () => resolve(initial));
  expect(host.querySelector("h2")?.textContent).toBe("Latest actions");
  await act(async () => root.render(null));
  expect(stop).toHaveBeenCalledOnce();
});

it("shows a closable framed error if the native display state is unavailable", async () => {
  vi.mocked(nativeWorkspaceMenuPanel.getState).mockRejectedValue(
    new Error("closed"),
  );
  await act(async () => root.render(createElement(WorkspaceMenuPanelWindow)));
  expect(
    host.querySelector('[role="alert"]')?.classList.contains("toolbar-panel"),
  ).toBe(true);
  expect(host.textContent).toContain("Could not load workspace actions");
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledOnce();
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="Close open options"]')!
      .click(),
  );
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenCalledExactlyOnceWith(
    "close",
  );
});
