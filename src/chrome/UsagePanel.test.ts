// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsagePanelSnapshot } from "../lib/usagePanel";
import {
  type ProviderRateLimits,
  idleRateLimits,
  parseClaudeOAuthUsage,
  fetchingRateLimits,
  errorRateLimits,
} from "../lib/rateLimits";
import { UsagePanelContent } from "./UsagePanel";

let container: HTMLDivElement;
let root: Root;
const now = new Date("2026-09-15T18:00:00Z").getTime();
const onRefresh = vi.fn();
const onClose = vi.fn();

function provider(
  overrides: Partial<ProviderRateLimits> = {},
): ProviderRateLimits {
  return {
    provider: "codex",
    status: "ok",
    updatedAt: now,
    error: null,
    session: { usedPercent: 25, windowMinutes: 300, resetsAt: now + 7_200_000 },
    weekly: {
      usedPercent: 80,
      windowMinutes: 10_080,
      resetsAt: now + 172_800_000,
    },
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<UsagePanelSnapshot> = {},
): UsagePanelSnapshot {
  return {
    context: { used: 307_000, window: 1_000_000 },
    costUsd: null,
    providers: [provider(), provider({ provider: "claude" })],
    theme: { mode: "dark", accent: "#62d1ca" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(value = snapshot()) {
  await act(async () =>
    root.render(
      createElement(UsagePanelContent, { snapshot: value, onRefresh, onClose }),
    ),
  );
}

function bar(label: string) {
  return container.querySelector<HTMLElement>(
    `[role="progressbar"][aria-label="${label} remaining"]`,
  )!;
}

describe("usage panel", () => {
  it("shows reported Fable weekly allowances with their own remaining usage and reset", async () => {
    const claude = parseClaudeOAuthUsage(
      JSON.stringify({
        five_hour: { utilization: 80 },
        seven_day: { utilization: 2 },
        limits: [
          {
            kind: "weekly_scoped",
            percent: 42,
            resets_at: now + 172_800_000,
            scope: { model: { display_name: "Fable 5" } },
          },
          {
            kind: "weekly_scoped",
            percent: 0,
            resets_at: null,
            scope: { model: { display_name: "Fable 5.1" } },
          },
        ],
      }),
    );
    for (const limits of [
      claude,
      fetchingRateLimits("claude", claude),
      errorRateLimits("claude", "offline", claude),
    ]) {
      await render(snapshot({ providers: [limits] }));
      expect(bar("Claude Code Weekly").getAttribute("aria-valuenow")).toBe(
        "98",
      );
      expect(
        bar("Claude Code Fable 5 weekly").getAttribute("aria-valuenow"),
      ).toBe("58");
      expect(
        bar("Claude Code Fable 5 weekly").parentElement?.textContent,
      ).toContain("Resets in 2d");
      expect(
        bar("Claude Code Fable 5.1 weekly").getAttribute("aria-valuenow"),
      ).toBe("100");
      expect(
        bar("Claude Code Fable 5.1 weekly").parentElement?.textContent,
      ).toContain("Reset time not reported");
    }
  });

  it("does not invent a Fable allowance when absent or a percentage when unknown", async () => {
    await render();
    expect(container.textContent).not.toContain("Fable");
    const claude = parseClaudeOAuthUsage(
      JSON.stringify({
        limits: [
          {
            kind: "weekly_scoped",
            percent: null,
            scope: { model: { display_name: "Fable" } },
          },
        ],
      }),
    );
    await render(snapshot({ providers: [claude] }));
    const progress = bar("Claude Code Fable weekly");
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.getAttribute("aria-valuetext")).toBe("Unknown");
    expect(progress.parentElement?.textContent).toContain(
      "Not reported by provider",
    );
  });

  it("shows remaining capacity consistently for context and each provider window", async () => {
    await render();
    expect(bar("Selected task context").getAttribute("aria-valuenow")).toBe(
      "69",
    );
    expect(bar("Selected task context").getAttribute("aria-valuetext")).toBe(
      "69% remaining",
    );
    expect(container.textContent).toContain("31% used · 307K / 1M tokens");
    expect(bar("Codex 5-hour").getAttribute("aria-valuenow")).toBe("75");
    expect(bar("Codex Weekly").getAttribute("aria-valuenow")).toBe("20");
    expect(bar("Claude Code 5-hour").getAttribute("aria-valuenow")).toBe("75");
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(5);
    expect(
      container.querySelector('[role="slider"], input[type="range"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      "Provider limits apply across tasks.",
    );
  });

  it.each([
    [0, "100", "100%"],
    [100, "0", "0%"],
    [-4, "100", "100%"],
    [105, "0", "0%"],
  ])(
    "represents %s%% used as %s%% remaining without overflowing the bar",
    async (used, remaining, width) => {
      await render(
        snapshot({
          providers: [
            provider({
              session: {
                usedPercent: used,
                windowMinutes: 300,
                resetsAt: null,
              },
            }),
          ],
        }),
      );
      const progress = bar("Codex 5-hour");
      expect(progress.getAttribute("aria-valuenow")).toBe(remaining);
      expect(
        progress.querySelector<HTMLElement>(".usage-panel-fill")?.style.width,
      ).toBe(width);
    },
  );

  it("keeps idle, missing and invalid data unknown instead of drawing a full remaining bar", async () => {
    await render(
      snapshot({
        context: { used: 40_000 },
        providers: [
          idleRateLimits("codex"),
          provider({
            provider: "claude",
            session: null,
            weekly: {
              usedPercent: Number.NaN,
              windowMinutes: 10_080,
              resetsAt: null,
            },
          }),
        ],
      }),
    );
    for (const progress of container.querySelectorAll('[role="progressbar"]')) {
      expect(progress.hasAttribute("aria-valuenow")).toBe(false);
      expect(progress.querySelector(".usage-panel-fill")).toBeNull();
    }
    expect(container.textContent).toContain(
      "40K tokens used · capacity unavailable",
    );
    expect(container.textContent).toContain("Not checked yet");
    expect(container.textContent).toContain("Not reported by provider");
  });

  it("labels loading without inventing values and disables duplicate refresh requests", async () => {
    await render(
      snapshot({
        providers: [
          provider({ status: "fetching", session: null, weekly: null }),
        ],
      }),
    );
    expect(bar("Codex 5-hour").getAttribute("aria-valuetext")).toBe(
      "Checking usage",
    );
    expect(bar("Codex 5-hour").hasAttribute("aria-valuenow")).toBe(false);
    expect(container.textContent).toContain("Checking usage…");
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh provider usage"]',
    )!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("retains cached values during refresh and clearly marks failed refreshes", async () => {
    await render(snapshot({ providers: [provider({ status: "fetching" })] }));
    expect(bar("Codex 5-hour").getAttribute("aria-valuenow")).toBe("75");
    expect(container.textContent).toContain("Refreshing…");
    await render(
      snapshot({
        providers: [
          provider({ status: "error", error: "Could not connect to Codex." }),
        ],
      }),
    );
    expect(bar("Codex 5-hour").getAttribute("aria-valuenow")).toBe("75");
    expect(container.textContent).toContain("Last known usage");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Could not connect to Codex.",
    );
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Refresh provider usage"]',
      )?.disabled,
    ).toBe(false);
  });

  it("does not imply available quota when a provider is unavailable", async () => {
    await render(
      snapshot({
        providers: [
          provider({
            status: "unavailable",
            session: null,
            weekly: null,
            error: "Sign in to read usage.",
          }),
        ],
      }),
    );
    expect(bar("Codex 5-hour").hasAttribute("aria-valuenow")).toBe(false);
    expect(container.textContent).toContain("Usage unavailable");
    expect(container.textContent).toContain("Sign in to read usage.");
    expect(container.textContent).not.toContain("100% left");
  });

  it("shows reset countdowns and the exact local reset time, then asks for a fresh reading when due", async () => {
    await render(
      snapshot({
        providers: [
          provider({
            session: {
              usedPercent: 25,
              windowMinutes: 300,
              resetsAt: now + 60_000,
            },
          }),
        ],
      }),
    );
    const detail = container.querySelector<HTMLElement>(
      '[aria-label="Codex usage"] .usage-panel-detail',
    )!;
    expect(detail.textContent).toBe("Resets in 1m");
    expect(detail.title).toBe(
      `Resets ${new Date(now + 60_000).toLocaleString()}`,
    );
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(detail.textContent).toBe("Reset due · refresh usage");
    expect(bar("Codex 5-hour").getAttribute("aria-valuenow")).toBe("75");
  });

  it("exposes refresh, close and Escape without changing quota or access settings", async () => {
    await render();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Refresh provider usage"]',
        )!
        .click(),
    );
    expect(onRefresh).toHaveBeenCalledOnce();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Close usage"]')!
        .click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () =>
      container
        .querySelector<HTMLElement>(".usage-panel")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("honors the light palette and includes only a measured task cost", async () => {
    await render(
      snapshot({ theme: { mode: "light", accent: "#087e83" }, costUsd: 0 }),
    );
    expect(
      container.querySelector(".usage-panel")?.getAttribute("data-theme"),
    ).toBe("light");
    expect(container.textContent).toContain("Task cost $0.00");
    await render(snapshot({ costUsd: Number.NaN }));
    expect(container.textContent).not.toContain("Task cost");
  });

  it("applies custom workspace surface and foreground on successive snapshots", async () => {
    await render(
      snapshot({
        theme: {
          mode: "dark",
          accent: "#aaaab8",
          background: "#575757",
          text: "#ffffff",
        },
      }),
    );
    const panel = container.querySelector<HTMLElement>(".usage-panel")!;
    expect(panel.style.getPropertyValue("--toolbar-panel-bg")).toBe("#575757");
    expect(panel.style.getPropertyValue("--toolbar-panel-text")).toBe(
      "#ffffff",
    );
    await render(
      snapshot({
        theme: {
          mode: "light",
          accent: "#8f6b25",
          background: "#faf4e6",
          text: "#000000",
        },
      }),
    );
    expect(panel.style.getPropertyValue("--toolbar-panel-bg")).toBe("#faf4e6");
    expect(panel.style.getPropertyValue("--toolbar-panel-text")).toBe(
      "#000000",
    );
    expect(panel.style.getPropertyValue("--toolbar-panel-accent")).toBe(
      "#8f6b25",
    );
  });
});
