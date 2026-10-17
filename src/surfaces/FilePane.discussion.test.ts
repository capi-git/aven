// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newEditorPane, type FilePaneTab } from "../lib/layout";
import { newSession, type Session } from "../lib/session";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { FilePane } from "./FilePane";

/** A discussion's page tab as an earlier version saved it. */
const page: FilePaneTab = {
  id: "page",
  path: "discussion:d1",
  cwd: "/repo",
  discussion: { discussionId: "d1", a: "a", b: "b", title: "Cache it?" },
};

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FilePane>;

const chat = (id: string, title = id): Session => ({
  ...newSession("claude", "/repo"),
  id,
  title,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  props = {
    pane: newEditorPane(page),
    focused: true,
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    sessions: [chat("a"), chat("b"), chat("other")],
    onFocus: noop,
    onSelectFile: noop,
    onCloseFile: noop,
    onDirtyChange: noop,
    onErrorCountChange: noop,
    onReorderFiles: noop,
    onOpenFile: noop,
    onUpdatePlan: noop,
    onBuildPlan: noop,
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(next: Partial<ComponentProps<typeof FilePane>> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(createElement(FilePane, props)));
  // The page's code loads on first use.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

it("points an earlier version's discussion page to the panel", async () => {
  await render();
  const moved = container.querySelector("[data-discussion-moved='d1']");
  expect(moved?.textContent).toContain(
    "Discussions now open in their own panel.",
  );
  // Without a window that drives discussions there is nothing to open.
  expect(moved?.querySelector("button")).toBeNull();

  const open = vi.fn<(id: string) => void>();
  await render({
    discussion: {
      options: () => ({ candidates: [] }),
      start: () => null,
      open,
    },
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>("[data-discussion-moved='d1'] button")!
      .click(),
  );
  expect(open).toHaveBeenCalledExactlyOnceWith("d1");
});
