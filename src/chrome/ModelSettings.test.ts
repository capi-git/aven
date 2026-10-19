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
  type ModelSetting,
} from "../lib/models";
import { parseCodexModelList } from "../lib/harness/codexCatalog";
import type { HarnessId } from "../lib/session";
import { ModelSettingsSections, modelSettingsSummary } from "./ModelSettings";

describe("model settings in the agent panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onChange: Mock<(settings: Record<string, string>) => void>;
  const initialValues = { effort: "medium", fast: "false" };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetHarnessModelOverlays();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    onChange = vi.fn();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
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
        createElement(ModelSettingsSections, {
          harness,
          model,
          values,
          onChange,
        }),
      ),
    );
  }

  const group = (label: string) =>
    host.querySelector<HTMLElement>(
      `[role="radiogroup"][aria-label="${label}"]`,
    )!;
  const choices = (label: string) => [
    ...group(label).querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  /** A choice's accessible name: its label, without any hint under it. */
  const nameOf = (item: Element | null | undefined) =>
    item?.getAttribute("aria-label") ?? item?.textContent;
  const choice = (label: string, text: string) =>
    choices(label).find((item) => nameOf(item) === text)!;
  const checked = (label: string) =>
    nameOf(group(label).querySelector('[aria-checked="true"]'));

  async function key(value: string) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.activeElement?.dispatchEvent(event));
    return event;
  }

  it("lists reasoning levels in order, with one tab stop on the current level", async () => {
    await render();
    expect(choices("Effort").map(nameOf)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra High",
      "Max",
      "Ultracode",
      "Ultrathink",
    ]);
    expect(checked("Effort")).toBe("Medium");
    expect(
      choices("Effort").map((item) => item.getAttribute("tabindex")),
    ).toEqual(["-1", "0", "-1", "-1", "-1", "-1", "-1"]);
  });

  it("moves through levels with the arrow keys and commits only on Enter or click", async () => {
    await render();
    await act(async () => choice("Effort", "Medium").focus());
    expect((await key("ArrowDown")).defaultPrevented).toBe(true);
    expect(nameOf(document.activeElement)).toBe("High");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "high",
      fast: "false",
    });
    await key("Home");
    expect(nameOf(document.activeElement)).toBe("Low");
    await key("ArrowUp");
    expect(nameOf(document.activeElement)).toBe("Ultrathink");
  });

  it("says under the quick and the slow levels what they cost, without choosing for you", async () => {
    await render();
    const hints = Object.fromEntries(
      choices("Effort").map((option) => [
        nameOf(option),
        option.querySelector(".agent-choice-hint")?.textContent ?? null,
      ]),
    );
    expect(hints).toEqual({
      Low: "Quickest replies. Good for small, clear changes.",
      Medium: null,
      High: null,
      "Extra High": "Very thorough. Noticeably slower.",
      Max: "Most thorough. Often several times slower.",
      Ultracode: null,
      Ultrathink: null,
    });
    // Screen readers hear the level's name, then the hint as its description.
    const max = choice("Effort", "Max");
    const hint = max.querySelector(".agent-choice-hint")!;
    expect(max.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.id).not.toBe("");
    expect(choice("Effort", "Medium").hasAttribute("aria-describedby")).toBe(
      false,
    );
    // The level stays the one the chat has.
    expect(checked("Effort")).toBe("Medium");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => max.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "max",
      fast: "false",
    });
  });

  it("colors every standard effort level and mounts tiles only for the active row", async () => {
    await render();
    const tones = Object.fromEntries(
      choices("Effort").map((option) => [
        nameOf(option),
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
    // Nothing ripples until a row is pointed at or focused.
    expect(host.querySelector(".model-effort-tiles")).toBeNull();
    const max = choice("Effort", "Max");
    await act(async () =>
      max.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    );
    expect(max.hasAttribute("data-effort-active")).toBe(true);
    expect(max.querySelectorAll(".model-effort-tile")).toHaveLength(160);
    const filled = max.querySelectorAll(".model-effort-tile-filled").length;
    expect(filled).toBeGreaterThanOrEqual(96);
    expect(filled).toBeLessThanOrEqual(112);
    expect(
      max.querySelector(".model-effort-tiles")?.getAttribute("aria-hidden"),
    ).toBe("true");
    await act(async () => max.focus());
    await key("ArrowDown");
    expect(max.hasAttribute("data-effort-active")).toBe(false);
    expect(max.querySelector(".model-effort-tiles")).toBeNull();
    expect(host.querySelectorAll(".model-effort-tiles")).toHaveLength(1);
    expect(
      choice("Effort", "Ultracode").hasAttribute("data-effort-active"),
    ).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
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
              label: "Effort",
              kind: "select",
              value: "low",
              options,
            },
          ],
        },
      ]);
      const values = { [settingId]: "low", serviceTier: "fast" };
      await renderModel(harness, id, values);
      expect(
        choices("Effort").map((option) =>
          option.getAttribute("data-effort-tone"),
        ),
      ).toEqual(["low", "medium", "high", "xhigh"]);
      await act(async () => choice("Effort", "Extra High").click());
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        ...values,
        [settingId]: extraHigh,
      });
    },
  );

  it("switches Fast in both directions while preserving the other setting", async () => {
    await render();
    const toggle = host.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Fast"]',
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenNthCalledWith(1, {
      effort: "medium",
      fast: "true",
    });
    await render(onChange.mock.calls[0][0]);
    expect(host.querySelector('[aria-label="Fast"]')).toBe(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle.click());
    expect(onChange).toHaveBeenNthCalledWith(2, {
      effort: "medium",
      fast: "false",
    });
  });

  it("preserves Grok's descending choices and commits the exact low value", async () => {
    const values = { effort: "high", fast: "false" };
    await renderModel("grok", "grok:grok-4.6", values);
    expect(choices("Effort").map(nameOf)).toEqual([
      "Extra High",
      "High",
      "Medium",
      "Low",
    ]);
    const original = choice("Effort", "Low");
    await act(async () => original.click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      effort: "low",
      fast: "false",
    });
    await renderModel("grok", "grok:grok-4.6", onChange.mock.calls[0][0]);
    expect(choice("Effort", "Low")).toBe(original);
    expect(checked("Effort")).toBe("Low");
  });

  it("keeps a future Codex reasoning value exact and offers the service tier as a choice", async () => {
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
    expect(choices("Effort").map(nameOf)).toEqual(["Low", "Adaptive"]);
    expect(choices("Service Tier").map(nameOf)).toEqual(["Standard", "Fast"]);
    expect(checked("Service Tier")).toBe("Fast");
    await act(async () => choice("Effort", "Adaptive").click());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      reasoningEffort: "adaptive",
      serviceTier: "fast",
    });
    await renderModel("codex", future.id, onChange.mock.calls[0][0]);
    expect(checked("Effort")).toBe("Adaptive");
    await act(async () => choice("Service Tier", "Standard").click());
    expect(onChange).toHaveBeenLastCalledWith({
      reasoningEffort: "adaptive",
      serviceTier: "default",
    });
  });

  it("renders nothing for a model without settings", async () => {
    await renderModel("claude", "claude:sonnet-5", {});
    expect(host.innerHTML).toBe("");
  });
});

describe("the pill's summary of model settings", () => {
  const effort = (options: string[]): ModelSetting => ({
    id: "effort",
    label: "Effort",
    kind: "select",
    value: options[0].toLowerCase(),
    options: options.map((option) => ({
      value: option.toLowerCase().replace(" ", ""),
      label: option,
    })),
  });
  const toggle = (id: string, label: string): ModelSetting => ({
    id,
    label,
    kind: "toggle",
    value: "false",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  });

  it("names the effort in short form and notices fast modes", () => {
    const settings = [effort(["Low", "Extra High"]), toggle("fast", "Fast")];
    expect(modelSettingsSummary(settings, {})).toEqual({
      effort: "Low",
      fast: false,
    });
    expect(
      modelSettingsSummary(settings, { effort: "extrahigh", fast: "true" }),
    ).toEqual({ effort: "X-High", fast: true });
    // A value the catalog does not list is shown as it is.
    expect(modelSettingsSummary(settings, { effort: "turbo" }).effort).toBe(
      "turbo",
    );
  });

  it("reads Codex's service tier and on/off thinking", () => {
    const tier: ModelSetting = {
      id: "serviceTier",
      label: "Service Tier",
      kind: "select",
      value: "default",
      options: [
        { value: "default", label: "Standard" },
        { value: "fast", label: "Fast" },
      ],
    };
    expect(modelSettingsSummary([tier], { serviceTier: "fast" })).toEqual({
      effort: null,
      fast: true,
    });
    expect(
      modelSettingsSummary([toggle("thinking", "Thinking")], {
        thinking: "true",
      }),
    ).toEqual({ effort: "Thinking", fast: false });
  });

  it("leaves out thinking that is switched off", () => {
    const thinking: ModelSetting = {
      id: "thinking",
      label: "Thinking",
      kind: "select",
      value: "off",
      options: [
        { value: "off", label: "Off" },
        { value: "high", label: "High" },
      ],
    };
    expect(modelSettingsSummary([thinking], {}).effort).toBeNull();
    expect(modelSettingsSummary([thinking], { thinking: "high" }).effort).toBe(
      "High",
    );
  });
});
