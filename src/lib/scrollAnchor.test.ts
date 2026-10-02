// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureScrollAnchor, restoreScrollAnchor } from "./scrollAnchor";

/** happy-dom has no layout. Boxes carry content coordinates in data-y/h/w. */
let scroller: HTMLDivElement;
let scrollTop = 0;
let reads = 0;

function box(y: number, h: number, ...children: HTMLElement[]) {
  const el = document.createElement("div");
  el.dataset.y = String(y);
  el.dataset.h = String(h);
  el.append(...children);
  return el;
}

function contents(...children: HTMLElement[]) {
  const el = document.createElement("div");
  el.style.display = "contents";
  el.append(...children);
  return el;
}

beforeEach(() => {
  scrollTop = 0;
  reads = 0;
  scroller = document.createElement("div");
  document.body.append(scroller);
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, get: () => 400 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = Math.max(0, next);
      },
    },
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      reads++;
      if (this === scroller) return new DOMRect(0, 100, 800, 400);
      const data = (this as HTMLElement).dataset;
      if (data?.y === undefined) return new DOMRect();
      return new DOMRect(
        0,
        100 + Number(data.y) - scrollTop,
        Number(data.w ?? 800),
        Number(data.h),
      );
    },
  );
});

afterEach(() => {
  scroller.remove();
  vi.restoreAllMocks();
});

describe("manual scroll anchoring", () => {
  it("anchors on the deepest block at the top edge, through display: contents", () => {
    const paragraph = box(1050, 100);
    scroller.append(
      box(
        0,
        2000,
        box(0, 1000),
        box(1000, 1000, contents(box(1000, 40), paragraph, box(1150, 50))),
      ),
    );
    scrollTop = 1100;
    const anchor = captureScrollAnchor(scroller)!;
    expect(anchor.element).toBe(paragraph);
    expect(anchor.offset).toBe(-50);
    expect(anchor.ratio).toBe(0.5);
    expect(anchor.scrollTop).toBe(1100);
  });

  it("does not descend into a nested scroller that moves its own children", () => {
    const trail = box(0, 300, box(0, 900));
    Object.defineProperties(trail, {
      scrollHeight: { get: () => 900 },
      clientHeight: { get: () => 300 },
    });
    scroller.append(box(0, 300, trail));
    scrollTop = 100;
    expect(captureScrollAnchor(scroller)!.element).toBe(trail);
  });

  it("skips long runs above the edge without measuring every block", () => {
    const blocks = Array.from({ length: 1000 }, (_, index) =>
      box(index * 20, 20),
    );
    scroller.append(...blocks);
    scrollTop = 15_010;
    reads = 0;
    expect(captureScrollAnchor(scroller)!.element).toBe(blocks[750]);
    expect(reads).toBeLessThan(30);
  });

  it("keeps a rewrapped block's share above the edge and a growing block's top", () => {
    const paragraph = box(1000, 200);
    scroller.append(box(0, 1000), paragraph, box(1200, 400));
    scrollTop = 1050;
    const anchor = captureScrollAnchor(scroller)!;

    // Narrower: everything above and the anchor itself rewrap taller.
    paragraph.dataset.y = "1500";
    paragraph.dataset.h = "300";
    paragraph.dataset.w = "500";
    expect(restoreScrollAnchor(scroller, anchor)).toBe(true);
    expect(scrollTop).toBe(1575);
    // Back to the original width lands on the original position exactly.
    paragraph.dataset.y = "1000";
    paragraph.dataset.h = "200";
    paragraph.dataset.w = "800";
    restoreScrollAnchor(scroller, anchor);
    expect(scrollTop).toBe(1050);

    // Streaming text grows the block below the edge at the same width.
    paragraph.dataset.h = "600";
    restoreScrollAnchor(scroller, anchor);
    expect(scrollTop).toBe(1050);
    expect(anchor.ratio).toBeCloseTo(50 / 600);
  });

  it("asks for a new anchor when the old element is gone", () => {
    const paragraph = box(0, 800);
    scroller.append(paragraph);
    scrollTop = 100;
    const anchor = captureScrollAnchor(scroller)!;
    paragraph.remove();
    expect(restoreScrollAnchor(scroller, anchor)).toBe(false);
    expect(scrollTop).toBe(100);
  });
});
