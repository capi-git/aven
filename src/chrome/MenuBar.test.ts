// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  isTauri: () => false,
}));
vi.mock("../lib/updater", () => ({ runUpdateFlow: vi.fn() }));

import { TOUR_START_EVENT } from "../lib/tour";
import { MenuBar } from "./MenuBar";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
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

function find(label: string) {
  const found = [
    ...document.querySelectorAll<HTMLElement>("button, [role='menuitem']"),
  ].find((element) => element.textContent?.includes(label));
  expect(found, label).toBeDefined();
  return found!;
}

it("starts the tour from Help › Take the Tour Again", async () => {
  await act(async () =>
    root.render(
      createElement(MenuBar, { onNew: vi.fn(), onToggleSidebar: vi.fn() }),
    ),
  );
  // A lone Alt press shows the menu bar on Windows.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
  });
  await act(async () => find("Help").click());
  const started = vi.fn();
  window.addEventListener(TOUR_START_EVENT, started);
  try {
    await act(async () => find("Take the Tour Again").click());
  } finally {
    window.removeEventListener(TOUR_START_EVENT, started);
  }
  expect(started).toHaveBeenCalledTimes(1);
});
