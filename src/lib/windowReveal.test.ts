// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let reveal: typeof import("./windowReveal");
let frames: FrameRequestCallback[];
let visibility: DocumentVisibilityState;

/** Run the animation frames queued so far, as one drawn frame would. */
function drawFrame() {
  const queued = frames;
  frames = [];
  for (const callback of queued) callback(performance.now());
}

const revealCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === "window_reveal");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(undefined);
  frames = [];
  visibility = "visible";
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  reveal = await import("./windowReveal");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows the window only after its appearance is applied and a frame with it is drawn", async () => {
  let applied = () => {};
  const appearance = new Promise<void>((resolve) => {
    applied = resolve;
  });
  const done = reveal.revealWhenDrawn(appearance);
  await vi.advanceTimersByTimeAsync(0);
  expect(frames).toHaveLength(0);
  expect(revealCalls()).toEqual([]);

  applied();
  await vi.advanceTimersByTimeAsync(0);
  drawFrame();
  // The first frame is about to be drawn, not drawn yet.
  expect(revealCalls()).toEqual([]);
  drawFrame();
  await done;
  expect(revealCalls()).toEqual([["window_reveal"]]);
  const timing = reveal.windowRevealTiming();
  expect(timing.committedAtEpochMs).toBeTypeOf("number");
  expect(timing.drawnAtEpochMs).toBeGreaterThanOrEqual(
    timing.committedAtEpochMs!,
  );
  expect(timing.requestedAtEpochMs).toBeGreaterThanOrEqual(
    timing.drawnAtEpochMs!,
  );
  expect(timing.visibleWhenDrawn).toBe(true);
});

it("still shows the window when applying its appearance failed", async () => {
  const done = reveal.revealWhenDrawn(Promise.reject(new Error("no host")));
  await vi.advanceTimersByTimeAsync(0);
  drawFrame();
  drawFrame();
  await done;
  expect(revealCalls()).toHaveLength(1);
});

it("does not wait for animation frames a hidden document never gets", async () => {
  visibility = "hidden";
  const done = reveal.revealWhenDrawn(undefined);
  await vi.advanceTimersByTimeAsync(0);
  await done;
  expect(frames).toHaveLength(0);
  expect(revealCalls()).toHaveLength(1);
  expect(reveal.windowRevealTiming().visibleWhenDrawn).toBe(false);
});

it("bounds the wait when animation frames stop", async () => {
  const done = reveal.revealWhenDrawn(undefined);
  await vi.advanceTimersByTimeAsync(999);
  expect(revealCalls()).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(revealCalls()).toHaveLength(1);
});

it("asks to be shown once, and quietly when there is no native window", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("browser preview"));
  reveal.revealWindow();
  reveal.revealWindow();
  const done = reveal.revealWhenDrawn(undefined);
  await vi.advanceTimersByTimeAsync(0);
  drawFrame();
  drawFrame();
  await done;
  expect(revealCalls()).toHaveLength(1);
});
