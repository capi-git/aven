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
import { AgentTranscript } from "./AgentTranscript";

// The reported chat: a non-Git project whose agent wrote `llms.txt` two
// folders down, then named it bare in its reply.
const CWD = "/Users/me/Developer/ClippedIn Website";
const LLMS = `${CWD}/ClippedIn Website/design-review/ai-discoverability/llms.txt`;
const LATER = `${CWD}/public/llms.txt`;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const turn = (id: string, path: string, reply: string): Block[] => [
  { id: `${id}-ask`, role: "user", text: "Add an llms.txt", startedAt: 1_000 },
  {
    id: `${id}-write`,
    role: "tool",
    text: "Write",
    tool: {
      kind: "edit",
      status: "completed",
      preview: { kind: "write", path },
    },
  },
  { id: `${id}-reply`, role: "assistant", text: reply },
];

const references = () =>
  [...container.querySelectorAll<HTMLElement>('code[role="link"]')].filter(
    (code) => code.textContent === "llms.txt",
  );

it("opens the file each reply's turn wrote, not one joined onto the project folder", async () => {
  const onOpenFile = vi.fn();
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks: [
          ...turn("first", LLMS, "Created `llms.txt` for AI crawlers."),
          ...turn("second", LATER, "Copied `llms.txt` to the site."),
        ],
        cwd: CWD,
        onOpenFile,
      }),
    ),
  );

  const [first, second] = references();
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  await act(async () => first!.click());
  expect(onOpenFile).toHaveBeenLastCalledWith(LLMS, undefined);
  await act(async () => second!.click());
  expect(onOpenFile).toHaveBeenLastCalledWith(LATER, undefined);
  expect(onOpenFile).not.toHaveBeenCalledWith(`${CWD}/llms.txt`, undefined);
});
