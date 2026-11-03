// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askDesigner,
  buildMockup,
  designQuestion,
  dismissMockup,
  resumeCrewCard,
} from "./crewActions";
import { queueCard } from "./crewLoop";
import { mockupFileName } from "./crewMockups";
import { basename } from "./fs";
import { CrewRunner, resetCrewRunnerSession } from "./crewRunner";
import {
  cardInCopy,
  crewCard,
  getCrew,
  resetCrewsCache,
  updateCrew,
  type Crew,
} from "./crews";
import {
  addFeatureCards,
  addFeatureIdea,
  featureBoardState,
  loadFeatureCards,
  memoryFeatureCardBackend,
  moveFeatureCard,
  setFeatureCardBackend,
} from "./featureCards";
import { resetProjectBotsCache } from "./projectBots";
import type { BotDiff } from "./projectBotCopy";
import type { BotSendOptions } from "./projectBotRunner";
import type { Session } from "./session";

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

const PATH = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";
const BASE = "b".repeat(40);
const NOON = new Date(2026, 9, 29, 12, 0).getTime();
const MINUTE = 60_000;
const target = { file: "" };
const GOOD =
  "<html><body><style>b{color:red}</style><b>Timer</b></body></html>";

const fence = (file: string, note = "The ring fills, with the end state") =>
  `Drawn.\n\n\`\`\`aven-mockup\n${JSON.stringify({ file, note })}\n\`\`\``;

type Reply = {
  text: string;
  /** What the turn wrote in the copy: path → text. */
  wrote?: Record<string, string>;
  status?: "completed" | "failed" | "cancelled";
};

/** A stand-in team whose copy remembers what each turn wrote. */
function harness(agents: Partial<Record<string, (text: string) => Reply>>) {
  let now = NOON;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  let sessions: Session[] = [];
  const sent: { memberId: string; text: string; options: BotSendOptions }[] =
    [];
  const fresh: string[] = [];
  let files: Record<string, string> = {};
  /** Files the turn wrote as links, not files. */
  const links = new Set<string>();
  /** The copy's top-level entries, as the host would list them. */
  let entries = [`${COPY}/src`];
  const kept: Record<string, string> = {};
  const memberOf = new Map<string, string>();
  const diff = (): BotDiff => {
    const paths = Object.keys(files);
    return {
      files: paths.map((path) => ({
        path,
        status: "added",
        additions: 3,
        deletions: 0,
        binary: false,
        ...(links.has(path) ? { newMode: "120000" } : {}),
      })),
      additions: paths.length * 3,
      deletions: 0,
      hash: paths.length ? `h-${paths.join("+")}` : "empty",
    };
  };
  const update = (id: string, change: (chat: Session) => Session) => {
    sessions = sessions.map((chat) => (chat.id === id ? change(chat) : chat));
  };
  const copy = {
    prepare: vi.fn(async (_cwd: string, _key: string, branch: string) => ({
      path: COPY,
      branch,
      root: PATH,
      gitDir: `${PATH}/.git`,
    })),
    sync: vi.fn(async () => {
      files = {};
      return { root: PATH, base: BASE, uncommitted: false, untracked: false };
    }),
    diff: vi.fn(async () => diff()),
    sources: vi.fn(async () => [`${COPY}/src`]),
    entries: vi.fn(async () => entries),
    planted: vi.fn(async (): Promise<string[]> => []),
    stack: vi.fn(async () => "c".repeat(40)),
    unstack: vi.fn(async () => {}),
    discard: vi.fn(async () => {
      files = {};
    }),
  };
  const mockups = {
    read: vi.fn(async (path: string) => {
      const relative = path.slice(`${COPY}/`.length);
      const text = files[relative];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    }),
    save: vi.fn(async (_copy: string, cardId: string, html: string) => {
      const target = `/data/bots/mockups/aven-site-crew-1/${cardId}.html`;
      kept[target] = html;
      return target;
    }),
    clear: vi.fn(async (_copy: string, stray: readonly string[] = []) => {
      for (const path of Object.keys(files))
        if (
          path.startsWith("aven-mockups/") ||
          stray.some((name) => path === name || path.startsWith(`${name}/`))
        )
          delete files[path];
      entries = entries.filter((entry) => !stray.includes(basename(entry)));
    }),
  };
  const runner = new CrewRunner({
    owner: "me",
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => void timers.delete(id),
    sessions: () => sessions,
    ensureChat: async (_crew: Crew, memberId) => {
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
    send: (sessionId, text, options) => {
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
      const reply = agents[memberId]?.(text) ?? { text: "" };
      const id = nextId++;
      timers.set(id, {
        at: now + MINUTE,
        run: () => {
          if (reply.wrote) files = { ...files, ...reply.wrote };
          update(sessionId, (chat) => ({
            ...chat,
            busy: false,
            providerSessionId: `provider-${sessionId}`,
            blocks: [
              ...chat.blocks,
              { id: `reply-${nextId++}`, role: "assistant", text: reply.text },
            ],
          }));
          options.onSettled({
            status: reply.status ?? "completed",
            text: reply.text,
          });
        },
      });
      return true;
    },
    stopChat: (sessionId) =>
      update(sessionId, (chat) => ({ ...chat, busy: false })),
    copy,
    weeklyUsed: () => 40,
    fixerRuns: () => 0,
    fixerBranch: () => undefined,
    board: {
      cards: async (project) => {
        await loadFeatureCards(project);
        return featureBoardState(project).cards;
      },
      move: (project, id, column) => moveFeatureCard(project, id, column, ""),
      add: (project, drafts) => addFeatureCards(project, drafts),
    },
    name: (crew, who) =>
      (crew.members.find((member) => member.id === who)?.role === "designer"
        ? "Brush"
        : undefined) ?? who,
    onWorking: () => {},
    freshConversation: (sessionId) => {
      fresh.push(sessionId);
      update(sessionId, (chat) => ({ ...chat, providerSessionId: undefined }));
    },
    newId: () => `turn-${nextId++}`,
    mockups,
  });
  const flush = async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      await flush();
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].run();
      await flush();
    }
    now = end;
    await flush();
  };
  return {
    runner,
    sent,
    fresh,
    copy,
    mockups,
    kept,
    advance,
    get files() {
      return files;
    },
    /** Files already in the copy before the next turn. */
    seed: (more: Record<string, string>) => {
      files = { ...files, ...more };
    },
    links,
    /** What the copy's top level holds from now on. */
    setEntries: (names: string[]) => {
      entries = names.map((name) => `${COPY}/${name}`);
    },
    get now() {
      return now;
    },
  };
}

function onTeam(patch: Partial<Crew> = {}) {
  updateCrew(PATH, (crew) => ({
    ...crew,
    on: true,
    onAt: 1,
    members: [
      { id: "builder", role: "builder" },
      { id: "checker", role: "checker" },
      { id: "designer", role: "designer" },
    ],
    ...patch,
  }));
}

const card = (id: string) => crewCard(getCrew(PATH)!, id)!;
const boardCard = (id: string) =>
  featureBoardState(PATH).cards.find((item) => item.id === id);

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  setFeatureCardBackend(memoryFeatureCardBackend());
  resetProjectBotsCache();
  resetCrewsCache();
  resetCrewRunnerSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setFeatureCardBackend(null);
  resetProjectBotsCache();
  resetCrewsCache();
});

describe("the Add an idea box", () => {
  it("reads “Design: …” and “Mock up: …” as a screen for the Designer", () => {
    expect(designQuestion("Design: the timer screen")).toBe("the timer screen");
    expect(designQuestion("Mock up: the today list")).toBe("the today list");
    expect(designQuestion("mockup — settings page")).toBe("settings page");
    expect(designQuestion("Ask Designer: a calmer empty state")).toBe(
      "a calmer empty state",
    );
    expect(designQuestion("Design-system tokens")).toBeNull();
    expect(designQuestion("Mock-up tests")).toBeNull();
    expect(designQuestion("Designing the timer")).toBeNull();
  });
});

describe("a screen for the Designer", () => {
  it("needs a Designer on, then waits in Building as a mock-up card", async () => {
    onTeam({ members: [{ id: "builder", role: "builder" }] });
    const idea = (await addFeatureIdea(PATH, { title: "Timer screen" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    expect(await askDesigner(PATH, idea, NOON)).toBe(
      "Add a Designer to the team first.",
    );
    onTeam();
    expect(await askDesigner(PATH, idea, NOON)).toBeNull();
    expect(card(idea.id)).toMatchObject({
      kind: "mockup",
      stage: "queued",
      from: "you",
      maxRounds: 1,
    });
    expect(boardCard(idea.id)?.column).toBe("building");
    expect(getCrew(PATH)!.feed.at(-1)?.text).toBe(
      "You asked Designer to mock up “Timer screen”",
    );
  });

  it("takes one turn, keeps the one file it drew, empties the copy, and lands as a Mock-up", async () => {
    const h = harness({
      designer: () => ({
        text: fence(target.file),
        wrote: { [target.file]: GOOD },
      }),
    });
    onTeam({ access: { web: "everyone" } });
    const idea = (await addFeatureIdea(PATH, {
      title: "Timer: a ring that fills",
      note: "With a gentle end sound.",
    }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(0);
    expect(card(idea.id)).toMatchObject({
      stage: "building",
      holder: "designer",
      turn: { role: "designer", sessionId: "designer-chat" },
    });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.memberId).toBe("designer");
    expect(h.sent[0]!.options.botWake?.label).toBe(
      "Mock-up · Timer: a ring that fills",
    );
    expect(h.sent[0]!.text).toContain("You are Brush, the Designer");
    expect(h.sent[0]!.text).toContain(target.file);
    expect(h.sent[0]!.text).toContain("With a gentle end sound.");
    // Even with the web open to everyone, the Designer's turn has none.
    expect(h.sent[0]!.text).not.toContain("search, and read the pages");
    expect(
      getCrew(PATH)!.members.find((member) => member.id === "designer")?.doing
        ?.text,
    ).toBe("Mocking up Timer: a ring that fills");

    await h.advance(MINUTE + 5_000);
    const drawn = card(idea.id);
    expect(drawn).toMatchObject({
      stage: "ready",
      holder: undefined,
      turn: undefined,
      mockup: {
        file: `/data/bots/mockups/aven-site-crew-1/${idea.id}.html`,
        note: "The ring fills, with the end state",
        bytes: GOOD.length,
      },
    });
    expect(drawn.fix).toBeUndefined();
    expect(h.kept[drawn.mockup!.file]).toBe(GOOD);
    // The copy's folder is emptied: nothing of it reaches the next card.
    expect(h.mockups.clear).toHaveBeenCalledWith(COPY);
    expect(h.files).toEqual({});
    expect(cardInCopy(getCrew(PATH)!)).toBeUndefined();
    expect(boardCard(idea.id)?.column).toBe("review");
    expect(getCrew(PATH)!.feed.at(-1)).toMatchObject({
      kind: "mockup",
      who: "designer",
      text: "Brush mocked up “Timer: a ring that fills”: The ring fills, with the end state",
    });

    // Build it: an idea of yours, pointing a Builder at the file Aven keeps.
    // Pressed twice before the Board answers, it is still one idea.
    expect(
      await Promise.all([
        buildMockup(PATH, idea.id, h.now),
        buildMockup(PATH, idea.id, h.now),
      ]),
    ).toEqual([null, null]);
    expect(card(idea.id)).toMatchObject({
      stage: "applied",
      mockup: { outcome: "built" },
    });
    expect(boardCard(idea.id)?.column).toBe("shipped");
    const builds = featureBoardState(PATH).cards.filter(
      (item) => item.title === "Build the mock-up: Timer: a ring that fills",
    );
    expect(builds).toHaveLength(1);
    const build = builds[0]!;
    expect(build.column).toBe("idea");
    expect(build.note).toContain(drawn.mockup!.file);
    expect(build.note).toContain("never change it");
    expect(getCrew(PATH)!.ideas?.[build.id]).toBeUndefined();
    h.runner.stop();
  });

  it("stops with why when it wrote outside its folder, and Try again puts the copy back", async () => {
    let nth = 0;
    const h = harness({
      designer: (): Reply => {
        nth += 1;
        if (nth === 1)
          return {
            text: fence(target.file),
            wrote: { [target.file]: GOOD, "src/app.ts": "x" },
          };
        return {
          text: fence(target.file),
          wrote: { [target.file]: GOOD },
        };
      },
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id)).toMatchObject({
      stage: "stuck",
      stuck: {
        reason: "checker-edited",
        text: "Brush wrote outside aven-mockups, so its mock-up wasn't kept: src/app.ts",
      },
    });
    expect(card(idea.id).mockup).toBeUndefined();
    expect(h.mockups.save).not.toHaveBeenCalled();
    // Its stray file holds the copy until you act.
    expect(cardInCopy(getCrew(PATH)!)?.id).toBe(idea.id);
    resumeCrewCard(PATH, idea.id);
    await h.advance(MINUTE + 5_000);
    expect(h.copy.discard).toHaveBeenCalledWith(COPY, BASE, expect.any(String));
    expect(card(idea.id).stage).toBe("ready");
    h.runner.stop();
  });

  it("refuses a mock-up when it can't list the copy after the turn", async () => {
    const h = harness({
      designer: () => {
        h.copy.entries.mockRejectedValueOnce(new Error("boom"));
        return { text: fence(target.file), wrote: { [target.file]: GOOD } };
      },
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck?.text).toBe(
      "Brush's mock-up wasn't kept: Aven couldn't list the team's copy after its turn",
    );
    expect(h.mockups.save).not.toHaveBeenCalled();
    expect(h.files).toEqual({});
    vi.restoreAllMocks();
    h.runner.stop();
  });

  it("refuses a mock-up Aven can't keep, and a turn that wrote two files or none", async () => {
    let nth = 0;
    const h = harness({
      designer: (): Reply => {
        nth += 1;
        if (nth === 1)
          return {
            text: fence(target.file),
            wrote: {
              [target.file]:
                '<div><script src="https://cdn.test/x.js"></script></div>',
            },
          };
        if (nth === 2)
          return {
            text: fence(target.file),
            wrote: {
              [target.file]: GOOD,
              "aven-mockups/b.html": GOOD,
            },
          };
        return { text: "I drew nothing." };
      },
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck?.text).toBe(
      "Brush's mock-up wasn't kept: it loads a script from a file or the web",
    );
    resumeCrewCard(PATH, idea.id);
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck?.text).toBe(
      "Brush's mock-up wasn't kept: it wrote 2 files; a mock-up is one",
    );
    resumeCrewCard(PATH, idea.id);
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck?.text).toBe(
      "Brush's turn ended without a mock-up",
    );
    expect(h.mockups.save).not.toHaveBeenCalled();
    // Nothing of its own in the copy: it steps aside, the team goes on.
    expect(cardInCopy(getCrew(PATH)!)).toBeUndefined();
    h.runner.stop();
  });

  it("Dismiss keeps nothing: the card is done as dismissed", async () => {
    const h = harness({
      designer: () => ({
        text: fence(target.file, ""),
        wrote: { [target.file]: GOOD },
      }),
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stage).toBe("ready");
    expect(await dismissMockup(PATH, idea.id, h.now)).toBeNull();
    expect(card(idea.id)).toMatchObject({
      stage: "applied",
      mockup: { outcome: "dismissed" },
    });
    expect(boardCard(idea.id)?.column).toBe("shipped");
    expect(featureBoardState(PATH).cards).toHaveLength(1);
    expect(getCrew(PATH)!.feed.at(-1)?.text).toBe(
      "You dismissed the mock-up for “Timer”",
    );
    // A mock-up card never goes to the Builder.
    await h.advance(10 * MINUTE);
    expect(h.sent.every((turn) => turn.memberId === "designer")).toBe(true);
    h.runner.stop();
  });

  it("empties the copy however its turn ends, so nothing of it reaches the next card", async () => {
    const h = harness({
      designer: () => ({
        text: fence(target.file),
        wrote: {
          [target.file]:
            '<div><script src="https://cdn.test/x.js"></script></div>',
        },
      }),
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck?.reason).toBe("no-verdict");
    // The refused file is gone and the copy is back at the card's base.
    expect(h.mockups.clear).toHaveBeenCalledWith(COPY);
    expect(h.copy.discard).toHaveBeenCalledWith(COPY, BASE, expect.any(String));
    expect(h.files).toEqual({});
    expect(cardInCopy(getCrew(PATH)!)).toBeUndefined();
    h.runner.stop();
  });

  it("starts a Builder's turn with the mock-up folder gone, so it is never stacked", async () => {
    const h = harness({ builder: () => ({ text: "Building." }) });
    onTeam();
    h.seed({ "aven-mockups/old.html": GOOD });
    updateCrew(PATH, (crew) => ({
      ...crew,
      cards: [
        queueCard(
          {
            id: "b",
            title: "Timer",
            brief: "Timer",
            from: "you",
            maxRounds: 3,
          },
          NOON,
        ),
      ],
    }));
    h.runner.start();
    await h.advance(0);
    expect(h.sent[0]?.memberId).toBe("builder");
    expect(h.mockups.clear).toHaveBeenCalledWith(COPY);
    expect(h.files["aven-mockups/old.html"]).toBeUndefined();
    h.runner.stop();
  });

  it("stops when its turn added something Git can't see, and removes it at once", async () => {
    const h = harness({
      designer: () => {
        // A new top-level folder, ignored by Git: no diff shows it, only
        // the copy's own listing does.
        h.setEntries(["src", "node_modules"]);
        return { text: fence(target.file), wrote: { [target.file]: GOOD } };
      },
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck).toMatchObject({
      reason: "checker-edited",
      text: "Brush wrote outside aven-mockups, so its mock-up wasn't kept: node_modules",
    });
    expect(h.mockups.clear).toHaveBeenCalledWith(COPY, ["node_modules"]);
    expect(h.mockups.save).not.toHaveBeenCalled();
    h.runner.stop();
  });

  it("refuses a link in its folder, which could point anywhere", async () => {
    const h = harness({
      designer: () => {
        h.links.add(target.file);
        return { text: fence(target.file), wrote: { [target.file]: "" } };
      },
    });
    onTeam();
    const idea = (await addFeatureIdea(PATH, { title: "Timer" }))!;
    target.file = `aven-mockups/${mockupFileName(idea.id)}`;
    await askDesigner(PATH, idea, NOON);
    h.runner.start();
    await h.advance(MINUTE + 5_000);
    expect(card(idea.id).stuck).toMatchObject({
      reason: "checker-edited",
      text: `Brush wrote outside aven-mockups, so its mock-up wasn't kept: ${target.file} (a link)`,
    });
    expect(h.mockups.read).not.toHaveBeenCalled();
    h.runner.stop();
  });

  it("gives a queued mock-up card to the Designer, never the Builder, and waits while it's off", async () => {
    const h = harness({ designer: () => ({ text: "" }) });
    onTeam();
    updateCrew(PATH, (crew) => ({
      ...crew,
      cards: [
        queueCard(
          {
            id: "m",
            title: "Timer",
            brief: "Timer",
            from: "you",
            kind: "mockup",
            maxRounds: 1,
          },
          NOON,
        ),
      ],
      members: crew.members.map((member) =>
        member.role === "designer" ? { ...member, paused: true } : member,
      ),
    }));
    h.runner.start();
    await h.advance(MINUTE);
    expect(h.sent).toHaveLength(0);
    expect(getCrew(PATH)!.hold?.reason).toBe("no-member");
    expect(getCrew(PATH)!.feed.at(-1)?.text).toContain("No Designer is on");
    h.runner.stop();
  });
});
