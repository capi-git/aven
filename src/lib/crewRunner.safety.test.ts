// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopCrewCard, stopCrewNow, turnOffCrew } from "./crewActions";
import { afterBuild, queueCard, startCard } from "./crewLoop";
import { CrewRunner } from "./crewRunner";
import {
  crewCard,
  getCrew,
  resetCrewsCache,
  updateCrew,
  withCard,
  withMember,
  type CrewCard,
} from "./crews";
import {
  launchRefusal,
  sessionPermissions,
} from "./harness/sessionPermissions";
import {
  crewChatPermissions,
  installBotPermissions,
} from "./projectBotPermissions";
import { resetProjectBotsCache } from "./projectBots";
import type { Session } from "./session";

/*
 * The safety review's proofs (crews-review/off-unsandboxed, stop-lost), as
 * tests of the fix: nothing prepared for a card may go once the crew is off
 * or the card was stopped, and a crew's chat never launches without its
 * rules or outside its copy.
 */

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

const PATH = "/Users/me/site";
const COPY = "/data/bots/site-crew";
const NOON = new Date(2026, 9, 29, 12).getTime();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

/** A card the Builder finished, waiting for its check. */
function checkingCard(): CrewCard {
  let card = startCard(
    queueCard(
      { id: "c1", title: "Dark mode", brief: "x", from: "you", maxRounds: 3 },
      1,
    ),
    2,
  );
  card = { ...card, base: "base-1" };
  return afterBuild(card, {
    handoff: { summary: "Done", howToCheck: [], ran: [] },
    change: {
      base: "base-1",
      hash: "h1",
      files: 1,
      additions: 1,
      deletions: 0,
      paths: [],
    },
    now: 3,
  }).card;
}

/**
 * A runner whose before-check fingerprint waits for `release`, so the test
 * can act while Aven prepares the Checker's turn.
 */
function gatedRunner() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sent: { id: string; permissions: unknown }[] = [];
  const stopped: string[] = [];
  const session = {
    id: "s-checker",
    blocks: [],
    busy: false,
  } as unknown as Session;
  const runner = new CrewRunner({
    owner: "me",
    now: () => NOON,
    setTimer: (run, ms) => setTimeout(run, ms) as unknown as number,
    clearTimer: (id) => clearTimeout(id),
    sessions: () => [session],
    ensureChat: async () => session,
    send: (id) => {
      // What the harness reads when it launches the turn's agent.
      sent.push({ id, permissions: crewChatPermissions(id) ?? null });
      return true;
    },
    stopChat: (id) => void stopped.push(id),
    copy: {
      prepare: async (_cwd, _key, branch) => ({
        path: COPY,
        branch,
        root: PATH,
        gitDir: `${PATH}/.git`,
      }),
      sync: async () => ({
        root: PATH,
        base: "b",
        uncommitted: false,
        untracked: false,
      }),
      diff: async () => {
        await gate;
        return {
          files: [
            {
              path: "a",
              status: "modified" as const,
              additions: 1,
              deletions: 0,
              binary: false,
            },
          ],
          additions: 1,
          deletions: 0,
          hash: "h1",
        };
      },
      sources: async () => [`${COPY}/src`],
    },
    weeklyUsed: () => null,
    fixerRuns: () => 0,
    fixerBranch: () => undefined,
    board: {
      cards: async () => [],
      move: () => undefined,
      add: async () => [],
    },
    name: (_crew, role) => role,
    onWorking: () => {},
  });
  return { runner, release, sent, stopped };
}

function seedChecking() {
  updateCrew(PATH, (crew) =>
    withMember(
      withCard(
        {
          ...crew,
          on: true,
          onAt: 1,
          copy: {
            path: COPY,
            branch: "aven/bot/crew-x",
            root: PATH,
            sources: [`${COPY}/src`],
          },
        },
        checkingCard(),
      ),
      "checker",
      (member) => ({ ...member, harness: "codex", sessionId: "s-checker" }),
    ),
  );
}

describe("nothing prepared goes once the crew is off or the card is stopped", () => {
  it("turning the crew off while a Checker turn is prepared sends nothing", async () => {
    seedChecking();
    expect(crewChatPermissions("s-checker")?.readOnly).toBe(true);
    const { runner, release, sent } = gatedRunner();
    runner.start();
    await sleep(10); // the runner waits on the before-check fingerprint
    await turnOffCrew(PATH);
    expect(getCrew(PATH)!.on).toBe(false);
    release();
    await sleep(20);
    expect(sent).toEqual([]);
    // The off crew's card isn't marked as running.
    expect(crewCard(getCrew(PATH)!, "c1")!.turn).toBeUndefined();
    runner.stop();
  });

  it("Stop pressed while Aven prepares the Checker's turn stands, and nothing runs", async () => {
    seedChecking();
    const { runner, release, sent } = gatedRunner();
    runner.start();
    await sleep(10);
    await stopCrewNow(PATH);
    expect(crewCard(getCrew(PATH)!, "c1")!.stage).toBe("stuck");
    release();
    await sleep(20);
    runner.stop();
    expect(sent).toEqual([]);
    const after = crewCard(getCrew(PATH)!, "c1")!;
    expect(after.stage).toBe("stuck");
    expect(after.stuck?.reason).toBe("stopped");
    expect(after.turn).toBeUndefined();
    expect(getCrew(PATH)!.paused).toBe(true);
  });

  it("a card stopped from another window stops its running turn here", async () => {
    seedChecking();
    const { runner, release, sent, stopped } = gatedRunner();
    release();
    runner.start();
    await sleep(20);
    expect(sent.map((item) => item.id)).toEqual(["s-checker"]);
    expect(crewCard(getCrew(PATH)!, "c1")!.turn?.role).toBe("checker");
    // Another window only writes the store; this window holds the process.
    await stopCrewCard(PATH, "c1");
    expect(stopped).toEqual(["s-checker"]);
    runner.stop();
  });

  it("turning the crew off stops its running turn, and the runner stopping stops it too", async () => {
    seedChecking();
    const { runner, release, stopped } = gatedRunner();
    release();
    runner.start();
    await sleep(20);
    updateCrew(PATH, (crew) => ({ ...crew, on: false }));
    expect(stopped).toEqual(["s-checker"]);
    runner.stop();
  });
});

describe("a crew's chat never launches without its rules or outside its copy", () => {
  it("resolves rules for a crew's chat whether the crew is on or off, and refuses while off", () => {
    const stop = installBotPermissions();
    seedChecking();
    const on = sessionPermissions("s-checker")!;
    expect(on).toMatchObject({
      readOnly: true,
      noMcp: true,
      workFolder: COPY,
    });
    expect(on.refuse).toBeUndefined();
    expect(launchRefusal("s-checker", COPY)).toBeNull();
    expect(launchRefusal("s-checker", `${COPY}/src`)).toBeNull();
    // Never in your own folder, or anywhere else.
    expect(launchRefusal("s-checker", PATH)).toMatch(/only in its own copy/);
    expect(launchRefusal("s-checker", "/tmp")).toMatch(/only in its own copy/);

    updateCrew(PATH, (crew) => ({ ...crew, on: false }));
    const off = sessionPermissions("s-checker")!;
    // Still sandboxed and read-only…
    expect(off.sandbox?.enabled).toBe(true);
    expect(off.readOnly).toBe(true);
    // …and refused outright.
    expect(launchRefusal("s-checker", COPY)).toMatch(/crew is off/);
    stop();
  });

  it("refuses a crew's chat whose rules can't be read at all", () => {
    seedChecking();
    // No resolver installed (a window that never set them up).
    expect(sessionPermissions("s-checker")).toBeUndefined();
    expect(launchRefusal("s-checker", COPY)).toMatch(/couldn't be read/);
    // So is anything launched inside a crew's copy.
    expect(launchRefusal("someone-else", `${COPY}/src`)).toMatch(
      /couldn't be read/,
    );
    // An ordinary chat is unaffected.
    expect(launchRefusal("someone-else", PATH)).toBeNull();
  });

  it("refuses a crew's chat before its copy exists", () => {
    const stop = installBotPermissions();
    updateCrew(PATH, (crew) =>
      withMember({ ...crew, on: true, onAt: 1 }, "builder", (member) => ({
        ...member,
        sessionId: "s-builder",
      })),
    );
    expect(launchRefusal("s-builder", PATH)).toMatch(/copy isn't ready/);
    stop();
  });

  it("every crew chat, on or off, resolves to rules that are never empty", () => {
    const stop = installBotPermissions();
    seedChecking();
    for (const on of [true, false]) {
      updateCrew(PATH, (crew) => ({ ...crew, on }));
      for (const id of ["s-checker"]) {
        const permissions = sessionPermissions(id);
        expect(permissions).toBeDefined();
        expect(permissions!.rules.deny).toContain("Bash(git push)");
        expect(permissions!.sandbox?.failIfUnavailable).toBe(true);
        expect(permissions!.workFolder).toBe(COPY);
        expect(launchRefusal(id, PATH)).not.toBeNull();
      }
    }
    stop();
  });
});
