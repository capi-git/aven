import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";

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
  },
}));

const {
  compactClaudeContext,
  sendClaudeTurn,
  stopClaudeSession,
  __claudeTestReset,
} = await import("./claude");
import type { HarnessEvent } from "./types";
import type { RuntimeMode, TurnIntent } from "../session";

function parse() {
  return sent.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function emit(rec: Record<string, unknown>) {
  onLine!(JSON.stringify(rec));
}

const waitFor = async (pred: () => boolean, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(
    `timed out waiting for ${label}; sent=${JSON.stringify(parse())}`,
  );
};

async function startTurn(
  sessionId: string,
  options: { runtimeMode?: RuntimeMode; intent?: TurnIntent } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId,
    cwd: "/repo",
    model: "claude:claude-sonnet-5",
    modelSettings: {},
    runtimeMode: options.runtimeMode ?? "supervised",
    intent: options.intent,
    text: "explore the codebase",
    attachments: [],
    onEvent: (event) => events.push(event),
  });

  await waitFor(
    () =>
      parse().some((m) => {
        const request = m.request as Record<string, unknown> | undefined;
        return request?.subtype === "initialize";
      }),
    "initialize",
  );
  emit({ type: "system", subtype: "init", session_id: "sess_1" });
  emit({
    type: "control_response",
    response: { subtype: "success", request_id: "monocode_1" },
  });
  await waitFor(() => parse().some((m) => m.type === "user"), "user prompt");
  return { events, turn };
}

beforeEach(() => {
  sent.length = 0;
  spawned.length = 0;
  onLine = undefined;
  __claudeTestReset();
});

afterEach(async () => {
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("claude access changes", () => {
  it("relaunches with the selected permissions while preserving the conversation", async () => {
    const modes: Array<[RuntimeMode, string]> = [
      ["supervised", "default"],
      ["full-access", "bypassPermissions"],
      ["auto", "auto"],
      ["auto-accept-edits", "acceptEdits"],
      ["supervised", "default"],
    ];
    for (const [index, [runtimeMode, permissionMode]] of modes.entries()) {
      sent.length = 0;
      const { turn } = await startTurn("s1", { runtimeMode });
      const args = spawned.at(-1)!;
      expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(
        AVEN_BROWSER_HOST_POLICY,
      );
      expect(args[args.indexOf("--permission-mode") + 1]).toBe(permissionMode);
      expect(args.includes("--allow-dangerously-skip-permissions")).toBe(
        runtimeMode === "full-access",
      );
      if (index > 0) {
        expect(args[args.indexOf("--resume") + 1]).toBe("sess_1");
        expect(args).not.toContain("--session-id");
      }
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;
    }
    expect(spawned).toHaveLength(modes.length);
  });

  it("answers residual Full access approval requests without a user prompt", async () => {
    const { events, turn } = await startTurn("s1", {
      runtimeMode: "full-access",
    });
    emit({
      type: "control_request",
      request_id: "command_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "npm test" },
      },
    });
    await waitFor(
      () =>
        parse().some(
          (m) =>
            (m.response as Record<string, unknown> | undefined)?.request_id ===
            "command_1",
        ),
      "Full access approval response",
    );
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );
    expect(
      parse().find(
        (m) =>
          (m.response as Record<string, unknown> | undefined)?.request_id ===
          "command_1",
      ),
    ).toMatchObject({ response: { response: { behavior: "allow" } } });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
});

describe("claude provider errors", () => {
  it.each(["success", "error_during_execution"])(
    "preserves a synthetic API error after planning commentary and a %s result",
    async (subtype) => {
      const { events, turn } = await startTurn("s1", { intent: "plan" });
      const commentary = "I'll investigate the project and prepare assignments.";
      const message =
        "You've hit your session limit · resets 11:50am (America/Los_Angeles)";
      emit({
        type: "assistant",
        session_id: "sess_1",
        message: { content: [{ type: "text", text: commentary }] },
      });
      emit({
        type: "assistant",
        session_id: "sess_1",
        isApiErrorMessage: true,
        error: "rate_limit",
        apiErrorStatus: 429,
        message: { content: [{ type: "text", text: message }] },
      });
      emit({ type: "result", subtype, session_id: "sess_1" });
      await turn;

      expect(events.filter((event) => event.type === "session.error")).toEqual([
        { type: "session.error", message },
      ]);
      expect(events.filter((event) => event.type === "message.delta")).toEqual([
        { type: "message.delta", text: commentary },
      ]);
    },
  );

  it("keeps subagent API errors out of the parent turn", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      isApiErrorMessage: true,
      error: "rate_limit",
      apiErrorStatus: 429,
      message: { content: [{ type: "text", text: "Subagent limit reached" }] },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;

    expect(events.some((event) => event.type === "session.error")).toBe(false);
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });
});

describe("claude subagents", () => {
  it("stays busy after a parent result while a background subagent is running", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: {
              description: "Explore the auth module",
              subagent_type: "explore",
            },
          },
        ],
      },
    });
    emit({
      type: "system",
      subtype: "task_started",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      description: "Explore the auth module",
      task_type: "local_agent",
      is_backgrounded: true,
    });
    emit({
      type: "user",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_agent",
            content: "Backgrounded",
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_1",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "tool.started" &&
          event.kind === "agent" &&
          event.title === "Explore the auth module",
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );

    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "t1",
      tool_use_id: "toolu_agent",
      status: "completed",
      summary: "Found the tokens",
    });
    await turn;
    expect(settled).toBe(true);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      true,
    );
  });

  it("does not end the turn on a subagent result", async () => {
    const { events, turn } = await startTurn("s1");
    let settled = false;
    void turn.then(() => {
      settled = true;
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "result",
      subtype: "success",
      session_id: "sess_sub",
      parent_tool_use_id: "toolu_agent",
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(settled).toBe(true);
  });

  it("does not dump subagent assistant text into the parent transcript", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      session_id: "sess_1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "Explore", subagent_type: "explore" },
          },
        ],
      },
    });
    emit({
      type: "assistant",
      parent_tool_use_id: "toolu_agent",
      message: { content: [{ type: "text", text: "I will grep for tokens" }] },
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    expect(
      events.some(
        (event) =>
          event.type === "message.delta" &&
          event.text.includes("I will grep for tokens"),
      ),
    ).toBe(false);
  });
});

describe("claude plan permissions", () => {
  it("answers residual plan-mode permissions without prompting the user", async () => {
    const { events, turn } = await startTurn("s1", {
      runtimeMode: "auto",
      intent: "plan",
    });

    emit({
      type: "control_request",
      request_id: "read_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Read",
        input: { file_path: "/repo/src/App.tsx" },
      },
    });
    emit({
      type: "control_request",
      request_id: "write_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Write",
        input: { file_path: "/repo/src/new.ts" },
      },
    });

    await waitFor(
      () =>
        parse().filter((message) => message.type === "control_response")
          .length >= 2,
      "plan permission responses",
    );
    const responses = parse().filter(
      (message) => message.type === "control_response",
    );
    const read = responses.find(
      (message) =>
        (message.response as Record<string, unknown>)?.request_id === "read_1",
    );
    const write = responses.find(
      (message) =>
        (message.response as Record<string, unknown>)?.request_id === "write_1",
    );
    expect(
      (
        (read?.response as Record<string, unknown>)?.response as Record<
          string,
          unknown
        >
      )?.behavior,
    ).toBe("allow");
    expect(
      (
        (write?.response as Record<string, unknown>)?.response as Record<
          string,
          unknown
        >
      )?.behavior,
    ).toBe("deny");
    expect(events.some((event) => event.type === "approval.requested")).toBe(
      false,
    );

    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
});

describe("claude manual compaction", () => {
  it("runs the built-in command and requires a compact boundary", async () => {
    const { turn } = await startTurn("s1");
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
    sent.length = 0;

    const events: HarnessEvent[] = [];
    const compact = compactClaudeContext({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      runtimeMode: "supervised",
      onEvent: (event) => events.push(event),
    });
    await waitFor(
      () => parse().some((message) => message.type === "user"),
      "compact command",
    );
    expect(parse().find((message) => message.type === "user")).toMatchObject({
      message: { content: [{ type: "text", text: "/compact" }] },
    });

    emit({
      type: "assistant",
      session_id: "sess_1",
      message: { content: [{ type: "text", text: "not transcript output" }] },
    });
    emit({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sess_1",
    });
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await compact;

    expect(events).toContainEqual({
      type: "status",
      text: "Compacted context",
    });
    expect(events.some((event) => event.type === "message.delta")).toBe(false);
  });
});

describe("Claude message-scoped stream reconciliation", () => {
  it("does not append completed commentary/final snapshots after multiple streamed messages", async () => {
    const {events, turn} = await startTurn("s1");
    const texts = ["First commentary.\n", "Second commentary.\n", "Final answer."];
    for (const [index, text] of texts.entries()) {
      emit({type:"stream_event",event:{type:"message_start",message:{id:`msg-${index}`}}});
      emit({type:"stream_event",event:{type:"content_block_delta",index:0,delta:{type:"text_delta",text}}});
      emit({type:"assistant",message:{id:`msg-${index}`,content:[{type:"text",text}]}});
    }
    emit({type:"result",subtype:"success"}); await turn;
    // Both the transcript and orchestration's controlText consume these deltas.
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.text).join("")).toBe(texts.join(""));
  });
  it("keeps identical text from distinct message IDs while ignoring replay of the same completed ID", async () => {
    const {events, turn} = await startTurn("s1");
    for (const id of ["a","b","b"]) emit({type:"assistant",message:{id,content:[{type:"text",text:"Again. "}]}});
    emit({type:"result",subtype:"success"}); await turn;
    expect(events.filter((e) => e.type === "message.delta").map((e) => e.text).join("")).toBe("Again. Again. ");
  });
});
