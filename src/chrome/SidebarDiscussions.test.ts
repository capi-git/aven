// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { SidebarDiscussion } from "../lib/discussions";
import { measureDiscussionLinks } from "./SidebarDiscussions";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function box(top: number, height: number, width = 200): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const discussion: SidebarDiscussion = {
  id: "d1",
  a: { sessionId: "a", title: "A" },
  b: { sessionId: "b", title: "B" },
  speaking: "a",
  paused: false,
};

it("measures in the layer's own pixels under CSS zoom", () => {
  const scroller = document.createElement("div");
  const layer = document.createElement("div");
  scroller.append(layer);
  for (const [id, top] of [
    ["a", 140],
    ["b", 260],
  ] as const) {
    const row = document.createElement("button");
    row.dataset.discussionRow = id;
    row.dataset.top = String(top);
    scroller.append(row);
  }
  document.body.append(scroller);
  // Zoomed 2×: rects report twice the layer's own width and distances.
  Object.defineProperty(layer, "offsetWidth", { value: 100 });
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    box(0, 1),
  ] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const element = this as HTMLElement;
      if (element === layer) return box(40, 0, 200);
      return box(Number(element.dataset.top), 60);
    },
  );
  const { links, linked } = measureDiscussionLinks(layer, [discussion]);
  expect(links).toEqual([
    { id: "d1", top: 65, height: 60, toward: "up", paused: false },
  ]);
  expect([...linked].sort()).toEqual(["a", "b"]);
});
