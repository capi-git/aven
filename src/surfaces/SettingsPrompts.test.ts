// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCustomPrompt, PROMPTS } from "../lib/prompts";
import { PromptsPage } from "./SettingsPrompts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(PromptsPage)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const prompt = PROMPTS[0];

async function openField() {
  const head = [
    ...host.querySelectorAll<HTMLButtonElement>(".settings-prompt-head"),
  ].find((button) => button.textContent?.includes(prompt.label))!;
  await act(async () => head.click());
  return host.querySelector<HTMLTextAreaElement>(".settings-prompt-text")!;
}

async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("keeps a trailing space or newline while typing, through the autosave", async () => {
  const field = await openField();
  await act(async () => field.focus());
  await type(field, "Write it short. ");
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(loadCustomPrompt(prompt.id)).toBe("Write it short.");
  expect(field.value).toBe("Write it short. ");
  await type(field, "Write it short.\n");
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(field.value).toBe("Write it short.\n");
  // An emptied field stays empty while typing, not the default.
  await type(field, "");
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(field.value).toBe("");
  // Leaving the field shows what is saved: here, the default.
  await act(async () => field.blur());
  expect(field.value).toBe(prompt.defaultText);
});

it("shows the saved text once the field is left", async () => {
  const field = await openField();
  await act(async () => field.focus());
  await type(field, "  Be brief.  ");
  await act(async () => field.blur());
  expect(loadCustomPrompt(prompt.id)).toBe("Be brief.");
  expect(field.value).toBe("Be brief.");
});
