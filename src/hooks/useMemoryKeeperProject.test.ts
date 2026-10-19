// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Like a fresh window: nothing knows which providers are installed until a
// probe runs, and only a probe can find out.
const store = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    probed: false,
    installed: new Set<string>(["claude"]),
    version: 0,
  };
  return {
    state,
    listeners,
    probe: vi.fn(async () => {
      state.probed = true;
      state.version += 1;
      for (const listener of listeners) listener();
    }),
  };
});

vi.mock("../lib/harness/availability", () => ({
  probeHarnessAvailability: store.probe,
  isHarnessAvailable: (id: string) =>
    store.state.probed && store.state.installed.has(id),
  isCheckingHarnessAvailability: () => !store.state.probed,
  subscribeHarnessAvailability: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  getHarnessAvailabilitySnapshot: () => store.state.version,
}));

import { useKeeperModel, useKeeperModelStatus } from "./useMemoryKeeperProject";

let root: Root;
let container: HTMLDivElement;
let seen: string | null = null;
let checking: boolean[] = [];

function Probe() {
  seen = useKeeperModel()?.harness ?? null;
  return null;
}

function Status() {
  checking.push(useKeeperModelStatus().checking);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.state.probed = false;
  store.state.version = 0;
  store.state.installed = new Set(["claude"]);
  store.probe.mockClear();
  seen = null;
  checking = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("asks which providers are installed instead of reporting none", async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(store.probe).toHaveBeenCalledOnce();
  expect(seen).toBe("claude");
});

it("reads as still checking until the probe answers, then as missing", async () => {
  store.state.installed = new Set();
  await act(async () => root.render(createElement(Status)));
  expect(checking[0]).toBe(true);
  expect(checking.at(-1)).toBe(false);
});
