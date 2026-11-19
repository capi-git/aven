import { describe, expect, it } from "vitest";
import {
  describePermissionUpdates,
  parseControlRequest,
  permissionUpdatesAsSettings,
  sessionPermissionUpdates,
  toClaudePermissionResult,
} from "./claudeProtocol";

/*
 * Shapes follow the Claude Agent SDK's types (`@anthropic-ai/claude-agent-sdk`
 * 0.3.220, sdk.d.ts): `SDKControlPermissionRequest.permission_suggestions` is
 * `PermissionUpdate[]`, and `PermissionResult` allows with
 * `updatedPermissions` or denies with `message`.
 */

const bashRule = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "pnpm test:*" }],
  behavior: "allow",
  destination: "localSettings",
};

describe("Always allow for a Claude chat", () => {
  it("reads permission_suggestions off a can_use_tool request", () => {
    const control = parseControlRequest({
      type: "control_request",
      request_id: "req_1",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "pnpm test" },
        permission_suggestions: [bashRule],
      },
    });
    expect(control?.alwaysUpdates).toEqual([
      { ...bashRule, destination: "session" },
    ]);
  });

  it("leaves Always out when Claude suggests nothing", () => {
    const control = parseControlRequest({
      type: "control_request",
      request_id: "req_2",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "rm -rf build" },
      },
    });
    expect(control?.alwaysUpdates).toBeUndefined();
  });

  it("scopes every grant to the session and drops mode changes and deny rules", () => {
    expect(
      sessionPermissionUpdates([
        bashRule,
        { type: "setMode", mode: "acceptEdits", destination: "session" },
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "curl:*" }],
          behavior: "deny",
          destination: "userSettings",
        },
        {
          type: "addDirectories",
          directories: ["/Users/me/shared/"],
          destination: "projectSettings",
        },
        { type: "addRules", rules: [{}], behavior: "allow" },
        "nonsense",
      ]),
    ).toEqual([
      { ...bashRule, destination: "session" },
      {
        type: "addDirectories",
        directories: ["/Users/me/shared/"],
        destination: "session",
      },
    ]);
    expect(sessionPermissionUpdates(undefined)).toEqual([]);
  });

  it("names what Always covers in a few words", () => {
    const say = (value: unknown[]) =>
      describePermissionUpdates(sessionPermissionUpdates(value));
    expect(say([bashRule])).toBe("pnpm test *");
    expect(
      say([
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "git status" }],
          behavior: "allow",
          destination: "session",
        },
      ]),
    ).toBe("git status");
    expect(
      say([
        {
          type: "addRules",
          rules: [{ toolName: "WebFetch", ruleContent: "domain:example.com" }],
          behavior: "allow",
          destination: "session",
        },
      ]),
    ).toBe("example.com");
    expect(
      say([
        {
          type: "addRules",
          rules: [{ toolName: "Edit", ruleContent: "//repo/src/**" }],
          behavior: "allow",
          destination: "session",
        },
      ]),
    ).toBe("edits in /repo/src/**");
    expect(
      say([
        {
          type: "addRules",
          rules: [{ toolName: "mcp__linear__create_issue" }],
          behavior: "allow",
          destination: "session",
        },
      ]),
    ).toBe("linear create_issue");
    expect(
      say([
        {
          type: "addDirectories",
          directories: ["/Users/me/shared/"],
          destination: "session",
        },
      ]),
    ).toBe("files in shared");
    const long = say([
      {
        type: "addRules",
        rules: [
          {
            toolName: "Bash",
            ruleContent:
              "node scripts/a-very-long-script-name-for-testing.mjs:*",
          },
        ],
        behavior: "allow",
        destination: "session",
      },
    ]);
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("…")).toBe(true);
  });

  it("answers with updatedPermissions only when allowed always", () => {
    const always = sessionPermissionUpdates([bashRule]);
    const input = { command: "pnpm test" };
    expect(toClaudePermissionResult("allowAlways", input, { always })).toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: always,
    });
    expect(toClaudePermissionResult("allow", input, { always })).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
    // Nothing to grant: a plain allow.
    expect(toClaudePermissionResult("allowAlways", input)).toEqual({
      behavior: "allow",
      updatedInput: input,
    });
  });

  it("keeps today's denial without a note, and adds the note when given", () => {
    expect(toClaudePermissionResult("deny", {})).toEqual({
      behavior: "deny",
      message: "User declined tool execution.",
    });
    expect(toClaudePermissionResult("deny", {}, { note: "   " })).toEqual({
      behavior: "deny",
      message: "User declined tool execution.",
    });
    expect(
      toClaudePermissionResult("deny", {}, { note: "Ask me before pushing." }),
    ).toEqual({
      behavior: "deny",
      message:
        "User declined tool execution. The user said: Ask me before pushing.",
    });
  });

  it("turns grants into settings for a later launch", () => {
    expect(
      permissionUpdatesAsSettings(
        sessionPermissionUpdates([
          bashRule,
          {
            type: "addRules",
            rules: [{ toolName: "WebSearch" }],
            behavior: "allow",
            destination: "session",
          },
          {
            type: "addDirectories",
            directories: ["/tmp/out"],
            destination: "session",
          },
        ]),
      ),
    ).toEqual({
      allow: ["Bash(pnpm test:*)", "WebSearch"],
      additionalDirectories: ["/tmp/out"],
    });
  });
});
