// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPane } from "./BrowserPane";
import type { BrowserState } from "../lib/browser";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABLAAAAPo";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  action: vi.fn(),
  edit: vi.fn(),
  listen: vi.fn(),
  listenEditing: vi.fn(),
  listenToolbar: vi.fn(),
  listenOpenTab: vi.fn(),
  snapshot: vi.fn(),
  capture: vi.fn(),
  attach: vi.fn(),
  shellFocus: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../lib/platform", async (original) => ({
  ...(await original<typeof import("../lib/platform")>()),
  IS_MAC: true,
  IS_WIN: false,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setFocus: mocks.shellFocus }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: () => ({ x: 100, y: 80, width: 600, height: 500, scale: 2 }),
  browserMarkupAttachment: mocks.attach,
  nativeBrowser: {
    create: mocks.create,
    close: mocks.close,
    layout: mocks.layout,
    navigate: mocks.navigate,
    action: mocks.action,
    edit: mocks.edit,
    listen: mocks.listen,
    listenEditing: mocks.listenEditing,
    listenToolbar: mocks.listenToolbar,
    listenOpenTab: mocks.listenOpenTab,
    snapshot: mocks.snapshot,
    capture: mocks.capture,
  },
}));

describe("marking up a browser page", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: Map<number, FrameRequestCallback>;

  const settle = async () => {
    await act(async () => {
      for (let count = 0; count < 20; count += 1) await Promise.resolve();
    });
  };
  const flushFrame = async () => {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
    await settle();
  };
  const open = async (props: Partial<Parameters<typeof BrowserPane>[0]>) => {
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "page",
          initialUrl: "localhost:5180",
          ...props,
        }),
      ),
    );
    await flushFrame();
    return mocks.create.mock.calls.at(-1)![0] as string;
  };
  const receive = async (id: string, state: Partial<BrowserState> = {}) =>
    act(async () =>
      mocks.listen.mock.calls.at(-1)![0]({
        id,
        url: "http://localhost:5180/",
        title: "Tip calculator",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        error: null,
        notice: null,
        ...state,
      }),
    );
  const button = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Mark up page"]');
  const toolbar = () =>
    container.querySelector('[role="toolbar"][aria-label="Mark up tools"]');
  /** Press Mark up and let the capture, freeze and paint finish. */
  const markUp = async () => {
    await act(async () => button()!.click());
    await settle();
    await flushFrame();
  };
  /** Drag on the picture with the current tool (a click when it stays put). */
  const draw = async (x1: number, y1: number, x2: number, y2: number) => {
    const ink = container.querySelector("svg.browser-markup-ink")!;
    const pointer = (type: string, x: number, y: number) =>
      act(async () => {
        ink.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: x,
            clientY: y,
          }),
        );
      });
    await pointer("pointerdown", x1, y1);
    if (x1 !== x2 || y1 !== y2) await pointer("pointermove", x2, y2);
    await pointer("pointerup", x2, y2);
  };
  const press = async (target: Element, key: string) =>
    act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.create.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.layout.mockResolvedValue(undefined);
    mocks.navigate.mockResolvedValue(undefined);
    mocks.action.mockResolvedValue(undefined);
    mocks.edit.mockResolvedValue(undefined);
    mocks.listen.mockResolvedValue(() => {});
    mocks.listenEditing.mockResolvedValue(() => {});
    mocks.listenToolbar.mockResolvedValue(() => {});
    mocks.listenOpenTab.mockResolvedValue(() => {});
    mocks.snapshot.mockResolvedValue("data:image/jpeg;base64,bG9zc3k=");
    mocks.capture.mockResolvedValue({
      dataUrl: PNG,
      width: 1200,
      height: 1000,
    });
    mocks.shellFocus.mockResolvedValue(undefined);
    mocks.attach.mockImplementation(async (image: { dataUrl: string }) => ({
      id: "marked-up",
      name: "Marked-up page.png",
      mimeType: "image/png",
      kind: "image",
      size: 12,
      data: image.dataUrl.slice("data:image/png;base64,".length),
      path: "/tmp/Marked-up page.png",
    }));
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue(undefined);
    frames = new Map();
    let frame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frame, callback);
      return frame;
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
        observe() {}
        disconnect() {}
      },
    );
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("offers Mark up beside Edit page only where a chat can take the picture", async () => {
    await open({});
    expect(button()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await open({ onAddToChat: vi.fn() });
    const markup = button()!;
    expect(markup.title).toBe("Mark up page");
    expect(markup.disabled).toBe(false);
    expect(markup.previousElementSibling?.getAttribute("aria-label")).toBe(
      "Edit page",
    );
    // Nothing is captured until the person asks.
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("freezes the page behind its lossless picture and shows the tools over it", async () => {
    const id = await open({ onAddToChat: vi.fn() });
    mocks.layout.mockClear();
    await markUp();
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(id);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    const picture = container.querySelector<HTMLImageElement>(
      ".browser-markup-image",
    );
    expect(picture?.getAttribute("src")).toBe(PNG);
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(mocks.layout).toHaveBeenLastCalledWith(
      id,
      expect.any(Object),
      false,
    );
    expect(toolbar()).not.toBeNull();
    expect(
      [...toolbar()!.querySelectorAll("button")].map(
        (tool) => tool.getAttribute("aria-label") ?? tool.textContent,
      ),
    ).toEqual([
      "Select",
      "Pen",
      "Line",
      "Arrow",
      "Box",
      "Circle",
      "Text",
      "Colour",
      "Undo",
      "Send to chat",
      "Close mark up",
    ]);
    expect(button()!.getAttribute("aria-pressed")).toBe("true");
    expect(
      container
        .querySelector('[aria-label="Edit page"]')!
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(mocks.shellFocus).toHaveBeenCalled();
  });

  it("leaves with Escape and shows the live page again", async () => {
    const id = await open({ onAddToChat: vi.fn() });
    await markUp();
    expect(toolbar()).not.toBeNull();
    const layer = container.querySelector(".browser-markup")!;
    // Keys go to the picture without another click.
    expect(document.activeElement).toBe(layer);
    await press(layer, "Escape");
    await settle();
    expect(toolbar()).toBeNull();
    expect(mocks.layout).toHaveBeenLastCalledWith(id, expect.any(Object), true);
    expect(container.querySelector(".browser-markup")).toBeNull();
    expect(container.querySelector(".browser-page-snapshot")).toBeNull();
    expect(button()!.getAttribute("aria-pressed")).toBe("false");
  });

  it("sends the plain picture to the chat draft when nothing was drawn", async () => {
    const add = vi.fn();
    const id = await open({ onAddToChat: add });
    await markUp();
    await act(async () =>
      [...toolbar()!.querySelectorAll("button")]
        .find((tool) => tool.textContent === "Send to chat")!
        .click(),
    );
    await settle();
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith({
      dataUrl: PNG,
      width: 1200,
      height: 1000,
    });
    expect(add).toHaveBeenCalledExactlyOnceWith("", [
      expect.objectContaining({
        name: "Marked-up page.png",
        mimeType: "image/png",
        kind: "image",
      }),
    ]);
    expect(toolbar()).toBeNull();
    expect(mocks.layout).toHaveBeenLastCalledWith(id, expect.any(Object), true);
  });

  it("composites drawn marks into the picture it sends", async () => {
    const add = vi.fn();
    await open({ onAddToChat: add });
    await markUp();
    const drawn: string[] = [];
    const context = new Proxy(
      {},
      {
        get:
          (_target, name: string) =>
          (...args: unknown[]) => {
            drawn.push(name);
            return args;
          },
        set: () => true,
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as never,
    );
    const toBlob = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      "toBlob",
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,bWFya2Vk",
    );
    await draw(100, 100, 300, 200);
    const ink = container.querySelector("svg.browser-markup-ink")!;
    expect(ink.getAttribute("aria-label")).toBe("Page picture with 1 mark");
    await act(async () =>
      [...toolbar()!.querySelectorAll("button")]
        .find((tool) => tool.textContent === "Send to chat")!
        .click(),
    );
    await settle();
    expect(drawn[0]).toBe("drawImage");
    expect(drawn).toContain("stroke");
    expect(mocks.attach).toHaveBeenCalledExactlyOnceWith({
      dataUrl: "data:image/png;base64,bWFya2Vk",
      width: 1200,
      height: 1000,
    });
    expect(add).toHaveBeenCalledExactlyOnceWith("", [
      expect.objectContaining({ name: "Marked-up page.png" }),
    ]);
    if (toBlob)
      Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", toBlob);
    else delete (HTMLCanvasElement.prototype as { toBlob?: unknown }).toBlob;
  });

  it("switches tools by key, undoes, redoes and deletes a selected mark", async () => {
    await open({ onAddToChat: vi.fn() });
    await markUp();
    const layer = container.querySelector(".browser-markup")!;
    const ink = () => container.querySelector("svg.browser-markup-ink")!;
    const marks = () => ink().getAttribute("aria-label");
    const pressed = () =>
      toolbar()!
        .querySelector('[aria-pressed="true"]')!
        .getAttribute("aria-label");
    expect(pressed()).toBe("Pen");
    await press(layer, "r");
    expect(pressed()).toBe("Box");
    expect(ink().getAttribute("data-tool")).toBe("box");
    await draw(50, 50, 250, 150);
    expect(marks()).toBe("Page picture with 1 mark");
    expect(ink().querySelector("path")).not.toBeNull();
    await act(async () => {
      layer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(marks()).toBe("Page picture with 0 marks");
    await act(async () => {
      layer.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(marks()).toBe("Page picture with 1 mark");
    await press(layer, "v");
    await draw(150, 50, 150, 50);
    expect(ink().querySelector(".browser-markup-selection")).not.toBeNull();
    await press(layer, "Delete");
    expect(marks()).toBe("Page picture with 0 marks");
    expect(ink().querySelector(".browser-markup-selection")).toBeNull();
  });

  it("types a text mark that Enter finishes, and Escape first finishes typing", async () => {
    await open({ onAddToChat: vi.fn() });
    await markUp();
    const layer = container.querySelector(".browser-markup")!;
    await press(layer, "t");
    await draw(80, 90, 80, 90);
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Text mark"]',
    )!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "bigger");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await press(input, "Escape");
    // Escape finished the text; markup is still open.
    expect(toolbar()).not.toBeNull();
    expect(container.querySelector('input[aria-label="Text mark"]')).toBeNull();
    expect(
      container.querySelector("svg.browser-markup-ink text")?.textContent,
    ).toBe("bigger");
    await press(layer, "Escape");
    await settle();
    expect(toolbar()).toBeNull();
  });

  it("explains a refused capture and stays on the live page", async () => {
    const id = await open({ onAddToChat: vi.fn() });
    mocks.capture.mockRejectedValue(
      "The page is still loading. Try again in a moment.",
    );
    mocks.layout.mockClear();
    await markUp();
    expect(container.textContent).toContain(
      "The page is still loading. Try again in a moment.",
    );
    expect(toolbar()).toBeNull();
    expect(mocks.layout).not.toHaveBeenCalledWith(
      id,
      expect.any(Object),
      false,
    );
    expect(button()!.disabled).toBe(false);
  });

  it("leaves markup when the page navigates or the pane hides", async () => {
    const add = vi.fn();
    const id = await open({ onAddToChat: add });
    await receive(id);
    await markUp();
    expect(toolbar()).not.toBeNull();
    await receive(id, { url: "http://localhost:5180/settings" });
    await settle();
    expect(toolbar()).toBeNull();
    expect(container.querySelector(".browser-markup")).toBeNull();

    await markUp();
    expect(toolbar()).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(BrowserPane, {
          id: "page",
          initialUrl: "localhost:5180",
          onAddToChat: add,
          visible: false,
        }),
      ),
    );
    await settle();
    expect(container.querySelector(".browser-markup")).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });
});
