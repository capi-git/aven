// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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
let appearance: typeof import("./appearance");

describe("native workspace transparency", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    platform.HAS_NATIVE_GLASS = true;
    platform.IS_MAC = true;
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    document.documentElement.className = "";
    document.documentElement.style.cssText = "";
    appearance = await import("./appearance");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("paints Aven before the first workspace render with opaque readable surfaces", () => {
    appearance.initAppearance();
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--theme-background-color")).toBe("#0b121a");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#6cabdd");
    expect(style.getPropertyValue("--theme-highlight-color")).toBe("#d7eefc");
    expect(style.getPropertyValue("--sidebar-opacity")).toBe("1");
    expect(document.documentElement.classList.contains("glass-body")).toBe(
      false,
    );
    expect(document.documentElement.classList.contains("theme-light")).toBe(
      false,
    );
  });

  it("keeps explicit legacy tint and transparency on the initial frame", () => {
    localStorage.setItem("monocode.themeHue", "240");
    localStorage.setItem("monocode.sidebarOpacity", "0.15");
    localStorage.setItem("monocode.bodyGlass", "1");
    appearance.initAppearance();
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--theme-hue")).toBe("240");
    expect(style.getPropertyValue("--theme-background-color")).toBe("");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("");
    expect(style.getPropertyValue("--sidebar-opacity")).toBe("0.15");
    expect(document.documentElement.classList.contains("glass-body")).toBe(
      true,
    );
  });

  it("applies exact per-mode colors and clears stale workspace overrides without native IPC", () => {
    appearance.applyThemePreference("dark");
    appearance.applyThemeColors({
      dark: { background: "#000", accent: "#abc", highlight: "#776699" },
      light: { background: "#fff", accent: "#334455" },
    });
    appearance.applySidebarOpacity(1);
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--theme-background-color")).toBe("#000000");
    expect(style.getPropertyValue("--theme-content-color")).toBe("#ffffff");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#aabbcc");
    expect(style.getPropertyValue("--theme-highlight-color")).toBe("#776699");
    expect(style.getPropertyValue("--sidebar-opacity")).toBe("1");
    appearance.applyThemePreference("light");
    expect(style.getPropertyValue("--theme-background-color")).toBe("#ffffff");
    expect(style.getPropertyValue("--theme-content-color")).toBe("#000000");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("#334455");
    expect(style.getPropertyValue("--theme-highlight-color")).toBe("");
    appearance.applyThemeColors();
    expect(style.getPropertyValue("--theme-background-color")).toBe("");
    expect(style.getPropertyValue("--theme-content-color")).toBe("");
    expect(style.getPropertyValue("--theme-accent-color")).toBe("");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("enables Mac glass after activation and restores it after light mode", async () => {
    appearance.applyThemePreference("dark");
    expect(invoke).not.toHaveBeenCalled();
    appearance.activateWindowAppearance();
    appearance.applyThemePreference("light");
    appearance.applyThemePreference("dark");
    await Promise.resolve();
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["set_window_glass_enabled", { enabled: true }],
      ["set_window_glass_enabled", { enabled: false }],
      ["set_window_glass_enabled", { enabled: true }],
    ]);
    expect(getCurrentWindow().setBackgroundColor).not.toHaveBeenCalled();
  });

  it("uses near-clear backgrounds without changing text or saved preferences", () => {
    localStorage.setItem("monocode.bodyGlass", "1");
    localStorage.setItem("monocode.sidebarOpacity", "0.4");
    expect(appearance.loadBodyGlass()).toBe(true);
    expect(appearance.applyBodyGlass(true)).toBe(true);
    expect(document.documentElement.classList.contains("glass-body")).toBe(
      true,
    );
    expect(appearance.applySidebarOpacity(0.05)).toBe(0.05);
    expect(
      document.documentElement.style.getPropertyValue("--sidebar-opacity"),
    ).toBe("0.05");
    expect(document.documentElement.style.opacity).toBe("");
    expect(invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem("monocode.bodyGlass")).toBe("1");
    expect(localStorage.getItem("monocode.sidebarOpacity")).toBe("0.4");
  });

  it("defaults to zero blur and only sends native blur when its value changes", () => {
    expect(appearance.loadSidebarBlur()).toBe(0);
    expect(appearance.loadSidebarOpacity()).toBe(1);
    expect(appearance.loadBodyGlass()).toBe(false);
    appearance.applySidebarBlur(0);
    appearance.applySidebarBlur(0);
    appearance.applySidebarOpacity(0.6);
    appearance.applyBodyGlass(false);
    appearance.applySidebarBlur(12);
    appearance.applySidebarBlur(0);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["set_window_background_blur", { radius: 0 }],
      ["set_window_background_blur", { radius: 12 }],
      ["set_window_background_blur", { radius: 0 }],
    ]);
  });

  it("handles missing browser-preview IPC and permits a later blur retry", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("No native window"));
    appearance.applySidebarBlur(8);
    await Promise.resolve();
    appearance.applySidebarBlur(8);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps unsupported platforms opaque while preserving stored glass settings", async () => {
    platform.HAS_NATIVE_GLASS = false;
    platform.IS_MAC = false;
    localStorage.setItem("monocode.bodyGlass", "1");
    expect(appearance.loadBodyGlass()).toBe(true);
    expect(appearance.applyBodyGlass(true)).toBe(false);
    expect(appearance.applySidebarOpacity(0.05)).toBe(1);
    appearance.applySidebarBlur(64);
    expect(invoke).not.toHaveBeenCalled();
    appearance.activateWindowAppearance();
    await vi.waitFor(() => {
      expect(getCurrentWindow().setBackgroundColor).toHaveBeenLastCalledWith(
        "#0b121a",
      );
    });
    expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
      enabled: false,
    });
    expect(localStorage.getItem("monocode.bodyGlass")).toBe("1");
  });

  it("keeps native opaque backing aligned with custom backgrounds and the light default", async () => {
    platform.HAS_NATIVE_GLASS = false;
    platform.IS_MAC = false;
    appearance.applyThemeColors({ dark: { background: "#123456" } });
    appearance.activateWindowAppearance();
    await vi.waitFor(() => {
      expect(getCurrentWindow().setBackgroundColor).toHaveBeenLastCalledWith(
        "#123456",
      );
    });
    appearance.applyThemePreference("light");
    await vi.waitFor(() => {
      expect(getCurrentWindow().setBackgroundColor).toHaveBeenLastCalledWith(
        "#edf5fc",
      );
    });
  });
});
