import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetTabSleep,
  isChatAwake,
  isTabAsleep,
  noteChatAsleep,
  noteChatAwake,
  noteTabSleeping,
  resetSleepCenter,
  sleepVersion,
  sleepingTabIds,
  subscribeSleep,
} from "./sleepCenter";

describe("sleep center", () => {
  afterEach(() => resetSleepCenter());

  it("tells listeners only when something falls asleep or wakes", () => {
    const listener = vi.fn();
    const stop = subscribeSleep(listener);
    const before = sleepVersion();
    noteTabSleeping("tab", true);
    noteTabSleeping("tab", true);
    expect(listener).toHaveBeenCalledOnce();
    expect(isTabAsleep("tab")).toBe(true);
    expect(sleepingTabIds()).toEqual(["tab"]);
    noteTabSleeping("tab", false);
    expect(isTabAsleep("tab")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(sleepVersion()).toBe(before + 2);
    stop();
    noteTabSleeping("tab", true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("forgets a closed tab", () => {
    noteTabSleeping("closed", true);
    forgetTabSleep("closed");
    expect(isTabAsleep("closed")).toBe(false);
  });

  it("counts a chat asleep until its process runs", () => {
    expect(isChatAwake("chat")).toBe(false);
    noteChatAwake("chat");
    expect(isChatAwake("chat")).toBe(true);
    noteChatAsleep("chat");
    expect(isChatAwake("chat")).toBe(false);
  });
});
