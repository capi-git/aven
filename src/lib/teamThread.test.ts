import { afterEach, describe, expect, it } from "vitest";
import {
  crewMemberName,
  newCrew,
  readCrew,
  type Crew,
  type CrewFeedEntry,
} from "./crews";
import {
  dayLabel,
  latestPosts,
  postIsMember,
  teamPosts,
  teamThread,
  type TeamPost,
  teamWording,
} from "./teamThread";

const PATH = "/Users/me/pom";
const DAY = new Date(2026, 10, 1, 9).getTime();
const MIN = 60_000;

function crewWith(
  feed: Omit<CrewFeedEntry, "id">[],
  extra: Partial<Crew> = {},
) {
  const base = newCrew(PATH, 1);
  return {
    ...base,
    on: true,
    members: [
      ...base.members,
      {
        id: "designer",
        role: "builder" as const,
        label: "Designer",
        critter: "designer",
      },
    ],
    feed: feed.map((entry, index) => ({ ...entry, id: `f${index}` })),
    ...extra,
  } satisfies Crew;
}

const nameOf = (crew: Crew) => (who: string) => crewMemberName(crew, who);

describe("the team thread", () => {
  it("reads the Feed as posts by the teammate who did each thing, with handoffs", () => {
    const crew = crewWith(
      [
        {
          at: DAY,
          kind: "start",
          who: "builder",
          member: "builder",
          cardId: "c1",
          title: "Timer screen",
          round: 1,
          text: "Builder started “Timer screen”",
        },
        {
          at: DAY + MIN,
          kind: "handoff",
          who: "builder",
          member: "builder",
          to: "checker",
          cardId: "c1",
          title: "Timer screen",
          round: 1,
          text: "TimerView, the ring and a small store. 4 files, tests pass.",
        },
        {
          at: DAY + 2 * MIN,
          kind: "verdict",
          who: "checker",
          member: "checker",
          to: "builder",
          cardId: "c1",
          title: "Timer screen",
          round: 1,
          text: "2 must-fix: the label is hard to read; the time resets",
        },
        {
          at: DAY + 3 * MIN,
          kind: "ready",
          who: "security",
          member: "security",
          cardId: "c2",
          title: "Settings page",
          round: 1,
          text: "Ready for you · passed Checker's check and the security review in round 1",
        },
      ],
      {
        cards: [
          {
            id: "c1",
            title: "Timer screen",
            brief: "x",
            from: "you",
            stage: "building",
            round: 2,
            maxRounds: 3,
            rounds: [],
            later: [],
            runs: 2,
            queuedAt: 1,
            updatedAt: 1,
            builderId: "designer",
          },
        ],
      },
    );
    const posts = teamPosts(crew, nameOf(crew));
    expect(posts.map((post) => post.kind)).toEqual([
      "post",
      "post",
      "post",
      "post",
    ]);
    const [start, handoff, verdict, ready] = posts as Extract<
      TeamPost,
      { kind: "post" }
    >[];
    // Its name is the post's, not repeated in its words.
    expect(start!.text).toBe("Started “Timer screen”");
    expect(start!.author).toMatchObject({ id: "builder", name: "Builder" });
    expect(handoff!.card).toBe("Timer screen");
    expect(handoff!.handoff).toMatchObject({
      from: { id: "builder" },
      to: { id: "checker", name: "Checker" },
      label: "Handed to Checker",
    });
    // Back to the card's own Builder, for the next round.
    expect(verdict!.handoff).toMatchObject({
      to: { id: "designer", name: "Designer", critter: "designer" },
      label: "Back to Designer · round 2",
    });
    expect(ready!.text).toBe(
      "Settings page passed the check and the security review in round 1. It's ready for you.",
    );
    expect(ready!.handoff).toMatchObject({ to: "you", label: "Ready for you" });
  });

  it("shows your messages as yours, and drops the Feed's own line for them", () => {
    const crew = crewWith(
      [
        {
          at: DAY,
          kind: "note",
          who: "you",
          cardId: "c1",
          title: "Build a timer screen",
          text: "You gave the team “Build a timer screen”",
        },
        {
          at: DAY + MIN,
          kind: "note",
          who: "you",
          text: "You paused the team",
        },
        { at: DAY + 2 * MIN, kind: "note", who: "you", text: "Use pnpm" },
        {
          at: DAY + 3 * MIN,
          kind: "hold",
          who: "aven",
          text: "Quiet hours, 11 pm–8 am. Nothing new starts.",
        },
      ],
      {
        notes: [{ id: "n1", at: DAY + 2 * MIN, text: "Use pnpm" }],
        messages: [
          {
            id: "m1",
            at: DAY,
            text: "Build a timer screen: start, pause and a ring.",
            as: "card",
            echo: "f0",
          },
          {
            id: "m2",
            at: DAY + 4 * MIN,
            text: "Can you check the ring in light mode?",
            to: "designer",
          },
        ],
      },
    );
    const posts = teamPosts(crew, nameOf(crew));
    expect(
      posts.map((post) => [post.kind, "text" in post ? post.text : ""]),
    ).toEqual([
      ["you", "Build a timer screen: start, pause and a ring."],
      ["event", "You paused the team"],
      // Your own words from before messages: yours, a standing rule.
      ["you", "Use pnpm"],
      ["event", "Quiet hours, 11 pm–8 am. Nothing new starts."],
      ["you", "Can you check the ring in light mode?"],
    ]);
    expect(posts[0]).toMatchObject({ as: "card" });
    expect(posts[2]).toMatchObject({ as: "rule" });
    expect(posts[4]).toMatchObject({ to: { id: "designer" } });
  });

  it("shows a message saved before it named its Feed line once", () => {
    const crew = crewWith(
      [
        {
          at: DAY,
          kind: "note",
          who: "you",
          cardId: "c1",
          title: "Build a timer",
          text: "You gave the team “Build a timer”",
        },
        { at: DAY, kind: "note", who: "you", text: "You resumed the team" },
      ],
      { messages: [{ id: "m1", at: DAY, text: "Build a timer", as: "card" }] },
    );
    expect(
      teamPosts(crew, nameOf(crew)).map((post) => [post.kind, post.text]),
    ).toEqual([
      ["you", "Build a timer"],
      ["event", "You resumed the team"],
    ]);
  });

  it("keeps every post to the Feed's plain words, on one line", () => {
    const crew = crewWith([
      {
        at: DAY,
        kind: "idea",
        who: "scout",
        text: 'Scout added 2 ideas:\n\n  Haptics · Keep the time {"x": 1}',
      },
    ]);
    const [post] = teamPosts(crew, nameOf(crew));
    expect(post).toMatchObject({
      kind: "post",
      text: 'Added 2 ideas: Haptics · Keep the time {"x": 1}',
    });
    expect((post as { text: string }).text).not.toContain("\n");
  });

  it("filters to one teammate: its posts, your messages to it, and Aven's about it", () => {
    const crew = crewWith(
      [
        { at: DAY, kind: "start", who: "builder", text: "Builder started “A”" },
        {
          at: DAY + MIN,
          kind: "idea",
          who: "builder",
          member: "designer",
          text: "Designer planned the next card",
        },
        {
          at: DAY + 2 * MIN,
          kind: "hold",
          who: "aven",
          member: "designer",
          text: "Designer couldn't look",
        },
      ],
      {
        messages: [{ id: "m1", at: DAY + 3 * MIN, text: "hi", to: "designer" }],
      },
    );
    const posts = teamPosts(crew, nameOf(crew));
    const mine = posts.filter((post) => postIsMember(post, "designer"));
    expect(mine.map((post) => post.id)).toEqual(["f1", "f2", "m1"]);
    expect(latestPosts(posts).get("designer")).toBe(DAY + MIN);
    const view = teamThread(posts, {
      now: DAY,
      member: "designer",
      shown: 60,
    });
    expect(view.total).toBe(3);
  });

  it("groups by day and shows only the newest posts of a long thread", () => {
    const feed = Array.from({ length: 150 }, (_, index) => ({
      at: DAY - 24 * 60 * MIN + index * 20 * MIN,
      kind: "note" as const,
      who: "aven" as const,
      text: `Line ${index}`,
    }));
    const crew = crewWith(feed);
    const posts = teamPosts(crew, nameOf(crew));
    const view = teamThread(posts, { now: DAY + 30 * 60 * MIN, shown: 60 });
    expect(view.earlier).toBe(90);
    expect(view.days.flatMap((day) => day.posts)).toHaveLength(60);
    expect(view.days.at(-1)?.label).toBe("Today");
  });
});

describe("your messages to the team in storage", () => {
  it("keep a crew from before messages as it was", () => {
    const stored = {
      ...newCrew(PATH, 1),
      on: true,
      feed: [{ id: "f", at: 1, kind: "note", who: "you", text: "go" }],
    };
    const crew = readCrew(JSON.parse(JSON.stringify(stored)))!;
    expect(crew.messages).toBeUndefined();
    expect(crew.feed).toHaveLength(1);
  });

  it("read back, the newest 50, with only what's well formed", () => {
    const messages = [
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `m${index}`,
        at: index,
        text: `Message ${index}`,
        ...(index % 2 ? { to: "builder" } : { as: "card" }),
      })),
      { id: "bad", text: "no time" },
      { id: "raw", at: 99, text: "   " },
      { id: "kind", at: 100, text: "odd", as: "shout" },
    ];
    const crew = readCrew({ ...newCrew(PATH, 1), messages })!;
    expect(crew.messages).toHaveLength(50);
    expect(crew.messages!.at(-1)).toEqual({ id: "kind", at: 100, text: "odd" });
    expect(crew.messages![0]).toEqual({
      id: "m6",
      at: 6,
      text: "Message 6",
      as: "card",
    });
  });
});

describe("what still waits on you", () => {
  const card = (stage: "stuck" | "applied") => ({
    id: "c1",
    title: "Timer",
    brief: "Timer",
    from: "you" as const,
    stage,
    round: 1,
    maxRounds: 3,
    rounds: [],
    later: [],
    runs: 1,
    queuedAt: 1,
    updatedAt: 1,
  });
  const asked = (at: number, text: string) => ({
    at,
    kind: "stuck" as const,
    who: "builder" as const,
    member: "builder",
    cardId: "c1",
    title: "Timer",
    text,
  });

  it("is a stuck card's latest question, only while the card is stuck", () => {
    const stuck = crewWith(
      [asked(DAY, "Which ring colour?"), asked(DAY + MIN, "Count down?")],
      { cards: [card("stuck")] },
    );
    expect(
      teamPosts(stuck, nameOf(stuck)).map((post) =>
        post.kind === "post" ? !!post.needsYou : null,
      ),
    ).toEqual([false, true]);
    // Answered and applied long ago: history, not a question for you.
    const done = crewWith(
      [asked(DAY, "Which ring colour?"), asked(DAY + MIN, "Count down?")],
      { cards: [card("applied")] },
    );
    expect(
      teamPosts(done, nameOf(done)).some(
        (post) => post.kind !== "you" && post.needsYou,
      ),
    ).toBe(false);
  });
});

describe("moments a Date can't show", () => {
  it("are dropped on reading, and never drawn if they get in some other way", () => {
    const stored = JSON.stringify({
      ...newCrew(PATH, 1),
      feed: [
        { id: "ok", at: DAY, kind: "note", who: "aven", text: "fine" },
        { id: "inf", at: 1, kind: "note", who: "aven", text: "x" },
      ],
      messages: [
        { id: "far", at: 1e16, text: "hi" },
        { id: "near", at: DAY, text: "hello" },
      ],
    }).replace('"at":1,"kind"', '"at":1e999,"kind"');
    const crew = readCrew(JSON.parse(stored))!;
    expect(crew.feed.map((entry) => entry.id)).toEqual(["ok"]);
    expect(crew.messages?.map((message) => message.id)).toEqual(["near"]);
    const raw = crewWith([{ at: 1e16, kind: "note", who: "aven", text: "x" }]);
    expect(teamPosts(raw, nameOf(raw))).toEqual([]);
    expect(dayLabel(Infinity, DAY)).toBe("");
  });
});

describe("Yesterday", () => {
  const zone = process.env.TZ;
  afterEach(() => {
    process.env.TZ = zone;
  });

  it("is the calendar day before, even across a clock change", () => {
    process.env.TZ = "America/New_York";
    // The clocks went forward on Sun 8 Mar 2026: Monday at 00:30 is only
    // 23½ hours after Sunday began.
    const now = new Date(2026, 2, 9, 0, 30).getTime();
    expect(dayLabel(new Date(2026, 2, 8, 0, 15).getTime(), now)).toBe(
      "Yesterday",
    );
    expect(dayLabel(new Date(2026, 2, 8, 15, 0).getTime(), now)).toBe(
      "Yesterday",
    );
    expect(dayLabel(new Date(2026, 2, 7, 23, 45).getTime(), now)).not.toBe(
      "Yesterday",
    );
    // And back on Sun 1 Nov 2026: Saturday is Yesterday all of Sunday.
    expect(
      dayLabel(
        new Date(2026, 9, 31, 0, 10).getTime(),
        new Date(2026, 10, 1, 23, 30).getTime(),
      ),
    ).toBe("Yesterday");
  });
});

describe("lines saved before the crew was a team", () => {
  it("say team, leaving quoted titles and branch names alone", () => {
    expect(teamWording("You gave the crew “Crew screen”")).toBe(
      "You gave the team “Crew screen”",
    );
    expect(teamWording("You paused the crew")).toBe("You paused the team");
    expect(teamWording("Crews pause at 80% of the crew's week")).toBe(
      "Teams pause at 80% of the team's week",
    );
    expect(teamWording("On aven/bot/crew-0f26, the crew-wide cap")).toBe(
      "On aven/bot/crew-0f26, the crew-wide cap",
    );
  });
});
