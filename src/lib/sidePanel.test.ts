import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  afterSidePanelOpens,
  beginSidePanelOpen,
  endSidePanelOpen,
  resetSidePanelForTest,
  setSidePanelOpen,
  SIDE_PANEL_SLIDE_MS,
  sidePanelOpen,
  sidePanelOpening,
  subscribeSidePanelOpen,
} from "./sidePanel";

let stored: Map<string, string>;

beforeEach(() => {
  vi.useFakeTimers();
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  resetSidePanelForTest();
});

afterEach(() => {
  resetSidePanelForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("side panel open state", () => {
  it("starts as saved, and saves a change with the panel's tab and width", () => {
    stored.set(
      "monocode.personal.inspector",
      JSON.stringify({ open: false, tab: "changes", width: 300 }),
    );
    expect(sidePanelOpen()).toBe(false);
    const heard = vi.fn();
    const stop = subscribeSidePanelOpen(heard);
    setSidePanelOpen(true);
    setSidePanelOpen(true);
    expect(heard).toHaveBeenCalledOnce();
    expect(JSON.parse(stored.get("monocode.personal.inspector")!)).toEqual({
      open: true,
      tab: "changes",
      width: 300,
    });
    stop();
    setSidePanelOpen(false);
    expect(heard).toHaveBeenCalledOnce();
  });
});

describe("side panel slide", () => {
  it("runs a task at once when the panel is not sliding in", () => {
    const task = vi.fn();
    afterSidePanelOpens(task);
    expect(task).toHaveBeenCalledOnce();
  });

  it("holds tasks until the slide ends, or a little after its length", () => {
    const ended = vi.fn();
    beginSidePanelOpen();
    afterSidePanelOpens(ended);
    expect(sidePanelOpening()).toBe(true);
    expect(ended).not.toHaveBeenCalled();
    endSidePanelOpen();
    expect(ended).toHaveBeenCalledOnce();
    expect(sidePanelOpening()).toBe(false);

    const late = vi.fn();
    const cancelled = vi.fn();
    beginSidePanelOpen();
    afterSidePanelOpens(late);
    afterSidePanelOpens(cancelled)();
    vi.advanceTimersByTime(SIDE_PANEL_SLIDE_MS);
    expect(late).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(late).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it("matches the slide's length in the stylesheet", () => {
    const css = readFileSync("src/personal-shell.css", "utf8");
    expect(css).toContain(
      `--personal-panel-duration: ${SIDE_PANEL_SLIDE_MS}ms;`,
    );
  });
});
