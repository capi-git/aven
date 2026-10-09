import { describe, expect, it } from "vitest";
import { assertCodexStorage } from "./codexStorage";

describe("effective Codex history isolation", () => {
  it("accepts private state and equivalent Windows path representations", () => {
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "/aven/codex-home" } },
        "/aven/codex-home/",
      ),
    ).not.toThrow();
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "C:\\Users\\Jack\\Aven\\codex-home" } },
        "//?/c:/users/jack/aven/codex-home",
      ),
    ).not.toThrow();
    expect(() =>
      assertCodexStorage(
        { config: { sqlite_home: "\\\\server\\share\\codex-home" } },
        "//?/UNC/server/share/codex-home",
      ),
    ).not.toThrow();
  });

  it.each([
    undefined,
    {},
    { config: {} },
    { config: { sqlite_home: "/shared/.codex" } },
    { config: { sqlite_home: "/AVEN/codex-home" } },
    { config: { sqlite_home: "/aven\\codex-home" } },
  ])("rejects unverifiable or externally overridden state: %j", (response) => {
    expect(() => assertCodexStorage(response, "/aven/codex-home")).toThrow(
      "No chat was started",
    );
  });

  it.each(["keyring", "auto"])(
    "rejects effective auth routing that could select a different account: %s",
    (mode) => {
      expect(() =>
        assertCodexStorage(
          {
            config: {
              sqlite_home: "/aven/codex-home",
              cli_auth_credentials_store: mode,
            },
          },
          "/aven/codex-home",
        ),
      ).toThrow("login and history are unchanged");
    },
  );

  describe("remote MCP credential compatibility", () => {
    const macHome = "/aven/codex-home";
    const windowsHome = "C:\\Users\\Jack\\Aven\\codex-home";
    const remoteServers = { remote: { url: "https://mcp.example.com" } };
    const assertMcpStorage = (
      home: string,
      config: Record<string, unknown>,
    ): void =>
      assertCodexStorage({ config: { sqlite_home: home, ...config } }, home);

    it.each([undefined, "auto", "keyring"])(
      "allows ordinary Mac keyring storage with MCP mode %s",
      (mode) => {
        expect(() =>
          assertMcpStorage(macHome, {
            mcp_oauth_credentials_store: mode,
            mcp_servers: remoteServers,
          }),
        ).not.toThrow();
      },
    );

    it.each([undefined, "auto", "keyring"])(
      "rejects the Windows encrypted storage default with MCP mode %s",
      (mode) => {
        expect(() =>
          assertMcpStorage(windowsHome, {
            mcp_oauth_credentials_store: mode,
            mcp_servers: remoteServers,
          }),
        ).toThrow('mcp_oauth_credentials_store = "file"');
      },
    );

    it("honors an effective feature override instead of the platform default", () => {
      expect(() =>
        assertMcpStorage(macHome, {
          features: { secret_auth_storage: true },
          mcp_servers: remoteServers,
        }),
      ).toThrow("No chat was started");
      expect(() =>
        assertMcpStorage(windowsHome, {
          features: { secret_auth_storage: false },
          mcp_servers: remoteServers,
        }),
      ).not.toThrow();
    });

    it.each([macHome, windowsHome])(
      "allows file-based remote MCP credentials on %s",
      (home) => {
        expect(() =>
          assertMcpStorage(home, {
            features: { secret_auth_storage: true },
            mcp_oauth_credentials_store: "file",
            mcp_servers: remoteServers,
          }),
        ).not.toThrow();
      },
    );

    it.each([
      undefined,
      {},
      { local: { command: "mcp-server", args: [] } },
      { disabled: { url: "https://mcp.example.com", enabled: false } },
      {
        local: { command: "mcp-server" },
        disabled: { url: "https://mcp.example.com", enabled: false },
      },
    ])(
      "allows configurations without an enabled remote server: %j",
      (servers) => {
        expect(() =>
          assertMcpStorage(windowsHome, {
            mcp_oauth_credentials_store: "keyring",
            mcp_servers: servers,
          }),
        ).not.toThrow();
      },
    );

    it("checks every server, including an explicitly enabled remote server", () => {
      expect(() =>
        assertMcpStorage(windowsHome, {
          mcp_servers: {
            disabled: { url: "https://disabled.example.com", enabled: false },
            local: { command: "mcp-server" },
            remote: { url: "https://enabled.example.com", enabled: true },
          },
        }),
      ).toThrow("No chat was started");
    });
  });
});
