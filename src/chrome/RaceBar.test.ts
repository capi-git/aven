// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordActivity } from "../lib/activity";
import {
  createLiveSessionStore,
  LiveSessionsContext,
  type LiveSessionStore,
} from "../lib/liveSessions";
import {
  installRaceWorkspace,
  saveRace,
  updateRace,
  type RaceRecord,
} from "../lib/race";
import { newSession, type Session } from "../lib/session";
import { RaceBar } from "./RaceBar";

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
  lanes: ["s0", "s1"].map((sessionId, slot) => ({
    sessionId,
    harness: slot ? "codex" : "claude",
    model: "m",
    label: slot ? "Codex · GPT" : "Claude Code · Opus",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

const lane = (id: string, busy: boolean): Session => ({
  ...newSession("claude", "/work/site"),
  id,
  busy,
  blocks: [
    { id: `${id}-user`, role: "user", text: "Go", startedAt: 1_000 },
    ...(busy
      ? []
      : [{ id: `${id}-reply`, role: "assistant" as const, text: "Done." }]),
  ],
});

let root: Root;
let container: HTMLDivElement;
let store: LiveSessionStore;
const compare = vi.fn();
let uninstall: () => void;

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
  compare.mockReset();
  uninstall = installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(),
    release: vi.fn(),
    openChat: vi.fn(),
    compare,
    retry: vi.fn(),
  });
  store = createLiveSessionStore([lane("s0", false), lane("s1", true)]);
  recordActivity({
    id: "s0:turn:t:completed",
    sessionId: "s0",
    outcome: "completed",
    title: "",
    summary: "",
    cwd: "/work/site",
    harness: "claude",
    model: "m",
    createdAt: 2_000,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  uninstall();
  container.remove();
  vi.unstubAllGlobals();
});

async function render(sessionId: string) {
  await act(async () =>
    root.render(
      createElement(
        LiveSessionsContext.Provider,
        { value: store },
        createElement(RaceBar, { sessionId }),
      ),
    ),
  );
}

it("shows a lane chat how far its race is and opens the overview", async () => {
  await render("s1");
  expect(container.textContent).toContain("Racing · 1 of 2 done");
  // Stopped by the user: its own outcome says so, not merely "not busy".
  await act(async () => {
    recordActivity({
      id: "s1:turn:t:stopped",
      sessionId: "s1",
      outcome: "stopped",
      title: "",
      summary: "",
      cwd: "/work/site",
      harness: "codex",
      model: "m",
      createdAt: 3_000,
    });
    store.set([lane("s0", false), lane("s1", false)]);
  });
  expect(container.textContent).toContain("Racing · 1 of 2 done · 1 stopped");
  const button = container.querySelector<HTMLButtonElement>(
    "[data-race-compare]",
  )!;
  expect(button.textContent).toBe("Compare");
  await act(async () => button.click());
  expect(compare).toHaveBeenCalledWith("r1");
});

it("goes away once the race is kept, and never shows in other chats", async () => {
  await render("other");
  expect(container.querySelector("[data-race-bar]")).toBeNull();
  await render("s0");
  expect(container.querySelector("[data-race-bar]")).not.toBeNull();
  await act(async () => updateRace("r1", { state: "kept" }));
  expect(container.querySelector("[data-race-bar]")).toBeNull();
});
