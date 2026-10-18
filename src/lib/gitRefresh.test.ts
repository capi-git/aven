// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyGitChanged } from "./fs";
import { watchGitReader } from "./gitRefresh";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: () => Promise.resolve(() => {}),
    isFocused: () => Promise.resolve(true),
  }),
}));

let hidden = false;
let stops: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  stops = [];
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});

afterEach(() => {
  stops.forEach((stop) => stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function watch(refresh = vi.fn()) {
  stops.push(watchGitReader(refresh, 1_000));
  return refresh;
}

function setVisible(value: boolean) {
  hidden = !value;
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("Git readers out of focus", () => {
  it("reads on Git changes while on screen without focus, with no polling", () => {
    const refresh = watch();
    expect(refresh.mock.calls).toEqual([["event"]]);
    // Another app has focus; Aven stays on a second screen.
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(10_000);
    expect(refresh).toHaveBeenCalledOnce();
    notifyGitChanged("/repo");
    expect(refresh.mock.calls).toEqual([["event"], ["event"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls only with focus and reads at once when focus comes back", () => {
    const refresh = watch();
    vi.advanceTimersByTime(2_000);
    expect(refresh.mock.calls).toEqual([["event"], ["poll"], ["poll"]]);
    window.dispatchEvent(new Event("blur"));
    refresh.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(refresh.mock.calls).toEqual([["event"]]);
    vi.advanceTimersByTime(1_000);
    expect(refresh.mock.calls).toEqual([["event"], ["poll"]]);
  });

  it("does nothing while hidden and reads once when back on screen", () => {
    const refresh = watch();
    window.dispatchEvent(new Event("blur"));
    setVisible(false);
    refresh.mockClear();
    notifyGitChanged("/repo");
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    setVisible(true);
    expect(refresh.mock.calls).toEqual([["event"]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops listening when stopped", () => {
    const refresh = vi.fn();
    const stop = watchGitReader(refresh, 1_000);
    stop();
    refresh.mockClear();
    notifyGitChanged("/repo");
    vi.advanceTimersByTime(5_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
