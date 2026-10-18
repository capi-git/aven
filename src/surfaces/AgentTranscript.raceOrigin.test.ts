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

import { raceOriginBlock, saveRace, type RaceRecord } from "../lib/race";
import type { Block } from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";

const record: RaceRecord = {
  id: "r1",
  project: "/work/site",
  root: "/work/site",
  base: "a".repeat(40),
  prompt: "Fix the login loop",
  createdAt: 0,
  uncommitted: false,
  untracked: false,
  state: "running",
  lanes: [0, 1].map((slot) => ({
    sessionId: `l${slot}`,
    harness: slot ? ("codex" as const) : ("claude" as const),
    model: "m",
    label: slot ? "Codex · GPT-5" : "Claude Code · Opus",
    path: `/data/races/r1/${slot}`,
    branch: `aven/race/r1-${slot}`,
  })),
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps your message where you sent the race, followed by its card", async () => {
  const message = raceOriginBlock("r1", "Fix the login loop");
  saveRace({ ...record, origin: { sessionId: "chat", blockId: message.id } });
  const blocks: Block[] = [
    { id: "u1", role: "user", text: "Hello", startedAt: 1, durationMs: 5 },
    { id: "a1", role: "assistant", text: "Hi there." },
    message,
  ];
  await act(async () =>
    root.render(createElement(AgentTranscript, { blocks })),
  );
  const turn = container.querySelector<HTMLElement>('[data-team-origin="r1"]');
  expect(turn).not.toBeNull();
  // Your own message, as you wrote it, then the race's card.
  expect(turn!.querySelector(".personal-user-message")?.textContent).toContain(
    "Fix the login loop",
  );
  expect(turn!.querySelector('[data-race-card="r1"]')).not.toBeNull();
  // The earlier turn is untouched.
  expect(container.textContent).toContain("Hi there.");
});
