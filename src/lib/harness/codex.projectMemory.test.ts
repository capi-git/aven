import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";
import { harnessProjectMemory } from "../projectMemory";
import type { HarnessProjectMemory } from "./types";

const sent: string[] = [];
let onLine: ((line: string) => void) | undefined;
let configReadResponse: unknown;

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  prepareCodexStorage: async () => ({ home: "/aven/codex-home" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
    const message = JSON.parse(line) as { id?: number; method?: string };
    if (message.method === "config/read")
      queueMicrotask(() =>
        onLine?.(
          JSON.stringify({ id: message.id, result: configReadResponse }),
        ),
      );
  },
}));

const { bindCodexSession, sendCodexTurn, stopCodexSession, __codexTestReset } =
  await import("./codex");

const MEMORY = harnessProjectMemory("- Use pnpm, not npm.");

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reply(id: number, result: unknown) {
  onLine!(JSON.stringify({ id, result }));
}

async function waitFor(pred: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function runTurn(
  projectMemory: HarnessProjectMemory | undefined,
  options: { resume?: boolean; text?: string } = {},
) {
  const turn = sendCodexTurn({
    sessionId: "codex-memory",
    cwd: "/repo",
    model: "codex:gpt-5.4",
    runtimeMode: "supervised",
    text: options.text ?? "summarize the changelog",
    projectMemory,
    onEvent: () => undefined,
  });
  await waitFor(() => parse().some((m) => m.method === "initialize"), "init");
  reply(parse().find((m) => m.method === "initialize")!.id as number, {});
  const open = options.resume ? "thread/resume" : "thread/start";
  await waitFor(() => parse().some((m) => m.method === open), open);
  reply(parse().find((m) => m.method === open)!.id as number, {
    thread: { id: "thr_1" },
  });
  await waitFor(() => parse().some((m) => m.method === "turn/start"), "turn");
  reply(parse().find((m) => m.method === "turn/start")!.id as number, {
    turn: { id: "turn_1", status: "inProgress" },
  });
  onLine!(
    JSON.stringify({
      method: "turn/completed",
      params: { turn: { id: "turn_1", status: "completed" } },
    }),
  );
  await turn;
  return {
    open: parse().find((m) => m.method === open)!.params as Record<
      string,
      unknown
    >,
    turn: parse().find((m) => m.method === "turn/start")!.params as {
      input: Array<{ type: string; text?: string }>;
    },
  };
}

describe("Codex project memory", () => {
  beforeEach(() => {
    sent.length = 0;
    onLine = undefined;
    configReadResponse = { config: { sqlite_home: "/aven/codex-home" } };
  });

  afterEach(async () => {
    await stopCodexSession("codex-memory");
    __codexTestReset();
  });

  it.each([false, true])(
    "puts the memory after host routing in the developer instructions (resume=%s)",
    async (resume) => {
      if (resume) bindCodexSession("codex-memory", "thr_1", "/repo");
      const { open, turn } = await runTurn(MEMORY, { resume });
      expect(open.developerInstructions).toBe(
        `${AVEN_BROWSER_HOST_POLICY}\n\n${MEMORY.text}`,
      );
      // The message itself is the user's turn only.
      expect(turn.input[0]).toEqual({
        type: "text",
        text: "summarize the changelog",
      });
    },
  );

  it("keeps configured developer text first", async () => {
    configReadResponse = {
      config: {
        sqlite_home: "/aven/codex-home",
        developer_instructions: "Keep my custom workflow.",
      },
    };
    const { open } = await runTurn(MEMORY);
    expect(open.developerInstructions).toBe(
      `Keep my custom workflow.\n\n${AVEN_BROWSER_HOST_POLICY}\n\n${MEMORY.text}`,
    );
  });

  it("gives a new thread the memory in its first message when a profile owns the instructions", async () => {
    configReadResponse = {
      config: { sqlite_home: "/aven/codex-home", profile: "custom" },
    };
    const { open, turn } = await runTurn(MEMORY);
    expect(open).not.toHaveProperty("developerInstructions");
    expect(turn.input[0]).toEqual({
      type: "text",
      text: `${MEMORY.text}\n\nsummarize the changelog`,
    });
  });

  it("leaves the instructions as before without memory", async () => {
    const { open } = await runTurn(undefined);
    expect(open.developerInstructions).toBe(AVEN_BROWSER_HOST_POLICY);
  });
});
