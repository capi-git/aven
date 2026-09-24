// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  unlisten: vi.fn(),
  handler: null as null | ((event: { payload: { level: string } }) => void),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_: string, handler: typeof host.handler) => {
    host.handler = handler;
    return Promise.resolve(host.unlisten);
  }),
}));
import { listen } from "@tauri-apps/api/event";
import {
  MEMORY_PRESSURE_EVENT,
  notifyMemoryPressure,
  subscribeMemoryPressure,
} from "./memoryPressure";

afterEach(() => vi.clearAllMocks());

it("shares one host subscription and releases it with the last listener", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeMemoryPressure(first);
  const stopSecond = subscribeMemoryPressure(second);
  await Promise.resolve();
  expect(listen).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledWith(
    MEMORY_PRESSURE_EVENT,
    expect.any(Function),
  );
  host.handler?.({ payload: { level: "warn" } });
  expect(first).toHaveBeenCalledWith("warn");
  expect(second).toHaveBeenCalledWith("warn");
  stopFirst();
  notifyMemoryPressure("critical");
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenLastCalledWith("critical");
  expect(host.unlisten).not.toHaveBeenCalled();
  stopSecond();
  expect(host.unlisten).toHaveBeenCalledOnce();
});
