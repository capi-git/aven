import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The real provider adapters over a fake process: what each one sends when a
 * chat starts. No provider runs.
 */

const invoke = vi.hoisted(() => vi.fn());
const child = vi.hoisted(() => ({
  sent: [] as Record<string, unknown>[],
  onLine: null as ((line: string) => void) | null,
  refuse: null as ((message: Record<string, unknown>) => boolean) | null,
}));

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
  isTauri: () => true,
}));

function reply(message: Record<string, unknown>) {
  const { id, method } = message;
  if (id === undefined) return;
  const answer = (body: object) =>
    queueMicrotask(() =>
      child.onLine?.(JSON.stringify({ jsonrpc: "2.0", id, ...body })),
    );
  if (child.refuse?.(message))
    return answer({ error: { code: -32602, message: "Invalid params" } });
  if (method === "initialize")
    return answer({
      result: {
        protocolVersion: 1,
        agentCapabilities: { mcpCapabilities: { http: true } },
      },
    });
  if (method === "session/new")
    return answer({ result: { sessionId: "acp-1" } });
  // The prompt never finishes: the test only needs what came before it.
  if (method === "session/prompt") return;
  return answer({ result: {} });
}

vi.mock("./harness/child", async (original) => ({
  ...(await original<typeof import("./harness/child")>()),
  resolveCursorBinary: async () => ({ path: "/fake/agent" }),
  resolveGrokBinary: async () => ({ path: "/fake/grok" }),
  resolveFxBinary: async () => ({ path: "/fake/fx" }),
  spawnChild: async () => undefined,
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, onLine: (line: string) => void) => {
    child.onLine = onLine;
  },
  writeChild: async (_id: string, line: string) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    child.sent.push(message);
    reply(message);
  },
}));

import { installSessionPermissions } from "./harness/sessionPermissions";
import { forgetCursorSession, sendCursorTurn } from "./harness/cursor";
import { forgetFxSession, sendFxTurn } from "./harness/fx";
import { forgetGrokSession, sendGrokTurn } from "./harness/grok";
import type { SendTurnInput } from "./harness/types";

const SERVERS = {
  servers: [
    {
      name: "remote",
      from: "codex",
      kind: "http",
      url: "https://mcp.example.com/mcp",
    },
    { name: "keyed", from: "codex", withheld: "secret" },
  ],
  own: {},
};
const PASSED = [
  {
    type: "http",
    name: "remote",
    url: "https://mcp.example.com/mcp",
    headers: [],
  },
];

const ADAPTERS = [
  ["Cursor", sendCursorTurn, forgetCursorSession, "cursor:auto"],
  ["Grok", sendGrokTurn, forgetGrokSession, "grok:grok-4.6"],
  ["fx", sendFxTurn, forgetFxSession, "fx:zai/glm-5.2"],
] as const;

const turn = (sessionId: string, model: string): SendTurnInput =>
  ({
    sessionId,
    cwd: "/tmp/project",
    model,
    text: "hello",
    runtimeMode: "auto",
    onEvent: () => undefined,
  }) as unknown as SendTurnInput;

const newSessions = () =>
  child.sent.filter((message) => message.method === "session/new");

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 2));
}

describe.each(ADAPTERS)("%s at session start", (_name, send, forget, model) => {
  const start = async (sessionId: string) => {
    void send(turn(sessionId, model)).catch(() => undefined);
    await until(() =>
      child.sent.some((message) => message.method === "session/prompt"),
    );
    await forget(sessionId).catch(() => undefined);
  };

  beforeEach(() => {
    child.sent = [];
    child.refuse = null;
    invoke.mockReset().mockImplementation(async (command: string) => {
      if (command === "mcp_shared_servers") return SERVERS;
      return undefined;
    });
    installSessionPermissions(() => undefined);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  });

  it("passes the shared servers, with no keys", async () => {
    await start(`own-${_name}`);
    expect(newSessions()[0]?.params).toMatchObject({ mcpServers: PASSED });
    expect(JSON.stringify(child.sent)).not.toContain("keyed");
  });

  it("passes none to a teammate's or a bot's chat", async () => {
    installSessionPermissions(() => ({
      mode: "auto",
      rules: {},
      readOnly: true,
      noMcp: true,
    }));
    await start(`worker-${_name}`);
    expect(newSessions()[0]?.params).toMatchObject({ mcpServers: [] });
    expect(invoke).not.toHaveBeenCalledWith(
      "mcp_shared_servers",
      expect.anything(),
    );
  });

  it("still starts the chat when the provider refuses them", async () => {
    child.refuse = (message) =>
      message.method === "session/new" &&
      ((message.params as { mcpServers?: unknown[] }).mcpServers?.length ?? 0) >
        0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await start(`refused-${_name}`);
    warn.mockRestore();
    expect(newSessions().map((m) => m.params)).toMatchObject([
      { mcpServers: PASSED },
      { mcpServers: [] },
    ]);
  });
});
