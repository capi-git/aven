// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(async () => 1),
}));
vi.mock("@tauri-apps/api/core", () => tauri);

import {
  currentDotPointerBlock,
  dotPointerBlock,
  initDotPointer,
  POINTER_ROOT_ATTRIBUTE,
  subscribeDotPointerBlock,
} from "./dotPointer";
import { SETTINGS } from "./settingDefinitions";

type Query = { matches: boolean; listeners: Set<() => void> };
const queries = new Map<string, Query>();

function query(text: string): Query {
  let entry = queries.get(text);
  if (!entry) {
    entry = { matches: false, listeners: new Set() };
    queries.set(text, entry);
  }
  return entry;
}

function setQuery(text: string, matches: boolean) {
  const entry = query(text);
  entry.matches = matches;
  for (const listener of entry.listeners) listener();
}

const root = () =>
  document.documentElement.getAttribute(POINTER_ROOT_ATTRIBUTE);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let stop: (() => void) | undefined;

beforeEach(() => {
  queries.clear();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  document.documentElement.removeAttribute(POINTER_ROOT_ATTRIBUTE);
  tauri.isTauri.mockReturnValue(true);
  tauri.invoke.mockReset().mockResolvedValue(1);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((text: string) => {
      const entry = query(text);
      return {
        get matches() {
          return entry.matches;
        },
        addEventListener: (_: string, listener: () => void) =>
          entry.listeners.add(listener),
        removeEventListener: (_: string, listener: () => void) =>
          entry.listeners.delete(listener),
      };
    }),
  );
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  // Leave the module's system state at "nothing asked" for the next test.
  setQuery("(prefers-contrast: more)", false);
  setQuery("(forced-colors: active)", false);
  tauri.invoke.mockResolvedValue(1);
  stop = initDotPointer();
  await settle();
  stop();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe("dot pointer", () => {
  it("gives way to an enlarged pointer, more contrast or forced colours", () => {
    const plain = { scale: 1, moreContrast: false, forcedColors: false };
    expect(dotPointerBlock(plain)).toBeNull();
    expect(dotPointerBlock({ ...plain, scale: 1.5 })).toBe("size");
    expect(dotPointerBlock({ ...plain, moreContrast: true })).toBe("contrast");
    expect(dotPointerBlock({ ...plain, forcedColors: true })).toBe("contrast");
  });

  it("is on by default and follows the setting", () => {
    stop = initDotPointer();
    expect(root()).toBe("dot");
    SETTINGS.dotPointer.save(false);
    expect(root()).toBeNull();
    SETTINGS.dotPointer.save(true);
    expect(root()).toBe("dot");
  });

  it("follows the setting changed in another window", () => {
    stop = initDotPointer();
    localStorage.setItem("aven.dotPointer", "0");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "aven.dotPointer" }),
    );
    expect(root()).toBeNull();
  });

  it("turns off while the Mac asks for more contrast, and says why", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeDotPointerBlock(seen);
    stop = initDotPointer();
    setQuery("(prefers-contrast: more)", true);
    expect(root()).toBeNull();
    expect(currentDotPointerBlock()).toBe("contrast");
    expect(seen).toHaveBeenCalled();
    setQuery("(prefers-contrast: more)", false);
    expect(root()).toBe("dot");
    expect(currentDotPointerBlock()).toBeNull();
    unsubscribe();
  });

  it("reads the Mac's pointer size, again when Aven comes to the front", async () => {
    tauri.invoke.mockResolvedValue(2);
    stop = initDotPointer();
    await settle();
    expect(tauri.invoke).toHaveBeenCalledWith("system_pointer_scale");
    expect(root()).toBeNull();
    expect(currentDotPointerBlock()).toBe("size");

    tauri.invoke.mockResolvedValue(1);
    window.dispatchEvent(new Event("focus"));
    await settle();
    expect(root()).toBe("dot");
  });

  it("keeps the dot when the size can't be read, or outside the app", async () => {
    tauri.invoke.mockRejectedValue(new Error("no native"));
    stop = initDotPointer();
    await settle();
    expect(root()).toBe("dot");
    stop();
    tauri.isTauri.mockReturnValue(false);
    tauri.invoke.mockClear();
    stop = initDotPointer();
    await settle();
    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(root()).toBe("dot");
  });

  it("stops following everything when stopped", () => {
    stop = initDotPointer();
    stop();
    stop = undefined;
    SETTINGS.dotPointer.save(false);
    expect(root()).toBe("dot");
    SETTINGS.dotPointer.save(true);
  });
});
