import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";

const sent: string[] = [];
const spawned: string[][] = [];
const killed: string[] = [];
let killWait: Promise<void> | undefined;
let killError: Error | undefined;
let onLine: ((line: string) => void) | undefined;
let onExit: ((code: number | null) => void) | undefined;

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => ({ path: "/fake/claude" }),
  spawnChild: async (_id: string, _path: string, args: string[]) => {
    spawned.push(args);
  },
  killChild: async (id: string) => {
    killed.push(id);
    await killWait;
    if (killError) throw killError;
  },
  unwatchChild: () => undefined,
  watchChild: (
    _id: string,
    line: (l: string) => void,
    exit: (code: number | null) => void,
  ) => {
    onLine = line;
    onExit = exit;
  },
  writeChild: async (_id: string, line: string) => {
    sent.push(line);
  },
}));

const {
  compactClaudeContext,
  cancelClaudeTurn,
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
  options: {
    runtimeMode?: RuntimeMode;
    intent?: TurnIntent;
    model?: string;
    modelSettings?: Record<string, string>;
  } = {},
) {
  const events: HarnessEvent[] = [];
  const turn = sendClaudeTurn({
    sessionId,
    cwd: "/repo",
    model: options.model ?? "claude:claude-sonnet-5",
    modelSettings: options.modelSettings ?? {},
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
  killed.length = 0;
  killWait = undefined;
  killError = undefined;
  onLine = undefined;
  onExit = undefined;
  __claudeTestReset();
});

afterEach(async () => {
  killError = undefined;
  await stopClaudeSession("s1");
  __claudeTestReset();
});

describe("Opus 5.5 launch", () => {
  it("sends the exact model and selected effort without optional context suffixes", async () => {
    const { turn } = await startTurn("s1", {
      model: "claude:opus-5.5",
      modelSettings: { effort: "medium", context: "1m", fast: "false" },
    });
    const args = spawned.at(-1)!;
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
    const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
    expect(settings.fastMode).not.toBe(true);
    expect(settings.alwaysThinkingEnabled).toBeUndefined();
    emit({ type: "result", subtype: "success", session_id: "sess_1" });
    await turn;
  });
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
  const expiredSession =
    "Failed to authenticate: OAuth session expired and could not be refreshed";

  it.each([false, true])(
    "reports an OAuth failure once with a success result and is_error=%s",
    async (isError) => {
      const { events, turn } = await startTurn("s1");
      emit({
        type: "assistant",
        session_id: "sess_1",
        error: "authentication_failed",
        message: { content: [{ type: "text", text: expiredSession }] },
      });
      emit({
        type: "result",
        subtype: "success",
        is_error: isError,
        result: expiredSession,
        session_id: "sess_1",
      });
      await turn;
      expect(events.filter((event) => event.type === "session.error")).toEqual([
        { type: "session.error", message: expiredSession },
      ]);
      expect(events.some((event) => event.type === "message.delta")).toBe(
        false,
      );
      expect(killed).toEqual(["s1"]);
    },
  );

  it("reports an error result even if the assistant envelope was omitted", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "result",
      subtype: "success",
      is_error: true,
      result: expiredSession,
      session_id: "sess_1",
    });
    await turn;
    expect(events.filter((event) => event.type === "session.error")).toEqual([
      { type: "session.error", message: expiredSession },
    ]);
    expect(killed).toEqual(["s1"]);
  });

  it("restarts after a provider failure without losing the resumed conversation", async () => {
    const first = await startTurn("s1");
    emit({
      type: "assistant",
      error: "authentication_failed",
      message: { content: [{ type: "text", text: expiredSession }] },
    });
    emit({ type: "result", subtype: "success", is_error: true });
    await first.turn;
    sent.length = 0;

    const retry = await startTurn("s1");
    expect(spawned).toHaveLength(2);
    const retryArgs = spawned.at(-1)!;
    expect(retryArgs[retryArgs.indexOf("--resume") + 1]).toBe("sess_1");
    expect(retryArgs).not.toContain("--session-id");
    emit({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello!" }] },
    });
    emit({ type: "result", subtype: "success", is_error: false });
    await retry.turn;
    expect(retry.events.some((event) => event.type === "session.error")).toBe(
      false,
    );
    expect(killed).toEqual(["s1"]);
  });

  it("does not turn discussion of authentication errors into a failed turn", async () => {
    const { events, turn } = await startTurn("s1");
    emit({
      type: "assistant",
      message: { content: [{ type: "text", text: expiredSession }] },
    });
    emit({ type: "result", subtype: "success", is_error: false });
    await turn;
    expect(events.some((event) => event.type === "session.error")).toBe(false);
    expect(events.filter((event) => event.type === "message.delta")).toEqual([
      { type: "message.delta", text: expiredSession },
    ]);
  });

  it("waits for failed-process disposal before starting an immediate retry", async () => {
    const first = await startTurn("s1");
    let releaseKill = () => {};
    killWait = new Promise<void>((resolve) => {
      releaseKill = resolve;
    });
    emit({
      type: "assistant",
      error: "authentication_failed",
      message: { content: [{ type: "text", text: expiredSession }] },
    });
    emit({ type: "result", subtype: "success", is_error: true });
    await waitFor(() => killed.length === 1, "failed process disposal");
    sent.length = 0;
    const retryReady = startTurn("s1");
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(spawned).toHaveLength(1);
    } finally {
      releaseKill();
    }
    await first.turn;
    const retry = await retryReady;
    expect(spawned).toHaveLength(2);
    emit({ type: "result", subtype: "success", is_error: false });
    await retry.turn;
    expect(retry.events.some((event) => event.type === "session.error")).toBe(
      false,
    );
  });

  it.each(["success", "error_during_execution"])(
    "preserves a synthetic API error after planning commentary and a %s result",
    async (subtype) => {
      const { events, turn } = await startTurn("s1", { intent: "plan" });
      const commentary =
        "I'll investigate the project and prepare assignments.";
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

  it.each([false, true])(
    "keeps subagent API errors out of the parent turn (legacy marker=%s)",
    async (legacyMarker) => {
      const { events, turn } = await startTurn("s1");
      emit({
        type: "assistant",
        parent_tool_use_id: "toolu_agent",
        ...(legacyMarker ? { isApiErrorMessage: true } : {}),
        error: "rate_limit",
        apiErrorStatus: 429,
        message: {
          content: [{ type: "text", text: "Subagent limit reached" }],
        },
      });
      emit({ type: "result", subtype: "success", session_id: "sess_1" });
      await turn;

      expect(events.some((event) => event.type === "session.error")).toBe(
        false,
      );
      expect(events.some((event) => event.type === "message.delta")).toBe(
        false,
      );
      expect(killed).toEqual([]);
    },
  );
});

describe("claude subagents", () => {
  const taskStarted = (taskId: string, options: Record<string, unknown> = {}) =>
    emit({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      task_type: "local_agent",
      description: "Inspect the app",
      is_backgrounded: true,
      ...options,
    });
  const taskFinished = (taskId: string) =>
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      status: "completed",
      summary: "Inspection complete",
    });
  const backgroundTasks = (...ids: string[]) =>
    emit({
      type: "system",
      subtype: "background_tasks_changed",
      tasks: ids.map((id) => ({
        task_id: id,
        task_type: "local_agent",
        description: "Inspect the app",
      })),
    });
  const agentEvents = (events: HarnessEvent[]) =>
    events.filter((event) => event.type === "agent.updated");

  it("keeps identically named workers separate through renamed progress and completion", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("one");
    taskStarted("two");
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: "one",
      description: "Inspect the sidebar",
    });
    emit({ type: "result", subtype: "success" });
    taskFinished("one");
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      callId: "agent:one",
      title: "Inspect the sidebar",
      status: "completed",
    });
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    expect(
      events
        .filter((event) => event.type === "tool.started")
        .map((event) => event.callId),
    ).toEqual(["agent:one", "agent:two"]);
    taskFinished("two");
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "two",
      status: "completed",
    });
  });

  it("does not finish the lead in the middle of replacing background workers", async () => {
    const { events, turn } = await startTurn("s1");
    backgroundTasks("one");
    emit({ type: "result", subtype: "success" });
    backgroundTasks("two");
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "unknown",
    });
    taskFinished("one");
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    taskFinished("two");
    await turn;
  });

  it("does not complete foreground workers when a background-only snapshot is empty", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("foreground", { is_backgrounded: false });
    backgroundTasks();
    emit({ type: "result", subtype: "success" });
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "foreground",
      status: "running",
    });
    taskFinished("foreground");
    await turn;
  });

  it("tracks a worker started without optional task_type and a progress-only worker", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("one", { task_type: undefined, subagent_type: "Explore" });
    taskStarted("two", { task_type: undefined });
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: "two",
      subagent_type: "Explore",
      description: "Check tests",
    });
    emit({ type: "result", subtype: "success" });
    taskFinished("one");
    expect(events.some((event) => event.type === "message.completed")).toBe(
      false,
    );
    expect(agentEvents(events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agentId: "one", status: "running" }),
        expect.objectContaining({ agentId: "two", status: "running" }),
      ]),
    );
    taskFinished("two");
    await turn;
  });

  it("ignores ambient, non-agent and unclassified progress without reviving completed agents", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("ambient", { ambient: true });
    taskStarted("shell", { task_type: "local_bash" });
    taskStarted("complete");
    taskFinished("complete");
    for (const id of ["ambient", "shell", "complete"]) {
      emit({
        type: "system",
        subtype: "task_progress",
        task_id: id,
        subagent_type: "Explore",
      });
    }
    emit({
      type: "system",
      subtype: "task_progress",
      task_id: "mcp",
      description: "Generating image",
    });
    emit({ type: "result", subtype: "success" });
    await turn;
    expect(
      agentEvents(events).map((event) => [event.agentId, event.status]),
    ).toEqual([
      ["complete", "running"],
      ["complete", "completed"],
    ]);
  });

  it("reports late worker activity after the lead result and preserves it across the next turn", async () => {
    const first = await startTurn("s1");
    emit({ type: "result", subtype: "success" });
    await first.turn;
    taskStarted("late");
    expect(agentEvents(first.events).at(-1)).toMatchObject({
      agentId: "late",
      status: "running",
    });
    const second: { events: HarnessEvent[]; turn: Promise<void> } = {
      events: [],
      turn: Promise.resolve(),
    };
    const userCount = parse().filter(
      (message) => message.type === "user",
    ).length;
    second.turn = sendClaudeTurn({
      sessionId: "s1",
      cwd: "/repo",
      model: "claude:claude-sonnet-5",
      runtimeMode: "supervised",
      text: "check another thing",
      onEvent: (event) => second.events.push(event),
    });
    await waitFor(
      () =>
        parse().filter((message) => message.type === "user").length > userCount,
      "second turn",
    );
    emit({ type: "result", subtype: "success" });
    expect(
      second.events.some((event) => event.type === "message.completed"),
    ).toBe(false);
    taskFinished("late");
    await second.turn;
    expect(agentEvents(second.events).at(-1)).toMatchObject({
      agentId: "late",
      status: "completed",
    });
  });

  it("leaves final status unknown when a worker disappears without a completion message", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("one");
    emit({ type: "result", subtype: "success" });
    backgroundTasks();
    await turn;
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "unknown",
    });
    expect(
      agentEvents(events).some((event) => event.status === "completed"),
    ).toBe(false);
    taskFinished("one");
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "completed",
    });
  });

  it("reports waiting, stopped, and unexpected process loss without claiming success", async () => {
    const { events, turn } = await startTurn("s1");
    const turnFailure = expect(turn).rejects.toThrow("Claude Code exited");
    taskStarted("one");
    emit({
      type: "system",
      subtype: "task_updated",
      task_id: "one",
      patch: { status: "paused" },
    });
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "waiting",
    });
    emit({
      type: "system",
      subtype: "task_notification",
      task_id: "one",
      status: "stopped",
    });
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "stopped",
    });
    taskStarted("two");
    onExit!(1);
    await turnFailure;
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "two",
      status: "unknown",
    });
    expect(events.filter((event) => event.type === "agents.cleared")).toHaveLength(1);
  });

  it("clears workers only after confirmed process shutdown", async () => {
    const { events, turn } = await startTurn("s1");
    emit({ type: "result", subtype: "success" });
    await turn;
    taskStarted("one");
    let resolveStop!: () => void;
    killWait = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const stop = stopClaudeSession("s1");
    expect(events.filter((event) => event.type === "agents.cleared")).toHaveLength(1);
    resolveStop();
    await stop;
    expect(events.at(-1)).toEqual({ type: "agents.cleared" });
    onExit!(0);
    expect(events.at(-1)).toEqual({ type: "agents.cleared" });
  });

  it("keeps failed shutdown unknown and refuses to spawn over an unconfirmed child", async () => {
    const { events, turn } = await startTurn("s1");
    emit({ type: "result", subtype: "success" });
    await turn;
    taskStarted("one");
    killError = new Error("Stop rejected");
    await expect(stopClaudeSession("s1")).rejects.toThrow("Stop rejected");
    expect(agentEvents(events).at(-1)).toMatchObject({
      agentId: "one",
      status: "unknown",
    });
    expect(events.filter((event) => event.type === "agents.cleared")).toHaveLength(1);
    await expect(
      sendClaudeTurn({
        sessionId: "s1",
        cwd: "/repo",
        model: "claude:claude-sonnet-5",
        runtimeMode: "supervised",
        text: "try again",
        onEvent: (event) => events.push(event),
      }),
    ).rejects.toThrow("Stop rejected");
    expect(spawned).toHaveLength(1);
    killError = undefined;
    await stopClaudeSession("s1");
    expect(events.at(-1)).toEqual({ type: "agents.cleared" });
  });

  it("keeps observing background worker completion after interrupting only the lead", async () => {
    const { events, turn } = await startTurn("s1");
    taskStarted("one");
    await cancelClaudeTurn("s1");
    await turn;
    emit({ type: "assistant", message: { content: [{ type: "text", text: "Late prose" }] } });
    taskFinished("one");
    expect(agentEvents(events).at(-1)).toMatchObject({ agentId: "one", status: "completed" });
    expect(events.some((event) => event.type === "message.delta" && event.text === "Late prose")).toBe(false);
  });

  it("ignores lifecycle and control requests from a retired process after replacement", async () => {
    const first = await startTurn("s1");
    emit({ type: "result", subtype: "success" });
    await first.turn;
    const oldLine = onLine!;
    await stopClaudeSession("s1");
    sent.length = 0;
    const second = await startTurn("s1");
    oldLine(JSON.stringify({ type: "system", subtype: "task_started", task_id: "stale", task_type: "local_agent" }));
    oldLine(JSON.stringify({ type: "control_request", request_id: "stale-control", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "pwd" } } }));
    expect([...first.events, ...second.events].some((event) => event.type === "agent.updated" && event.agentId === "stale")).toBe(false);
    expect(parse().some((message) => (message.response as Record<string, unknown> | undefined)?.request_id === "stale-control")).toBe(false);
    emit({ type: "result", subtype: "success" });
    await second.turn;
  });

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
