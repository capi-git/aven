// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));
vi.mock("./platform", () => platform);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/window", () => {
  const nativeWindow = {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  };
  return { getCurrentWindow: vi.fn(() => nativeWindow) };
});
vi.mock("./uiScale", () => ({
  UI_SCALE_KEY: "monocode.uiScale",
  applyUiScale: vi.fn(async () => {}),
  loadUiScale: vi.fn(() => 1),
}));

let appearance: typeof import("./appearance");
let values: Map<string, string>;

/** What another window did: it saved the value, and this window hears a storage event. */
function anotherWindowSaved(key: string, value: string) {
  values.set(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

describe("appearance across windows", () => {
  beforeEach(async () => {
    vi.resetModules();
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    document.documentElement.className = "";
    document.documentElement.style.cssText = "";
    appearance = await import("./appearance");
    appearance.initAppearance();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("applies a change Settings saved in another window", () => {
    const style = document.documentElement.style;
    const before = style.getPropertyValue("--status-bar-opacity");
    anotherWindowSaved("aven.statusBarOpacity", "0.35");
    expect(style.getPropertyValue("--status-bar-opacity")).toBe("0.35");
    expect(before).not.toBe("0.35");

    anotherWindowSaved("monocode.sidebarOpacity", "0.9");
    expect(style.getPropertyValue("--sidebar-opacity")).toBe("0.9");

    anotherWindowSaved("monocode.chatBackgroundPath", "/tmp/bg.png");
    expect(
      document.documentElement.classList.contains("has-chat-background"),
    ).toBe(true);
  });

  it("ignores storage events for keys that are not appearance", () => {
    const style = document.documentElement.style;
    const sidebar = style.getPropertyValue("--sidebar-opacity");
    values.set("monocode.sidebarOpacity", "0.9");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.somethingElse", newValue: "1" }),
    );
    expect(style.getPropertyValue("--sidebar-opacity")).toBe(sidebar);
    // A cleared store (key null) re-reads everything.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(style.getPropertyValue("--sidebar-opacity")).toBe("0.9");
  });
});
