// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { useFixedDeadline } from "./useFixedDeadline";
it("persists settled latest content by its first deadline while another session streams, and cancels on unmount", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div")),
    saved = vi.fn();
  let latest = "settled",
    pending = true;
  function Host({ token }: { token: number }) {
    const schedule = useFixedDeadline(() => {
      if (pending) saved(latest);
      pending = false;
    }, 650);
    useEffect(() => {
      if (pending) schedule();
    }, [token, schedule]);
    return null;
  }
  for (let token = 0; token < 30; token++) {
    await act(async () => root.render(createElement(Host, { token })));
    if (token === 10) latest = "newest settled";
    await act(async () => vi.advanceTimersByTime(32));
  }
  expect(saved).toHaveBeenCalledExactlyOnceWith("newest settled");
  pending = true;
  await act(async () => root.render(createElement(Host, { token: 31 })));
  await act(async () => root.unmount());
  await vi.advanceTimersByTimeAsync(1000);
  expect(saved).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
