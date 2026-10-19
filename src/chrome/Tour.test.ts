// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const webview = vi.hoisted(() => ({ setFocus: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => webview,
}));

import { browserOverlayState } from "../lib/browserOverlays";
import { Tour, type TourPrepare } from "./Tour";

let root: Root;
let container: HTMLDivElement;
let anchors: HTMLElement[];
const onClose = vi.fn<(finished: boolean) => void>();

const RECT = { left: 300, top: 600, width: 500, height: 80 };

/** happy-dom lays nothing out: give an element a box on screen. */
function place(element: HTMLElement, rect = RECT) {
  const box = {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  };
  element.getBoundingClientRect = () => box as DOMRect;
  element.getClientRects = () => [box] as unknown as DOMRectList;
}

function anchor(name: string, rect = RECT) {
  const element = document.createElement("div");
  element.dataset.tour = name;
  place(element, rect);
  document.body.append(element);
  anchors.push(element);
  return element;
}

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function render(prepare?: TourPrepare) {
  await act(async () =>
    root.render(createElement(Tour, { onClose, prepare, startDelay: 0 })),
  );
  await settle();
}

function popover() {
  return document.querySelector<HTMLElement>(".aven-tour-popover");
}

function button(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>(".aven-tour button"),
  ].find((item) => item.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
}

async function press(label: string) {
  await act(async () => button(label).click());
  await settle();
}

async function key(value: string, target: EventTarget = document.body) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockReset();
  webview.setFocus.mockClear();
  anchors = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const element of anchors) element.remove();
  vi.unstubAllGlobals();
});

describe("the tour", () => {
  it("points at each stop on screen in turn, counting only those, then Done", async () => {
    anchor("composer");
    anchor("projects", { left: 0, top: 40, width: 240, height: 700 });
    anchor("activity", { left: 260, top: 4, width: 80, height: 24 });
    await render();
    expect(popover()?.textContent).toContain("Ask your agent");
    expect(popover()?.textContent).toContain("1 of 3");
    // The first stop has nowhere to go back to.
    expect(
      [...popover()!.querySelectorAll("button")].map((b) => b.textContent),
    ).toEqual(["Skip tour", "Next"]);
    await press("Next");
    expect(popover()?.textContent).toContain("Projects and chats");
    expect(popover()?.textContent).toContain("2 of 3");
    await press("Back");
    expect(popover()?.textContent).toContain("Ask your agent");
    await press("Next");
    await press("Next");
    // Board isn't on screen; its stop points at Activity instead.
    expect(popover()?.textContent).toContain("Board and Activity");
    expect(popover()?.textContent).toContain("3 of 3");
    await press("Done");
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("puts a spotlight around the element and the popover beside it", async () => {
    anchor("composer");
    await render();
    const spotlight = document.querySelector<HTMLElement>(
      ".aven-tour-spotlight",
    )!;
    expect(spotlight.style.width).toBe(`${RECT.width + 12}px`);
    expect(spotlight.style.transform).toBe(
      `translate(${RECT.left - 6}px, ${RECT.top - 6}px)`,
    );
    expect(popover()?.dataset.placed).toBe("true");
  });

  it("covers browser pages with their still image while it runs", async () => {
    anchor("composer");
    await render();
    // The popover is a modal dialog, which the browser presentation
    // replaces native pages for.
    place(popover()!);
    expect(popover()?.getAttribute("aria-modal")).toBe("true");
    expect(
      document
        .querySelector(".aven-tour")
        ?.getAttribute("data-native-browser-occluded"),
    ).toBe("true");
    expect(
      browserOverlayState(
        { x: 0, y: 0, width: 1024, height: 768, scale: 2 },
        true,
      ).capture,
    ).toBe(true);
  });

  it("takes the keyboard: Escape leaves, Enter and arrows move", async () => {
    anchor("composer");
    anchor("projects", { left: 0, top: 40, width: 240, height: 700 });
    await render();
    expect(document.activeElement?.textContent).toBe("Next");
    expect(webview.setFocus).toHaveBeenCalled();
    await key("ArrowRight");
    expect(popover()?.textContent).toContain("Projects and chats");
    await key("ArrowLeft");
    expect(popover()?.textContent).toContain("Ask your agent");
    await key("Enter");
    expect(popover()?.textContent).toContain("Projects and chats");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("Skip tour leaves without finishing", async () => {
    anchor("composer");
    await render();
    await press("Skip tour");
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("opens the side panel for its stop, and puts it back on moving on", async () => {
    anchor("composer");
    anchor("activity", { left: 260, top: 4, width: 80, height: 24 });
    let panel: HTMLElement | null = null;
    const undo = vi.fn(() => {
      panel?.remove();
      panel = null;
    });
    const changes = vi.fn(() => {
      panel = anchor("changes", {
        left: 900,
        top: 40,
        width: 300,
        height: 700,
      });
      return undo;
    });
    await render({ changes });
    expect(popover()?.textContent).toContain("1 of 3");
    expect(changes).not.toHaveBeenCalled();
    await press("Next");
    expect(changes).toHaveBeenCalled();
    expect(popover()?.textContent).toContain("Review and ship");
    expect(popover()?.textContent).toContain("2 of 3");
    await press("Next");
    expect(undo).toHaveBeenCalled();
    expect(popover()?.textContent).toContain("Board and Activity");
  });

  it("skips a stop whose element still isn't there when reached", async () => {
    anchor("composer");
    anchor("activity", { left: 260, top: 4, width: 80, height: 24 });
    // Preparing it opens nothing that can be pointed at.
    await render({ changes: () => undefined });
    expect(popover()?.textContent).toContain("1 of 3");
    await press("Next");
    await settle(400);
    expect(popover()?.textContent).toContain("Board and Activity");
    expect(popover()?.textContent).toContain("2 of 2");
  });

  it("skips anchors that are hidden or off screen, and ends when there is nothing to show", async () => {
    const hidden = anchor("composer");
    hidden.hidden = true;
    anchor("projects", { left: -500, top: 40, width: 240, height: 700 });
    await render();
    expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
    expect(popover()).toBeNull();
  });
});
