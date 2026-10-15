// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_VISIT_KEY, loadHomeVisit } from "../lib/homeBriefing";

const HOUR = 60 * 60_000;
const START = new Date(2026, 9, 14, 21, 0).getTime();
let storage: Map<string, string>;
let writes: number;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  writes = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      storage.set(key, value);
    },
    removeItem: (key: string) => storage.delete(key),
  });
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const load = () => import("./useHomeBriefing");
const fire = (target: EventTarget, type: string) =>
  target.dispatchEvent(new Event(type));

describe("presence", () => {
  it("is here on start, leaves on blur and is back on focus", async () => {
    const { trackPresence } = await load();
    const stop = trackPresence();
    expect(loadHomeVisit()).toEqual({ seenAt: START, briefing: null });
    vi.setSystemTime(START + HOUR);
    fire(window, "blur");
    expect(loadHomeVisit()?.seenAt).toBe(START + HOUR);
    // Back the next morning: a briefing for the night.
    vi.setSystemTime(START + 11 * HOUR);
    fire(window, "focus");
    expect(loadHomeVisit()?.briefing).toEqual({
      since: START + HOUR,
      at: START + 11 * HOUR,
    });
    stop();
  });

  it("counts hiding the window as leaving and showing it as coming back", async () => {
    const { trackPresence } = await load();
    const stop = trackPresence();
    vi.setSystemTime(START + HOUR);
    visibility = "hidden";
    fire(document, "visibilitychange");
    vi.setSystemTime(START + 8 * HOUR);
    visibility = "visible";
    fire(document, "visibilitychange");
    expect(loadHomeVisit()?.briefing?.since).toBe(START + HOUR);
    stop();
  });

  it("notices a return after a long idle spell with the window focused", async () => {
    const { trackPresence } = await load();
    const stop = trackPresence();
    // Input while here writes at most once a minute.
    const before = writes;
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(START + i * 1000);
      fire(window, "pointerdown");
    }
    expect(writes).toBe(before);
    vi.setSystemTime(START + 7 * HOUR);
    fire(window, "keydown");
    expect(loadHomeVisit()?.briefing).toEqual({
      since: START,
      at: START + 7 * HOUR,
    });
    stop();
  });

  it("treats input after a blur as coming back, whichever event comes first", async () => {
    const { trackPresence } = await load();
    const stop = trackPresence();
    fire(window, "blur");
    vi.setSystemTime(START + 9 * HOUR);
    fire(window, "pointerdown");
    fire(window, "focus");
    expect(loadHomeVisit()?.briefing?.since).toBe(START);
    stop();
  });

  it("starts no timers and stops listening when removed", async () => {
    const { trackPresence } = await load();
    const stop = trackPresence();
    expect(vi.getTimerCount()).toBe(0);
    stop();
    const seen = loadHomeVisit()?.seenAt;
    vi.setSystemTime(START + 9 * HOUR);
    fire(window, "focus");
    expect(loadHomeVisit()?.seenAt).toBe(seen);
  });
});

describe("useHomeBriefing", () => {
  it("opens a briefing when Home opens after time away, until dismissed", async () => {
    storage.set(
      HOME_VISIT_KEY,
      JSON.stringify({ seenAt: START - 8 * HOUR, briefing: null }),
    );
    const { useHomeBriefing } = await load();
    const seen: unknown[] = [];
    let dismiss = () => {};
    function Probe() {
      const state = useHomeBriefing();
      seen.push(state.briefing);
      dismiss = state.dismiss;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toEqual({ since: START - 8 * HOUR, at: START });
    const renders = seen.length;
    // Leaving and coming back soon after keeps the same briefing, unrendered.
    const { leave, arrive } = await load();
    await act(async () => {
      leave(START + 1000);
      arrive(START + 2000);
    });
    expect(seen).toHaveLength(renders);
    await act(async () => dismiss());
    expect(seen.at(-1)).toBeNull();
    await act(async () => root.unmount());

    // Opening Home again shortly after shows nothing.
    const again = createRoot(document.createElement("div"));
    await act(async () => again.render(createElement(Probe)));
    expect(seen.at(-1)).toBeNull();
    await act(async () => again.unmount());
  });

  it("shows nothing on the very first visit", async () => {
    const { useHomeBriefing } = await load();
    let briefing: unknown = "unset";
    function Probe() {
      briefing = useHomeBriefing().briefing;
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Probe)));
    expect(briefing).toBeNull();
    expect(loadHomeVisit()?.seenAt).toBe(START);
    await act(async () => root.unmount());
  });
});
