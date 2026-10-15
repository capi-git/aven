import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRefreshGate } from "./refreshGate";

let clock = 0;
let release: (() => void) | undefined;
const load = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      release = resolve;
    }),
);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  load.mockClear();
});
afterEach(() => vi.useRealTimers());

async function finish() {
  release?.();
  await Promise.resolve();
  await Promise.resolve();
}

it("runs one load at a time and folds requests made meanwhile into one", async () => {
  const gate = createRefreshGate(load, 0, () => clock);
  gate.request();
  gate.request();
  gate.request();
  expect(load).toHaveBeenCalledTimes(1);
  await finish();
  expect(load).toHaveBeenCalledTimes(2);
  await finish();
  expect(load).toHaveBeenCalledTimes(2);
});

it("spaces automatic loads and runs the last request when the wait ends", async () => {
  const gate = createRefreshGate(load, 10_000, () => clock);
  gate.request();
  await finish();
  clock = 2_000;
  gate.request();
  gate.request();
  expect(load).toHaveBeenCalledTimes(1);
  clock = 10_000;
  await vi.advanceTimersByTimeAsync(8_000);
  expect(load).toHaveBeenCalledTimes(2);
});

it("lets a user action skip the wait, and stops cleanly", async () => {
  const gate = createRefreshGate(load, 60_000, () => clock);
  gate.request();
  await finish();
  clock = 1_000;
  gate.request(true);
  expect(load).toHaveBeenCalledTimes(2);
  await finish();
  gate.request();
  gate.stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(load).toHaveBeenCalledTimes(2);
});
