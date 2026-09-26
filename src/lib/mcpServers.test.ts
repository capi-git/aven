import { describe, expect, it } from "vitest";
import {
  EMPTY_MCP_DRAFT,
  draftToSpec,
  parseEnvLines,
  parseHeaderLines,
  splitArguments,
} from "./mcpServers";

describe("MCP server drafts", () => {
  it("splits arguments like a shell for quotes and escapes", () => {
    expect(splitArguments(`-y @acme/mcp --root "My Files" 'a b' c\\ d ""`)).toEqual([
      "-y",
      "@acme/mcp",
      "--root",
      "My Files",
      "a b",
      "c d",
      "",
    ]);
    expect(splitArguments("   ")).toEqual([]);
    expect(() => splitArguments(`"open`)).toThrow("unclosed quote");
  });

  it("reads environment and header lines", () => {
    expect(parseEnvLines("A=1\n\n B_2 = x=y ")).toEqual({ A: "1", B_2: " x=y" });
    expect(() => parseEnvLines("NOPE")).toThrow("NAME=value");
    expect(() => parseEnvLines("1BAD=x")).toThrow();
    expect(parseHeaderLines("Authorization: Bearer abc\nX-Key:1")).toEqual({
      Authorization: "Bearer abc",
      "X-Key": "1",
    });
    expect(() => parseHeaderLines("no colon")).toThrow("Header-Name");
  });

  it("gives each provider only the auth style it supports", () => {
    const draft = {
      ...EMPTY_MCP_DRAFT,
      name: "sentry",
      kind: "http" as const,
      url: " https://mcp.sentry.dev/mcp ",
      headers: "Authorization: Bearer x",
      bearerTokenEnvVar: "SENTRY_TOKEN",
    };
    expect(draftToSpec(draft, "claude")).toEqual({
      type: "http",
      url: "https://mcp.sentry.dev/mcp",
      headers: { Authorization: "Bearer x" },
    });
    expect(draftToSpec(draft, "codex")).toEqual({
      type: "http",
      url: "https://mcp.sentry.dev/mcp",
      headers: {},
      bearerTokenEnvVar: "SENTRY_TOKEN",
    });
    expect(() => draftToSpec({ ...draft, url: "ftp://x" }, "claude")).toThrow(
      "https://",
    );
  });

  it("builds a local command server", () => {
    expect(
      draftToSpec(
        {
          ...EMPTY_MCP_DRAFT,
          name: "gh",
          command: " npx ",
          args: "-y @modelcontextprotocol/server-github",
          env: "GITHUB_TOKEN=abc",
        },
        "codex",
      ),
    ).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "abc" },
    });
    expect(() => draftToSpec(EMPTY_MCP_DRAFT, "claude")).toThrow("command");
  });
});
