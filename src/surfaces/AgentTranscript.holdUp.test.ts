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

import type { Block } from "../lib/session";
import type { SessionHoldUp } from "../lib/sessionHoldUp";
import { AgentTranscript } from "./AgentTranscript";

const NOW = 30 * 60_000;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const blocks: Block[] = [
  { id: "ask", role: "user", text: "Check it", startedAt: NOW - 20 * 60_000 },
  {
    id: "answer",
    role: "assistant",
    text: "Three helpers are on it.",
    streaming: true,
  },
];

async function render(holdUps?: readonly SessionHoldUp[]) {
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: true,
        visible: true,
        harness: "claude",
        model: "claude:sonnet-5",
        holdUps,
      }),
    ),
  );
}

it("names what the live turn waits on in place of its clock", async () => {
  await render();
  expect(container.textContent).toContain("Working for 20m");
  await render([{ kind: "helpers", count: 3, since: NOW - 19 * 60_000 }]);
  expect(container.textContent).toContain("Waiting on 3 helper agents · 19m");
  expect(container.textContent).not.toContain("Working for");
});

it("keeps the clock while a hold-up is too new to name", async () => {
  await render([{ kind: "command", since: NOW - 2_000, command: "npm test" }]);
  expect(container.textContent).toContain("Working for 20m");
});
