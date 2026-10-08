// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const platform = vi.hoisted(() => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));
vi.mock("./platform", () => platform);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/window", () => {
  const nativeWindow = {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  };
  return { getCurrentWindow: vi.fn(() => nativeWindow) };
});

let appearance: typeof import("./appearance");
const root = document.documentElement;
const hasNativeTint = () => root.classList.contains("has-native-glass-tint");
const glassCalls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([name]) => name === "set_window_glass_enabled");
/** Let queued tint refreshes and IPC acknowledgements settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("macOS native glass tint", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation(async (name) =>
      name === "set_window_glass_enabled" ? true : undefined,
    );
    platform.HAS_NATIVE_GLASS = true;
    platform.IS_MAC = true;
    root.className = "";
    root.style.cssText = "";
    appearance = await import("./appearance");
    appearance.applyThemePreference("dark");
    appearance.applySidebarOpacity(0.5);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the shell colour and opacity to AppKit before the page stops painting it", async () => {
    appearance.applyThemeColors({ dark: { background: "#123456" } });
    let acknowledge = (_value: boolean) => {};
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      }),
    );
    appearance.activateWindowAppearance();
    expect(invoke).toHaveBeenCalledWith("set_window_glass_enabled", {
      enabled: true,
      tint: { r: 0x12, g: 0x34, b: 0x56, alpha: 0.5 },
    });
    expect(hasNativeTint()).toBe(false);
    acknowledge(true);
    await vi.waitFor(() => expect(hasNativeTint()).toBe(true));
  });

  it("uses the shell's hue fallback when the workspace has no custom background", () => {
    appearance.applyThemeTint(0, 100);
    appearance.activateWindowAppearance();
    // hsl(0 100% 4%), the dark `--personal-frame` fallback.
    expect(invoke).toHaveBeenLastCalledWith("set_window_glass_enabled", {
      enabled: true,
      tint: { r: 20, g: 0, b: 0, alpha: 0.5 },
    });
  });

  it.each([undefined, false])(
    "keeps the CSS tint when the host does not acknowledge a native tint (%s)",
    async (result) => {
      vi.mocked(invoke).mockResolvedValue(result);
      appearance.activateWindowAppearance();
      await settle();
      expect(glassCalls()).toHaveLength(1);
      expect(hasNativeTint()).toBe(false);
    },
  );

  it("keeps the CSS tint when there is no native window", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no native host"));
    appearance.activateWindowAppearance();
    await settle();
    expect(hasNativeTint()).toBe(false);
  });

  it("follows appearance changes with one native update per settings pass", async () => {
    appearance.activateWindowAppearance();
    await vi.waitFor(() => expect(hasNativeTint()).toBe(true));
    vi.mocked(invoke).mockClear();

    // A workspace switch applies tint, colours and opacity together.
    appearance.applyThemeTint(120, 100);
    appearance.applyThemeColors({ dark: { background: "#204060" } });
    appearance.applySidebarOpacity(0.4);
    await settle();
    expect(glassCalls()).toEqual([
      [
        "set_window_glass_enabled",
        { enabled: true, tint: { r: 0x20, g: 0x40, b: 0x60, alpha: 0.4 } },
      ],
    ]);

    // Settings that leave the shell colour unchanged send nothing.
    appearance.applyThemeTint(200, 10);
    appearance.applySidebarOpacity(0.4);
    appearance.applySidebarBlur(30);
    appearance.applyBodyGlass(false);
    await settle();
    expect(glassCalls()).toHaveLength(1);
    expect(hasNativeTint()).toBe(true);
  });

  it("keeps the native tint it already has if a later update fails", async () => {
    appearance.activateWindowAppearance();
    await vi.waitFor(() => expect(hasNativeTint()).toBe(true));
    vi.mocked(invoke).mockRejectedValue(new Error("update failed"));
    appearance.applySidebarOpacity(0.3);
    await settle();
    expect(glassCalls().at(-1)?.[1]).toMatchObject({
      tint: { alpha: 0.3 },
    });
    expect(hasNativeTint()).toBe(true);
  });

  it.each([
    ["light mode", () => appearance.applyThemePreference("light")],
    ["full opacity", () => appearance.applySidebarOpacity(1)],
  ])(
    "restores the page's own background before %s turns native glass off",
    async (_name, change) => {
      appearance.activateWindowAppearance();
      await vi.waitFor(() => expect(hasNativeTint()).toBe(true));
      vi.mocked(invoke).mockClear();
      change();
      expect(hasNativeTint()).toBe(false);
      expect(glassCalls()).toEqual([
        ["set_window_glass_enabled", { enabled: false }],
      ]);
      await settle();
      expect(glassCalls()).toHaveLength(1);
      expect(hasNativeTint()).toBe(false);
    },
  );

  it("ignores an acknowledgement overtaken by light mode", async () => {
    let acknowledge = (_value: boolean) => {};
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        acknowledge = resolve;
      }),
    );
    appearance.activateWindowAppearance();
    appearance.applyThemePreference("light");
    acknowledge(true);
    await settle();
    expect(hasNativeTint()).toBe(false);
  });

  it("does not paint an opaque background when a delayed disable finishes after glass returns", async () => {
    appearance.activateWindowAppearance();
    await settle();
    expect(hasNativeTint()).toBe(true);

    let finishDisable = (_value: boolean) => {};
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishDisable = resolve;
      }),
    );
    appearance.applyThemePreference("light");
    appearance.applyThemePreference("dark");
    await settle();
    expect(hasNativeTint()).toBe(true);
    expect(getCurrentWindow().setBackgroundColor).not.toHaveBeenCalled();

    finishDisable(false);
    await settle();
    expect(hasNativeTint()).toBe(true);
    expect(getCurrentWindow().setBackgroundColor).not.toHaveBeenCalled();
  });

  it("does not send native tint updates before launch or while glass is off", async () => {
    appearance.applyThemeTint(40, 50);
    appearance.applySidebarOpacity(0.7);
    await settle();
    expect(glassCalls()).toEqual([]);
    appearance.applyThemePreference("light");
    appearance.activateWindowAppearance();
    vi.mocked(invoke).mockClear();
    appearance.applyThemeTint(80, 50);
    appearance.applySidebarOpacity(0.3);
    await settle();
    expect(glassCalls()).toEqual([]);
  });

  it("never asks other platforms for a native tint", async () => {
    platform.HAS_NATIVE_GLASS = false;
    platform.IS_MAC = false;
    vi.resetModules();
    appearance = await import("./appearance");
    appearance.applyThemePreference("dark");
    appearance.applySidebarOpacity(0.5);
    appearance.activateWindowAppearance();
    appearance.applyThemeTint(10, 20);
    await settle();
    expect(glassCalls()).toEqual([
      ["set_window_glass_enabled", { enabled: false }],
    ]);
    expect(hasNativeTint()).toBe(false);
  });
});

describe("native glass tint stylesheet", () => {
  const shellCss = readFileSync("src/personal-shell.css", "utf8");
  const macCss = readFileSync("src/macos-theme.css", "utf8");
  const tinted =
    "html.is-mac.has-native-glass.has-native-glass-tint:not(.theme-light)";

  it("stops only the dark macOS shell painting the tint AppKit paints", () => {
    expect(shellCss).toMatch(
      new RegExp(
        `${tinted.replace(/[.()]/g, "\\$&")}\\s+\\.personal-shell \\{\\s*background: transparent;\\s*\\}`,
      ),
    );
    // Panels, cards and the main surface keep their own paint.
    for (const target of [".sidebar-glass", ".body-glass", ".personal-main"]) {
      expect(shellCss).not.toMatch(
        new RegExp(`has-native-glass-tint[^{]*\\${target}`),
      );
    }
  });

  it("keeps the shell opaque when the system asks for less transparency", () => {
    const block = macCss.slice(
      macCss.indexOf(
        "@media (prefers-reduced-transparency: reduce), (prefers-contrast: more)",
      ),
    );
    expect(block).toMatch(
      new RegExp(
        `${tinted.replace(/[.()]/g, "\\$&")}\\s+\\.personal-shell,[^{]*\\{[^}]*background: var\\(--personal-frame\\);`,
      ),
    );
  });

  it("matches the shell colour the native tint is computed from", () => {
    // appearance.ts mirrors these: the dark frame and the root hue defaults.
    expect(shellCss).toMatch(
      /\.personal-shell \{\s*--personal-window-opacity: 1;\s*--personal-frame: var\(\s*--theme-background-color,\s*hsl\(var\(--theme-hue, 218\) var\(--theme-saturation, 8%\) 4%\)\s*\);/,
    );
    expect(shellCss).toMatch(
      /background: color-mix\(\s*in srgb,\s*var\(--personal-frame\) calc\(var\(--personal-window-opacity\) \* 100%\),\s*transparent\s*\);/,
    );
    expect(shellCss).toContain(
      "--personal-window-opacity: var(--sidebar-opacity, 1);",
    );
    const indexCss = readFileSync("src/index.css", "utf8");
    expect(indexCss).toMatch(
      /:root \{\s*--theme-hue: 207;\s*--theme-saturation: 16%;/,
    );
  });
});
