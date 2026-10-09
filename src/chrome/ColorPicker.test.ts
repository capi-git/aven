// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker";

let root: Root;
let container: HTMLDivElement;
const change = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  change.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = (value: string) =>
  act(async () =>
    root.render(
      createElement(ColorPicker, {
        value,
        model: "hsl",
        onChange: change,
        children: (picker) =>
          createElement("div", {
            ...picker.field,
            "data-field": "",
            "data-preview": picker.preview,
            "data-hue": String(picker.color.h),
          }),
      }),
    ),
  );

const field = () => container.querySelector<HTMLDivElement>("[data-field]")!;

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

it("keeps a drag's color when a lagging value arrives mid-gesture", async () => {
  await render("#ff0000");
  field().getBoundingClientRect = () => new DOMRect(0, 0, 360, 100);
  field().setPointerCapture = vi.fn();
  field().hasPointerCapture = () => false;

  // Drag along the top edge: white, but still carrying the dragged hue.
  await pointer("pointerdown", 180, 0);
  expect(change).toHaveBeenLastCalledWith("#ffffff");
  expect(field().dataset.hue).toBe("180");

  // The parent catches up with an earlier step of the drag, gray here.
  await render("#808080");
  expect(field().dataset.hue).toBe("180");
  expect(field().dataset.preview).toBe("#ffffff");

  await pointer("pointerup", 180, 0);
  // Once the drag has ended, an outside change applies again.
  await render("#0000ff");
  expect(field().dataset.hue).toBe("240");
  expect(field().dataset.preview).toBe("#0000ff");
});
