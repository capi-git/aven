// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSession } from "./session";
import {
  projectSessionSummaries,
  workspaceProfilePreviews,
} from "./sidebarData";
import { SESSION_LIST_PAGE } from "./sessionListWindow";
import type { SessionSummary } from "./sessionStore";
import { DEFAULT_WORKSPACE_PROFILES } from "./workspaceProfiles";

const APP = "/Users/me/app";
const SITE = "/Users/me/site";

function summary(
  id: string,
  cwd: string,
  updatedAt: number,
  extra: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    id,
    cwd,
    harness: "claude",
    model: "claude:sonnet-5",
    runtimeMode: "supervised",
    title: `Task ${id}`,
    createdAt: updatedAt,
    updatedAt,
    additions: 0,
    deletions: 0,
    ...extra,
  };
}

const profiles = DEFAULT_WORKSPACE_PROFILES.map((profile) => ({ ...profile }));

function stubStorage() {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(stubStorage);
afterEach(() => vi.unstubAllGlobals());

describe("projectSessionSummaries", () => {
  it("lists each project's own tasks, live ones included", () => {
    const live = {
      ...newSession("claude", SITE),
      id: "live",
      blocks: [{ id: "u", role: "user" as const, text: "hi" }],
      busy: true,
    };
    const rows = projectSessionSummaries(
      [
        { path: APP, openedAt: 1 },
        { path: SITE, openedAt: 2 },
      ],
      [summary("a", APP, 1), summary("s", SITE, 2)],
      [live],
      [],
    );
    expect(Object.keys(rows)).toEqual([APP, SITE]);
    expect(rows[APP].map((row) => row.id)).toEqual(["a"]);
    expect(rows[SITE].map((row) => row.id).sort()).toEqual(["live", "s"]);
  });
});

describe("workspaceProfilePreviews", () => {
  it("previews each workspace's projects with their newest open tasks", () => {
    const history = [
      summary("old", APP, 1),
      summary("new", APP, 3),
      summary("archived", APP, 4, { archived: true }),
      summary("lead", APP, 5, { orchestrationLeadId: "x" }),
      summary("site", SITE, 2),
    ];
    const previews = workspaceProfilePreviews({
      profiles,
      projectsByProfile: {
        personal: [{ path: APP, openedAt: 1 }],
        work: [{ path: SITE, openedAt: 1 }],
      },
      history,
      sessions: [],
      runs: [],
      busySessionIds: new Set(["new"]),
      nameFor: (path) => `name:${path}`,
    });
    expect(previews.personal).toEqual({
      id: "personal",
      name: "Personal",
      projects: [
        {
          path: APP,
          name: `name:${APP}`,
          tasks: [
            { id: "new", title: "Task new", busy: true },
            { id: "old", title: "Task old", busy: false },
          ],
        },
      ],
      standaloneTasks: [],
    });
    expect(previews.work.projects[0].tasks.map((task) => task.id)).toEqual([
      "site",
    ]);
  });

  it("keeps one page of tasks per project", () => {
    const history = Array.from({ length: SESSION_LIST_PAGE + 5 }, (_, index) =>
      summary(`t${index}`, APP, index),
    );
    const previews = workspaceProfilePreviews({
      profiles,
      projectsByProfile: { personal: [{ path: APP, openedAt: 1 }] },
      history,
      sessions: [],
      runs: [],
      busySessionIds: new Set(),
      nameFor: (path) => path,
    });
    const tasks = previews.personal.projects[0].tasks;
    expect(tasks).toHaveLength(SESSION_LIST_PAGE);
    expect(tasks[0].id).toBe(`t${SESSION_LIST_PAGE + 4}`);
    expect(previews.work.projects).toEqual([]);
  });
});
