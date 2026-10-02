// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

let root: Root;
let container: HTMLDivElement;
let observers: Set<ResizeObserverCallback>;
const showJump = vi.fn();

/**
 * happy-dom does not lay out. Model a transcript whose turns rewrap: each turn
 * is `base` pixels tall at 800px and grows in proportion as the pane narrows.
 */
const view = { width: 800, height: 400, scrollTop: 0 };
let base: (turn: number, count: number) => number;
let scroller: HTMLElement;

function boxes() {
  const inner = scroller.firstElementChild!;
  const viewport = Number.parseFloat(
    scroller.style.getPropertyValue("--transcript-viewport") || "0",
  );
  const turns = [...inner.children].filter((child) =>
    child.classList.contains("transcript-turn"),
  );
  const result = new Map<Element, { y: number; h: number }>();
  let y = 0;
  for (const child of inner.children) {
    const index = turns.indexOf(child);
    let h =
      index < 0
        ? 40
        : Math.round((base(index, turns.length) * 800) / view.width);
    if (child.classList.contains("transcript-turn-anchor"))
      h = Math.max(h, viewport);
    result.set(child, { y, h });
    y += h;
  }
  return { result, total: y };
}

function measure(el: HTMLElement) {
  scroller = el;
  const total = () => boxes().total;
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => view.height },
    clientWidth: { configurable: true, get: () => view.width },
    scrollHeight: { configurable: true, get: total },
    scrollTop: {
      configurable: true,
      get: () => view.scrollTop,
      set: (next: number) => {
        view.scrollTop = Math.max(0, Math.min(next, total() - view.height));
      },
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this === scroller) return new DOMRect(0, 0, view.width, view.height);
      if (this === scroller.firstElementChild)
        return new DOMRect(0, -view.scrollTop, view.width, total());
      const found = boxes().result.get(this);
      return found
        ? new DOMRect(0, found.y - view.scrollTop, view.width, found.h)
        : new DOMRect();
    },
  );
}

function turnBlocks(count: number, prefix = "t"): Block[] {
  return Array.from({ length: count }, (_, index) => [
    {
      id: `${prefix}${index}-user`,
      role: "user" as const,
      text: `Question ${index}`,
    },
    {
      id: `${prefix}${index}-answer`,
      role: "assistant" as const,
      text: `Answer ${index}`,
    },
  ]).flat();
}

async function render(blocks: Block[], busy = false) {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        onJumpToBottomChange: showJump,
      }),
    );
  });
  return container.querySelector<HTMLElement>(".agent-transcript")!;
}

async function scrollTo(top: number) {
  scroller.scrollTop = top;
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
  });
}

/** A resize delivers after layout; the transcript corrects before paint. */
async function layout(patch: Partial<typeof view> = {}) {
  Object.assign(view, patch);
  await act(async () => {
    for (const callback of observers)
      callback([], {} as unknown as ResizeObserver);
  });
}

const turn = (index: number) =>
  scroller.querySelectorAll(".transcript-turn")[index]!;

beforeEach(() => {
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
  Object.assign(view, { width: 800, height: 400, scrollTop: 0 });
  base = () => 600;
  showJump.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("transcript reading position across resizes", () => {
  it("keeps the line being read in place as the pane narrows and widens", async () => {
    measure(await render(turnBlocks(3)));
    // The second turn spans 600–1200; the reader is 100px into it.
    await scrollTo(700);
    expect(showJump).toHaveBeenLastCalledWith(true);

    await layout({ width: 500 });
    // Each turn is now 960px tall. The same share of the second turn is
    // above the edge, rather than the reader landing in the first turn.
    expect(turn(1).getBoundingClientRect().top).toBe(-160);
    expect(view.scrollTop).toBe(1120);

    await layout({ width: 640 });
    expect(view.scrollTop).toBe(875);
    await layout({ width: 800 });
    expect(view.scrollTop).toBe(700);
    expect(showJump).toHaveBeenLastCalledWith(true);
  });

  it("holds the reading position when the window height changes", async () => {
    measure(await render(turnBlocks(3)));
    await scrollTo(650);
    await layout({ height: 300 });
    expect(view.scrollTop).toBe(650);
    await layout({ height: 500, width: 1000 });
    expect(turn(1).getBoundingClientRect().top).toBe(-40);
  });

  it("does not move the reader when content grows below or keeps up when it grows above", async () => {
    measure(await render(turnBlocks(3)));
    await scrollTo(700);
    base = (index) => (index === 2 ? 900 : 600);
    await layout();
    expect(view.scrollTop).toBe(700);
    base = (index) => (index === 0 ? 700 : index === 2 ? 900 : 600);
    await layout();
    expect(view.scrollTop).toBe(800);
  });

  it("stays pinned to the bottom while following", async () => {
    measure(await render(turnBlocks(3)));
    await scrollTo(1400);
    await layout({ width: 500 });
    expect(view.scrollTop).toBe(2880 - 400);
    await layout({ width: 900, height: 450 });
    expect(view.scrollTop).toBe(boxes().total - 450);
    expect(showJump).not.toHaveBeenCalledWith(true);
  });

  it("keeps a just-sent prompt at the top in the frame the pane resizes", async () => {
    // Prompt-to-top is the default.
    base = (index, count) => (index === count - 1 ? 100 : 600);
    measure(await render(turnBlocks(3), true));
    await layout();
    const live = turn(2);
    expect(live.classList.contains("transcript-turn-anchor")).toBe(true);
    expect(scroller.style.getPropertyValue("--transcript-viewport")).toBe(
      "400px",
    );
    expect(live.getBoundingClientRect().top).toBe(0);

    await layout({ width: 500 });
    expect(live.getBoundingClientRect().top).toBe(0);
    await layout({ height: 300 });
    expect(scroller.style.getPropertyValue("--transcript-viewport")).toBe(
      "300px",
    );
    expect(live.getBoundingClientRect().top).toBe(0);
  });

  it("keeps prepended turns from pulling the reader back to Load earlier", async () => {
    measure(await render(turnBlocks(45)));
    await scrollTo(0);
    const load = scroller.querySelector("button")!;
    expect(load.textContent).toBe("Load earlier messages");
    const reading = turn(0);
    expect(reading.getBoundingClientRect().top).toBe(40);

    await act(async () => load.click());
    // Twenty earlier turns of 600px now sit above the turn being read, and
    // the button stays at the top for the five that remain.
    expect(view.scrollTop).toBe(12_000);
    await layout();
    expect(view.scrollTop).toBe(12_000);
    expect(reading.getBoundingClientRect().top).toBe(40);
    // The edge now crosses the last loaded turn 40px above its end. A rewrap
    // keeps the same share of that turn above the edge.
    const above = turn(19).getBoundingClientRect();
    expect(above.top / above.height).toBeCloseTo(-560 / 600);
    await layout({ width: 500 });
    const rewrapped = turn(19).getBoundingClientRect();
    expect(rewrapped.top / rewrapped.height).toBeCloseTo(-560 / 600);
    expect(reading.getBoundingClientRect().top).toBe(64);
  });
});
