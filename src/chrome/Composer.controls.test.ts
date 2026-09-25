// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { Composer } from "./Composer";

const picker = vi.hoisted(() => ({ pick: vi.fn() }));
vi.mock("../lib/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/attachments")>()),
  pickAttachments: picker.pick,
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ModelSettings", () => ({ ModelSettings: () => null }));
vi.mock("./AccessPicker", () => ({ AccessPicker: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  registerHarness(codexAdapter);
  picker.pick.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    executionCwd: "/work/site",
    hideTopBar: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(createElement(Composer, props)));
}
const field = () => container.querySelector("textarea")!;
const alertText = () =>
  container.querySelector('[role="alert"]')?.textContent ?? null;

async function type(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  });
}
async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

it("explains why /compact did nothing while a reply is running", async () => {
  props.busy = true;
  props.compactSupported = true;
  props.onCompactContext = vi.fn(() => false);
  await render();
  await type("/compact");
  await press("Enter");
  expect(props.onCompactContext).toHaveBeenCalledOnce();
  expect(field().value).toBe("/compact");
  expect(alertText()).toContain("Wait for the current reply to finish");
  await type("/compac");
  expect(alertText()).toBeNull();
});

it("reports a failed upload instead of failing silently", async () => {
  picker.pick.mockRejectedValue(new Error("dialog failed"));
  await render();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '[aria-label="Add files or choose a mode"]',
      )!
      .click(),
  );
  const upload = [...document.body.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("Upload file"),
  )!;
  await act(async () => upload.click());
  expect(picker.pick).toHaveBeenCalledOnce();
  expect(alertText()).toContain("Couldn't attach these files");
});

it("drops an unfinished new skill when the message field is used again", async () => {
  await render();
  await type("/tidy");
  const newSkill = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes("New skill"),
  )!;
  await act(async () => newSkill.click());
  expect(container.querySelector('[aria-label="Skill name"]')).not.toBeNull();
  await act(async () => field().focus());
  expect(container.querySelector('[aria-label="Skill name"]')).toBeNull();
  // The field works normally again: Enter sends instead of adding a newline.
  await type("Tidy the imports");
  await press("Enter");
  expect(props.onSubmit).toHaveBeenCalledWith(
    "Tidy the imports",
    [],
    expect.anything(),
  );
});
