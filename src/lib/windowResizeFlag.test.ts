// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WINDOW_RESIZE_SETTLE_MS, watchWindowResize } from "./windowResizeFlag";

describe("window resize flag", () => {
  afterEach(() => vi.useRealTimers());

  it("marks the document until the window has stopped resizing", () => {
    vi.useFakeTimers();
    const stop = watchWindowResize();
    const root = document.documentElement;
    window.dispatchEvent(new Event("resize"));
    expect(root.classList.contains("is-window-resizing")).toBe(true);
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS - 10);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS - 10);
    expect(root.classList.contains("is-window-resizing")).toBe(true);
    vi.advanceTimersByTime(10);
    expect(root.classList.contains("is-window-resizing")).toBe(false);

    window.dispatchEvent(new Event("resize"));
    stop();
    expect(root.classList.contains("is-window-resizing")).toBe(false);
    window.dispatchEvent(new Event("resize"));
    expect(root.classList.contains("is-window-resizing")).toBe(false);
  });
});
