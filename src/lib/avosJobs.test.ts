import { describe, expect, it } from "vitest";
import {
  avosJobHeld,
  avosJobId,
  avosJobMode,
  ownedBy,
  ownerAfterEdit,
} from "./avosJobs";
import type { ScheduledAgent } from "./scheduledAgents";

const PATH = "/Users/me/site";

const agent = (patch: Partial<ScheduledAgent> = {}): ScheduledAgent => ({
  id: "avos-1",
  name: "Notion articles",
  prompt: "Draft new articles",
  project: PATH,
  harness: "claude",
  model: "claude:test",
  runtimeMode: "auto",
  schedule: { kind: "interval", hours: 6 },
  enabled: true,
  createdAt: 0,
  nextRunAt: null,
  owner: { avos: PATH },
  ...patch,
});

describe("a team's job", () => {
  it("waits while its team is paused or off", () => {
    const team = (crew: { on: boolean; paused?: boolean } | undefined) => () =>
      crew;
    expect(avosJobHeld(agent(), team({ on: true }))).toBe(false);
    expect(avosJobHeld(agent(), team({ on: true, paused: true }))).toBe(true);
    expect(avosJobHeld(agent(), team({ on: false }))).toBe(true);
  });

  it("runs as an ordinary automation once its team is gone, or with none", () => {
    expect(avosJobHeld(agent(), () => undefined)).toBe(false);
    expect(
      avosJobHeld(agent({ owner: undefined }), () => ({
        on: false,
        paused: true,
      })),
    ).toBe(false);
  });

  it("does no more than the team's Access, and never more than Auto", () => {
    expect(avosJobMode({})).toBe("auto");
    expect(
      avosJobMode({
        access: { deletes: true, web: "everyone", others: "allow" },
      }),
    ).toBe("auto");
    expect(avosJobMode({ access: { others: "ask" } })).toBe("supervised");
  });

  it("belongs to its team by folder, and gets one id per job", () => {
    expect(ownedBy(agent(), `${PATH}/`)).toBe(true);
    expect(ownedBy(agent(), "/Users/me/other")).toBe(false);
    const draft = { name: "Notion articles", prompt: "Draft new articles" };
    expect(avosJobId(PATH, draft)).toBe(avosJobId(PATH, draft));
    expect(avosJobId(PATH, draft)).not.toBe(
      avosJobId("/Users/me/other", draft),
    );
  });

  it("stays the team's when edited, until it moves to another project", () => {
    expect(ownerAfterEdit(agent(), PATH)).toEqual({ owner: { avos: PATH } });
    expect(ownerAfterEdit(agent(), "/Users/me/other")).toEqual({});
    expect(ownerAfterEdit(agent({ owner: undefined }), PATH)).toEqual({});
    expect(ownerAfterEdit(undefined, PATH)).toEqual({});
  });
});
