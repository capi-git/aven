import { asRecord } from "./codexProtocol";

function comparablePath(path: string, windows: boolean): string {
  if (!windows) return path.replace(/\/+$/, "");
  return path
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/** Managed requirements can outrank process overrides; verify before starting a chat. */
export function assertCodexStorage(response: unknown, home: string): void {
  const config = asRecord(asRecord(response)?.config);
  const actual = config?.sqlite_home;
  const windows = /^(?:[a-z]:[\\/]|\\\\|\/\/\?\/)/i.test(home);
  if (
    !home ||
    typeof actual !== "string" ||
    comparablePath(actual, windows) !== comparablePath(home, windows)
  ) {
    throw new Error(
      "Codex configuration prevented Aven from using its private chat storage. No chat was started.",
    );
  }
  if (
    config?.cli_auth_credentials_store === "keyring" ||
    config?.cli_auth_credentials_store === "auto"
  ) {
    throw new Error(
      "Aven cannot isolate Codex history with keyring authentication yet. Your Codex login and history are unchanged.",
    );
  }
  // Secrets encryption keys depend on CODEX_HOME; this backend defaults on for Windows.
  const secretAuthStorage = asRecord(config?.features)?.secret_auth_storage;
  const usesSecrets =
    typeof secretAuthStorage === "boolean" ? secretAuthStorage : windows;
  const hasRemoteMcpServer = Object.values(
    asRecord(config?.mcp_servers) ?? {},
  ).some((value) => {
    const server = asRecord(value);
    return (
      server?.enabled !== false &&
      typeof server?.url === "string" &&
      server.url.trim() !== ""
    );
  });
  if (
    usesSecrets &&
    hasRemoteMcpServer &&
    config?.mcp_oauth_credentials_store !== "file"
  ) {
    throw new Error(
      'Aven cannot safely share remote MCP credentials with Codex\'s encrypted keyring storage yet. Use mcp_oauth_credentials_store = "file" in your Codex configuration. No chat was started.',
    );
  }
}
