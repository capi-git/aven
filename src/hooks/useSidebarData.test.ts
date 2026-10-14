// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession, type Session } from "../lib/session";
import type { SessionSummary } from "../lib/sessionStore";
import { DEFAULT_WORKSPACE_PROFILES } from "../lib/workspaceProfiles";

const listSessionsByProject = vi.hoisted(() =>
  vi.fn<(cwd: string) => Promise<SessionSummary[]>>(),
);
vi.mock("../lib/sessionStore", async (original) => ({
  ...(await original<typeof import("../lib/sessionStore")>()),
  listSessionsByProject,
}));

import { useSidebarData } from "./useSidebarData";

const APP = "/Users/me/app";
const STANDALONE = "/Users/me/.aven/standalone";
const profiles = DEFAULT_WORKSPACE_PROFILES.map((profile) => ({ ...profile }));
const profileState = {
  profiles,
  profileProjects: [{ path: APP, openedAt: 1 }],
  projectsByProfile: { personal: [{ path: APP, openedAt: 1 }], work: [] },
};

function liveTask(id: string): Session {
  return {
    ...newSession("claude", APP),
    id,
    blocks: [{ id: "u", role: "user" as const, text: "hi" }],
    busy: true,
  };
}

type Result = ReturnType<typeof useSidebarData> & {
  history: SessionSummary[];
  loaded: ReadonlySet<string>;
};
let result: Result;
let root: Root;
let host: HTMLElement;

function Harness(props: {
  onScreen: boolean;
  sessions: Session[];
  standaloneCwds: readonly string[];
}) {
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const data = useSidebarData({
    onScreen: props.onScreen,
    profiles: profileState,
    standaloneCwds: props.standaloneCwds,
    history,
    sessions: props.sessions,
    orchestrationRuns: [],
    busySessionIds: new Set(),
    setHistory,
    setLoadedProjects: setLoaded,
    loadedProjectsRef: loadedRef,
  });
  result = { ...data, history, loaded };
  return null;
}

async function render(props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
}

function stubStorage() {
  // Some Node versions give tests a working localStorage and some do not.
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  stubStorage();
  listSessionsByProject.mockReset();
  listSessionsByProject.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps the last lists while hidden and catches up when shown", async () => {
  await render({ onScreen: true, sessions: [], standaloneCwds: [] });
  const shownSummaries = result.profileSessionSummaries;
  const shownPreviews = result.profilePreviews;
  expect(shownSummaries[APP]).toEqual([]);

  await render({
    onScreen: false,
    sessions: [liveTask("a")],
    standaloneCwds: [],
  });
  // Hidden: same objects, so the sidebar does not re-render for new tasks.
  expect(result.profileSessionSummaries).toBe(shownSummaries);
  expect(result.profilePreviews).toBe(shownPreviews);

  await render({
    onScreen: true,
    sessions: [liveTask("a")],
    standaloneCwds: [],
  });
  expect(result.profileSessionSummaries[APP].map((row) => row.id)).toEqual([
    "a",
  ]);
  expect(
    result.profilePreviews.personal.projects[0].tasks.map((task) => task.id),
  ).toEqual(["a"]);
});

it("keeps a docked sidebar's lists current as tasks change (0.1.139)", async () => {
  // A docked sidebar with the native layer is on screen the whole time.
  await render({
    onScreen: true,
    sessions: [liveTask("a")],
    standaloneCwds: [],
  });
  await render({
    onScreen: true,
    sessions: [liveTask("a"), liveTask("b")],
    standaloneCwds: [],
  });
  expect(
    result.profileSessionSummaries[APP].map((row) => row.id).sort(),
  ).toEqual(["a", "b"]);
});

it("loads tasks without a project only while the sidebar is on screen, once", async () => {
  listSessionsByProject.mockResolvedValue([
    {
      id: "s",
      cwd: STANDALONE,
      harness: "claude",
      model: "claude:sonnet-5",
      runtimeMode: "supervised",
      title: "Loose task",
      createdAt: 1,
      updatedAt: 1,
      additions: 0,
      deletions: 0,
    },
  ]);
  await render({ onScreen: false, sessions: [], standaloneCwds: [STANDALONE] });
  expect(listSessionsByProject).not.toHaveBeenCalled();

  await render({ onScreen: true, sessions: [], standaloneCwds: [STANDALONE] });
  expect(listSessionsByProject).toHaveBeenCalledTimes(1);
  expect(result.standaloneSessions.map((row) => row.id)).toEqual(["s"]);

  // Already loaded: hiding and showing again does not reload it.
  await render({ onScreen: false, sessions: [], standaloneCwds: [STANDALONE] });
  await render({ onScreen: true, sessions: [], standaloneCwds: [STANDALONE] });
  expect(listSessionsByProject).toHaveBeenCalledTimes(1);
});

it("records a failed load and clears it on the next try", async () => {
  listSessionsByProject.mockRejectedValueOnce(new Error("offline"));
  await render({ onScreen: true, sessions: [], standaloneCwds: [] });
  await act(async () => result.refreshProfileHistory(APP));
  expect(result.profileHistoryErrors.size).toBe(1);

  await act(async () => result.refreshProfileHistory(APP));
  expect(result.profileHistoryErrors.size).toBe(0);
  expect(result.loaded.size).toBe(1);
});
