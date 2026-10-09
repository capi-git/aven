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
}
