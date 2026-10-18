// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveTranscriptAnchor } from "../lib/appearance";
import type { OrchestrationProposal } from "../lib/orchestrationPlan";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";
import { setTranscriptScrollDragging } from "../lib/transcriptScrollIntent";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

let root: Root;
let container: HTMLDivElement;
let jumpToBottom: () => void;
const showJump = vi.fn();
const prompt: Block = { id: "user", role: "user", text: "Review the project" };
/** Every observer's callback, to report a later resize as a browser would. */
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
      // A real observer reports each element once it starts watching it,
      // after layout and before paint.
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
  showJump.mockReset();
  resizeReports.length = 0;
  jumpToBottom = () => {};
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

async function render(blocks: Block[], busy = true) {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy,
        onJumpToBottomChange: showJump,
        onJumpToBottomReady: (jump) => {
          jumpToBottom = jump;
        },
      }),
    );
  });
  return container.querySelector<HTMLElement>(".agent-transcript")!;
}

/** happy-dom does not lay out or clamp scroll offsets like a real scroller. */
function scrollMetrics(
  el: HTMLElement,
  initialHeight: number,
  initialTotal: number,
) {
  let height = initialHeight;
  let total = initialTotal;
  let position = 0;
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: () => total },
    scrollTop: {
      configurable: true,
      get: () => position,
      set: (next: number) => {
        position = Math.max(0, Math.min(next, total - height));
      },
    },
  });
  return {
    grow: (amount: number) => {
      total += amount;
    },
    /** Shorter content. A browser clamps the offset to the new bottom. */
    shrink: (amount: number) => {
      total -= amount;
      position = Math.max(0, Math.min(position, total - height));
    },
    /** Change the viewport. A browser clamps the offset to the new bottom. */
    resize: (next: number) => {
      height = next;
      position = Math.max(0, Math.min(position, total - height));
    },
  };
}

/**
 * Like `scrollMetrics`, with the live turn stretched to the viewport after a
 * send (prompt to top). The stretch comes from `--transcript-viewport`, which
 * the transcript sets only after layout has run at the new viewport height,
 * so a taller viewport first clamps the offset against the old stretch.
 */
function stretchedScrollMetrics(
  el: HTMLElement,
  initialHeight: number,
  earlier: number,
  initialLive: number,
) {
  let height = initialHeight;
  let live = initialLive;
  let position = 0;
  const stretch = () =>
    Number.parseFloat(el.style.getPropertyValue("--transcript-viewport")) || 0;
  const total = () => earlier + Math.max(live, stretch());
  const clamp = (next: number) => Math.max(0, Math.min(next, total() - height));
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: total },
    scrollTop: {
      configurable: true,
      get: () => position,
      set: (next: number) => {
        position = clamp(next);
      },
    },
  });
  return {
    grow: (amount: number) => {
      live += amount;
    },
    /** Change the viewport. A browser clamps the offset to the new bottom. */
    resize: (next: number) => {
      height = next;
      position = clamp(position);
    },
  };
}

/**
 * Heights from the rows the transcript renders: earlier history, then each
 * turn, with a run's card much taller than a line. A turn stretched for
 * prompt to top is at least `--transcript-viewport` tall. Reading the offset
 * clamps it to the end, as layout does.
 */
const LINE_PX = 40;
const RUN_CARD_PX = 240;

function renderedScrollMetrics(el: HTMLElement, initialHeight: number) {
  let height = initialHeight;
  let position = 0;
  const rowHeight = (row: Element) =>
    row.hasAttribute("data-orchestration-result") ? RUN_CARD_PX : LINE_PX;
  const total = () => {
    const stretch =
      Number.parseFloat(el.style.getPropertyValue("--transcript-viewport")) ||
      0;
    let sum = 2000;
    for (const turn of el.querySelectorAll(".transcript-turn")) {
      let rows = 0;
      for (const row of turn.children) rows += rowHeight(row);
      sum += turn.classList.contains("transcript-turn-anchor")
        ? Math.max(rows, stretch)
        : rows;
    }
    return sum;
  };
  const clamp = (next: number) => Math.max(0, Math.min(next, total() - height));
  Object.defineProperties(el, {
    clientHeight: { configurable: true, get: () => height },
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
    resize: (next: number) => {
      height = next;
    },
  };
}

async function reportResize() {
  await act(async () => {
    for (const report of resizeReports) report();
  });
}

async function wheel(target: HTMLElement, deltaY: number) {
  const event = new WheelEvent("wheel", {
    deltaY,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

async function markAtBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight;
  await act(async () => {
    el.dispatchEvent(new Event("scroll"));
  });
}

async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  await act(async () => {
    el.dispatchEvent(new Event("scroll"));
  });
}

const answer = (text: string): Block[] => [
  prompt,
  { id: "answer", role: "assistant", text },
];

describe("transcript native scrolling", () => {
  it("leaves wheel defaults intact at both edges and inside nested content", async () => {
    const el = await render([prompt]);
    scrollMetrics(el, 400, 1200);
    expect(el.classList.contains("overscroll-none")).toBe(true);

    el.scrollTop = 0;
    expect((await wheel(el, -40)).defaultPrevented).toBe(false);
    await markAtBottom(el);
    expect((await wheel(el, 40)).defaultPrevented).toBe(false);

    const child = document.createElement("div");
    child.style.overflowY = "auto";
    el.appendChild(child);
    scrollMetrics(child, 100, 500);
    child.scrollTop = 200;
    expect((await wheel(child, -40)).defaultPrevented).toBe(false);
  });

  it("releases the bottom pin on upward input and resumes following after Jump to bottom", async () => {
    const el = await render(answer("Starting the review."));
    const metrics = scrollMetrics(el, 400, 1200);
    await markAtBottom(el);

    await wheel(el, -40);
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(200);
    await render(answer("The answer continues while the reader scrolls up."));
    expect(el.scrollTop).toBe(800);

    await act(async () => jumpToBottom());
    expect(el.scrollTop).toBe(1000);
    expect(showJump).toHaveBeenLastCalledWith(false);
    metrics.grow(100);
    await render(answer("The answer continues with following restored."));
    expect(el.scrollTop).toBe(1100);
  });

  it("keeps following after upward input that cannot scroll the transcript", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 300);
    await markAtBottom(el);

    // Nothing to scroll yet, so the wheel cannot be the reader leaving.
    await wheel(el, -40);
    expect(showJump).not.toHaveBeenCalledWith(true);
    metrics.grow(700);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(600);

    // Already at the top: upward input has nowhere to go either.
    el.scrollTop = 0;
    await wheel(el, -40);
    expect(showJump).not.toHaveBeenCalledWith(true);
  });

  it("lets a small wheel up inside the bottom margin leave a streaming reply", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    expect(el.scrollTop).toBe(600);

    // A trackpad's first ticks move only a few pixels, still near the end.
    await wheel(el, -4);
    el.scrollTop = 596;
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(596);

    // Scrolling back down to the end follows the stream again.
    await markAtBottom(el);
    expect(showJump).toHaveBeenLastCalledWith(false);
    metrics.grow(40);
    await render(answer("One\n\nTwo\n\nThree"));
    expect(el.scrollTop).toBe(680);
  });

  it("keeps a live tool trail unpinned after a small wheel up near its end", async () => {
    const tool = (id: string): Block => ({
      id,
      role: "tool",
      text: `Inspect ${id}`,
      tool: { kind: "shell", status: "running" },
    });
    const blocks = [prompt, tool("one"), tool("two")];
    const el = await render(blocks);
    scrollMetrics(el, 400, 1200);
    await markAtBottom(el);
    const trail = container.querySelector<HTMLElement>(".zen-phase-live")!;
    const trailMetrics = scrollMetrics(trail, 100, 500);
    await markAtBottom(trail);
    expect(trail.scrollTop).toBe(400);

    await wheel(trail, -4);
    trail.scrollTop = 396;
    await act(async () => {
      trail.dispatchEvent(new Event("scroll"));
    });
    trailMetrics.grow(50);
    await render([...blocks, tool("three")]);
    expect(trail.scrollTop).toBe(396);

    await markAtBottom(trail);
    trailMetrics.grow(50);
    await render([...blocks, tool("three"), tool("four")]);
    expect(trail.scrollTop).toBe(500);
  });

  it("lets a live tool trail consume upward input until its edge without canceling native scroll", async () => {
    const tool = (id: string): Block => ({
      id,
      role: "tool",
      text: `Inspect ${id}`,
      tool: { kind: "shell", status: "running" },
    });
    const blocks = [prompt, tool("one"), tool("two")];
    const el = await render(blocks);
    const outerMetrics = scrollMetrics(el, 400, 1200);
    await markAtBottom(el);
    const trail = container.querySelector<HTMLElement>(".zen-phase-live")!;
    expect(trail).not.toBeNull();
    scrollMetrics(trail, 100, 500);
    trail.scrollTop = 200;
    showJump.mockClear();

    expect((await wheel(trail, -40)).defaultPrevented).toBe(false);
    expect(showJump).not.toHaveBeenCalled();
    outerMetrics.grow(100);
    await render([...blocks, tool("three")]);
    expect(el.scrollTop).toBe(900);

    trail.scrollTop = 0;
    expect((await wheel(trail, -40)).defaultPrevented).toBe(false);
    expect(showJump).toHaveBeenLastCalledWith(true);
    outerMetrics.grow(100);
    await render([...blocks, tool("three"), tool("four")]);
    expect(el.scrollTop).toBe(900);
  });

  it("keeps streaming updates from repinning an active scrollbar drag and follows after release at the end", async () => {
    const el = await render(answer("Starting the review."));
    const metrics = scrollMetrics(el, 400, 1200);
    await markAtBottom(el);
    await act(async () => setTranscriptScrollDragging(el, true));
    // Even a scroll event at the end cannot restore following mid-gesture.
    await markAtBottom(el);
    metrics.grow(200);
    await render(answer("More output during the drag."));
    expect(el.scrollTop).toBe(800);
    await act(async () => setTranscriptScrollDragging(el, false));
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(100);
    await render(answer("Still reading earlier output after release."));
    expect(el.scrollTop).toBe(800);
    await act(async () => setTranscriptScrollDragging(el, true));
    await markAtBottom(el);
    await act(async () => setTranscriptScrollDragging(el, false));
    expect(showJump).toHaveBeenLastCalledWith(false);
    metrics.grow(100);
    await render(answer("Following is restored at the bottom."));
    expect(el.scrollTop).toBe(1200);
  });
});

describe("transcript bottom following", () => {
  it("keeps the last message above the stack over the message box as it grows", async () => {
    // The stack (a team's bar, the review bar, an offer) sits below the
    // transcript, not over it: a taller stack makes the viewport shorter,
    // and a following transcript keeps its end in view.
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    metrics.resize(250);
    await act(async () => {
      for (const report of resizeReports) report();
    });
    expect(el.scrollTop).toBe(750);
    expect(showJump).not.toHaveBeenCalledWith(true);
    // And Jump to latest lands on the same end once the reader left it.
    await wheel(el, -40);
    await scrollTo(el, 500);
    act(() => jumpToBottom());
    expect(el.scrollTop).toBe(750);
  });

  it("keeps following a stretched live turn when the stack over the message box gets shorter", async () => {
    // After a send, the live turn fills the viewport so the prompt sits at
    // the top. Starting a run swaps two rows over the message box for one
    // bar: the viewport grows, the browser clamps the offset, and then the
    // stretch grows with the viewport and the end moves back down.
    const el = await render(answer("Here is the plan."));
    expect(container.querySelector(".transcript-turn-anchor")).not.toBeNull();
    const metrics = stretchedScrollMetrics(el, 400, 600, 150);
    await reportResize();
    expect(el.scrollTop).toBe(600);

    // The new bar commits with the transcript's own update.
    metrics.resize(460);
    expect(el.scrollTop).toBe(540);
    await render(answer("Here is the plan.\n\nStarting the run."));
    expect(el.scrollTop).toBe(600);
    // A row leaving mid-run is reported by the resize observer alone.
    metrics.resize(500);
    expect(el.scrollTop).toBe(560);
    await reportResize();
    expect(el.scrollTop).toBe(600);
    expect(showJump).not.toHaveBeenCalledWith(true);

    // The lead's summary and the run's result arrive while it follows, and
    // the stack grows again when the run finishes. The end stays in view.
    metrics.grow(500);
    await render(answer("Here is the plan.\n\nThe run finished."));
    expect(el.scrollTop).toBe(750);
    metrics.resize(300);
    await reportResize();
    expect(el.scrollTop).toBe(950);
    expect(showJump).not.toHaveBeenCalledWith(true);
  });

  it("does not re-pin a slightly scrolled-up reader when a shorter stack stretches the live turn", async () => {
    const el = await render(answer("Here is the plan."));
    const metrics = stretchedScrollMetrics(el, 400, 600, 150);
    await reportResize();
    await wheel(el, -4);
    await scrollTo(el, 596);
    expect(showJump).toHaveBeenLastCalledWith(true);

    metrics.resize(460);
    await reportResize();
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(500);
    await render(answer("Here is the plan.\n\nThe run finished."));
    expect(el.scrollTop).toBe(540);
  });

  it.each([
    ["on", true],
    ["off", false],
  ])(
    "keeps the run's card and the end in view when the run takes over the lead's turn (prompt to top %s)",
    async (_, promptToTop) => {
      const stored = new Map<string, string>();
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      });
      saveTranscriptAnchor(promptToTop);
      const plan = (status: OrchestrationProposal["status"]): Block => ({
        id: "plan",
        role: "plan",
        text: "Reset button polish",
        orchestration: {
          version: 1,
          leadId: "lead",
          cwd: "/repo",
          request: "Polish the reset button",
          author: { harness: "claude", model: "claude:test", name: "Lead" },
          settings: {
            choices: [
              { harness: "claude", model: "claude:test", name: "Worker" },
            ],
            maxWorkers: 2,
          },
          status,
          title: "Reset button polish",
          summary: "Two tasks",
          tasks: [],
        },
      });
      const earlier: Block[] = [
        { id: "ask-0", role: "user", text: "Earlier", durationMs: 1000 },
        { id: "reply-0", role: "assistant", text: "Earlier reply" },
      ];
      const request: Block = {
        id: "ask-1",
        role: "user",
        text: "Polish the reset button",
        startedAt: 1000,
      };
      const finished: Block = { ...request, durationMs: 9000 };
      const reply: Block = {
        id: "reply-1",
        role: "assistant",
        text: "Here is the plan.",
      };
      const driven: Block = {
        id: "driven",
        role: "user",
        text: "The user confirmed the orchestration card.",
        internal: true,
        startedAt: 20_000,
      };

      // The request is sent, and the lead's turn ends with the plan card.
      const el = await render([...earlier, request, reply]);
      const card = () => el.querySelector("[data-orchestration-result]");
      const lowerEdge = () => el.scrollTop + el.clientHeight;
      const metrics = renderedScrollMetrics(el, 500);
      await reportResize();
      await render([...earlier, finished, reply, plan("ready")], false);
      await reportResize();
      expect(card()).not.toBeNull();
      const before = lowerEdge();
      expect(before).toBe(el.scrollHeight);

      // Confirm and start. The team bar replaces the memory offer and the
      // "Finished" line over the message box, and the run drives the lead's
      // next turn. Its message is the app's, so the turn stays this one.
      metrics.resize(528);
      await reportResize();
      await render([...earlier, finished, reply, plan("approved"), driven]);
      await reportResize();
      expect(card()).not.toBeNull();
      expect(lowerEdge()).toBe(el.scrollHeight);
      // Only the finished turn's footer gives way to the live clock.
      expect(before - lowerEdge()).toBeLessThanOrEqual(LINE_PX);

      // The lead's new output lands at the end, in view.
      await render([
        ...earlier,
        finished,
        reply,
        plan("approved"),
        driven,
        { id: "reply-2", role: "assistant", text: "I'll wait for the task." },
      ]);
      await reportResize();
      expect(card()).not.toBeNull();
      expect(lowerEdge()).toBe(el.scrollHeight);
      expect(showJump).not.toHaveBeenCalledWith(true);
    },
  );

  it("keeps following when a queued scroll event from the last pin lands after content grows", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    expect(el.scrollTop).toBe(600);

    // The event belongs to the earlier pin and still reports its offset,
    // but streamed Markdown has already grown the transcript below it.
    metrics.grow(100);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).not.toHaveBeenCalledWith(true);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(700);
  });

  it("keeps following when a taller viewport and briefly shorter content clamp the offset well above the end", async () => {
    // As seen live when a run starts: the rows over the message box shrink
    // (viewport 412 → 442) in the same layout as the run's card briefly
    // drops out (286px), so the browser clamps far above the real end.
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 412, 2000);
    await markAtBottom(el);
    expect(el.scrollTop).toBe(1588);
    metrics.shrink(286);
    metrics.resize(442);
    metrics.grow(286);
    expect(el.scrollTop).toBe(1272);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el.scrollTop).toBe(1558);
    expect(showJump).not.toHaveBeenCalledWith(true);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(1598);
  });

  it("still lets the reader leave with a scroll key while the viewport changes", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 412, 2000);
    await markAtBottom(el);
    await act(async () => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
      );
    });
    metrics.resize(442);
    el.scrollTop = 1200;
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(el.scrollTop).toBe(1200);
    expect(showJump).toHaveBeenLastCalledWith(true);
  });

  it("keeps following through a one-pixel rounding drift", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 384, 6517);
    await markAtBottom(el);
    el.scrollTop = 6132;
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).not.toHaveBeenCalledWith(true);
    metrics.grow(100);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(6233);
  });

  it("resumes following only when the reader reaches the very end", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    await wheel(el, -40);
    await scrollTo(el, 560);

    // A small reversal back inside the bottom margin is still reading.
    await scrollTo(el, 590);
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(590);

    await scrollTo(el, 640);
    expect(showJump).toHaveBeenLastCalledWith(false);
    metrics.grow(40);
    await render(answer("One\n\nTwo\n\nThree"));
    expect(el.scrollTop).toBe(680);
  });

  it("keeps following when a taller viewport clamps the offset to the bottom", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    metrics.resize(440);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    metrics.resize(400);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(640);
  });

  it("does not re-pin a slightly scrolled-up reader that a layout change clamps to the bottom", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    await wheel(el, -4);
    await scrollTo(el, 596);

    // The composer briefly collapsing (or any taller viewport) clamps the
    // reader to the new bottom. That is layout, not the reader returning.
    metrics.resize(440);
    expect(el.scrollTop).toBe(560);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.resize(400);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(560);
  });

  it("follows again when content folding away clamps a slightly scrolled-up reader to the end", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    await wheel(el, -4);
    await scrollTo(el, 596);
    expect(showJump).toHaveBeenLastCalledWith(true);

    // Finished work folds away. The reader now sees the very end, with
    // nothing below it, so Jump hides and the next reply is followed.
    metrics.shrink(40);
    expect(el.scrollTop).toBe(560);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).toHaveBeenLastCalledWith(false);
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(600);
  });

  it("keeps a reader scrolled well up in place when content shrinks without reaching them", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    await wheel(el, -40);
    await scrollTo(el, 300);

    metrics.shrink(40);
    expect(el.scrollTop).toBe(300);
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(showJump).toHaveBeenLastCalledWith(true);
    metrics.grow(80);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(300);
  });

  it("does not pull a reader back down when their scroll lands before its event", async () => {
    const el = await render(answer("One"));
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);

    // The browser has applied the scroll, but the event is still queued
    // when the next streamed chunk commits.
    el.scrollTop = 500;
    metrics.grow(40);
    await render(answer("One\n\nTwo"));
    expect(el.scrollTop).toBe(500);
    expect(showJump).toHaveBeenLastCalledWith(true);
  });

  it("holds the bottom pin while a trackpad gesture has no direction yet", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const el = await render(answer("One"));
      const metrics = scrollMetrics(el, 400, 1000);
      await markAtBottom(el);

      // The opening event of a trackpad gesture carries no direction.
      await wheel(el, 0);
      metrics.grow(40);
      await render(answer("One\n\nTwo"));
      expect(el.scrollTop).toBe(600);

      // Nothing moved by the end of the hold, so following resumes.
      now += 150;
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(el.scrollTop).toBe(640);

      // A gesture whose upward events arrive during the hold releases it.
      await wheel(el, 0);
      metrics.grow(40);
      await render(answer("One\n\nTwo\n\nThree"));
      await wheel(el, -6);
      await scrollTo(el, 630);
      now += 150;
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      metrics.grow(40);
      await render(answer("One\n\nTwo\n\nThree\n\nFour"));
      expect(el.scrollTop).toBe(630);
      expect(showJump).toHaveBeenLastCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-pins a following transcript that is shown again after growing while hidden", async () => {
    const renderVisible = async (blocks: Block[], visible: boolean) => {
      await act(async () => {
        root.render(
          createElement(AgentTranscript, {
            blocks,
            busy: true,
            visible,
            onJumpToBottomChange: showJump,
          }),
        );
      });
      return container.querySelector<HTMLElement>(".agent-transcript")!;
    };
    const el = await renderVisible(answer("One"), true);
    const metrics = scrollMetrics(el, 400, 1000);
    await markAtBottom(el);
    await renderVisible(answer("One\n\nTwo"), false);
    // Hiding the pane reset its offset, and output kept arriving.
    el.scrollTop = 0;
    metrics.grow(200);
    await renderVisible(answer("One\n\nTwo\n\nThree"), true);
    expect(el.scrollTop).toBe(800);
    expect(showJump).not.toHaveBeenLastCalledWith(true);
  });
});
