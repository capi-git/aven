import { describe, expect, it } from "vitest";
import {
  codexAlwaysLabel,
  codexDeclineNote,
  toCodexApprovalDecision,
} from "./codexProtocol";

/*
 * Codex app-server decisions (codex 0.149.0): `CommandExecutionApprovalDecision`
 * and `FileChangeApprovalDecision` take accept, acceptForSession, decline and
 * cancel; a command request may list `availableDecisions`.
 */

describe("Codex session-wide approvals", () => {
  it("maps Always to acceptForSession for commands and file changes only", () => {
    expect(toCodexApprovalDecision("allowAlways", "command")).toBe(
      "acceptForSession",
    );
    expect(toCodexApprovalDecision("allowAlways", "file-change")).toBe(
      "acceptForSession",
    );
    expect(toCodexApprovalDecision("allowAlways", "mcp-tool")).toBe("accept");
    expect(toCodexApprovalDecision("allow", "command")).toBe("accept");
    expect(toCodexApprovalDecision("deny", "command")).toBe("decline");
  });

  it("names the command, or nothing when Codex does not offer it", () => {
    expect(codexAlwaysLabel("command", { command: "pnpm test" })).toBe(
      "pnpm test",
    );
    expect(
      codexAlwaysLabel("command", {
        command: "pnpm test",
        availableDecisions: [
          "accept",
          { acceptWithExecpolicyAmendment: { execpolicy_amendment: [] } },
          "decline",
        ],
      }),
    ).toBeUndefined();
    expect(codexAlwaysLabel("command", {})).toBe("this command");
    const long = codexAlwaysLabel("command", {
      command:
        "node ./scripts/a-long-script-that-does-several-things.mjs --all",
    })!;
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("…")).toBe(true);
    expect(codexAlwaysLabel("file-change", {})).toBe("changes to these files");
    expect(codexAlwaysLabel("permissions", {})).toBe("this access");
    expect(codexAlwaysLabel("mcp-tool", {})).toBeUndefined();
    expect(codexAlwaysLabel("command", null)).toBeUndefined();
  });

  it("words the note it steers to the turn", () => {
    expect(codexDeclineNote("  Use pnpm, not npm. ")).toBe(
      "I declined that request. Use pnpm, not npm.",
    );
  });
});
