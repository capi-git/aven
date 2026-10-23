import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "./types";
import {
  installSessionPermissions,
  type SessionPermissions,
} from "./sessionPermissions";

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
    if (rec.type === "user" && typeof rec.uuid === "string")
      queueMicrotask(() =>
        onLine?.(JSON.stringify({ ...rec, isReplay: true })),
      );
  },
}));

const { sendClaudeTurn, stopClaudeSession, __claudeTestReset } =
  await import("./claude");

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

/** Run one turn; answer the CLI's start-up handshake when it launches. */
async function turn(
  sessionId: string,
  runtimeMode: SendTurnInput["runtimeMode"],
) {
  const launches = spawned.length;
  const users = parse().filter((m) => m.type === "user").length;
  const running = sendClaudeTurn({
    sessionId,
    cwd: "/data/bots/orbit-1",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode,
    text: "check",
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
    emit({ type: "system", subtype: "init", session_id: `sess_${sessionId}` });
    emit({
      type: "control_response",
      response: { subtype: "success", request_id: init.request_id },
    });
  }
  await waitFor(
    () => parse().filter((m) => m.type === "user").length > users,
    "prompt",
  );
  emit({ type: "result", subtype: "success", session_id: `sess_${sessionId}` });
  await running;
  sent.length = 0;
}

function settingsOf(args: string[]): Record<string, unknown> {
  return JSON.parse(args[args.indexOf("--settings") + 1]) as Record<
    string,
    unknown
  >;
}

function modeOf(args: string[]): string {
  return args[args.indexOf("--permission-mode") + 1];
}

describe("Claude Code launched with a chat's own permission rules", () => {
  let rules: Record<string, SessionPermissions> = {};
  let uninstall = () => {};

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    sent.length = 0;
    spawned.length = 0;
    onLine = undefined;
    rules = {};
    __claudeTestReset();
    uninstall = installSessionPermissions((id) => rules[id]);
  });

  afterEach(async () => {
    await stopClaudeSession("bot");
    await stopClaudeSession("plain");
    __claudeTestReset();
    uninstall();
    vi.unstubAllGlobals();
  });

  it("passes the ask rules in --settings and runs in auto mode whatever the picker says", async () => {
    rules.bot = {
      mode: "auto",
      rules: { ask: ["Bash(git push *)", "Edit(//Users/me/Orbit/**)"] },
    };
    await turn("bot", "full-access");
    expect(spawned).toHaveLength(1);
    const args = spawned[0];
    expect(settingsOf(args).permissions).toEqual({
      ask: ["Bash(git push *)", "Edit(//Users/me/Orbit/**)"],
    });
    expect(modeOf(args)).toBe("auto");
    expect(args).not.toContain("--allow-dangerously-skip-permissions");
    // The user's own settings still load beside them.
    expect(args).toContain("--setting-sources=user,project,local");
    expect(args).toContain("--permission-prompt-tool");
  });

  it("relaunches with new rules when they change, and keeps the CLI while they don't", async () => {
    rules.bot = { mode: "auto", rules: { ask: ["Bash(git push *)"] } };
    await turn("bot", "auto");
    await turn("bot", "auto");
    expect(spawned).toHaveLength(1);
    rules.bot = {
      mode: "auto",
      rules: { ask: ["Bash(git push *)", "Bash(rm *)"] },
    };
    await turn("bot", "auto");
    expect(spawned).toHaveLength(2);
    expect(settingsOf(spawned[1]).permissions).toEqual({
      ask: ["Bash(git push *)", "Bash(rm *)"],
    });
    expect(spawned[1][spawned[1].indexOf("--resume") + 1]).toBe("sess_bot");
  });

  it("adds nothing for an ordinary chat", async () => {
    await turn("plain", "supervised");
    const args = spawned[0];
    const settings = args.includes("--settings") ? settingsOf(args) : {};
    expect(settings.permissions).toBeUndefined();
    expect(modeOf(args)).toBe("default");
  });
});
