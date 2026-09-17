// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { WorkspaceProfileMenu } from "./WorkspaceProfileMenu";

const profiles: readonly WorkspaceProfile[] = [
  { id: "personal", name: "Personal", icon: "home" },
  { id: "work", name: "Work", icon: "briefcase" },
  { id: "other", name: "Other projects", icon: "folder" },
];

describe("workspace profile menu", () => {
  let root: Root;
  let container: HTMLDivElement;
  let sidebar: HTMLElement;
  let anchor: HTMLButtonElement;
  let outside: HTMLButtonElement;
  let frameId: number;
  let frames: Map<number, FrameRequestCallback>;
  const select = vi.fn();
  const dismiss = vi.fn();

  function Harness({ activeProfileId = "work" }: { activeProfileId?: string }) {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(WorkspaceProfileMenu, {
          profiles,
          activeProfileId,
          anchor,
          onSelect: select,
          onDismiss: () => {
            dismiss();
            setOpen(false);
          },
        })
      : null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    frameId = 0;
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    container = document.createElement("div");
    sidebar = document.createElement("aside");
    anchor = document.createElement("button");
    outside = document.createElement("button");
    sidebar.append(anchor);
    document.body.append(sidebar, container, outside);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    sidebar.remove();
    outside.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(activeProfileId = "work") {
    await act(async () =>
      root.render(createElement(Harness, { activeProfileId })),
    );
  }

  function menu() {
    return document.querySelector<HTMLDivElement>('[role="menu"]');
  }

  function choices() {
    return [
      ...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ];
  }

  async function paint() {
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => callbacks.forEach((callback) => callback(0)));
  }

  async function key(value: string) {
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: value,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  }

  it("shows only workspace choices and focuses the current workspace on open", async () => {
    await render();
    const buttons = choices();
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Personal",
      "Work",
      "Other projects",
    ]);
    expect(
      buttons.map((button) => button.getAttribute("aria-checked")),
    ).toEqual(["false", "true", "false"]);
    expect(document.activeElement).toBe(buttons[1]);
    expect(menu()?.getAttribute("aria-label")).toBe("Switch workspace");
    expect(menu()?.textContent).not.toMatch(
      /customize|appearance|notes|inbox/i,
    );
  });

  it("retries selected focus after the hidden measurement frame becomes visible", async () => {
    const nativeFocus = HTMLElement.prototype.focus;
    let rejectedHiddenFocus = 0;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      const frame = this.closest('[role="menu"]')?.parentElement;
      if (frame?.style.visibility === "hidden") {
        rejectedHiddenFocus++;
        return;
      }
      nativeFocus.call(this, options);
    });
    anchor.focus();
    await render();
    expect(rejectedHiddenFocus).toBe(1);
    expect(document.activeElement).toBe(anchor);
    expect(menu()?.parentElement?.style.visibility).not.toBe("hidden");
    await paint();
    expect(document.activeElement).toBe(choices()[1]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(choices()[2]);
  });

  it("cancels pending focus when the menu closes without stealing outside focus", async () => {
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (
        this.closest('[role="menu"]')?.parentElement?.style.visibility ===
        "hidden"
      ) {
        return;
      }
      nativeFocus.call(this, options);
    });
    anchor.focus();
    await render();
    expect(frames.size).toBe(1);
    await act(async () => {
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      outside.focus();
    });
    expect(menu()).toBeNull();
    expect(frames.size).toBe(0);
    await paint();
    expect(document.activeElement).toBe(outside);
  });

  it("schedules no retry after successful focus that could override Shift-Tab to the trigger", async () => {
    await render();
    expect(document.activeElement).toBe(choices()[1]);
    expect(frames.size).toBe(0);
    await act(async () => anchor.focus());
    expect(menu()).not.toBeNull();
    await paint();
    expect(document.activeElement).toBe(anchor);
  });

  it("does not reclaim focus moved elsewhere before a rejected initial focus can retry", async () => {
    const nativeFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (
        this.closest('[role="menu"]')?.parentElement?.style.visibility ===
        "hidden"
      ) {
        return;
      }
      nativeFocus.call(this, options);
    });
    anchor.focus();
    await render();
    expect(document.activeElement).toBe(anchor);
    await act(async () => outside.focus());
    // The menu never received focus, so its onBlur cannot dismiss it here.
    expect(menu()).not.toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    await paint();
    expect(document.activeElement).toBe(outside);
  });

  it("moves actual focus with arrows, wraps, and supports Home and End without switching", async () => {
    await render();
    const buttons = choices();
    await key("ArrowDown");
    expect(document.activeElement).toBe(buttons[2]);
    await key("ArrowDown");
    expect(document.activeElement).toBe(buttons[0]);
    await key("ArrowUp");
    expect(document.activeElement).toBe(buttons[2]);
    await key("Home");
    expect(document.activeElement).toBe(buttons[0]);
    await key("End");
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons[2].tabIndex).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });

  it("selects a workspace once, closes, and returns focus to its trigger", async () => {
    await render();
    await act(async () => choices()[0].click());
    expect(select).toHaveBeenCalledExactlyOnceWith("personal");
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it.each(["Enter", " "])(
    "leaves %s activation to the native button",
    async (value) => {
      await render();
      const button = choices()[1];
      const event = new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => button.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      // happy-dom does not synthesize the browser's keyboard-generated click.
      // The menu must not select once in keydown and again in that native click.
      expect(select).not.toHaveBeenCalled();
      await act(async () => button.click());
      expect(select).toHaveBeenCalledExactlyOnceWith("work");
    },
  );

  it("closes with Escape and restores focus without changing workspace", async () => {
    await render();
    await key("Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(anchor);
    expect(select).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses an outside click without taking focus back from its destination", async () => {
    await render();
    await act(async () => {
      outside.focus();
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps choice-to-choice focus open and dismisses keyboard focus leaving the menu", async () => {
    await render();
    await act(async () => choices()[0].focus());
    expect(menu()).not.toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    await act(async () => outside.focus());
    expect(menu()).toBeNull();
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(outside);
    expect(select).not.toHaveBeenCalled();
  });

  it("leaves trigger focus to the trigger's own click toggle", async () => {
    await render();
    await act(async () => {
      anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      anchor.focus();
    });
    expect(menu()).not.toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("dismisses when the native window loses focus without refocusing its trigger", async () => {
    await render();
    const focus = vi.spyOn(anchor, "focus");
    await act(async () => window.dispatchEvent(new FocusEvent("blur")));
    expect(menu()).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
  });

  it.each([
    [190, 166],
    [240, 216],
    [320, 224],
    [0, 224],
  ])(
    "fits a %i px sidebar with a %i px menu",
    async (sidebarWidth, expectedWidth) => {
      Object.defineProperty(sidebar, "clientWidth", { value: sidebarWidth });
      await render();
      expect(menu()?.parentElement?.style.width).toBe(`${expectedWidth}px`);
      expect(menu()?.parentElement?.dataset.popoverSide).toBe("bottom");
    },
  );

  it("focuses the first choice when the selected workspace no longer exists", async () => {
    await render("missing");
    expect(document.activeElement).toBe(choices()[0]);
    expect(choices()[0].tabIndex).toBe(0);
  });
});
