import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";
import { harnessProjectMemory, NO_PROJECT_MEMORY } from "../projectMemory";
import type { HarnessProjectMemory, SendTurnInput } from "./types";

const sent: string[] = [];
const spawned: string[][] = [];
let onLine: ((line: string) => void) | undefined;

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (_id: string, _path: string, args: string[]) => {
    spawned.push(args);
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
    const rec = JSON.parse(line) as Record<string, unknown>;
    // Like --replay-user-messages: Claude echoes each prompt as it starts.
    if (rec.type === "user" && typeof rec.uuid === "string")
      queueMicrotask(() =>
        onLine?.(JSON.stringify({ ...rec, isReplay: true })),
      );
  },
}));

const {
  compactClaudeContext,
  sendClaudeTurn,
  stopClaudeSession,
  __claudeTestReset,
} = await import("./claude");
const { ensureClaudeRegistered } = await import("./claudeAdapter");
const { resetHarnessIdlePark, sendHarnessTurn } = await import("./registry");
const { resetProjectMemoryDeliveryState } =
  await import("./projectMemoryDelivery");

const ONE = harnessProjectMemory("- Use pnpm, not npm.");
const TWO = harnessProjectMemory("- Use pnpm, not npm.\n- Ship small.");

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function emit(rec: Record<string, unknown>) {
  onLine!(JSON.stringify(rec));
}

async function waitFor(pred: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

const prompts: string[] = [];

/** The text of the last prompt the CLI received. */
function lastPrompt(): string {
  return prompts.at(-1) ?? "";
}

/** Run one turn; answer the CLI's start-up handshake when it relaunches. */
async function turn(
  projectMemory: HarnessProjectMemory | undefined,
  send: (input: SendTurnInput) => Promise<void> = sendClaudeTurn,
) {
  const launches = spawned.length;
  const users = parse().filter((m) => m.type === "user").length;
  const running = send({
    sessionId: "s1",
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: "supervised",
    text: "explore the codebase",
    projectMemory,
    onEvent: () => undefined,
  });
  await waitFor(
    () =>
      spawned.length > launches ||
      parse().filter((m) => m.type === "user").length > users,
    "launch or prompt",
  );
  if (spawned.length > launches) {
    const inits = () =>
      parse().filter(
        (m) =>
          (m.request as Record<string, unknown> | undefined)?.subtype ===
          "initialize",
      );
    await waitFor(() => inits().length > 0, "initialize");
    const init = inits().at(-1)!;
    emit({ type: "system", subtype: "init", session_id: "sess_1" });
    emit({
      type: "control_response",
      response: { subtype: "success", request_id: init.request_id },
    });
  }
  await waitFor(
    () => parse().filter((m) => m.type === "user").length > users,
    "prompt",
  );
  prompts.push(
    promptText(
      parse()
        .filter((m) => m.type === "user")
        .at(-1)!,
    ),
  );
  emit({ type: "result", subtype: "success", session_id: "sess_1" });
  await running;
  sent.length = 0;
}

function promptText(message: Record<string, unknown>): string {
  const content = (message.message as { content: unknown }).content;
  if (typeof content === "string") return content;
  return (content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function appended(args: string[]) {
  return args[args.indexOf("--append-system-prompt") + 1];
}

describe("Claude Code project memory", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    sent.length = 0;
    spawned.length = 0;
    prompts.length = 0;
    onLine = undefined;
    __claudeTestReset();
    resetProjectMemoryDeliveryState();
  });

  afterEach(async () => {
    await stopClaudeSession("s1");
    __claudeTestReset();
    resetHarnessIdlePark();
    resetProjectMemoryDeliveryState();
    vi.unstubAllGlobals();
  });

  it("appends the memory to a new CLI's system prompt and keeps a running CLI when it changes", async () => {
    await turn(ONE);
    expect(spawned).toHaveLength(1);
    expect(appended(spawned[0])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${ONE.text}`,
    );
    expect(spawned[0]).toContain("--session-id");

    await turn(ONE);
    expect(spawned).toHaveLength(1);

    // A change reaches a chat under way ahead of its next message (see the
    // registry test below), so the CLI is not restarted for it.
    await turn(TWO);
    expect(spawned).toHaveLength(1);
    await turn(undefined);
    expect(spawned).toHaveLength(1);
    await turn(NO_PROJECT_MEMORY);
    expect(spawned).toHaveLength(1);

    // The next CLI for the chat starts with the memory it has now.
    await turn(TWO);
    await stopClaudeSession("s1");
    await turn(TWO);
    expect(spawned).toHaveLength(2);
    expect(appended(spawned[1])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${TWO.text}`,
    );
    expect(spawned[1][spawned[1].indexOf("--resume") + 1]).toBe("sess_1");
  });

  it("gives a chat under way a memory change ahead of its next message, without a restart", async () => {
    ensureClaudeRegistered();
    const send = (projectMemory: HarnessProjectMemory, text: string) =>
      turn(projectMemory, (input) =>
        sendHarnessTurn({ ...input, harness: "claude", text }),
      );
    await send(ONE, "first");
    expect(spawned).toHaveLength(1);
    expect(appended(spawned[0])).toContain(ONE.text);

    await send(ONE, "second");
    expect(lastPrompt()).toBe("second");

    await send(TWO, "third");
    expect(spawned).toHaveLength(1);
    const prompt = lastPrompt();
    expect(prompt).toContain(
      "This replaces the project memory given earlier in this conversation.",
    );
    expect(prompt).toContain("- Ship small.");
    expect(prompt.endsWith("\n\nthird")).toBe(true);

    // Given once: the next message goes alone.
    await send(TWO, "fourth");
    expect(lastPrompt()).toBe("fourth");
    expect(spawned).toHaveLength(1);
  });

  it("compacting a chat whose memory changed relaunches it with the current memory", async () => {
    await turn(ONE);
    await turn(TWO);
    expect(spawned).toHaveLength(1);
    const compacting = compactClaudeContext({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(() => spawned.length === 2, "relaunch");
    expect(appended(spawned[1])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${TWO.text}`,
    );
    await stopClaudeSession("s1");
    await compacting.catch(() => undefined);
  });

  it("keeps the memory when compaction relaunches the CLI", async () => {
    await turn(ONE);
    await stopClaudeSession("s1");
    const compacting = compactClaudeContext({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      modelSettings: {},
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    await waitFor(() => spawned.length === 2, "relaunch");
    expect(appended(spawned[1])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${ONE.text}`,
    );
    await stopClaudeSession("s1");
    await compacting.catch(() => undefined);
  });
});
