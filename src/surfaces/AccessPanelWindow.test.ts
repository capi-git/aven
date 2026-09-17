// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  nativeAccessPanel,
  type AccessPanelSnapshot,
} from "../lib/accessPanel";
import { AccessPanelWindow } from "./AccessPanelWindow";
vi.mock("../lib/accessPanel", () => ({
  nativeAccessPanel: {
    listen: vi.fn(),
    getState: vi.fn(),
    ready: vi.fn(),
    action: vi.fn(),
  },
}));
afterEach(() => {
  document.documentElement.classList.remove("access-panel-window");
  document.documentElement.style.removeProperty("--access-window-bg");
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("paints the workspace theme before showing, follows live state and sends explicit choices or Escape to its owner", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let receive: (snapshot: AccessPanelSnapshot) => void = () => {};
  const stop = vi.fn();
  vi.mocked(nativeAccessPanel.listen).mockImplementation(
    async (_event, callback) => {
      receive = callback as typeof receive;
      return stop;
    },
  );
  const snapshot: AccessPanelSnapshot = {
    value: "supervised",
    busy: false,
    theme: {
      mode: "dark",
      accent: "#6cabdd",
      background: "#0b121a",
      text: "#ededed",
    },
  };
  vi.mocked(nativeAccessPanel.getState).mockResolvedValue(snapshot);
  vi.mocked(nativeAccessPanel.ready).mockImplementation(async () => {
    expect(
      document.documentElement.style.getPropertyValue("--access-window-bg"),
    ).toBe("#0b121a");
  });
  vi.mocked(nativeAccessPanel.action).mockResolvedValue(undefined);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(AccessPanelWindow)));
    expect(nativeAccessPanel.ready).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Your choice is remembered");
    await act(async () =>
      receive({
        ...snapshot,
        value: "auto",
        busy: true,
        theme: { ...snapshot.theme, background: "#faf4e6", mode: "light" },
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue("--access-window-bg"),
    ).toBe("#faf4e6");
    expect(host.textContent).toContain("Changes apply to the next turn");
    expect(host.querySelector('[aria-checked="true"]')?.textContent).toContain(
      "Auto",
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-checked="true"]')!.click(),
    );
    expect(nativeAccessPanel.action).toHaveBeenLastCalledWith("auto");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(nativeAccessPanel.action).toHaveBeenLastCalledWith("close");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(stop).toHaveBeenCalledOnce();
});
