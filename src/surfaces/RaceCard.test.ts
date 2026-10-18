// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string) =>
    command === "race_diff"
      ? {
          files: [{ path: "a.ts" }, { path: "b.ts" }],
          additions: 12,
          deletions: 3,
        }
      : null,
  ),
}));
const suggest = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  isTauri: () => false,
}));
vi.mock("../lib/teamResult", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/teamResult")>()),
  requestRaceSuggestion: suggest,
}));

import { recordActivity } from "../lib/activity";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import {
  getRace,
  installRaceWorkspace,
  saveRace,
  updateRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import { installTeamWorkspace } from "../lib/teamWorkspace";
import { RaceCard, readyText } from "./RaceCard";

const record: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  origin: { sessionId: "chat", blockId: "msg" },
  lanes: [0, 1].map((slot) => ({
    sessionId: `l${slot}`,
    harness: slot ? ("codex" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Codex · GPT-5" : "Claude Code · Opus",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const lane = (id: string, busy: boolean): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [
    {
      id: `${id}-user`,
      role: "user",
      text: "Go",
      startedAt: 1_000,
      ...(busy ? {} : { durationMs: 65_000 }),
    },
    ...(busy
      ? []
      : [{ id: `${id}-reply`, role: "assistant" as const, text: "Fixed it." }]),
  ],
});

const completed = (sessionId: string) =>
  recordActivity({
    id: `${sessionId}:turn:t:completed`,
    sessionId,
    outcome: "completed",
    title: "",
    summary: "",
    cwd: "/work/site",
    harness: "claude",
    model: "m",
    createdAt: 70_000,
  });

let root: Root;
let container: HTMLDivElement;
let live: LiveSessionStore;
const compare = vi.fn();
const openChat = vi.fn();
const review = vi.fn();
const send = vi.fn(async () => true);
let uninstall: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  saveRace(record);
  live = createLiveSessionStore([lane("l0", false), lane("l1", true)]);
  completed("l0");
  uninstall = [
    installRaceWorkspace({
      stop: vi.fn(),
      settle: vi.fn(),
      release: vi.fn(),
      openChat,
      compare,
      retry: vi.fn(),
    }),
    installTeamWorkspace({ reviewChanges: review, openChat, send }),
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const stop of uninstall) stop();
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: live },
        createElement(RaceCard, { raceId: "r1" }),
      ),
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const card = () => container.querySelector<HTMLElement>("[data-race-card]");
const text = (selector: string) =>
  card()?.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim();
const labels = () =>
  [...(card()?.querySelectorAll(".team-card-actions button") ?? [])].map(
    (button) => button.textContent,
  );
const press = async (label: string) => {
  const button = [...(card()?.querySelectorAll("button") ?? [])].find((entry) =>
    entry.textContent?.startsWith(label),
  );
  expect(button, `a "${label}" button`).toBeTruthy();
  await act(async () => button!.click());
};

describe("a race's card drawn before the workspace is ready", () => {
  it("gains Compare once the window installs its race actions", async () => {
    for (const stop of uninstall) stop();
    uninstall = [];
    await render();
    expect(labels()).toEqual([]);
    await act(async () => {
      uninstall = [
        installRaceWorkspace({
          stop: vi.fn(),
          settle: vi.fn(),
          release: vi.fn(),
          openChat,
          compare,
          retry: vi.fn(),
        }),
      ];
    });
    expect(labels()).toEqual(["Compare"]);
  });
});

describe("a race's card in the chat it was sent from", () => {
  it("shows each lane live with Compare, and no Stop of its own", async () => {
    await render();
    expect(card()?.dataset.state).toBe("live");
    expect(text(".team-card-title")).toBe("Claude and Codex are racing");
    expect(text(".team-card-badge")).toBe("1 of 2 done");
    expect(card()!.querySelectorAll("[data-discussion-avatar]")).toHaveLength(
      4,
    );
    const rows = [...card()!.querySelectorAll("[data-race-card-lane]")];
    expect(rows.map((row) => row.getAttribute("data-lane-state"))).toEqual([
      "done",
      "working",
    ]);
    // Read once on showing, kept with the race, with no timer.
    expect(getRace("r1")?.stats?.[0]).toEqual({
      files: 2,
      additions: 12,
      deletions: 3,
    });
    expect(rows[0].textContent).toContain("1:05");
    expect(rows[0].textContent).toContain("+12 −3");
    expect(rows[0].textContent).toContain("2 files");
    expect(labels()).toEqual(["Compare"]);
    await press("Compare");
    expect(compare).toHaveBeenCalledWith("r1");
    await act(async () =>
      (rows[1].querySelector("button") as HTMLElement).click(),
    );
    expect(openChat).toHaveBeenCalledWith("l1");
  });

  it("reads Ready to compare once every lane is done, with Suggest a winner", async () => {
    completed("l1");
    live.set([lane("l0", false), lane("l1", false)]);
    await render();
    expect(card()?.dataset.state).toBe("ready");
    expect(text(".team-card-title")).toBe("Ready to compare");
    expect(text(".team-card-badge")).toBe("2 of 2 done");
    expect(labels()).toEqual(["Compare", "Suggest a winner", "Ask a reviewer"]);
    await press("Suggest a winner");
    expect(suggest).toHaveBeenCalledWith("r1", expect.any(Function), [
      "Done",
      "Done",
    ]);
    await act(async () =>
      updateRace("r1", {
        suggestion: {
          status: "done",
          lane: 1,
          why: "It also covers logout.",
          model: "Claude Haiku 4.5",
          at: 1,
        },
      }),
    );
    expect(text(".team-card-status")).toBe(
      "Aven suggests Codex: It also covers logout.",
    );
    expect(labels()).toEqual(["Compare"]);
  });

  it("says plainly when no winner could be suggested", async () => {
    completed("l1");
    live.set([lane("l0", false), lane("l1", false)]);
    saveRace({ ...record, suggestion: { status: "failed", at: 1 } });
    await render();
    expect(text(".team-card-status")).toBe(
      "Couldn't suggest a winner. Compare the agents' changes to choose.",
    );
    expect(labels()).toEqual(["Compare", "Suggest a winner", "Ask a reviewer"]);
  });

  it("becomes the result: what was kept and why, with the next steps", async () => {
    saveRace({
      ...record,
      state: "kept",
      finishedAt: 80_000,
      outcome: { kind: "lane", lane: 1, files: 7, why: "Smaller change." },
    });
    await render();
    expect(card()?.dataset.state).toBe("done");
    expect(text(".team-card-title")).toBe("Kept Codex's version · 7 files");
    expect(text(".team-card-status")).toBe("Why: Smaller change.");
    expect(
      card()?.querySelector('[data-race-card-lane="1"] .team-card-member-state')
        ?.textContent,
    ).toBe("Kept");
    expect(labels()).toEqual(["Review changes", "Continue with Codex"]);
    await press("Review changes");
    expect(review).toHaveBeenCalledWith("/work/site");
    await press("Continue with");
    expect(send).toHaveBeenCalledWith("l1", expect.any(Function));
    const compose = (
      send.mock.calls[0] as unknown as [
        string,
        (blocks: Session["blocks"]) => { text: string; shown?: string },
      ]
    )[1];
    const message = compose(lane("l1", false).blocks);
    expect(message.shown).toBe(
      "Carry on from the race: your version was kept.",
    );
    expect(message.text).toContain("7 files are now in the project");
    expect(message.text).toContain("Fixed it.");
  });

  it("asks a chat of your choice to review it as a Reviewer, never a lane", async () => {
    completed("l1");
    live.set([
      lane("l0", false),
      lane("l1", false),
      { ...newSession("claude", "/work/site"), id: "chat", title: "Start" },
      {
        ...newSession("codex", "/work/site"),
        id: "busy",
        title: "Busy",
        busy: true,
      },
      { ...newSession("claude", "/work/other"), id: "away", title: "Away" },
    ]);
    send.mockImplementation(async () => true);
    await render();
    await press("Ask a reviewer");
    const menu = document.body.querySelector<HTMLElement>(
      "[data-race-reviewers]",
    )!;
    const rows = [
      ...menu.querySelectorAll<HTMLButtonElement>("[data-race-reviewer]"),
    ];
    // The chat it was sent from first; no lane, and no chat elsewhere.
    expect(rows.map((row) => row.dataset.raceReviewer)).toEqual([
      "chat",
      "busy",
    ]);
    expect(rows[0].textContent).toContain("The chat you raced from");
    expect(rows[1].disabled).toBe(true);
    expect(rows[1].textContent).toContain("Working");
    await act(async () => rows[0].click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith("chat", expect.any(Function), {
      onSettled: expect.any(Function),
      // Never queued behind other messages or steered into a turn.
      whenIdle: true,
    });
    const compose = (
      send.mock.calls[0] as unknown as [
        string,
        (blocks: never[]) => { text: string },
      ]
    )[1];
    expect(compose([]).text).toMatch(/^Your role for this race: Reviewer\. /);
    // The reviewer stands beside the lanes, with its role.
    const row = card()!.querySelector<HTMLElement>(
      '[data-race-reviewer-row="chat"]',
    )!;
    expect(row.querySelector("[data-agent-role]")?.textContent).toBe(
      "Reviewer",
    );
    expect(
      row.querySelector("[data-discussion-avatar]")?.getAttribute("data-role"),
    ).toBe("reviewer");
    expect(text(".team-card-status")).toMatch(
      /is comparing the agents' work…$/,
    );
    await act(async () =>
      updateRace("r1", {
        review: { ...getRace("r1")!.review!, status: "done" },
        suggestion: {
          status: "done",
          lane: 1,
          why: "It adds a test.",
          model: getRace("r1")!.review!.label,
          at: 1,
          by: "reviewer",
        },
      }),
    );
    expect(text(".team-card-status")).toMatch(
      /\(Reviewer\) suggests Codex: It adds a test\.$/,
    );
    expect(
      card()!.querySelector(
        '[data-race-reviewer-row="chat"] .team-card-member-detail',
      )?.textContent,
    ).toBe("Suggests Codex");
  });

  it("names two models of one provider apart", async () => {
    saveRace({
      ...record,
      lanes: [
        { ...record.lanes[0], label: "Claude Code · Opus 4.6" },
        {
          ...record.lanes[1],
          harness: "claude",
          label: "Claude Code · Claude Sonnet 5",
        },
      ],
    });
    await render();
    expect(text(".team-card-title")).toBe(
      "Claude Opus 4.6 and Claude Sonnet 5 are racing",
    );
    expect(
      [...card()!.querySelectorAll(".team-card-member-name")].map(
        (name) => name.textContent,
      ),
    ).toEqual(["Claude Opus 4.6", "Claude Sonnet 5"]);
  });

  it("reads discarded and forgotten races plainly", async () => {
    saveRace({ ...record, state: "discarded", finishedAt: 80_000 });
    await render();
    expect(card()?.dataset.state).toBe("stopped");
    expect(text(".team-card-title")).toBe("Race discarded");
    expect(text(".team-card-status")).toBe("Your project didn't change.");
    expect(labels()).toEqual([]);
    await act(async () => localStorage.removeItem("aven.races.v1"));
    window.dispatchEvent(new StorageEvent("storage", { key: "aven.races.v1" }));
    await render();
    expect(text(".team-card-status")).toBe(
      "This race is no longer available. Aven keeps the 20 most recent finished races.",
    );
  });
});

describe("a race no agent works in", () => {
  it("says how its agents ended", () => {
    expect(readyText([{ state: "done" }, { state: "done" }])).toBe(
      "Every agent is done. Compare their changes and keep one.",
    );
    expect(readyText([{ state: "done" }, { state: "failed" }])).toBe(
      "No agent is working now. Compare their changes to keep one, or open Compare to retry the others.",
    );
    expect(readyText([{ state: "stopped" }, { state: "stopped" }])).toBe(
      "Every agent was stopped. Open Compare to retry one, keep what they wrote, or discard the race.",
    );
  });
});
