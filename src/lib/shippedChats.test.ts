// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHistory } from "./fs";
import { newSession, type Session } from "./session";
import {
  recordShip,
  shipEvents,
  shippedChatsSnapshot,
  shipNoteText,
  shipTargets,
  forgetShippedChat,
} from "./shippedChats";
import { pendingTurnNotes, takeTurnNotes } from "./turnNotes";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const head = async (): Promise<GitHistory> => ({
  head: "4c19b02aa",
  commits: [
    {
      sha: "4c19b02aa",
      shortSha: "4c19b02",
      parents: [],
      author: "",
      timestamp: 1,
      subject: "Clean the output folder",
      refs: [],
      head: true,
    },
  ],
});

const chat = (id: string, cwd = "/repo", turnAt = 1): Session => ({
  ...newSession("codex", cwd),
  id,
  title: `codex · ${id}`,
  blocks: [{ id: `u-${id}`, role: "user", text: "Go", startedAt: turnAt }],
});

const review = (sessionId: string, cwd = "/repo") => ({ sessionId, cwd });

describe("shipTargets", () => {
  it("credits the chat Ship it was pressed in", () => {
    expect(
      shipTargets({
        requestedId: "a",
        cwd: "/repo",
        reviews: { b: review("b") },
        latestId: "c",
      }),
    ).toEqual(["a"]);
  });

  it("otherwise credits every chat whose changes waited in that folder", () => {
    expect(
      shipTargets({
        cwd: "/repo",
        reviews: {
          b: review("b"),
          c: review("c", "/repo/packages/web"),
          d: review("d", "/elsewhere"),
        },
        latestId: "x",
      }),
    ).toEqual(["b", "c"]);
  });

  it("falls back to the chat that worked there last", () => {
    expect(shipTargets({ cwd: "/repo", reviews: {}, latestId: "x" })).toEqual([
      "x",
    ]);
    expect(shipTargets({ cwd: "/repo", reviews: {} })).toEqual([]);
  });
});

describe("the ship note", () => {
  const commit = {
    sha: "4c19b02aa",
    shortSha: "4c19b02",
    subject: "Clean the output folder",
  };

  it("names the commit, the push and the pull request as the user's", () => {
    expect(
      shipNoteText(
        {
          committed: true,
          pushed: true,
          pr: { number: 42, url: "u", created: true },
        },
        commit,
      ),
    ).toBe(
      "The user shipped this chat's changes with Aven's Ship it: commit 4c19b02 “Clean the output folder”, pushed and opened pull request #42. That commit is theirs, made through Aven; don't commit those changes again.",
    );
    expect(
      shipNoteText({ committed: true, pushed: false, pr: null }, undefined),
    ).toBe(
      "The user shipped this chat's changes with Aven's Ship it: a new commit. That commit is theirs, made through Aven; don't commit those changes again.",
    );
    expect(
      shipNoteText({
        committed: false,
        pushed: true,
        pr: { number: 7, url: "u", created: false },
      }),
    ).toBe(
      "The user shipped this chat's changes with Aven's Ship it: this branch's commits pushed and updated pull request #7. That push was theirs, made through Aven; don't commit those changes again.",
    );
    expect(
      shipNoteText({ committed: false, pushed: false, pr: null }),
    ).toBeNull();
  });

  it("waits for the shipped chat's next message, and only that chat's", async () => {
    await recordShip({
      cwd: "/repo",
      requestedId: "a",
      result: { committed: true, pushed: false, pr: null },
      sessions: [chat("a"), chat("b")],
      reviews: {},
      head,
      now: 800,
    });
    expect(pendingTurnNotes("b")).toEqual([]);
    expect(takeTurnNotes("a", "What changed?").text).toContain(
      "commit 4c19b02 “Clean the output folder”",
    );
    expect(pendingTurnNotes("a")).toEqual([]);
  });
});

describe("recordShip", () => {
  it("records the commit and pull request for the chat, durably", async () => {
    const records = await recordShip({
      cwd: "/repo",
      requestedId: "a",
      result: {
        committed: true,
        pushed: true,
        pr: {
          number: 42,
          url: "https://github.com/o/r/pull/42",
          created: true,
        },
      },
      sessions: [chat("a")],
      reviews: {},
      head,
      now: 500,
    });
    expect(records).toHaveLength(1);
    expect(shippedChatsSnapshot().a).toEqual({
      sessionId: "a",
      project: "/repo",
      cwd: "/repo",
      at: 500,
      commit: {
        sha: "4c19b02aa",
        shortSha: "4c19b02",
        subject: "Clean the output folder",
      },
      pr: { number: 42, url: "https://github.com/o/r/pull/42" },
      pushed: true,
      title: "a",
      harness: "codex",
    });

    // A restart reads it back from storage.
    vi.resetModules();
    const fresh = await import("./shippedChats");
    expect(fresh.shippedChatsSnapshot().a?.commit?.shortSha).toBe("4c19b02");
    expect(fresh.shippedChatsSnapshot().a?.pr?.number).toBe(42);
  });

  it("names the chats from their review records when they are not loaded", async () => {
    await recordShip({
      cwd: "/repo",
      result: { committed: true, pushed: false, pr: null },
      sessions: [],
      reviews: {
        b: {
          sessionId: "b",
          project: "/repo",
          cwd: "/repo",
          at: 1,
          files: 1,
          additions: 1,
          deletions: 0,
          names: ["a.ts"],
          title: "Docs for Race",
          harness: "claude",
        },
      },
      head,
      now: 600,
    });
    expect(shippedChatsSnapshot().b).toMatchObject({
      title: "Docs for Race",
      harness: "claude",
      commit: { shortSha: "4c19b02" },
    });
    expect(shippedChatsSnapshot().b?.pushed).toBeUndefined();
  });

  it("records nothing when nothing went out, and keeps a ship whose commit could not be read", async () => {
    expect(
      await recordShip({
        cwd: "/repo",
        requestedId: "a",
        result: { committed: false, pushed: false, pr: null },
        sessions: [chat("a")],
        reviews: {},
        head,
      }),
    ).toEqual([]);
    expect(shippedChatsSnapshot()).toEqual({});

    await recordShip({
      cwd: "/repo",
      requestedId: "a",
      result: { committed: true, pushed: false, pr: null },
      sessions: [chat("a")],
      reviews: {},
      head: async () => {
        throw new Error("no git");
      },
      now: 700,
    });
    expect(shippedChatsSnapshot().a).toMatchObject({ at: 700 });
    expect(shippedChatsSnapshot().a?.commit).toBeUndefined();
    forgetShippedChat("a");
    expect(shippedChatsSnapshot().a).toBeUndefined();
  });

  it("keeps a chat's earlier ships when it ships again, and reads them back", async () => {
    const ship = (now: number, committed = true) =>
      recordShip({
        cwd: "/repo",
        requestedId: "a",
        result: { committed, pushed: !committed, pr: null },
        sessions: [chat("a")],
        reviews: {},
        head,
        now,
      });
    await ship(1_000);
    await ship(2_000, false);
    await ship(2_000, false);
    const kept = shippedChatsSnapshot().a!;
    expect(kept).toMatchObject({ at: 2_000, pushed: true });
    expect(kept.commit).toBeUndefined();
    expect(kept.earlier).toEqual([
      {
        at: 1_000,
        commit: {
          sha: "4c19b02aa",
          shortSha: "4c19b02",
          subject: "Clean the output folder",
        },
      },
    ]);
    expect(shipEvents(kept).map((event) => event.at)).toEqual([2_000, 1_000]);
    // Another window, or a restart, reads the same history.
    const saved = values.get("aven.shippedChats.v1")!;
    vi.unstubAllGlobals();
    values = new Map([["aven.shippedChats.v1", saved]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    expect(shippedChatsSnapshot().a?.earlier).toEqual(kept.earlier);
  });

  it("keeps each chat's latest ship and only the newest records", async () => {
    for (let index = 0; index < 205; index += 1)
      await recordShip({
        cwd: "/repo",
        requestedId: `chat-${index}`,
        result: { committed: false, pushed: true, pr: null },
        sessions: [],
        reviews: {},
        head,
        now: 1_000 + index,
      });
    const kept = shippedChatsSnapshot();
    expect(Object.keys(kept)).toHaveLength(200);
    expect(kept["chat-0"]).toBeUndefined();
    expect(kept["chat-204"]).toMatchObject({ pushed: true, at: 1_204 });
  });
});
