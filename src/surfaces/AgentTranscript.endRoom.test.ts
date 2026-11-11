// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTranscriptAnchor } from "../lib/appearance";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

/**
 * The room under a chat's last message is one rule in every state: the last
 * turn fills the pane (its prompt at the top), and whatever ends the chat
 * stops a fixed distance above the pane's lower edge.
 */

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

let root: Root;
let container: HTMLDivElement;
/** Every observer's callback, to report a resize as a browser would. */
const resizeReports: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {
        resizeReports.push(() =>
          this.callback([], this as unknown as ResizeObserver),
        );
      }
      observe(target: Element) {
        queueMicrotask(() =>
          this.callback(
            [{ target } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          ),
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  resizeReports.length = 0;
  mount();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

/** Close the chat and open it again: a new transcript with no memory. */
async function reopen() {
  await act(async () => root.unmount());
  container.remove();
  resizeReports.length = 0;
  mount();
}

async function render(blocks: Block[], busy: boolean) {
  await act(async () => {
    root.render(createElement(AgentTranscript, { blocks, busy }));
  });
  return container.querySelector<HTMLElement>(".agent-transcript")!;
}

async function reportResize() {
  await act(async () => {
    for (const report of resizeReports) report();
  });
}

function chat(turns: number, lastReply?: string): Block[] {
  return Array.from({ length: turns }, (_, index) => {
    const last = index === turns - 1;
    const reply = last ? lastReply : `Answer ${index}`;
    return [
      { id: `u${index}`, role: "user" as const, text: `Question ${index}` },
      ...(reply === undefined
        ? []
        : [{ id: `a${index}`, role: "assistant" as const, text: reply }]),
    ];
  }).flat();
}

/** Which turns are stretched to the pane, in order. */
function stretched(): boolean[] {
  return [...container.querySelectorAll(".transcript-turn")].map((turn) =>
    turn.classList.contains("transcript-turn-anchor"),
  );
}

/**
 * happy-dom does not lay out. Model earlier history above a last turn that is
 * `live` pixels of content and at least `--transcript-viewport` tall when it
 * is stretched, over the content's bottom padding.
 */
function layOut(
  el: HTMLElement,
  { height, earlier, live }: { height: number; earlier: number; live: number },
) {
  let position = 0;
  let viewHeight = height;
  let liveHeight = live;
  const inner = el.firstElementChild as HTMLElement;
  const pad = () => Number.parseFloat(inner.style.paddingBottom) || 0;
  const stretch = () =>
    container.querySelector(".transcript-turn-anchor")
      ? Number.parseFloat(el.style.getPropertyValue("--transcript-viewport")) ||
        0
      : 0;
  const total = () => earlier + Math.max(liveHeight, stretch()) + pad();
  const clamp = (next: number) =>
    Math.max(0, Math.min(next, total() - viewHeight));
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => viewHeight },
    scrollHeight: { configurable: true, get: total },
    scrollTop: {
      configurable: true,
      get: () => (position = clamp(position)),
      set: (next: number) => {
        position = clamp(next);
      },
    },
  });
  return {
    /** Where the last turn's top sits, measured from the pane's top edge. */
    lastTurnTop: () => earlier - el.scrollTop,
    /** From the end of the last turn's content to the pane's lower edge. */
    roomUnderContent: () => el.scrollTop + viewHeight - (earlier + liveHeight),
    grow: (amount: number) => {
      liveHeight += amount;
    },
    resize: (next: number) => {
      viewHeight = next;
    },
  };
}

const END_ROOM = "40px";

describe("the room under a chat's last message", () => {
  it("stretches only the last turn right after a send", async () => {
    await render(chat(3), true);
    expect(stretched()).toEqual([false, false, true]);
  });

  it("keeps it stretched while the reply is written and after it ends", async () => {
    await render(chat(3), true);
    await render(chat(3, "The reply"), true);
    expect(stretched()).toEqual([false, false, true]);
    await render(chat(3, "The reply, and the rest of it."), true);
    expect(stretched()).toEqual([false, false, true]);
    await render(chat(3, "The reply, and the rest of it."), false);
    expect(stretched()).toEqual([false, false, true]);
  });

  it("stretches the last turn of a chat that is opened again", async () => {
    await render(chat(3, "The reply"), true);
    await render(chat(3, "The reply"), false);
    const before = stretched();
    await reopen();
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual(before);
    expect(stretched()).toEqual([false, false, true]);
  });

  it("stretches the only turn of a short chat", async () => {
    await render(chat(1, "Sure."), false);
    expect(stretched()).toEqual([true]);
  });

  it("moves the stretch to the next question when it is sent", async () => {
    await render(chat(2, "Done."), false);
    expect(stretched()).toEqual([false, true]);
    await render(chat(3), true);
    expect(stretched()).toEqual([false, false, true]);
  });

  it.each([
    ["just sent", true, undefined],
    ["finished", false, "Sure."],
  ])(
    "puts the last prompt at the top of the pane with room under it (%s)",
    async (_, busy, reply) => {
      const el = await render(chat(3, reply), busy);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 900, live: 120 });
      await reportResize();
      // The stretch and the bottom padding add up to exactly one pane.
      expect(el.style.getPropertyValue("--transcript-viewport")).toBe("560px");
      expect(view.lastTurnTop()).toBe(0);
      expect(view.roomUnderContent()).toBe(480);
    },
  );

  it("opens a chat again on the same view it had when the reply ended", async () => {
    const blocks = chat(3, "Sure.");
    let el = await render(blocks, true);
    el = await render(blocks, false);
    (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
    let view = layOut(el, { height: 600, earlier: 900, live: 120 });
    await reportResize();
    const atRest = [view.lastTurnTop(), view.roomUnderContent()];

    await reopen();
    el = await render(blocks, false);
    (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
    view = layOut(el, { height: 600, earlier: 900, live: 120 });
    await reportResize();
    expect([view.lastTurnTop(), view.roomUnderContent()]).toEqual(atRest);
  });

  it.each([
    ["while it is written", true],
    ["at rest", false],
    ["opened again", "reopen" as const],
  ])(
    "ends a reply longer than the pane the same distance above the edge (%s)",
    async (_, state) => {
      const blocks = chat(3, "A long reply");
      let el = await render(blocks, state === true);
      if (state === "reopen") {
        await reopen();
        el = await render(blocks, false);
      }
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 900, live: 1500 });
      await reportResize();
      expect(view.roomUnderContent()).toBe(40);
      // More of the reply, then a shorter pane: the distance holds.
      view.grow(300);
      await render(chat(3, "A long reply, and more"), state === true);
      expect(view.roomUnderContent()).toBe(40);
      view.resize(420);
      await reportResize();
      expect(view.roomUnderContent()).toBe(40);
    },
  );

  it("stretches nothing in any state when prompts are not kept at the top", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    saveTranscriptAnchor(false);
    await reopen();
    await render(chat(3), true);
    expect(stretched()).toEqual([false, false, false]);
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, false]);
    await reopen();
    const el = await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, false]);
    // The fixed distance under the last line still holds.
    (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
    const view = layOut(el, { height: 600, earlier: 900, live: 1500 });
    await reportResize();
    expect(view.roomUnderContent()).toBe(40);
  });
});

describe("the room's size", () => {
  const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = strip(readFileSync("src/surfaces/AgentTranscript.css", "utf8"));
  const pane = readFileSync("src/surfaces/SessionPane.tsx", "utf8");

  /** The chat column's bottom padding, in pixels. */
  function endRoom(): number {
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, selectors]) =>
        selectors!.trim() === ".personal-shell .personal-transcript-content",
    );
    const [, , bottom] =
      /padding-block:\s*(\d+)px\s+(\d+)px/.exec(rule?.[2] ?? "") ?? [];
    return Number(bottom);
  }

  it("is the one the tests above assume", () => {
    expect(`${endRoom()}px`).toBe(END_ROOM);
  });

  it("is set once, so a narrow pane keeps the same room", () => {
    const narrow = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
      ([, selectors, body]) =>
        selectors!.includes("personal-transcript-content") &&
        /padding(-block|-bottom)?\s*:/.test(body!),
    );
    expect(narrow).toHaveLength(1);
  });

  it("holds the jump-to-latest button, which never covers the last line", () => {
    // The button floats over the transcript's lower edge (Tailwind's 4px
    // steps: `bottom-2` up, `size-6` tall).
    const button =
      /<div className="([^"]*)">\s*<button[^>]*?data-jump-to-bottom[\s\S]*?className="([^"]*)"/.exec(
        pane,
      );
    expect(button).not.toBeNull();
    const offset = Number(/\bbottom-(\d+)\b/.exec(button![1]!)?.[1]) * 4;
    const size = Number(/\bsize-(\d+)\b/.exec(button![2]!)?.[1]) * 4;
    expect(offset + size).toBeGreaterThan(0);
    expect(endRoom()).toBeGreaterThanOrEqual(offset + size);
  });
});
