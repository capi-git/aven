// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../lib/activity";
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

function Probe(props: {
  enabled: boolean;
  sessions: Session[];
  inFlightIds: ReadonlySet<string>;
}) {
  results.push(
    useWorkspaceHomeData({
      ...props,
      history: HISTORY,
      activity: ACTIVITY,
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
  const storage = new Map<string, string>();
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
  expect(first.running.map((row) => row.id)).toEqual(["a"]);
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
  });
});
