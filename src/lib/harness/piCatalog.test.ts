import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  killChild: vi.fn(async (_id: string) => {}),
  resolveBinary: vi.fn(async () => ({ path: "/fake/pi" })),
  setHarnessModels: vi.fn(),
  spawnChild: vi.fn(async (_id: string) => {}),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: vi.fn(async (_id: string, _line: string) => {}),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));
vi.mock("../models", () => ({ setHarnessModels: mocks.setHarnessModels }));
vi.mock("./child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: mocks.resolveBinary,
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: mocks.unwatchChild,
  watchChild: mocks.watchChild,
  writeChild: mocks.writeChild,
}));
import { refreshOmpCatalog, refreshPiCatalog } from "./piCatalog";

const builtin = { provider: "meta", id: "shared-id", name: "Built-in" };
const extension = {
  provider: "antigravity",
  id: "shared-id",
  name: "Extension",
  contextWindow: 200_000,
};

/**
 * Answer through the watched child's output so the real `PiRpc` multiplexer,
 * with its request ids and timers, is what the probe talks to.
 */
function reply(probeId: string, line: string, models: unknown[]) {
  const request = JSON.parse(line) as { id: string; type: string };
  const onLine = mocks.watchChild.mock.calls.find(
    ([id]) => id === probeId,
  )![1] as (line: string) => void;
  onLine(
    JSON.stringify({
      type: "response",
      id: request.id,
      command: request.type,
      success: true,
      data: { models },
    }),
  );
}

function published(): string[] {
  const call = mocks.setHarnessModels.mock.calls.at(-1);
  if (!call) return [];
  return (call[1] as Array<{ nativeId: string }>).map(
    (model) => model.nativeId,
  );
}

/** Probe teardown and timer cleanup, checked before the fake clock resets. */
function expectStopped() {
  const probeId = mocks.watchChild.mock.calls[0][0];
  expect(mocks.unwatchChild).toHaveBeenCalledExactlyOnceWith(probeId);
  expect(mocks.killChild).toHaveBeenCalledExactlyOnceWith(probeId);
  expect(vi.getTimerCount()).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.clearAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  mocks.writeChild.mockImplementation(async (id, line) => {
    reply(id, line, [builtin]);
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("gives every catalog probe its own child id", async () => {
  const first = Promise.all([refreshPiCatalog(), refreshOmpCatalog()]);
  await vi.runAllTimersAsync();
  await first;
  const second = refreshPiCatalog();
  await vi.runAllTimersAsync();
  await second;

  const spawned = mocks.spawnChild.mock.calls.map(([id]) => id);
  expect(spawned).toHaveLength(3);
  expect(new Set(spawned).size).toBe(3);
  expect(spawned[0]).toMatch(/^aven-pi-probe-[0-9a-f-]{36}$/);
  expect(spawned[1]).toMatch(/^aven-omp-probe-[0-9a-f-]{36}$/);
  // Each probe watches and kills only the id it spawned.
  expect(mocks.watchChild.mock.calls.map(([id]) => id)).toEqual(spawned);
  expect(mocks.killChild.mock.calls.map(([id]) => id).sort()).toEqual(
    [...spawned].sort(),
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("loads Pi extensions so extension-registered models are listed", async () => {
  const run = refreshPiCatalog();
  await vi.runAllTimersAsync();
  await run;
  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.stringMatching(/^aven-pi-probe-/),
    "/fake/pi",
    ["--mode", "rpc", "--no-session"],
    "/home/test",
  );
  expect(JSON.parse(mocks.writeChild.mock.calls[0][1]).type).toBe(
    "get_available_models",
  );
  expectStopped();
});

it("loads omp extensions too, and takes omp's first answer", async () => {
  // An omp provider registered by an extension can supply the default
  // model; stripping extensions made omp exit before answering at all.
  await refreshOmpCatalog();
  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.stringMatching(/^aven-omp-probe-/),
    "/fake/pi",
    ["--mode", "rpc", "--no-session"],
    "/home/test",
  );
  expect(mocks.writeChild).toHaveBeenCalledTimes(1);
  expect(Date.now()).toBe(0);
  expect(published()).toEqual(["meta/shared-id"]);
  expectStopped();
});

it("includes Pi models registered three seconds after RPC starts answering", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    reply(id, line, Date.now() < 3_000 ? [builtin] : [builtin, extension]);
  });
  let settled = false;
  const run = refreshPiCatalog().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(2_999);
  expect(settled).toBe(false);
  await vi.runAllTimersAsync();
  await run;
  expect(published()).toEqual(["meta/shared-id", "antigravity/shared-id"]);
  expectStopped();
});

it("keeps polling unchanged early snapshots through the startup window", async () => {
  let settled = false;
  const run = refreshPiCatalog().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(4_999);
  expect(settled).toBe(false);
  expect(mocks.writeChild).toHaveBeenCalledTimes(10);
  await vi.advanceTimersByTimeAsync(1);
  await run;
  expect(published()).toEqual(["meta/shared-id"]);
  expect(mocks.writeChild).toHaveBeenCalledTimes(11);
  expectStopped();
});

it("waits for a quiet second after a late catalog change", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    reply(id, line, Date.now() < 4_500 ? [builtin] : [builtin, extension]);
  });
  let settled = false;
  const run = refreshPiCatalog().then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  await run;
  expect(published()).toHaveLength(2);
  expect(Date.now()).toBe(5_500);
  expectStopped();
});

it("merges snapshots by model id and keeps the latest metadata", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    reply(
      id,
      line,
      Date.now() < 500
        ? [builtin, extension]
        : [{ ...extension, contextWindow: 1_000_000 }],
    );
  });
  const run = refreshPiCatalog();
  await vi.runAllTimersAsync();
  await run;
  const models = mocks.setHarnessModels.mock.calls[0][1] as Array<{
    nativeId: string;
    contextWindow?: number;
  }>;
  expect(models.map((model) => model.nativeId)).toEqual([
    "meta/shared-id",
    "antigravity/shared-id",
  ]);
  expect(models[1].contextWindow).toBe(1_000_000);
  expectStopped();
});

it("finishes an empty catalog without replacing the models it has", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => reply(id, line, []));
  const run = refreshPiCatalog();
  await vi.runAllTimersAsync();
  await run;
  expect(Date.now()).toBe(5_000);
  expect(mocks.setHarnessModels).not.toHaveBeenCalled();
  expectStopped();
});

it("shares one probe between concurrent refreshes", async () => {
  const first = refreshPiCatalog();
  const second = refreshPiCatalog();
  expect(first).toBe(second);
  await vi.runAllTimersAsync();
  await first;
  expect(mocks.spawnChild).toHaveBeenCalledTimes(1);
  expect(mocks.setHarnessModels).toHaveBeenCalledTimes(1);
  expectStopped();
});

it("times out and cleans up a probe that never answers", async () => {
  mocks.writeChild.mockImplementation(async () => {});
  const run = refreshPiCatalog();
  await vi.advanceTimersByTimeAsync(45_000);
  await run;
  expect(mocks.writeChild).toHaveBeenCalledTimes(1);
  expect(mocks.setHarnessModels).not.toHaveBeenCalled();
  expect(console.debug).toHaveBeenCalledWith(
    "[aven] pi catalog",
    expect.objectContaining({ message: "Pi model discovery timed out" }),
  );
  expectStopped();
});

it("keeps collected models at the deadline when a later request stalls", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    if (Date.now() === 0) reply(id, line, [builtin]);
  });
  const run = refreshPiCatalog();
  await vi.advanceTimersByTimeAsync(45_000);
  await run;
  expect(published()).toEqual(["meta/shared-id"]);
  expect(mocks.writeChild).toHaveBeenCalledTimes(2);
  expectStopped();
  // A reply after cleanup cannot restart discovery or leave RPC timers.
  const [probeId, line] = mocks.writeChild.mock.calls[1];
  reply(probeId, line, [builtin, extension]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mocks.writeChild).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds discovery even when the catalog changes on every answer", async () => {
  mocks.writeChild.mockImplementation(async (id, line) => {
    reply(id, line, [{ ...extension, contextWindow: 200_000 + Date.now() }]);
  });
  const run = refreshPiCatalog();
  await vi.runAllTimersAsync();
  await run;
  expect(published()).toHaveLength(1);
  expect(Date.now()).toBe(45_000);
  expect(mocks.writeChild).toHaveBeenCalledTimes(90);
  expectStopped();
});

it("stops polling as soon as the probe exits between requests", async () => {
  const run = refreshPiCatalog();
  await vi.advanceTimersByTimeAsync(250);
  const [probeId, , onExit] = mocks.watchChild.mock.calls[0] as [
    string,
    unknown,
    () => void,
  ];
  onExit();
  await vi.runAllTimersAsync();
  await run;
  expect(mocks.setHarnessModels).not.toHaveBeenCalled();
  expect(console.debug).toHaveBeenCalledWith(
    "[aven] pi catalog",
    expect.objectContaining({ message: "Pi catalog probe exited" }),
  );
  expect(mocks.killChild).toHaveBeenCalledExactlyOnceWith(probeId);
  expect(vi.getTimerCount()).toBe(0);
});
