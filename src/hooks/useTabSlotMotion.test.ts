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

async function render(ids: string[]) {
  await act(async () => root.render(createElement(Strip, { ids })));
  for (const node of container.querySelectorAll<HTMLElement>(
    "[data-motion-slot]",
  ))
    node.getBoundingClientRect = () => new DOMRect(0, 0, 224, 32);
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
});
