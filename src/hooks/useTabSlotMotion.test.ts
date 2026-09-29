// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_SLOT_MOTION_MS,
  useTabSlotMotion,
  type TabSlotGhost,
} from "./useTabSlotMotion";

let root: Root;
let container: HTMLDivElement;
let seen: { opening: ReadonlySet<string>; ghosts: readonly TabSlotGhost[] };

function Strip({ ids }: { ids: string[] }) {
  const strip = useRef<HTMLDivElement | null>(null);
  seen = useTabSlotMotion(ids, strip);
  return createElement(
    "div",
    { ref: strip },
    ...ids.map((id) =>
      createElement("div", { key: id, "data-motion-slot": id }, id),
    ),
  );
}

async function render(ids: string[], zoom = 1) {
  await act(async () => root.render(createElement(Strip, { ids })));
  for (const node of container.querySelectorAll<HTMLElement>(
    "[data-motion-slot]",
  ))
    node.getBoundingClientRect = () => new DOMRect(0, 0, 224 * zoom, 32 * zoom);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tab slot motion", () => {
  it("does not animate the first render", async () => {
    await render(["a", "b"]);
    expect([...seen.opening]).toEqual([]);
    expect(seen.ghosts).toEqual([]);
  });

  it("grows new tabs in and collapses closed ones where they were", async () => {
    await render(["a", "b", "c"]);
    // Re-render so widths measured after the stubbed rects are recorded.
    await render(["a", "b", "c"]);
    await render(["a", "c", "d"]);
    expect([...seen.opening]).toEqual(["d"]);
    expect(seen.ghosts).toEqual([{ id: "b", after: "a", width: 224 }]);
    await act(async () => vi.advanceTimersByTime(TAB_SLOT_MOTION_MS));
    expect([...seen.opening]).toEqual([]);
    expect(seen.ghosts).toEqual([]);
  });

  it("places a closed first tab at the start of the strip", async () => {
    await render(["a", "b"]);
    await render(["b"]);
    expect(seen.ghosts.map((ghost) => ghost.after)).toEqual([null]);
  });

  it.each([0.5, 1.25, 2])(
    "keeps ghost widths in CSS pixels at zoom %s",
    async (zoom) => {
      container.style.zoom = String(zoom);
      await render(["a", "b"], zoom);
      await render(["a", "b"], zoom);
      await render(["a"], zoom);
      expect(seen.ghosts).toEqual([{ id: "b", after: "a", width: 224 }]);
    },
  );

  it("skips motion when every tab is replaced or motion is reduced", async () => {
    await render(["a", "b"]);
    await render(["x", "y"]);
    expect([...seen.opening]).toEqual([]);
    expect(seen.ghosts).toEqual([]);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await render(["x", "z"]);
    expect([...seen.opening]).toEqual([]);
    expect(seen.ghosts).toEqual([]);
  });

  it("lets a quick second change settle the first one too", async () => {
    await render(["a", "b", "c"]);
    await render(["a", "c"]);
    await act(async () => vi.advanceTimersByTime(TAB_SLOT_MOTION_MS / 2));
    await render(["c"]);
    expect(seen.ghosts.map((ghost) => ghost.id).sort()).toEqual(["a", "b"]);
    await act(async () => vi.advanceTimersByTime(TAB_SLOT_MOTION_MS));
    expect(seen.ghosts).toEqual([]);
  });

  it("removes a reopened tab's ghost and gives its next close a full lifetime", async () => {
    const step = TAB_SLOT_MOTION_MS / 3;
    await render(["a", "b"]);
    await render(["a"]);
    await act(async () => vi.advanceTimersByTime(step));
    await render(["a", "b"]);
    expect(seen.ghosts).toEqual([]);
    expect([...seen.opening]).toEqual(["b"]);

    await act(async () => vi.advanceTimersByTime(step));
    await render(["a"]);
    expect([...seen.opening]).toEqual([]);
    expect(seen.ghosts.map((ghost) => ghost.id)).toEqual(["b"]);
    // Neither the first close nor the intervening open may expire this close.
    await act(async () => vi.advanceTimersByTime(2 * step));
    expect(seen.ghosts.map((ghost) => ghost.id)).toEqual(["b"]);
    await act(async () => vi.advanceTimersByTime(step));
    expect(seen.ghosts).toEqual([]);
  });

  it("does not let an earlier opening expire a reopened tab", async () => {
    const step = TAB_SLOT_MOTION_MS / 3;
    await render(["a"]);
    await render(["a", "b"]);
    await act(async () => vi.advanceTimersByTime(step));
    await render(["a"]);
    await act(async () => vi.advanceTimersByTime(step));
    await render(["a", "b"]);
    await act(async () => vi.advanceTimersByTime(2 * step));
    expect([...seen.opening]).toEqual(["b"]);
    expect(seen.ghosts).toEqual([]);
    await act(async () => vi.advanceTimersByTime(step));
    expect([...seen.opening]).toEqual([]);
  });

  it.each(["whole strip", "reduced motion"])(
    "clears in-flight motion when skipping for %s",
    async (reason) => {
      await render(["a", "b"]);
      await render(["a", "c"]);
      expect([...seen.opening]).toEqual(["c"]);
      expect(seen.ghosts.map((ghost) => ghost.id)).toEqual(["b"]);
      if (reason === "reduced motion") {
        vi.stubGlobal("matchMedia", () => ({ matches: true }));
        await render(["a", "d"]);
      } else {
        await render(["x", "y"]);
      }
      expect([...seen.opening]).toEqual([]);
      expect(seen.ghosts).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
