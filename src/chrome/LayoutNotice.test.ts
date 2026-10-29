// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LAYOUT_NOTICE_MS, LayoutNotice } from "./LayoutNotice";

let root: Root;
let container: HTMLDivElement;
const onUndo = vi.fn();
const onDismiss = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  onUndo.mockClear();
  onDismiss.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (canUndo = true) =>
  act(async () =>
    root.render(
      createElement(LayoutNotice, {
        notice: {
          id: 1,
          text: "Moved “Pricing — WorkOS” into the split with “Add sign-up flow”.",
          canUndo,
        },
        onUndo,
        onDismiss,
      }),
    ),
  );
const notice = () =>
  container.querySelector<HTMLElement>("[data-layout-notice]");
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label,
  );

it("says what moved, offers Undo, and is cut out of a page beneath it", async () => {
  await render();
  expect(notice()?.getAttribute("role")).toBe("status");
  expect(notice()?.dataset.nativeBrowserOccluded).toBe("true");
  expect(notice()?.textContent).toContain("into the split with");
  await act(async () => button("Undo")!.click());
  expect(onUndo).toHaveBeenCalledOnce();
  await act(async () => button("Dismiss")!.click());
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("offers no Undo once the move is no longer the last change", async () => {
  await render(false);
  expect(button("Undo")).toBeUndefined();
});

it("goes on its own, but waits while it is pointed at", async () => {
  await render();
  await act(async () =>
    notice()!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })),
  );
  await act(async () => vi.advanceTimersByTime(LAYOUT_NOTICE_MS * 2));
  expect(onDismiss).not.toHaveBeenCalled();
  await act(async () =>
    notice()!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })),
  );
  await act(async () => vi.advanceTimersByTime(LAYOUT_NOTICE_MS));
  expect(onDismiss).toHaveBeenCalledOnce();
});
