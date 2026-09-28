// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_HANDOFF_MAX_MS,
  beginBrowserHandoff,
  browserHandoffPending,
  endBrowserHandoff,
  resetBrowserHandoff,
  waitForBrowserHandoff,
} from "./browserHandoff";

describe("browser handoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBrowserHandoff();
  });
  afterEach(() => {
    resetBrowserHandoff();
    vi.useRealTimers();
  });

  it("resolves at once when no page is on its way in", async () => {
    const settled = vi.fn();
    void waitForBrowserHandoff().then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalled();
  });

  it("waits for a page registered later in the same commit until it is shown", async () => {
    const settled = vi.fn();
    void waitForBrowserHandoff().then(settled);
    beginBrowserHandoff("incoming");
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).not.toHaveBeenCalled();
    endBrowserHandoff("incoming");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalled();
    expect(browserHandoffPending()).toBe(false);
  });

  it("waits for every incoming page but never past the deadline", async () => {
    const settled = vi.fn();
    beginBrowserHandoff("a");
    beginBrowserHandoff("b");
    void waitForBrowserHandoff().then(settled);
    endBrowserHandoff("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BROWSER_HANDOFF_MAX_MS);
    expect(settled).toHaveBeenCalled();
    expect(browserHandoffPending()).toBe(false);
  });

  it("keeps a page's original start time when it registers again", () => {
    beginBrowserHandoff("page", 1_000);
    beginBrowserHandoff("page", 1_200);
    expect(browserHandoffPending(1_000 + BROWSER_HANDOFF_MAX_MS - 1)).toBe(
      true,
    );
    expect(browserHandoffPending(1_000 + BROWSER_HANDOFF_MAX_MS)).toBe(false);
  });
});
