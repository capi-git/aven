// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDiffMode, saveDiffMode, subscribeDiffMode } from "./diffMode";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
    },
  });
}

describe("diffMode", () => {
  beforeEach(mockLocalStorage);

  it("starts in one column and remembers side by side", () => {
    expect(loadDiffMode()).toBe("unified");
    saveDiffMode("split");
    expect(localStorage.getItem("aven.diff.layout")).toBe("split");
    expect(loadDiffMode()).toBe("split");
    saveDiffMode("unified");
    expect(localStorage.getItem("aven.diff.layout")).toBeNull();
  });

  it("tells every open diff when the choice changes", () => {
    const listener = vi.fn();
    const stop = subscribeDiffMode(listener);
    saveDiffMode("split");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    saveDiffMode("unified");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
