// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetainedBrowserPane } from "./RetainedBrowserPane";
import { BROWSER_SLEEP_AFTER_MS } from "../lib/browserMemory";
import { getRegisteredAgentBrowserPage } from "../lib/agentBrowser";
import type { BrowserState } from "../lib/browser";

const native = vi.hoisted(() => ({
  create: vi.fn(), attach: vi.fn(), close: vi.fn(), sleep: vi.fn(), layout: vi.fn(),
  listen: vi.fn(), listenToolbar: vi.fn(),
  handlers: new Set<(state: BrowserState) => void>(),
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

describe("sleeping retained browser tabs", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    native.handlers.clear();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    native.listen.mockImplementation(async (callback) => {
      native.handlers.add(callback);
      return () => native.handlers.delete(callback);
    });
    native.listenToolbar.mockResolvedValue(() => {});
    native.close.mockResolvedValue(undefined);
    native.layout.mockResolvedValue(undefined);
    native.create.mockImplementation(async (id: string, url: string) => {
      for (const handler of native.handlers) handler({
        id, url, title: "A saved page", loading: false,
        canGoBack: false, canGoForward: false, error: null, notice: null,
      });
    });
    native.attach.mockImplementation(async (id: string) => ({
      id, url: "https://example.com/attached", title: "Transferred page", loading: false,
      canGoBack: false, canGoForward: false, error: null, notice: null,
    }));
    native.sleep.mockResolvedValue({ eligible: true, blockers: [], slept: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function render(visible: string[], overrides: Record<string, unknown> = {}) {
    await act(async () => root.render(createElement("div", {},
      ...["a", "b", "c", "d"].map((id) => createElement(RetainedBrowserPane, {
        key: id, id, initialUrl: `https://example.com/${id}`,
        visible: visible.includes(id), ...(id === "a" ? overrides : {}),
      })),
    )));
  }
  async function idle() {
    await act(async () => vi.advanceTimersByTimeAsync(BROWSER_SLEEP_AFTER_MS));
  }
  it("releases an old native page without deleting its tab and reloads its latest URL on return", async () => {
    await render(["a", "b", "c", "d"]);
    const original = getRegisteredAgentBrowserPage("a")!;
    await act(async () => {
      for (const handler of native.handlers) handler({
        id: original, url: "https://example.com/redirected", title: "Redirected",
        loading: false, canGoBack: true, canGoForward: false, error: null, notice: null,
      });
    });
    await render(["d"]);
    await idle();
    expect(native.sleep).toHaveBeenCalledExactlyOnceWith(original);
    expect(native.close).not.toHaveBeenCalled();
    expect(getRegisteredAgentBrowserPage("a")).toBeUndefined();
    expect(container.textContent).toContain("Tab sleeping");
    expect(container.textContent).not.toContain("Preview unavailable");
    await render(["a"]);
    expect(native.create).toHaveBeenCalledTimes(5);
    expect(native.create.mock.lastCall?.[1]).toBe("https://example.com/redirected");
    expect(getRegisteredAgentBrowserPage("a")).not.toBe(original);
    expect(container.querySelector('[data-browser-pane="a"]')?.textContent).not.toContain("Tab sleeping");
  });
  it("keeps blocked or failed sleep probes alive without using forced close", async () => {
    await render(["a", "b", "c", "d"]);
    const original = getRegisteredAgentBrowserPage("a");
    native.sleep.mockResolvedValue({ eligible: false, blockers: ["unsaved-input"], slept: false });
    await render(["d"]);
    await idle();
    expect(getRegisteredAgentBrowserPage("a")).toBe(original);
    expect(native.close).not.toHaveBeenCalled();
    expect(container.querySelector('[data-browser-pane="a"]')?.textContent).not.toContain("Tab sleeping");
    native.sleep.mockRejectedValue(new Error("Probe unavailable"));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(getRegisteredAgentBrowserPage("a")).toBe(original);
    expect(native.close).not.toHaveBeenCalled();
  });
  it("restores automatically if the user selects a tab while its non-forced close finishes", async () => {
    await render(["a", "b", "c", "d"]);
    let finish!: (result: { eligible: boolean; blockers: string[]; slept: boolean }) => void;
    native.sleep.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(["d"]);
    await idle();
    await render(["a"]);
    await act(async () => finish({ eligible: true, blockers: [], slept: true }));
    expect(native.create).toHaveBeenCalledTimes(5);
    expect(getRegisteredAgentBrowserPage("a")).toBeTruthy();
    expect(container.querySelector('[data-browser-pane="a"]')?.textContent).not.toContain("Tab sleeping");
    expect(native.close).not.toHaveBeenCalled();
  });
  it("treats a native intentional sleep event as dormant rather than a page error", async () => {
    await render(["a", "b", "c", "d"]);
    const original = getRegisteredAgentBrowserPage("a")!;
    native.sleep.mockImplementation(async () => {
      for (const handler of native.handlers) handler({
        id: original, url: "https://example.com/a", title: "A saved page", loading: false,
        canGoBack: false, canGoForward: false, error: null, notice: null,
        closed: true, sleeping: true,
      });
      return { eligible: true, blockers: [], slept: true };
    });
    await render(["d"]);
    await idle();
    expect(container.textContent).toContain("Tab sleeping");
    expect(container.textContent).not.toContain("Preview unavailable");
    expect(native.close).not.toHaveBeenCalled();
    await render(["a"]);
    expect(native.create).toHaveBeenCalledTimes(5);
  });

  it("does not let an old sleep completion close or reattach a replacement native page", async () => {
    await render(["a", "b", "c", "d"]);
    const original = getRegisteredAgentBrowserPage("a")!;
    let finish!: (result: { eligible: boolean; blockers: string[]; slept: boolean }) => void;
    native.sleep.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(["d"]);
    await idle();
    expect(native.sleep).toHaveBeenCalledExactlyOnceWith(original);
    await render(["a"], { attachedNativeId: "replacement-native" });
    expect(getRegisteredAgentBrowserPage("a")).toBe("replacement-native");
    expect(native.attach).toHaveBeenCalledExactlyOnceWith("replacement-native");

    await act(async () => finish({ eligible: true, blockers: [], slept: true }));
    expect(native.attach).toHaveBeenCalledExactlyOnceWith("replacement-native");
    expect(native.close).not.toHaveBeenCalledWith("replacement-native");
    expect(getRegisteredAgentBrowserPage("a")).toBe("replacement-native");
    expect(container.querySelector('[data-browser-pane="a"]')?.textContent).not.toContain("Tab sleeping");
  });

  it("keeps an inactive page awake while its address bar has an unsubmitted draft", async () => {
    await render(["a", "b", "c", "d"]);
    const original = getRegisteredAgentBrowserPage("a");
    const address = container.querySelector<HTMLInputElement>('[aria-label="Preview address"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        address, "https://example.com/unfinished-address",
      );
      address.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render(["d"]);
    await idle();
    expect(native.sleep).not.toHaveBeenCalled();
    expect(native.close).not.toHaveBeenCalled();
    expect(getRegisteredAgentBrowserPage("a")).toBe(original);
    expect(address.value).toBe("https://example.com/unfinished-address");
  });

  it("does not recreate or register a page when its pending sleep finishes after unmount", async () => {
    await render(["a", "b", "c", "d"]);
    let finish!: (result: { eligible: boolean; blockers: string[]; slept: boolean }) => void;
    native.sleep.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(["d"]);
    await idle();
    await act(async () => root.render(createElement("div")));
    expect(getRegisteredAgentBrowserPage("a")).toBeUndefined();
    await act(async () => finish({ eligible: true, blockers: [], slept: true }));
    expect(native.create).toHaveBeenCalledTimes(4);
    expect(getRegisteredAgentBrowserPage("a")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
