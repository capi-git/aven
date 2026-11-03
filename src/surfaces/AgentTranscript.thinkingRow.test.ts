// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text, className }: { text: string; className?: string }) =>
    createElement(
      "div",
      { className: `mock-markdown ${className ?? ""}` },
      text,
    ),
}));

import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const thought = "Check the router first.\n\nThen the loader, which is slower.";
const blocks: Block[] = [
  { id: "user-1", role: "user", text: "Why is it slow?", durationMs: 2_000 },
  { id: "think-1", role: "reasoning", text: thought },
  {
    id: "tool-1",
    role: "tool",
    text: "Read src/router.ts",
    tool: {
      callId: "read_1",
      title: "Read src/router.ts",
      status: "completed",
    },
  },
  { id: "answer-1", role: "assistant", text: "The loader blocks the route." },
];

async function render() {
  await act(async () => {
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: false,
        visible: true,
        harness: "claude",
        model: "claude:opus-5.5",
      }),
    );
  });
}

const thinkingButton = () =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label^="Show thinking"], button[aria-label="Hide thinking"]',
  );

describe("a thought in the work trail", () => {
  it("is titled by its first paragraph closed, and just 'Thinking' once open", async () => {
    await render();
    // The trail is folded under "Show the work", and the thought sits in
    // the step group it led to.
    for (const label of ['"Show the work"', '^"Show the steps"']) {
      const fold = container.querySelector<HTMLButtonElement>(
        `button[aria-label${label.startsWith("^") ? "^=" : "="}${label.replace(/^\^/, "")}]`,
      );
      expect(fold, label).not.toBeNull();
      await act(async () => fold!.click());
    }
    const button = thinkingButton();
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("Check the router first.");
    expect(
      container.querySelector(".mock-markdown.agent-reasoning"),
    ).toBeNull();

    await act(async () => button!.click());
    // Open, the body starts with that same paragraph; the title stops
    // repeating it.
    expect(thinkingButton()!.textContent).toBe("Thinking");
    expect(
      container.querySelector(".mock-markdown.agent-reasoning")?.textContent,
    ).toBe(thought);

    await act(async () => thinkingButton()!.click());
    expect(thinkingButton()!.textContent).toBe("Check the router first.");
  });
});
