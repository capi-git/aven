// @vitest-environment happy-dom
import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { retryableLazy } from "../lib/retryableLazy";
import { SurfaceBoundary } from "./SurfaceBoundary";

let root: Root;
let container: HTMLDivElement;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function View({ text }: { text: string }) {
  return createElement("p", null, text);
}

it("contains a failed lazy view and loads it again on Retry", async () => {
  const load = vi
    .fn<() => Promise<typeof View>>()
    .mockRejectedValueOnce(new Error("Failed to fetch dynamically imported"))
    .mockResolvedValue(View);
  const Lazy = retryableLazy(load);

  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement("span", null, "Sidebar"),
        createElement(
          SurfaceBoundary,
          { label: "editor" },
          createElement(
            Suspense,
            { fallback: null },
            createElement(Lazy, { text: "Loaded" }),
          ),
        ),
      ),
    ),
  );

  // The rest of the window stays up, with a compact failure in the slot.
  expect(container.textContent).toContain("Sidebar");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn’t load this view",
  );
  expect(consoleError).toHaveBeenCalledWith(
    "[aven] Couldn't load the editor view: Failed to fetch dynamically imported",
  );

  const retry = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Retry",
  )!;
  await act(async () => retry.click());
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Loaded");
});

it("clears a failure when the slot moves on, and stays silent when quiet", async () => {
  function Broken(): never {
    throw new Error("render failed");
  }
  const renderSlot = (broken: boolean, resetKey: string, quiet = false) =>
    act(async () =>
      root.render(
        createElement(
          SurfaceBoundary,
          { label: "diff", resetKey, quiet },
          broken ? createElement(Broken) : createElement(View, { text: "Ok" }),
        ),
      ),
    );

  await renderSlot(true, "a");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await renderSlot(false, "a");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await renderSlot(false, "b");
  expect(container.textContent).toBe("Ok");

  await renderSlot(true, "c", true);
  expect(container.innerHTML).toBe("");
});
