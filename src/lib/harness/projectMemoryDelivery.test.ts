import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harnessDescriptor, HARNESS_IDS } from "./descriptors";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";
import { buildClaudeSpawnArgs, claudeSettingsKey } from "./claudeProtocol";
import {
  buildThreadStartParams,
  codexDeveloperInstructions,
} from "./codexProtocol";
import {
  PROJECT_MEMORY_CHANNELS,
  planProjectMemoryDelivery,
  resetProjectMemoryDeliveryState,
  type ProjectMemoryChannel,
} from "./projectMemoryDelivery";
import {
  bindHarnessSession,
  compactHarnessContext,
  forgetHarnessSession,
  registerHarness,
  resetHarnessIdlePark,
  sendHarnessTurn,
  type HarnessAdapter,
} from "./registry";
import type { HarnessProjectMemory, SendTurnInput } from "./types";
import { harnessProjectMemory, NO_PROJECT_MEMORY } from "../projectMemory";
import type { HarnessId } from "../session";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async () => undefined,
}));

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

const ONE = harnessProjectMemory("- Use pnpm, not npm.");
const TWO = harnessProjectMemory("- Use pnpm, not npm.\n- Ship small.");
const UPDATE_OPEN =
  "<aven-project-memory>\nThis replaces the project memory given earlier in this conversation.\n";
const CLEARED =
  "<aven-project-memory>\nThe project memory Aven gave earlier in this conversation was cleared. Disregard it.\n</aven-project-memory>";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectMemoryDeliveryState();
});

afterEach(() => {
  resetHarnessIdlePark();
  vi.unstubAllGlobals();
});

describe("how each provider receives project memory", () => {
  it("names a channel for every provider", () => {
    expect(Object.keys(PROJECT_MEMORY_CHANNELS).sort()).toEqual(
      [...HARNESS_IDS].sort(),
    );
    expect(PROJECT_MEMORY_CHANNELS).toEqual({
      claude: "system",
      codex: "developer",
      cursor: "message",
      grok: "message",
      opencode: "message",
      pi: "message",
      omp: "message",
      fx: "message",
    });
  });

  it("Claude Code appends the memory after Aven's host routing in one system prompt value", () => {
    const args = buildClaudeSpawnArgs({
      sessionId: "s",
      projectMemory: ONE.text,
    });
    expect(args.filter((arg) => arg === "--append-system-prompt")).toHaveLength(
      1,
    );
    expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(
      `${AVEN_BROWSER_HOST_POLICY}\n\n${ONE.text}`,
    );
    expect(args).not.toContain("--system-prompt");
    // Without memory the value is exactly the host routing, as before.
    const plain = buildClaudeSpawnArgs({ sessionId: "s" });
    expect(plain[plain.indexOf("--append-system-prompt") + 1]).toBe(
      AVEN_BROWSER_HOST_POLICY,
    );
    // Aven's own helper calls (titles, summaries) never receive it.
    const isolated = buildClaudeSpawnArgs({
      isolated: true,
      projectMemory: ONE.text,
    });
    expect(isolated.join(" ")).not.toContain("aven-project-memory");
  });

  it("Claude Code relaunches when the memory changes", () => {
    const base = {
      model: "claude-sonnet-5",
      runtimeMode: "supervised" as const,
    };
    expect(claudeSettingsKey({ ...base, memory: ONE.revision })).not.toBe(
      claudeSettingsKey({ ...base, memory: TWO.revision }),
    );
    expect(claudeSettingsKey(base)).toBe(
      claudeSettingsKey({ ...base, memory: "" }),
    );
  });

  it("Codex adds the memory to the thread's developer instructions", () => {
    const host = `Configured text\n\n${AVEN_BROWSER_HOST_POLICY}`;
    const instructions = codexDeveloperInstructions(host, ONE.text);
    expect(instructions).toBe(`${host}\n\n${ONE.text}`);
    expect(
      buildThreadStartParams({
        cwd: "/repo",
        runtimeMode: "supervised",
        browserHostInstructions: instructions,
      }).developerInstructions,
    ).toBe(`${host}\n\n${ONE.text}`);
    expect(codexDeveloperInstructions(host, undefined)).toBe(host);
    // A selected configuration profile keeps its own instructions untouched.
    expect(codexDeveloperInstructions(undefined, ONE.text)).toBeUndefined();
  });
});

describe("planning a turn's memory", () => {
  const plan = (
    channel: ProjectMemoryChannel,
    options: {
      memory?: HarnessProjectMemory;
      known?: string;
      continuing?: boolean;
      command?: boolean;
    },
  ) =>
    planProjectMemoryDelivery({
      channel,
      memory: options.memory,
      known: options.known,
      continuing: options.continuing ?? false,
      command: options.command ?? false,
    });

  it.each(["system", "developer"] as const)(
    "%s: a new conversation gets it at launch, not in the message",
    (channel) => {
      expect(plan(channel, { memory: ONE })).toEqual({
        prefix: "",
        deliver: ONE.revision,
      });
      expect(plan(channel, { memory: NO_PROJECT_MEMORY })).toEqual({
        prefix: "",
      });
    },
  );

  it("message: a new conversation gets it ahead of the first message", () => {
    expect(plan("message", { memory: ONE })).toEqual({
      prefix: ONE.text,
      deliver: ONE.revision,
    });
    expect(plan("message", { memory: NO_PROJECT_MEMORY })).toEqual({
      prefix: "",
    });
  });

  it.each(["system", "developer", "message"] as const)(
    "%s: a conversation under way gets a change once, marked as a replacement",
    (channel) => {
      expect(
        plan(channel, { memory: ONE, known: ONE.revision, continuing: true }),
      ).toEqual({ prefix: "" });
      const changed = plan(channel, {
        memory: TWO,
        known: ONE.revision,
        continuing: true,
      });
      expect(changed.deliver).toBe(TWO.revision);
      expect(changed.prefix).toBe(
        `${UPDATE_OPEN}${TWO.text.slice("<aven-project-memory>\n".length)}`,
      );
      // A resumed conversation with no record gets the memory as it is.
      expect(plan(channel, { memory: TWO, continuing: true })).toEqual({
        prefix: TWO.text,
        deliver: TWO.revision,
      });
    },
  );

  it("tells a conversation once when its memory was cleared", () => {
    expect(
      plan("system", {
        memory: NO_PROJECT_MEMORY,
        known: ONE.revision,
        continuing: true,
      }),
    ).toEqual({ prefix: CLEARED, deliver: "" });
    expect(
      plan("system", {
        memory: NO_PROJECT_MEMORY,
        known: "",
        continuing: true,
      }),
    ).toEqual({ prefix: "" });
  });

  it("leaves provider commands and unreadable memory alone", () => {
    expect(plan("message", { memory: ONE, command: true })).toEqual({
      prefix: "",
    });
    expect(
      plan("message", {
        memory: undefined,
        known: ONE.revision,
        continuing: true,
      }),
    ).toEqual({ prefix: "" });
  });
});

describe("delivery through the harness registry", () => {
  const received: SendTurnInput[] = [];

  function adapter(id: HarnessId, providerId = `${id}-conversation`) {
    const value: HarnessAdapter = {
      id,
      descriptor: harnessDescriptor(id),
      live: true,
      async sendTurn(input) {
        received.push(input);
        input.onEvent({
          type: "session.providerBound",
          providerSessionId: providerId,
        });
      },
      async compactContext(input) {
        received.push({ ...input, text: "/compact" });
      },
      async steerTurn() {},
      async cancelTurn() {},
      respondApproval() {},
      async stopSession() {},
      async forgetSession() {},
      bindSession() {},
    };
    registerHarness(value);
    return value;
  }

  async function send(
    harness: HarnessId,
    text: string,
    projectMemory?: HarnessProjectMemory,
    cwd = "/repo",
  ) {
    await sendHarnessTurn({
      harness,
      sessionId: "chat",
      cwd,
      model: "",
      runtimeMode: "supervised",
      text,
      projectMemory,
      onEvent: () => undefined,
    });
    return received.at(-1)!;
  }

  beforeEach(() => {
    received.length = 0;
  });

  it("Cursor and other message providers get it ahead of the first message only", async () => {
    adapter("cursor");
    expect((await send("cursor", "Fix the build", ONE)).text).toBe(
      `${ONE.text}\n\nFix the build`,
    );
    expect((await send("cursor", "And the tests", ONE)).text).toBe(
      "And the tests",
    );
    // An edit reaches the next message, once.
    expect((await send("cursor", "Next", TWO)).text).toBe(
      `${UPDATE_OPEN}${TWO.text.slice("<aven-project-memory>\n".length)}\n\nNext`,
    );
    expect((await send("cursor", "Then", TWO)).text).toBe("Then");
    // Provider commands reach the CLI untouched.
    expect((await send("cursor", "/compact", ONE)).text).toBe("/compact");
  });

  it("Claude Code takes it at launch for a new conversation and by message after an edit", async () => {
    adapter("claude");
    const first = await send("claude", "Start", ONE);
    expect(first.text).toBe("Start");
    expect(first.projectMemory).toEqual(ONE);
    expect((await send("claude", "Go on", ONE)).text).toBe("Go on");
    expect((await send("claude", "Edited", TWO)).text).toMatch(
      /^<aven-project-memory>\nThis replaces/,
    );
    // Not knowing the memory changes nothing, and is not taken as cleared.
    expect((await send("claude", "Handoff", undefined)).text).toBe("Handoff");
    expect((await send("claude", "Cleared", NO_PROJECT_MEMORY)).text).toBe(
      `${CLEARED}\n\nCleared`,
    );
  });

  it("a restored chat that already had this memory does not get it again", async () => {
    adapter("cursor");
    await send("cursor", "Before restart", ONE);
    // An app restart forgets in-memory state; the record survives in storage.
    resetProjectMemoryDeliveryState();
    bindHarnessSession("cursor", "chat", "cursor-conversation", "/repo");
    expect((await send("cursor", "After restart", ONE)).text).toBe(
      "After restart",
    );
    expect(localStorage.getItem("aven.projectMemory.delivered")).toBe(
      JSON.stringify({ "cursor-conversation": ONE.revision }),
    );
  });

  it("a restored Claude conversation without a record gets the memory once", async () => {
    adapter("claude", "resumed");
    bindHarnessSession("claude", "chat", "resumed", "/repo");
    expect((await send("claude", "Resume", ONE)).text).toBe(
      `${ONE.text}\n\nResume`,
    );
    expect((await send("claude", "Again", ONE)).text).toBe("Again");
  });

  it("a new provider or folder starts a new conversation that gets it again", async () => {
    adapter("cursor");
    adapter("codex");
    await send("cursor", "One", ONE);
    await forgetHarnessSession("cursor", "chat");
    // Codex takes it in its developer instructions at launch.
    expect((await send("codex", "Two", ONE)).text).toBe("Two");
    // A different working folder is a different provider conversation.
    adapter("cursor", "worktree-conversation");
    expect((await send("cursor", "Three", ONE, "/repo-copy")).text).toBe(
      `${ONE.text}\n\nThree`,
    );
  });

  it("gives it again after compaction, except where the system prompt keeps it", async () => {
    adapter("cursor");
    await send("cursor", "One", ONE);
    await compactHarnessContext({
      harness: "cursor",
      sessionId: "chat",
      cwd: "/repo",
      model: "",
      runtimeMode: "supervised",
      onEvent: () => undefined,
    });
    expect((await send("cursor", "After compaction", ONE)).text).toBe(
      `${ONE.text}\n\nAfter compaction`,
    );
  });
});
