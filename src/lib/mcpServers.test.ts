import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

import {
  EMPTY_MCP_DRAFT,
  draftHoldsKey,
  draftToSpec,
  manageMcpServer,
  mcpRequestSecrets,
  parseEnvLines,
  parseHeaderLines,
  splitArguments,
  type McpRequest,
} from "./mcpServers";

describe("keys in a draft", () => {
  const remote = (url: string) => ({
    ...EMPTY_MCP_DRAFT,
    kind: "http" as const,
    url,
  });
  const local = (args: string, env = "") => ({
    ...EMPTY_MCP_DRAFT,
    command: "npx",
    args,
    env,
  });

  it("sees a key however it was typed", () => {
    expect(draftHoldsKey(local("-y @acme/mcp"))).toBe(false);
    expect(draftHoldsKey(remote("https://mcp.example.com/mcp"))).toBe(false);
    expect(draftHoldsKey(local("-y @acme/mcp", "A=1"))).toBe(true);
    expect(draftHoldsKey(local("--api-key x"))).toBe(true);
    expect(draftHoldsKey(local("abcdef0123456789abcdef0123456789"))).toBe(true);
    expect(draftHoldsKey(remote("https://mcp.example.com/mcp?k=1"))).toBe(true);
    expect(draftHoldsKey(remote("https://u:p@mcp.example.com/mcp"))).toBe(true);
    expect(
      draftHoldsKey({
        ...remote("https://mcp.example.com/mcp"),
        headers: "X-Key: 1",
      }),
    ).toBe(true);
    expect(
      draftHoldsKey({
        ...remote("https://mcp.example.com/mcp"),
        bearerTokenEnvVar: "TOKEN",
      }),
    ).toBe(true);
  });

  it("gives Pi no headers or token variable", () => {
    expect(
      draftToSpec(
        {
          ...remote("https://mcp.example.com/mcp"),
          headers: "X-Key: 1",
          bearerTokenEnvVar: "TOKEN",
        },
        "pi",
      ),
    ).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: {},
    });
  });
});

describe("MCP server drafts", () => {
  it("splits arguments like a shell for quotes and escapes", () => {
    expect(
      splitArguments(`-y @acme/mcp --root "My Files" 'a b' c\\ d ""`),
    ).toEqual(["-y", "@acme/mcp", "--root", "My Files", "a b", "c d", ""]);
    expect(splitArguments("   ")).toEqual([]);
    expect(() => splitArguments(`"open`)).toThrow("unclosed quote");
  });

  it("reads environment and header lines", () => {
    expect(parseEnvLines("A=1\n\n B_2 = x=y ")).toEqual({
      A: "1",
      B_2: " x=y",
    });
    expect(() => parseEnvLines("NOPE")).toThrow("NAME=value");
    expect(() => parseEnvLines("1BAD=x")).toThrow();
    expect(parseHeaderLines("Authorization: Bearer abc\nX-Key:1")).toEqual({
      Authorization: "Bearer abc",
      "X-Key": "1",
    });
    expect(() => parseHeaderLines("no colon")).toThrow("Header-Name");
  });

  it("points at the line instead of repeating what may be a secret", () => {
    expect(() => parseEnvLines("A=1\nfixture-value")).toThrow(
      "Line 2 should look like NAME=value.",
    );
    expect(() => parseHeaderLines("\n\nBearer fixture-value")).toThrow(
      "Line 3 should look like Header-Name: value.",
    );
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

describe("errors from a provider's CLI", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("never repeat the values in the request", async () => {
    const request: McpRequest = {
      action: "add",
      provider: "claude",
      name: "acme",
      server: {
        type: "http",
        url: "https://mcp.example.com/m?k=fixture-query",
        headers: {
          "X-Custom": "fixture-header",
          Authorization: "Bearer plain",
        },
      },
    };
    expect(mcpRequestSecrets(request)).toEqual(
      expect.arrayContaining(["fixture-header", "plain", "fixture-query"]),
    );
    invoke.mockRejectedValue(
      "couldn't use fixture-header or plain at https://mcp.example.com/m?k=fixture-query",
    );
    await expect(manageMcpServer(request, "/p")).rejects.toThrow(
      "couldn't use [hidden] or [hidden] at https://mcp.example.com/m?k=[hidden]",
    );
  });

  it("cover a command's environment values too", async () => {
    invoke.mockRejectedValue(new Error("bad value fixture-env"));
    await expect(
      manageMcpServer(
        {
          action: "add",
          provider: "codex",
          name: "acme",
          server: {
            type: "stdio",
            command: "npx",
            args: [],
            env: { ACME: "fixture-env" },
          },
        },
        "/p",
      ),
    ).rejects.toThrow("bad value [hidden]");
  });
});
