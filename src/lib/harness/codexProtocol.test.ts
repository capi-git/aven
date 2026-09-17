import { describe, expect, it } from "vitest";
import {
  buildThreadStartParams,
  buildTurnStartParams,
  buildTurnSteerParams,
  codexAttachmentInputs,
  isRecoverableThreadResumeError,
  mapApprovalRequest,
  mapCodexNotification,
  runtimeModeToCodexConfig,
  toCodexApprovalDecision,
} from "./codexProtocol";
import { parseCodexModelList } from "./codexCatalog";

describe("Codex file attachments", () => {
  it("keeps document-only turns and file paths with quotes or non-ASCII characters", () => {
    const path = '/Users/test/Downloads/Agency "été".docx';
    const attachments = codexAttachmentInputs([
      {
        id: "doc",
        name: 'Agency "été".docx',
        path,
        kind: "file",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 123,
      },
    ]);
    const turn = buildTurnStartParams({
      threadId: "t",
      runtimeMode: "full-access",
      attachments,
    });
    expect(turn.input).toHaveLength(1);
    const block = attachments[0];
    expect(block.type).toBe("text");
    if (block.type !== "text") throw new Error("Expected document context");
    expect(JSON.parse(block.text.split("\n")[1]).path).toBe(path);
  });

  it("uses a local reference when an image cannot be embedded", () => {
    expect(
      codexAttachmentInputs([
        {
          id: "image",
          name: "large.png",
          path: "/tmp/large.png",
          kind: "image",
          mimeType: "image/png",
          size: 30000000,
        },
      ]),
    ).toEqual([
      { type: "text", text: expect.stringContaining("/tmp/large.png") },
    ]);
  });

  it("rejects unavailable files rather than sending a prompt without them", () => {
    expect(() =>
      codexAttachmentInputs([
        {
          id: "missing",
          name: "guide.pdf",
          kind: "file",
          mimeType: "application/pdf",
          size: 10,
        },
      ]),
    ).toThrow('Could not send attachment "guide.pdf"');
  });
});

describe("generated image results", () => {
  it("renders the saved image without retaining its base64 payload", () => {
    const mapped = mapCodexNotification("item/completed", {
      item: {
        id: "image-1",
        type: "imageGeneration",
        status: "completed",
        savedPath: "/Users/test/.codex/generated_images/mock image.png",
        result: "large-base64-payload",
      },
    });
    expect(mapped.events).toContainEqual({
      type: "message.delta",
      text: "![Generated image](</Users/test/.codex/generated_images/mock%20image.png>)",
    });
    expect(JSON.stringify(mapped)).not.toContain("large-base64-payload");
    expect(mapped.turnCompleted).toBeUndefined();
  });

  it("preserves inline image output when no saved path is supplied", () => {
    const mapped = mapCodexNotification("item/completed", {
      item: {
        id: "image-2",
        type: "imageGeneration",
        status: "completed",
        result: "aW1hZ2U=",
      },
    });
    expect(mapped.events).toContainEqual({
      type: "message.delta",
      text: "![Generated image](<data:image/png;base64,aW1hZ2U=>)",
    });
  });

  it("shows generation progress and failure without inventing an image", () => {
    const item = { id: "image-3", type: "imageGeneration", result: "" };
    expect(mapCodexNotification("item/started", { item }).events).toMatchObject(
      [
        {
          type: "tool.started",
          title: "Generate image",
          status: "in_progress",
        },
      ],
    );
    expect(
      mapCodexNotification("item/completed", {
        item: { ...item, status: "failed" },
      }).events,
    ).toMatchObject([{ type: "tool.updated", status: "failed" }]);
  });
});

describe("runtimeModeToCodexConfig", () => {
  it("maps supervised to untrusted read-only", () => {
    expect(runtimeModeToCodexConfig("supervised")).toEqual({
      approvalPolicy: "untrusted",
      sandbox: "read-only",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "readOnly" },
    });
  });

  it("maps auto-accept-edits to workspace-write with user reviewer", () => {
    expect(runtimeModeToCodexConfig("auto-accept-edits")).toMatchObject({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });

  it("maps auto to workspace-write with auto_review", () => {
    expect(runtimeModeToCodexConfig("auto")).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });

  it("maps full-access to never + danger-full-access", () => {
    expect(runtimeModeToCodexConfig("full-access")).toMatchObject({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  });
});

describe("buildThreadStartParams / buildTurnStartParams", () => {
  it("includes model and omits default service tier", () => {
    const thread = buildThreadStartParams({
      cwd: "/tmp/proj",
      runtimeMode: "supervised",
      model: "gpt-5.4",
      serviceTier: "default",
    });
    expect(thread).toMatchObject({
      cwd: "/tmp/proj",
      model: "gpt-5.4",
      approvalPolicy: "untrusted",
    });
    expect(thread.serviceTier).toBeUndefined();
  });

  it("builds turn input with text and image attachments", () => {
    const turn = buildTurnStartParams({
      threadId: "thr_1",
      runtimeMode: "auto-accept-edits",
      prompt: "hello",
      attachments: [{ type: "image", url: "data:image/png;base64,abc" }],
      model: "gpt-5.4",
      effort: "high",
      serviceTier: "fast",
    });
    expect(turn.threadId).toBe("thr_1");
    expect(turn.effort).toBe("high");
    expect(turn.serviceTier).toBe("fast");
    expect(turn.input).toEqual([
      { type: "text", text: "hello" },
      { type: "image", url: "data:image/png;base64,abc" },
    ]);
    expect(turn.sandboxPolicy).toEqual({ type: "workspaceWrite" });
    expect(turn.collaborationMode).toEqual({
      mode: "default",
      settings: {
        model: "gpt-5.4",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    });
  });

  it("uses native plan mode with a non-escalating read-only sandbox", () => {
    const turn = buildTurnStartParams({
      threadId: "thr_1",
      runtimeMode: "full-access",
      prompt: "plan this",
      model: "gpt-5.4",
      intent: "plan",
    });
    expect(turn).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
      sandboxPolicy: { type: "readOnly" },
      collaborationMode: {
        mode: "plan",
        settings: { developer_instructions: null },
      },
    });
  });

  it("builds steer input with expected turn id", () => {
    const steer = buildTurnSteerParams({
      threadId: "thr_1",
      expectedTurnId: "turn_9",
      prompt: "focus on tests",
    });
    expect(steer).toEqual({
      threadId: "thr_1",
      expectedTurnId: "turn_9",
      input: [{ type: "text", text: "focus on tests" }],
    });
  });
});

describe("isRecoverableThreadResumeError", () => {
  it("detects missing-thread errors", () => {
    expect(
      isRecoverableThreadResumeError(new Error("Thread thr_x not found")),
    ).toBe(true);
    expect(isRecoverableThreadResumeError(new Error("unknown thread id"))).toBe(
      true,
    );
  });

  it("rejects unrelated errors", () => {
    expect(isRecoverableThreadResumeError(new Error("rate limited"))).toBe(
      false,
    );
    expect(isRecoverableThreadResumeError(new Error("network down"))).toBe(
      false,
    );
  });
});

describe("mapCodexNotification", () => {
  it("maps agent message deltas", () => {
    const mapped = mapCodexNotification("item/agentMessage/delta", {
      delta: "Hello",
    });
    expect(mapped.events).toEqual([{ type: "message.delta", text: "Hello" }]);
  });

  it("keeps task progress distinct from authored plan documents", () => {
    expect(
      mapCodexNotification("turn/plan/updated", {
        turnId: "turn_1",
        explanation: "The inspection is done.",
        plan: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "inProgress" },
        ],
      }).events,
    ).toEqual([
      {
        type: "tasks.updated",
        key: "turn_1",
        explanation: "The inspection is done.",
        items: [
          { text: "Inspect", status: "completed" },
          { text: "Implement", status: "in_progress" },
        ],
      },
    ]);
    expect(
      mapCodexNotification("item/plan/delta", {
        itemId: "plan_1",
        delta: "# Approach",
      }).events,
    ).toEqual([
      {
        type: "plan",
        text: "# Approach",
        key: "plan_1",
        append: true,
        streaming: true,
      },
    ]);
  });

  it("keeps whitespace-only agent message deltas", () => {
    const mapped = mapCodexNotification("item/agentMessage/delta", {
      delta: "\n\n",
    });
    expect(mapped.events).toEqual([{ type: "message.delta", text: "\n\n" }]);
  });

  it("maps reasoning summary deltas", () => {
    const mapped = mapCodexNotification("item/reasoning/summaryTextDelta", {
      delta: "thinking…",
    });
    expect(mapped.events).toEqual([
      { type: "reasoning.delta", text: "thinking…" },
    ]);
  });

  it("ignores userMessage items echoed by Codex", () => {
    const started = mapCodexNotification("item/started", {
      item: {
        id: "msg_1",
        type: "userMessage",
        content: [{ type: "text", text: "hey are you there" }],
      },
    });
    expect(started.events).toEqual([]);

    const completed = mapCodexNotification("item/completed", {
      item: {
        id: "msg_1",
        type: "userMessage",
        content: [{ type: "text", text: "hey are you there" }],
      },
    });
    expect(completed.events).toEqual([]);
  });

  it("maps command execution item lifecycle", () => {
    const started = mapCodexNotification("item/started", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "ls -la",
        status: "inProgress",
      },
    });
    expect(started.events[0]).toMatchObject({
      type: "tool.started",
      callId: "cmd_1",
      title: "ls -la",
      kind: "execute",
    });

    const completed = mapCodexNotification("item/completed", {
      item: {
        id: "cmd_1",
        type: "commandExecution",
        command: "ls -la",
        status: "completed",
        aggregatedOutput: "ok",
      },
    });
    expect(completed.events[0]).toMatchObject({
      type: "tool.updated",
      callId: "cmd_1",
      status: "completed",
      detail: "ok",
    });
  });

  it("maps file change items", () => {
    const mapped = mapCodexNotification("item/started", {
      item: {
        id: "fc_1",
        type: "fileChange",
        status: "inProgress",
        changes: [
          {
            path: "src/App.tsx",
            kind: "update",
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
          {
            path: "src/lib/checkpoint.ts",
            kind: "update",
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
      },
    });
    expect(mapped.events[0]).toMatchObject({
      type: "tool.started",
      callId: "fc_1",
      kind: "edit",
      paths: ["src/App.tsx", "src/lib/checkpoint.ts"],
    });
  });

  it("maps sub-agent activity as a live agent tool, not silence", () => {
    const started = mapCodexNotification("item/completed", {
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "started",
        agentPath: "/root/explore-auth",
        agentThreadId: "thr_child",
      },
    });
    expect(started.events[0]).toMatchObject({
      type: "tool.started",
      callId: "sa_1",
      kind: "agent",
      status: "in_progress",
      title: "Explore Auth subagent",
    });

    const interrupted = mapCodexNotification("item/completed", {
      item: {
        id: "sa_1",
        type: "subAgentActivity",
        kind: "interrupted",
        agentPath: "/root/explore-auth",
      },
    });
    expect(interrupted.events[0]).toMatchObject({
      type: "tool.updated",
      callId: "sa_1",
      kind: "agent",
      status: "failed",
    });
  });

  it("does not treat a completed agent message as the end of the turn", () => {
    const mapped = mapCodexNotification("item/completed", {
      item: {
        id: "msg_2",
        type: "agentMessage",
        text: "I'll inspect the changelog first.",
      },
    });
    expect(mapped.turnCompleted).toBeUndefined();
    expect(mapped.activeTurnId).toBeUndefined();
    expect(mapped.events).toEqual([
      { type: "message.delta", text: "I'll inspect the changelog first." },
      { type: "message.completed" },
    ]);
  });

  it("maps turn completion and clears active turn", () => {
    const mapped = mapCodexNotification("turn/completed", {
      turn: { id: "turn_1", status: "completed" },
    });
    expect(mapped.turnCompleted?.status).toBe("completed");
    expect(mapped.activeTurnId).toBeNull();
    expect(mapped.events).toEqual(
      expect.arrayContaining([
        { type: "message.completed" },
        { type: "reasoning.completed" },
      ]),
    );
  });

  it("maps aborted turns as interrupted completion", () => {
    const mapped = mapCodexNotification("turn/aborted", {
      turn: { id: "turn_1" },
    });
    expect(mapped.turnCompleted?.status).toBe("interrupted");
    expect(mapped.activeTurnId).toBeNull();
  });

  it("maps failed turns to session.error", () => {
    const mapped = mapCodexNotification("turn/completed", {
      turn: {
        id: "turn_1",
        status: "failed",
        error: { message: "quota exceeded" },
      },
    });
    expect(mapped.turnCompleted?.status).toBe("failed");
    expect(mapped.events).toContainEqual({
      type: "session.error",
      message: "quota exceeded",
    });
  });

  it("ignores unknown methods", () => {
    expect(mapCodexNotification("future/unknown", { x: 1 }).events).toEqual([]);
  });
});

describe("approvals", () => {
  it("maps command approval requests", () => {
    const mapped = mapApprovalRequest(
      "item/commandExecution/requestApproval",
      { itemId: "cmd_1", command: "rm -rf /", reason: "cleanup" },
      7,
    );
    expect(mapped).toMatchObject({
      kind: "command",
      event: {
        type: "approval.requested",
        requestId: 7,
        callId: "cmd_1",
        kind: "execute",
      },
    });
  });

  it("maps file-change approval requests", () => {
    const mapped = mapApprovalRequest(
      "item/fileChange/requestApproval",
      { itemId: "fc_1", reason: "Write config" },
      3,
    );
    expect(mapped?.kind).toBe("file-change");
    expect(mapped?.event.title).toBe("Write config");
  });

  it("translates UI decisions to Codex wire decisions", () => {
    expect(toCodexApprovalDecision("allow", "command")).toBe("accept");
    expect(toCodexApprovalDecision("deny", "file-change")).toBe("decline");
  });
});

describe("parseCodexModelList", () => {
  it("builds models with reasoning and service tier settings", () => {
    const models = parseCodexModelList([
      {
        model: "gpt-5.6-luna",
        displayName: "gpt-5.6-luna",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: [
          { reasoningEffort: "low" },
          { reasoningEffort: "medium" },
          { reasoningEffort: "high" },
        ],
        serviceTiers: [{ id: "fast", name: "Fast" }],
        defaultServiceTier: "default",
      },
      {
        model: "gpt-5.6-terra",
        displayName: "gpt-5.6-terra",
        isDefault: true,
        supportedReasoningEfforts: [],
      },
    ]);
    expect(models.map((m) => m.nativeId)).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    const luna = models.find((m) => m.nativeId === "gpt-5.6-luna");
    expect(luna?.settings?.some((s) => s.id === "reasoningEffort")).toBe(true);
    expect(luna?.settings?.some((s) => s.id === "serviceTier")).toBe(true);
    expect(luna?.settings?.find((s) => s.id === "reasoningEffort")?.value).toBe(
      "medium",
    );
  });
});

describe("mapCodexNotification thread/tokenUsage/updated", () => {
  it("reports the last request and the window the app-server supplies", () => {
    const mapped = mapCodexNotification("thread/tokenUsage/updated", {
      threadId: "t1",
      turnId: "turn1",
      tokenUsage: {
        last: {
          totalTokens: 42_000,
          inputTokens: 40_000,
          cachedInputTokens: 30_000,
          cacheWriteInputTokens: 0,
          outputTokens: 2_000,
          reasoningOutputTokens: 500,
        },
        total: {
          totalTokens: 900_000,
          inputTokens: 880_000,
          cachedInputTokens: 800_000,
          cacheWriteInputTokens: 0,
          outputTokens: 20_000,
          reasoningOutputTokens: 4_000,
        },
        modelContextWindow: 272_000,
      },
    });
    expect(mapped.events).toEqual([
      { type: "context", used: 42_000, window: 272_000 },
    ]);
  });

  it("never uses `total`, which keeps climbing past the window", () => {
    const mapped = mapCodexNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        last: { totalTokens: 10_000 },
        total: { totalTokens: 5_000_000 },
        modelContextWindow: 272_000,
      },
    });
    expect(mapped.events).toEqual([
      { type: "context", used: 10_000, window: 272_000 },
    ]);
  });

  it("omits the window when the app-server does not know it", () => {
    const mapped = mapCodexNotification("thread/tokenUsage/updated", {
      tokenUsage: {
        last: { totalTokens: 10_000 },
        total: { totalTokens: 10_000 },
        modelContextWindow: null,
      },
    });
    expect(mapped.events).toEqual([{ type: "context", used: 10_000 }]);
  });

  it("stays quiet on an empty reading", () => {
    expect(
      mapCodexNotification("thread/tokenUsage/updated", {
        tokenUsage: { last: {}, total: {} },
      }).events,
    ).toEqual([]);
  });
});

describe("orchestration control sandbox", () => {
  it("opens network access for the authenticated control lead while preserving ordinary session policies", () => {
    for (const mode of ["supervised", "auto-accept-edits", "auto"] as const) {
      expect(runtimeModeToCodexConfig(mode).sandboxPolicy).not.toHaveProperty(
        "networkAccess",
      );
      expect(runtimeModeToCodexConfig(mode, true).sandboxPolicy).toMatchObject({
        networkAccess: true,
      });
    }
    expect(runtimeModeToCodexConfig("full-access", true).sandboxPolicy).toEqual(
      { type: "dangerFullAccess" },
    );
  });
  it("carries the lead grant into thread and turn requests without relaxing the read-only plan", () => {
    expect(
      buildThreadStartParams({
        cwd: "/repo",
        runtimeMode: "supervised",
        controlsAgents: true,
      }).sandboxPolicy,
    ).toEqual({ type: "readOnly", networkAccess: true });
    expect(
      buildTurnStartParams({
        threadId: "t",
        runtimeMode: "auto",
        controlsAgents: true,
      }).sandboxPolicy,
    ).toEqual({ type: "workspaceWrite", networkAccess: true });
    expect(
      buildTurnStartParams({
        threadId: "t",
        runtimeMode: "auto",
        controlsAgents: true,
        intent: "plan",
      }),
    ).toMatchObject({
      sandboxPolicy: { type: "readOnly", networkAccess: true },
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
    });
  });
});
