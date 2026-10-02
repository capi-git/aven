// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalBrowserDock } from "./PersonalBrowserDock";
import { EMPTY_BROWSER, type BrowserWorkspace } from "../lib/personalWorkspace";

const native = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  layout: vi.fn(),
  navigate: vi.fn(),
  listen: vi.fn(),
  listenToolbar: vi.fn().mockResolvedValue(() => {}),
  listenOpenTab: vi.fn().mockResolvedValue(() => {}),
  listenEditing: vi.fn().mockResolvedValue(() => {}),
  edit: vi.fn().mockResolvedValue(undefined),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: async () => () => {} }),
}));
vi.mock("../lib/browser", async (original) => ({
  ...(await original<typeof import("../lib/browser")>()),
  browserBounds: () => ({ x: 0, y: 40, width: 600, height: 500, scale: 2 }),
  nativeBrowser: native,
}));

describe("browser workspace presentation lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  let state: BrowserWorkspace;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    native.listenToolbar.mockResolvedValue(() => {});
    native.listenOpenTab.mockResolvedValue(() => {});
    native.listenEditing.mockResolvedValue(() => {});
    native.edit.mockResolvedValue(undefined);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 16),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    native.create.mockResolvedValue(undefined);
    native.close.mockResolvedValue(undefined);
    native.layout.mockResolvedValue(undefined);
    native.navigate.mockResolvedValue(undefined);
    native.listen.mockResolvedValue(native.unlisten);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    state = {
      ...EMPTY_BROWSER,
      open: true,
      url: "http://localhost:3000/preserved-page",
      ratio: 0.61,
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function render(patch: Partial<BrowserWorkspace> = {}, visible = true) {
    state = { ...state, ...patch };
    await act(async () => {
      root.render(
        state.open
          ? createElement(PersonalBrowserDock, {
              project: "/projects/demo",
              state,
              visible,
              onChange,
            })
          : null,
      );
    });
    await act(async () => vi.advanceTimersByTime(120));
  }

  it("keeps one native page through hidden, tab, split and workspace visibility changes", async () => {
    await render();
    const nativeId = native.create.mock.calls[0][0];
    const dock = container.querySelector<HTMLDivElement>(
      ".personal-browser-dock",
    )!;
    const address = container.querySelector<HTMLInputElement>(
      '[aria-label="Preview address"]',
    )!;
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.layout).not.toHaveBeenCalled();
    expect(dock.hidden).toBe(true);

    await render({ expanded: true });
    expect(dock.hidden).toBe(false);
    expect(dock.style.width).toBe("100%");
    expect(native.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      true,
    );

    await render({ mode: "split", expanded: false });
    expect(dock.style.width).toBe("61%");
    expect(
      container.querySelector('[aria-label="Resize browser split"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="Preview address"]')).toBe(
      address,
    );

    await render({}, false);
    expect(native.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      false,
    );
    await render({}, true);
    expect(native.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      true,
    );

    await render({ mode: "tab", expanded: false });
    expect(dock.hidden).toBe(true);
    await render({ expanded: true });
    expect(native.layout).toHaveBeenLastCalledWith(
      nativeId,
      expect.any(Object),
      true,
    );
    await render({ mode: "split", expanded: false });
    expect(dock.style.width).toBe("61%");
    expect(address.value).toBe("http://localhost:3000/preserved-page");
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.close).not.toHaveBeenCalled();
    expect(native.navigate).not.toHaveBeenCalled();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Close browser preview"]',
        )!
        .click(),
    );
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ open: false });
    await render(onChange.mock.calls[0][0]);
    expect(native.close).toHaveBeenCalledExactlyOnceWith(nativeId);
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("paints divider drags once per frame without reading layout per move and commits once on release", async () => {
    await render({ mode: "split", expanded: false });
    const dock = container.querySelector<HTMLDivElement>(
      ".personal-browser-dock",
    )!;
    const divider = container.querySelector<HTMLElement>(
      '[aria-label="Resize browser split"]',
    )!;
    const bounds = vi
      .spyOn(container, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 1000, 600));
    const published = vi.fn();
    window.addEventListener("supermono:workspace-layout", published);
    const pointer = (type: string, clientX: number) =>
      new PointerEvent(type, { bubbles: true, button: 0, clientX });
    const percent = (x: number) => `${((1000 - x) / 1000) * 100}%`;

    await act(async () => divider.dispatchEvent(pointer("pointerdown", 390)));
    expect(document.documentElement.classList.contains("is-resizing")).toBe(
      true,
    );
    act(() => {
      for (let x = 400; x < 430; x++)
        window.dispatchEvent(pointer("pointermove", x));
    });
    expect(dock.style.width).toBe("61%");
    expect(published).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(16));
    expect(dock.style.width).toBe(percent(429));
    expect(published).toHaveBeenCalledOnce();
    expect(bounds).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(pointer("pointermove", 440)));
    await act(async () => window.dispatchEvent(pointer("pointerup", 450)));
    expect(dock.style.width).toBe(percent(450));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ratio: 0.55 });
    expect(published).toHaveBeenCalledTimes(2);
    expect(document.documentElement.classList.contains("is-resizing")).toBe(
      false,
    );
    act(() => vi.advanceTimersByTime(100));
    expect(published).toHaveBeenCalledTimes(2);
    expect(bounds).toHaveBeenCalledOnce();
    window.removeEventListener("supermono:workspace-layout", published);
  });

  it("searches a restyled subtree for overlays once per batch of style writes", async () => {
    await render({ mode: "split", expanded: false });
    const pane = document.createElement("div");
    for (let index = 0; index < 20; index++)
      pane.append(document.createElement("p"));
    document.body.append(pane);
    await act(async () => {});
    const search = vi.spyOn(pane, "querySelector");
    await act(async () => {
      pane.style.setProperty("left", "10%");
      pane.style.setProperty("width", "40%");
      pane.style.setProperty("--workspace-background-left", "-10cqw");
    });
    expect(search).toHaveBeenCalledOnce();
    pane.remove();
  });
});
