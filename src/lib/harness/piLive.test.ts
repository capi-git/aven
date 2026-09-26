import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  request: vi.fn(),
  resolveBinary: vi.fn(),
  spawnChild: vi.fn(),
  killChild: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));

vi.mock("./child", () => ({
  killChild: mocks.killChild,
  resolveOmpBinary: vi.fn(),
  resolvePiBinary: mocks.resolveBinary,
  spawnChild: mocks.spawnChild,
  unwatchChild: vi.fn(),
  watchChild: vi.fn(),
  writeChild: vi.fn(),
}));

vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(
      _sessionId: string,
      onFrame: (record: Record<string, unknown>) => void,
    ) {
      mocks.frames.push(onFrame);
    }

    request = mocks.request;
    close = mocks.close;
    cancelRequest = vi.fn();
    pushLine = vi.fn();
  },
}));

import { compactPiContext, sendPiTurn, stopPiSession } from "./pi";
import type { HarnessEvent } from "./types";

describe("Pi live session", () => {
  beforeEach(() => {
    mocks.close.mockReset();
    mocks.request.mockReset();
    mocks.resolveBinary.mockReset();
    mocks.spawnChild.mockReset();
    mocks.killChild.mockReset();
    mocks.frames.length = 0;
    mocks.resolveBinary.mockResolvedValue({ path: "/fake/pi" });
    mocks.spawnChild.mockResolvedValue(undefined);
    mocks.killChild.mockResolvedValue(undefined);
    mocks.request.mockImplementation(
      async (command: Record<string, unknown>) => {
        if (command.type === "get_state") {
          return {
            data: {
              sessionId: "pi_session",
              model: { contextWindow: 200_000 },
            },
          };
        }
        if (command.type === "compact") {
          return { data: { estimatedTokensAfter: 32_000 } };
        }
        return { data: {} };
      },
    );
  });

  it("uses the compact RPC command and publishes the post-compact estimate", async () => {
    const events: HarnessEvent[] = [];

    await compactPiContext({
      sessionId: "pi-compact",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });

    expect(mocks.request).toHaveBeenCalledWith(
      { type: "compact" },
      30 * 60_000,
    );
    expect(events).toContainEqual({
      type: "context",
      used: 32_000,
      window: 200_000,
    });
    await stopPiSession("pi-compact");
  });

  it("publishes readable Ponytail status and extension notifications", async () => {
    const events: HarnessEvent[] = [];
    await compactPiContext({
      sessionId: "pi-ansi",
      cwd: "/repo",
      model: "pi:default",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    const frame = mocks.frames[0]!;
    frame({
      type: "extension_ui_request",
      id: "ponytail-status",
      method: "setStatus",
      statusKey: "ponytail",
      statusText:
        "\u001b[38;5;241m○\u001b[39m \u001b[38;5;244mponytail:\u001b[39m \u001b[38;5;188m⚡ FULL\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "plugin-notify",
      method: "notify",
      message: "\u001b[32mPlugin ready\u001b[0m",
    });
    frame({
      type: "extension_ui_request",
      id: "empty-status",
      method: "setStatus",
      statusText: "\u001b[0m",
    });
    expect(events.filter((event) => event.type === "status")).toEqual([
      { type: "status", text: "○ ponytail: ⚡ FULL" },
      { type: "status", text: "Plugin ready" },
    ]);
    await stopPiSession("pi-ansi");
  });

  describe("turn boundaries", () => {
    let stats: Array<() => void>;

    beforeEach(() => {
      stats = [];
      const base = mocks.request.getMockImplementation()!;
      mocks.request.mockImplementation(
        async (command: Record<string, unknown>) => {
          if (command.type === "get_session_stats")
            return new Promise((resolve) =>
              stats.push(() => resolve({ data: {} })),
            );
          return base(command);
        },
      );
    });

    const start = async (sessionId: string) => {
      let done = false;
      const turn = sendPiTurn({
        sessionId,
        cwd: "/repo",
        model: "pi:default",
        modelSettings: {},
        runtimeMode: "supervised",
        text: "fix it",
        attachments: [],
        onEvent: () => undefined,
      }).then(() => (done = true));
      await vi.waitFor(() =>
        expect(
          mocks.request.mock.calls.some(([c]) => c.type === "prompt"),
        ).toBe(true),
      );
      const frame = mocks.frames.at(-1)!;
      const flush = async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return done;
      };
      return { frame, flush, turn };
    };

    it("keeps the turn open when a retry starts while it is settling", async () => {
      const { frame, flush, turn } = await start("pi-retry");
      frame({ type: "agent_end", willRetry: false });
      await vi.waitFor(() => expect(stats).toHaveLength(1));
      frame({ type: "auto_retry_start", attempt: 1 });
      stats.shift()!();
      expect(await flush()).toBe(false);

      frame({ type: "auto_retry_end" });
      frame({ type: "agent_start" });
      expect(await flush()).toBe(false);
      frame({ type: "agent_end", willRetry: false });
      await vi.waitFor(() => expect(stats.length).toBeGreaterThan(0));
      stats.splice(0).forEach((resolve) => resolve());
      await turn;
      await stopPiSession("pi-retry");
    });

    it("finishes after compaction that follows the final answer", async () => {
      const { frame, flush, turn } = await start("pi-compact");
      frame({ type: "agent_end", willRetry: false });
      await vi.waitFor(() => expect(stats).toHaveLength(1));
      frame({ type: "compaction_start" });
      stats.shift()!();
      expect(await flush()).toBe(false);
      frame({ type: "compaction_end" });
      await vi.waitFor(() => expect(stats.length).toBeGreaterThan(0));
      stats.splice(0).forEach((resolve) => resolve());
      await turn;
      await stopPiSession("pi-compact");
    });
  });
});
