import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const bounds = { x: 0, y: 32, width: 800, height: 600, scale: 1 };
beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
  vi.stubGlobal("window", {});
});
afterEach(() => vi.unstubAllGlobals());

it("shares a pending document handshake and retains it across module hot updates", async () => {
  let resolve!: (epoch: number) => void;
  mocks.invoke.mockImplementation((command) =>
    command === "browser_renderer_epoch"
      ? new Promise<number>((done) => {
          resolve = done;
        })
      : Promise.resolve(),
  );
  const { nativeBrowser } = await import("./browser");
  const first = nativeBrowser.create("a", "https://example.com", bounds);
  const second = nativeBrowser.create("b", "https://example.com", bounds);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  resolve(7);
  await Promise.all([first, second]);
  vi.resetModules();
  await (
    await import("./browser")
  ).nativeBrowser.create("c", "https://example.com", bounds);
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "browser_renderer_epoch",
    ),
  ).toHaveLength(1);
  for (const [, args] of mocks.invoke.mock.calls.filter(
    ([command]) => command === "browser_create",
  ))
    expect(args.rendererEpoch).toBe(7);
});

it("never upgrades an old document's epoch after a stale create rejection", async () => {
  mocks.invoke.mockImplementation((command) =>
    command === "browser_renderer_epoch"
      ? Promise.resolve(7)
      : Promise.reject(new Error("document replaced")),
  );
  const { nativeBrowser } = await import("./browser");
  await expect(
    nativeBrowser.create("a", "https://example.com", bounds),
  ).rejects.toThrow("document replaced");
  await expect(
    nativeBrowser.create("b", "https://example.com", bounds),
  ).rejects.toThrow("document replaced");
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "browser_renderer_epoch",
    ),
  ).toHaveLength(1);
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "browser_create",
    expect.objectContaining({ rendererEpoch: 7 }),
  );
  // A new shell document has its own global and can acquire the current epoch.
  vi.stubGlobal("window", {});
  mocks.invoke.mockImplementation((command) =>
    command === "browser_renderer_epoch"
      ? Promise.resolve(8)
      : Promise.resolve(),
  );
  await nativeBrowser.create("c", "https://example.com", bounds);
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "browser_create",
    expect.objectContaining({ rendererEpoch: 8 }),
  );
});

it("does not create a page after a failed document handshake and asks again next time", async () => {
  mocks.invoke.mockRejectedValue(new Error("shell unavailable"));
  const { nativeBrowser } = await import("./browser");
  // Concurrent creations share the one failed handshake.
  const results = await Promise.allSettled([
    nativeBrowser.create("a", "https://example.com", bounds),
    nativeBrowser.create("b", "https://example.com", bounds),
  ]);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toEqual(
      new Error("shell unavailable"),
    );
  }
  expect(mocks.invoke).toHaveBeenCalledTimes(1);

  // A transient failure is not cached for the life of the document.
  mocks.invoke.mockImplementation((command) =>
    command === "browser_renderer_epoch"
      ? Promise.resolve(9)
      : Promise.resolve(),
  );
  await nativeBrowser.create("c", "https://example.com", bounds);
  expect(
    mocks.invoke.mock.calls.filter(([command]) => command === "browser_create"),
  ).toEqual([
    ["browser_create", expect.objectContaining({ id: "c", rendererEpoch: 9 })],
  ]);
});

it("creates a page only after the pane has reached the screen", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.invoke.mockResolvedValue(7);
  const { nativeBrowser } = await import("./browser");
  const created = nativeBrowser.create("a", "https://example.com", bounds);
  const asked = () =>
    mocks.invoke.mock.calls.filter(([command]) => command === "browser_create")
      .length;
  await Promise.resolve();
  expect(asked()).toBe(0);
  frames.shift()!(0);
  await Promise.resolve();
  expect(asked()).toBe(0);
  frames.shift()!(0);
  await created;
  expect(asked()).toBe(1);
  vi.unstubAllGlobals();
});

it("does not wait on frames a hidden window defers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  mocks.invoke.mockResolvedValue(7);
  const { nativeBrowser } = await import("./browser");
  const created = nativeBrowser.create("a", "https://example.com", bounds);
  await vi.advanceTimersByTimeAsync(40);
  await created;
  expect(mocks.invoke).toHaveBeenLastCalledWith(
    "browser_create",
    expect.objectContaining({ id: "a" }),
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
