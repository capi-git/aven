import { describe, expect, it } from "vitest";
import { applyHarnessEvent } from "./harness/apply";
import {
  codexChildActivity,
  mapCodexNotification,
} from "./harness/codexProtocol";
import { extractAgentType } from "./harness/preview";
import type { Block, Session } from "./session";
import {
  groupSubagentSteps,
  onlySubagents,
  subagentActivityFor,
  subagentElapsedMs,
  subagentHeaderLine,
  subagentRowLine,
  subagentState,
  subagentTypeLabel,
} from "./subagentRuns";

function agent(id: string, tool: Block["tool"] = {}): Block {
  return {
    id,
    role: "tool",
    text: `Task ${id}`,
    tool: { kind: "agent", status: "in_progress", ...tool },
  };
}

function shell(id: string): Block {
  return {
    id,
    role: "tool",
    text: "npm test",
    tool: { kind: "execute", status: "completed" },
  };
}

describe("groupSubagentSteps", () => {
  it("puts subagents side by side into one group", () => {
    const groups = groupSubagentSteps([
      shell("a"),
      agent("b"),
      agent("c"),
      shell("d"),
      agent("e"),
    ]);
    expect(groups.map((group) => group.type)).toEqual([
      "step",
      "subagents",
      "step",
      "subagents",
    ]);
    expect(
      groups[1].type === "subagents" && groups[1].blocks.map((b) => b.id),
    ).toEqual(["b", "c"]);
  });

  it("knows a phase of only subagents", () => {
    expect(onlySubagents([agent("a"), agent("b")])).toBe(true);
    expect(onlySubagents([agent("a"), shell("b")])).toBe(false);
    expect(onlySubagents([])).toBe(false);
  });
});

describe("subagent state and words", () => {
  it("reads the status, and ends what a finished turn never closed", () => {
    expect(subagentState(agent("a"), true)).toBe("running");
    expect(subagentState(agent("a"), false)).toBe("ended");
    expect(subagentState(agent("a", { status: "completed" }), false)).toBe(
      "done",
    );
    expect(subagentState(agent("a", { status: "failed" }), true)).toBe(
      "failed",
    );
    expect(subagentState(agent("a", { status: "stopped" }), true)).toBe(
      "stopped",
    );
    expect(subagentState(agent("a", { status: "waiting" }), true)).toBe(
      "waiting",
    );
  });

  it("names the agent type in a short word", () => {
    expect(subagentTypeLabel("general-purpose")).toBe("General");
    expect(subagentTypeLabel("Explore")).toBe("Explore");
    expect(subagentTypeLabel("code_reviewer")).toBe("Code reviewer");
    expect(subagentTypeLabel(undefined)).toBe("");
  });

  it("says what a running subagent does in plain words", () => {
    expect(subagentActivityFor("Bash", "execute")).toBe("Running a command");
    expect(subagentActivityFor("Edit", "edit")).toBe("Editing");
    expect(subagentActivityFor("Read", "read")).toBe("Reading files");
    expect(subagentActivityFor("Grep", "search")).toBe("Searching");
    expect(subagentActivityFor("WebSearch", "search")).toBe(
      "Searching the web",
    );
    expect(subagentActivityFor("mcp__x__y", "other")).toBe("Using a tool");
    expect(
      subagentRowLine(agent("a", { agentActivity: "Editing" }), "running"),
    ).toBe("Editing");
    expect(subagentRowLine(agent("a"), "running")).toBe("Working");
  });

  it("sums up the card", () => {
    expect(subagentHeaderLine(["running", "running"])).toBe("2 running");
    expect(subagentHeaderLine(["running", "done"])).toBe("1 running, 1 done");
    expect(subagentHeaderLine(["done", "done"])).toBe("Done");
    expect(subagentHeaderLine(["done", "failed"])).toBe("1 failed");
  });

  it("times a running subagent to now and a finished one by what it kept", () => {
    expect(
      subagentElapsedMs(agent("a", { startedAt: 1_000 }), "running", 90_000),
    ).toBe(89_000);
    expect(
      subagentElapsedMs(agent("a", { durationMs: 5_000 }), "done", 90_000),
    ).toBe(5_000);
    expect(subagentElapsedMs(agent("a"), "done", 90_000)).toBeUndefined();
  });
});

describe("subagent fields on tool blocks", () => {
  const base = {
    id: "s",
    blocks: [],
  } as unknown as Session;

  it("keeps the agent type, the activity, and the run time once it ends", () => {
    let session = applyHarnessEvent(base, {
      type: "tool.started",
      callId: "c1",
      title: "Fix speed problems",
      kind: "agent",
      status: "in_progress",
      agentType: "general-purpose",
    });
    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "c1",
      kind: "agent",
      status: "in_progress",
      agentActivity: "Running a command",
    });
    let tool = session.blocks.at(-1)?.tool;
    expect(tool?.agentType).toBe("general-purpose");
    expect(tool?.agentActivity).toBe("Running a command");
    expect(tool?.durationMs).toBeUndefined();

    session = applyHarnessEvent(session, {
      type: "tool.updated",
      callId: "c1",
      kind: "agent",
      status: "completed",
      detail: "All fixed.",
    });
    tool = session.blocks.at(-1)?.tool;
    expect(tool?.agentType).toBe("general-purpose");
    expect(typeof tool?.durationMs).toBe("number");
  });
});

describe("agent types and activity from every provider", () => {
  it("reads the agent type under each provider's field name", () => {
    expect(extractAgentType({ subagent_type: "general-purpose" })).toBe(
      "general-purpose",
    );
    expect(extractAgentType({ subagentType: { custom: "reviewer" } })).toBe(
      "reviewer",
    );
    expect(extractAgentType({ input: { agent: "scout" } })).toBe("scout");
    expect(extractAgentType(JSON.stringify({ agent_type: "explore" }))).toBe(
      "explore",
    );
    expect(extractAgentType({ subagentType: "unspecified" })).toBeUndefined();
    expect(
      extractAgentType({ agent: "a whole sentence about it" }),
    ).toBeUndefined();
  });

  it("says what a Codex child is doing from the item it started", () => {
    expect(codexChildActivity({ type: "commandExecution" })).toBe(
      "Running a command",
    );
    expect(codexChildActivity({ type: "fileChange" })).toBe("Editing");
    expect(codexChildActivity({ type: "webSearch" })).toBe("Searching the web");
    expect(codexChildActivity({ type: "agentMessage" })).toBeUndefined();
  });

  it("gives a Codex subagent row its agent type", () => {
    const { events } = mapCodexNotification("item/started", {
      item: {
        type: "subAgentActivity",
        id: "call-1",
        kind: "started",
        agentPath: "/root/worker",
        agentThreadId: "thread-2",
      },
    });
    expect(events[0]).toMatchObject({ kind: "agent", agentType: "worker" });
  });
});
