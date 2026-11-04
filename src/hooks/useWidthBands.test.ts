// @vitest-environment happy-dom
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWidthBands, widthBands } from "./useWidthBands";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Report = (entries: { contentRect: { width: number } }[]) => void;
let report: Report;
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: Report) {
        report = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const LIMITS = [480, 520];
function mount(element: HTMLElement) {
  function Host() {
    useWidthBands(element, LIMITS);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Host)));
  return root;
}
const resize = (width: number) => report([{ contentRect: { width } }]);

describe("useWidthBands", () => {
  it("names the limits a width is at or under", () => {
    expect(widthBands(481, LIMITS)).toBe("520");
    expect(widthBands(480, LIMITS)).toBe("480 520");
    expect(widthBands(521, LIMITS)).toBe("");
  });

  it("marks the element as limits are crossed, and clears the mark above them", () => {
    const element = document.createElement("div");
    mount(element);
    resize(900);
    expect(element.hasAttribute("data-width-bands")).toBe(false);
    resize(500);
    expect(element.getAttribute("data-width-bands")).toBe("520");
    resize(300);
    expect(element.getAttribute("data-width-bands")).toBe("480 520");
    resize(900);
    expect(element.hasAttribute("data-width-bands")).toBe(false);
  });

  it("writes nothing while a width stays inside the same limits", () => {
    const element = document.createElement("div");
    mount(element);
    resize(500);
    const write = vi.spyOn(element, "setAttribute");
    resize(490);
    resize(510);
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps its marks while the element is hidden", () => {
    const element = document.createElement("div");
    mount(element);
    resize(300);
    resize(0);
    expect(element.getAttribute("data-width-bands")).toBe("480 520");
  });

  it("stops watching when unmounted", () => {
    const root = mount(document.createElement("div"));
    act(() => root.unmount());
    expect(disconnect).toHaveBeenCalled();
  });
});
