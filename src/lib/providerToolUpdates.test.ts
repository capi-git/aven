// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadProviderToolAutoUpdates,
  refreshAutomaticProviderTools,
  saveProviderToolAutoUpdates,
  subscribeProviderToolAutoUpdates,
} from "./providerToolUpdates";

const native = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  invoke: vi.fn(async (_command: string, _args: { provider: string }) => ({
    updated: false,
  })),
}));
vi.mock("@tauri-apps/api/core", () => native);
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    clear: () => storage.clear(),
  });
  native.isTauri.mockReset().mockReturnValue(true);
  native.invoke.mockReset().mockResolvedValue({ updated: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider tool updates", () => {
  it("defaults on and updates each supported provider once through the native gate", async () => {
    native.invoke.mockImplementation(async (_command, args) => ({
      updated: args.provider === "codex",
    }));
    expect(loadProviderToolAutoUpdates()).toBe(true);
    expect(
      await refreshAutomaticProviderTools(["codex", "claude", "codex", "pi"]),
    ).toEqual(new Set(["codex"]));
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.invoke).toHaveBeenCalledWith("provider_refresh_cli", {
      provider: "codex",
    });
    expect(native.invoke).toHaveBeenCalledWith("provider_refresh_cli", {
      provider: "claude",
    });
  });

  it("persists the user's choice and never invokes updates when disabled or outside Aven", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProviderToolAutoUpdates(listener);
    saveProviderToolAutoUpdates(false);
    expect(loadProviderToolAutoUpdates()).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(await refreshAutomaticProviderTools(["codex"])).toEqual(new Set());
    expect(native.invoke).not.toHaveBeenCalled();
    saveProviderToolAutoUpdates(true);
    native.isTauri.mockReturnValue(false);
    expect(await refreshAutomaticProviderTools(["codex"])).toEqual(new Set());
    expect(native.invoke).not.toHaveBeenCalled();
    unsubscribe();
    saveProviderToolAutoUpdates(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps discovery available when a tool update fails or is skipped", async () => {
    native.invoke.mockImplementation(async (_command, args) => {
      if (args.provider === "codex") throw new Error("Offline");
      return { updated: false };
    });
    expect(await refreshAutomaticProviderTools(["codex", "claude"])).toEqual(
      new Set(),
    );
  });
});
