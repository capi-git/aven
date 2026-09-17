// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import script from "../../src-tauri/chromium/browser_edit_selection.js?raw";

const select = new Function(`return (${script})`)() as (
  this: Element,
  capture?: boolean,
) => {
  selection?: { selector: string; text: string };
  capture?: {
    rect: { x: number; y: number; width: number; height: number };
    viewport: { x: number; y: number; width: number; height: number };
    scrollX: number;
    scrollY: number;
    deviceScale: number;
  };
};
const visualViewport = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);

afterEach(() => {
  vi.restoreAllMocks();
  if (visualViewport)
    Object.defineProperty(window, "visualViewport", visualViewport);
  else delete (window as unknown as Record<string, unknown>).visualViewport;
  document.body.innerHTML = "";
});

describe("selected element screenshot geometry", () => {
  it("returns the selected element bounds separately from context without changing the document", () => {
    document.body.innerHTML = '<button id="save">Save changes</button>';
    const element = document.querySelector("button")!;
    const before = document.body.innerHTML;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(-20, 40, 180, 55),
    );
    const result = select.call(element, true);
    expect(result.selection).toMatchObject({
      selector: "#save",
      text: "Save changes",
    });
    expect(result.capture?.rect).toEqual({
      x: -20,
      y: 40,
      width: 180,
      height: 55,
    });
    expect(result.capture?.scrollX).toBe(window.scrollX);
    expect(result.capture?.scrollY).toBe(window.scrollY);
    expect(result.capture?.deviceScale).toBe(window.devicePixelRatio);
    expect(document.body.innerHTML).toBe(before);
    expect(select.call(element)).not.toHaveProperty("capture");
  });

  it("uses the current visual viewport for zoom/pan while retaining fractional CSS element bounds", () => {
    document.body.innerHTML = '<div id="card">Card</div>';
    const element = document.getElementById("card")!;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
      new DOMRect(150.25, 80.5, 240.5, 60.25),
    );
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        offsetLeft: 120,
        offsetTop: 40,
        width: 400,
        height: 250,
        scale: 2,
      },
    });
    const result = select.call(element, true);
    expect(result.capture?.viewport).toEqual({
      x: 120,
      y: 40,
      width: 400,
      height: 250,
    });
    expect(result.capture?.rect).toEqual({
      x: 150.25,
      y: 80.5,
      width: 240.5,
      height: 60.25,
    });
  });

  it("rejects a detached node instead of falling back to a page screenshot", () => {
    expect(() => select.call(document.createElement("button"), true)).toThrow(
      "no longer on the page",
    );
  });
});
