// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import {
  scrollPastCodeLane,
  UnifiedDiffView,
  type UnifiedDiffFileModel,
} from "./UnifiedDiffView";

vi.mock("./syntaxTokens", () => ({
  highlightDiffFile: () => new Promise(() => {}),
}));
vi.mock("../lib/quoteDraft", () => ({ requestAddToChat: vi.fn() }));

/** Each file's observer, to say it came near the viewport or went far. */
const observers: {
  callback: (entries: IntersectionObserverEntry[]) => void;
  targets: Element[];
}[] = [];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      targets: Element[] = [];
      constructor(
        readonly callback: (entries: IntersectionObserverEntry[]) => void,
      ) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {
        this.targets = [];
      }
      takeRecords() {
        return [];
      }
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function model(name: string): UnifiedDiffFileModel {
  const diff = buildUnifiedFile(
    "one\nconst total = price * count;\nthree\n",
    "one\nconst total = price * quantity;\nthree\nfour\n",
  );
  return {
    id: name,
    path: `src/${name}`,
    label: `src/${name}`,
    additions: diff.additions,
    deletions: diff.deletions,
    blocks: diff.blocks,
  };
}

async function render(files: UnifiedDiffFileModel[]) {
  await act(async () => root.render(createElement(UnifiedDiffView, { files })));
}

/** Every file comes near the viewport, or goes far from it. */
async function reportNear(near: boolean) {
  await act(async () => {
    for (const observer of observers)
      for (const target of observer.targets)
        observer.callback([
          { target, isIntersecting: near } as IntersectionObserverEntry,
        ]);
  });
}

/** A scroller of `total` px showing `height` px, as happy-dom lays out none. */
function scrollable(el: HTMLElement, height: number, total: number) {
  let top = 0;
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: () => total },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (next: number) => {
        top = next;
      },
    },
  });
}

function wheel(target: Element, init: WheelEventInit) {
  const event = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("diff wheel handling", () => {
  it("holds one wheel listener for its life, not one per file as files come near and go far", async () => {
    // In WebKit each wheel listener added or removed restyles the whole page,
    // which scrolling a long diff paid at every file.
    const codeLanes = () => host.querySelectorAll("[data-diff-code]").length;
    const wheelListeners = countWheelListeners();
    await render([model("a.ts"), model("b.ts"), model("c.ts")]);
    expect(codeLanes()).toBe(3);
    expect(wheelListeners()).toEqual({ added: 1, removed: 0 });

    await reportNear(false);
    expect(codeLanes()).toBe(0);
    await reportNear(true);
    expect(codeLanes()).toBe(3);
    await render([model("a.ts"), model("c.ts")]);
    expect(codeLanes()).toBe(2);
    expect(wheelListeners()).toEqual({ added: 1, removed: 0 });

    await act(async () => root.unmount());
    expect(wheelListeners()).toEqual({ added: 1, removed: 1 });
  });

  it("moves the diff when a wheel over a code lane would latch to it", async () => {
    await render([model("a.ts")]);
    const scroller = host.querySelector<HTMLElement>(".unified-diff")!;
    scrollable(scroller, 200, 1000);
    const code = host.querySelector("[data-diff-code]")!;
    const event = wheel(code.firstElementChild ?? code, { deltaY: 60 });
    expect(scroller.scrollTop).toBe(60);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("scrollPastCodeLane", () => {
  let view: HTMLElement;
  let scroller: HTMLElement;
  let lane: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    view = document.createElement("div");
    scroller = document.createElement("div");
    const code = document.createElement("div");
    code.setAttribute("data-diff-code", "");
    lane = document.createElement("span");
    outside = document.createElement("span");
    code.append(lane);
    scroller.append(code, outside);
    view.append(scroller);
    document.body.append(view);
    scrollable(scroller, 200, 1000);
    view.addEventListener("wheel", (event) =>
      scrollPastCodeLane(event, view, scroller),
    );
  });

  afterEach(() => view.remove());

  it("moves the scroller by a wheel over a code lane and takes the event", () => {
    const event = wheel(lane, { deltaY: 40 });
    expect(scroller.scrollTop).toBe(40);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stops at the scroller's end and leaves the event to the page there", () => {
    scroller.scrollTop = 800;
    const event = wheel(lane, { deltaY: 40 });
    expect(scroller.scrollTop).toBe(800);
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves sideways input, other targets and handled events alone", () => {
    const sideways = wheel(lane, { deltaX: 40, deltaY: 0 });
    expect(sideways.defaultPrevented).toBe(false);
    const elsewhere = wheel(outside, { deltaY: 40 });
    expect(elsewhere.defaultPrevented).toBe(false);
    lane.addEventListener("wheel", (event) => event.preventDefault(), {
      once: true,
    });
    wheel(lane, { deltaY: 40 });
    expect(scroller.scrollTop).toBe(0);
  });
});

/**
 * Wheel listeners added and removed from now on, on any element, the
 * document or the window. happy-dom's nodes inherit them from its own
 * EventTarget, not the global one, and the window's are bound copies.
 */
function countWheelListeners() {
  const node = Object.getPrototypeOf(Node.prototype) as EventTarget;
  const spies = (method: "addEventListener" | "removeEventListener") => [
    vi.spyOn(node, method),
    vi.spyOn(window, method),
  ];
  const added = spies("addEventListener");
  const removed = spies("removeEventListener");
  const wheel = (list: typeof added) =>
    list.flatMap((spy) => spy.mock.calls).filter(([type]) => type === "wheel")
      .length;
  return () => ({ added: wheel(added), removed: wheel(removed) });
}
