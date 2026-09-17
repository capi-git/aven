// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PaneTree } from "./PaneTree";
import type { Session } from "../lib/session";
vi.mock("./SessionPane", () => ({
  SessionPane: ({ session }: { session: Session }) =>
    createElement("div", { "data-session": session.id }, session.title),
}));
vi.mock("./FilePane", () => ({ FilePane: () => null }));
vi.mock("../lib/paneDrop", () => ({
  paneDropFromPoint: vi.fn(),
  useExternalPaneDrop: () => null,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});
it.each([true, false])(
  "replaces only the detached session view, including hidden panes (visible=%s)",
  async (visible) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
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
    const show = vi.fn(),
      restore = vi.fn();
    const props = {
      visible,
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
      onShowFloatingSession: show,
      onReturnFloatingSession: restore,
    } as unknown as ComponentProps<typeof PaneTree>;
    await act(async () => root.render(createElement(PaneTree, props)));
    const sibling = container.querySelector('[data-session="b"]');
    await act(async () =>
      root.render(
        createElement(PaneTree, { ...props, floatingSessionIds: ["a"] }),
      ),
    );
    expect(container.querySelector('[data-session="a"]')).toBeNull();
    expect(container.querySelector('[data-session="b"]')).toBe(sibling);
    const placeholder = container.querySelector(
      '[aria-label="Session in Picture in Picture"]',
    )!;
    const buttons = placeholder.querySelectorAll("button");
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
    });
    expect(show).toHaveBeenCalledExactlyOnceWith("a");
    expect(restore).toHaveBeenCalledExactlyOnceWith("a");
    await act(async () =>
      root.render(
        createElement(PaneTree, { ...props, floatingSessionIds: [] }),
      ),
    );
    expect(container.querySelector('[data-session="a"]')).not.toBeNull();
    expect(container.querySelector('[data-session="b"]')).toBe(sibling);
  },
);
