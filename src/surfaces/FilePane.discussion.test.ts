// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newDiscussionTab, newEditorPane } from "../lib/layout";
import { newSession, type Session } from "../lib/session";

const seen = vi.hoisted(
  () => [] as { discussionId: string; a?: string; b?: string }[],
);
vi.mock("./DiscussionView", () => ({
  DiscussionView: (props: {
    discussionId: string;
    a?: Session;
    b?: Session;
  }) => {
    seen.push({
      discussionId: props.discussionId,
      a: props.a?.title,
      b: props.b?.title,
    });
    return null;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  isTauri: () => false,
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

import { FilePane } from "./FilePane";

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
  seen.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const noop = () => {};
  props = {
    pane: newEditorPane(
      newDiscussionTab({
        id: "d1",
        topic: "Cache it?",
        a: { sessionId: "a", cwd: "/repo" },
        b: { sessionId: "b" },
      }),
    ),
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

it("hands the page both chats and re-renders only when one of them changes", async () => {
  await render();
  expect(seen.at(-1)).toEqual({ discussionId: "d1", a: "a", b: "b" });
  expect(container.textContent).toContain("Cache it?");
  const count = seen.length;

  // Another chat streams: the page is left alone.
  await render({
    sessions: [props.sessions[0], props.sessions[1], chat("other", "busy")],
  });
  expect(seen.length).toBe(count);

  // One of its chats changes: the page gets the new one.
  await render({
    sessions: [props.sessions[0], chat("b", "b, retitled"), props.sessions[2]],
  });
  expect(seen.at(-1)).toEqual({ discussionId: "d1", a: "a", b: "b, retitled" });
});
