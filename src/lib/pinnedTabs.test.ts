// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPinnedTabs,
  pinnedFirst,
  pinnedTabSigils,
  setTabPinned,
  subscribePinnedTabs,
} from "./pinnedTabs";

describe("pinned tabs", () => {
  const stored = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    for (const id of loadPinnedTabs()) setTabPinned(id, false);
  });

  it("keeps a pin in storage and takes it away again", () => {
    setTabPinned("a", true);
    expect(loadPinnedTabs().has("a")).toBe(true);
    expect(localStorage.getItem("aven.pinnedTabs.v1")).toBe('["a"]');
    setTabPinned("a", false);
    expect(loadPinnedTabs().has("a")).toBe(false);
  });

  it("tells listeners, and stops when they leave", () => {
    const listener = vi.fn();
    const stop = subscribePinnedTabs(listener);
    setTabPinned("a", true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setTabPinned("b", true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("forgets the oldest pins past the limit", () => {
    for (let index = 0; index < 70; index++) setTabPinned(`t${index}`, true);
    const pins = loadPinnedTabs();
    expect(pins.size).toBe(64);
    expect(pins.has("t0")).toBe(false);
    expect(pins.has("t69")).toBe(true);
  });

  it("puts pinned tabs first and keeps each side's order", () => {
    expect(pinnedFirst(["a", "b", "c", "d"], new Set(["c", "b"]))).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("gives each pin its own mark, kept when a later pin arrives", () => {
    const first = pinnedTabSigils(["a", "b", "c"]);
    expect(new Set(first.values()).size).toBe(3);
    const more = pinnedTabSigils(["a", "b", "c", "d"]);
    for (const id of ["a", "b", "c"]) expect(more.get(id)).toBe(first.get(id));
  });

  it("still marks every pin when there are more pins than marks", () => {
    const ids = Array.from({ length: 40 }, (_, index) => `tab-${index}`);
    expect(pinnedTabSigils(ids).size).toBe(40);
  });
});
