import { describe, expect, it } from "vitest";
import { AVEN_BROWSER_HOST_POLICY } from "./browserHostPolicy";
import {
  modelsForClaudeVersion,
  modelsFromClaudeListModels,
} from "./claudeCatalog";
import {
  applyClaudePromptEffortPrefix,
  askUserQuestionAllowInput,
  assistantErrorFromMessage,
  buildClaudeSpawnArgs,
  buildClaudeUserMessage,
  contextFromResult,
  contextUsedFromAssistant,
  extractExitPlanModePlan,
  isClaudeInitMessage,
  isSubagentMessage,
  isTodoTool,
  listModelsFromControlResponse,
  normalizeClaudeCliEffort,
  parseBackgroundAgentTasks,
  parseClaudeVersion,
  parseControlRequest,
  parseControlResponse,
  parseTaskNotification,
  parseTaskProgress,
  parseTaskStarted,
  parseTaskUpdated,
  parseToolProgress,
  taskListFromTodos,
  resolveClaudeApiModelId,
  runtimeModeToPermission,
  sessionIdFromMessage,
  statusTextFromSystem,
  streamDeltaFromEvent,
  toClaudePermissionResult,
  toolKindFromName,
  toolStartFromEvent,
  toolTitle,
  turnStatusFromResult,
} from "./claudeProtocol";

describe("runtimeModeToPermission", () => {
  it("maps runtime modes onto Claude permission flags", () => {
    expect(runtimeModeToPermission("supervised")).toBe("default");
    expect(runtimeModeToPermission("auto-accept-edits")).toBe("acceptEdits");
    expect(runtimeModeToPermission("auto")).toBe("auto");
    expect(runtimeModeToPermission("full-access")).toBe("bypassPermissions");
  });
});

describe("normalizeClaudeCliEffort", () => {
  it("drops ultrathink and maps ultracode to xhigh", () => {
    expect(
      normalizeClaudeCliEffort("ultrathink", "claude-sonnet-5"),
    ).toBeUndefined();
    expect(normalizeClaudeCliEffort("ultracode", "claude-opus-5")).toBe(
      "xhigh",
    );
  });

  it("maps xhigh to max on older models", () => {
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-4-6")).toBe("max");
    expect(normalizeClaudeCliEffort("xhigh", "claude-opus-5")).toBe("xhigh");
    expect(normalizeClaudeCliEffort("xhigh", "sonnet")).toBe("xhigh");
  });

  it("maps max to high on sonnet 4.6", () => {
    expect(normalizeClaudeCliEffort("max", "claude-sonnet-4-6")).toBe("high");
  });

  it.each(["low", "medium", "high", "xhigh", "max"])(
    "preserves Opus 5.5 effort %s",
    (effort) => {
      expect(normalizeClaudeCliEffort(effort, "claude-opus-5-5")).toBe(effort);
    },
  );
});

describe("applyClaudePromptEffortPrefix", () => {
  it("prefixes ultrathink on the prompt", () => {
    expect(
      applyClaudePromptEffortPrefix("Investigate the edge cases", "ultrathink"),
    ).toBe("Ultrathink:\nInvestigate the edge cases");
    expect(applyClaudePromptEffortPrefix("hello", "high")).toBe("hello");
  });
});

describe("resolveClaudeApiModelId", () => {
  it("keeps a provider-supplied 1M alias without duplicating its suffix", () => {
    expect(resolveClaudeApiModelId("opus[1m]", "1m")).toBe("opus[1m]");
  });
  it.each([undefined, "200k", "1m"])(
    "keeps Opus 5.5's exact native model ID with inherited context %s",
    (context) => {
      expect(resolveClaudeApiModelId("claude-opus-5-5", context)).toBe(
        "claude-opus-5-5",
      );
    },
  );

  it("appends [1m] for the 1M context window", () => {
    expect(resolveClaudeApiModelId("claude-opus-5", "1m")).toBe(
      "claude-opus-5[1m]",
    );
    expect(resolveClaudeApiModelId("claude-sonnet-5", "200k")).toBe(
      "claude-sonnet-5",
    );
  });
});

describe("buildClaudeSpawnArgs", () => {
  it.each([undefined, "existing-session"])(
    "adds browser routing without replacing the provider prompt or resume behavior: %s",
    (resume) => {
      const args = buildClaudeSpawnArgs({ resume });
      expect(args[args.indexOf("--append-system-prompt") + 1]).toBe(
        AVEN_BROWSER_HOST_POLICY,
      );
      expect(args).not.toContain("--system-prompt");
      expect(args.some((arg) => arg.includes("system-prompt-snapshot"))).toBe(false);
      expect(args).not.toContain("--append-subagent-system-prompt");
      if (resume) expect(args[args.indexOf("--resume") + 1]).toBe(resume);
    },
  );

  it("speaks stream-json with stdio permissions like the Agent SDK", () => {
    const args = buildClaudeSpawnArgs({
      model: "claude-sonnet-5",
      effort: "high",
      permissionMode: "acceptEdits",
      sessionId: "sess-1",
    });
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).toContain("--input-format");
    expect(args).toContain("--permission-prompt-tool");
    expect(args).toContain("stdio");
    expect(args).toContain("--include-partial-messages");
    expect(args).toContain("--setting-sources=user,project,local");
    expect(args).toEqual(
      expect.arrayContaining([
        "--model",
        "claude-sonnet-5",
        "--effort",
        "high",
      ]),
    );
    expect(args).toEqual(
      expect.arrayContaining(["--permission-mode", "acceptEdits"]),
    );
    expect(args).toEqual(expect.arrayContaining(["--session-id", "sess-1"]));
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings).disableAllHooks).toBeUndefined();
  });

  it("only disables hooks for interactive sessions when asked", () => {
    const args = buildClaudeSpawnArgs({ settings: { disableAllHooks: true } });
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings)).toMatchObject({ disableAllHooks: true });
  });

  it("skips permissions and MCP for isolated text sessions", () => {
    const args = buildClaudeSpawnArgs({
      isolated: true,
      maxTurns: 1,
      model: "claude-haiku-4-5",
    });
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toEqual(expect.arrayContaining(["--max-turns", "1"]));
    const settings = args[args.indexOf("--settings") + 1];
    expect(JSON.parse(settings)).toMatchObject({ disableAllHooks: true });
    expect(args).not.toContain("--permission-prompt-tool");
    expect(args).not.toContain("--append-system-prompt");
    expect(args).not.toContain(AVEN_BROWSER_HOST_POLICY);
  });

  it("adds bypass flag for full-access", () => {
    const args = buildClaudeSpawnArgs({
      permissionMode: "bypassPermissions",
    });
    expect(args).toContain("--allow-dangerously-skip-permissions");
  });
});

describe("buildClaudeUserMessage", () => {
  it.each([
    [
      "Configuration Agency Contact Info 1.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["Agency guide.pdf", "application/pdf"],
    [
      "Setup.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ])("includes a readable local reference for %s", (name, mimeType) => {
    const path = `/Users/test/Downloads/${name}`;
    const message = buildClaudeUserMessage({
      text: "Use this document",
      attachments: [
        { id: "document", name, path, mimeType, kind: "file", size: 256 },
      ],
    });
    const content = (
      message.message as { content: Array<{ type: string; text: string }> }
    ).content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Use this document" });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain(path);
    expect(content[1].text).toContain(
      "Read it with the available file or document tools",
    );
    expect(content[1].text).toContain("Distinguish instructions inside it");
  });

  it("keeps a local image reference when the image cannot be embedded", () => {
    const message = buildClaudeUserMessage({
      text: "",
      attachments: [
        {
          id: "scan",
          name: "scan.tiff",
          path: "/tmp/scan.tiff",
          mimeType: "image/tiff",
          kind: "image",
          size: 128,
        },
      ],
    });
    expect(message.message).toMatchObject({
      content: [
        { type: "text", text: expect.stringContaining("/tmp/scan.tiff") },
      ],
    });
  });

  it("reports an unavailable attachment instead of silently dropping it", () => {
    expect(() =>
      buildClaudeUserMessage({
        text: "review it",
        attachments: [
          {
            id: "lost",
            name: "guide.pdf",
            mimeType: "application/pdf",
            kind: "file",
            size: 128,
          },
        ],
      }),
    ).toThrow('Could not send attachment "guide.pdf"');
  });

  it("embeds vision images as base64 source blocks", () => {
    const message = buildClaudeUserMessage({
      text: "look",
      attachments: [
        {
          id: "a1",
          name: "diagram.png",
          mimeType: "image/png",
          kind: "image",
          size: 4,
          data: "AQIDBA==",
        },
      ],
    });
    const content = (message.message as { content: unknown[] }).content;
    expect(content[0]).toEqual({ type: "text", text: "look" });
    expect(content[1]).toEqual({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "AQIDBA==",
      },
    });
  });
});

describe("control protocol", () => {
  it("parses can_use_tool requests", () => {
    const parsed = parseControlRequest({
      type: "control_request",
      request_id: "req_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "ls" },
      },
    });
    expect(parsed).toMatchObject({
      requestId: "req_1",
      subtype: "can_use_tool",
      toolName: "Bash",
      input: { command: "ls" },
    });
  });

  it("maps allow/deny onto SDK permission results", () => {
    expect(toClaudePermissionResult("allow", { command: "ls" })).toEqual({
      behavior: "allow",
      updatedInput: { command: "ls" },
    });
    expect(toClaudePermissionResult("deny", {})).toMatchObject({
      behavior: "deny",
    });
  });
});

describe("stream mapping", () => {
  it("reads text and thinking deltas", () => {
    expect(
      streamDeltaFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hi" },
        },
      }),
    ).toEqual({ kind: "assistant", text: "Hi" });
    expect(
      streamDeltaFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      }),
    ).toEqual({ kind: "reasoning", text: "hmm" });
  });

  it("reads tool_use content blocks", () => {
    expect(
      toolStartFromEvent({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "Read",
            input: { file_path: "a.ts" },
          },
        },
      }),
    ).toEqual({
      index: 1,
      id: "toolu_1",
      name: "Read",
      input: { file_path: "a.ts" },
    });
  });
});

describe("turnStatusFromResult", () => {
  const authError =
    "Failed to authenticate: OAuth session expired and could not be refreshed";

  it("honors is_error even when the CLI result subtype is success", () => {
    expect(
      turnStatusFromResult({
        type: "result",
        subtype: "success",
        is_error: true,
        result: authError,
      }),
    ).toEqual({ status: "failed", error: authError });
  });

  it("does not interpret ordinary successful result text as a provider error", () => {
    expect(
      turnStatusFromResult({
        type: "result",
        subtype: "success",
        is_error: false,
        result: authError,
      }),
    ).toEqual({ status: "completed" });
  });

  it("prefers explicit errors and falls back when the provider omits details", () => {
    expect(
      turnStatusFromResult({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["[ede_diagnostic] internal detail", "", authError],
        result: "Fallback",
      }),
    ).toEqual({ status: "failed", error: authError });
    expect(
      turnStatusFromResult({ type: "result", subtype: "success", is_error: true }),
    ).toEqual({ status: "failed", error: "Claude turn failed." });
  });

  it("treats aborted terminals as interrupted", () => {
    expect(
      turnStatusFromResult({
        type: "result",
        subtype: "error_during_execution",
        terminal_reason: "aborted_streaming",
        errors: ["interrupt"],
      }).status,
    ).toBe("interrupted");
    expect(
      turnStatusFromResult({ type: "result", subtype: "success" }).status,
    ).toBe("completed");
  });
});

describe("assistantErrorFromMessage", () => {
  const text =
    "Failed to authenticate: OAuth session expired and could not be refreshed";
  const message = { content: [{ type: "text", text }] };

  it("reads the public assistant error field without an internal CLI marker", () => {
    expect(
      assistantErrorFromMessage({
        type: "assistant",
        error: "authentication_failed",
        message,
      }),
    ).toBe(text);
  });

  it("still accepts the legacy internal API error marker", () => {
    expect(
      assistantErrorFromMessage({
        type: "assistant",
        isApiErrorMessage: true,
        message,
      }),
    ).toBe(text);
  });

  it("provides an actionable fallback when an auth failure has no text", () => {
    expect(
      assistantErrorFromMessage({
        type: "assistant",
        error: "authentication_failed",
      }),
    ).toBe(
      "Claude Code authentication failed. Run claude auth login in Aven’s terminal, then retry.",
    );
  });

  it("leaves ordinary assistant prose and user messages alone", () => {
    expect(
      assistantErrorFromMessage({ type: "assistant", message }),
    ).toBeUndefined();
    expect(
      assistantErrorFromMessage({ type: "assistant", error: "", message }),
    ).toBeUndefined();
    expect(
      assistantErrorFromMessage({
        type: "user",
        error: "authentication_failed",
        message,
      }),
    ).toBeUndefined();
  });
});

describe("modelsForClaudeVersion", () => {
  it.each([undefined, null, "2.1.267", "2.1.279"])(
    "does not offer Opus 5.5 on unsupported CLI version %s",
    (version) => {
      expect(modelsForClaudeVersion(version).map((model) => model.nativeId))
        .not.toContain("claude-opus-5-5");
    },
  );

  it.each(["2.1.280", "2.2.0"])(
    "offers Opus 5.5 with medium effort, native 1M, and fast off on %s",
    (version) => {
      const models = modelsForClaudeVersion(version);
      const model = models.find((entry) => entry.nativeId === "claude-opus-5-5");
      expect(model).toMatchObject({
        id: "claude:opus-5.5",
        name: "Claude Opus 5.5",
        contextWindow: 1_000_000,
      });
      expect(model?.settings?.map((setting) => setting.id)).toEqual(["effort", "fast"]);
      expect(model?.settings?.find((setting) => setting.id === "effort")).toMatchObject({
        value: "medium",
      });
      expect(model?.settings?.find((setting) => setting.id === "fast")?.value).toBe("false");
      expect(models.find((entry) => entry.nativeId === "claude-opus-5")
        ?.settings?.find((setting) => setting.id === "effort")?.value).toBe("high");
    },
  );

  it("hides Opus 5 until 2.1.219", () => {
    const old = modelsForClaudeVersion("2.1.100").map(
      (model) => model.nativeId,
    );
    expect(old).not.toContain("claude-opus-5");
    expect(old).not.toContain("claude-opus-4-8");
    expect(old).toContain("claude-sonnet-4-6");

    const next = modelsForClaudeVersion("2.1.233").map(
      (model) => model.nativeId,
    );
    expect(next).toContain("claude-opus-5");
    expect(next).toContain("claude-fable-5");
    expect(next).toContain("claude-sonnet-5");
  });
});

describe("list_models catalog", () => {
  it("shows the model version and fixed 1M context from Claude Code 2.1.280's live row", () => {
    const [model] = modelsFromClaudeListModels([{
      value: "opus[1m]",
      resolvedModel: "claude-opus-5-5[1m]",
      displayName: "Opus (1M context)",
      description: "Opus 5.5 with 1M context · Best for everyday, complex tasks",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
      supportsAutoMode: true,
    }]);
    expect(model).toMatchObject({
      id: "claude:opus",
      nativeId: "opus[1m]",
      name: "Opus 5.5",
      pickerPreferenceId: "claude:opus-5.5",
      contextWindow: 1_000_000,
    });
    expect(model.settings?.map((setting) => setting.id)).toEqual(["effort", "fast"]);
    expect(model.settings?.[0].value).toBe("medium");
    expect(resolveClaudeApiModelId(model.nativeId!, "1m")).toBe("opus[1m]");
  });

  it("recognizes an Opus 5.5 alias without rewriting the live launch alias", () => {
    const [model] = modelsFromClaudeListModels([{
      value: "opus",
      resolvedModel: "claude-opus-5-5",
      displayName: "Opus",
      description: "Opus 5.5 · For coding and knowledge work",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
    }]);
    expect(model).toMatchObject({
      id: "claude:opus",
      nativeId: "opus",
      name: "Opus 5.5",
      pickerPreferenceId: "claude:opus-5.5",
      pickerAliases: ["claude:opus-5-5", "claude:opus-5.5"],
      contextWindow: 1_000_000,
    });
    const fallback = modelsForClaudeVersion("2.1.280")
      .find((entry) => entry.nativeId === "claude-opus-5-5");
    expect(model.settings).toEqual(fallback?.settings);
  });

  it("supplies verified Opus 5.5 effort defaults without an optional capability payload", () => {
    const [model] = modelsFromClaudeListModels([{
      value: "claude-opus-5-5[1m]",
      displayName: "Opus 5.5",
      supportsAdaptiveThinking: true,
    }]);
    expect(model).toMatchObject({
      nativeId: "claude-opus-5-5",
      pickerPreferenceId: "claude:opus-5.5",
      contextWindow: 1_000_000,
    });
    expect(model.settings?.map((setting) => setting.id)).toEqual(["effort"]);
    expect(model.settings?.[0]).toMatchObject({ value: "medium" });
    expect(model.settings?.[0].options.map((option) => option.value)).toEqual([
      "low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink",
    ]);
  });

  it("preserves provider capability restrictions for Opus 5.5", () => {
    const [model] = modelsFromClaudeListModels([{
      value: "opus",
      resolvedModel: "claude-opus-5-5",
      supportedEffortLevels: ["low", "medium"],
      supportsFastMode: false,
    }]);
    expect(model.settings?.map((setting) => setting.id)).toEqual(["effort"]);
    expect(model.settings?.[0]).toMatchObject({ value: "medium" });
    expect(model.settings?.[0].options.map((option) => option.value)).toEqual([
      "low", "medium", "ultrathink",
    ]);
    const [noEffort] = modelsFromClaudeListModels([{
      value: "claude-opus-5-5",
      supportsEffort: false,
      supportsAdaptiveThinking: true,
      supportsFastMode: false,
    }]);
    expect(noEffort.settings).toBeUndefined();
  });

  const listed = {
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "list_1",
      response: {
        models: [
          {
            value: "default",
            resolvedModel: "claude-sonnet-5",
            displayName: "Default (recommended)",
            description: "Sonnet 5 · Efficient for routine tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "sonnet",
            resolvedModel: "claude-sonnet-5",
            displayName: "Sonnet",
            description: "Sonnet 5 · Efficient for routine tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
            supportsAdaptiveThinking: true,
          },
          {
            value: "claude-fable-5[1m]",
            resolvedModel: "claude-fable-5",
            displayName: "Fable",
            description: "Fable 5 · Most capable for your hardest tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
          },
          {
            value: "opus",
            resolvedModel: "claude-opus-5",
            displayName: "Opus",
            description: "Opus 5 · Best for everyday, complex tasks",
            supportsEffort: true,
            supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
            supportsFastMode: true,
          },
          {
            value: "haiku",
            resolvedModel: "claude-haiku-4-5-20251001",
            displayName: "Haiku",
            description: "Haiku 4.5 · Fastest for quick answers",
          },
          {
            value: "cc-update-required-1",
            resolvedModel: "cc-update-required-1",
            displayName: "Fable 5.1 (disabled)",
            description: "Update to 2.1.255+ to use Fable 5.1",
            disabled: true,
          },
        ],
      },
    },
  };

  it("reads rows from the matching control response", () => {
    expect(listModelsFromControlResponse(listed, "list_1")).toHaveLength(6);
    expect(listModelsFromControlResponse(listed, "other")).toBeNull();
    expect(
      listModelsFromControlResponse(
        {
          type: "control_response",
          response: {
            subtype: "success",
            request_id: "init_1",
            response: { commands: [], models: [] },
          },
        },
        "list_1",
      ),
    ).toBeNull();
  });

  it("preserves resolved picker identities while retaining live Claude launch aliases", () => {
    const models = modelsFromClaudeListModels([
      {
        value: "sonnet",
        resolvedModel: "claude-sonnet-5",
        displayName: "Sonnet 5",
      },
      {
        value: "haiku",
        resolvedModel: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
      },
    ]);
    expect(models[0]).toMatchObject({
      id: "claude:sonnet",
      nativeId: "sonnet",
      pickerAliases: ["claude:sonnet-5"],
      pickerPreferenceId: "claude:sonnet-5",
    });
    expect(models[1]).toMatchObject({
      id: "claude:haiku",
      nativeId: "haiku",
      pickerAliases: ["claude:haiku-4-5", "claude:haiku-4.5"],
      pickerPreferenceId: "claude:haiku-4.5",
    });
  });

  it("maps the picker catalog and drops default/disabled rows", () => {
    const models = modelsFromClaudeListModels(
      listModelsFromControlResponse(listed, "list_1"),
    );
    expect(models.map((model) => model.nativeId)).toEqual([
      "sonnet",
      "claude-fable-5",
      "opus",
      "haiku",
    ]);
    expect(models.map((model) => model.id)).toEqual([
      "claude:sonnet",
      "claude:fable-5",
      "claude:opus",
      "claude:haiku",
    ]);
    expect(models.map((model) => model.name)).toEqual([
      "Sonnet 5",
      "Fable 5",
      "Opus 5",
      "Haiku 4.5",
    ]);

    const sonnet = models[0];
    expect(
      sonnet?.settings
        ?.find((setting) => setting.id === "effort")
        ?.options.map((option) => option.value),
    ).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultracode",
      "ultrathink",
    ]);
    expect(sonnet?.settings?.some((setting) => setting.id === "fast")).toBe(
      false,
    );

    const fable = models[1];
    expect(
      fable?.settings?.find((setting) => setting.id === "context"),
    ).toMatchObject({
      value: "1m",
    });

    const opus = models[2];
    expect(opus?.settings?.some((setting) => setting.id === "fast")).toBe(true);

    const haiku = models[3];
    expect(haiku?.settings).toBeUndefined();
  });

  it("parses success and error control responses", () => {
    expect(
      parseControlResponse({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: "init_1",
          response: { pid: 12 },
        },
      }),
    ).toEqual({
      requestId: "init_1",
      ok: true,
      payload: { pid: 12 },
    });
    expect(
      parseControlResponse({
        type: "control_response",
        response: { subtype: "error", request_id: "list_1", error: "nope" },
      }),
    ).toEqual({
      requestId: "list_1",
      ok: false,
      payload: null,
      error: "nope",
    });
    expect(isClaudeInitMessage({ type: "system", subtype: "init" })).toBe(true);
    expect(isClaudeInitMessage({ type: "assistant", subtype: "init" })).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("parses CLI version strings", () => {
    expect(parseClaudeVersion("2.1.233 (Claude Code)")).toBe("2.1.233");
  });

  it("classifies tools and todo plans", () => {
    expect(toolKindFromName("Bash")).toBe("execute");
    expect(toolKindFromName("Skill")).toBe("skill");
    expect(toolKindFromName("Agent")).toBe("agent");
    expect(toolKindFromName("Task")).toBe("agent");
    expect(toolTitle("Agent", { description: "Explore the auth module" })).toBe(
      "Explore the auth module",
    );
    expect(toolTitle("Task", { subagent_type: "explore" })).toBe(
      "Explore subagent",
    );
    expect(toolTitle("Bash", { command: "ls -la src" })).toBe("List src");
    expect(toolTitle("Skill", { skill: "code-review" })).toBe(
      "Skill /code-review",
    );
    expect(isTodoTool("TodoWrite")).toBe(true);
    expect(toolKindFromName("TodoWrite")).toBe("tasks");
    expect(
      taskListFromTodos({
        todos: [
          { content: "One", status: "completed" },
          { content: "Two", status: "pending" },
        ],
      }),
    ).toEqual([
      { text: "One", status: "completed" },
      { text: "Two", status: "pending" },
    ]);
    expect(extractExitPlanModePlan({ plan: "# Plan" })).toBe("# Plan");
  });

  it("answers AskUserQuestion with the selected options", () => {
    const input = {
      questions: [
        {
          question: "Which file?",
          options: [{ label: "a.ts" }, { label: "b.ts" }],
        },
      ],
    };
    expect(
      askUserQuestionAllowInput(input, {
        kind: "answered",
        answers: { "Which file?": ["b.ts"] },
      }),
    ).toMatchObject({
      answers: { "Which file?": "b.ts" },
    });
  });

  it("drops request lifecycle status pings", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        status: "requesting",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        message: "Responding",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({ type: "system", subtype: "status" }),
    ).toBeUndefined();
  });

  it("keeps status messages that carry real prose", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "status",
        message: "Retrying in 3s (rate limited)",
      }),
    ).toBe("Retrying in 3s (rate limited)");
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "compact",
        message: "Compacted context to 40k tokens",
      }),
    ).toBe("Compacted context to 40k tokens");
  });

  it("still marks a compact boundary that carries no prose", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto" },
      }),
    ).toBe("Compacted context");
  });

  it("ignores system messages that are not status or compact", () => {
    expect(
      statusTextFromSystem({
        type: "system",
        subtype: "init",
        message: "ready",
      }),
    ).toBeUndefined();
    expect(
      statusTextFromSystem({ type: "assistant", message: "hello" }),
    ).toBeUndefined();
  });
});

describe("contextUsedFromAssistant", () => {
  it("counts cached reads and writes as window occupancy", () => {
    // Shape captured from `claude --output-format stream-json --verbose`.
    const rec = {
      type: "assistant",
      message: {
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 12941,
          cache_read_input_tokens: 16652,
          output_tokens: 3,
        },
      },
    };
    expect(contextUsedFromAssistant(rec)).toBe(29598);
  });

  it("ignores a message with no usage", () => {
    expect(
      contextUsedFromAssistant({ type: "assistant", message: {} }),
    ).toBeUndefined();
  });
});

describe("contextFromResult", () => {
  it("reads the window the CLI reports rather than a model table", () => {
    const rec = {
      type: "result",
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 12941,
        cache_read_input_tokens: 16652,
        output_tokens: 13,
      },
      modelUsage: {
        "claude-sonnet-5": { contextWindow: 1000000, maxOutputTokens: 64000 },
      },
    };
    expect(contextFromResult(rec)).toEqual({ used: 29608, window: 1000000 });
  });

  it("uses the last iteration, since top-level usage sums the whole turn", () => {
    const rec = {
      type: "result",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 90_000,
        output_tokens: 500,
        iterations: [
          {
            input_tokens: 5,
            cache_read_input_tokens: 20_000,
            output_tokens: 200,
          },
          {
            input_tokens: 5,
            cache_read_input_tokens: 70_000,
            output_tokens: 300,
          },
        ],
      },
      modelUsage: { "claude-opus-5": { contextWindow: 200000 } },
    };
    expect(contextFromResult(rec)).toEqual({ used: 70_305, window: 200000 });
  });

  it("has nothing to report for a turn that never called the API", () => {
    expect(contextFromResult({ type: "result", usage: {} })).toBeUndefined();
  });
});

describe("subagent messages", () => {
  it("does not treat malformed lifecycle data as confirmed task completion", () => {
    expect(
      parseBackgroundAgentTasks({
        type: "system",
        subtype: "background_tasks_changed",
      }),
    ).toBeNull();
    expect(
      parseBackgroundAgentTasks({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: null,
      }),
    ).toBeNull();
    expect(
      parseBackgroundAgentTasks({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [],
      }),
    ).toEqual([]);
    expect(
      parseTaskNotification({
        type: "system",
        subtype: "task_notification",
        task_id: "one",
      }),
    ).toBeNull();
    expect(
      parseTaskNotification({
        type: "system",
        subtype: "task_notification",
        task_id: "one",
        status: "running",
      }),
    ).toBeNull();
  });

  it("keeps optional task type and description absent without losing subagent metadata", () => {
    expect(
      parseTaskStarted({
        type: "system",
        subtype: "task_started",
        task_id: "one",
        subagent_type: "Explore",
        skip_transcript: true,
      }),
    ).toMatchObject({ taskId: "one", subagentType: "Explore", ambient: true });
    expect(
      parseTaskProgress({
        type: "system",
        subtype: "task_progress",
        task_id: "one",
      })?.description,
    ).toBeUndefined();
  });

  it("detects nested agent traffic by parent_tool_use_id", () => {
    expect(isSubagentMessage({ parent_tool_use_id: "toolu_agent" })).toBe(true);
    expect(isSubagentMessage({ parent_tool_use_id: null })).toBe(false);
    expect(isSubagentMessage({ type: "assistant" })).toBe(false);
  });

  it("does not rebind the parent session to a subagent session id", () => {
    expect(
      sessionIdFromMessage({
        type: "assistant",
        session_id: "sub_1",
        parent_tool_use_id: "toolu_agent",
      }),
    ).toBeUndefined();
    expect(
      sessionIdFromMessage({
        type: "assistant",
        session_id: "sess_1",
        parent_tool_use_id: null,
      }),
    ).toBe("sess_1");
  });

  it("parses task lifecycle frames for local agents", () => {
    expect(
      parseTaskStarted({
        type: "system",
        subtype: "task_started",
        task_id: "t1",
        tool_use_id: "toolu_agent",
        description: "Explore the auth module",
        task_type: "local_agent",
        is_backgrounded: true,
      }),
    ).toEqual({
      taskId: "t1",
      toolUseId: "toolu_agent",
      description: "Explore the auth module",
      taskType: "local_agent",
      backgrounded: true,
      ambient: false,
    });
    expect(
      parseTaskProgress({
        type: "system",
        subtype: "task_progress",
        task_id: "t1",
        last_tool_name: "Read",
        description: "Explore the auth module",
      }),
    ).toMatchObject({
      taskId: "t1",
      lastToolName: "Read",
    });
    expect(
      parseTaskUpdated({
        type: "system",
        subtype: "task_updated",
        task_id: "t1",
        patch: { status: "completed" },
      }),
    ).toMatchObject({ taskId: "t1", status: "completed" });
    expect(
      parseTaskNotification({
        type: "system",
        subtype: "task_notification",
        task_id: "t1",
        tool_use_id: "toolu_agent",
        status: "completed",
        summary: "Found the tokens",
      }),
    ).toMatchObject({
      taskId: "t1",
      status: "completed",
      summary: "Found the tokens",
    });
    expect(
      parseBackgroundAgentTasks({
        type: "system",
        subtype: "background_tasks_changed",
        tasks: [
          {
            task_id: "t1",
            task_type: "local_agent",
            description: "Explore",
          },
          {
            task_id: "bash_1",
            task_type: "local_bash",
            description: "sleep 10",
          },
          {
            task_id: "watch",
            task_type: "local_agent",
            description: "watcher",
            ambient: true,
          },
        ],
      }),
    ).toEqual([
      { taskId: "t1", taskType: "local_agent", description: "Explore" },
    ]);
    expect(
      parseToolProgress({
        type: "tool_progress",
        tool_use_id: "toolu_agent",
        subagent_type: "explore",
      }),
    ).toMatchObject({
      toolUseId: "toolu_agent",
      subagentType: "explore",
    });
  });
});
