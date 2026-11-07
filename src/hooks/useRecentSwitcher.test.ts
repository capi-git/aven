// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ control: null as boolean | null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => native.control),
}));

import { RECENT_OPEN_MS, RECENT_SHOW_DELAY_MS } from "../lib/recentSurfaces";
import { useRecentSwitcher } from "./useRecentSwitcher";

let root: Root;
let host: HTMLElement;
let latest: ReturnType<typeof useRecentSwitcher>;
let strip = ["a", "b", "c", "d"];
const open = vi.fn();
const holdPages = vi.fn((): Promise<readonly string[]> | null => null);
const releasePages = vi.fn();

function Harness({ front }: { front: string }) {
  latest = useRecentSwitcher({
    project: "/p",
    front,
    entryKeys: () => strip,
    open,
    holdPages,
    releasePages,
  });
  return null;
}

async function show(front: string) {
  await act(async () => root.render(createElement(Harness, { front })));
}

const releaseControl = () =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Control", ctrlKey: false }),
    );
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  native.control = null;
  strip = ["a", "b", "c", "d"];
  open.mockClear();
  holdPages.mockClear();
  releasePages.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("flips to the last entry on a quick tap, without showing", async () => {
  // Used in the order a, c, then b in front now.
  await show("a");
  await show("c");
  await show("b");
  act(() => latest.step(1));
  await releaseControl();
  expect(latest.state).toBeNull();
  expect(open).toHaveBeenCalledWith("c");
  expect(holdPages).not.toHaveBeenCalled();
});

it("shows the cascade while ⌃ is held and opens the pick on release", async () => {
  await show("a");
  await show("b");
  act(() => latest.step(1));
  await act(async () => {
    vi.advanceTimersByTime(RECENT_SHOW_DELAY_MS);
  });
  expect(latest.state).toMatchObject({
    keys: ["b", "a", "c", "d"],
    picked: 1,
    phase: "open",
  });
  expect(holdPages).toHaveBeenCalledTimes(1);
  act(() => latest.step(1));
  expect(latest.state?.picked).toBe(2);
  await releaseControl();
  expect(latest.state?.phase).toBe("opening");
  await act(async () => {
    vi.advanceTimersByTime(RECENT_OPEN_MS);
  });
  expect(open).toHaveBeenCalledWith("c");
  expect(latest.state).toBeNull();
});

it("starts from the oldest with shift, and escape stays put", async () => {
  await show("a");
  act(() => latest.step(-1));
  await act(async () => {
    vi.advanceTimersByTime(RECENT_SHOW_DELAY_MS);
  });
  expect(latest.state?.picked).toBe(3);
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(latest.state?.phase).toBe("closing");
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(latest.state).toBeNull();
  await releaseControl();
  expect(open).not.toHaveBeenCalled();
});

it("hears ⌃ let go from the system while a page has the keys", async () => {
  native.control = true;
  await show("a");
  await show("b");
  act(() => latest.step(1));
  await act(async () => {
    vi.advanceTimersByTime(RECENT_SHOW_DELAY_MS);
  });
  expect(latest.state?.phase).toBe("open");
  native.control = false;
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
  expect(latest.state?.phase).toBe("opening");
});

it("does nothing with a single entry", async () => {
  strip = ["a"];
  await show("a");
  act(() => latest.step(1));
  await releaseControl();
  expect(latest.state).toBeNull();
  expect(open).not.toHaveBeenCalled();
});
