// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../lib/activity";
import { STREAK_STORAGE_KEY, dayKey } from "../lib/activityStreak";
import type { Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import {
  useWorkspaceHomeData,
  type WorkspaceHomeData,
} from "./useWorkspaceHomeData";

const APP = "/Users/me/Developer/app";
const SITE = "/Users/me/Developer/site";
const PROJECTS = [
  { path: APP, openedAt: 2 },
  { path: SITE, openedAt: 1 },
];
const STANDALONE: string[] = [];
const HISTORY: SessionSummary[] = [];
const ACTIVITY: ActivityEntry[] = [];

type Block = Session["blocks"][number];

function session(id: string, blocks: Block[], busy = false): Session {
  return {
    id,
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    title: `Task ${id}`,
    blocks,
    busy,
  } as Session;
}

const user = { id: "u", role: "user", text: "Go", startedAt: 1_000 } as Block;
const reply = (text: string) => ({ id: "r", role: "assistant", text }) as Block;
const approval = {
  id: "t",
  role: "tool",
  text: "",
  tool: { title: "Run npm test" },
  approval: { id: "a", requestId: "q", decided: false },
} as unknown as Block;

let root: Root;
let container: HTMLDivElement;
let results: WorkspaceHomeData[];
let storage: Map<string, string>;

function Probe({
  activity = ACTIVITY,
  history = HISTORY,
  ...props
}: {
  enabled: boolean;
  sessions: Session[];
  inFlightIds: ReadonlySet<string>;
  activity?: ActivityEntry[];
  history?: SessionSummary[];
}) {
  results.push(
    useWorkspaceHomeData({
      ...props,
      history,
      activity,
      projects: PROJECTS,
      standaloneCwds: STANDALONE,
    }),
  );
  return null;
}

async function render(props: Parameters<typeof Probe>[0]) {
  await act(async () => root.render(createElement(Probe, props)));
  return results[results.length - 1];
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  results = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps its result through streaming flushes that change nothing shown", async () => {
  const busy = new Set(["a"]);
  const first = await render({
    enabled: true,
    sessions: [session("a", [user, reply("Hel")], true), session("b", [user])],
    inFlightIds: busy,
  });
  expect(first.running).toMatchObject([{ id: "a", doing: "Writing a reply" }]);
  expect(first.projects[0]).toMatchObject({
    doing: "Writing a reply",
    resumeId: "a",
  });
  expect(first.recent.map((row) => row.id).sort()).toEqual(["a", "b"]);
  expect(first.projects.map((card) => card.path)).toEqual([APP, SITE]);

  // A flush: new session objects and a longer reply, same everything else.
  const second = await render({
    enabled: true,
    sessions: [
      session("a", [user, reply("Hello the")], true),
      session("b", [user]),
    ],
    inFlightIds: busy,
  });
  expect(second).toBe(first);

  // An approval arrives: the home's data changes.
  const third = await render({
    enabled: true,
    sessions: [session("a", [user, approval], true), session("b", [user])],
    inFlightIds: busy,
  });
  expect(third).not.toBe(first);
  expect(third.running).toEqual([]);
  expect(third.needsYou).toMatchObject([
    { id: "a", kind: "approval", detail: "Run npm test" },
  ]);
  // The project's tile opens the waiting session and shows what it asks.
  expect(third.projects[0]).toMatchObject({
    path: APP,
    resumeId: "a",
    asking: "Run npm test",
  });
});

it("does no work and returns one empty value while Home is hidden", async () => {
  const hidden = await render({
    enabled: false,
    sessions: [session("a", [user], true)],
    inFlightIds: new Set(["a"]),
  });
  const again = await render({
    enabled: false,
    sessions: [session("a", [user, reply("x")], true)],
    inFlightIds: new Set(["a"]),
  });
  expect(again).toBe(hidden);
  expect(hidden).toEqual({
    needsYou: [],
    running: [],
    projects: [],
    recent: [],
    finished: [],
    activeDays: [],
  });
});

it("remembers days with a completed task beyond the ledger, for the streak", async () => {
  const day = (offset: number) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    return date.getTime();
  };
  storage.set(
    STREAK_STORAGE_KEY,
    JSON.stringify({ version: 1, days: [dayKey(day(3))] }),
  );
  const entry = (id: string, at: number, outcome = "completed") =>
    ({
      id,
      sessionId: id,
      outcome,
      title: "Task",
      summary: "",
      cwd: APP,
      harness: "codex",
      model: "gpt-5",
      createdAt: at,
      readAt: null,
      resolvedAt: null,
    }) as ActivityEntry;
  const ledger = [
    entry("a", day(0)),
    entry("b", day(1)),
    entry("c", day(2), "failed"),
  ];
  const first = await render({
    enabled: true,
    sessions: [],
    inFlightIds: new Set(),
    activity: ledger,
  });
  expect(first.activeDays).toEqual([
    dayKey(day(3)),
    dayKey(day(1)),
    dayKey(day(0)),
  ]);
  expect(JSON.parse(storage.get(STREAK_STORAGE_KEY)!).days).toEqual(
    first.activeDays,
  );
  // Marking a reply read changes the ledger but not the days.
  const read = await render({
    enabled: true,
    sessions: [],
    inFlightIds: new Set(),
    activity: ledger.map((item) => ({ ...item, readAt: 1 })),
  });
  expect(read.activeDays).toBe(first.activeDays);
});

it("gives a renamed session one time and its current title everywhere", async () => {
  const MINUTE = 60_000;
  const now = Date.now();
  const saved: SessionSummary = {
    id: "mum",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    title: "Your mum",
    createdAt: now - 48 * 60 * MINUTE,
    updatedAt: now - 74 * MINUTE,
  };
  // Loaded, with its last timed turn a day ago and a reply recorded under its
  // old name two hours ago that the user has not read.
  const loaded = {
    ...session("mum", [
      { ...user, startedAt: now - 23 * 60 * MINUTE, durationMs: 1_000 },
      reply("Done"),
    ]),
    title: "Your mum",
  };
  const reply2h: ActivityEntry = {
    id: "reply",
    sessionId: "mum",
    outcome: "completed",
    title: "Session reply check",
    summary: "All set",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    createdAt: now - 120 * MINUTE,
    readAt: null,
    resolvedAt: null,
  };
  const data = await render({
    enabled: true,
    sessions: [loaded],
    inFlightIds: new Set(),
    history: [saved],
    activity: [reply2h],
  });
  const at = now - 74 * MINUTE;
  expect(data.recent).toMatchObject([
    { id: "mum", title: "Your mum", updatedAt: at },
  ]);
  expect(data.needsYou).toMatchObject([
    { id: "mum", title: "Your mum", kind: "completed", at },
  ]);
  expect(data.projects[0]).toMatchObject({
    path: APP,
    lastActivity: at,
    resumeTitle: "Your mum",
  });
  // The feed keeps the turn's own time, under the current title.
  expect(data.finished).toMatchObject([
    { sessionId: "mum", title: "Your mum", at: now - 120 * MINUTE },
  ]);

  // A saved row that changes nothing shown keeps every list's identity.
  const again = await render({
    enabled: true,
    sessions: [loaded],
    inFlightIds: new Set(),
    history: [{ ...saved }],
    activity: [reply2h],
  });
  expect(again).toBe(data);
});
