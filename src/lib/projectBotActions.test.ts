// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  prepare: vi.fn(),
  sync: vi.fn(),
  diff: vi.fn(),
  fileDiff: vi.fn(),
  apply: vi.fn(),
  discard: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("./projectBotCopy", async (actual) => ({
  ...(await actual<typeof import("./projectBotCopy")>()),
  botCopyHost: host,
}));
vi.mock("./fs", () => ({ notifyGitChanged: vi.fn() }));
const claude = vi.hoisted(() => ({ available: true }));
vi.mock("./harness/availability", () => ({
  probeHarnessAvailability: async () => undefined,
  isHarnessAvailable: () => claude.available,
}));

import {
  applyBotFix,
  discardBotFix,
  forgetBotForProject,
  installBotWorkspace,
  turnOffProjectBot,
  turnOnBotWithDefaults,
  turnOnProjectBot,
} from "./projectBotActions";
import {
  getProjectBot,
  pendingFix,
  resetProjectBotsCache,
  updateProjectBot,
  withReadyFix,
} from "./projectBots";

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

const PATH = "/Users/me/Orbit";
const COPY = "/data/bots/orbit-1";
const BASE = "b".repeat(40);
const change = (additions: number) => ({
  files: [
    {
      path: "a.ts",
      status: "modified" as const,
      additions,
      deletions: 1,
      binary: false,
    },
  ],
  additions,
  deletions: 1,
});

function botWithFix() {
  updateProjectBot(PATH, (bot) =>
    withReadyFix(
      {
        ...bot,
        on: true,
        base: BASE,
        copy: { path: COPY, branch: "aven/bot/jelly-1a2b", root: PATH },
      },
      {
        base: BASE,
        turnId: "t1",
        files: 1,
        additions: 2,
        deletions: 1,
        paths: ["a.ts"],
        at: 1,
      },
    ),
  );
  return pendingFix(getProjectBot(PATH))!.id;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  for (const fn of Object.values(host)) fn.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
});

describe("acting on a bot's fix", () => {
  it("applies exactly what the card showed, then syncs the copy", async () => {
    const id = botWithFix();
    host.diff.mockResolvedValue(change(2));
    host.apply.mockResolvedValue(change(2));
    host.sync.mockResolvedValue({
      root: PATH,
      base: "c".repeat(40),
      uncommitted: true,
      untracked: false,
    });
    expect(await applyBotFix(PATH, id)).toBeNull();
    expect(host.apply).toHaveBeenCalledWith(PATH, COPY, BASE);
    const bot = getProjectBot(PATH)!;
    expect(bot.fixes![0].state).toBe("applied");
    expect(bot.base).toBe("c".repeat(40));
  });

  it("shows a fix again when its copy changed since you looked", async () => {
    const id = botWithFix();
    host.diff.mockResolvedValue(change(5));
    expect(await applyBotFix(PATH, id)).toMatch(/changed since you looked/);
    expect(host.apply).not.toHaveBeenCalled();
    expect(pendingFix(getProjectBot(PATH))).toMatchObject({ additions: 5 });
  });

  it("keeps the fix when applying conflicts, and says so plainly", async () => {
    const id = botWithFix();
    host.diff.mockResolvedValue(change(2));
    host.apply.mockRejectedValue(
      "These changes conflict with edits in your project: patch failed",
    );
    expect(await applyBotFix(PATH, id)).toBe(
      "These changes conflict with edits in your files. Save or undo those edits, then try again.",
    );
    expect(pendingFix(getProjectBot(PATH))?.error).toMatch(/conflict/);
  });

  it("waits for a bot at work before applying or throwing away", async () => {
    const id = botWithFix();
    updateProjectBot(PATH, (bot) => ({
      ...bot,
      job: { owner: "w", since: Date.now(), heartbeat: Date.now() },
    }));
    expect(await applyBotFix(PATH, id)).toMatch(/still working/);
    expect(await discardBotFix(PATH, id)).toMatch(/still working/);
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.discard).not.toHaveBeenCalled();
  });

  it("turning off stops a bot at work first, then tidies up", async () => {
    botWithFix();
    const order: string[] = [];
    const stop = installBotWorkspace({
      openChat: () => undefined,
      openSettings: () => undefined,
      release: () => order.push("release"),
      stop: async () => {
        // Already off, so nothing new starts while it stops.
        order.push(`stop:${getProjectBot(PATH)?.on}`);
      },
    });
    host.remove.mockImplementation(async () => {
      order.push("remove");
    });
    expect(await turnOffProjectBot(PATH)).toBeNull();
    expect(order).toEqual(["stop:false", "remove", "release"]);
    stop();
  });

  it("throws a fix away by resetting the copy", async () => {
    const id = botWithFix();
    host.discard.mockResolvedValue(undefined);
    expect(await discardBotFix(PATH, id)).toBeNull();
    expect(host.discard).toHaveBeenCalledWith(
      COPY,
      BASE,
      "aven/bot/jelly-1a2b",
    );
    expect(getProjectBot(PATH)!.fixes![0].state).toBe("discarded");
  });
});

describe("turning a bot on and off", () => {
  it("makes its copy first, and says plainly when the folder is not a Git project", async () => {
    host.prepare.mockRejectedValueOnce("A bot needs a git repository.");
    expect(
      await turnOnProjectBot(
        PATH,
        { wakes: { chatFinished: true, devServer: true }, can: { fix: true } },
        "Jelly",
      ),
    ).toBe("Bots need a Git project. This folder isn't a Git repository yet.");
    expect(getProjectBot(PATH)?.on).toBeFalsy();
    host.prepare.mockResolvedValueOnce({
      path: COPY,
      branch: "aven/bot/jelly-1a2b",
      root: PATH,
    });
    expect(
      await turnOnProjectBot(
        PATH,
        { wakes: { chatFinished: true, devServer: false }, can: { fix: true } },
        "Jelly",
      ),
    ).toBeNull();
    expect(host.prepare.mock.calls[1][2]).toMatch(
      /^aven\/bot\/jelly-[0-9a-f]{4}$/,
    );
    expect(getProjectBot(PATH)).toMatchObject({
      on: true,
      copy: { path: COPY },
      wakes: { chatFinished: true, devServer: false },
    });
  });

  it("removes its copy and what it was doing when turned off, and all of it with the project", async () => {
    botWithFix();
    updateProjectBot(PATH, (bot) => ({ ...bot, name: "Sam", sessionId: "c" }));
    host.remove.mockResolvedValue(undefined);
    expect(await turnOffProjectBot(PATH)).toBeNull();
    expect(host.remove).toHaveBeenCalledWith(PATH, COPY, "aven/bot/jelly-1a2b");
    const bot = getProjectBot(PATH)!;
    expect(bot).toMatchObject({ on: false, name: "Sam", sessionId: "c" });
    expect(bot.copy).toBeUndefined();
    expect(bot.fixes).toBeUndefined();
    botWithFix();
    await forgetBotForProject(PATH);
    expect(getProjectBot(PATH)).toBeUndefined();
  });

  it("turns on in one step with its defaults, once Claude Code is there", async () => {
    claude.available = false;
    expect(await turnOnBotWithDefaults(PATH)).toMatch(/Bots use Claude Code/);
    expect(host.prepare).not.toHaveBeenCalled();
    claude.available = true;
    host.prepare.mockResolvedValueOnce({
      path: COPY,
      branch: "aven/bot/x-1a2b",
      root: PATH,
    });
    expect(await turnOnBotWithDefaults(PATH)).toBeNull();
    expect(getProjectBot(PATH)).toMatchObject({
      on: true,
      wakes: { chatFinished: true, devServer: true },
      can: { fix: true },
    });
    expect(getProjectBot(PATH)?.name).toBeUndefined();
  });
});
