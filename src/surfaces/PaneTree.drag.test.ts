// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PaneTree } from "./PaneTree";
import { paneDropFromPoint } from "../lib/paneDrop";
import type { Session } from "../lib/session";
vi.mock("./SessionPane", () => ({
  SessionPane: ({
    session,
    onPaneDragStart,
  }: {
    session: Session;
    onPaneDragStart: () => void;
  }) =>
    createElement(
      "button",
      { "data-session": session.id, onPointerDown: onPaneDragStart },
      session.id,
    ),
}));
vi.mock("./FilePane", () => ({ FilePane: () => null }));
vi.mock("../lib/paneDrop", () => ({
  paneDropFromPoint: vi.fn(),
  useExternalPaneDrop: () => null,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
  vi.clearAllMocks();
});

it.each([
  "pointercancel",
  "Escape",
  "blur",
  "lostpointercapture",
  "hidden",
  "unmount",
  "commit",
])("handles inner pane drag %s without a stray commit", async (reason) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let unmounted = false;
  cleanups.push(() => {
    if (!unmounted) act(() => root.unmount());
    container.remove();
  });
  const session = (id: string) =>
    ({
      id,
      title: id,
      cwd: "/qa",
      harness: "claude",
      model: "test",
      modelSettings: {},
      runtimeMode: "supervised",
      blocks: [],
    }) as Session;
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
  } as unknown as ComponentProps<typeof PaneTree>;
  await act(async () => root.render(createElement(PaneTree, props)));
  const handle =
    container.querySelector<HTMLButtonElement>('[data-session="a"]')!;
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
  vi.mocked(paneDropFromPoint).mockImplementation((x) =>
    x > 100 ? { id: "b", edge: "right" } : null,
  );
  const pointer = (
    target: EventTarget,
    type: string,
    x: number,
    pointerId = 1,
  ) =>
    act(async () =>
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId,
          clientX: x,
          clientY: 20,
        }),
      ),
    );
  await pointer(handle, "pointerdown", 20);
  await pointer(window, "pointermove", 180);
  await pointer(window, "pointerup", 180, 2);
  expect(props.onMovePane).not.toHaveBeenCalled();
  if (reason === "hidden")
    await act(async () =>
      root.render(createElement(PaneTree, { ...props, visible: false })),
    );
  else if (reason === "unmount") {
    await act(async () => root.unmount());
    unmounted = true;
  } else if (reason === "Escape")
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
  else if (reason === "lostpointercapture")
    await act(async () => handle.dispatchEvent(new Event(reason)));
  else if (reason === "blur")
    await act(async () => window.dispatchEvent(new Event(reason)));
  else await pointer(window, reason === "commit" ? "pointerup" : reason, 200);
  if (reason === "commit")
    expect(props.onMovePane).toHaveBeenCalledExactlyOnceWith("a", "b", "right");
  else expect(props.onMovePane).not.toHaveBeenCalled();
  expect(document.documentElement.classList.contains("is-reordering")).toBe(
    false,
  );
  expect(document.body.style.cursor).toBe("");
  await pointer(window, "pointerup", 200);
  expect(props.onMovePane).toHaveBeenCalledTimes(reason === "commit" ? 1 : 0);
});
