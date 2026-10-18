// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke }));

import {
  finishRace,
  installRaceWorkspace,
  saveRace,
  type RaceRecord,
} from "./race";
import { installChatFolders } from "./teamChanges";

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  host.invoke.mockReset();
  host.invoke.mockImplementation(async (command: string) =>
    command === "race_diff"
      ? {
          files: [
            {
              path: "app.js",
              status: "modified",
              additions: 4,
              deletions: 1,
              binary: false,
            },
            {
              path: "index.html",
              status: "modified",
              additions: 2,
              deletions: 0,
              binary: false,
            },
          ],
          additions: 6,
          deletions: 1,
        }
      : null,
  );
});

function race(origin?: RaceRecord["origin"]): RaceRecord {
  const record: RaceRecord = {
    id: "r1",
    project: "/work/tip-calc",
    root: "/work/tip-calc",
    base: "a".repeat(40),
    prompt: "Add a reset button",
    createdAt: 0,
    uncommitted: false,
    untracked: false,
    state: "running",
    lanes: [0, 1].map((slot) => ({
      sessionId: `lane${slot}`,
      harness: slot ? ("codex" as const) : ("claude" as const),
      model: "m",
      label: slot ? "Codex" : "Claude",
      path: `/data/races/r1/${slot}`,
      branch: `aven/race/r1-${slot}`,
    })),
    ...(origin ? { origin } : {}),
  };
  saveRace(record);
  return record;
}

function workspace() {
  return installRaceWorkspace({
    stop: vi.fn(),
    settle: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    openChat: vi.fn(),
    compare: vi.fn(),
    retry: vi.fn(),
  });
}

const commands = () =>
  host.invoke.mock.calls
    .map(([command]) => command as string)
    .filter((command) => command !== "race_diff");

it("makes what a kept race brings in the starting chat's changes", async () => {
  const stopFolders = installChatFolders((id) =>
    id === "chat" ? "/work/tip-calc" : undefined,
  );
  const stopWorkspace = workspace();
  await finishRace(race({ sessionId: "chat", blockId: "b" }), { lane: 1 });
  stopWorkspace();
  stopFolders();
  expect(commands()).toEqual([
    "session_checkpoint_ensure",
    "session_checkpoint_prepare",
    "race_apply",
    "session_checkpoint_capture",
    "race_cleanup",
  ]);
  const paths = ["/work/tip-calc/app.js", "/work/tip-calc/index.html"];
  expect(host.invoke).toHaveBeenCalledWith("session_checkpoint_prepare", {
    sessionId: "chat",
    cwd: "/work/tip-calc",
    paths,
  });
  expect(host.invoke).toHaveBeenCalledWith("session_checkpoint_capture", {
    sessionId: "chat",
    cwd: "/work/tip-calc",
    paths,
  });
});

it("just brings the changes in for a race started from no chat", async () => {
  const stopFolders = installChatFolders(() => "/work/tip-calc");
  const stopWorkspace = workspace();
  await finishRace(race(), { lane: 0 });
  stopWorkspace();
  stopFolders();
  expect(commands()).toEqual(["race_apply", "race_cleanup"]);
});
