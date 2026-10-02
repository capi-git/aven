// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_OPUS_5_5_MODEL,
  resetHarnessModelOverlays,
} from "../lib/models";
import { ModelSettings } from "./ModelSettings";

describe("model setting controls", () => {
  let host: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let outside: HTMLButtonElement;
  let root: Root;
  let onChange: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  const initialValues = { effort: "medium", fast: "false" };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    resetHarnessModelOverlays();
    host = document.createElement("div");
    composer = document.createElement("textarea");
    outside = document.createElement("button");
    document.body.append(host, composer, outside);
    root = createRoot(host);
    onChange = vi.fn();
    onClose = vi.fn(() => composer.focus());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    composer.remove();
    outside.remove();
    resetHarnessModelOverlays();
    vi.unstubAllGlobals();
  });

  async function render(values = initialValues) {
    await act(async () =>
      root.render(
        createElement(ModelSettings, {
          harness: "claude",
          model: CLAUDE_OPUS_5_5_MODEL.id,
          values,
          onChange,
          onClose,
        }),
      ),
    );
  }

  const trigger = () =>
    host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
  const menu = () => document.querySelector<HTMLElement>('[role="listbox"]');

  async function open() {
    await act(async () => {
      trigger().focus();
      trigger().click();
    });
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(menu());
  }

  async function key(value: string) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.activeElement?.dispatchEvent(event));
    return event;
  }

  it("selects the next real reasoning level by keyboard and hands focus back to the composer", async () => {
    await render();
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: Medium");
    await open();
    expect(
      Array.from(menu()!.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra High",
      "Max",
      "Ultracode",
      "Ultrathink",
    ]);
    expect((await key("ArrowDown")).defaultPrevented).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect((await key("Enter")).defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "high",
      fast: "false",
    });
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(composer);
  });

  it("dismisses Escape without committing the highlighted level and restores composer focus", async () => {
    await render();
    await open();
    await key("ArrowDown");
    expect((await key("Escape")).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: Medium");
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(composer);
  });

  it("dismisses an outside pointer without committing or taking focus from its target", async () => {
    await render();
    await open();
    await key("ArrowDown");
    await act(async () => {
      outside.focus();
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(menu()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: Medium");
  });

  it("keeps the trigger element stable after a selected value changes", async () => {
    await render();
    const original = trigger();
    await open();
    await key("ArrowDown");
    await key("Enter");
    await render(onChange.mock.calls[0][0]);
    expect(trigger()).toBe(original);
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: High");
    expect(document.activeElement).toBe(composer);
    await open();
    expect(menu()!.querySelector('[aria-selected="true"]')?.textContent).toBe(
      "High",
    );
  });

  it("toggles Fast in both directions while preserving the other setting and input focus", async () => {
    await render();
    const toggle = host.querySelector<HTMLButtonElement>(
      '[aria-label="Fast"]',
    )!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    composer.focus();
    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      toggle.dispatchEvent(press);
      toggle.click();
    });
    expect(press.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenNthCalledWith(1, {
      effort: "medium",
      fast: "true",
    });
    await render(onChange.mock.calls[0][0]);
    expect(host.querySelector('[aria-label="Fast"]')).toBe(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenNthCalledWith(2, {
      effort: "medium",
      fast: "false",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
  });
});
