// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  nativeWorkspaceMenuPanel,
  type WorkspaceMenuPanelState,
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

const initial: WorkspaceMenuPanelState = {
  presentation: "open-1",
  snapshot: {
    title: "Open workspace",
    items: [
      { id: "browser", label: "Open browser" },
      { id: "finder", label: "Reveal in Finder", disabled: true },
      { id: "terminal", label: "Open terminal" },
    ],
    theme: {
      mode: "dark",
      accent: "#6cabdd",
      background: "#0b121a",
      text: "#ededed",
    },
  },
};
let host: HTMLDivElement;
let root: Root;
let receive: (value: WorkspaceMenuPanelState | null) => void;
let stop: ReturnType<typeof vi.fn>;
const render = async () =>
  act(async () => root.render(createElement(WorkspaceMenuPanelWindow)));
const clickAction = async (index = 0) =>
  act(async () =>
    host
      .querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [index].click(),
  );
const escape = async () =>
  act(async () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );

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
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockResolvedValue(true);
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

it("paints the owner palette before token-scoped ready and follows live theme and action updates", async () => {
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockImplementation(
    async (presentation) => {
      expect(
        document.documentElement.classList.contains(
          "workspace-menu-panel-window",
        ),
      ).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe(
        presentation === "open-1" ? "dark" : "light",
      );
      expect(
        host
          .querySelector<HTMLElement>(".toolbar-panel")
          ?.style.getPropertyValue("--toolbar-panel-bg"),
      ).toBe(presentation === "open-1" ? "#0b121a" : "#faf4e6");
      return presentation === "open-1";
    },
  );
  await render();
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledExactlyOnceWith(
    "open-1",
  );
  expect(
    host.querySelector<HTMLButtonElement>('button[role="menuitem"]:disabled')
      ?.textContent,
  ).toContain("Finder");
  await act(async () =>
    receive({
      presentation: "updated-2",
      snapshot: {
        ...initial.snapshot,
        items: [{ id: "browser", label: "Preview project" }],
        theme: {
          ...initial.snapshot.theme,
          mode: "light",
          background: "#faf4e6",
          text: "#151515",
        },
      },
    }),
  );
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenLastCalledWith("updated-2");
  expect(host.querySelector(".toolbar-panel")?.getAttribute("data-theme")).toBe(
    "light",
  );
  await clickAction();
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenLastCalledWith(
    "updated-2",
    "browser",
  );
  await escape();
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenLastCalledWith(
    "updated-2",
    "close",
  );
  expect(nativeWorkspaceMenuPanel.listen).toHaveBeenCalledOnce();
});

it("keeps a live update when the initial state resolves later", async () => {
  let resolve!: (value: WorkspaceMenuPanelState) => void;
  vi.mocked(nativeWorkspaceMenuPanel.getState).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render();
  await act(async () =>
    receive({
      presentation: "open-new",
      snapshot: { ...initial.snapshot, title: "Latest actions" },
    }),
  );
  await act(async () => resolve(initial));
  expect(host.querySelector("h2")?.textContent).toBe("Latest actions");
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledExactlyOnceWith(
    "open-new",
  );
  await escape();
  expect(nativeWorkspaceMenuPanel.action).toHaveBeenLastCalledWith(
    "open-new",
    "close",
  );
  await act(async () => root.render(null));
  expect(stop).toHaveBeenCalledOnce();
});

it("does not show or dispatch a menu without a valid presentation", async () => {
  vi.mocked(nativeWorkspaceMenuPanel.getState).mockRejectedValue(
    new Error("closed"),
  );
  await render();
  expect(host.textContent).toBe("");
  expect(nativeWorkspaceMenuPanel.ready).not.toHaveBeenCalled();
  await escape();
  expect(nativeWorkspaceMenuPanel.action).not.toHaveBeenCalled();
  await act(async () => receive(initial));
  expect(host.textContent).not.toContain("Could not load");
  expect(nativeWorkspaceMenuPanel.ready).toHaveBeenCalledExactlyOnceWith(
    "open-1",
  );
});

it("retains focus for snapshot updates and resets it only on a new native show", async () => {
  await render();
  const terminal =
    host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[2];
  terminal.focus();
  expect(document.activeElement).toBe(terminal);
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockResolvedValue(false);
  await act(async () => receive({ ...initial, presentation: "update-2" }));
  expect(document.activeElement).toBe(terminal);
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockResolvedValue(true);
  await act(async () => receive({ ...initial, presentation: "reopen-3" }));
  expect(document.activeElement?.textContent).toBe("Open browser");
  expect(document.activeElement).not.toBe(terminal);
});

it("discards stale action errors and clears current errors on the next presentation", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(nativeWorkspaceMenuPanel.action).mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  await render();
  await clickAction();
  await act(async () => receive({ ...initial, presentation: "open-2" }));
  await act(async () => reject(new Error("old action")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  vi.mocked(nativeWorkspaceMenuPanel.action).mockRejectedValueOnce(
    new Error("current failure"),
  );
  await clickAction();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not complete",
  );
  await act(async () => receive({ ...initial, presentation: "open-3" }));
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("ignores stale ready replies and becomes idle when the host clears its state", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(nativeWorkspaceMenuPanel.ready).mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  await render();
  await act(async () => receive({ ...initial, presentation: "open-2" }));
  await act(async () => reject(new Error("old readiness")));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => receive(null));
  expect(host.textContent).toBe("");
  vi.mocked(nativeWorkspaceMenuPanel.action).mockClear();
  await escape();
  expect(nativeWorkspaceMenuPanel.action).not.toHaveBeenCalled();
});
