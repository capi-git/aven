// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { holdTranscriptWidths } from "./transcriptWidthHold";

/** A chat as AgentTranscript draws it: scroller, then the reading column. */
function chat(parent: HTMLElement, width: string, hidden = false) {
  const surface = document.createElement("div");
  if (hidden) surface.hidden = true;
  const scroller = document.createElement("div");
  scroller.className = "agent-transcript";
  const column = document.createElement("div");
  column.className = "personal-transcript-content";
  column.dataset.testWidth = width;
  scroller.append(column);
  surface.append(scroller);
  parent.append(surface);
  return { scroller, column };
}

function measureFromData() {
  const real = window.getComputedStyle.bind(window);
  return vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((element: Element) => {
      const style = real(element);
      const width = (element as HTMLElement).dataset?.testWidth;
      if (width === undefined) return style;
      return {
        ...style,
        getPropertyValue: (name: string) =>
          name === "width" ? width : style.getPropertyValue(name),
      } as CSSStyleDeclaration;
    });
}

describe("holdTranscriptWidths", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("holds each chat column at its width until released", () => {
    const measured = measureFromData();
    const stage = document.createElement("div");
    document.body.append(stage);
    const left = chat(stage, "612.5px");
    const right = chat(stage, "800px");
    const release = holdTranscriptWidths(stage);
    expect(left.column.style.width).toBe("612.5px");
    expect(right.column.style.width).toBe("800px");
    expect(left.scroller.style.overflowX).toBe("hidden");
    // Every column is read before any is written: one layout at the start.
    expect(measured).toHaveBeenCalledTimes(2);
    release();
    expect(left.column.style.width).toBe("");
    expect(right.column.style.width).toBe("");
    expect(left.scroller.style.overflowX).toBe("");
  });

  it("leaves chats parked out of sight and outside the dragged panes", () => {
    measureFromData();
    const stage = document.createElement("div");
    const other = document.createElement("div");
    document.body.append(stage, other);
    const parked = chat(stage, "700px", true);
    const elsewhere = chat(other, "640px");
    const release = holdTranscriptWidths(stage);
    expect(parked.column.style.width).toBe("");
    expect(elsewhere.column.style.width).toBe("");
    release();
  });

  it("skips a column without a box and puts back earlier inline styles", () => {
    measureFromData();
    const stage = document.createElement("div");
    document.body.append(stage);
    const empty = chat(stage, "auto");
    const styled = chat(stage, "500px");
    styled.scroller.style.overflowX = "scroll";
    const release = holdTranscriptWidths(stage);
    expect(empty.column.style.width).toBe("");
    expect(empty.scroller.style.overflowX).toBe("");
    release();
    expect(styled.column.style.width).toBe("");
    expect(styled.scroller.style.overflowX).toBe("scroll");
    // A second release changes nothing that happened since.
    styled.column.style.width = "300px";
    release();
    expect(styled.column.style.width).toBe("300px");
  });

  it("does nothing without a root", () => {
    expect(() => holdTranscriptWidths(null)()).not.toThrow();
  });
});
