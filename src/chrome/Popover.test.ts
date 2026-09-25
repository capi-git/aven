// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popover, type PopoverDismissReason } from "./Popover";

describe("popover focus leaving the main webview", () => {
  let root: Root;
  let container: HTMLDivElement;
  let anchor: HTMLButtonElement;
  const dismissed = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return open
      ? createElement(
          Popover,
          {
            anchor,
            role: "dialog",
            "aria-label": "Options",
            onDismiss: (reason: PopoverDismissReason) => {
              dismissed(reason);
              setOpen(false);
            },
          },
          createElement("input", { "aria-label": "First field" }),
          createElement("input", { "aria-label": "Second field" }),
        )
      : null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    anchor = document.createElement("button");
    document.body.append(anchor, container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    anchor.remove();
    vi.unstubAllGlobals();
  });

  it("dismisses as outside when the window loses focus", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => window.dispatchEvent(new FocusEvent("blur")));
    expect(dismissed).toHaveBeenCalledExactlyOnceWith("outside");
    expect(document.querySelector('[aria-label="Options"]')).toBeNull();
    expect(document.activeElement).not.toBe(anchor);
  });

  it("keeps the popover open while focus moves between its fields", async () => {
    await act(async () => root.render(createElement(Harness)));
    const first = document.querySelector<HTMLInputElement>(
      '[aria-label="First field"]',
    )!;
    const second = document.querySelector<HTMLInputElement>(
      '[aria-label="Second field"]',
    )!;
    await act(async () => {
      first.focus();
      second.focus();
      first.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    });
    expect(dismissed).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Options"]')).not.toBeNull();
    expect(document.activeElement).toBe(second);
  });

  it("removes the window listener when the popover unmounts", async () => {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => root.render(null));
    window.dispatchEvent(new FocusEvent("blur"));
    expect(dismissed).not.toHaveBeenCalled();
  });
});

describe("popover autofocus", () => {
  let root: Root;
  let anchor: HTMLButtonElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    anchor = document.createElement("button");
    document.body.append(anchor);
    root = createRoot(document.createElement("div"));
    // Like a real browser: focus does nothing while the popover is still
    // hidden for measuring.
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.closest<HTMLElement>('[style*="visibility: hidden"]')) return;
      focus.call(this, options);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    anchor.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("takes focus once it is placed and visible", async () => {
    await act(async () =>
      root.render(
        createElement(
          Popover,
          { anchor, autoFocus: true, tabIndex: -1, "aria-label": "Menu" },
          createElement("button", null, "Item"),
        ),
      ),
    );
    expect(document.activeElement).toBe(
      document.querySelector('[aria-label="Menu"]'),
    );
  });
});
