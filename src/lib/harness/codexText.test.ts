import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Request = {
  id?: number;
  method: string;
  params?: Record<string, unknown>;
};

const sent: Request[] = [];
let onLine: ((line: string) => void) | undefined;

function receive(message: unknown) {
  onLine?.(JSON.stringify(message));
}

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (value: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    const request = JSON.parse(line) as Request;
    sent.push(request);
    if (request.id === undefined) return;
    if (request.method === "thread/start") {
      receive({ id: request.id, result: { thread: { id: "thread_1" } } });
    } else if (request.method === "turn/start") {
      receive({ id: request.id, result: { turn: { id: "turn_1" } } });
      setTimeout(() => {
        receive({
          method: "item/agentMessage/delta",
          params: { delta: "Generated text" },
        });
        receive({
          method: "turn/completed",
          params: { turn: { id: "turn_1", status: "completed" } },
        });
      }, 0);
    } else {
      receive({ id: request.id, result: {} });
    }
  },
}));

const { runCodexTextPrompt, stopCodexTextPrompt } = await import("./codexText");

beforeEach(() => {
  sent.length = 0;
  onLine = undefined;
});

afterEach(async () => {
  await stopCodexTextPrompt();
});

it("keeps generated-text threads out of saved Codex history", async () => {
  await expect(
    runCodexTextPrompt({ cwd: "/repo", prompt: "Title this" }),
  ).resolves.toBe("Generated text");
  const starts = sent.filter((request) => request.method === "thread/start");
  expect(starts).toHaveLength(1);
  expect(starts[0].params).toMatchObject({ cwd: "/repo", ephemeral: true });
});
