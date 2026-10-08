// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_ORB_ANSWER_LIMIT,
  findBrowserOrbAnchor,
  sameAnchor,
  trimAnswer,
} from "./browserOrb";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));

function rect(left: number, top: number, width: number, height: number) {
  return new DOMRect(left, top, width, height);
}

function pane(
  box: DOMRect,
  { blank = false, toolbar = 40 }: { blank?: boolean; toolbar?: number } = {},
) {
  const element = document.createElement("section");
  element.className = "browser-pane";
  element.dataset.browserPane = crypto.randomUUID();
  if (blank) element.dataset.blank = "true";
  element.getBoundingClientRect = () => box;
  const bar = document.createElement("form");
  bar.className = "browser-toolbar";
  bar.getBoundingClientRect = () => rect(box.left, box.top, box.width, toolbar);
  element.append(bar);
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("finding the page under the bubble", () => {
  it("uses the page area below the toolbar of the largest loaded pane", () => {
    pane(rect(0, 0, 400, 300));
    pane(rect(420, 10, 900, 700));
    pane(rect(0, 320, 1000, 900), { blank: true });
    expect(findBrowserOrbAnchor()).toEqual({
      x: 420,
      y: 50,
      width: 900,
      height: 660,
      dpr: window.devicePixelRatio || 1,
    });
  });

  it("ignores panes too small to hold the bubble, or hidden by another view", () => {
    pane(rect(0, 0, 200, 500));
    pane(rect(0, 0, 0, 0));
    expect(findBrowserOrbAnchor()).toBeNull();
  });

  it("steps aside while a dialog or menu is open over the page", () => {
    pane(rect(0, 0, 900, 700));
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    // Mounted but not laid out: not covering anything.
    dialog.getBoundingClientRect = () => rect(0, 0, 0, 0);
    expect(findBrowserOrbAnchor()).not.toBeNull();
    // A list elsewhere in the window, like the sidebar, does not count.
    dialog.getBoundingClientRect = () => rect(950, 0, 200, 300);
    expect(findBrowserOrbAnchor()).not.toBeNull();
    dialog.getBoundingClientRect = () => rect(300, 300, 200, 100);
    expect(findBrowserOrbAnchor()).toBeNull();
  });
});

describe("helpers", () => {
  it("compares anchors to the pixel", () => {
    const a = { x: 1, y: 2, width: 300, height: 200, dpr: 2 };
    expect(sameAnchor(a, { ...a, x: 1.2 })).toBe(true);
    expect(sameAnchor(a, { ...a, width: 302 })).toBe(false);
    expect(sameAnchor(a, null)).toBe(false);
    expect(sameAnchor(null, null)).toBe(true);
  });

  it("keeps short answers and cuts long ones at a sentence", () => {
    expect(trimAnswer("  Done.  ")).toBe("Done.");
    const long = "This is a sentence. ".repeat(100);
    const cut = trimAnswer(long);
    expect(cut.length).toBeLessThanOrEqual(BROWSER_ORB_ANSWER_LIMIT + 1);
    expect(cut.endsWith(".…")).toBe(true);
  });
});
