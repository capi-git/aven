// @vitest-environment happy-dom
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_RUNTIME_MODE_KEY,
  loadDefaultRuntimeMode,
  saveDefaultRuntimeMode,
  subscribeDefaultRuntimeMode,
} from "./runtimeMode";

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps independent Settings and home subscribers current after selections and other-window updates", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Preference({ name }: { name: string }) {
    const mode = useSyncExternalStore(
      subscribeDefaultRuntimeMode,
      loadDefaultRuntimeMode,
    );
    return createElement("output", { "aria-label": name }, mode);
  }
  try {
    await act(async () =>
      root.render(
        createElement(
          "div",
          {},
          createElement(Preference, { name: "Settings" }),
          createElement(Preference, { name: "Home" }),
        ),
      ),
    );
    const values = () =>
      [...host.querySelectorAll("output")].map((node) => node.textContent);
    expect(values()).toEqual(["supervised", "supervised"]);
    await act(async () => saveDefaultRuntimeMode("auto-accept-edits"));
    expect(values()).toEqual(["auto-accept-edits", "auto-accept-edits"]);
    await act(async () => {
      localStorage.setItem(DEFAULT_RUNTIME_MODE_KEY, "supervised");
      window.dispatchEvent(
        new StorageEvent("storage", { key: DEFAULT_RUNTIME_MODE_KEY }),
      );
    });
    expect(values()).toEqual(["supervised", "supervised"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("unsubscribes and ignores unrelated storage changes", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeDefaultRuntimeMode(listener);
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  saveDefaultRuntimeMode("auto");
  expect(listener).toHaveBeenCalledTimes(1);
});
