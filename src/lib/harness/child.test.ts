import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: never }) => void>(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

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

function installResolvedListeners() {
  mocks.listen.mockImplementation(
    async (name: string, handler: (event: { payload: never }) => void) => {
      mocks.handlers.set(name, handler);
      return vi.fn();
    },
  );
}

async function loadChild() {
  vi.resetModules();
  return import("./child");
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  mocks.handlers.clear();
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  vi.useRealTimers();
});

describe("isCurrentChildExit", () => {
  it("matches only the live child's pid", async () => {
    installResolvedListeners();
    const { isCurrentChildExit } = await loadChild();
    expect(isCurrentChildExit(undefined, 41)).toBe(false);
    expect(isCurrentChildExit(42, 41)).toBe(false);
    expect(isCurrentChildExit(42, 42)).toBe(true);
  });
});

describe("child bridge", () => {
  it("asks native storage to preserve only the requested legacy provider thread", async () => {
    const storage = {
      home: "/aven/codex-home",
      resumePath: "/aven/codex-home/sessions/rollout-thread.jsonl",
    };
    mocks.invoke.mockResolvedValue(storage);
    const child = await loadChild();
    expect(await child.prepareCodexStorage("provider-thread")).toEqual(storage);
    expect(mocks.invoke).toHaveBeenCalledWith("harness_prepare_codex_storage", {
      threadId: "provider-thread",
    });
    await child.prepareCodexStorage();
    expect(mocks.invoke).toHaveBeenLastCalledWith(
      "harness_prepare_codex_storage",
      {
        threadId: undefined,
      },
    );
  });

  it("waits until every listener is installed", async () => {
    const pending = deferred<UnlistenFn>();
    mocks.listen.mockImplementation(
      (name: string, handler: (event: { payload: never }) => void) => {
        mocks.handlers.set(name, handler);
        return name === "harness-stdout:main"
          ? pending.promise
          : Promise.resolve(vi.fn());
      },
    );
    const child = await loadChild();
    let acquired = false;
    const lease = child.acquireHarnessBridge().then((release) => {
      acquired = true;
      return release;
    });

    await flush();
    expect(acquired).toBe(false);

    pending.resolve(vi.fn());
    const release = await lease;
    expect(acquired).toBe(true);
    release();
  });

  it("cleans a failed installation and allows retry", async () => {
    vi.useFakeTimers();
    const late = deferred<UnlistenFn>();
    const firstUnlisten = vi.fn();
    const lateUnlisten = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(firstUnlisten)
      .mockRejectedValueOnce(new Error("listen failed"))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(vi.fn())
      .mockResolvedValueOnce(vi.fn());
    const child = await loadChild();
    const releaseApp = child.startHarnessBridge();

    await expect(child.acquireHarnessBridge()).rejects.toThrow("listen failed");
    expect(firstUnlisten).toHaveBeenCalledOnce();

    late.resolve(lateUnlisten);
    await flush();
    expect(lateUnlisten).toHaveBeenCalledOnce();

    installResolvedListeners();
    const releaseProbe = await child.acquireHarnessBridge();
    releaseProbe();
    releaseApp();
    await vi.runAllTimersAsync();
  });

  it("reconciles an exit that arrives before spawn returns its pid", async () => {
    installResolvedListeners();
    const spawned = deferred<number>();
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "harness_spawn") return spawned.promise;
      return Promise.resolve();
    });
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const onExit = vi.fn();
    child.watchChild("probe", vi.fn(), onExit);

    const spawning = child.spawnChild(
      "probe",
      "pi",
      ["--mode", "rpc"],
      "/repo",
    );
    mocks.handlers.get("harness-exit:main")?.({
      payload: { sessionId: "probe", code: 1, pid: 42 } as never,
    });
    expect(onExit).not.toHaveBeenCalled();

    spawned.resolve(42);
    await spawning;
    expect(onExit).toHaveBeenCalledWith(1);
    release();
  });
  it("starts a chat that has rules of its own with Aven's sandboxed browser, and no other", async () => {
    installResolvedListeners();
    mocks.invoke.mockReset().mockResolvedValue(7);
    const child = await loadChild();
    const { installSessionPermissions } = await import("./sessionPermissions");
    const rules = { mode: "auto" as const, rules: {} };
    const stop = installSessionPermissions((sessionId) =>
      sessionId === "avos"
        ? { ...rules, readOnly: true }
        : sessionId === "builder"
          ? rules
          : undefined,
    );
    const started = async (sessionId: string) => {
      await child.spawnChild(sessionId, "claude", [], "/repo");
      return mocks.invoke.mock.calls.findLast(
        ([name]) => name === "harness_spawn",
      )![1];
    };
    // Said as the agent starts: no bind from the window is needed for it.
    expect(await started("avos")).toMatchObject({
      browserSandboxed: true,
      browserReadOnly: true,
    });
    const builder = await started("builder");
    expect(builder).toMatchObject({ browserSandboxed: true });
    expect(builder).not.toHaveProperty("browserReadOnly");
    const mine = await started("my-chat");
    expect(mine).not.toHaveProperty("browserSandboxed");
    expect(mine).not.toHaveProperty("browserReadOnly");
    stop();
  });

  it("does not hold output for children another window owns", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });

    // Events are broadcast to every window; this one never spawned "other".
    for (let i = 0; i < 5; i += 1) {
      emit("harness-stdout:main", { sessionId: "other", line: `line ${i}` });
      emit("harness-sse:main", { sessionId: "other", events: [`event ${i}`] });
    }

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild("other", (line) => lines.push(line), vi.fn());
    child.watchSse("other", (data) => events.push(data));
    expect(lines).toEqual([]);
    expect(events).toEqual([]);
    release();
  });

  it("still replays output a spawned child printed before it was watched", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });
    mocks.invoke.mockResolvedValue(42);

    await child.spawnChild("mine", "agent", [], "/tmp");
    emit("harness-stdout:main", { sessionId: "mine", line: "early" });
    await child.openHarnessSse("mine", "http://127.0.0.1:1/event");
    emit("harness-sse:main", { sessionId: "mine", events: ["early-event"] });

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild("mine", (line) => lines.push(line), vi.fn());
    child.watchSse("mine", (data) => events.push(data));
    expect(lines).toEqual(["early"]);
    expect(events).toEqual(["early-event"]);
    release();
  });

  it("drops output a killed child or closed stream prints after it was stopped", async () => {
    installResolvedListeners();
    const child = await loadChild();
    const release = await child.acquireHarnessBridge();
    const emit = (name: string, payload: unknown) =>
      mocks.handlers.get(name)?.({ payload: payload as never });
    mocks.invoke.mockResolvedValue(42);

    child.watchChild("probe", vi.fn(), vi.fn());
    await child.spawnChild("probe", "agent", [], "/tmp");
    await child.openHarnessSse("probe", "http://127.0.0.1:1/event");
    await child.killChild("probe");
    await child.closeHarnessSse("probe");
    emit("harness-stdout:main", { sessionId: "probe", line: "late" });
    emit("harness-sse:main", { sessionId: "probe", events: ["late-event"] });

    const lines: string[] = [];
    const events: string[] = [];
    child.watchChild("probe", (line) => lines.push(line), vi.fn());
    child.watchSse("probe", (data) => events.push(data));
    expect(lines).toEqual([]);
    expect(events).toEqual([]);
    release();
  });
});

it("subscribes only to its owner output names and expands a batch in order before exit", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const release = await child.acquireHarnessBridge();
  for (const name of [
    "harness-stdout:main",
    "harness-stderr:main",
    "harness-exit:main",
    "harness-sse:main",
    "harness-sse-end:main",
  ]) {
    expect(mocks.listen).toHaveBeenCalledWith(name, expect.any(Function), {
      target: { kind: "Webview", label: "main" },
    });
  }
  const calls: (string | null)[] = [];
  mocks.invoke.mockResolvedValue(42);
  child.watchChild(
    "mine",
    (line) => calls.push(line),
    (code) => calls.push(`exit:${code}`),
  );
  await child.spawnChild("mine", "agent", [], "/tmp");
  mocks.handlers.get("harness-stdout:main")!({
    payload: {
      sessionId: "mine",
      lines: ["first", "", '{"result":true}'],
    } as never,
  });
  mocks.handlers.get("harness-exit:main")!({
    payload: { sessionId: "mine", code: 0, pid: 42 } as never,
  });
  expect(calls).toEqual(["first", "", '{"result":true}', "exit:0"]);
  release();
});

it("bounds unwatched batches by individual lines and replays them without merging", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const release = await child.acquireHarnessBridge();
  mocks.invoke.mockResolvedValue(42);
  await child.spawnChild("mine", "agent", [], "/tmp");
  const lines = Array.from({ length: 1050 }, (_, index) => `line:${index}`);
  mocks.handlers.get("harness-stdout:main")!({
    payload: { sessionId: "mine", lines } as never,
  });
  const received: string[] = [];
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  child.watchChild("mine", (line) => received.push(line), vi.fn());
  // The handshake lines stay; the oldest lines after them are dropped.
  expect(received).toEqual([...lines.slice(0, 50), ...lines.slice(100)]);
  logged.mockRestore();
  release();
});

it("delivers later batch records even if an earlier provider callback throws", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const release = await child.acquireHarnessBridge();
  const received: string[] = [];
  const failure = new Error("provider callback failed");
  child.watchChild(
    "mine",
    (line) => {
      received.push(line);
      if (line === "bad") throw failure;
    },
    vi.fn(),
  );
  expect(() =>
    mocks.handlers.get("harness-stdout:main")!({
      payload: {
        sessionId: "mine",
        lines: ["first", "bad", "final result"],
      } as never,
    }),
  ).toThrow(failure);
  expect(received).toEqual(["first", "bad", "final result"]);
  release();
});

it("expands an SSE batch in order and replays it after a late watch", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const release = await child.acquireHarnessBridge();
  mocks.invoke.mockResolvedValue(undefined);
  await child.openHarnessSse("s", "http://127.0.0.1:1/event");
  const emit = (events: string[]) =>
    mocks.handlers.get("harness-sse:main")?.({
      payload: { sessionId: "s", events } as never,
    });
  emit(["a", "b"]);
  const seen: string[] = [];
  child.watchSse("s", (data) => seen.push(data));
  emit(["c", "d"]);
  expect(seen).toEqual(["a", "b", "c", "d"]);
  release();
});

it("keeps the first lines and logs once when an unwatched buffer overflows", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const release = await child.acquireHarnessBridge();
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.invoke.mockResolvedValue(42);
  await child.spawnChild("busy", "agent", [], "/tmp");
  const lines = Array.from({ length: 1200 }, (_, i) => `line ${i}`);
  mocks.handlers.get("harness-stdout:main")?.({
    payload: { sessionId: "busy", lines } as never,
  });
  const seen: string[] = [];
  child.watchChild("busy", (line) => seen.push(line), vi.fn());
  expect(seen).toHaveLength(1000);
  expect(seen[0]).toBe("line 0");
  expect(seen[49]).toBe("line 49");
  expect(seen[50]).toBe("line 250");
  expect(seen.at(-1)).toBe("line 1199");
  expect(logged).toHaveBeenCalledTimes(1);
  logged.mockRestore();
  release();
});

it("sends writes to one child in call order, one at a time", async () => {
  installResolvedListeners();
  const child = await loadChild();
  const pending: Array<Deferred<void>> = [];
  const sent: string[] = [];
  mocks.invoke.mockImplementation((_name: string, args: { line: string }) => {
    sent.push(args.line);
    const write = deferred<void>();
    pending.push(write);
    return write.promise;
  });
  const first = child.writeChild("s", "permission");
  const second = child.writeChild("s", "message");
  const other = child.writeChild("t", "elsewhere");
  await flush();
  expect(sent).toEqual(["permission", "elsewhere"]);
  pending[0].reject(new Error("closed"));
  await expect(first).rejects.toThrow("closed");
  await flush();
  expect(sent).toEqual(["permission", "elsewhere", "message"]);
  pending[1].resolve();
  pending[2].resolve();
  await expect(second).resolves.toBeUndefined();
  await expect(other).resolves.toBeUndefined();
});
