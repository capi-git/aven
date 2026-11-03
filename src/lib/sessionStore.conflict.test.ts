import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "./session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const user: Block = { id: "u1", role: "user", text: "Question" };
const answer: Block = { id: "a1", role: "assistant", text: "Answer" };
const otherWindowsTurn: Block = {
  id: "u2",
  role: "user",
  text: "Asked in the other window",
};
const otherWindowsAnswer: Block = {
  id: "a2",
  role: "assistant",
  text: "Answered there",
};
function session(blocks: Block[]): Session {
  return {
    id: "shared",
    cwd: "/fixture",
    harness: "codex",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    title: "Chat",
    blocks,
    busy: false,
  };
}
const summary = (transcriptRevision: string) => ({
  id: "shared",
  cwd: "/fixture",
  harness: "codex",
  model: "test",
  runtimeMode: "supervised",
  title: "Chat",
  createdAt: 1,
  updatedAt: 2,
  transcriptRevision,
});
const record = (blocks: Block[]) => ({ ...summary("stored"), blocks });
async function store() {
  vi.resetModules();
  return import("./sessionStore");
}
const upserts = () =>
  mocks.invoke.mock.calls
    .filter(([command]) => command === "session_upsert")
    .map(([, args]) => (args as { session: Record<string, unknown> }).session);
afterEach(() => mocks.invoke.mockReset());

describe("a chat open in two windows", () => {
  it("keeps the other window's turns when a save finds the transcript changed", async () => {
    const { upsertSession, mergeTranscripts } = await store();
    const stored = [user, answer, otherWindowsTurn, otherWindowsAnswer];
    const mine: Block = { id: "a3", role: "assistant", text: "Mine" };
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_get") return record(stored);
      const { session } = args as {
        session: { blocksDelta?: unknown; blocks?: Block[] };
      };
      if (session.blocksDelta) throw new Error("TRANSCRIPT_REVISION_MISMATCH");
      return summary(session.blocks?.length === 5 ? "merged" : "mine");
    });
    // This window's first save is the full chat; the other window writes
    // two turns after it; this window's next save is a delta.
    await upsertSession(session([user, answer]));
    await upsertSession(session([user, answer, mine]));
    const [first, , merged] = upserts();
    expect(first.blocks).toEqual([user, answer]);
    expect(merged.blocksDelta).toBeUndefined();
    expect(merged.blocks).toEqual([
      user,
      answer,
      otherWindowsTurn,
      otherWindowsAnswer,
      mine,
    ]);
    // Until this window has those turns, each save merges again rather
    // than sending a delta or the whole chat over them.
    const edited: Block = { ...mine, text: "Mine, finished" };
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_get") return record([...stored, mine]);
      const { session } = args as { session: { blocks?: Block[] } };
      return summary(session.blocks?.length === 5 ? "merged" : "mine");
    });
    await upsertSession(session([user, answer, edited]));
    const again = upserts().at(-1)!;
    expect(again.blocksDelta).toBeUndefined();
    expect(again.blocks).toEqual([
      user,
      answer,
      otherWindowsTurn,
      otherWindowsAnswer,
      edited,
    ]);
    expect(mergeTranscripts([user, answer], [user, answer])).toEqual([
      user,
      answer,
    ]);
  });

  it("goes back to deltas once this window holds everything the store has", async () => {
    const { upsertSession } = await store();
    const a9: Block = { ...answer, id: "a9" };
    let stored: Block[] = [user, answer, otherWindowsTurn];
    let mismatch = true;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "session_get") return record(stored);
      const { session } = args as {
        session: { blocksDelta?: unknown; blocks?: Block[] };
      };
      if (session.blocksDelta && mismatch)
        throw new Error("TRANSCRIPT_REVISION_MISMATCH");
      return summary(session.blocksDelta ? "delta" : "full");
    });
    await upsertSession(session([user, answer]));
    await upsertSession(session([user, answer, a9]));
    expect(upserts().at(-1)!.blocks).toHaveLength(4);
    // This window now shows the other's turn too: one plain save of what
    // it has, then deltas against that save.
    stored = [user, answer, otherWindowsTurn, a9];
    mismatch = false;
    const caughtUp = [user, answer, otherWindowsTurn, a9];
    await upsertSession(session(caughtUp));
    expect(upserts().at(-1)!.blocksDelta).toBeUndefined();
    expect(upserts().at(-1)!.blocks).toEqual(caughtUp);
    const a10: Block = { id: "a10", role: "assistant", text: "" };
    await upsertSession(session([...caughtUp, a10]));
    expect(upserts().at(-1)!.blocksDelta).toMatchObject({
      baseRevision: "full",
      blockCount: 5,
    });
  });
});
