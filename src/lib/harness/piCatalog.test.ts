import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  killChild: vi.fn(async (_id: string) => {}),
  request: vi.fn(async () => ({ data: [] })),
  resolveBinary: vi.fn(async () => ({ path: "/fake/pi" })),
  spawnChild: vi.fn(async (_id: string) => {}),
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
}));

vi.mock("../fs", () => ({ homeDir: vi.fn(async () => "/home/test") }));
vi.mock("../models", () => ({ setHarnessModels: vi.fn() }));
vi.mock("./child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: mocks.resolveBinary,
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: mocks.unwatchChild,
  watchChild: mocks.watchChild,
}));
vi.mock("./piClient", () => ({
  PiRpc: class {
    close = mocks.close;
    pushLine = vi.fn();
    request = mocks.request;
  },
}));
import { refreshOmpCatalog, refreshPiCatalog } from "./piCatalog";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("clears the outer discovery timeout after a probe settles", async () => {
  await refreshPiCatalog();
  expect(vi.getTimerCount()).toBe(0);

  mocks.request.mockRejectedValueOnce(new Error("no models"));
  await refreshPiCatalog();
  expect(vi.getTimerCount()).toBe(0);
  expect(mocks.killChild).toHaveBeenCalledTimes(2);
});

it("gives every catalog probe its own child id", async () => {
  await Promise.all([refreshPiCatalog(), refreshOmpCatalog()]);
  await refreshPiCatalog();

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
});

it("loads Pi extensions so extension-registered models are listed", async () => {
  await refreshPiCatalog();
  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.stringMatching(/^aven-pi-probe-/),
    "/fake/pi",
    ["--mode", "rpc", "--no-session"],
    "/home/test",
  );
  expect(mocks.request).toHaveBeenCalledWith(
    { type: "get_available_models" },
    45_000,
  );
});

it("keeps extensions disabled for omp catalog probes", async () => {
  await refreshOmpCatalog();
  expect(mocks.spawnChild).toHaveBeenCalledWith(
    expect.stringMatching(/^aven-omp-probe-/),
    "/fake/pi",
    ["--mode", "rpc", "--no-session", "--no-extensions"],
    "/home/test",
  );
});
