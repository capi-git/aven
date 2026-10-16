// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DiscussionHost } from "../lib/discussions";
import type { Session } from "../lib/session";

const received = vi.hoisted(() => [] as unknown[]);
vi.mock("./SessionPane", () => ({
  SessionPane: (props: { discussion?: unknown }) => {
    received.push(props.discussion);
    return null;
  },
}));
vi.mock("./FilePane", () => ({ FilePane: () => null }));
vi.mock("../lib/paneDrop", () => ({
  paneDropFromPoint: vi.fn(),
  useExternalPaneDrop: () => null,
}));

import { PaneTree } from "./PaneTree";

// Without the host, the composer has no Discuss mode and no discussion bar.
it("hands discussions to every chat pane so the composer can start one", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const discussion: DiscussionHost = {
    options: () => ({ candidates: [] }),
    start: () => null,
  };
  const session = (id: string): Session => ({
    id,
    title: id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/qa",
    blocks: [],
  });
  const props = {
    visible: true,
    layout: {
      type: "split",
      id: "split",
      dir: "right",
      sizes: [0.5, 0.5],
      children: [
        { type: "leaf", id: "a" },
        { type: "leaf", id: "b" },
      ],
    },
    sessions: [session("a"), session("b")],
    editorPanes: [],
    dirtyFileIds: new Set(),
    fileErrorCounts: new Map(),
    focusedId: "a",
    composerFocused: false,
    recents: [],
    onFocus: vi.fn(),
    onMovePane: vi.fn(),
    onRatio: vi.fn(),
    discussion,
  } as unknown as ComponentProps<typeof PaneTree>;
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(PaneTree, props)));
  expect(received.length).toBeGreaterThanOrEqual(2);
  expect(received.every((value) => value === discussion)).toBe(true);
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
