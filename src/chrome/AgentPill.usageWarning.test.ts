// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "../lib/rateLimits";

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));
vi.mock("../lib/harness/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/registry")>()),
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));

const { AgentPill } = await import("./AgentPill");
const { CLAUDE_OPUS_5_5_MODEL, resetHarnessModelOverlays, setHarnessModels } =
  await import("../lib/models");
const { recordUsage, resetUsageForecasts, USAGE_WARNINGS_SEEN_KEY } =
  await import("../lib/usageHistory");

const NOW = new Date("2026-10-15T12:00:00Z").getTime();
const MINUTE = 60_000;

let root: Root;
let host: HTMLDivElement;
let composer: HTMLTextAreaElement;
let storage: Map<string, string>;
let props: ComponentProps<typeof AgentPill>;

function usage(
  provider: "claude" | "codex",
  minute: number,
  session: number,
): ProviderRateLimits {
  return {
    provider,
    session: {
      usedPercent: session,
      windowMinutes: 300,
      resetsAt: NOW + 237 * MINUTE,
    },
    weekly: {
      usedPercent: 20,
      windowMinutes: 10_080,
      resetsAt: NOW + 5 * 24 * 60 * MINUTE,
    },
    updatedAt: NOW + minute * MINUTE,
    error: null,
    status: "ok",
  };
}

/** Claude's 5-hour window fills half a point a minute; Codex has room. */
function recordClaudeRunningOut() {
  for (const [minute, used] of [
    [-40, 40],
    [-30, 45],
    [-20, 50],
    [-10, 55],
    [0, 60],
  ]) {
    vi.setSystemTime(NOW + minute * MINUTE);
    recordUsage(usage("claude", minute, used));
  }
  recordUsage(usage("codex", 0, 12));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  storage = new Map([["monocode.modelPickerTab", "claude"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  resetUsageForecasts();
  setHarnessModels("codex", [
    { id: "codex:gpt-5.5", harness: "codex", name: "GPT-5.5" },
    { id: "codex:gpt-5.4-mini", harness: "codex", name: "GPT-5.4 Mini" },
  ]);
  host = document.createElement("div");
  composer = document.createElement("textarea");
  document.body.append(host, composer);
  root = createRoot(host);
  props = {
    harness: "claude",
    model: CLAUDE_OPUS_5_5_MODEL.id,
    modelSettings: { effort: "low", fast: "false" },
    runtimeMode: "supervised",
    showAccess: true,
    busy: false,
    hotkeys: true,
    onModelChange: vi.fn(),
    onModelSettingsChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onClose: vi.fn(() => composer.focus()),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  composer.remove();
  document.body.innerHTML = "";
  resetHarnessModelOverlays();
  resetUsageForecasts();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(AgentPill, props)));
}
const pill = () => host.querySelector<HTMLButtonElement>("[data-agent-pill]")!;
const dot = () => pill().querySelector(".agent-pill-usage");
const line = () =>
  document.body.querySelector<HTMLElement>(
    "[data-agent-panel] [data-usage-warning]",
  );
const action = (label: string) =>
  [...(line()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === label,
  );
async function toggle() {
  await act(async () => pill().click());
}

describe("the agent pill's usage warning", () => {
  it("stays out of the way without a warning", async () => {
    recordUsage(usage("claude", 0, 60));
    await render();
    expect(dot()).toBeNull();
    expect(pill().getAttribute("aria-label")).not.toContain("Usage");
    await toggle();
    expect(line()).toBeNull();
  });

  it("marks the pill once, then says what is coming with one-click ways out", async () => {
    recordClaudeRunningOut();
    await render();
    expect(dot()).not.toBeNull();
    expect(pill().getAttribute("aria-label")).toContain("Usage limit close");
    await toggle();
    expect(line()?.getAttribute("role")).toBe("status");
    expect(line()?.querySelector("p")?.textContent).toBe(
      "At this pace you'll hit Claude's 5-hour limit in about an hour.",
    );
    expect(
      [...line()!.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Switch to Codex", "Use Claude Sonnet 5"]);
    expect(action("Switch to Codex")?.title).toBe(
      "Continue with Codex · GPT-5.5 (80% of its weekly limit left)",
    );
    // Seen once: the pill goes quiet, the panel keeps the line.
    expect(dot()).toBeNull();
    expect(storage.has(USAGE_WARNINGS_SEEN_KEY)).toBe(true);
    await toggle();
    await toggle();
    expect(dot()).toBeNull();
    expect(line()).not.toBeNull();
  });

  it("switches to the account with room and hands focus back", async () => {
    recordClaudeRunningOut();
    await render();
    await toggle();
    await act(async () => action("Switch to Codex")!.click());
    expect(props.onModelChange).toHaveBeenCalledExactlyOnceWith(
      "codex",
      "codex:gpt-5.5",
    );
    expect(line()).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("switches to a lighter model of the same provider", async () => {
    recordClaudeRunningOut();
    await render();
    await toggle();
    await act(async () => action("Use Claude Sonnet 5")!.click());
    expect(props.onModelChange).toHaveBeenCalledExactlyOnceWith(
      "claude",
      "claude:sonnet-5",
    );
  });

  it("marks the pill again only when the pace picks up", async () => {
    recordClaudeRunningOut();
    await render();
    await toggle();
    await toggle();
    expect(dot()).toBeNull();
    // A slightly faster reading is the same warning.
    vi.setSystemTime(NOW + 5 * MINUTE);
    await act(async () => recordUsage(usage("claude", 5, 63)));
    expect(dot()).toBeNull();
    // Half as fast again is news.
    vi.setSystemTime(NOW + 10 * MINUTE);
    await act(async () => recordUsage(usage("claude", 10, 80)));
    expect(dot()).not.toBeNull();
  });

  it("never warns for a provider that does not report usage", async () => {
    recordClaudeRunningOut();
    props.harness = "cursor";
    props.model = "cursor:composer-2.5";
    await render();
    expect(dot()).toBeNull();
    await toggle();
    expect(line()).toBeNull();
  });
});
