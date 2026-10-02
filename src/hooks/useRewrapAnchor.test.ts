// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRewrapAnchor } from "./useRewrapAnchor";

let root: Root;
let container: HTMLDivElement;
let observers: Set<ResizeObserverCallback>;
let scrollTop = 0;
/** Two paragraphs; the first rewraps to `600 * 800 / width` px. */
let width = 800;
let extra = 0;

function Preview() {
  const ref = useRewrapAnchor<HTMLDivElement>();
  return createElement(
    "div",
    { ref, className: "scroller" },
    createElement(
      "div",
      null,
      createElement("p", { id: "first" }),
      createElement("p", { id: "second" }),
    ),
  );
}

function rect(this: Element) {
  const first = (600 * 800) / width + extra;
  const top = (y: number, h: number) => new DOMRect(0, y - scrollTop, width, h);
  if (this.className === "scroller") return new DOMRect(0, 0, width, 400);
  if (this.id === "first") return top(0, first);
  if (this.id === "second") return top(first, 600);
  return new DOMRect();
}

async function deliver() {
  await act(async () => {
    for (const callback of observers)
      callback([], {} as unknown as ResizeObserver);
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observers = new Set();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        observers.add(this.callback);
      }
      unobserve() {}
      disconnect() {
        observers.delete(this.callback);
      }
    },
  );
  scrollTop = 0;
  width = 800;
  extra = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rect);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Preview)));
  const scroller = container.querySelector<HTMLElement>(".scroller")!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = next;
      },
    },
  });
  scrollTop = 900;
  scroller.dispatchEvent(new Event("scroll"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("preview rewrap anchoring", () => {
  it("keeps the line at the top edge through a width change", async () => {
    // Halfway into the second paragraph, which now starts at 960px.
    width = 500;
    await deliver();
    expect(scrollTop).toBe(1260);
    width = 800;
    await deliver();
    expect(scrollTop).toBe(900);
  });

  it("leaves the offset alone when content above changes at the same width", async () => {
    extra = 200;
    await deliver();
    expect(scrollTop).toBe(900);
  });

  it("stops observing when the scroller unmounts", async () => {
    await act(async () => root.render(null));
    expect(observers.size).toBe(0);
  });
});
