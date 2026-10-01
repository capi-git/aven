// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVERY_DAY,
  getScheduledAgent,
  saveScheduledAgent,
  type ScheduledAgent,
} from "../lib/scheduledAgents";
import {
  SCHEDULE_CHECK_MS,
  SCHEDULE_FIRST_CHECK_MS,
  useScheduledAgents,
} from "./useScheduledAgents";

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

const NOW = new Date(2026, 0, 7, 8, 59, 50).getTime();
const DUE = new Date(2026, 0, 7, 9, 0).getTime();

const agent: ScheduledAgent = {
  id: "daily",
  name: "Morning review",
  prompt: "Review yesterday's commits",
  project: "/work/site",
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  schedule: { kind: "weekly", days: EVERY_DAY, time: "09:00" },
  enabled: true,
  createdAt: 0,
  nextRunAt: DUE,
};

describe("scheduled agent checks", () => {
  let root: Root;
  let container: HTMLDivElement;
  const start = vi.fn();

  function Harness({ claim }: { claim: (slot: string) => Promise<boolean> }) {
    useScheduledAgents(start, claim);
    return null;
  }

  async function mount(claim: (slot: string) => Promise<boolean>) {
    await act(async () => root.render(createElement(Harness, { claim })));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockLocalStorage();
    start.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts a due schedule once and moves it to its next time", async () => {
    saveScheduledAgent(agent);
    const claim = vi.fn(async () => true);
    await mount(claim);

    // Not due at the first check, ten seconds before nine.
    await act(() => vi.advanceTimersByTimeAsync(SCHEDULE_FIRST_CHECK_MS));
    expect(start).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_MS));
    expect(claim).toHaveBeenCalledWith(`daily:${DUE}`);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toMatchObject({ id: "daily" });
    expect(getScheduledAgent("daily")!.nextRunAt).toBe(
      new Date(2026, 0, 8, 9, 0).getTime(),
    );

    await act(() => vi.advanceTimersByTimeAsync(SCHEDULE_CHECK_MS * 4));
    window.dispatchEvent(new Event("focus"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not start a slot another window claimed", async () => {
    saveScheduledAgent({ ...agent, nextRunAt: NOW - 1000 });
    const claim = vi.fn(async () => false);
    await mount(claim);
    await act(() => vi.advanceTimersByTimeAsync(SCHEDULE_FIRST_CHECK_MS));
    expect(claim).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(getScheduledAgent("daily")!.nextRunAt).toBe(NOW - 1000);
  });

  it("checks as soon as the window regains focus", async () => {
    saveScheduledAgent(agent);
    const claim = vi.fn(async () => true);
    await mount(claim);
    await act(() => vi.advanceTimersByTimeAsync(SCHEDULE_FIRST_CHECK_MS));
    // A throttled hidden window: the clock moves on without timers firing.
    vi.setSystemTime(DUE + 60_000);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(start).toHaveBeenCalledTimes(1);
  });
});
