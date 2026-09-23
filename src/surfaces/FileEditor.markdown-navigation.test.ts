// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";

vi.mock("../lib/fs", async (original) => ({
  ...(await original<typeof import("../lib/fs")>()),
  readTextFile: vi.fn(async () => "# Notes\nSecond line\nThird line"),
}));
vi.mock("../lib/fileWatch", () => ({ watchFile: () => () => {} }));
vi.mock("./AgentMarkdown", () => ({
  MarkdownPreview: ({ text }: { text: string }) =>
    createElement("article", null, text),
}));
vi.mock("./editorChrome", async (original) => ({
  ...(await original<typeof import("./editorChrome")>()),
  languageForPath: async () => [],
}));

let root: Root;
let host: HTMLDivElement;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const onDirtyChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  frames.clear();
  vi.unstubAllGlobals();
});

function render(
  path: string,
  navigation?: { line: number; column?: number; token: number },
) {
  return act(async () =>
    root.render(
      createElement(FileEditor, {
        path,
        cwd: "/project",
        active: true,
        navigation,
        onDirtyChange,
      }),
    ),
  );
}
const selected = () =>
  host.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
async function animate() {
  await act(async () => {
    for (let round = 0; round < 3; round++) {
      const ready = [...frames.values()];
      frames.clear();
      for (const frame of ready) frame(performance.now());
    }
  });
}

describe("Markdown file navigation", () => {
  it("keeps ordinary Markdown opens in Preview", async () => {
    await render("/project/default-preview.md");
    expect(selected()).toBe("Preview");
  });

  it("shows Source for an explicit location and honors the line and column", async () => {
    await render("/project/explicit-navigation.md", {
      line: 2,
      column: 3,
      token: 1,
    });
    expect(selected()).toBe("Source");
    await animate();
    const view = EditorView.findFromDOM(host.querySelector(".cm-editor")!)!;
    expect(view.state.selection.main.head).toBe(
      view.state.doc.line(2).from + 2,
    );
  });

  it("respects a later Preview choice until a fresh navigation request", async () => {
    const path = "/project/repeated-navigation.md";
    await render(path, { line: 2, token: 1 });
    const preview = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((tab) => tab.textContent === "Preview")!;
    await act(async () => preview.click());
    await render(path, { line: 2, token: 1 });
    expect(selected()).toBe("Preview");
    await render(path, { line: 3, token: 2 });
    expect(selected()).toBe("Source");
  });
});
