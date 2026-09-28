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
  isFinishingRaceCheckout,
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
const settle = vi.fn();
const release = vi.fn();
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
  settle.mockReset().mockResolvedValue(undefined);
  release.mockReset().mockResolvedValue(undefined);
  openChat.mockReset();
  uninstall = installRaceWorkspace({ stop, settle, release, openChat });
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
  expect(settle).toHaveBeenCalledWith(record);
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", {
    root: "/work/site",
    lanes: record.lanes,
  });
  expect(getRace("r1")?.state).toBe("kept");
  expect(release).toHaveBeenCalledWith(record);
});

it("waits for every lane writer before applying or deleting its copy", async () => {
  let stopped!: () => void;
  settle.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        stopped = resolve;
      }),
  );
  const view = await render([session("s0"), session("s1", true)]);
  const beforeFinishDiffs = host.invoke.mock.calls.filter(
    ([command]) => command === "race_diff" || command === "race_file_diff",
  ).length;
  await act(async () => button(view, "Keep this").click());
  await act(async () => {
    const file = [...view.querySelectorAll("span")].find(
      (span) => span.textContent === "b.ts",
    );
    file?.parentElement?.click();
  });
  expect(
    host.invoke.mock.calls.filter(
      ([command]) => command === "race_diff" || command === "race_file_diff",
    ),
  ).toHaveLength(beforeFinishDiffs);
  expect(isFinishingRaceCheckout(record.lanes[0].path)).toBe(true);
  expect(host.invoke).not.toHaveBeenCalledWith("race_apply", expect.anything());
  expect(host.invoke).not.toHaveBeenCalledWith(
    "race_cleanup",
    expect.anything(),
  );
  await act(async () => stopped());
  expect(host.invoke).toHaveBeenCalledWith("race_apply", expect.anything());
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", expect.anything());
  expect(release).toHaveBeenCalledWith(record);
  expect(getRace("r1")?.state).toBe("kept");
  expect(isFinishingRaceCheckout(record.lanes[0].path)).toBe(false);
});

it.each([
  ["Keep this", "kept", "Changes kept in your project"],
  ["Discard race", "discarded", "Your project is unchanged"],
] as const)(
  "shows completion after %s without reading removed copies",
  async (action, state, summary) => {
    let removed = false;
    host.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        if (command === "race_cleanup") removed = true;
        if (
          removed &&
          (command === "race_diff" || command === "race_file_diff")
        )
          throw new Error("The race copy was removed");
        return answer(command, args);
      },
    );
    const view = await render([session("s0"), session("s1")]);
    await act(async () => button(view, action).click());
    const cleanupIndex = host.invoke.mock.calls.findIndex(
      ([command]) => command === "race_cleanup",
    );
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(
      host.invoke.mock.calls
        .slice(cleanupIndex + 1)
        .filter(
          ([command]) =>
            command === "race_diff" || command === "race_file_diff",
        ),
    ).toEqual([]);
    expect(getRace("r1")?.state).toBe(state);
    expect(view.textContent).toContain(summary);
    expect(view.textContent).toContain(record.project);
    expect(view.textContent).not.toContain("Files · pick");
    expect(view.textContent).not.toContain("a.ts");
    expect(view.textContent).not.toContain("Keep this");
    expect(view.textContent).not.toContain("Select files to combine");
    expect(view.textContent).not.toContain("Couldn’t load diff");
    expect(
      [...view.querySelectorAll("button")].map((entry) => entry.textContent),
    ).toEqual(["Open chat", "Open chat"]);
    await act(async () => button(view, "Open chat").click());
    expect(openChat).toHaveBeenCalledWith("s0");
  },
);

it("opens a completed race without requesting deleted copies", async () => {
  saveRace({ ...record, state: "kept" });
  const view = await render([session("s0"), session("s1")]);
  expect(host.invoke).not.toHaveBeenCalled();
  expect(view.textContent).toContain("Changes kept in your project");
  expect(view.textContent).toContain(record.project);
});

it("ignores a refresh that fails after the copies have been removed", async () => {
  const failRefresh: (() => void)[] = [];
  host.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "race_diff")
        return new Promise((_, reject) => {
          failRefresh.push(() => reject(new Error("copy no longer exists")));
        });
      return answer(command, args);
    },
  );
  const view = await render([session("s0"), session("s1")]);
  expect(failRefresh).toHaveLength(2);
  await act(async () => button(view, "Discard race").click());
  await act(async () => failRefresh.forEach((fail) => fail()));
  expect(view.textContent).toContain("Your project is unchanged");
  expect(view.textContent).not.toContain("Couldn’t read");
  expect(view.textContent).not.toContain("copy no longer exists");
  expect(view.textContent).not.toContain("Reading changes");
});

it("keeps copies available when a writer cannot be stopped", async () => {
  settle.mockRejectedValue(new Error("Could not stop the provider"));
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Keep this").click());
  expect(view.textContent).toContain("Could not stop the provider");
  expect(host.invoke).not.toHaveBeenCalledWith("race_apply", expect.anything());
  expect(host.invoke).not.toHaveBeenCalledWith(
    "race_cleanup",
    expect.anything(),
  );
  expect(release).not.toHaveBeenCalled();
  expect(getRace("r1")?.state).toBe("running");
  expect(isFinishingRaceCheckout(record.lanes[0].path)).toBe(false);
});

it("releases chats after a successful keep even when a copy cannot be removed", async () => {
  host.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      if (command === "race_cleanup") throw new Error("copy is locked");
      return answer(command, args);
    },
  );
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Keep this").click());
  expect(release).toHaveBeenCalledWith(record);
  expect(getRace("r1")?.state).toBe("kept");
  expect(view.textContent).toContain("Some race copies could not be removed");
  expect(view.textContent).toContain("copy is locked");
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
