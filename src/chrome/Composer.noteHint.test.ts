// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHarness } from "../lib/harness/registry";
import { codexAdapter } from "../lib/harness/codexAdapter";
import { queueTurnNote, takeTurnNotes } from "../lib/turnNotes";
import { Composer } from "./Composer";

vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [] }),
}));
vi.mock("../hooks/useTabGroupLogos", () => ({ useTabGroupLogos: () => ({}) }));
vi.mock("./AgentPill", () => ({ AgentPill: () => null }));
vi.mock("./ContextMeter", () => ({ ContextMeter: () => null }));
vi.mock("./ComposerRunner", () => ({ ComposerRunner: () => null }));

describe("the message box while a note waits for the agent", () => {
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

  it("says what the agent will know, until its next turn takes the note", async () => {
    await act(async () => root.render(createElement(Composer, props)));
    const field = () => container.querySelector("textarea")!;
    expect(field().placeholder).toMatch(/^Ask anything/);
    await act(async () =>
      queueTurnNote("lane", {
        kind: "race",
        text: "Your version was kept.",
        hint: "Codex knows which version you kept",
      }),
    );
    expect(field().placeholder).toBe(
      "Codex knows which version you kept. Say what's next…",
    );
    // Another chat's note says nothing here.
    await act(async () =>
      queueTurnNote("other", {
        kind: "race",
        text: "Kept.",
        hint: "Claude knows which version you kept",
      }),
    );
    expect(field().placeholder).toBe(
      "Codex knows which version you kept. Say what's next…",
    );
    await act(async () => {
      takeTurnNotes("lane", "Carry on");
    });
    expect(field().placeholder).toMatch(/^Ask anything/);
  });
});
