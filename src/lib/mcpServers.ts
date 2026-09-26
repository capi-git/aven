/**
 * Add, remove, and sign in to MCP servers. Each provider's own CLI makes the
 * change, so its configuration stays the single source of truth; the native
 * side validates every field and builds the exact command.
 */
import { invoke } from "@tauri-apps/api/core";

export type McpProvider = "claude" | "codex";

/** Claude only. user: every project; project: shared .mcp.json; local: just you here. */
export type ClaudeMcpScope = "user" | "project" | "local";

export type McpServerSpec =
  | {
      type: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers: Record<string, string>;
      bearerTokenEnvVar?: string;
    };

export type McpRequest =
  | {
      action: "add";
      provider: McpProvider;
      name: string;
      scope?: ClaudeMcpScope;
      server: McpServerSpec;
    }
  | {
      action: "remove";
      provider: McpProvider;
      name: string;
      scope?: ClaudeMcpScope;
    }
  | { action: "login"; provider: McpProvider; name: string }
  | { action: "logout"; provider: McpProvider; name: string };

export function manageMcpServer(
  request: McpRequest,
  cwd: string,
): Promise<string> {
  return invoke<string>("provider_mcp", { request, cwd: cwd || null });
}

export const MCP_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/**
 * Splits a typed argument line the way a shell would for simple cases:
 * whitespace separates, and single or double quotes keep spaces together.
 */
export function splitArguments(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && i + 1 < line.length)
        current += line[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
      started = true;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error("An argument has an unclosed quote.");
  if (started) args.push(current);
  return args;
}

/** One `KEY=value` per line; blank lines are ignored. */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf("=");
    const key = at > 0 ? line.slice(0, at).trim() : "";
    if (!ENV_KEY_RE.test(key))
      throw new Error(`“${line}” should look like NAME=value.`);
    env[key] = line.slice(at + 1);
  }
  return env;
}

/** One `Name: value` per line; blank lines are ignored. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(":");
    const name = at > 0 ? line.slice(0, at).trim() : "";
    if (!HEADER_NAME_RE.test(name))
      throw new Error(`“${line}” should look like Header-Name: value.`);
    headers[name] = line.slice(at + 1).trim();
  }
  return headers;
}

export type McpServerDraft = {
  name: string;
  kind: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  bearerTokenEnvVar: string;
};

export const EMPTY_MCP_DRAFT: McpServerDraft = {
  name: "",
  kind: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  bearerTokenEnvVar: "",
};

/**
 * The request for one provider. Claude sends tokens as headers; Codex reads
 * one from an environment variable, so each only receives what it supports.
 */
export function draftToSpec(
  draft: McpServerDraft,
  provider: McpProvider,
): McpServerSpec {
  if (draft.kind === "stdio") {
    const command = draft.command.trim();
    if (!command) throw new Error("Enter the command that starts the server.");
    return {
      type: "stdio",
      command,
      args: splitArguments(draft.args),
      env: parseEnvLines(draft.env),
    };
  }
  const url = draft.url.trim();
  if (!/^https?:\/\/\S+$/i.test(url))
    throw new Error("Enter a server URL starting with https://.");
  if (provider === "claude")
    return { type: "http", url, headers: parseHeaderLines(draft.headers) };
  const token = draft.bearerTokenEnvVar.trim();
  if (token && !ENV_KEY_RE.test(token))
    throw new Error("Enter a valid environment variable name for the token.");
  return {
    type: "http",
    url,
    headers: {},
    ...(token ? { bearerTokenEnvVar: token } : {}),
  };
}
