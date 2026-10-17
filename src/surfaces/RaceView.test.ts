// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: host.invoke,
  convertFileSrc: (path: string) => path,
}));

import { recordActivity } from "../lib/activity";
import { INTERRUPT_MESSAGE } from "../lib/inFlight";
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
const compare = vi.fn();
const retry = vi.fn();
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

/** A lane whose race turn ended with `outcome` after `seconds`. */
function ended(
  id: string,
  outcome: "completed" | "failed" | "stopped",
  seconds = 42,
): Session {
  const startedAt = Date.now() - 600_000;
  recordActivity({
    id: `${id}:turn:${id}-turn:${outcome}`,
    sessionId: id,
    outcome,
    title: "Race",
    summary: "",
    cwd: "/work/site",
    harness: "claude",
    model: "opus",
    createdAt: startedAt + seconds * 1000,
  });
  return {
    ...session(id),
    blocks: [
      {
        id: `${id}-user`,
        role: "user",
        text: "Fix the login loop",
        startedAt,
        durationMs: seconds * 1000,
      },
      { id: `${id}-reply`, role: "assistant", text: "Done." },
    ],
  };
}

/** A lane whose race turn started `seconds` ago and is still running. */
function workingFor(id: string, seconds: number): Session {
  return {
    ...session(id, true),
    blocks: [
      {
        id: `${id}-user`,
        role: "user",
        text: "Fix the login loop",
        startedAt: Date.now() - seconds * 1000,
      },
    ],
  };
}

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
  compare.mockReset();
  retry.mockReset();
  uninstall = installRaceWorkspace({
    stop,
    settle,
    release,
    openChat,
    compare,
    retry,
  });
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

/** The open confirmation, if any (it is portalled to the page). */
const dialog = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"]');

async function confirmDialog() {
  const confirm = dialog()?.querySelector<HTMLButtonElement>("[data-confirm]");
  if (!confirm) throw new Error("No confirmation is open");
  await act(async () => confirm.click());
}

it("shows each lane's status and changes and explains what was copied", async () => {
  const view = await render([ended("s0", "completed"), session("s1", true)]);
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

it("keeps a lane working during an optional question while blocking questions wait", async () => {
  const view = await render([
    {
      ...session("s0", true),
      pendingQuestion: { requestId: 7, questions: [] },
    },
    {
      ...session("s1", true),
      harness: "codex",
      pendingQuestion: { requestId: 8, questions: [], blocking: false },
    },
  ]);
  const lanes = view.querySelectorAll("section");
  expect(lanes[0].textContent).toContain("Needs you");
  expect(lanes[1].textContent).toContain("Working");
});

it("keeps one lane: applies its files, stops the lanes and removes the copies", async () => {
  const view = await render([session("s0"), session("s1")]);
  await act(async () => button(view, "Keep this").click());
  expect(host.invoke).toHaveBeenCalledWith("race_apply", {
    root: "/work/site",
    base: record.base,
    choices: [{ worktree: "/data/races/r1/0", paths: ["a.ts"] }],
  });
  expect(settle).toHaveBeenCalledWith(expect.objectContaining(record));
  expect(host.invoke).toHaveBeenCalledWith("race_cleanup", {
    root: "/work/site",
    lanes: record.lanes,
  });
  expect(getRace("r1")?.state).toBe("kept");
  expect(release).toHaveBeenCalledWith(expect.objectContaining(record));
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
  await confirmDialog();
  await act(async () => {
    const file = [...view.querySelectorAll("span")].find(
      (span) => span.textContent === "b.ts",
    );
    file?.parentElement?.click();
  });
  // Nothing reads the copies while their writers are still being stopped.
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
  expect(release).toHaveBeenCalledWith(expect.objectContaining(record));
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
    if (action === "Discard race") await confirmDialog();
    const cleanupIndex = host.invoke.mock.calls.findIndex(
      ([command]) => command === "race_cleanup",
    );
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(dialog()).toBeNull();
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
    // A kept race offers its result's next steps; a discarded one does not.
    expect(
      [...view.querySelectorAll("button")].map((entry) => entry.textContent),
    ).toEqual(
      state === "kept"
        ? [
            "Open chat",
            "Open chat",
            "Review changes",
            `Continue with ${record.lanes[0].label}`,
          ]
        : ["Open chat", "Open chat"],
    );
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
  await confirmDialog();
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
  expect(release).toHaveBeenCalledWith(expect.objectContaining(record));
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
  await confirmDialog();
  expect(host.invoke).not.toHaveBeenCalledWith("race_apply", expect.anything());
  expect(getRace("r1")?.state).toBe("discarded");
});

it("keeps the files a lane wrote after the overview last refreshed", async () => {
  const view = await render([workingFor("s0", 30), workingFor("s1", 30)]);
  expect(view.querySelector('[data-race-file="a.ts"]')).not.toBeNull();
  // The agent writes another file; the overview has not refreshed since.
  host.invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) =>
      command === "race_diff" && args.worktree === "/data/races/r1/0"
        ? {
            files: ["a.ts", "late.ts"].map((path) => ({
              path,
              status: "modified",
              additions: 1,
              deletions: 0,
              binary: false,
            })),
            additions: 2,
            deletions: 0,
          }
        : answer(command, args),
  );
  expect(view.querySelector('[data-race-file="late.ts"]')).toBeNull();
  await act(async () => button(view, "Keep this").click());
  expect(dialog()?.textContent).toContain("Keep Claude Code's version?");
  expect(dialog()?.textContent).toContain(
    "Claude Code is still working; you get what it has written so far. This stops 2 agents still working and deletes their copies.",
  );
  await confirmDialog();
  expect(host.invoke).toHaveBeenCalledWith("race_apply", {
    root: "/work/site",
    base: record.base,
    choices: [{ worktree: "/data/races/r1/0", paths: ["a.ts", "late.ts"] }],
  });
  expect(getRace("r1")?.outcome).toEqual({ kind: "lane", lane: 0, files: 2 });
  expect(view.textContent).toContain("Kept Claude Code's version · 2 files");
});

it("asks before keeping while another agent still works, and not once all are done", async () => {
  const view = await render([ended("s0", "completed"), workingFor("s1", 5)]);
  await act(async () => button(view, "Keep this").click());
  expect(dialog()?.querySelector("h2")?.textContent).toBe(
    "Keep Claude Code's version?",
  );
  expect(dialog()?.textContent).toContain(
    "This stops 1 agent still working and deletes their copies.",
  );
  const cancel = [...dialog()!.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(dialog()).toBeNull();
  expect(settle).not.toHaveBeenCalled();
  expect(getRace("r1")?.state).toBe("running");
});

it("names what discarding deletes and changes nothing when cancelled", async () => {
  const view = await render([session("s0"), workingFor("s1", 5)]);
  await act(async () => button(view, "Discard race").click());
  expect(dialog()?.querySelector("h2")?.textContent).toBe("Discard this race?");
  expect(dialog()?.textContent).toContain(
    "This stops 1 agent still working and deletes both copies and the changes in them: Claude Code (1 file) and Codex (1 file). Your project is not changed.",
  );
  await act(async () =>
    [...dialog()!.querySelectorAll("button")]
      .find((entry) => entry.textContent === "Cancel")!
      .click(),
  );
  expect(settle).not.toHaveBeenCalled();
  expect(getRace("r1")?.state).toBe("running");
});

it("shows each lane's real outcome, stops its clock at its own end and offers Retry", async () => {
  const interrupted: Session = {
    ...ended("s1", "completed", 12),
    blocks: [
      ...ended("s1", "completed", 12).blocks,
      { id: "note", role: "system", text: INTERRUPT_MESSAGE },
    ],
  };
  const view = await render([ended("s0", "failed", 42), interrupted]);
  const lanes = view.querySelectorAll("section");
  expect(lanes[0].querySelector("[data-lane-state]")?.textContent).toBe(
    "Failed · 0:42",
  );
  expect(lanes[1].querySelector("[data-lane-state]")?.textContent).toBe(
    "Interrupted · 0:12",
  );
  await act(async () => button(lanes[1] as HTMLElement, "Retry").click());
  expect(retry).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), 1);
});

it("tells a stopped lane from a working one and offers no Retry for either", async () => {
  const stopped = await render([
    ended("s0", "stopped", 7),
    workingFor("s1", 75),
  ]);
  const [first, second] = stopped.querySelectorAll("section");
  expect(first.querySelector("[data-lane-state]")?.textContent).toBe(
    "Stopped · 0:07",
  );
  expect(second.querySelector("[data-lane-state]")?.textContent).toBe(
    "Working · 1:15",
  );
  expect(first.textContent).not.toContain("Retry");
  expect(second.textContent).not.toContain("Retry");
});

it("reads a closed lane's outcome from activity and opens its chat", async () => {
  ended("s1", "completed");
  const view = await render([session("s0")]);
  const lanes = view.querySelectorAll("section");
  expect(lanes[0].querySelector("[data-lane-state]")?.textContent).toBe(
    "Not started",
  );
  expect(lanes[1].querySelector("[data-lane-state]")?.textContent).toBe("Done");
  await act(async () => button(lanes[1] as HTMLElement, "Open chat").click());
  expect(openChat).toHaveBeenCalledWith("s1");
});

it("saves per-file picks with the race and keeps a mix after asking", async () => {
  const view = await render([session("s0"), workingFor("s1", 5)]);
  const pickIn = (container: HTMLElement, path: string, lane: number) =>
    container
      .querySelector(`[data-race-file="${path}"]`)!
      .querySelectorAll("button")[lane];
  await act(async () => pickIn(view, "a.ts", 0).click());
  await act(async () => pickIn(view, "b.ts", 1).click());
  expect(getRace("r1")?.picks).toEqual({ "a.ts": 0, "b.ts": 1 });
  await act(async () => root.unmount());

  const reopened = await render([session("s0"), workingFor("s1", 5)]);
  expect(pickIn(reopened, "a.ts", 0).getAttribute("aria-pressed")).toBe("true");
  await act(async () => button(reopened, "Keep 2 selected files").click());
  expect(dialog()?.querySelector("h2")?.textContent).toBe(
    "Keep 2 selected files?",
  );
  expect(dialog()?.textContent).toContain(
    "This stops 1 agent still working and deletes both copies, with any changes you didn't pick.",
  );
  await confirmDialog();
  expect(host.invoke).toHaveBeenCalledWith("race_apply", {
    root: "/work/site",
    base: record.base,
    choices: [
      { worktree: "/data/races/r1/0", paths: ["a.ts"] },
      { worktree: "/data/races/r1/1", paths: ["b.ts"] },
    ],
  });
  expect(getRace("r1")?.outcome).toEqual({ kind: "mix", files: 2 });
  expect(reopened.textContent).toContain("Kept 2 files from 2 agents");
});

it("fetches the open file's diff again only when its size changes", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    let additions = 3;
    host.invoke.mockImplementation(
      async (command: string, args: Record<string, unknown>) => {
        const reply = answer(command, args) as { files?: unknown[] };
        if (command === "race_diff" && args.worktree === "/data/races/r1/0")
          return {
            files: [
              {
                path: "a.ts",
                status: "modified",
                additions,
                deletions: 1,
                binary: false,
              },
            ],
            additions,
            deletions: 1,
          };
        return reply;
      },
    );
    await render([workingFor("s0", 5), workingFor("s1", 5)]);
    const fileDiffs = () =>
      host.invoke.mock.calls.filter(([command]) => command === "race_file_diff")
        .length;
    expect(fileDiffs()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());
    expect(
      host.invoke.mock.calls.filter(([command]) => command === "race_diff")
        .length,
    ).toBeGreaterThan(2);
    expect(fileDiffs()).toBe(1);
    additions = 4;
    await act(async () => {
      vi.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    await act(async () => Promise.resolve());
    expect(fileDiffs()).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

it("shows each lane's last reply, and records why when you keep the suggested lane", async () => {
  saveRace({
    ...record,
    suggestion: {
      status: "done",
      lane: 0,
      why: "Smaller change, with a test.",
      model: "Claude Haiku 4.5",
      at: 1,
    },
  });
  const view = await render([
    ended("s0", "completed"),
    ended("s1", "completed"),
  ]);
  expect(
    [...view.querySelectorAll("[data-race-reply]")].map((p) => p.textContent),
  ).toEqual(["Done.", "Done."]);
  expect(view.querySelector("[data-race-suggestion]")?.textContent).toBe(
    "Suggested: Claude Code · Opus — Smaller change, with a test.",
  );
  expect(
    view.querySelector('[data-race-lane="0"] [data-race-suggested]'),
  ).not.toBeNull();
  // Already suggested: not offered again.
  expect(view.querySelector("[data-race-suggest]")).toBeNull();
  await act(async () => button(view, "Keep this").click());
  expect(getRace("r1")?.outcome).toMatchObject({
    kind: "lane",
    lane: 0,
    why: "Smaller change, with a test.",
  });
  expect(view.textContent).toContain("Why: Smaller change, with a test.");
});

it("offers Suggest a winner once no lane is working", async () => {
  const busy = await render([ended("s0", "completed"), session("s1", true)]);
  expect(busy.querySelector("[data-race-suggest]")).toBeNull();
  await act(async () => root.unmount());
  busy.remove();
  const settled = await render([
    ended("s0", "completed"),
    ended("s1", "failed"),
  ]);
  expect(settled.querySelector("[data-race-suggest]")?.textContent).toBe(
    "Suggest a winner",
  );
});
