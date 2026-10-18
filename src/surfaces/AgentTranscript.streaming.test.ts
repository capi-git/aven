// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../lib/session";

const receipts = vi.hoisted(() => ({ count: 0 }));

vi.mock("./AgentMarkdown", () => ({
  AgentMarkdown: ({ text }: { text: string }) =>
    createElement("div", null, text),
}));

// A finished turn's receipt offers a second opinion; count its renders.
vi.mock("../chrome/SecondOpinionButton", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../chrome/SecondOpinionButton")>();
  return {
    ...original,
    SecondOpinionButton: (
      props: Parameters<typeof original.SecondOpinionButton>[0],
    ) => {
      receipts.count += 1;
      return original.SecondOpinionButton(props);
    },
  };
});

import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;
const secondOpinion = () => {};

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
  receipts.count = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const earlier: Block[] = [];
for (let turn = 0; turn < 6; turn += 1) {
  earlier.push(
    {
      id: `user-${turn}`,
      role: "user",
      text: `Question ${turn}`,
      durationMs: 4_000,
    },
    { id: `answer-${turn}`, role: "assistant", text: `Answer ${turn}.` },
  );
}
const prompt: Block = {
  id: "user-live",
  role: "user",
  text: "Keep going",
  startedAt: Date.now(),
};

const finishedPrompt: Block = { ...prompt, durationMs: 3_000 };

/**
 * Earlier blocks keep their identity and only the streamed reply changes,
 * unless `copy` is set: then every block is new, so every turn renders.
 */
async function render(
  text: string,
  busy: boolean,
  target = root,
  copy = false,
) {
  const reply: Block = {
    id: "answer-live",
    role: "assistant",
    text,
    streaming: busy,
  };
  const blocks = [...earlier, busy ? prompt : finishedPrompt, reply];
  await act(async () => {
    target.render(
      createElement(AgentTranscript, {
        blocks: copy ? blocks.map((block) => ({ ...block })) : blocks,
        busy,
        harness: "claude",
        model: "claude:opus-5.5",
        onSecondOpinion: secondOpinion,
      }),
    );
  });
}

it("leaves finished turns alone while the last one streams", async () => {
  await render("Working", true);
  const firstPass = receipts.count;
  expect(firstPass).toBeGreaterThan(0);
  receipts.count = 0;
  for (const text of ["Working on", "Working on it", "Working on it now."])
    await render(text, true);
  expect(receipts.count).toBe(0);
  expect(container.textContent).toContain("Working on it now.");
});

it("renders what re-rendering every turn would", async () => {
  const host = document.createElement("div");
  const everyTurn = createRoot(host);
  const steps: [string, boolean][] = [
    ["Working", true],
    ["Working on it", true],
    ["Working on it, done.", false],
  ];
  for (const [text, busy] of steps) {
    await render(text, busy);
    await render(text, busy, everyTurn, true);
    // The two transcripts' generated element ids differ.
    const markup = (element: HTMLElement) =>
      element.innerHTML.replace(/_r_\w+_/g, "id");
    expect(markup(container)).toBe(markup(host));
  }
  await act(async () => everyTurn.unmount());
});
