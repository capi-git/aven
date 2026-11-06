import { describe, expect, it } from "vitest";
import {
  avosInboxLine,
  avosNeeds,
  avosNeedsCount,
  avosNotificationId,
  avosNotificationPath,
  avosOwnsRun,
  giveChatToAvosText,
} from "./avos";
import { newCrew, type Crew, type CrewCard } from "./crews";
import type { ScheduledAgent, ScheduledRun } from "./scheduledAgents";

const SITE = "/Users/me/aven-site";
const NOTES = "/Users/me/notes app";
const NOON = new Date(2026, 10, 5, 12).getTime();

function card(
  id: string,
  stage: CrewCard["stage"],
  updatedAt = NOON,
): CrewCard {
  return {
    id,
    title: id,
    brief: id,
    stage,
    from: "you",
    round: 0,
    maxRounds: 3,
    rounds: [],
    at: NOON,
    updatedAt,
  } as unknown as CrewCard;
}

const met = (path: string, patch: Partial<Crew> = {}): Crew => ({
  ...newCrew(path, NOON),
  members: [{ id: "lead", role: "lead" }],
  on: true,
  onAt: NOON,
  ...patch,
});

const job = {
  id: "avos-1",
  name: "Articles",
  enabled: true,
  owner: { avos: SITE },
  createdAt: NOON,
} as ScheduledAgent;
const plain = { id: "plain", createdAt: NOON } as ScheduledAgent;
const run = (scheduleId: string, patch: Partial<ScheduledRun> = {}) =>
  ({
    id: `run-${scheduleId}`,
    scheduleId,
    startedAt: NOON,
    status: "completed",
    review: {
      status: "open",
      kind: "publish",
      title: "2 new articles",
      postedAt: NOON + 5,
    },
    ...patch,
  }) as unknown as ScheduledRun;

describe("what each Avos needs you for", () => {
  it("lists This week's Needs you per project, with when each began", () => {
    const site = met(SITE, {
      cards: [
        card("Cover image", "stuck", NOON + 1),
        card("Pricing", "ready", NOON + 2),
        card("Footer", "ready", NOON + 3),
      ],
    });
    const notes = met(NOTES);
    const needs = avosNeeds([site, notes, undefined], {
      jobs: { agents: [job], runs: [run("avos-1")] },
      now: NOON,
    });
    // A quiet Avos, or a project without one, isn't listed.
    expect(needs.map((entry) => entry.path)).toEqual([SITE]);
    expect(needs[0]!.rows.map((row) => [row.id, row.text, row.at])).toEqual([
      ["stuck:Cover image", "“Cover image” needs your answer", NOON + 1],
      ["ready", "Look at 2 finished cards", NOON + 3],
      ["run:run-avos-1", "Ready to publish: 2 new articles", NOON + 5],
    ]);
    // The Dock counts each thing once: two cards on one row, a job's run.
    expect(needs[0]!.rows[1]!.count).toBe(2);
    expect(avosNeedsCount(needs)).toBe(4);
  });

  it("leaves out an Avos you haven't met", () => {
    const unmet: Crew = {
      ...newCrew(SITE, NOON),
      cards: [card("a", "stuck")],
    };
    expect(avosNeeds([unmet], { now: NOON })).toEqual([]);
  });
});

describe("whose run it is", () => {
  it("is Avos's when its job is, and that Avos is there", () => {
    const crews: Record<string, Crew> = { [SITE]: met(SITE) };
    const crewFor = (path: string) => crews[path];
    expect(avosOwnsRun(run("avos-1"), [job, plain], crewFor)).toBe(true);
    // An ordinary automation stays in the Inbox.
    expect(avosOwnsRun(run("plain"), [job, plain], crewFor)).toBe(false);
    // A job whose Avos is gone is an ordinary automation again.
    expect(avosOwnsRun(run("avos-1"), [job, plain], () => undefined)).toBe(
      false,
    );
  });
});

describe("pointing at Avos", () => {
  it("names a project's Avos in a notification's id, slashes and all", () => {
    const id = avosNotificationId(NOTES);
    // The notification's own id is cut at the first "/".
    expect(id).not.toContain("/");
    expect(avosNotificationPath(id)).toBe(NOTES);
    expect(avosNotificationPath("chat-123")).toBeNull();
    expect(avosNotificationPath("avos:")).toBeNull();
  });

  it("says how many things wait in Avos, in the Inbox", () => {
    expect(avosInboxLine(1)).toBe("1 thing in Avos needs you");
    expect(avosInboxLine(3)).toBe("3 things in Avos need you");
  });

  it("gives Avos a chat with the last thing you asked in it", () => {
    expect(giveChatToAvosText("Fix sign-in", "  Make the\nbutton work ")).toBe(
      "Please take this chat over: “Fix sign-in”.\n\nThe last thing I asked in it: Make the button work",
    );
    expect(giveChatToAvosText("")).toBe(
      "Please take this chat over: “Untitled”.",
    );
    const long = giveChatToAvosText("Big", "x".repeat(3_000));
    expect(long.length).toBeLessThan(2_000);
    expect(long.endsWith("…")).toBe(true);
  });
});
