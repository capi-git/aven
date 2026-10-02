// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  showJump.mockReset();
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

async function render(blocks: Block[]) {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: true,
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
function scrollMetrics(el: HTMLElement, height: number, initialTotal: number) {
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
  };
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
    const answer = (text: string): Block[] => [
      prompt,
      { id: "answer", role: "assistant", text },
    ];
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

  it("lets a small wheel up inside the bottom margin leave a streaming reply", async () => {
    const answer = (text: string): Block[] => [
      prompt,
      { id: "answer", role: "assistant", text },
    ];
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
    const answer = (text: string): Block[] => [
      prompt,
      { id: "answer", role: "assistant", text },
    ];
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
