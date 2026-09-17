// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";
import { WorkspaceStage, type WorkspaceStageProps } from "./WorkspaceStage";

const native = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  listen: vi.fn(),
  listenToolbar: vi.fn().mockResolvedValue(() => {}),
  action: vi.fn(),
  snapshot: vi.fn(),
  bounds: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: native.bounds,
  nativeBrowser: native,
}));

describe("workspace divider and native page presentation", () => {
  let root: Root;
  let container: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  let mutations: Array<(records: Partial<MutationRecord>[]) => void>;
  let props: WorkspaceStageProps;
  const bounds = { x: 504, y: 0, width: 496, height: 600, scale: 2 };
  const pointer = (type: string, x: number, y = 300) =>
    new PointerEvent(type, {
      button: 0,
      bubbles: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
    });
  const flushFrames = async () => {
    for (let count = 0; frames.size && count < 6; count++) {
      await act(async () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(0);
      });
    }
    expect(frames.size).toBe(0);
  };
  const stage = () =>
    container.querySelector<HTMLElement>("[data-workspace-stage]")!;
  const divider = () =>
    container.querySelector<HTMLElement>(
      '[aria-label="Resize workspace columns"]',
    )!;
  const notifyDomChange = async () => {
    await act(async () => {
      for (const callback of mutations)
        callback([
          {
            type: "childList",
            addedNodes: [stage()] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
          },
        ]);
    });
    await flushFrames();
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    native.listenToolbar.mockResolvedValue(() => {});
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    for (const name of ["create", "close", "layout", "navigate", "action"])
      native[name as keyof typeof native].mockResolvedValue(undefined);
    native.listen.mockResolvedValue(() => {});
    native.snapshot.mockResolvedValue("data:image/png;base64,c25hcHNob3Q=");
    native.bounds.mockReturnValue(bounds);
    frames = new Map();
    frameId = 0;
    mutations = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: (records: Partial<MutationRecord>[]) => void) {
          mutations.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "setPointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "releasePointerCapture").mockImplementation(
      () => {},
    );
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      new DOMRect(0, 0, 1000, 600),
    ] as unknown as DOMRectList);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      layout: {
        type: "split",
        id: "columns",
        dir: "right",
        children: [
          { type: "leaf", id: "chat" },
          { type: "leaf", id: "page" },
        ],
        sizes: [0.5, 0.5],
      },
      focusedId: "chat",
      visible: true,
      surfaces: [
        { id: "chat", content: createElement("textarea") },
        {
          id: "page",
          content: createElement(BrowserPane, {
            id: "page",
            initialUrl: "https://example.com/",
          }),
        },
      ],
      onFocus: vi.fn(),
      onLayoutChange: vi.fn(),
      dragTarget: null,
      dragging: false,
    };
    await act(async () => root.render(createElement(WorkspaceStage, props)));
    await flushFrames();
    vi.spyOn(stage(), "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1000, 600),
    );
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.layout).toHaveBeenLastCalledWith(
      native.create.mock.calls[0][0],
      bounds,
      true,
    );
    native.layout.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(["release", "cancel"])(
    "keeps the same live page visible from divider grab through drag and %s",
    async (end) => {
      await act(async () =>
        divider().dispatchEvent(pointer("pointerdown", 500)),
      );
      await notifyDomChange();
      expect(stage().dataset.resizing).toBe("true");
      expect(native.snapshot).not.toHaveBeenCalled();
      expect(native.layout).not.toHaveBeenCalled();

      const resized = { ...bounds, x: 704, width: 296 };
      native.bounds.mockReturnValue(resized);
      await act(async () => window.dispatchEvent(pointer("pointermove", 700)));
      await flushFrames();
      expect(native.layout).toHaveBeenLastCalledWith(
        native.create.mock.calls[0][0],
        resized,
        true,
      );
      expect(native.snapshot).not.toHaveBeenCalled();

      await act(async () =>
        window.dispatchEvent(
          pointer(end === "release" ? "pointerup" : "pointercancel", 700),
        ),
      );
      await notifyDomChange();
      expect(stage().dataset.resizing).toBeUndefined();
      expect(native.layout.mock.calls.every((call) => call[2] === true)).toBe(
        true,
      );
      expect(native.create).toHaveBeenCalledOnce();
      expect(native.navigate).not.toHaveBeenCalled();
      expect(native.close).not.toHaveBeenCalled();
      expect(native.snapshot).not.toHaveBeenCalled();
    },
  );

  it("resizes the live vertical browser when WebKit defers animation frames", async () => {
    props.layout = {
      type: "split",
      id: "rows",
      dir: "down",
      children: [
        { type: "leaf", id: "page" },
        { type: "leaf", id: "chat" },
      ],
      sizes: [0.5, 0.5],
    };
    native.bounds.mockReturnValue({ ...bounds, x: 0, width: 1000, height: 296 });
    await act(async () => root.render(createElement(WorkspaceStage, props)));
    await flushFrames();
    native.layout.mockClear();
    const rowDivider = container.querySelector<HTMLElement>(
      '[aria-label="Resize workspace rows"]',
    )!;
    await act(async () =>
      rowDivider.dispatchEvent(pointer("pointerdown", 500, 302)),
    );
    const resized = { ...bounds, x: 0, width: 1000, height: 416 };
    native.bounds.mockReturnValue(resized);
    await act(async () =>
      window.dispatchEvent(pointer("pointermove", 500, 362)),
    );
    await act(async () =>
      window.dispatchEvent(pointer("pointermove", 500, 422)),
    );
    await act(async () => vi.advanceTimersByTime(16));
    expect(native.layout).toHaveBeenCalledExactlyOnceWith(
      native.create.mock.calls[0][0],
      resized,
      true,
    );
    expect(
      container.querySelector<HTMLElement>('[data-workspace-surface="page"]')!
        .style.height,
    ).toBe("calc(70% - 4px)");
    await act(async () =>
      window.dispatchEvent(pointer("pointerup", 500, 422)),
    );
    await flushFrames();
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.close).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();
    expect(native.snapshot).not.toHaveBeenCalled();
    expect(native.layout.mock.calls.every((call) => call[2] === true)).toBe(true);
  });

  it.each([
    [null, null],
    [{ id: "page", edge: "tab", index: 0 }, "Insert tab"],
    [{ id: "page", edge: "tab" }, "Join group"],
    [{ id: "page", edge: "right" }, "Split right"],
  ] as const)(
    "keeps the browser live through a tab drag to %j",
    async (target, label) => {
      await act(async () =>
        root.render(
          createElement(WorkspaceStage, {
            ...props,
            headers: [{ id: "page", content: "Browser tabs" }],
            dragging: true,
            dragTarget: target,
          }),
        ),
      );
      await notifyDomChange();
      expect(
        container.querySelector(".workspace-stage-insert-label")?.textContent ??
          null,
      ).toBe(label);
      await act(async () => root.render(createElement(WorkspaceStage, props)));
      await notifyDomChange();
      expect(native.layout.mock.calls.some((call) => call[2] === false)).toBe(
        false,
      );
      expect(native.snapshot).not.toHaveBeenCalled();
      expect(native.create).toHaveBeenCalledOnce();
      expect(native.navigate).not.toHaveBeenCalled();
      expect(native.close).not.toHaveBeenCalled();
    },
  );
});
