// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealTab, TAB_GROW_IN_LIMIT_MS } from "./tabStripReveal";

class FakeResizeObserver {
  static live: FakeResizeObserver[] = [];
  observed: Element[] = [];
  constructor(readonly callback: () => void) {
    FakeResizeObserver.live.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  disconnect() {
    this.observed = [];
    FakeResizeObserver.live = FakeResizeObserver.live.filter(
      (entry) => entry !== this,
    );
  }
  /** The slot grew a step. */
  static grow() {
    for (const observer of [...FakeResizeObserver.live]) observer.callback();
  }
}

function slotWithTab(opening: boolean) {
  const slot = document.createElement("div");
  if (opening) slot.setAttribute("data-tab-opening", "true");
  const tab = document.createElement("div");
  const icon = document.createElement("span");
  tab.append(icon);
  slot.append(tab);
  document.body.append(slot);
  const scroll = vi.fn();
  tab.scrollIntoView = scroll;
  return { slot, tab, icon, scroll };
}

const ended = (target: Element) =>
  target.dispatchEvent(new Event("animationend", { bubbles: true }));

describe("revealTab", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    FakeResizeObserver.live = [];
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("brings a settled tab into view once, to its nearest edge", () => {
    const { slot, tab, scroll } = slotWithTab(false);
    revealTab(tab, slot);
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    expect(FakeResizeObserver.live).toHaveLength(0);
  });

  it("follows a tab growing in until its grow-in ends", () => {
    const { slot, tab, scroll } = slotWithTab(true);
    revealTab(tab, slot);
    FakeResizeObserver.grow();
    FakeResizeObserver.grow();
    expect(scroll).toHaveBeenCalledTimes(3);
    ended(slot);
    // Once more at its full width, then no longer.
    expect(scroll).toHaveBeenCalledTimes(4);
    FakeResizeObserver.grow();
    expect(scroll).toHaveBeenCalledTimes(4);
  });

  it("ignores an animation inside the tab ending", () => {
    const { slot, tab, icon, scroll } = slotWithTab(true);
    revealTab(tab, slot);
    ended(icon);
    FakeResizeObserver.grow();
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("gives up after the grow-in's limit when no end is seen", () => {
    const { slot, tab, scroll } = slotWithTab(true);
    revealTab(tab, slot);
    vi.advanceTimersByTime(TAB_GROW_IN_LIMIT_MS);
    FakeResizeObserver.grow();
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("stops following when another tab is selected", () => {
    const { slot, tab, scroll } = slotWithTab(true);
    const stop = revealTab(tab, slot);
    stop();
    FakeResizeObserver.grow();
    ended(slot);
    expect(scroll).toHaveBeenCalledOnce();
  });
});
