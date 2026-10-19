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

const SHOT =
  "/Users/jack/Library/Application Support/com.capi.monocode.personal/turn-shots/s1/1792438599200-preview-login.png";
const SHOWN = "Aven data/turn-shots/s1/1792438599200-preview-login.png";

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
  vi.unstubAllGlobals();
});

async function renderTurn(work: Block, onOpenFile = vi.fn()) {
  const blocks: Block[] = [
    { id: "ask", role: "user", text: "Check the preview", startedAt: 1_000 },
    work,
  ];
  await act(async () =>
    root.render(
      createElement(AgentTranscript, {
        blocks,
        busy: true,
        cwd: "/Users/jack/project",
        onOpenFile,
      }),
    ),
  );
  return onOpenFile;
}

it("shows a picture Aven took as Aven data and opens the real file", async () => {
  const onOpenFile = await renderTurn({
    id: "read",
    role: "tool",
    text: "Read",
    tool: {
      kind: "read",
      status: "in_progress",
      preview: {
        kind: "read",
        path: SHOT,
        fileName: "1792438599200-preview-login.png",
      },
    },
  });

  expect(container.textContent).toContain(`Read${SHOWN}`);
  expect(container.innerHTML).not.toContain("com.capi.monocode.personal");
  const chip = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(SHOWN),
  );
  expect(chip?.title).toBe(SHOWN);

  await act(async () => chip?.click());
  expect(onOpenFile).toHaveBeenCalledWith(SHOT);
});

it("names Aven data in a label the harness wrote itself", async () => {
  const onOpenFile = await renderTurn({
    id: "read",
    role: "tool",
    text: `Read ${SHOT}`,
    tool: { kind: "read", status: "in_progress" },
  });

  expect(container.textContent).toContain(`Read${SHOWN}`);
  expect(container.innerHTML).not.toContain("com.capi.monocode.personal");
  const chip = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(SHOWN),
  );
  await act(async () => chip?.click());
  expect(onOpenFile).toHaveBeenCalledWith(SHOT);
});

it("names Aven data in a free-form progress line", async () => {
  await renderTurn({
    id: "agent",
    role: "tool",
    text: "Reading ~/Library/Application Support/com.capi.monocode.personal/turn-shots/s1/after.png",
    tool: { kind: "other", status: "in_progress" },
  });

  expect(container.textContent).toContain(
    "Reading Aven data/turn-shots/s1/after.png",
  );
  expect(container.innerHTML).not.toContain("com.capi.monocode.personal");
});

it("leaves a project file's path as it is", async () => {
  await renderTurn({
    id: "read",
    role: "tool",
    text: "Read",
    tool: {
      kind: "read",
      status: "in_progress",
      preview: {
        kind: "read",
        path: "/Users/jack/project/src/monocode.ts",
        fileName: "monocode.ts",
      },
    },
  });

  expect(container.textContent).toContain("Readsrc/monocode.ts");
  expect(container.textContent).not.toContain("Aven data");
});
