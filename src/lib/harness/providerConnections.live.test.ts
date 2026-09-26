import { describe, expect, it, vi } from "vitest";

const spawned: string[] = [];
const killed: string[] = [];
const lineHandlers = new Map<string, (line: string) => void>();

vi.mock("./child", () => ({
  acquireHarnessBridge: async () => () => undefined,
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async (id: string) => {
    spawned.push(id);
  },
  killChild: async (id: string) => {
    killed.push(id);
  },
  unwatchChild: (id: string) => lineHandlers.delete(id),
  watchChild: (id: string, line: (l: string) => void) => lineHandlers.set(id, line),
  writeChild: async (id: string, line: string) => {
    const message = JSON.parse(line) as { id?: number; method?: string };
    const result =
      message.method === "mcpServerStatus/list"
        ? { data: [{ name: "docs", tools: { a: {} }, authStatus: "unsupported" }], nextCursor: null }
        : {};
    if (message.id !== undefined)
      queueMicrotask(() => lineHandlers.get(id)?.(JSON.stringify({ id: message.id, result })));
  },
}));

const { listCodexConnections } = await import("./providerConnections");

describe("connection checks", () => {
  it("shares one check between simultaneous callers and cleans up only its own process", async () => {
    const [first, second] = await Promise.all([
      listCodexConnections("/repo"),
      listCodexConnections("/repo"),
    ]);
    expect(first).toEqual([
      { name: "docs", key: "docs", removable: true, state: "ready", toolCount: 1 },
    ]);
    expect(second).toBe(first);
    expect(spawned).toHaveLength(1);
    expect(killed).toEqual(spawned);

    await listCodexConnections("/repo");
    expect(spawned).toHaveLength(2);
    expect(spawned[1]).not.toBe(spawned[0]);
  });
});
