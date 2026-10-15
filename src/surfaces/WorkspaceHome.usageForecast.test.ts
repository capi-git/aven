// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USAGE_STORAGE_KEY } from "../lib/rateLimits";
import { resetUsageForecasts, USAGE_HISTORY_KEY } from "../lib/usageHistory";
import { WorkspaceHome } from "./WorkspaceHome";

const NOW = new Date("2026-10-03T12:00:00Z").getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let root: Root;
let container: HTMLDivElement;
let storage: Map<string, string>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  resetUsageForecasts();
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

function props(): ComponentProps<typeof WorkspaceHome> {
  return {
    profile: "Personal",
    needsYou: [],
    running: [],
    projects: [],
    recent: [],
    usageProviders: ["claude"],
    onNew: vi.fn(),
    onBrowser: vi.fn(),
    onSearch: vi.fn(),
    onProject: vi.fn(),
    onSession: vi.fn(),
    onNewProjectTask: vi.fn(),
    onAddProject: vi.fn(),
    onLoadProjects: vi.fn(),
  };
}

const usage = () =>
  [...container.querySelectorAll("section[aria-labelledby]")].find(
    (element) =>
      document.getElementById(element.getAttribute("aria-labelledby")!)
        ?.textContent === "Usage",
  ) as HTMLElement | undefined;

function saveUsage(session: number, weekly: number) {
  storage.set(
    USAGE_STORAGE_KEY,
    JSON.stringify({
      claude: {
        provider: "claude",
        status: "ok",
        error: null,
        updatedAt: NOW,
        session: {
          usedPercent: session,
          windowMinutes: 300,
          resetsAt: NOW + 237 * MINUTE,
        },
        weekly: {
          usedPercent: weekly,
          windowMinutes: 10_080,
          resetsAt: NOW + 5 * 24 * HOUR,
        },
      },
    }),
  );
}

describe("Usage forecasts on Home", () => {
  it("shows how long each window lasts at this pace", async () => {
    saveUsage(60, 20);
    storage.set(
      USAGE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        windows: {
          // Half a point a minute: the 5-hour limit in 80 minutes.
          "claude.session": [-40, -30, -20, -10, 0].map((minute, index) => [
            NOW + minute * MINUTE,
            40 + index * 5,
            NOW + 237 * MINUTE,
          ]),
          // Ten points a day: the week resets first.
          "claude.weekly": [
            [NOW - 24 * HOUR, 10, NOW + 5 * 24 * HOUR],
            [NOW - 12 * HOUR, 15, NOW + 5 * 24 * HOUR],
            [NOW, 20, NOW + 5 * 24 * HOUR],
          ],
        },
      }),
    );
    await act(async () => root.render(createElement(WorkspaceHome, props())));
    const notes = [
      ...usage()!.querySelectorAll<HTMLElement>(".usage-forecast-note"),
    ];
    expect(notes.map((note) => note.textContent)).toEqual([
      "~1h 20m to limit at this pace",
      "Lasts until reset at this pace",
    ]);
    expect(notes.map((note) => note.dataset.state)).toEqual([
      "warning",
      "clear",
    ]);
  });

  it("adds nothing until there is a pace to show", async () => {
    saveUsage(34, 20);
    await act(async () => root.render(createElement(WorkspaceHome, props())));
    expect(usage()?.textContent).toContain("34% · resets in 3h 57m");
    expect(usage()?.querySelector(".usage-forecast-note")).toBeNull();
  });
});
