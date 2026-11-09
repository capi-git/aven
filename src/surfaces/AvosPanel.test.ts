// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newCrew, type Crew } from "../lib/crews";
import { memoryStorage } from "../lib/devSmoke";
import type { ScheduledAgent, ScheduledRun } from "../lib/scheduledAgents";
import type { BoardCard } from "../lib/workBoard";
import {
  AVOS_PANEL_WIDTH_KEY,
  AvosPanel,
  AvosTabBody,
  activityLevels,
  helperSteps,
  type AvosPanelProps,
} from "./AvosPanel";
import { memberAppLine } from "../chrome/crewSettingsParts";

const enabled = vi.hoisted(() => ({ calls: [] as [string, boolean][] }));
vi.mock("../lib/scheduledAgents", async (original) => ({
  ...(await original<typeof import("../lib/scheduledAgents")>()),
  setScheduledAgentEnabled: (id: string, on: boolean) =>
    enabled.calls.push([id, on]),
}));
vi.mock("../chrome/ProjectMark", () => ({ ProjectMark: () => null }));

const PATH = "/Users/me/holo";
const NOW = new Date(2026, 10, 8, 15, 0).getTime();
const DAY = 24 * 60 * 60_000;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  enabled.calls = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", memoryStorage());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function props(patch: Partial<AvosPanelProps> = {}): AvosPanelProps {
  const crew: Crew = { ...newCrew(PATH, NOW - 30 * DAY), on: true, onAt: 1 };
  return {
    project: PATH,
    crew,
    glance: { path: PATH, note: null, state: "resting", line: "" },
    line: "Looking after HOLO",
    goal: undefined,
    watching: [],
    members: [],
    batch: null,
    dailyCap: false,
    now: NOW,
    onOpen: () => {},
    onHelper: () => {},
    onActivity: () => {},
    onReview: () => {},
    name: (who) => who,
    tab: "overview",
    onTab: () => {},
    jobs: [],
    runs: [],
    shipped: [],
    range: null,
    onOpenJob: () => {},
    helper: null,
    onCloseHelper: () => {},
    onWatch: () => {},
    onStopHelper: () => {},
    onPosts: () => {},
    ...patch,
  };
}

async function draw(patch: Partial<AvosPanelProps>) {
  await act(async () => root.render(createElement(AvosTabBody, props(patch))));
}

const job = (patch: Partial<ScheduledAgent> = {}) =>
  ({
    id: "digest",
    name: "Morning digest",
    schedule: { kind: "days", days: [1, 2, 3, 4, 5], time: "08:00" },
    enabled: true,
    nextRunAt: NOW + 17 * 60 * 60_000,
    createdAt: 1,
    ...patch,
  }) as ScheduledAgent;

describe("what it did", () => {
  it("counts applied work a day, over 26 weeks ending today, capped at 4", () => {
    const levels = activityLevels(
      [NOW, NOW - 1000, NOW - DAY, ...Array(6).fill(NOW - 2 * DAY)],
      NOW,
    );
    expect(levels).toHaveLength(26 * 7);
    expect(levels.at(-1)).toBe(2);
    expect(levels.at(-2)).toBe(1);
    expect(levels.at(-3)).toBe(4);
    // Older than 26 weeks: not on the grid.
    expect(
      activityLevels([NOW - 400 * DAY], NOW).every((level) => level === 0),
    ).toBe(true);
  });

  it("shows the grid, today's numbers, what's next and what's new on Overview", async () => {
    const shipped = [
      { id: "a", title: "Flat sign-in styling", at: NOW - 60_000 } as BoardCard,
    ];
    await draw({ shipped, jobs: [job()] });
    expect(container.querySelectorAll(".avos-panel-grid > i")).toHaveLength(
      26 * 7,
    );
    expect(
      container.querySelector('.avos-panel-grid > i[data-level="1"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("1 change applied in 6 months");
    expect(container.textContent).toContain("Morning digest");
    expect(container.textContent).toContain("Flat sign-in styling · applied");
  });
});

describe("Habits", () => {
  it("lists its jobs with their schedule and last run, each with a switch", async () => {
    const runs = [
      {
        id: "r1",
        scheduleId: "digest",
        startedAt: NOW - 7 * 60 * 60_000,
        status: "succeeded",
        summary: "Posted a summary",
      } as unknown as ScheduledRun,
    ];
    const open = vi.fn();
    await draw({ tab: "habits", jobs: [job()], runs, onOpenJob: open });
    const row = container.querySelector<HTMLElement>(
      '[data-avos-habit="digest"]',
    )!;
    expect(row.textContent).toContain("Morning digest");
    expect(row.textContent).toContain("Weekdays at 08:00");
    expect(row.textContent).toContain("Posted a summary");
    await act(async () =>
      row.querySelector<HTMLButtonElement>('[role="switch"]')!.click(),
    );
    expect(enabled.calls).toEqual([["digest", false]]);
    await act(async () =>
      row.querySelector<HTMLButtonElement>(".avos-panel-habit-text")!.click(),
    );
    expect(open).toHaveBeenCalledWith("digest");
  });

  it("says how to get one when it has none", async () => {
    await draw({ tab: "habits" });
    expect(container.textContent).toContain(
      "Ask Avos to do something on a schedule",
    );
  });
});

describe("Documents", () => {
  it("shows what it wrote up, newest first", async () => {
    const base = props().crew;
    const crew: Crew = {
      ...base,
      cards: [
        {
          id: "c1",
          title: "What the user list needs",
          brief: "x",
          from: "you",
          kind: "research",
          stage: "ready",
          round: 0,
          maxRounds: 3,
          at: NOW - DAY,
          findings: {
            summary: "Five calls cover the list.",
            findings: [],
            ideas: [],
            sources: 2,
            readAt: NOW - 60_000,
          },
        } as unknown as Crew["cards"][number],
      ],
    };
    await draw({ tab: "documents", crew });
    const doc = container.querySelector<HTMLElement>('[data-avos-doc="f:c1"]')!;
    expect(doc.textContent).toContain("What the user list needs");
    expect(doc.textContent).toContain("Findings · 2 sources");
    expect(doc.textContent).toContain("Five calls cover the list.");
  });
});

describe("the panel's width", () => {
  it("drags by its left edge (or arrow keys), and is remembered for every Avos", async () => {
    await act(async () => root.render(createElement(AvosPanel, props())));
    const panel = container.querySelector<HTMLElement>("aside.avos-panel")!;
    const edge = panel.querySelector<HTMLElement>("[data-avos-panel-resizer]")!;
    expect(edge.getAttribute("role")).toBe("separator");
    expect(panel.style.width).toBe("380px");
    // Wider by the keyboard (the left edge moves left).
    await act(async () =>
      edge.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    );
    expect(panel.style.width).toBe("400px");
    expect(localStorage.getItem(AVOS_PANEL_WIDTH_KEY)).toBe("400");
    // The next Avos screen opens at that width.
    await act(async () => root.render(createElement("div")));
    await act(async () => root.render(createElement(AvosPanel, props())));
    expect(
      container.querySelector<HTMLElement>("aside.avos-panel")!.style.width,
    ).toBe("400px");
  });
});

describe("a helper's page", () => {
  it("names each job once, with what it did under it", () => {
    const steps = helperSteps([
      {
        id: "1",
        at: 1,
        title: "Add /health",
        text: "Builder started “Add /health”",
      },
      {
        id: "2",
        at: 2,
        title: "Add /health",
        text: "Added a /health endpoint.",
      },
      { id: "3", at: 3, title: "Fix tabs", text: "Builder started “Fix tabs”" },
    ]);
    expect(steps).toEqual([
      {
        id: "1",
        at: 2,
        title: "Add /health",
        texts: ["Added a /health endpoint."],
      },
      { id: "3", at: 3, title: "Fix tabs", texts: ["Started"] },
    ]);
  });

  it("says a Builder you haven't set runs on what new helpers run on", () => {
    const builder = {
      id: "builder",
      role: "builder" as const,
      harness: "claude" as const,
      model: "claude:sonnet-5",
    };
    expect(memberAppLine(builder, {})).toBe("Claude · Opus 5.5 · Medium");
    expect(memberAppLine(builder, { helperModel: "avos" })).toBe(
      "Claude · Avos picks per job",
    );
    expect(memberAppLine({ ...builder, chosen: true }, {})).toBe(
      "Claude · Sonnet 5",
    );
  });
});
