// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  LAYOUT_NOTICE_MS,
  LayoutNotice,
  type LayoutNoticeState,
} from "./LayoutNotice";

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

const moved = (id = 1, canUndo = true): LayoutNoticeState => ({
  id,
  text: "Moved “Pricing — WorkOS” into the split with “Add sign-up flow”.",
  canUndo,
});
const render = (notice: LayoutNoticeState | null, shown = true) =>
  act(async () =>
    root.render(
      createElement(LayoutNotice, { notice, shown, onUndo, onDismiss }),
    ),
  );
const pill = () => container.querySelector<HTMLElement>("[data-layout-notice]");
const live = () => container.querySelector<HTMLElement>('[role="status"]');
const button = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) =>
      entry.textContent === label || entry.getAttribute("aria-label") === label,
  );
const point = (on: boolean) =>
  act(async () =>
    pill()!.dispatchEvent(
      new PointerEvent(on ? "pointerover" : "pointerout", { bubbles: true }),
    ),
  );

it("says what moved, offers Undo, and is cut out of a page beneath it", async () => {
  await render(moved());
  expect(pill()?.dataset.nativeBrowserOccluded).toBe("true");
  expect(pill()?.textContent).toContain("into the split with");
  await act(async () => button("Undo")!.click());
  expect(onUndo).toHaveBeenCalledOnce();
  await act(async () => button("Dismiss")!.click());
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("speaks through one live region that stays mounted, its words swapped", async () => {
  await render(null);
  const region = live()!;
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent).toBe("");
  await render(moved());
  expect(live()).toBe(region);
  expect(region.textContent).toContain("Moved “Pricing — WorkOS”");
  // With the workspace out of sight the pill goes; the region stays.
  await render(moved(), false);
  expect(pill()).toBeNull();
  expect(live()).toBe(region);
  await render(null);
  expect(live()).toBe(region);
  expect(region.textContent).toBe("");
});

it("offers no Undo once the move is no longer the last change", async () => {
  await render(moved(1, false));
  expect(button("Undo")).toBeUndefined();
});

it("goes on its own, but waits while it is pointed at", async () => {
  await render(moved());
  await point(true);
  await act(async () => vi.advanceTimersByTime(LAYOUT_NOTICE_MS * 2));
  expect(onDismiss).not.toHaveBeenCalled();
  await point(false);
  await act(async () => vi.advanceTimersByTime(LAYOUT_NOTICE_MS));
  expect(onDismiss).toHaveBeenCalledOnce();
});

it("lets the next notice go on its own after one is taken away under the pointer", async () => {
  await render(moved(1));
  await point(true);
  // Undo (or the cross) takes it away while pointed at: no pointer leaves.
  await render(null);
  await render(moved(2));
  await act(async () => vi.advanceTimersByTime(LAYOUT_NOTICE_MS));
  expect(onDismiss).toHaveBeenCalledOnce();
});
