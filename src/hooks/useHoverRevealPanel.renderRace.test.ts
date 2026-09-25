// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHoverRevealPanel } from "./useHoverRevealPanel";

let root: Root;
let container: HTMLDivElement;
let visible: boolean;
let rerenderOwner: () => void;

function Harness() {
  const [, setRevision] = useState(0);
  rerenderOwner = () => setRevision((revision) => revision + 1);
  const panel = useHoverRevealPanel({
    pinned: false,
    enterDelay: 150,
    leaveDelay: 90,
  });
  visible = panel.visible;
  return createElement(
    "div",
    null,
    createElement("button", { ...panel.edgeHandlers, "data-edge": true }),
    createElement("aside", {
      ...panel.panelHandlers,
      "data-open": panel.visible,
      "data-panel": true,
    }),
  );
}

// Leave React's Scheduler on real time while advancing the hover timers.
async function drainScheduler() {
  for (let count = 0; count < 4; count += 1)
    await new Promise((resolve) => setImmediate(resolve));
}

function panel() {
  return container.querySelector<HTMLElement>("[data-panel]")!;
}

function pointer(selector: string, type: "pointerover" | "pointerout") {
  container.querySelector<HTMLElement>(selector)!.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerType: "mouse",
      relatedTarget: document.body,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    new DOMRect(0, 0, 100, 100),
  ] as unknown as DOMRectList);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  root.unmount();
  await drainScheduler();
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("does not reopen an early hover close during an unrelated owner render", async () => {
  flushSync(() => root.render(createElement(Harness)));
  await drainScheduler();
  pointer("[data-edge]", "pointerover");
  vi.advanceTimersByTime(150);
  await drainScheduler();
  expect(panel().dataset.open).toBe("true");

  pointer("[data-edge]", "pointerout");
  pointer("[data-panel]", "pointerover");
  pointer("[data-panel]", "pointerout");
  vi.advanceTimersByTime(90);
  expect(panel().dataset.open).toBe("false");
  expect(visible).toBe(true); // The low-priority React close has not committed.

  flushSync(() => rerenderOwner());
  expect(panel().dataset.open).toBe("false");
  await drainScheduler();
  expect(visible).toBe(false);
  expect(panel().dataset.open).toBe("false");
});
