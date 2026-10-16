// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordActivity, type ActivityInput } from "../lib/activity";
import {
  getKeeperProject,
  KEEPER_MIN_INTERVAL_MS,
  resetMemoryKeeperCache,
  setMemoryKeeper,
  updateKeeperProject,
} from "../lib/memoryKeeper";
import type { Session } from "../lib/session";
import {
  KEEPER_BUSY_RETRY_MS,
  KEEPER_SETTLE_MS,
  keeperBusyProjects,
  useMemoryKeeper,
} from "./useMemoryKeeper";

const native = vi.hoisted(() => ({
  memory: null as null | { body: string; updatedAt: number },
  available: new Set<string>(["claude"]),
  pass: vi.fn(async () => ({ status: "written" })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "project_memory_get" && native.memory
      ? { key: "/work/shop", path: "/work/shop", ...native.memory }
      : null,
  ),
  isTauri: () => true,
  convertFileSrc: (path: string) => path,
}));

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isHarnessAvailable: (id: string) => native.available.has(id),
}));

vi.mock("../lib/memoryKeeperRun", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runKeeperPass: native.pass,
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const PROJECT = "/work/shop";

const session = (id: string, patch: Partial<Session> = {}): Session =>
  ({
    id,
    harness: "claude",
    model: "m",
    modelSettings: {},
    runtimeMode: "default",
    title: id,
    cwd: PROJECT,
    blocks: [],
    ...patch,
  }) as Session;

function turn(id: string, patch: Partial<ActivityInput> = {}): ActivityInput {
  return {
    id,
    sessionId: "s1",
    outcome: "completed",
    title: "Fix cart",
    summary: "Done",
    cwd: PROJECT,
    harness: "claude",
    model: "m",
    createdAt: Date.now(),
    ...patch,
  };
}

let root: Root;
let container: HTMLDivElement;

function Harness({ sessions }: { sessions: Session[] }) {
  useMemoryKeeper(sessions);
  return null;
}

async function render(sessions: Session[] = []) {
  await act(async () => root.render(createElement(Harness, { sessions })));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 15, 12));
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetMemoryKeeperCache();
  native.memory = null;
  native.available = new Set(["claude"]);
  native.pass.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetMemoryKeeperCache();
});

describe("which projects are busy", () => {
  it("counts projects with an agent at work, by memory key", () => {
    expect([
      ...keeperBusyProjects([
        session("a", { busy: true }),
        session("b", { cwd: "/work/idle" }),
        session("c", { busy: true, cwd: "~" }),
      ]),
    ]).toEqual([PROJECT]);
  });
});

describe("the consent offer", () => {
  it("appears after the first finished turn in a project with an empty memory", async () => {
    await render();
    await act(async () => void recordActivity(turn("t1")));
    await advance(0);
    expect(getKeeperProject(PROJECT).offeredAt).toBeDefined();
  });

  it("is not offered when the memory has text, no model is installed, or the turn did not finish", async () => {
    await render();
    native.memory = { body: "- Use pnpm", updatedAt: 1 };
    await act(async () => void recordActivity(turn("t1")));
    await advance(0);
    expect(getKeeperProject(PROJECT).offeredAt).toBeUndefined();

    native.memory = null;
    native.available = new Set();
    await act(async () => void recordActivity(turn("t2")));
    await advance(0);
    expect(getKeeperProject(PROJECT).offeredAt).toBeUndefined();

    native.available = new Set(["claude"]);
    await act(
      async () => void recordActivity(turn("t3", { outcome: "failed" })),
    );
    await advance(0);
    expect(getKeeperProject(PROJECT).offeredAt).toBeUndefined();
  });
});

describe("running passes", () => {
  it("fills straight away when turned on, once the project is idle", async () => {
    await render([session("a", { busy: true })]);
    await act(async () => setMemoryKeeper(PROJECT, true));
    await advance(1_000);
    expect(native.pass).not.toHaveBeenCalled();
    await render([session("a")]);
    await advance(KEEPER_BUSY_RETRY_MS + 1_000);
    expect(native.pass).toHaveBeenCalledTimes(1);
    expect(native.pass).toHaveBeenCalledWith(
      expect.objectContaining({ project: PROJECT, kind: "fill" }),
    );
  });

  it("updates after a batch of turns, a moment after the last one ends", async () => {
    native.memory = {
      body: "<!-- aven:auto -->\n## Stack\n- Go\n<!-- /aven:auto -->",
      updatedAt: 1,
    };
    updateKeeperProject(PROJECT, () => ({
      consent: "on",
      enabledAt: Date.now() - 1_000,
      lastRunAt: Date.now() - 1_000,
      lastAttemptAt: Date.now() - KEEPER_MIN_INTERVAL_MS - 1,
      baseline: "## Stack\n- Go",
    }));
    await render();
    for (let index = 0; index < 7; index += 1)
      await act(async () => void recordActivity(turn(`t${index}`)));
    await advance(KEEPER_SETTLE_MS + 1_000);
    expect(native.pass).not.toHaveBeenCalled();
    await act(async () => void recordActivity(turn("t7")));
    await advance(KEEPER_SETTLE_MS + 1_000);
    expect(native.pass).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "update" }),
    );
  });

  it("turns keeping off when the user removed the keeper's sections", async () => {
    native.memory = { body: "- Only my own lines now", updatedAt: 2 };
    updateKeeperProject(PROJECT, () => ({
      consent: "on",
      baseline: "## Stack\n- Go",
      lastAttemptAt: Date.now() - KEEPER_MIN_INTERVAL_MS - 1,
    }));
    await render();
    await act(async () => void recordActivity(turn("t1")));
    await advance(KEEPER_SETTLE_MS + 1_000);
    expect(native.pass).not.toHaveBeenCalled();
    expect(getKeeperProject(PROJECT).consent).toBe("off");
  });

  it("drops a request that cannot run, so it does not loop", async () => {
    native.available = new Set();
    await render();
    await act(async () => setMemoryKeeper(PROJECT, true));
    await advance(1_000);
    expect(native.pass).not.toHaveBeenCalled();
    expect(getKeeperProject(PROJECT).requested).toBeUndefined();
  });
});
