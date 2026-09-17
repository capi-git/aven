// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hexToHsl,
  hslToHex,
  WorkspaceColorPicker,
} from "./WorkspaceColorPicker";

describe("color spectrum conversions", () => {
  it("represents true black, white and arbitrary exact hex colors", () => {
    for (const value of [
      "#000000",
      "#ffffff",
      "#176b8c",
      "#ff0000",
      "#a1a1a1",
    ]) {
      const color = hexToHsl(value);
      expect(hslToHex(color.h, color.s, color.l)).toBe(value);
    }
    expect(hslToHex(210, 100, 0)).toBe("#000000");
    expect(hslToHex(-120, 100, 50)).toBe("#0000ff");
  });
});
let root: Root;
let container: HTMLDivElement;
const change = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(value = "#000000") {
  await act(async () =>
    root.render(
      createElement(WorkspaceColorPicker, {
        label: "Background",
        value,
        onChange: change,
      }),
    ),
  );
}
async function typeHex(value: string) {
  const input =
    container.querySelector<HTMLInputElement>('input[type="text"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
describe("custom color editing", () => {
  it("validates hex without persisting incomplete or invalid CSS and accepts shorthand", async () => {
    await render();
    let input = await typeHex("#oops");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(change).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    input = await typeHex("#abc");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(change).toHaveBeenCalledExactlyOnceWith("#aabbcc");
  });
  it("supports exact black and white endpoints through keyboard without triggering app shortcuts", async () => {
    await render("#176b8c");
    const spectrum = container.querySelector<HTMLElement>('[role="slider"]')!;
    const appShortcut = vi.fn();
    document.addEventListener("keydown", appShortcut);
    try {
      await act(async () =>
        spectrum.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "End",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(change).toHaveBeenLastCalledWith("#000000");
      await act(async () =>
        spectrum.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Home",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(change).toHaveBeenLastCalledWith("#ffffff");
      expect(appShortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", appShortcut);
    }
  });
  it("maps the spectrum pointer edges to white and black and ignores non-primary buttons", async () => {
    await render();
    const spectrum =
      container.querySelector<HTMLDivElement>('[role="slider"]')!;
    vi.spyOn(spectrum, "getBoundingClientRect").mockReturnValue(
      new DOMRect(10, 20, 200, 100),
    );
    spectrum.setPointerCapture = vi.fn();
    spectrum.hasPointerCapture = () => false;
    await act(async () =>
      spectrum.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 2,
          clientX: 100,
          clientY: 50,
          bubbles: true,
        }),
      ),
    );
    expect(change).not.toHaveBeenCalled();
    await act(async () =>
      spectrum.dispatchEvent(
        new PointerEvent("pointerdown", {
          button: 0,
          clientX: 10,
          clientY: 20,
          pointerId: 1,
          bubbles: true,
        }),
      ),
    );
    expect(change).toHaveBeenLastCalledWith("#ffffff");
    await act(async () =>
      spectrum.dispatchEvent(
        new PointerEvent("pointerup", {
          button: 0,
          clientX: 210,
          clientY: 120,
          pointerId: 1,
          bubbles: true,
        }),
      ),
    );
    expect(change).toHaveBeenLastCalledWith("#000000");
  });
});
