// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  captureScrollOffsets,
  HIDDEN_SURFACE_DEMOTE_MS,
  HiddenSurfaceClock,
  restoreScrollOffsets,
} from "./hiddenSurfaces";

describe("hidden surface clock", () => {
  it("reports surfaces hidden long enough and forgets shown ones", () => {
    const clock = new HiddenSurfaceClock();
    clock.update(["a", "b"], 1_000);
    clock.update(["a", "b", "c"], 2_000);
    expect(clock.due(1_000 + HIDDEN_SURFACE_DEMOTE_MS - 1)).toEqual([]);
    expect(clock.due(1_000 + HIDDEN_SURFACE_DEMOTE_MS)).toEqual(["a", "b"]);
    clock.update(["b", "c"], 3_000);
    expect(clock.all()).toEqual(["b", "c"]);
    clock.update(["a", "b", "c"], 4_000);
    expect(clock.due(1_000 + HIDDEN_SURFACE_DEMOTE_MS)).toEqual(["b"]);
    expect(clock.size).toBe(3);
  });
});

describe("scroll offsets", () => {
  it("captures only scrolled elements and restores connected ones", () => {
    const root = document.createElement("div");
    const scrolled = document.createElement("div");
    const still = document.createElement("div");
    const removed = document.createElement("div");
    root.append(scrolled, still, removed);
    document.body.append(root);
    scrolled.scrollTop = 120;
    scrolled.scrollLeft = 8;
    removed.scrollTop = 40;
    const saved = captureScrollOffsets(root);
    expect([...saved.keys()]).toEqual([scrolled, removed]);
    scrolled.scrollTop = 0;
    scrolled.scrollLeft = 0;
    removed.remove();
    restoreScrollOffsets(saved);
    expect(scrolled.scrollTop).toBe(120);
    expect(scrolled.scrollLeft).toBe(8);
    root.remove();
  });
});
