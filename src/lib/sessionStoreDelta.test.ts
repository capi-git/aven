import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block, Session } from "./session";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const user: Block = { id: "u", role: "user", text: "Question" };
const answer: Block = { id: "a", role: "assistant", text: "Answer" };
function session(blocks: Block[] = [user, answer]): Session {
  return {
    id: "delta",
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
const summary = (transcriptRevision?: string) => ({
  id: "delta",
  cwd: "/fixture",
  harness: "codex",
  model: "test",
  runtimeMode: "supervised",
  title: "Chat",
  createdAt: 1,
  updatedAt: 2,
  ...(transcriptRevision ? { transcriptRevision } : {}),
});
async function store() {
  vi.resetModules();
  return import("./sessionStore");
}
afterEach(() => mocks.invoke.mockReset());

describe("piecewise session persistence", () => {
  it("sends only a changed block and metadata after an acknowledged full snapshot", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockResolvedValueOnce(summary("two"))
      .mockResolvedValueOnce(summary("two"));
    const { upsertSession } = await store();
    const history = Array.from({ length: 1200 }, (_, index): Block => ({
      id: String(index),
      role: index ? "assistant" : "user",
      text: "x".repeat(4096),
    }));
    const initial = session(history);
    await upsertSession(initial);
    const changed = { ...history[1199], text: "completed" };
    const next = { ...initial, blocks: [...history.slice(0, -1), changed] };
    await upsertSession(next);
    await upsertSession({ ...next, title: "Renamed" });
    const full = mocks.invoke.mock.calls[0][1].session;
    const delta = mocks.invoke.mock.calls[1][1].session;
    expect(delta.blocks).toBeUndefined();
    expect(delta.blocksDelta).toEqual({
      baseRevision: "one",
      blockCount: 1200,
      updates: [{ index: 1199, block: changed }],
    });
    expect(JSON.stringify(delta).length * 1000).toBeLessThan(
      JSON.stringify(full).length,
    );
    expect(mocks.invoke.mock.calls[2][1].session).toMatchObject({
      title: "Renamed",
      blocksDelta: { baseRevision: "two", updates: [] },
    });
  });

  it("tracks sanitized positions when a live approval becomes persistable", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockResolvedValueOnce(summary("two"));
    const { upsertSession } = await store();
    const approval: Block = {
      id: "approval",
      role: "approval",
      text: "Allow",
      approval: { requestId: 7 },
    };
    await upsertSession(session([user, approval, answer]));
    const decided = {
      ...approval,
      approval: { ...approval.approval!, decided: "allow" as const },
    };
    await upsertSession(session([user, decided, answer]));
    expect(
      mocks.invoke.mock.calls[0][1].session.blocks.map(
        (block: Block) => block.id,
      ),
    ).toEqual(["u", "a"]);
    expect(mocks.invoke.mock.calls[1][1].session.blocksDelta).toMatchObject({
      blockCount: 3,
      updates: [
        { index: 1, block: { id: "approval" } },
        { index: 2, block: { id: "a" } },
      ],
    });
  });

  it("explicitly truncates removed blocks without retransmitting the prefix", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockResolvedValueOnce(summary("two"));
    const { upsertSession } = await store();
    await upsertSession(session());
    await upsertSession(session([user]));
    expect(mocks.invoke.mock.calls[1][1].session.blocksDelta).toEqual({
      baseRevision: "one",
      blockCount: 1,
      updates: [],
    });
  });

  it("retries a revision conflict once with the complete current snapshot", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockRejectedValueOnce("TRANSCRIPT_REVISION_MISMATCH")
      .mockResolvedValueOnce(summary("recovered"))
      .mockResolvedValueOnce(summary("recovered"));
    const { upsertSession } = await store();
    await upsertSession(session());
    const changed = session([user, { ...answer, text: "new answer" }]);
    await upsertSession(changed);
    await upsertSession({ ...changed, title: "Renamed" });
    expect(mocks.invoke.mock.calls[1][1].session.blocksDelta.baseRevision).toBe(
      "one",
    );
    expect(
      mocks.invoke.mock.calls[2][1].session.blocks.map(
        (block: Block) => block.text,
      ),
    ).toEqual(["Question", "new answer"]);
    expect(mocks.invoke.mock.calls[2][1].session.blocksDelta).toBeUndefined();
    expect(mocks.invoke.mock.calls[3][1].session.blocksDelta.baseRevision).toBe(
      "recovered",
    );
  });

  it("does not retry an unrelated failure and reestablishes its base on the next attempt", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(summary("three"));
    const { upsertSession } = await store();
    await upsertSession(session());
    const changed = session([user, { ...answer, text: "new" }]);
    await expect(upsertSession(changed)).rejects.toThrow("disk full");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    await upsertSession(changed);
    expect(mocks.invoke.mock.calls[2][1].session.blocks).toHaveLength(2);
  });

  it("chooses each queued delta base only after the preceding native acknowledgement", async () => {
    let resolve!: (value: ReturnType<typeof summary>) => void;
    mocks.invoke
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(summary("two"))
      .mockResolvedValueOnce(summary("three"));
    const { upsertSession } = await store();
    const one = upsertSession(session());
    const two = upsertSession(session([user, { ...answer, text: "two" }]));
    const three = upsertSession(session([user, { ...answer, text: "three" }]));
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    resolve(summary("one"));
    await Promise.all([one, two, three]);
    expect(
      mocks.invoke.mock.calls
        .slice(1)
        .map(([, args]) => args.session.blocksDelta.baseRevision),
    ).toEqual(["one", "two"]);
    expect(
      mocks.invoke.mock.calls
        .slice(1)
        .map(([, args]) => args.session.blocksDelta.updates[0].block.text),
    ).toEqual(["two", "three"]);
  });

  it("retains the full-snapshot contract when the native response has no revision", async () => {
    mocks.invoke.mockResolvedValue(summary());
    const { upsertSession } = await store();
    await upsertSession(session());
    await upsertSession({ ...session(), title: "metadata" });
    expect(
      mocks.invoke.mock.calls.every(
        ([, args]) =>
          Array.isArray(args.session.blocks) &&
          args.session.blocksDelta === undefined,
      ),
    ).toBe(true);
  });

  it("clears worker delta bases when deleting their lead", async () => {
    mocks.invoke
      .mockResolvedValueOnce(summary("one"))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(summary("two"));
    const { upsertSession, deleteSession } = await store();
    const worker = { ...session(), orchestrationLeadId: "lead" };
    await upsertSession(worker);
    await deleteSession("lead");
    await upsertSession(worker);
    const final = mocks.invoke.mock.calls[2][1].session;
    expect(final.blocksDelta).toBeUndefined();
    expect(final.blocks[0].orchestrationLeadId).toBeUndefined();
  });
});
