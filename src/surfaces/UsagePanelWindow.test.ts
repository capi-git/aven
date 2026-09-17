// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { nativeUsagePanel, type UsagePanelSnapshot } from "../lib/usagePanel";
import { UsagePanelWindow } from "./UsagePanelWindow";

vi.mock("../lib/usagePanel", () => ({
  nativeUsagePanel: {
    listen: vi.fn(),
    getState: vi.fn(),
    ready: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockResolvedValue(undefined),
  },
}));

afterEach(() => {
  document.documentElement.classList.remove("usage-panel-window");
  document.documentElement.style.removeProperty("--usage-window-bg");
  vi.unstubAllGlobals();
});

it("paints the native panel backdrop from the owner palette before showing, and follows updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let receive: (value: UsagePanelSnapshot) => void = () => {};
  const stop = vi.fn();
  vi.mocked(nativeUsagePanel.listen).mockImplementation(
    async (_event, callback) => {
      receive = callback as typeof receive;
      return stop;
    },
  );
  const initial: UsagePanelSnapshot = {
    context: null,
    costUsd: null,
    providers: [],
    theme: {
      mode: "dark",
      accent: "#aaaab8",
      background: "#575757",
      text: "#ffffff",
    },
  };
  vi.mocked(nativeUsagePanel.getState).mockResolvedValue(initial);
  vi.mocked(nativeUsagePanel.ready).mockImplementation(async () => {
    expect(
      document.documentElement.style.getPropertyValue("--usage-window-bg"),
    ).toBe("#575757");
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(UsagePanelWindow)));
    expect(nativeUsagePanel.ready).toHaveBeenCalledOnce();
    await act(async () =>
      receive({
        ...initial,
        theme: {
          mode: "light",
          accent: "#8f6b25",
          background: "#faf4e6",
          text: "#000000",
        },
      }),
    );
    expect(
      document.documentElement.style.getPropertyValue("--usage-window-bg"),
    ).toBe("#faf4e6");
    expect(
      host
        .querySelector<HTMLElement>(".usage-panel")!
        .style.getPropertyValue("--usage-bg"),
    ).toBe("#faf4e6");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
  expect(stop).toHaveBeenCalledOnce();
});
