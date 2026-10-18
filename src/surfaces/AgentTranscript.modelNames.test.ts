// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { resetHarnessModelOverlays, setHarnessModels } from "../lib/models";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  resetHarnessModelOverlays();
  vi.unstubAllGlobals();
});

it("names a finished turn's model once the provider's live list arrives", async () => {
  const blocks: Block[] = [
    {
      id: "ask",
      role: "user",
      text: "Check it",
      startedAt: 1_000,
      durationMs: 4_000,
      turnModel: { harness: "codex", model: "codex:gpt-9-mini" },
    },
    { id: "answer", role: "assistant", text: "Done." },
  ];
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: false,
        harness: "codex",
        model: "codex:gpt-9",
      }),
    ),
  );
  expect(container.textContent).toContain("gpt-9-mini worked for 4s");
  await act(async () =>
    setHarnessModels("codex", [
      { id: "codex:gpt-9", harness: "codex", name: "GPT-9" },
      { id: "codex:gpt-9-mini", harness: "codex", name: "GPT-9 Mini" },
    ]),
  );
  expect(container.textContent).toContain("GPT-9 Mini worked for 4s");
});
