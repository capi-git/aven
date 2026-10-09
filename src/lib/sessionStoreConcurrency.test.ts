import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadStore() {
  vi.resetModules();
  return import("./sessionStore");
}

function session(id: string) {
  return {
    id,
    cwd: "/tmp/project",
    harness: "cursor" as const,
    model: "",
    modelSettings: {},
    runtimeMode: "supervised" as const,
    title: "",
    blocks: [{ id: "user", role: "user" as const, text: "hello" }],
    busy: true,
  };
}

afterEach(() => {
  mocks.invoke.mockReset();
});

describe("session persistence concurrency", () => {
  it("combines identical pending snapshots but does not cache settled writes", async () => {
    const write = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(undefined);
    const { upsertSession } = await loadStore();
    const snapshot = session("same");
    const first = upsertSession(snapshot);
    const second = upsertSession({ ...snapshot, busy: false });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    write.resolve(undefined);
    await Promise.all([first, second]);
    await upsertSession(snapshot);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("preserves A-B-A ordering when a changed snapshot intervenes", async () => {
    const write = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(undefined);
    const { upsertSession } = await loadStore();
    const snapshot = session("ordered");
    const first = upsertSession(snapshot);
    const changed = upsertSession({ ...snapshot, title: "renamed" });
    const last = upsertSession(snapshot);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    write.resolve(undefined);
    await Promise.all([first, changed, last]);
    expect(
      mocks.invoke.mock.calls.map(([, args]) => args.session.title),
    ).toEqual(["", "renamed", ""]);
  });

  it("shares a pending failure and allows the same snapshot to retry", async () => {
    const write = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(undefined);
    const { upsertSession } = await loadStore();
    const snapshot = session("retry");
    const failures = Promise.allSettled([
      upsertSession(snapshot),
      upsertSession(snapshot),
    ]);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    write.reject(new Error("disk unavailable"));
    expect((await failures).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    await upsertSession(snapshot);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("does not combine identical snapshots across an archive operation", async () => {
    const write = deferred<unknown>();
    mocks.invoke
      .mockReturnValueOnce(write.promise)
      .mockResolvedValue(undefined);
    const { upsertSession, setSessionArchived } = await loadStore();
    const snapshot = session("barrier");
    const first = upsertSession(snapshot);
    const archive = setSessionArchived(snapshot.id, true);
    const last = upsertSession(snapshot);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    write.resolve(undefined);
    await Promise.all([first, archive, last]);
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual([
      "session_upsert",
      "session_set_archived",
      "session_upsert",
    ]);
  });

  it("uses the complete project inventory instead of filtered sidebar history", async () => {
    mocks.invoke.mockResolvedValue(["lead", "hidden-worker", "empty-chat"]);
    const { listProjectSessionIds } = await loadStore();
    await expect(listProjectSessionIds("/tmp/project/")).resolves.toEqual([
      "lead",
      "hidden-worker",
      "empty-chat",
    ]);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
      "session_list_project_ids",
      {
        cwd: "/tmp/project",
      },
    );
  });

  it("drains worker writes before deleting a lead and strips ownership from later snapshots", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      return command === "session_upsert" && commands.length === 1
        ? firstWrite.promise
        : Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();
    const worker = { ...session("worker"), orchestrationLeadId: "lead" };
    const writing = upsertSession(worker);
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const queued = upsertSession(worker);
    const deleting = deleteSession("lead");
    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve(undefined);
    await Promise.all([writing, queued, deleting]);
    expect(commands).toEqual(["session_upsert", "session_delete"]);
    await upsertSession(worker);
    for (const [, args] of mocks.invoke.mock.calls
      .slice(1)
      .filter(([command]) => command === "session_upsert")) {
      expect(args.session.blocks[0].orchestrationLeadId).toBeUndefined();
    }
  });

  it("serializes deletion after an active write and drops a queued late upsert", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert") return firstWrite.promise;
      return Promise.resolve();
    });
    const { deleteSession, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const lateWrite = upsertSession({ ...session("s1"), title: "late" });
    const deleting = deleteSession("s1");

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, lateWrite, deleting]);

    expect(commands).toEqual(["session_upsert", "session_delete"]);
  });

  it("archives only after the final active-turn snapshot is durable", async () => {
    const firstWrite = deferred<unknown>();
    const commands: string[] = [];
    mocks.invoke.mockImplementation((command: string) => {
      commands.push(command);
      if (command === "session_upsert" && commands.length === 1) {
        return firstWrite.promise;
      }
      return Promise.resolve({
        id: "s1",
        cwd: "/tmp/project",
        harness: "cursor",
        model: "",
        runtimeMode: "supervised",
        title: "",
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const { setSessionArchived, upsertSession } = await loadStore();

    const writing = upsertSession(session("s1"));
    await vi.waitFor(() => expect(commands).toEqual(["session_upsert"]));
    const finalSnapshot = upsertSession({
      ...session("s1"),
      blocks: [
        { id: "user", role: "user", text: "hello" },
        { id: "assistant", role: "assistant", text: "final buffered output" },
      ],
    });
    const archiving = setSessionArchived("s1", true);

    expect(commands).toEqual(["session_upsert"]);
    firstWrite.resolve({
      id: "s1",
      cwd: "/tmp/project",
      harness: "cursor",
      model: "",
      runtimeMode: "supervised",
      title: "",
      createdAt: 1,
      updatedAt: 1,
    });
    await Promise.all([writing, finalSnapshot, archiving]);

    expect(commands).toEqual([
      "session_upsert",
      "session_upsert",
      "session_set_archived",
    ]);
    expect(mocks.invoke.mock.calls[1]?.[1]).toMatchObject({
      session: {
        blocks: [{ text: "hello" }, { text: "final buffered output" }],
      },
    });
  });
});
