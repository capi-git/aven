import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchCodexRateLimits } from "./rateLimitsFetch";

const transport = vi.hoisted(() => ({
  readers: new Map<string, (line: string) => void>(),
  requests: new Map<string, number>(),
  spawn: vi.fn(async (_id: string) => {}),
  kill: vi.fn(async (_id: string) => {}),
}));

vi.mock("./fs", () => ({ homeDir: async () => "/home/test" }));
vi.mock("./harness/child", () => ({
  resolveCodexBinary: async () => ({ path: "/bin/test-codex" }),
  spawnChild: transport.spawn,
  killChild: transport.kill,
  watchChild: (id: string, onLine: (line: string) => void) => {
    transport.readers.set(id, onLine);
  },
  unwatchChild: (id: string) => transport.readers.delete(id),
  writeChild: async (id: string, line: string) => {
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      transport.readers.get(id)?.(
        JSON.stringify({ id: request.id, result: {} }),
      );
    } else if (request.method === "account/rateLimits/read") {
      transport.requests.set(id, request.id);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  transport.readers.clear();
  transport.requests.clear();
  transport.spawn.mockClear();
  transport.kill.mockClear();
});

afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

function reply(id: string) {
  transport.readers.get(id)?.(
    JSON.stringify({
      id: transport.requests.get(id),
      result: {
        rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } },
      },
    }),
  );
}

it("keeps overlapping usage probes and their cleanup independent", async () => {
  const first = fetchCodexRateLimits();
  await vi.advanceTimersByTimeAsync(0);
  const second = fetchCodexRateLimits();
  await vi.advanceTimersByTimeAsync(0);
  const ids = transport.spawn.mock.calls.map(([id]) => id);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);

  reply(ids[0]);
  await expect(first).resolves.toMatchObject({ status: "ok" });
  expect(transport.readers.has(ids[0])).toBe(false);
  expect(transport.readers.has(ids[1])).toBe(true);
  expect(transport.kill).toHaveBeenCalledWith(ids[0]);
  expect(transport.kill).not.toHaveBeenCalledWith(ids[1]);

  reply(ids[1]);
  await expect(second).resolves.toMatchObject({ status: "ok" });
  expect(transport.readers.size).toBe(0);
  expect(transport.kill).toHaveBeenCalledWith(ids[1]);
});
