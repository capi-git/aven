// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { useTerminalStatus } from "./useTerminalStatus";
const status = vi.hoisted(() => vi.fn());
vi.mock("../lib/pty", () => ({ getPtyStatus: status }));
it("hidden retained terminals do no status work, reveal refreshes, late results and unmount are ignored", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div")),
    onStatus = vi.fn(),
    ready = { current: true };
  status.mockResolvedValue({ foreground: "shell" });
  function Host({ visible }: { visible: boolean }) {
    useTerminalStatus("term", visible, ready, onStatus);
    return null;
  }
  const render = async (visible: boolean) =>
    act(async () => root.render(createElement(Host, { visible })));
  await render(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(status).not.toHaveBeenCalled();
  await render(true);
  expect(status).toHaveBeenCalledTimes(1);
  expect(onStatus).toHaveBeenCalledWith("shell");
  let resolve!: (v: { foreground: string }) => void;
  status.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await vi.advanceTimersByTimeAsync(1000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(status).toHaveBeenCalledTimes(2);
  await render(false);
  resolve({ foreground: "stale" });
  await Promise.resolve();
  expect(onStatus).not.toHaveBeenCalledWith("stale");
  await render(true);
  expect(status).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
  await vi.advanceTimersByTimeAsync(5000);
  expect(status).toHaveBeenCalledTimes(3);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
