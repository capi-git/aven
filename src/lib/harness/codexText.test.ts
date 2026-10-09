import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  sent: [] as { method?: string; params?: Record<string, unknown> }[],
  onLine: undefined as ((line: string) => void) | undefined,
  stateHome: "/aven/codex-home",
}));

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  prepareCodexStorage: async () => ({ home: "/aven/codex-home" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (line: string) => void) => {
    transport.onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    const request = JSON.parse(line);
    transport.sent.push(request);
    if (request.id == null) return;
    queueMicrotask(() => {
      transport.onLine?.(
        JSON.stringify({
          id: request.id,
          result:
            request.method === "thread/start"
              ? { thread: { id: "temporary-text-thread", ephemeral: true } }
              : request.method === "config/read"
                ? { config: { sqlite_home: transport.stateHome } }
                : {},
        }),
      );
      if (request.method === "turn/start") {
        transport.onLine?.(
          JSON.stringify({
            method: "item/agentMessage/delta",
            params: { delta: '{"title":"Medication card variants"}' },
          }),
        );
        transport.onLine?.(
          JSON.stringify({
            method: "turn/completed",
            params: { turn: { status: "completed" } },
          }),
        );
      }
    });
  },
}));

import {
  runCodexTextPrompt,
  stopCodexTextPrompt,
  warmupCodexText,
} from "./codexText";

afterEach(async () => {
  await stopCodexTextPrompt();
  transport.sent.length = 0;
  transport.onLine = undefined;
  transport.stateHome = "/aven/codex-home";
});

describe("Codex background text history", () => {
  it("does not create any helper thread when configuration routes state to shared history", async () => {
    transport.stateHome = "/shared/.codex";
    await warmupCodexText("/repo");
    await expect(
      runCodexTextPrompt({ cwd: "/repo", prompt: "Generate a title" }),
    ).rejects.toThrow("No chat was started");
    expect(
      transport.sent.some((request) => request.method === "thread/start"),
    ).toBe(false);
  });

  it("warms up without creating a saved thread, then still returns generated text", async () => {
    await warmupCodexText("/repo");
    expect(
      transport.sent.filter((request) => request.method === "thread/start"),
    ).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ cwd: "/repo", ephemeral: true }),
      }),
    ]);
    expect(
      await runCodexTextPrompt({ cwd: "/repo", prompt: "Generate a title" }),
    ).toBe('{"title":"Medication card variants"}');
    expect(
      transport.sent.filter((request) => request.method === "thread/start"),
    ).toHaveLength(1);
  });

  it("keeps each fresh background request temporary after the previous process closes", async () => {
    await runCodexTextPrompt({ cwd: "/repo", prompt: "Generate a title" });
    await runCodexTextPrompt({
      cwd: "/another repo",
      prompt: "Summarize changes",
    });
    const starts = transport.sent.filter(
      (request) => request.method === "thread/start",
    );
    expect(starts).toHaveLength(2);
    expect(starts.every((request) => request.params?.ephemeral === true)).toBe(
      true,
    );
    expect(starts.map((request) => request.params?.cwd)).toEqual([
      "/repo",
      "/another repo",
    ]);
  });
});
