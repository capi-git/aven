// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { invalidateProjectFiles } from "../lib/fileIndex";
import { resetStableMentionLabels } from "../lib/fileMentions";
import type { ProjectFile } from "../lib/fs";
import { resetOpenFiles } from "../lib/openFiles";
import { Composer } from "./Composer";

const listing = vi.hoisted(() => ({
  files: [] as ProjectFile[],
  scans: 0,
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => true }),
}));
vi.mock("../lib/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/fs")>()),
  listProjectFiles: vi.fn(async () => {
    listing.scans += 1;
    return listing.files;
  }),
}));
vi.mock("../lib/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notes")>()),
  loadNotes: vi.fn(async () => []),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const app: ProjectFile = {
  name: "App.tsx",
  path: "/work/site/src/App.tsx",
  relative: "src/App.tsx",
};

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Composer>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  registerHarness(codexAdapter);
  invalidateProjectFiles();
  resetOpenFiles();
  resetStableMentionLabels();
  listing.files = [app];
  listing.scans = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  props = {
    enabled: true,
    focused: false,
    harness: "codex",
    model: "gpt-5",
    runtimeMode: "full-access",
    cwd: "/work/site",
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
  resetOpenFiles();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render(patch: Partial<ComponentProps<typeof Composer>> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(Composer, props)));
}
const field = () => container.querySelector("textarea")!;
const options = () =>
  [...container.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (option) => option.textContent ?? "",
  );
async function type(text: string) {
  await act(async () => {
    const el = field();
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keyup", { key: text.slice(-1), bubbles: true }),
    );
  });
}
async function press(key: string) {
  await act(async () => {
    field().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  });
}

describe("@Avos from a chat", () => {
  it("offers Avos first, and a message for it goes to Avos instead of the chat", async () => {
    const send = vi.fn(async () => null as string | null);
    const open = vi.fn();
    await render({ avos: { send, open } });
    await type("@");
    expect(options()[0]).toBe("AvosLooks after this project");
    expect(
      container.querySelector("[data-mention-avos] [data-crew-critter=lead]"),
    ).not.toBeNull();
    await type("@av");
    expect(options()).toEqual(["AvosLooks after this project"]);
    await press("Enter");
    // The @word goes; the box says it writes to Avos.
    expect(field().value).toBe("");
    expect(
      container.querySelector("[data-composer-avos]")?.textContent,
    ).toContain("@Avos");
    await type("Can you look at the pricing table?");
    await press("Enter");
    expect(send).toHaveBeenCalledWith("Can you look at the pricing table?");
    expect(props.onSubmit).not.toHaveBeenCalled();
    // Gone to Avos: the box is free, with one line on where it went.
    expect(field().value).toBe("");
    const sent = container.querySelector("[data-composer-avos-sent]")!;
    expect(sent.textContent).toContain("Sent to Avos.");
    await act(async () =>
      sent.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(open).toHaveBeenCalled();
    // The next message is the chat's again.
    await type("And this one is for you");
    expect(container.querySelector("[data-composer-avos-sent]")).toBeNull();
    await press("Enter");
    expect(props.onSubmit).toHaveBeenCalledWith(
      "And this one is for you",
      [],
      expect.anything(),
    );
  });

  it("keeps your words and says why when Avos couldn't take them", async () => {
    const send = vi.fn(async () => "Avos uses Claude Code." as string | null);
    await render({ avos: { send, open: vi.fn() } });
    await type("@avos");
    await press("Tab");
    await type("Watch the GitHub issues");
    await press("Enter");
    expect(field().value).toBe("Watch the GitHub issues");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Avos uses Claude Code.",
    );
    // Backspace at the start lets go of @Avos.
    await act(async () => field().setSelectionRange(0, 0));
    await press("Backspace");
    expect(container.querySelector("[data-composer-avos]")).toBeNull();
  });

  it("isn't offered without an Avos to hand to", async () => {
    await render();
    await type("@");
    expect(options().some((row) => row.startsWith("Avos"))).toBe(false);
  });
});
