// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordActivity } from "../lib/activity";
import type { GitWorktree } from "../lib/fs";
import {
  createLiveSessionStore,
  LiveSessionsContext,
} from "../lib/liveSessions";
import {
  finishRace,
  installRaceWorkspace,
  saveRace,
  updateRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import { GitCopies, parallelWorkCount, summarizeCopies } from "./GitCopies";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../lib/race", async (original) => ({
  ...(await original<typeof import("../lib/race")>()),
  finishRace: vi.fn(async () => {}),
}));

const race: RaceRecord = {
  id: "race-1",
  project: "/repo",
  root: "/repo",
  base: "b".repeat(40),
  prompt: "Try three designs\nwith more detail",
  createdAt: 1,
  uncommitted: true,
  untracked: false,
  state: "running",
  lanes: (["claude", "codex", "grok"] as const).map((harness, slot) => ({
    sessionId: `lane-${slot}`,
    harness,
    model: "m",
    label: `${harness} · m`,
    path: `/races/race-1/${slot}`,
    branch: `aven/race/race1-${slot}`,
  })),
};

const tree = (path: string, extra: Partial<GitWorktree> = {}): GitWorktree => ({
  path,
  branch: "feat/x",
  current: false,
  primary: false,
  files: [],
  additions: 0,
  deletions: 0,
  aheadOfDefault: 0,
  behindDefault: 0,
  mergedIntoDefault: false,
  ...extra,
});

const changed = (relative: string) => ({
  path: `/races/${relative}`,
  relative,
  status: "modified",
  additions: 1,
  deletions: 0,
  staged: false,
  unstaged: true,
});

const worktrees: GitWorktree[] = [
  tree("/repo", { branch: "main", primary: true, current: true }),
  ...race.lanes.map((lane, slot) =>
    tree(lane.path, {
      branch: lane.branch,
      files: slot === 0 ? [changed("a.ts"), changed("b.ts")] : [],
    }),
  ),
  tree("/copies/other", { branch: "feat/other", aheadOfDefault: 1 }),
];

let container: HTMLDivElement;
let root: Root;
const compare = vi.fn();
let uninstall: () => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>([["aven.parallelWorkOpen", "1"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  saveRace(race);
  recordActivity({
    id: "lane-0:turn:t:completed",
    sessionId: "lane-0",
    outcome: "completed",
    title: "",
    summary: "",
    cwd: "/repo",
    harness: "claude",
    model: "m",
    createdAt: 5_000,
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_worktrees") return worktrees;
    if (command === "session_list_by_project") return [];
    throw new Error(`unexpected ${command}`);
  });
  uninstall = installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
    openChat: vi.fn(),
    compare,
    retry: vi.fn(),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  uninstall();
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render() {
  const lane = (id: string, busy: boolean): Session => ({
    ...newSession("claude", "/repo"),
    id,
    busy,
    worktreeCwd: race.lanes[Number(id.slice(-1))].path,
    blocks: [{ id: `${id}-u`, role: "user", text: "Go", startedAt: 1_000 }],
  });
  const sessions = createLiveSessionStore([
    {
      ...lane("lane-0", false),
      blocks: [
        ...lane("lane-0", false).blocks,
        { id: "r", role: "assistant", text: "Done." },
      ],
    },
    lane("lane-1", true),
    lane("lane-2", true),
  ]);
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: sessions },
        createElement(GitCopies, { cwd: "/repo", enabled: true }),
      ),
    ),
  );
}

const lines = () =>
  [...container.querySelectorAll(".git-copy-line")].map((row) => [
    row.querySelector(".git-copy-name")?.textContent,
    row.querySelector(".git-copy-short")?.textContent,
  ]);

const button = (label: string) =>
  [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === label,
  )!;

it("shows a running race as one row with its lanes inside", async () => {
  await render();
  expect(lines()).toEqual([
    ["Race · Try three designs", "1 of 3 done"],
    ["Other", "1 to merge"],
  ]);
  expect(container.querySelector(".git-copies-count")?.textContent).toBe("· 2");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-race-group] .git-copy-line")!
      .click(),
  );
  const lanes = [...container.querySelectorAll("[data-race-lane]")].map(
    (lane) => lane.textContent,
  );
  expect(lanes).toEqual([
    "Claude · Done2 files changed",
    "Codex · WorkingUp to date",
    "Grok · WorkingUp to date",
  ]);
  // No per-lane Remove: removing one lane would discard the whole race.
  expect(button("Remove")).toBeUndefined();
  await act(async () => button("Compare").click());
  expect(compare).toHaveBeenCalledWith("race-1");
});

it("asks before discarding the race and names what goes", async () => {
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-race-group] .git-copy-line")!
      .click(),
  );
  await act(async () => button("Discard race").click());
  const ask = container.querySelector('[role="group"]')!;
  expect(ask.getAttribute("aria-label")).toBe("Discard this race?");
  expect(ask.textContent).toContain(
    "This stops 2 agents still working and deletes Claude's work (2 files). Your project doesn't change.",
  );
  expect(finishRace).not.toHaveBeenCalled();
  await act(async () => button("Discard race").click());
  expect(finishRace).toHaveBeenCalledWith(
    expect.objectContaining({ id: "race-1" }),
    null,
  );
});

it("counts an agent's committed work in what discarding deletes", async () => {
  // Codex committed its change: no unsaved files, but 3 changed files.
  updateRace(race.id, {
    stats: [
      { files: 2, additions: 4, deletions: 0 },
      { files: 3, additions: 9, deletions: 1 },
      null,
    ],
  });
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-race-group] .git-copy-line")!
      .click(),
  );
  await act(async () => button("Discard race").click());
  expect(container.querySelector('[role="group"]')!.textContent).toContain(
    "deletes Claude's work (2 files) and Codex's (3 files).",
  );
});

it("counts a running race once in the header", () => {
  const copies = summarizeCopies(worktrees);
  expect(parallelWorkCount(copies)).toBe(2);
});
