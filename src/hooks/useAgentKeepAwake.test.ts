// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_KEEP_AWAKE_HEARTBEAT_MS,
  agentKeepAwakeSessions,
  loadAgentKeepAwake,
  saveAgentKeepAwake,
} from "../lib/agentKeepAwake";
import { useAgentKeepAwake } from "./useAgentKeepAwake";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => [...data.keys()][index] ?? null,
      get length() {
        return data.size;
      },
    },
  });
}

describe("keeping the Mac awake while agents work", () => {
  let root: Root;
  let container: HTMLDivElement;
  const report = vi.fn();

  function Harness({ busy }: { busy: ReadonlySet<string> }) {
    useAgentKeepAwake(busy, report);
    return null;
  }
  const render = (busy: string[]) =>
    act(() => root.render(createElement(Harness, { busy: new Set(busy) })));

  beforeEach(() => {
    vi.useFakeTimers();
    mockLocalStorage();
    report.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("is on by default and remembers being turned off", () => {
    expect(loadAgentKeepAwake()).toBe(true);
    saveAgentKeepAwake(false);
    expect(loadAgentKeepAwake()).toBe(false);
    saveAgentKeepAwake(true);
    expect(loadAgentKeepAwake()).toBe(true);
  });

  it("reports working chats, releases when idle, and refreshes long turns", () => {
    render([]);
    expect(report).toHaveBeenLastCalledWith(true, []);
    render(["b", "a"]);
    expect(report).toHaveBeenLastCalledWith(true, ["a", "b"]);
    const calls = report.mock.calls.length;
    // Same set in another order: no extra report.
    render(["a", "b"]);
    expect(report.mock.calls.length).toBe(calls);
    act(() => vi.advanceTimersByTime(AGENT_KEEP_AWAKE_HEARTBEAT_MS));
    expect(report).toHaveBeenLastCalledWith(true, ["a", "b"]);
    expect(report.mock.calls.length).toBe(calls + 1);
    render([]);
    expect(report).toHaveBeenLastCalledWith(true, []);
    // Idle: no heartbeat.
    const idle = report.mock.calls.length;
    act(() => vi.advanceTimersByTime(AGENT_KEEP_AWAKE_HEARTBEAT_MS * 3));
    expect(report.mock.calls.length).toBe(idle);
  });

  it("follows the setting and releases on unmount", () => {
    render(["a"]);
    act(() => saveAgentKeepAwake(false));
    expect(report).toHaveBeenLastCalledWith(false, ["a"]);
    act(() => saveAgentKeepAwake(true));
    expect(report).toHaveBeenLastCalledWith(true, ["a"]);
    act(() => root.unmount());
    expect(report).toHaveBeenLastCalledWith(true, []);
    root = createRoot(container);
  });

  it("sends only identifiers the host accepts", () => {
    expect(
      agentKeepAwakeSessions(["ok-1", "bad id", "", "x".repeat(81), "ok-1"]),
    ).toEqual(["ok-1"]);
  });
});
