// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  CLAUDE_OPUS_5_5_MODEL,
  resetHarnessModelOverlays,
  setHarnessModels,
} from "../lib/models";
import { parseCodexModelList } from "../lib/harness/codexCatalog";
import type { HarnessId } from "../lib/session";
import { ModelSettings } from "./ModelSettings";

describe("model setting controls", () => {
  let host: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let outside: HTMLButtonElement;
  let root: Root;
  let onChange: Mock<(settings: Record<string, string>) => void>;
  let onClose: Mock<() => void>;
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

  async function render(values: Record<string, string> = initialValues) {
    await renderModel("claude", CLAUDE_OPUS_5_5_MODEL.id, values);
  }

  async function renderModel(
    harness: HarnessId,
    model: string,
    values: Record<string, string>,
  ) {
    await act(async () =>
      root.render(
        createElement(ModelSettings, {
          harness,
          model,
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

  it("colors every standard effort level and mounts tiles only for the active row", async () => {
    await render();
    // The old pixel meter is gone from both the trigger and the menu.
    expect(host.querySelector(".model-strength-pixels")).toBeNull();
    expect(trigger().querySelector("svg")).not.toBeNull();
    await open();
    expect(menu()!.querySelector(".model-strength-pixels")).toBeNull();
    const options = Array.from(
      menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    const tones = Object.fromEntries(
      options.map((option) => [
        option.textContent,
        option.getAttribute("data-effort-tone"),
      ]),
    );
    expect(tones).toEqual({
      Low: "low",
      Medium: "medium",
      High: "high",
      "Extra High": "xhigh",
      Max: "max",
      Ultracode: "ultra",
      Ultrathink: "ultra",
    });
    const max = options.find((option) => option.textContent === "Max")!;
    expect(max.classList.contains("model-effort-option")).toBe(true);
    expect(max.querySelector(".model-effort-tiles")).toBeNull();
    expect(menu()!.querySelectorAll(".model-effort-tiles")).toHaveLength(1);
    expect(menu()!.querySelector("[data-effort-active]")?.textContent).toBe(
      "Medium",
    );

    // Keyboard highlight drives the shimmer; it follows the active row only.
    for (let step = 0; step < 3; step += 1) await key("ArrowDown");
    expect(max.hasAttribute("data-effort-active")).toBe(true);
    expect(max.querySelectorAll(".model-effort-tile")).toHaveLength(160);
    const filled = max.querySelectorAll(".model-effort-tile-filled").length;
    expect(filled).toBeGreaterThanOrEqual(96);
    expect(filled).toBeLessThanOrEqual(112);
    expect(
      max.querySelector(".model-effort-tiles")?.getAttribute("aria-hidden"),
    ).toBe("true");
    const high = options.find((option) => option.textContent === "High")!;
    expect(high.classList.contains("model-effort-option")).toBe(true);
    expect(high.querySelector(".model-effort-tile")).toBeNull();
    await key("ArrowDown");
    expect(max.hasAttribute("data-effort-active")).toBe(false);
    expect(max.querySelector(".model-effort-tiles")).toBeNull();
    expect(menu()!.querySelectorAll(".model-effort-tiles")).toHaveLength(1);
    expect(
      options
        .find((option) => option.textContent === "Ultracode")!
        .hasAttribute("data-effort-active"),
    ).toBe(true);
    await key("Enter");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "ultracode",
      fast: "false",
    });
    expect(document.activeElement).toBe(composer);
  });

  it.each([
    ["codex", "reasoningEffort", "xhigh"],
    ["cursor", "effort", "extra-high"],
  ] as const)(
    "colors %s effort choices without changing provider values",
    async (harness, settingId, extraHigh) => {
      const options = [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: extraHigh, label: "Extra High" },
      ];
      const id = `${harness}:effort-colors-test`;
      setHarnessModels(harness, [
        {
          id,
          harness,
          name: "Effort colors test",
          settings: [
            {
              id: settingId,
              label: "Reasoning",
              kind: "select",
              value: "low",
              options,
            },
          ],
        },
      ]);
      const values = { [settingId]: "low", serviceTier: "fast" };
      await renderModel(harness, id, values);
      await open();
      expect(
        Array.from(menu()!.querySelectorAll('[role="option"]')).map((option) =>
          option.getAttribute("data-effort-tone"),
        ),
      ).toEqual(["low", "medium", "high", "xhigh"]);
      for (let step = 0; step < 3; step += 1) await key("ArrowDown");
      expect(menu()!.querySelectorAll(".model-effort-tile")).toHaveLength(160);
      expect(menu()!.querySelector("[data-effort-active]")?.textContent).toBe(
        "Extra High",
      );
      await key("Enter");
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        ...values,
        [settingId]: extraHigh,
      });
      expect(document.querySelector(".model-effort-tiles")).toBeNull();
      expect(document.activeElement).toBe(composer);
    },
  );

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

  it("preserves Grok's descending choices and commits the exact low value without replacing the control", async () => {
    const values = { effort: "high", fast: "false" };
    await renderModel("grok", "grok:grok-4.6", values);
    const original = trigger();
    expect(original.getAttribute("aria-label")).toBe("Reasoning: High");
    await open();
    const options = Array.from(
      menu()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    );
    expect(options.map((option) => option.textContent)).toEqual([
      "Extra High",
      "High",
      "Medium",
      "Low",
    ]);
    const low = options[3];
    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      low.dispatchEvent(press);
      low.click();
    });
    expect(press.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "low",
      fast: "false",
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(composer);
    await renderModel("grok", "grok:grok-4.6", onChange.mock.calls[0][0]);
    expect(trigger()).toBe(original);
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: Low");
    expect(document.activeElement).toBe(composer);
  });

  it("keeps a future Codex reasoning value exact while preserving service tier and focus", async () => {
    const [future] = parseCodexModelList([
      {
        model: "future-provider-model",
        displayName: "Future provider model",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", label: "Low" },
          { reasoningEffort: "adaptive", label: "Adaptive" },
        ],
        additionalSpeedTiers: ["fast"],
      },
    ]);
    setHarnessModels("codex", [future]);
    const values = { reasoningEffort: "low", serviceTier: "fast" };
    await renderModel("codex", future.id, values);
    const original = trigger();
    expect(original.getAttribute("aria-label")).toBe("Reasoning: Low");
    await open();
    expect(
      Array.from(menu()!.querySelectorAll('[role="option"]')).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Low", "Adaptive"]);
    await key("ArrowDown");
    expect(onChange).not.toHaveBeenCalled();
    await key("Enter");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      reasoningEffort: "adaptive",
      serviceTier: "fast",
    });
    expect(menu()).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(composer);
    await renderModel("codex", future.id, onChange.mock.calls[0][0]);
    expect(trigger()).toBe(original);
    expect(trigger().getAttribute("aria-label")).toBe("Reasoning: Adaptive");
    expect(
      host.querySelector('[aria-label="Service Tier: Fast"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(composer);
    await open();
    expect(menu()!.querySelector('[aria-selected="true"]')?.textContent).toBe(
      "Adaptive",
    );
    await key("Escape");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(composer);
  });
});
