// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import type { BriefResult } from "../lib/brief";
import type { DictationEvent } from "../lib/dictation";
import { Composer } from "./Composer";

const native = vi.hoisted(() => ({
  send: (_event: DictationEvent) => {},
  generation: 0,
  start: vi.fn(),
  stop: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  openSettings: vi.fn(async () => undefined),
  tidy: vi.fn(),
}));

vi.mock("../lib/dictation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/dictation")>()),
  canDictate: () => true,
  startNativeDictation: native.start,
  stopNativeDictation: native.stop,
  cancelNativeDictation: native.cancel,
  openDictationSettings: native.openSettings,
}));
vi.mock("../lib/brief", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/brief")>()),
  tidyIntoBrief: native.tidy,
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./AgentPill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./AgentPill")>()),
  AgentPill: () => null,
}));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

const RAMBLE =
  "so um I want a mic in the message box and the words should show as I talk";
const BRIEF =
  "Goal: Add a mic to the message box.\n\nDetails:\n- Words show as I talk.\n\nDone when:\n- I can talk and see my words.";

describe("speaking into the message box", () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: ComponentProps<typeof Composer>;

  const field = () => container.querySelector("textarea")!;
  const mic = () =>
    container.querySelector<HTMLButtonElement>("[data-helm-mic]")!;
  const briefRow = () => container.querySelector("[data-brief-row]");
  const button = (name: string) =>
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
  const click = (target: HTMLElement | undefined) =>
    act(async () => target!.click());
  const hear = (event: DictationEvent) => act(async () => native.send(event));
  const render = () =>
    act(async () => root.render(createElement(Composer, props)));
  const type = (text: string) =>
    act(async () => {
      field().value = text;
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
  /** Press the mic, say `text`, and stop. */
  const say = async (text: string) => {
    await click(mic());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text, final: false });
    await click(mic());
    await hear({ kind: "words", text, final: true });
    await hear({ kind: "end" });
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    native.generation = 0;
    native.start.mockReset();
    native.start.mockImplementation(
      async (onEvent: (event: DictationEvent) => void) => {
        native.send = onEvent;
        return ++native.generation;
      },
    );
    native.stop.mockClear();
    native.cancel.mockClear();
    native.openSettings.mockClear();
    native.tidy.mockReset();
    registerHarness(codexAdapter);
    container = document.createElement("div");
    document.body.append(container);
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
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("puts the words in the box as they're heard", async () => {
    await render();
    expect(mic().getAttribute("aria-label")).toBe("Dictate");
    expect(mic().title).toBe("Dictate (⇧⌘M)");
    await click(mic());
    // On at once, before the Mac has answered.
    expect(mic().getAttribute("aria-pressed")).toBe("true");
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    expect(field().placeholder).toBe("Listening…");
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a", final: false });
    expect(field().value).toBe("Add a");
    await hear({ kind: "words", text: "Add a mic", final: false });
    expect(field().value).toBe("Add a mic");
    // Something to send: Send shows before the mic, so the mic hasn't
    // moved from under the pointer that will stop it.
    const send =
      container.querySelector<HTMLButtonElement>("[data-helm-send]")!;
    expect(send.hidden).toBe(false);
    expect(
      send.compareDocumentPosition(mic()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing to tidy while it listens.
    expect(briefRow()).toBeNull();
    await click(mic());
    expect(native.stop).toHaveBeenCalledWith(1);
    await hear({ kind: "words", text: "Add a mic.", final: true });
    await hear({ kind: "end" });
    expect(field().value).toBe("Add a mic.");
    expect(mic().getAttribute("aria-pressed")).toBe("false");
  });

  it("adds to what was typed, at the end", async () => {
    await render();
    await type("Please");
    await say("make the box bigger");
    expect(field().value).toBe("Please make the box bigger");
  });

  it("tidies what was said into a brief to edit, with the words one press away", async () => {
    let finish: (result: BriefResult) => void = () => {};
    native.tidy.mockImplementation(
      () => new Promise<BriefResult>((resolve) => (finish = resolve)),
    );
    await render();
    await say(RAMBLE);
    expect(briefRow()?.getAttribute("data-brief-row")).toBe("tidy");
    await click(button("Tidy into a brief"));
    expect(native.tidy).toHaveBeenCalledWith(RAMBLE);
    expect(container.textContent).toContain("Tidying into a brief…");
    // The brief will replace these words, so they can't change meanwhile.
    expect(field().readOnly).toBe(true);
    await act(async () =>
      finish({ ok: true, brief: BRIEF, model: "Claude Haiku 4.5" }),
    );
    expect(field().value).toBe(BRIEF);
    expect(field().readOnly).toBe(false);

    // Edit the brief, go back to the words, and return to the edited brief.
    const edited = `${BRIEF}\n- And a shortcut.`;
    await type(edited);
    await click(button("Back to my words"));
    expect(field().value).toBe(RAMBLE);
    await click(button("Use the brief"));
    expect(field().value).toBe(edited);
  });

  it("offers to tidy again once the words change", async () => {
    native.tidy.mockResolvedValue({ ok: true, brief: BRIEF, model: "Haiku" });
    await render();
    await say(RAMBLE);
    await click(button("Tidy into a brief"));
    await click(button("Back to my words"));
    await type(`${RAMBLE} and a shortcut`);
    expect(briefRow()?.getAttribute("data-brief-row")).toBe("tidy");
  });

  it("says why it couldn't tidy, and keeps the words", async () => {
    native.tidy.mockResolvedValue({
      ok: false,
      error: "Tidying needs Claude Code or Codex.",
    });
    await render();
    await say(RAMBLE);
    await click(button("Tidy into a brief"));
    expect(field().value).toBe(RAMBLE);
    expect(container.textContent).toContain(
      "Tidying needs Claude Code or Codex.",
    );
  });

  it("offers no tidying for a few words or for typing", async () => {
    await render();
    await say("Fix the build");
    expect(briefRow()).toBeNull();
    await type("");
    await type(RAMBLE);
    expect(briefRow()).toBeNull();
  });

  it("lets go of the mic when typing starts, keeping every word", async () => {
    await render();
    await click(mic());
    await hear({ kind: "listening" });
    await hear({ kind: "words", text: "Add a mic", final: false });
    await type("Add a mic!");
    expect(native.cancel).toHaveBeenCalledWith(1);
    expect(mic().getAttribute("aria-pressed")).toBe("false");
    await hear({ kind: "words", text: "Add a mic button", final: true });
    expect(field().value).toBe("Add a mic!");
  });

  it("sends what's in the box, and forgets the brief", async () => {
    native.tidy.mockResolvedValue({ ok: true, brief: BRIEF, model: "Haiku" });
    await render();
    await say(RAMBLE);
    await click(button("Tidy into a brief"));
    await act(async () => {
      field().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(props.onSubmit).toHaveBeenCalledWith(
      BRIEF,
      expect.anything(),
      expect.anything(),
    );
    expect(briefRow()).toBeNull();
  });

  it("starts and stops with ⇧⌘M in the focused pane", async () => {
    const press = () =>
      act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "m",
            code: "KeyM",
            metaKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
      });
    await render();
    await press();
    expect(native.start).not.toHaveBeenCalled();
    props = { ...props, focused: true };
    await render();
    await press();
    expect(native.start).toHaveBeenCalledTimes(1);
    await hear({ kind: "listening" });
    await press();
    expect(native.stop).toHaveBeenCalledWith(1);
  });

  it("stops listening on Escape", async () => {
    await render();
    await click(mic());
    await hear({ kind: "listening" });
    await act(async () => {
      field().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(native.stop).toHaveBeenCalledWith(1);
  });

  it("explains a refusal and opens the setting that fixes it", async () => {
    await render();
    await click(mic());
    await hear({ kind: "error", code: "microphone-denied", message: "" });
    await hear({ kind: "end" });
    expect(
      container.querySelector("[data-dictation-problem]")?.textContent,
    ).toContain("Aven isn't allowed to use the microphone.");
    await click(button("Open System Settings"));
    expect(native.openSettings).toHaveBeenCalledWith("microphone");
    await click(
      container.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!,
    );
    expect(container.querySelector("[data-dictation-problem]")).toBeNull();
  });
});
