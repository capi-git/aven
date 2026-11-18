import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultOpenInApp,
  loadOpenInApp,
  OPEN_IN_APP_KEY,
  saveOpenInApp,
} from "./openInApps";

const finder = { id: "finder", name: "Finder", icon: null };
const zed = { id: "zed", name: "Zed", icon: null };

describe("Open in default", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  it("remembers the app chosen last under an aven key", () => {
    expect(loadOpenInApp()).toBe("finder");
    saveOpenInApp("zed");
    expect(localStorage.getItem(OPEN_IN_APP_KEY)).toBe("zed");
    expect(OPEN_IN_APP_KEY.startsWith("aven.")).toBe(true);
    expect(defaultOpenInApp([finder, zed], loadOpenInApp())).toBe(zed);
  });

  it("falls back to Finder when the remembered app is gone", () => {
    expect(defaultOpenInApp([finder], "zed")).toBe(finder);
    expect(defaultOpenInApp([], "zed")).toBeNull();
  });
});

describe("Open in reply", () => {
  it("drops an odd reply instead of breaking the footer", async () => {
    const { parseOpenInApps } = await import("./openInApps");
    expect(parseOpenInApps(undefined)).toEqual([]);
    expect(parseOpenInApps({})).toEqual([]);
    expect(
      parseOpenInApps([
        { id: "finder", name: "Finder", icon: "data:x" },
        { id: 3, name: "Bad" },
        null,
        { id: "zed", name: "Zed" },
      ]),
    ).toEqual([
      { id: "finder", name: "Finder", icon: "data:x" },
      { id: "zed", name: "Zed", icon: null },
    ]);
  });
});
