// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "../lib/rateLimits";
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
beforeEach(() => {
  vi.clearAllMocks();
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

  it("keeps an error out of the way and renders nothing without data", async () => {
    api.claude.mockRejectedValueOnce(new Error("offline"));
    await render({ providers: ["claude"] });
    expect(container.textContent).toContain("Usage unavailable");
    await render({ providers: [], context: null });
    expect(container.textContent).toBe("");
  });
});
