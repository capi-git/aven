// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  convertFileSrc: (path: string) => path,
}));

import {
  getRace,
  installRaceWorkspace,
  saveRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import { RaceView } from "./RaceView";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

let root: Root;
const stop = vi.fn();
const openChat = vi.fn();
let uninstall: () => void;

const record: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: true,
  untracked: true,
  state: "running",
  lanes: [
    {
      sessionId: "s0",
      harness: "claude",
      model: "opus",
      label: "Claude Code · Opus",
      path: "/data/races/r1/0",
      branch: "aven/race/r1-0",
    },
    {
      sessionId: "s1",
      harness: "codex",
      model: "gpt",
      label: "Codex · GPT",
      path: "/data/races/r1/1",
      branch: "aven/race/r1-1",
    },
  ],
};

const session = (id: string, busy = false): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
});

function answer(command: string, args: Record<string, unknown>) {
  if (command === "race_diff")
    return args.worktree === "/data/races/r1/0"
      ? {
          files: [
            {
              path: "a.ts",
              status: "modified",
              additions: 3,
              deletions: 1,
              binary: false,
            },
          ],
          additions: 3,
          deletions: 1,
        }
      : {
          files: [
            {
              path: "b.ts",
              status: "added",
              additions: 5,
              deletions: 0,
              binary: false,
            },
          ],
          additions: 5,
          deletions: 0,
        };
  if (command === "race_file_diff")
    return { original: "one\n", current: "one\ntwo\n" };
  return undefined;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mockLocalStorage();
  host.invoke.mockReset();
  host.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) =>
      answer(command, args),
  );
  stop.mockReset();
  openChat.mockReset();
  uninstall = installRaceWorkspace({ stop, openChat });
  saveRace(record);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  uninstall();
  vi.unstubAllGlobals();
});

async function render(sessions: Session[]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(RaceView, { raceId: "r1", sessions, visible: true }),
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

const button = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  )!;

it("shows each lane's status and changes and explains what was copied", async () => {
  const view = await render([session("s0"), session("s1", true)]);
  const text = view.textContent ?? "";
  expect(text).toContain("started from your uncommitted changes");
  expect(text).toContain("new untracked files were not copied");
  expect(text).toContain("Done");
  expect(text).toContain("Working");
  expect(text).toContain("+3");
  expect(text).toContain("a.ts");
  expect(text).toContain("b.ts");
  await act(async () => button(view, "Open chat").click());
  expect(openChat).toHaveBeenCalledWith("s0");
  await act(async () => button(view, "Stop all").click());
  expect(stop).toHaveBeenCalledWith(["s1"]);
});

it("keeps one lane: applies its files, stops the lanes and removes the copies", async () => {
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Keep this").click());
  expect(host.invoke).toHaveBeenCalledWith("race_apply", {
    root: "/work/site",
    base: record.base,
    choices: [{ worktree: "/data/races/r1/0", paths: ["a.ts"] }],
  });
  expect(stop).toHaveBeenCalledWith(["s0", "s1"]);
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", {
    root: "/work/site",
    lanes: record.lanes,
  });
  expect(getRace("r1")?.state).toBe("kept");
});

it("leaves the race running and explains a conflicting keep", async () => {
  host.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "race_apply")
        throw "These changes conflict with edits in your project";
      return answer(command, args);
    },
  );
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Keep this").click());
  expect(view.textContent).toContain("conflict with edits in your project");
  expect(host.invoke).not.toHaveBeenCalledWith(
    "race_cleanup",
    expect.anything(),
  );
  expect(getRace("r1")?.state).toBe("running");
});

it("discards without applying anything", async () => {
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Discard race").click());
  expect(host.invoke).not.toHaveBeenCalledWith("race_apply", expect.anything());
  expect(getRace("r1")?.state).toBe("discarded");
});
