// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAB_SLIDE_EASE, TAB_SLIDE_MS } from "../lib/tabTrack";
import { TAB_TRACK_ID_ATTRIBUTE, useTabHighlight } from "./useTabHighlight";

let root: Root;
let container: HTMLDivElement;
// Each tab's box on screen, by id; the strip starts at x = 100.
let boxes: Record<string, { left: number; width: number }>;
let animate: ReturnType<typeof vi.fn>;

function Strip({
  ids,
  front,
  enabled = true,
}: {
  ids: string[];
  front: string | null;
  enabled?: boolean;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  const highlight = useTabHighlight(strip, front, {
    enabled,
    layoutKey: ids.join("\n"),
  });
  return createElement(
    "div",
    { ref: strip, "data-strip": true },
    createElement("span", { ref: highlight, "data-highlight": true }),
    ...ids.map((id) =>
      createElement("div", { key: id, [TAB_TRACK_ID_ATTRIBUTE]: id }, id),
    ),
  );
}

const rect = (left: number, width: number) =>
  ({
    left,
    right: left + width,
    top: 0,
    bottom: 32,
    width,
    height: 32,
    x: left,
    y: 0,
    toJSON() {},
  }) as DOMRect;

async function render(props: Parameters<typeof Strip>[0]) {
  await act(async () => root.render(createElement(Strip, props)));
}

const strip = () => container.querySelector<HTMLElement>("[data-strip]")!;
const highlight = () =>
  container.querySelector<HTMLElement>("[data-highlight]")!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.documentElement.setAttribute("data-motion", "full");
  boxes = {
    a: { left: 100, width: 200 },
    b: { left: 302, width: 200 },
    c: { left: 504, width: 200 },
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-strip")) return rect(100, 700);
      const id = this.getAttribute(TAB_TRACK_ID_ATTRIBUTE);
      if (id && boxes[id]) return rect(boxes[id].left, boxes[id].width);
      return rect(0, 0);
    },
  );
  animate = vi.fn(() => ({
    playState: "running",
    cancel: vi.fn(),
    effect: null,
    onfinish: null,
  }));
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.documentElement.removeAttribute("data-motion");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

describe("the sliding tab highlight", () => {
  it("sits under the tab in front without sliding the first time", async () => {
    await render({ ids: ["a", "b", "c"], front: "b" });
    expect(highlight().style.transform).toBe("translateX(202px)");
    expect(highlight().style.width).toBe("200px");
    expect(strip().dataset.tabHighlight).toBe("on");
    expect(animate).not.toHaveBeenCalled();
  });

  it("slides 150ms, eased out, when another tab comes to the front", async () => {
    await render({ ids: ["a", "b", "c"], front: "a" });
    await render({ ids: ["a", "b", "c"], front: "c" });
    expect(highlight().style.transform).toBe("translateX(404px)");
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translateX(0px) scaleX(1)" },
        { transform: "translateX(404px) scaleX(1)" },
      ],
      { duration: TAB_SLIDE_MS, easing: TAB_SLIDE_EASE },
    );
  });

  it("ends the slide at its duration even if WebKit never runs it", async () => {
    vi.useFakeTimers();
    try {
      await render({ ids: ["a", "b", "c"], front: "a" });
      await render({ ids: ["a", "b", "c"], front: "c" });
      const slide = animate.mock.results[0].value as {
        cancel: ReturnType<typeof vi.fn>;
      };
      expect(slide.cancel).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(TAB_SLIDE_MS + 60));
      // Stopped, so the highlight shows at its own place under the front tab.
      expect(slide.cancel).toHaveBeenCalled();
      expect(highlight().style.transform).toBe("translateX(404px)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves without sliding when only the strip changes shape", async () => {
    await render({ ids: ["a", "b", "c"], front: "b" });
    boxes.b = { left: 250, width: 150 };
    await render({ ids: ["a", "b", "c", "d"], front: "b" });
    expect(highlight().style.transform).toBe("translateX(150px)");
    expect(highlight().style.width).toBe("150px");
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not slide with reduced motion", async () => {
    document.documentElement.setAttribute("data-motion", "reduce");
    await render({ ids: ["a", "b", "c"], front: "a" });
    await render({ ids: ["a", "b", "c"], front: "c" });
    expect(highlight().style.transform).toBe("translateX(404px)");
    expect(animate).not.toHaveBeenCalled();
  });

  it("gives the front tab its own fill back while off or with no front", async () => {
    await render({ ids: ["a", "b", "c"], front: "a" });
    await render({ ids: ["a", "b", "c"], front: "a", enabled: false });
    expect(strip().dataset.tabHighlight).toBe("off");
    await render({ ids: ["a", "b", "c"], front: "gone" });
    expect(strip().dataset.tabHighlight).toBe("off");
    await render({ ids: ["a", "b", "c"], front: "b" });
    expect(strip().dataset.tabHighlight).toBe("on");
    // It reappears in place rather than sliding from where it last was.
    expect(animate).not.toHaveBeenCalled();
  });
});
