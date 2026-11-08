// @vitest-environment happy-dom
import {
  act,
  createElement,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from "react";
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

const { AgentPanel, agentPanelLayout, useAgentSummary } =
  await import("./AgentPill");
const { CLAUDE_OPUS_5_5_MODEL, modelsFor } = await import("../lib/models");

type HostProps = Omit<
  ComponentProps<typeof AgentPanel>,
  "anchor" | "onDismiss"
> & {
  /** Hands focus back to the message field. */
  onClose?: () => void;
};

/**
 * What opens the agent panel in the message box (its helm's Model row), as
 * far as these tests need: a button that toggles it, named and marked as
 * the panel's summary says, and a dismiss that hands the keyboard back.
 */
function PanelHost({ onClose, ...props }: HostProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const { description, usageWarning } = useAgentSummary(props);
  return createElement(
    "div",
    { ref: anchor },
    createElement(
      "button",
      {
        type: "button",
        "data-agent-pill": "",
        "aria-label": description,
        "aria-expanded": open,
        onMouseDown: (event: MouseEvent) => event.preventDefault(),
        onClick: () => setOpen((shown) => !shown),
      },
      usageWarning?.unseen
        ? createElement("span", { className: "agent-pill-usage" })
        : null,
    ),
    open
      ? createElement(AgentPanel, {
          ...props,
          anchor,
          onDismiss: (restore: boolean) => {
            setOpen(false);
            if (restore) onClose?.();
          },
        })
      : null,
  );
}

let root: Root;
let host: HTMLDivElement;
let composer: HTMLTextAreaElement;
let props: HostProps;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The tab last chosen in a picker; the panel opens on the chat's own.
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
  await act(async () => root.render(createElement(PanelHost, props)));
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
  ].find(
    (item) =>
      // An effort level is a dot, named by its label.
      item.getAttribute("aria-label") === text ||
      item.textContent?.includes(text),
  )!;
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

describe("the agent panel", () => {
  it("mounts only while open", async () => {
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

  it("holds the model list, its settings and access in one panel, and no Race", async () => {
    await render();
    await open();
    expect(
      panel()!.querySelector('[role="listbox"][aria-label="Models"]'),
    ).not.toBeNull();
    expect(section("Effort")).toBeDefined();
    expect(section("Access")).toBeDefined();
    expect(panel()!.querySelector('[aria-label="Fast"]')).not.toBeNull();
    // Race is a mode of the message box, started from its + menu.
    expect(section("Race")).toBeUndefined();
    expect(panel()!.querySelector("[data-race-options]")).toBeNull();
    await act(async () => pill().click());
    props.showAccess = false;
    await render();
    await open();
    expect(section("Access")).toBeUndefined();
  });

  it("changes effort and access in place and stays open", async () => {
    await render();
    await open();
    await act(async () => radio("Effort", "High").click());
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

  it("says when an access change waits for the next message", async () => {
    props.busy = true;
    await render();
    await open();
    expect(section("Access")!.textContent).toContain(
      "Applies from your next message.",
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
});

describe("the panel's model list", () => {
  it("opens on the chat's provider with its model highlighted, whatever tab another chat left", async () => {
    localStorage.setItem("monocode.modelPickerTab", "codex");
    await render();
    await open();
    const tab = panel()!.querySelector('[role="tab"][aria-selected="true"]');
    expect(tab?.getAttribute("title")).toBe("Claude Code");
    const highlighted = [
      ...panel()!.querySelectorAll('[role="listbox"] > div'),
    ].filter((row) => row.getAttribute("data-active") === "true");
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toContain(CLAUDE_OPUS_5_5_MODEL.name);
    expect(
      highlighted[0]
        .querySelector('[role="option"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    // The Reasoning section beside it belongs to the same model.
    expect(section("Effort")).toBeDefined();
  });
});

describe("the panel's layout", () => {
  it("is 540px with two columns wherever the window has room", () => {
    // A 1512-point window at 100%, 80% and 70% interface zoom, in CSS pixels.
    for (const width of [1512, 1890, 2160, 820])
      expect(agentPanelLayout(width, true)).toEqual({
        width: 540,
        stacked: false,
      });
  });

  it("narrows only by the window's edges and stacks only when genuinely narrow", () => {
    expect(agentPanelLayout(500, true)).toEqual({ width: 484, stacked: false });
    expect(agentPanelLayout(478, true)).toEqual({ width: 462, stacked: false });
    expect(agentPanelLayout(477, true)).toEqual({ width: 461, stacked: true });
    expect(agentPanelLayout(444, true)).toEqual({ width: 428, stacked: true });
    // The model list alone never stacks.
    expect(agentPanelLayout(1512, false)).toEqual({
      width: 300,
      stacked: false,
    });
  });

  it("places the panel at that width and marks it stacked only in a narrow window", async () => {
    const innerWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 1890,
      });
      await render();
      await open();
      const frame = () => panel()!.parentElement!;
      expect(frame().style.width).toBe("540px");
      expect(panel()!.hasAttribute("data-stacked")).toBe(false);
      // The window narrows while the panel is open.
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 444,
      });
      await act(async () => window.dispatchEvent(new Event("resize")));
      expect(frame().style.width).toBe("428px");
      expect(panel()!.hasAttribute("data-stacked")).toBe(true);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: innerWidth,
      });
    }
  });

  it("stacks by the pill's decision, never by a container query", async () => {
    // WebKit sizes a container after interface zoom, so a container query
    // stacked a 540px panel in a wide window at 80% zoom.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/chrome/AgentPill.css", "utf8");
    expect(css).not.toMatch(/@container/);
    expect(css).not.toMatch(/container(-type|-name)?\s*:/);
    expect(css).toMatch(/\.agent-panel\[data-stacked\] \.agent-panel-body/);
  });
});
