// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "../lib/rateLimits";
import {
  loadUsageHistory,
  resetUsageForecasts,
  USAGE_HISTORY_KEY,
} from "../lib/usageHistory";
import { FooterUsage, type FooterUsageProps } from "./FooterUsage";

const api = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
vi.mock("../lib/rateLimitsFetch", () => ({
  fetchClaudeRateLimits: api.claude,
  fetchCodexRateLimits: api.codex,
}));
vi.mock("../lib/usagePanel", () => ({
  useUsagePanelTheme: () => ({ mode: "dark", accent: "#57b5ff" }),
}));
vi.mock("./Popover", () => ({
  Popover: ({
    children,
    role,
    ...props
  }: ComponentProps<"div"> & Record<string, unknown>) =>
    createElement("div", { role, "aria-label": props["aria-label"] }, children),
}));

const NOW = new Date("2026-10-03T12:00:00Z").getTime();
const minutes = (value: number) => NOW + value * 60_000;
const claudeLimits = (): ProviderRateLimits => ({
  provider: "claude",
  session: { usedPercent: 2, windowMinutes: 300, resetsAt: minutes(237) },
  weekly: {
    usedPercent: 15,
    windowMinutes: 10_080,
    resetsAt: minutes((4 * 24 + 17) * 60),
  },
  updatedAt: NOW,
  error: null,
  status: "ok",
});

let root: Root;
let container: HTMLDivElement;
let hidden = false;
let stored: Map<string, string>;
beforeEach(() => {
  // Usage is saved for restarts; each test starts as a first launch. Some
  // Node versions give tests a working localStorage and some do not.
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.clearAllMocks();
  resetUsageForecasts();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.claude.mockImplementation(async () => claudeLimits());
  api.codex.mockImplementation(async (): Promise<ProviderRateLimits> => ({
    provider: "codex",
    session: null,
    weekly: { usedPercent: 4, windowMinutes: 10_080, resetsAt: null },
    updatedAt: NOW,
    error: null,
    status: "ok",
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(props: FooterUsageProps) {
  await act(async () => root.render(createElement(FooterUsage, props)));
  // Let the lazy fetch module and its request settle.
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
const button = (label: RegExp) => {
  const node = [...container.querySelectorAll("button")].find((item) =>
    label.test(item.getAttribute("aria-label") ?? ""),
  );
  if (!node) throw new Error(`Button missing: ${label}`);
  return node;
};

describe("footer usage", () => {
  it("shows Claude and Codex side by side in a fixed order", async () => {
    await render({ providers: ["codex", "claude"] });
    expect(api.claude).toHaveBeenCalledOnce();
    expect(api.codex).toHaveBeenCalledOnce();
    const accounts = [
      ...container.querySelectorAll(".footer-usage-account"),
    ].map((node) => node.textContent);
    expect(accounts).toEqual(["2% 3h 57m · 15% 4d 17h", "4%"]);
    expect(button(/Show usage details/).getAttribute("aria-label")).toBe(
      "Claude Code usage 2% 3h 57m, 15% 4d 17h · Codex usage 4%. Show usage details",
    );
  });

  it("opens the details panel and refreshes every account on demand", async () => {
    await render({ providers: ["codex", "claude"] });
    await act(async () => button(/Show usage details/).click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(
      container.querySelector('[aria-label="Task and provider usage"]'),
    ).not.toBeNull();
    // Fresh snapshots are reused; the refresh button forces a reload.
    expect(api.claude).toHaveBeenCalledOnce();
    expect(api.codex).toHaveBeenCalledOnce();
    await act(async () => button(/^Refresh usage$/).click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(api.claude).toHaveBeenCalledTimes(2);
    expect(api.codex).toHaveBeenCalledTimes(2);
  });

  it("shows the last saved usage after a restart without asking again", async () => {
    await render({ providers: ["claude"] });
    expect(api.claude).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(container);
    // A minute later, a new window starts with what the last one saved.
    vi.setSystemTime(minutes(1));
    await render({ providers: ["claude"] });
    expect(api.claude).toHaveBeenCalledOnce();
    expect(container.querySelector(".footer-usage-account")?.textContent).toBe(
      "2% 3h 56m · 15% 4d 16h",
    );
  });

  it("keeps the last known usage when a refresh is throttled", async () => {
    await render({ providers: ["claude"] });
    api.claude.mockResolvedValueOnce({
      provider: "claude",
      session: null,
      weekly: null,
      updatedAt: NOW,
      error: "Claude is limiting usage checks right now.",
      status: "error",
    });
    await act(async () => button(/^Refresh usage$/).click());
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(api.claude).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".footer-usage-account")?.textContent).toBe(
      "2% 3h 57m · 15% 4d 17h",
    );
  });

  it("shows the task context beside the account usage", async () => {
    await render({
      providers: ["claude"],
      context: { used: 50_000, window: 200_000 },
    });
    expect(container.textContent).toContain("Context 25%");
    expect(button(/Show usage details/).getAttribute("aria-label")).toContain(
      "Context 25% · Claude Code usage 2% 3h 57m, 15% 4d 17h",
    );
  });

  it("leaves out an account that is not installed or signed in", async () => {
    api.codex.mockResolvedValueOnce({
      provider: "codex",
      session: null,
      weekly: null,
      updatedAt: NOW,
      error: "Codex CLI not found",
      status: "unavailable",
    });
    await render({ providers: ["codex", "claude"] });
    expect(container.querySelectorAll(".footer-usage-account")).toHaveLength(1);
    expect(container.textContent).toContain("2% 3h 57m · 15% 4d 17h");
  });

  it("does not start a provider check while the window is hidden", async () => {
    hidden = true;
    await render({ providers: ["codex"] });
    expect(api.codex).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Checking usage…");
  });

  it("records each fresh answer for forecasting, and nothing else", async () => {
    await render({ providers: ["claude"] });
    expect(loadUsageHistory()["claude.session"]).toEqual([
      { at: NOW, used: 2, resetsAt: minutes(237) },
    ]);
    // One reading is not a pace: no marker, no forecast.
    expect(
      container
        .querySelector(".footer-usage-meter")
        ?.hasAttribute("data-forecast"),
    ).toBe(false);
    expect(
      container.querySelector(".footer-usage-account")?.hasAttribute("title"),
    ).toBe(false);
  });

  it("marks the meter and says when a limit comes before its reset", async () => {
    // Half a point a minute for the last forty minutes.
    stored.set(
      USAGE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        windows: {
          "claude.session": [-40, -30, -20, -10].map((minute, index) => [
            minutes(minute),
            40 + index * 5,
            minutes(237),
          ]),
        },
      }),
    );
    api.claude.mockImplementation(async () => ({
      ...claudeLimits(),
      session: { usedPercent: 60, windowMinutes: 300, resetsAt: minutes(237) },
    }));
    await render({ providers: ["claude"] });
    expect(
      container
        .querySelector(".footer-usage-meter")
        ?.getAttribute("data-forecast"),
    ).toBe("warning");
    expect(
      container.querySelector(".footer-usage-account")?.getAttribute("title"),
    ).toBe("5-hour: ~1h 20m to limit at this pace · resets in 3h 57m");
    expect(button(/Show usage details/).getAttribute("aria-label")).toBe(
      "Claude Code usage 60% 3h 57m, 15% 4d 17h, 5-hour limit in about an hour at this pace. Show usage details",
    );
    await act(async () => button(/Show usage details/).click());
    const detail = container.querySelector<HTMLElement>(
      '[aria-label="Claude Code usage"] .usage-panel-detail[data-warning]',
    );
    expect(detail?.textContent).toBe(
      "~1h 20m to limit at this pace · resets in 3h 57m",
    );
  });

  it("keeps an error out of the way and renders nothing without data", async () => {
    api.claude.mockRejectedValueOnce(new Error("offline"));
    await render({ providers: ["claude"] });
    expect(container.textContent).toContain("Usage unavailable");
    await render({ providers: [], context: null });
    expect(container.textContent).toBe("");
  });
});
