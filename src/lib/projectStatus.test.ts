import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "./activity";
import { encodeSidebarValue, decodeSidebarValue } from "./floatingSidebar";
import {
  describeProjectStatus,
  mergeProjectStatus,
  projectStatusFor,
  sameProjectStatus,
  sessionProjectCounts,
  unreadProjectCounts,
} from "./projectStatus";
import type { Session } from "./session";
import { NO_LEAD_DECIDED } from "./teamAttention";

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? "s",
    cwd: APP,
    blocks: [],
    busy: false,
    ...overrides,
  } as Session;
}

function approval(decided = false) {
  return {
    id: "b",
    role: "tool",
    text: "",
    approval: { id: "a", decided },
  } as unknown as Session["blocks"][number];
}

function activity(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: overrides.id ?? `${overrides.sessionId}:${overrides.outcome}`,
    sessionId: "s",
    outcome: "completed",
    title: "",
    summary: "",
    cwd: APP,
    harness: "claude",
    model: "",
    createdAt: 1,
    readAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe("sessionProjectCounts", () => {
  it("counts running and waiting sessions per project, ignoring idle ones", () => {
    const counts = sessionProjectCounts(
      [
        session({ id: "1", busy: true }),
        session({ id: "2", busy: true, cwd: `${APP}/` }),
        session({ id: "3" }),
        session({ id: "4", cwd: SITE, blocks: [approval()] }),
        session({ id: "5", cwd: SITE, blocks: [approval(true)] }),
      ],
      NO_LEAD_DECIDED,
    );
    expect(counts).toEqual({
      [APP]: { running: 2, waiting: 0 },
      [SITE]: { running: 0, waiting: 1 },
    });
  });

  it("does not count a turn paused on an approval as running", () => {
    expect(
      sessionProjectCounts(
        [session({ busy: true, blocks: [approval()] })],
        NO_LEAD_DECIDED,
      ),
    ).toEqual({ [APP]: { running: 0, waiting: 1 } });
  });

  it("keeps working through an optional question, which still waits for the user", () => {
    const counts = sessionProjectCounts(
      [
        session({
          busy: true,
          pendingQuestion: { blocking: false } as Session["pendingQuestion"],
        }),
      ],
      NO_LEAD_DECIDED,
    );
    expect(counts).toEqual({ [APP]: { running: 1, waiting: 1 } });
  });

  it("counts live background agents as running and skips home", () => {
    const counts = sessionProjectCounts(
      [
        session({
          liveAgents: [
            { id: "w", status: "running" },
          ] as unknown as Session["liveAgents"],
        }),
        session({ id: "home", cwd: "~", busy: true }),
      ],
      NO_LEAD_DECIDED,
    );
    expect(counts).toEqual({ [APP]: { running: 1, waiting: 0 } });
  });
});

describe("unreadProjectCounts", () => {
  it("counts sessions with unseen finished replies, once each", () => {
    expect(
      unreadProjectCounts([
        activity({ id: "1", sessionId: "a" }),
        activity({ id: "2", sessionId: "a", outcome: "failed" }),
        activity({ id: "3", sessionId: "b", outcome: "stopped" }),
        activity({ id: "4", sessionId: "c", readAt: 5 }),
        activity({ id: "5", sessionId: "d", outcome: "approval" }),
        activity({ id: "6", sessionId: "e", cwd: SITE }),
      ]),
    ).toEqual({ [APP]: 2, [SITE]: 1 });
  });
});

describe("mergeProjectStatus", () => {
  it("joins sessions, unread replies and changed files, leaving out quiet projects", () => {
    const merged = mergeProjectStatus(
      { [APP]: { running: 1, waiting: 0 } },
      { [SITE]: 3 },
      { [APP]: 12, "/Users/me/clean": 0 },
    );
    expect(merged).toEqual({
      [APP]: { running: 1, waiting: 0, unread: 0, files: 12 },
      [SITE]: { running: 0, waiting: 0, unread: 3 },
    });
    expect(projectStatusFor(merged, `${APP}/`)).toBe(merged[APP]);
  });

  it("returns one shared empty map when nothing is happening", () => {
    expect(mergeProjectStatus({}, {}, {})).toBe(mergeProjectStatus({}, {}, {}));
  });

  it("compares structurally so unchanged status keeps its identity upstream", () => {
    const a = mergeProjectStatus({ [APP]: { running: 1, waiting: 0 } }, {}, {});
    const b = mergeProjectStatus({ [APP]: { running: 1, waiting: 0 } }, {}, {});
    expect(sameProjectStatus(a, b)).toBe(true);
    expect(
      sameProjectStatus(
        a,
        mergeProjectStatus({ [APP]: { running: 2, waiting: 0 } }, {}, {}),
      ),
    ).toBe(false);
    expect(sameProjectStatus(a, mergeProjectStatus({}, {}, { [APP]: 1 }))).toBe(
      false,
    );
  });

  it("survives the floating sidebar's snapshot encoding", () => {
    const merged = mergeProjectStatus(
      { [APP]: { running: 1, waiting: 1 } },
      { [APP]: 2 },
      { [APP]: 4 },
    );
    expect(
      decodeSidebarValue(
        JSON.parse(JSON.stringify(encodeSidebarValue(merged))),
      ),
    ).toEqual(merged);
  });
});

describe("describeProjectStatus", () => {
  it("spells out every part in order", () => {
    expect(
      describeProjectStatus({ running: 2, waiting: 1, unread: 3, files: 12 }),
    ).toBe(
      "2 agents running · 1 waiting for you · 3 unread · 12 files changed",
    );
    expect(
      describeProjectStatus({ running: 1, waiting: 0, unread: 0, files: 1 }),
    ).toBe("1 agent running · 1 file changed");
    expect(describeProjectStatus(undefined)).toBe("");
  });
});

describe("a team waiting on you", () => {
  it("counts its chat as waiting in its project, once", () => {
    const counts = sessionProjectCounts(
      [session({ id: "a", busy: true })],
      NO_LEAD_DECIDED,
      [
        { sessionId: "b", project: SITE },
        { sessionId: "b", project: SITE },
        { sessionId: "a", project: APP },
      ],
    );
    expect(counts).toEqual({
      [APP]: { running: 1, waiting: 1 },
      [SITE]: { running: 0, waiting: 1 },
    });
  });
});
