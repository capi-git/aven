// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { registerHarness } from "../lib/harness/registry";
import type { EnhanceResult } from "../lib/enhancePrompt";
import { Composer } from "./Composer";

const enhance = vi.hoisted(() => ({
  resolve: (_result: EnhanceResult) => {},
}));

vi.mock("../lib/enhancePrompt", () => ({
  enhancePrompt: () =>
    new Promise<EnhanceResult>((resolve) => {
      enhance.resolve = resolve;
    }),
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

let root: Root;
let container: HTMLDivElement;
let other: HTMLTextAreaElement;
let props: ComponentProps<typeof Composer>;

const field = () => container.querySelector("textarea")!;
const enhanceButton = () =>
  container.querySelector<HTMLButtonElement>("[data-helm-enhance]")!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  registerHarness(codexAdapter);
  container = document.createElement("div");
  other = document.createElement("textarea");
  document.body.append(container, other);
  root = createRoot(container);
  props = {
    sessionId: "lane",
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    executionCwd: "~",
    hideTopBar: true,
    onFocus: vi.fn(),
    onCwdChange: vi.fn(),
    onModelChange: vi.fn(),
    onRuntimeModeChange: vi.fn(),
    onSubmit: vi.fn(),
  };
  await act(async () => root.render(createElement(Composer, props)));
  await act(async () => {
    field().value = "add a mic";
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  other.remove();
  vi.unstubAllGlobals();
});

it("updates the draft without taking focus when typing moved elsewhere", async () => {
  await act(async () => field().focus());
  await act(async () => enhanceButton().click());
  // The person moves on to another chat's message box and types there.
  other.focus();
  other.value = "elsewhere";
  other.setSelectionRange(4, 4);
  vi.mocked(props.onFocus).mockClear();
  await act(async () =>
    enhance.resolve({ ok: true, text: "add a mic\n\nWith a level meter." }),
  );
  expect(field().value).toBe("add a mic\n\nWith a level meter.");
  expect(document.activeElement).toBe(other);
  expect(other.selectionStart).toBe(4);
  expect(props.onFocus).not.toHaveBeenCalled();
});

it("still replaces the text in place while its own field has focus", async () => {
  // One undoable edit where the browser has one; happy-dom has none.
  const insert = vi.fn(() => false);
  Object.assign(document, { execCommand: insert });
  await act(async () => field().focus());
  await act(async () => enhanceButton().click());
  await act(async () =>
    enhance.resolve({ ok: true, text: "add a mic\n\nWith a level meter." }),
  );
  expect(insert).toHaveBeenCalledWith(
    "insertText",
    false,
    "add a mic\n\nWith a level meter.",
  );
  expect(field().value).toBe("add a mic\n\nWith a level meter.");
  expect(document.activeElement).toBe(field());
  Reflect.deleteProperty(document, "execCommand");
});
