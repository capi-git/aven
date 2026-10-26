// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

const platform = vi.hoisted(() => ({ HAS_NATIVE_GLASS: true, IS_MAC: true }));
vi.mock("./platform", () => platform);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({})),
}));

let appearance: typeof import("./appearance");
let values: Map<string, string>;
const legacy = () =>
  document.documentElement.classList.contains("is-macos-legacy");

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  platform.IS_MAC = true;
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  document.documentElement.className = "";
  appearance = await import("./appearance");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the window's corner on each macOS release", () => {
  it("marks macOS 13 to 15, whose windows are less round, and remembers it", async () => {
    vi.mocked(invoke).mockResolvedValue(15);
    await appearance.syncMacosRelease();
    expect(invoke).toHaveBeenCalledWith("macos_major_version");
    expect(legacy()).toBe(true);
    expect(values.get("aven.macosMajor")).toBe("15");

    vi.mocked(invoke).mockResolvedValue(26);
    await appearance.syncMacosRelease();
    expect(legacy()).toBe(false);
  });

  it("uses the release seen last before the system answers", async () => {
    values.set("aven.macosMajor", "14");
    let answer!: (major: number) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    const done = appearance.syncMacosRelease();
    expect(legacy()).toBe(true);
    answer(27);
    await done;
    expect(legacy()).toBe(false);
  });

  it("leaves other systems and unanswered calls on the current corner", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no command"));
    await appearance.syncMacosRelease();
    expect(legacy()).toBe(false);
    platform.IS_MAC = false;
    vi.resetModules();
    appearance = await import("./appearance");
    await appearance.syncMacosRelease();
    expect(legacy()).toBe(false);
  });

  it("nests the panels in a 16pt corner on macOS 26 and a 10pt one before", () => {
    const css = readFileSync("src/macos-theme.css", "utf8");
    expect(css).toMatch(/:root \{\s*--aven-window-radius: 16px;/);
    expect(css).toMatch(
      /html\.is-mac\.is-macos-legacy \{\s*--aven-window-radius: 10px;/,
    );
    expect(css).toMatch(
      /--aven-radius-pane: calc\(\s*var\(--aven-window-radius\) - var\(--aven-window-gutter\)\s*\);/,
    );
  });
});
