// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchPicker } from "./BranchPicker";

const { branchState } = vi.hoisted(() => ({
  branchState: {
    settled: true,
    branches: {
      current: "main",
      detached: false,
      branches: [
        { name: "main", current: true, remote: null },
        { name: "feature", current: false, remote: null },
      ],
    },
  },
}));
vi.mock("../hooks/useProjectBranches", () => ({
  useProjectBranchesState: () => branchState,
}));

let root: Root;
let container: HTMLDivElement;
let anchor: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  anchor = document.createElement("button");
  anchor.textContent = "Footer branch";
  document.body.append(anchor, container);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
    new DOMRect(200, 700, 150, 24),
  );
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  anchor.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const dialog = () =>
  document.querySelector<HTMLElement>('[aria-label="Branch picker"]');

describe("BranchPicker external trigger", () => {
  it("opens immediately at the external button and restores focus on Escape", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(BranchPicker, {
          cwd: "/repo",
          externalAnchor: anchor,
          defaultOpen: true,
          hideTrigger: true,
          onClose,
        }),
      ),
    );
    expect(dialog()).not.toBeNull();
    expect(dialog()?.parentElement?.style.left).toBe("200px");
    expect(container.querySelector("button")).toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Search or create a branch"]'),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(anchor);
  });

  it("keeps external-anchor clicks inside and notifies the owner on outside dismissal", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        createElement(BranchPicker, {
          cwd: "/repo",
          externalAnchor: anchor,
          defaultOpen: true,
          hideTrigger: true,
          onClose,
        }),
      ),
    );
    await act(async () =>
      anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    );
    expect(onClose).not.toHaveBeenCalled();
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("preserves the existing closed trigger and outside-dismiss behavior for composer callers", async () => {
    const onClose = vi.fn();
    await act(async () =>
      root.render(createElement(BranchPicker, { cwd: "/repo", onClose })),
    );
    expect(dialog()).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Branch main"]',
    )!;
    expect(trigger).not.toBeNull();
    await act(async () => trigger.click());
    expect(dialog()).not.toBeNull();
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

it("opens and closes without adding or removing a wheel listener", async () => {
  // In WebKit each wheel listener added or removed restyles the whole page.
  await act(async () =>
    root.render(createElement(BranchPicker, { cwd: "/repo" })),
  );
  const open = () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Branch main"]')!
        .click(),
    );
  const close = () =>
    act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
  // React listens on a portal's container the first time one mounts there.
  await open();
  await close();
  expect(dialog()).toBeNull();

  const wheelListeners = countWheelListeners();
  await open();
  const list = dialog()!.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Branches"]',
  )!;
  expect(list.textContent).toContain("feature");
  // The browser keeps the wheel in the list at either end.
  expect(list.classList.contains("overscroll-none")).toBe(true);
  await close();
  expect(dialog()).toBeNull();
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
