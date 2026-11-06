// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { lastTabReveal, revealTab, tabInView } from "./tabStripReveal";

/** A strip 400px wide at x 100 with 32px of arrow room each side. */
function strip(scrollLeft: number, scrollWidth = 800) {
  const element = document.createElement("div");
  element.setAttribute("data-sortable-scroll-container", "");
  element.style.scrollPaddingLeft = "32px";
  element.style.scrollPaddingRight = "32px";
  Object.defineProperties(element, {
    scrollLeft: { value: scrollLeft, configurable: true },
    scrollWidth: { value: scrollWidth, configurable: true },
    clientWidth: { value: 400, configurable: true },
  });
  element.getBoundingClientRect = () => new DOMRect(100, 0, 400, 32);
  document.body.append(element);
  return element;
}

function tabAt(parent: HTMLElement, left: number, width = 90) {
  const tab = document.createElement("div");
  tab.dataset.surfaceTabId = "t";
  tab.getBoundingClientRect = () => new DOMRect(left, 0, width, 32);
  parent.append(tab);
  return tab;
}

describe("tabInView", () => {
  afterEach(() => document.body.replaceChildren());

  it("counts a tab clear of both arrows as in view", () => {
    const row = strip(100);
    expect(tabInView(tabAt(row, 200), row)).toBe(true);
  });

  it("counts a tab under the end arrow as out of view while more lies past it", () => {
    const row = strip(100);
    // 400–490 against a view ending at 500, with 32px kept for the arrow.
    expect(tabInView(tabAt(row, 400), row)).toBe(false);
  });

  it("keeps no arrow room at an end with nothing more to scroll toward", () => {
    // Scrolled to the end (800 − 400): the last tab may sit at the edge.
    const end = strip(400);
    expect(tabInView(tabAt(end, 410), end)).toBe(true);
    // At the start: the first tab may sit at the edge.
    const start = strip(0);
    expect(tabInView(tabAt(start, 100), start)).toBe(true);
  });

  it("counts a tab past the strip's end as out of view", () => {
    const row = strip(0);
    expect(tabInView(tabAt(row, 520), row)).toBe(false);
  });
});

describe("revealTab", () => {
  it("scrolls the tab to its nearest edge and records it", () => {
    const row = strip(34);
    const tab = tabAt(row, 450);
    const scroll = vi.fn();
    tab.scrollIntoView = scroll;
    revealTab(tab);
    expect(scroll).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    expect(lastTabReveal).toMatchObject({ id: "t", left: 34 });
  });
});
