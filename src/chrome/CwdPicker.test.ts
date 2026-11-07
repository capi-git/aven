// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CwdPicker } from "./CwdPicker";

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
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("takes the keyboard when opened with the mouse, so Enter picks a project", async () => {
  const onCwdChange = vi.fn();
  const onClose = vi.fn();
  await act(async () =>
    root.render(
      createElement(CwdPicker, {
        cwd: "/work/site",
        recents: [
          { path: "/work/site", openedAt: 3 },
          { path: "/work/api", openedAt: 2 },
          { path: "/work/docs", openedAt: 1 },
        ],
        onCwdChange,
        onClose,
      }),
    ),
  );
  const trigger = container.querySelector("button")!;
  await act(async () => {
    trigger.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    trigger.click();
  });
  const menu = document.body.querySelector<HTMLElement>("[data-cwd-picker]")!;
  expect(menu.contains(document.activeElement)).toBe(true);
  const key = (name: string) =>
    act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  await key("ArrowDown");
  await key("Enter");
  expect(onCwdChange).toHaveBeenCalledWith("/work/docs");
  expect(onClose).toHaveBeenCalled();
});

it("opens and closes without adding or removing a wheel listener", async () => {
  // In WebKit each wheel listener added or removed restyles the whole page.
  await act(async () =>
    root.render(
      createElement(CwdPicker, {
        cwd: "/work/site",
        recents: [
          { path: "/work/site", openedAt: 3 },
          { path: "/work/api", openedAt: 2 },
          { path: "/work/docs", openedAt: 1 },
        ],
        onCwdChange: vi.fn(),
      }),
    ),
  );
  const menu = () =>
    document.body.querySelector<HTMLElement>("[data-cwd-picker]");
  const open = () =>
    act(async () => container.querySelector("button")!.click());
  const close = () =>
    act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
  // React listens on a portal's container the first time one mounts there.
  await open();
  await close();
  expect(menu()).toBeNull();

  const wheelListeners = countWheelListeners();
  await open();
  expect(menu()?.textContent).toContain("docs");
  // The browser keeps the wheel in the list at either end.
  expect(menu()?.querySelector(".overscroll-none")).not.toBeNull();
  await close();
  expect(menu()).toBeNull();
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
