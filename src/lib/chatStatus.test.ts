import { describe, expect, it } from "vitest";
import {
  CHAT_STATUS_LABEL,
  chatStage,
  chatStatuses,
  chatStatusWord,
} from "./chatStatus";
import type { TeamMember, TeamRun, TeamStatus } from "./teamRuns";

const member = (sessionId: string, role: TeamMember["role"] = "lane") =>
  ({
    sessionId,
    harness: "claude",
    model: "m",
    label: sessionId,
    role,
    state: "working",
    stateLabel: "Working",
  }) satisfies TeamMember;

const team = (
  kind: TeamRun["kind"],
  status: TeamStatus,
  origin: string,
  members: string[],
  startedAt = 1,
): TeamRun => ({
  id: `${kind}:${origin}`,
  kind,
  key: origin,
  origin: { sessionId: origin },
  project: "/work/site",
  title: "Team",
  status,
  progress: "",
  members: members.map((id) => member(id)),
  startedAt,
  updatedAt: startedAt,
});

const none = {
  working: new Set<string>(),
  needsYou: new Set<string>(),
  teams: [] as TeamRun[],
  reviews: {},
  shipped: {},
};

describe("chatStatusWord", () => {
  it("gives each word from what happened", () => {
    expect(chatStatusWord({ needsYou: true })).toBe("needs-you");
    expect(chatStatusWord({ working: true })).toBe("working");
    expect(chatStatusWord({ team: "race" })).toBe("racing");
    expect(chatStatusWord({ team: "discuss" })).toBe("discussing");
    expect(chatStatusWord({ team: "orchestrate" })).toBe("orchestrating");
    expect(chatStatusWord({ reviewAt: 5 })).toBe("review");
    expect(chatStatusWord({ teamReady: true })).toBe("review");
    expect(chatStatusWord({ shippedAt: 5 })).toBe("shipped");
    // An idle chat with nothing pending shows no word.
    expect(chatStatusWord({})).toBeNull();
  });

  it("puts Needs you first, then work, then review, then shipped", () => {
    expect(
      chatStatusWord({
        needsYou: true,
        working: true,
        team: "race",
        reviewAt: 3,
        shippedAt: 4,
      }),
    ).toBe("needs-you");
    // A team's own word wins over plain Working.
    expect(chatStatusWord({ working: true, team: "orchestrate" })).toBe(
      "orchestrating",
    );
    expect(chatStatusWord({ working: true, reviewAt: 3 })).toBe("working");
    expect(chatStatusWord({ reviewAt: 3, teamReady: true })).toBe("review");
  });

  it("reads Review for changes newer than the last ship, else Shipped", () => {
    expect(chatStatusWord({ reviewAt: 10, shippedAt: 5 })).toBe("review");
    expect(chatStatusWord({ reviewAt: 5, shippedAt: 10 })).toBe("shipped");
    // The same changes, read again after the ship, keep their time.
    expect(chatStatusWord({ reviewAt: 10, shippedAt: 10 })).toBe("shipped");
  });

  it("names each word plainly and sorts it into a board column", () => {
    expect(CHAT_STATUS_LABEL["needs-you"]).toBe("Needs you");
    expect(CHAT_STATUS_LABEL.racing).toBe("Racing");
    expect(chatStage("racing")).toBe("working");
    expect(chatStage("discussing")).toBe("working");
    expect(chatStage("orchestrating")).toBe("working");
    expect(chatStage("working")).toBe("working");
    expect(chatStage("review")).toBe("review");
    expect(chatStage("shipped")).toBe("shipped");
    expect(chatStage("needs-you")).toBe("needs-you");
  });
});

describe("chatStatuses", () => {
  it("words only chats that have something to say", () => {
    expect(
      chatStatuses({
        ...none,
        working: new Set(["a"]),
        needsYou: new Set(["b"]),
        reviews: { c: { at: 5 } },
        shipped: { d: { at: 5 } },
      }),
    ).toEqual({ a: "working", b: "needs-you", c: "review", d: "shipped" });
  });

  it("gives a running team's word to the chat it started from and to every member", () => {
    const words = chatStatuses({
      ...none,
      working: new Set(["l1"]),
      teams: [
        team("race", "running", "origin", ["l1", "l2"]),
        team("discuss", "running", "a", ["a", "b"]),
        team("orchestrate", "running", "lead", ["lead", "w1"]),
      ],
    });
    expect(words).toEqual({
      origin: "racing",
      l1: "racing",
      l2: "racing",
      a: "discussing",
      b: "discussing",
      lead: "orchestrating",
      w1: "orchestrating",
    });
  });

  it("keeps Needs you for the chat a team waits on, and the team's word for chats still at work", () => {
    const words = chatStatuses({
      ...none,
      working: new Set(["b"]),
      needsYou: new Set(["a"]),
      teams: [team("discuss", "needs-you", "a", ["a", "b"])],
    });
    expect(words).toEqual({ a: "needs-you", b: "discussing" });
  });

  it("reads Review for a race ready to compare, and nothing once a team is over", () => {
    expect(
      chatStatuses({
        ...none,
        teams: [
          team("race", "ready", "origin", ["l1", "l2"]),
          team("discuss", "finished", "x", ["x", "y"]),
          team("orchestrate", "stopped", "lead", ["lead", "w"]),
        ],
      }),
    ).toEqual({ origin: "review", l1: "review", l2: "review" });
  });

  it("lets a newer ship win over the same review, and new changes win over the ship", () => {
    expect(
      chatStatuses({
        ...none,
        reviews: { a: { at: 10 }, b: { at: 20 } },
        shipped: { a: { at: 15 }, b: { at: 15 } },
      }),
    ).toEqual({ a: "shipped", b: "review" });
  });
});
