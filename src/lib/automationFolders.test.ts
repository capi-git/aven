// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

import {
  automationTiming,
  automationTone,
  groupAutomationsByProject,
  lastRunLabel,
  loadCollapsedFolders,
  NO_PROJECT_FOLDER,
  setFolderCollapsed,
  shortAgo,
} from "./automationFolders";
import {
  EVERY_DAY,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";

const SITE = "/work/site";
const NOTES = "/work/notes";
const SCRATCH = "/app/projectless-workspaces/personal";

const agent = (patch: Partial<ScheduledAgent>): ScheduledAgent => ({
  id: "a",
  name: "A",
  prompt: "Do it",
  project: SITE,
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  schedule: { kind: "weekly", days: EVERY_DAY, time: "09:00" },
  enabled: true,
  createdAt: 0,
  nextRunAt: null,
  ...patch,
});

const run = (patch: Partial<ScheduledRun>): ScheduledRun => ({
  id: "r",
  scheduleId: "a",
  name: "A",
  project: SITE,
  status: "completed",
  summary: "",
  startedAt: 0,
  ...patch,
});

const isProjectless = (path: string) => path === SCRATCH;

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
});

describe("automation folders", () => {
  it("groups automations into a folder per project, No project last", () => {
    const folders = groupAutomationsByProject(
      [
        agent({ id: "tests", name: "Nightly tests" }),
        agent({ id: "brief", name: "Morning briefing" }),
        agent({ id: "deps", name: "Dependency check", project: NOTES }),
        agent({ id: "inbox", name: "Inbox triage", project: "" }),
        agent({ id: "news", name: "News", project: SCRATCH }),
        // The same folder, written another way.
        agent({ id: "lint", name: "Lint", project: `${SITE}/` }),
      ],
      [],
      { isProjectless },
    );
    expect(
      folders.map((folder) => [
        folder.key,
        folder.name,
        folder.items.map((item) => item.name),
      ]),
    ).toEqual([
      [NOTES, "notes", ["Dependency check"]],
      [SITE, "site", ["Lint", "Morning briefing", "Nightly tests"]],
      [NO_PROJECT_FOLDER, "No project", ["Inbox triage", "News"]],
    ]);
    expect(folders.at(-1)!.project).toBeNull();
  });

  it("puts each automation's runs under it, newest first", () => {
    const [folder] = groupAutomationsByProject(
      [agent({ id: "a" })],
      [
        run({ id: "old", startedAt: 1 }),
        run({ id: "new", startedAt: 3 }),
        run({ id: "other", scheduleId: "b", startedAt: 2 }),
      ],
      { isProjectless },
    );
    expect(folder!.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(folder!.items[0]!.runs.map((item) => item.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("keeps a deleted automation's runs in their project, after the others", () => {
    const folders = groupAutomationsByProject(
      [agent({ id: "a", name: "Zebra" })],
      [
        run({
          id: "1",
          scheduleId: "gone",
          name: "Old report",
          project: NOTES,
        }),
        run({ id: "2", scheduleId: "gone2", name: "Archive", project: SITE }),
      ],
      { isProjectless },
    );
    expect(
      folders.map((folder) => [
        folder.name,
        folder.items.map((item) => [item.name, !!item.agent]),
      ]),
    ).toEqual([
      ["notes", [["Old report", false]]],
      [
        "site",
        [
          ["Zebra", true],
          ["Archive", false],
        ],
      ],
    ]);
  });

  it("moving an automation to another project moves it to that folder", () => {
    const before = groupAutomationsByProject([agent({ id: "a" })], [], {
      isProjectless,
    });
    const after = groupAutomationsByProject(
      [agent({ id: "a", project: NOTES })],
      [run({ id: "1", project: SITE })],
      { isProjectless },
    );
    expect(before.map((folder) => folder.key)).toEqual([SITE]);
    // Its runs follow it, wherever they ran.
    expect(after.map((folder) => folder.key)).toEqual([NOTES]);
    expect(after[0]!.items[0]!.runs).toHaveLength(1);
  });

  it("describes a row's status and timing in plain words", () => {
    const now = new Date(2026, 9, 21, 10, 30).getTime();
    const on = agent({
      schedule: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "08:30" },
      nextRunAt: new Date(2026, 9, 22, 8, 30).getTime(),
    });
    const [folder] = groupAutomationsByProject(
      [on],
      [
        run({
          status: "failed",
          startedAt: now - 3 * 3_600_000,
          finishedAt: now - 2 * 3_600_000,
        }),
      ],
      { isProjectless },
    );
    const item = folder!.items[0]!;
    expect(automationTiming(item, now)).toMatch(
      /^Weekdays at 08:30 · Next Tomorrow /,
    );
    expect(automationTone(item)).toBe("failed");
    expect(lastRunLabel(item, now)).toBe("Last run failed 2h ago");
    const off = { ...item, agent: { ...on, enabled: false }, runs: [] };
    expect(automationTiming(off, now)).toBe("Weekdays at 08:30 · Off");
    expect(automationTone(off)).toBe("off");
    expect(lastRunLabel(off, now)).toBe("Not run yet");
    expect(shortAgo(now - 3 * 86_400_000, now)).toBe("3d");
  });

  it("remembers folded folders under an aven. key", () => {
    setFolderCollapsed(SITE, true);
    setFolderCollapsed(NO_PROJECT_FOLDER, true);
    expect([...loadCollapsedFolders()]).toEqual([SITE, NO_PROJECT_FOLDER]);
    expect(localStorage.getItem("aven.automations.collapsedFolders.v1")).toBe(
      JSON.stringify([SITE, NO_PROJECT_FOLDER]),
    );
    setFolderCollapsed(SITE, false);
    setFolderCollapsed(NO_PROJECT_FOLDER, false);
    expect(loadCollapsedFolders().size).toBe(0);
    expect(localStorage.getItem("aven.automations.collapsedFolders.v1")).toBe(
      null,
    );
  });
});
