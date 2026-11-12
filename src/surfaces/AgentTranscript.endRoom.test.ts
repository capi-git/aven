// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTranscriptAnchor } from "../lib/appearance";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

/**
 * The room under a chat's last message is one rule in every state: whatever
 * ends the chat stops a fixed distance above the pane's lower edge, and no
 * turn is stretched to make more. A chat shorter than the pane rests on that
 * room, at the bottom. "Anchor prompts to top" is an opt-in on a new key.
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
 * is stretched, over the content's bottom padding, in a column that is at
 * least one pane tall and packs its turns at the end (the CSS checked below).
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
  // The column is at least one pane tall and packs its turns at the end, so
  // a chat shorter than the pane starts this far down.
  const slack = () => Math.max(0, viewHeight - total());
  const clamp = (next: number) =>
    Math.max(0, Math.min(next, total() - viewHeight));
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => viewHeight },
    scrollHeight: { configurable: true, get: () => total() + slack() },
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
    lastTurnTop: () => slack() + earlier - el.scrollTop,
    /** From the end of the last turn's content to the pane's lower edge. */
    roomUnderContent: () =>
      el.scrollTop + viewHeight - (slack() + earlier + liveHeight),
    grow: (amount: number) => {
      liveHeight += amount;
    },
    resize: (next: number) => {
      viewHeight = next;
    },
  };
}

const END_ROOM = "96px";

/** A store with nothing saved, or with what an older Aven saved. */
function stubStorage(saved: Record<string, string> = {}) {
  const stored = new Map(Object.entries(saved));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
}

describe("the room under a chat's last message", () => {
  beforeEach(async () => {
    stubStorage();
    await reopen();
  });

  it("stretches no turn right after a send", async () => {
    await render(chat(3), true);
    expect(stretched()).toEqual([false, false, false]);
  });

  it("stretches no turn while the reply is written and after it ends", async () => {
    await render(chat(3), true);
    await render(chat(3, "The reply"), true);
    expect(stretched()).toEqual([false, false, false]);
    await render(chat(3, "The reply, and the rest of it."), true);
    expect(stretched()).toEqual([false, false, false]);
    await render(chat(3, "The reply, and the rest of it."), false);
    expect(stretched()).toEqual([false, false, false]);
  });

  it("stretches no turn of a chat that is opened again", async () => {
    await render(chat(3, "The reply"), true);
    await render(chat(3, "The reply"), false);
    await reopen();
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, false]);
  });

  it.each([
    ["at rest", false],
    ["opened again", "reopen" as const],
  ])(
    "rests a chat shorter than the pane at the bottom, on the same room (%s)",
    async (_, state) => {
      let el = await render(chat(1, "Sure."), false);
      if (state === "reopen") {
        await reopen();
        el = await render(chat(1, "Sure."), false);
      }
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 0, live: 120 });
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);
      expect(view.lastTurnTop()).toBe(600 - 96 - 120);
    },
  );

  it("does not stretch the only turn of a short chat", async () => {
    await render(chat(1, "Sure."), false);
    expect(stretched()).toEqual([false]);
    await reopen();
    await render(chat(1, "Sure."), false);
    expect(stretched()).toEqual([false]);
  });

  it.each(["1", "true"])(
    "stretches nothing when an older Aven saved the setting as on (%s)",
    async (saved) => {
      stubStorage({ "monocode.transcriptAnchor": saved });
      await reopen();
      await render(chat(3), true);
      expect(stretched()).toEqual([false, false, false]);
      await render(chat(3, "The reply"), false);
      expect(stretched()).toEqual([false, false, false]);
    },
  );

  it.each([
    ["just sent", true, undefined, 60],
    ["while a short reply is written", true, "Sure", 120],
    ["a short reply at rest", false, "Sure.", 120],
    ["while a long reply is written", true, "A long reply", 1500],
    ["a long reply at rest", false, "A long reply", 1500],
  ])(
    "ends the chat the same distance above the pane's edge (%s)",
    async (_, busy, reply, live) => {
      const el = await render(chat(3, reply), busy);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 900, live });
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);
    },
  );

  it.each([
    ["a short reply", 120],
    ["a long reply", 1500],
  ])(
    "opens a chat again with the same room it had when the reply ended (%s)",
    async (_, live) => {
      const blocks = chat(3, "The reply");
      let el = await render(blocks, true);
      el = await render(blocks, false);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      let view = layOut(el, { height: 600, earlier: 900, live });
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);

      await reopen();
      el = await render(blocks, false);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      view = layOut(el, { height: 600, earlier: 900, live });
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);
    },
  );

  it.each([
    ["while it is written", true],
    ["at rest", false],
  ])(
    "keeps the room as the reply grows and the pane changes size (%s)",
    async (_, busy) => {
      const el = await render(chat(3, "A reply"), busy);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 900, live: 120 });
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);
      // More of the reply, past the pane's height, then a shorter pane.
      view.grow(1400);
      await render(chat(3, "A reply, and a lot more"), busy);
      expect(view.roomUnderContent()).toBe(96);
      view.resize(420);
      await reportResize();
      expect(view.roomUnderContent()).toBe(96);
    },
  );
});

describe("with prompts anchored to the top", () => {
  beforeEach(async () => {
    stubStorage();
    saveTranscriptAnchor(true);
    await reopen();
  });

  it("stretches only the last turn, in every state", async () => {
    await render(chat(3), true);
    expect(stretched()).toEqual([false, false, true]);
    await render(chat(3, "The reply"), true);
    expect(stretched()).toEqual([false, false, true]);
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, true]);
    await reopen();
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, true]);
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
    "puts the last prompt at the top of the pane (%s)",
    async (_, busy, reply) => {
      const el = await render(chat(3, reply), busy);
      (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
      const view = layOut(el, { height: 600, earlier: 900, live: 120 });
      await reportResize();
      // The stretch and the bottom padding add up to exactly one pane.
      expect(el.style.getPropertyValue("--transcript-viewport")).toBe("504px");
      expect(view.lastTurnTop()).toBe(0);
    },
  );

  it("ends a reply longer than the pane on the same room", async () => {
    const el = await render(chat(3, "A long reply"), false);
    (el.firstElementChild as HTMLElement).style.paddingBottom = END_ROOM;
    const view = layOut(el, { height: 600, earlier: 900, live: 1500 });
    await reportResize();
    expect(view.roomUnderContent()).toBe(96);
  });

  it("stops the stretch when the setting is turned off", async () => {
    await render(chat(3, "The reply"), false);
    expect(stretched()).toEqual([false, false, true]);
    await act(async () => saveTranscriptAnchor(false));
    expect(stretched()).toEqual([false, false, false]);
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

  it("holds a chat shorter than the pane at the bottom, on the same room", () => {
    const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, selectors]) =>
        selectors!.trim() === ".personal-shell .personal-transcript-content",
    );
    expect(rule?.[2]).toMatch(/min-height:\s*100%/);
    expect(rule?.[2]).toMatch(/justify-content:\s*flex-end/);
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
