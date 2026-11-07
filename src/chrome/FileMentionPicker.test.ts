// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rankProjectFiles } from "../lib/fileIndex";
import type { ProjectFile } from "../lib/fs";
import { FileMentionPicker } from "./FileMentionPicker";

const files: ProjectFile[] = ["App.tsx", "main.tsx", "README.md"].map(
  (name) => ({ name, path: `/repo/src/${name}`, relative: `src/${name}` }),
);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(query: string, active: number) {
  await act(async () =>
    root.render(
      createElement(FileMentionPicker, {
        // With nothing typed, the picker lists recent files.
        files: rankProjectFiles(
          files,
          query,
          files.map((file) => file.path),
        ),
        query,
        active,
        onActive: vi.fn(),
        onPick: vi.fn(),
      }),
    ),
  );
}

it("shows, narrows and goes without adding or removing a wheel listener", async () => {
  // In WebKit each wheel listener added or removed restyles the whole page,
  // and the picker comes and goes, and redraws, as the message is typed.
  const wheelListeners = countWheelListeners();
  const options = () => container.querySelectorAll('[role="option"]');

  await render("", 0);
  expect(options()).toHaveLength(3);
  const list = container.querySelector<HTMLElement>('[role="listbox"]')!;
  // The browser keeps the wheel in the list at either end.
  expect(list.classList.contains("overscroll-none")).toBe(true);
  await render("", 1);
  await render("ma", 0);
  await render("main", 0);
  expect(options()[0]?.textContent).toContain("main.tsx");
  await act(async () => root.unmount());
  expect(container.querySelector("[data-mention-picker]")).toBeNull();
  expect(wheelListeners()).toEqual({ added: 0, removed: 0 });
});

/**
 * Wheel listeners added and removed from now on, on any element, the
 * document or the window. happy-dom's nodes inherit them from its own
 * EventTarget, not the global one, and the window's are bound copies.
 */
function countWheelListeners() {
  const node = Object.getPrototypeOf(Node.prototype) as EventTarget;
  const spies = (method: "addEventListener" | "removeEventListener") => [
    vi.spyOn(node, method),
    vi.spyOn(window, method),
  ];
  const added = spies("addEventListener");
  const removed = spies("removeEventListener");
  const wheel = (list: typeof added) =>
    list.flatMap((spy) => spy.mock.calls).filter(([type]) => type === "wheel")
      .length;
  return () => ({ added: wheel(added), removed: wheel(removed) });
}
