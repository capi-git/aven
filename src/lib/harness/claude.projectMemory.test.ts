import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";
import { harnessProjectMemory, NO_PROJECT_MEMORY } from "../projectMemory";
import type { HarnessProjectMemory } from "./types";

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

/** Run one turn; answer the CLI's start-up handshake when it relaunches. */
async function turn(projectMemory: HarnessProjectMemory | undefined) {
  const launches = spawned.length;
  const users = parse().filter((m) => m.type === "user").length;
  const running = sendClaudeTurn({
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
  emit({ type: "result", subtype: "success", session_id: "sess_1" });
  await running;
  sent.length = 0;
}

function appended(args: string[]) {
  return args[args.indexOf("--append-system-prompt") + 1];
}

describe("Claude Code project memory", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    sent.length = 0;
    spawned.length = 0;
    onLine = undefined;
    __claudeTestReset();
  });

  afterEach(async () => {
    await stopClaudeSession("s1");
    __claudeTestReset();
    vi.unstubAllGlobals();
  });

  it("appends the memory to the system prompt and relaunches with the conversation when it changes", async () => {
    await turn(ONE);
    expect(spawned).toHaveLength(1);
    expect(appended(spawned[0])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${ONE.text}`,
    );
    expect(spawned[0]).toContain("--session-id");

    await turn(ONE);
    expect(spawned).toHaveLength(1);

    await turn(TWO);
    expect(spawned).toHaveLength(2);
    expect(appended(spawned[1])).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${TWO.text}`,
    );
    expect(spawned[1][spawned[1].indexOf("--resume") + 1]).toBe("sess_1");

    // A turn that does not know the memory keeps the running process.
    await turn(undefined);
    expect(spawned).toHaveLength(2);

    await turn(NO_PROJECT_MEMORY);
    expect(spawned).toHaveLength(3);
    expect(appended(spawned[2])).toBe(AVEN_BROWSER_HOST_POLICY);
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
