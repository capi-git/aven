// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColorPickerPopover } from "./ColorPickerPopover";

let container: HTMLDivElement;
let root: Root;
const change = vi.fn();
function Harness() {
  const [value, setValue] = useState("#00ff00");
  return createElement(ColorPickerPopover, {
    value,
    onChange: (hex: string) => {
      change(hex);
      setValue(hex);
    },
  });
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const field = () =>
  container.querySelector<HTMLElement>(
    '[aria-label="Saturation and brightness"]',
  )!;
const hue = () => container.querySelector<HTMLElement>('[aria-label="Hue"]')!;
async function pointer(type: string, x: number, y: number) {
  await act(async () =>
    field().dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    ),
  );
}

describe("shared popover color picker", () => {
  it("keeps a drag active across controlled rerenders and retains hue through gray", async () => {
    field().getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    field().setPointerCapture = vi.fn();
    await pointer("pointerdown", 0, 50);
    await act(async () => vi.advanceTimersByTime(32));
    expect(change).toHaveBeenLastCalledWith("#808080");
    expect(hue().getAttribute("aria-valuenow")).toBe("120");
    await pointer("pointermove", 100, 0);
    await pointer("pointerup", 100, 0);
    expect(change).toHaveBeenLastCalledWith("#00ff00");
  });

  it("supports keyboard adjustment without letting app shortcuts consume arrows", async () => {
    const shortcut = vi.fn();
    document.addEventListener("keydown", shortcut);
    try {
      expect(field().tabIndex).toBe(0);
      expect(hue().tabIndex).toBe(0);
      await act(async () =>
        hue().dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "ArrowRight",
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTime(32));
      expect(hue().getAttribute("aria-valuenow")).toBe("135");
      expect(shortcut).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", shortcut);
    }
  });

  it("flushes the last dragged value and releases capture on unmount", async () => {
    const control = field();
    control.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    control.setPointerCapture = vi.fn();
    control.hasPointerCapture = () => true;
    control.releasePointerCapture = vi.fn();
    await pointer("pointerdown", 100, 100);
    await act(async () => root.render(null));
    expect(change).toHaveBeenLastCalledWith("#000000");
    expect(control.releasePointerCapture).toHaveBeenCalledWith(1);
    const count = change.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(32));
    expect(change).toHaveBeenCalledTimes(count);
  });
});
