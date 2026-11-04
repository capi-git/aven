// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWakeAt } from "./useWakeAt";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useWakeAt", () => {
  let renders = 0;
  const Clock = ({ at }: { at?: number }) => {
    renders += 1;
    useWakeAt(at);
    return null;
  };
  const mount = (at?: number) => {
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Clock, { at })));
    return root;
  };
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    renders = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("renders once when the time comes", async () => {
    const root = mount(1_000_500);
    expect(renders).toBe(1);
    await advance(499);
    expect(renders).toBe(1);
    await advance(1);
    expect(renders).toBe(2);
    await advance(10_000);
    expect(renders).toBe(2);
    act(() => root.unmount());
  });

  it("stops at a time long past, instead of waking for ever", async () => {
    // A chat that finished a while ago keeps passing when its "Done" ended.
    const root = mount(999_000);
    await advance(5_000);
    expect(renders).toBe(2);
    act(() => root.unmount());
  });

  it("wakes again for a new time", async () => {
    const root = mount(999_000);
    await advance(10);
    const before = renders;
    act(() => root.render(createElement(Clock, { at: 1_000_100 })));
    await advance(200);
    expect(renders).toBe(before + 2);
    act(() => root.unmount());
  });

  it("does nothing without a time", async () => {
    const root = mount();
    await advance(5_000);
    expect(renders).toBe(1);
    act(() => root.unmount());
  });
});
