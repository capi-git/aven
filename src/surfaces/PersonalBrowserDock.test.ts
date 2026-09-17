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
});
