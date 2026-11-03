// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tellTeam } from "./crewActions";
import { CrewRunner, resetCrewRunnerSession } from "./crewRunner";
import { TALK_HOPS, parseTalk } from "./crewTalk";
import {
  crewLead,
  getCrew,
  newCrew,
  resetCrewsCache,
  updateCrew,
  withTalk,
  type Crew,
} from "./crews";
import { ideaWaits } from "./crewLimits";
import { localDay } from "./projectBots";
import { resetProjectBotsCache } from "./projectBots";
import type { BotSendOptions } from "./projectBotRunner";
import type { Session } from "./session";

const PATH = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";
const NOON = new Date(2026, 9, 29, 12, 0).getTime();
const MINUTE = 60_000;

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

const talk = (fields: Record<string, unknown>, before = "Done.") =>
  `${before}\n\n\`\`\`aven-talk\n${JSON.stringify(fields)}\n\`\`\``;

type Agent = (text: string) => string | { text: string; status: "failed" };

function harness(agents: Record<string, Agent>) {
  let now = NOON;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let sessions: Session[] = [];
  const sent: { memberId: string; text: string; options: BotSendOptions }[] =
    [];
  const added: { title: string }[] = [];
  const memberOf = new Map<string, string>();
  const update = (id: string, change: (chat: Session) => Session) => {
    sessions = sessions.map((chat) => (chat.id === id ? change(chat) : chat));
  };
  const runner = new CrewRunner({
    owner: "me",
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id: number) => void timers.delete(id),
    sessions: () => sessions,
    ensureChat: async (_crew: Crew, memberId: string) => {
      const id = `${memberId}-chat`;
      memberOf.set(id, memberId);
      if (!sessions.some((chat) => chat.id === id))
        sessions = [
          ...sessions,
          {
            id,
            harness: "claude",
            model: "claude:test",
            modelSettings: {},
            runtimeMode: "auto",
            title: memberId,
            cwd: PATH,
            worktreeCwd: COPY,
            blocks: [],
          } as Session,
        ];
      return sessions.find((chat) => chat.id === id)!;
    },
    send: (sessionId: string, text: string, options: BotSendOptions) => {
      const memberId = memberOf.get(sessionId)!;
      sent.push({ memberId, text, options });
      update(sessionId, (chat) => ({
        ...chat,
        busy: true,
        blocks: [
          ...chat.blocks,
          { id: options.blockId, role: "user", text: options.displayText },
        ],
      }));
      const reply =
        (memberId.startsWith("helper-") ? agents.helper : agents[memberId])?.(
          text,
        ) ?? "";
      const id = nextId++;
      timers.set(id, {
        at: now + MINUTE,
        run: () => {
          const words = typeof reply === "string" ? reply : reply.text;
          update(sessionId, (chat) => ({
            ...chat,
            busy: false,
            providerSessionId: `provider-${sessionId}`,
            blocks: [
              ...chat.blocks,
              { id: `reply-${nextId++}`, role: "assistant", text: words },
            ],
          }));
          options.onSettled({
            status: typeof reply === "string" ? "completed" : reply.status,
            text: words,
          } as never);
        },
      });
      return true;
    },
    stopChat: vi.fn(),
    copy: {
      prepare: vi.fn(async (_cwd: string, _key: string, branch: string) => ({
        path: COPY,
        branch,
        root: PATH,
        gitDir: `${PATH}/.git`,
      })),
      sync: vi.fn(),
      diff: vi.fn(),
      sources: vi.fn(async () => [`${COPY}/src`]),
      entries: vi.fn(async () => [`${COPY}/src`]),
      planted: vi.fn(async () => []),
      stack: vi.fn(),
      unstack: vi.fn(),
      discard: vi.fn(),
    },
    board: {
      cards: async () => [],
      move: vi.fn(),
      add: vi.fn(
        async (_path: string, drafts: readonly { title: string }[]) => {
          added.push(...drafts);
          return drafts.map((draft, index) => ({
            ...draft,
            id: `card-${index}`,
          }));
        },
      ),
    },
    name: (crew: Crew, who: string) =>
      crew.members.find((member) => member.id === who)?.role === "lead"
        ? "Lead"
        : who.charAt(0).toUpperCase() + who.slice(1),
    onWorking: vi.fn(),
    weeklyUsed: () => 0,
    fixerRuns: () => 0,
    fixerBranch: () => undefined,
  } as never);
  /** Until nothing is running or due. */
  const settle = async () => {
    for (let round = 0; round < 40; round += 1) {
      await runner.pump();
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now + MINUTE)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  return { runner, sent, added, settle };
}

function withLead(crew: Crew): Crew {
  return {
    ...crew,
    members: [{ id: "lead", role: "lead", critter: "lead" }, ...crew.members],
  };
}

function team(change: (crew: Crew) => Crew = (crew) => crew) {
  updateCrew(PATH, () =>
    change({
      ...withLead(newCrew(PATH, NOON)),
      on: true,
      onAt: NOON,
    }),
  );
}

const lines = () =>
  getCrew(PATH)!
    .feed.filter((entry) => entry.kind === "say")
    .map((entry) => entry.text);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetCrewsCache();
  resetProjectBotsCache();
  resetCrewRunnerSession();
});

afterEach(() => vi.unstubAllGlobals());

describe("a message to everyone", () => {
  it("goes to the Lead, who answers in one line", async () => {
    team();
    expect(crewLead(getCrew(PATH)!)?.id).toBe("lead");
    const { runner, sent, settle } = harness({
      lead: () => talk({ line: "Tests pass on main." }, "A long answer."),
    });
    runner.start();
    expect(await tellTeam(PATH, "Do the tests pass?", "lead", NOON)).toBeNull();
    await settle();
    expect(sent.map((turn) => turn.memberId)).toEqual(["lead"]);
    expect(sent[0]!.text).toContain("Do the tests pass?");
    expect(sent[0]!.options.displayText).toBe("Do the tests pass?");
    expect(lines()).toEqual(["Tests pass on main."]);
    expect(getCrew(PATH)!.talks ?? []).toEqual([]);
    runner.stop();
  });

  it("tells you when the team has no Lead", async () => {
    team((crew) => ({
      ...crew,
      members: crew.members.filter((member) => member.role !== "lead"),
    }));
    expect(await tellTeam(PATH, "Hello", "lead", NOON)).toMatch(/no Lead/);
    expect(getCrew(PATH)!.messages ?? []).toEqual([]);
  });

  it("builds small cards from your message, and large ones wait", async () => {
    team();
    const { runner, added, settle } = harness({
      lead: () =>
        talk({
          line: "On the Board.",
          cards: [
            { title: "Fix the footer", size: "small" },
            { title: "Rewrite everything", size: "large" },
          ],
        }),
    });
    runner.start();
    await tellTeam(PATH, "Fix the footer", "lead", NOON);
    await settle();
    expect(added.map((card) => card.title)).toEqual([
      "Fix the footer",
      "Rewrite everything",
    ]);
    const crew = getCrew(PATH)!;
    expect(ideaWaits(crew, { id: "card-0" }, NOON)).toBeNull();
    expect(ideaWaits(crew, { id: "card-1" }, NOON)).toBe("large");
    runner.stop();
  });
});

describe("a routine", () => {
  it("runs on its rhythm, once, within the team's limits", async () => {
    team((crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.role === "lead"
          ? {
              ...member,
              routine: {
                text: "Say what changed",
                every: "day" as const,
                at: 0,
              },
            }
          : member,
      ),
    }));
    const { runner, sent, settle } = harness({
      lead: () => talk({ line: "Nothing changed." }),
    });
    runner.start();
    await settle();
    expect(sent.map((turn) => turn.memberId)).toEqual(["lead"]);
    expect(sent[0]!.text).toContain("A routine the user set");
    expect(sent[0]!.options.botWake).toBeTruthy();
    expect(lines()).toEqual(["Nothing changed."]);
    await settle();
    expect(sent).toHaveLength(1);
    runner.stop();
  });
});

describe("helpers", () => {
  const started = () => getCrew(PATH)!.helpers ?? [];

  it("runs one read-only, on its parent's app, and hands its answer back", async () => {
    team((crew) => ({
      ...crew,
      members: crew.members.map((member) =>
        member.role === "lead"
          ? { ...member, harness: "codex" as const, model: "codex:x" }
          : member,
      ),
    }));
    let turns = 0;
    const { runner, sent, settle } = harness({
      lead: () =>
        turns++ === 0
          ? talk({
              line: "Looking.",
              helpers: [{ title: "Read the tests", task: "Which fail?" }],
            })
          : talk({ line: "All pass." }),
      helper: () => talk({ line: "None fail." }, "Read them all: none fail."),
    });
    runner.start();
    await tellTeam(PATH, "Do tests pass?", "lead", NOON);
    await runner.pump();
    expect(sent.map((turn) => turn.memberId)).toEqual(["lead"]);
    await settle();
    helperApp = sent.find((turn) =>
      turn.text.includes("a helper in"),
    )?.memberId;
    expect(helperApp).toMatch(/^helper-/);
    const helperTurn = sent.find((turn) => turn.memberId === helperApp)!;
    expect(helperTurn.text).toContain("<teammate-message");
    expect(helperTurn.text).not.toContain('"helpers"');
    expect(helperTurn.text).not.toContain('"ask"');
    expect(started()).toEqual([]);
    expect(lines()).toContain("All pass.");
    expect(sent.at(-1)!.text).toContain("Read them all");
    runner.stop();
  });

  it("keeps to the limit for one teammate, and notes the rest", async () => {
    team();
    const { runner, sent, settle } = harness({
      lead: () =>
        talk({
          line: "Many.",
          helpers: [
            { title: "One", task: "1" },
            { title: "Two", task: "2" },
          ],
        }),
    });
    updateCrew(PATH, (crew) => ({
      ...crew,
      helperRuns: { day: localDay(NOON), count: 9 },
    }));
    runner.start();
    await tellTeam(PATH, "Go", "lead", NOON);
    await settle();
    const helpers = sent.filter((turn) => turn.memberId.startsWith("helper-"));
    expect(helpers).toHaveLength(1);
    expect(
      getCrew(PATH)!.feed.some((entry) => /wanted a helper/.test(entry.text)),
    ).toBe(true);
    runner.stop();
  });

  it("starts none from a turn that could read the web", async () => {
    team((crew) => ({
      ...crew,
      access: { deletes: true, web: "everyone", others: "allow" },
      members: [
        ...crew.members,
        { id: "scout", role: "scout", critter: "scout", schedule: "off" },
      ],
    }));
    const { runner, sent, settle } = harness({
      scout: () =>
        talk({ line: "No.", helpers: [{ title: "One", task: "1" }] }),
    });
    updateCrew(PATH, (crew) =>
      withTalk(crew, {
        at: NOON,
        from: "lead",
        to: "scout",
        text: "Look",
        hop: 1,
      }),
    );
    runner.start();
    await settle();
    expect(sent.some((turn) => turn.memberId.startsWith("helper-"))).toBe(
      false,
    );
    expect(sent[0]!.text).not.toContain('"helpers"');
    runner.stop();
  });
});

describe("teammates asking each other", () => {
  it("carries a question and its answer, whatever app each runs on", async () => {
    team();
    let asked = 0;
    const { runner, sent, settle } = harness({
      lead: () =>
        asked++ === 0
          ? talk({
              line: "Asking the Checker.",
              ask: [{ to: "Checker", text: "Did it pass?" }],
            })
          : talk({ line: "It passed." }),
      checker: () => talk({ line: "Yes." }, "All green."),
    });
    runner.start();
    await tellTeam(PATH, "Did it pass?", "lead", NOON);
    await settle();
    expect(sent.map((turn) => turn.memberId)).toEqual([
      "lead",
      "checker",
      "lead",
    ]);
    // Another agent's words arrive quoted, as data.
    expect(sent[1]!.text).toContain("<teammate-message");
    expect(sent[1]!.text).toMatch(/can't approve anything/);
    expect(sent[1]!.options.botWake).toBeTruthy();
    expect(sent[2]!.text).toContain("All green.");
    expect(lines()).toContain("It passed.");
    runner.stop();
  });

  it("stops passing a message on at the limit", async () => {
    team();
    const pass = (to: string) => () =>
      talk({ line: "Passing on.", ask: [{ to, text: "Your turn." }] });
    const { runner, sent, settle } = harness({
      lead: pass("Checker"),
      checker: pass("Lead"),
    });
    runner.start();
    await tellTeam(PATH, "Go round", "lead", NOON);
    await settle();
    expect(sent.length).toBeLessThanOrEqual(TALK_HOPS * 2 + 1);
    expect(
      getCrew(PATH)!.feed.some((entry) => /as far as it goes/.test(entry.text)),
    ).toBe(true);
    expect(getCrew(PATH)!.talks ?? []).toEqual([]);
    runner.stop();
  });

  it("names nobody it doesn't know, and never itself", async () => {
    team();
    const { runner, sent, settle } = harness({
      lead: () =>
        talk({
          line: "Hm.",
          ask: [
            { to: "Stranger", text: "Hello" },
            { to: "Lead", text: "Me?" },
          ],
        }),
    });
    runner.start();
    await tellTeam(PATH, "Who's there?", "lead", NOON);
    await settle();
    expect(sent).toHaveLength(1);
    runner.stop();
  });

  it("holds teammates' messages to the team's daily limit, never yours", async () => {
    team((crew) => ({
      ...crew,
      limits: { ...crew.limits, runsPerDay: 1 },
      runs: { day: localDay(NOON), count: 99 },
    }));
    const { runner, sent, settle } = harness({
      lead: () =>
        talk({ line: "Asking.", ask: [{ to: "Checker", text: "Well?" }] }),
    });
    runner.start();
    await tellTeam(PATH, "Well?", "lead", NOON);
    await settle();
    expect(sent.map((turn) => turn.memberId)).toEqual(["lead"]);
    runner.stop();
  });

  it("keeps a card's reply out of what a message can do", () => {
    const said = parseTalk(
      '```aven-verdict\n{"pass":true}\n```\n\n```aven-talk\n{"line":"Hi"}\n```',
    );
    expect(said).toEqual({ line: "Hi", asks: [], cards: [], helpers: [] });
  });

  it("reads only the block that ends the reply", () => {
    const said = parseTalk(
      'Before: ```aven-talk\n{"line":"Early","ask":[{"to":"Builder","text":"x"}]}\n```\n\nNot the end of it.',
    );
    expect(said.asks).toEqual([]);
  });
});
