// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/harness/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/availability")>()),
  probeHarnessAvailability: vi.fn(async () => {}),
  isHarnessAvailable: () => true,
}));
vi.mock("../lib/harness/registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness/registry")>()),
  refreshHarnessCatalogs: vi.fn(async () => {}),
}));

const { AgentPill } = await import("./AgentPill");
const { CLAUDE_OPUS_5_5_MODEL, modelsFor } = await import("../lib/models");

let root: Root;
let host: HTMLDivElement;
let composer: HTMLTextAreaElement;
let props: ComponentProps<typeof AgentPill>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The model list opens on the provider last chosen.
  const storage = new Map([["monocode.modelPickerTab", "claude"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
    () => {},
  );
  host = document.createElement("div");
  composer = document.createElement("textarea");
  document.body.append(host, composer);
  root = createRoot(host);
  props = {
    harness: "claude",
    model: CLAUDE_OPUS_5_5_MODEL.id,
    modelSettings: { effort: "low", fast: "false" },
    runtimeMode: "supervised",
    showAccess: true,
    busy: false,
    hotkeys: true,
    onModelChange: vi.fn(),
    onModelSettingsChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onClose: vi.fn(() => composer.focus()),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  composer.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(AgentPill, props)));
}
const pill = () => host.querySelector<HTMLButtonElement>("[data-agent-pill]")!;
const panel = () =>
  document.body.querySelector<HTMLElement>("[data-agent-panel]");
const section = (title: string) =>
  [...(panel()?.querySelectorAll<HTMLElement>("section") ?? [])].find(
    (item) => item.querySelector("h3")?.textContent === title,
  );
const radio = (group: string, text: string) =>
  [
    ...panel()!.querySelectorAll<HTMLButtonElement>(
      `[aria-label="${group}"] [role="radio"], [aria-label="${group}"] [role="menuitemradio"]`,
    ),
  ].find((item) => item.textContent?.includes(text))!;
async function open() {
  await act(async () => pill().click());
}
async function keyOnWindow(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

describe("the agent pill", () => {
  it("shows the provider, the model and the effort in short form", async () => {
    props.modelSettings = { effort: "xhigh", fast: "true" };
    await render();
    expect(pill().querySelector("img, svg")).not.toBeNull();
    expect(pill().textContent).toBe(`${CLAUDE_OPUS_5_5_MODEL.name}·X-High`);
    expect(pill().getAttribute("aria-label")).toBe(
      `Claude Code ${CLAUDE_OPUS_5_5_MODEL.name} · X-High · Fast`,
    );
    expect(pill().querySelector(".agent-pill-fast")).not.toBeNull();
  });

  it("marks full access on the pill, and only there", async () => {
    await render();
    expect(pill().querySelector('[data-mode="full-access"]')).toBeNull();
    props.runtimeMode = "full-access";
    await render();
    const marker = pill().querySelector('[data-mode="full-access"]');
    expect(marker?.getAttribute("title")).toBe("Full access");
    expect(pill().getAttribute("aria-label")).toContain("Full access");
    // A provider without access modes never shows it.
    props.showAccess = false;
    await render();
    expect(pill().querySelector('[data-mode="full-access"]')).toBeNull();
  });

  it("mounts its panel only while open", async () => {
    await render();
    expect(panel()).toBeNull();
    expect(document.body.querySelector('[aria-label="Search models"]')).toBe(
      null,
    );
    await open();
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.hasAttribute("data-model-picker")).toBe(true);
    expect(pill().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Search models",
    );
  });

  it("holds the model list, its settings and access in one panel, Race only where offered", async () => {
    await render();
    await open();
    expect(
      panel()!.querySelector('[role="listbox"][aria-label="Models"]'),
    ).not.toBeNull();
    expect(section("Reasoning")).toBeDefined();
    expect(section("Access")).toBeDefined();
    expect(panel()!.querySelector('[aria-label="Fast"]')).not.toBeNull();
    expect(section("Race")).toBeUndefined();
    await act(async () => pill().click());
    props.race = {
      active: false,
      available: [
        { harness: "claude", model: "opus", label: "Claude Code · Opus" },
        { harness: "codex", model: "gpt-5", label: "Codex · GPT-5" },
      ],
      lanes: [
        { harness: "claude", model: "opus", label: "Claude Code · Opus" },
        { harness: "codex", model: "gpt-5", label: "Codex · GPT-5" },
      ],
      onActiveChange: vi.fn(),
    };
    props.showAccess = false;
    await render();
    await open();
    expect(section("Race")).toBeDefined();
    expect(section("Access")).toBeUndefined();
    await act(async () =>
      section("Race")!
        .querySelector<HTMLButtonElement>('[role="switch"]')!
        .click(),
    );
    expect(props.race.onActiveChange).toHaveBeenCalledWith(true);
  });

  it("changes effort and access in place and stays open", async () => {
    await render();
    await open();
    await act(async () => radio("Reasoning", "High").click());
    expect(props.onModelSettingsChange).toHaveBeenCalledExactlyOnceWith({
      effort: "high",
      fast: "false",
    });
    await act(async () => radio("Access mode", "Full access").click());
    expect(props.onRuntimeModeChange).toHaveBeenCalledExactlyOnceWith(
      "full-access",
    );
    expect(panel()).not.toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("says when an access change waits for the next turn", async () => {
    props.busy = true;
    await render();
    await open();
    expect(section("Access")!.textContent).toContain(
      "Applies from the next turn.",
    );
  });

  it("closes and hands focus back to the message after picking a model", async () => {
    const other = modelsFor("claude").find(
      (item) => item.id !== CLAUDE_OPUS_5_5_MODEL.id,
    )!;
    await render();
    await open();
    const row = [
      ...panel()!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ].find((item) => item.textContent?.includes(other.name))!;
    await act(async () => row.click());
    expect(props.onModelChange).toHaveBeenCalledExactlyOnceWith(
      "claude",
      other.id,
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(composer);
  });

  it("closes with Escape and returns focus to the message", async () => {
    await render();
    await open();
    const escape = await keyOnWindow({ key: "Escape" });
    expect(escape.defaultPrevented).toBe(true);
    expect(panel()).toBeNull();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(composer);
  });

  it("closes on an outside click without taking focus", async () => {
    await render();
    await open();
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(panel()).toBeNull();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("opens and closes with Cmd+. and the menu command only when it owns the hotkeys", async () => {
    await render();
    await act(async () => composer.focus());
    const press = () => keyOnWindow({ key: ".", metaKey: true });
    expect((await press()).defaultPrevented).toBe(true);
    expect(panel()).not.toBeNull();
    // The menu command and the key can both arrive for one press.
    await act(async () => window.dispatchEvent(new Event("open_model_picker")));
    expect(panel()).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await press();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(composer);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await act(async () => window.dispatchEvent(new Event("open_model_picker")));
    expect(panel()).not.toBeNull();
    await act(async () => pill().click());

    props.hotkeys = false;
    await render();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await press()).defaultPrevented).toBe(false);
    expect(panel()).toBeNull();
  });
});
