import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __chatConnectionsTestReset,
  chatConnectionLine,
  checkChatConnectionsAfterSettings,
  clearChatConnections,
  dismissChatConnections,
  installChatConnectionsOpener,
  noteClaudeInit,
  noteCodexServerStatus,
  openConnectionsFromChat,
  subscribeChatConnections,
} from "./chatConnections";
import { installSessionPermissions } from "./harness/sessionPermissions";

const lists = vi.hoisted(() => ({
  claude: vi.fn(),
  codex: vi.fn(),
}));

vi.mock("./harness/providerConnections", async (original) => ({
  ...(await original<typeof import("./harness/providerConnections")>()),
  listClaudeConnections: lists.claude,
  listCodexConnections: lists.codex,
}));

/** The shape Claude Code 2.1.318 printed, against a local fake server. */
const init = (...servers: [name: string, status: string][]) => ({
  type: "system",
  subtype: "init",
  session_id: "sess_1",
  mcp_servers: servers.map(([name, status]) => ({
    name,
    status,
    source: "dynamic",
  })),
});

/** The shape Codex 0.166.0 printed, against a local fake server. */
const codexStatus = (name: string, status: string, error?: string) => ({
  threadId: "thr_1",
  name,
  status,
  error: error ?? null,
  failureReason: null,
});

let values: Map<string, string>;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  __chatConnectionsTestReset();
  lists.claude.mockReset();
  lists.codex.mockReset();
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.unstubAllGlobals();
});

describe("Claude's init line", () => {
  it("shows nothing when all is well", () => {
    noteClaudeInit(
      "c",
      init(["fine", "connected"], ["off", "disabled"], ["slow", "pending"]),
    );
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("ignores an init line with no server list", () => {
    noteClaudeInit("c", { type: "system", subtype: "init" });
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("names one signed-out server", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"], ["fine", "connected"]));
    expect(chatConnectionLine("c")).toEqual({
      harness: "claude",
      text: "notion isn't signed in",
      action: "Sign in",
    });
  });

  it("says a failed server couldn't connect, and doesn't offer a sign-in", () => {
    noteClaudeInit("c", init(["tools", "failed"]));
    expect(chatConnectionLine("c")).toMatchObject({
      text: "tools couldn't connect",
      action: "Connections",
    });
  });

  it("shows many problems as one line, signed-out first", () => {
    noteClaudeInit(
      "c",
      init(
        ["tools", "failed"],
        ["claude.ai Notion", "needs-auth"],
        ["plugin:design:slack", "needs-auth"],
      ),
    );
    expect(chatConnectionLine("c")).toEqual({
      harness: "claude",
      text: "Notion and 2 others aren't connected",
      action: "Sign in",
      title: "Notion, slack, tools",
    });
  });

  it("goes away when a later turn reports the server working", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    noteClaudeInit("c", init(["notion", "connected"]));
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("tells subscribers only when their own chat's line changes", () => {
    const heard = vi.fn();
    const other = vi.fn();
    subscribeChatConnections("c", heard);
    subscribeChatConnections("d", other);
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    const line = chatConnectionLine("c");
    expect(heard).toHaveBeenCalledTimes(1);
    // Every turn repeats the list.
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    expect(heard).toHaveBeenCalledTimes(1);
    expect(chatConnectionLine("c")).toBe(line);
    expect(other).not.toHaveBeenCalled();
  });
});

describe("Codex's status updates", () => {
  it("adds up one server at a time, and clears when it starts again", () => {
    noteCodexServerStatus("x", codexStatus("a", "starting"), undefined);
    expect(chatConnectionLine("x")).toBeNull();
    noteCodexServerStatus(
      "x",
      codexStatus(
        "a",
        "failed",
        "The a MCP server is not logged in. Run `codex mcp login a`.",
      ),
      undefined,
    );
    expect(chatConnectionLine("x")).toMatchObject({
      harness: "codex",
      text: "a isn't signed in",
      action: "Sign in",
    });
    noteCodexServerStatus(
      "x",
      codexStatus("b", "failed", "No such file"),
      "thr_1",
    );
    expect(chatConnectionLine("x")?.text).toBe(
      "a and 1 other aren't connected",
    );
    noteCodexServerStatus("x", codexStatus("a", "starting"), "thr_1");
    expect(chatConnectionLine("x")).toMatchObject({
      text: "b couldn't connect",
      action: "Connections",
    });
    noteCodexServerStatus("x", codexStatus("b", "ready"), "thr_1");
    expect(chatConnectionLine("x")).toBeNull();
  });

  it("treats Codex's reauthentication reason as signed out", () => {
    noteCodexServerStatus(
      "x",
      {
        ...codexStatus("a", "failed"),
        failureReason: "reauthenticationRequired",
      },
      "thr_1",
    );
    expect(chatConnectionLine("x")?.action).toBe("Sign in");
  });

  it("ignores another thread's servers", () => {
    noteCodexServerStatus("x", codexStatus("a", "failed", "no"), "thr_2");
    expect(chatConnectionLine("x")).toBeNull();
  });

  it("uses the name Settings shows for a built-in server", () => {
    noteCodexServerStatus(
      "x",
      codexStatus("codex_apps", "failed", "no"),
      "thr_1",
    );
    expect(chatConnectionLine("x")?.text).toBe("ChatGPT apps couldn't connect");
  });
});

describe("teammate and bot chats", () => {
  it("record nothing, from either provider", () => {
    uninstall = installSessionPermissions((id) =>
      id === "closed" ? { mode: "auto", rules: {}, noMcp: true } : undefined,
    );
    noteClaudeInit("closed", init(["notion", "needs-auth"]));
    noteCodexServerStatus("closed", codexStatus("a", "failed", "no"), "thr_1");
    expect(chatConnectionLine("closed")).toBeNull();
  });
});

describe("dismissing", () => {
  it("holds for that chat, across a restart of Aven, and not for others", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    noteClaudeInit("d", init(["notion", "needs-auth"]));
    dismissChatConnections("c");
    expect(chatConnectionLine("c")).toBeNull();
    expect(chatConnectionLine("d")).not.toBeNull();
    expect(values.has("aven.chatConnections.dismissed")).toBe(true);

    __chatConnectionsTestReset();
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("still speaks up about a different server", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    dismissChatConnections("c");
    noteClaudeInit("c", init(["notion", "needs-auth"], ["slack", "failed"]));
    expect(chatConnectionLine("c")?.text).toBe("slack couldn't connect");
  });

  it("survives unreadable storage", () => {
    values.set("aven.chatConnections.dismissed", "{not json");
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    expect(chatConnectionLine("c")).not.toBeNull();
  });

  it("remembers only so many chats", () => {
    noteClaudeInit("first", init(["a", "failed"]));
    dismissChatConnections("first");
    for (let i = 0; i < 200; i++) {
      noteClaudeInit(`c${i}`, init(["a", "failed"]));
      dismissChatConnections(`c${i}`);
    }
    const stored = JSON.parse(values.get("aven.chatConnections.dismissed")!);
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored.first).toBeUndefined();
    expect(stored.c199).toEqual(["a"]);
  });
});

describe("coming back from Settings", () => {
  const ready = (key: string) => ({ name: key, key, state: "ready" });
  const signedOut = (key: string) => ({
    name: key,
    key,
    state: "needs-sign-in",
  });

  function signIn(chat = "c") {
    const open = vi.fn();
    uninstall = installChatConnectionsOpener(open);
    openConnectionsFromChat(chat, "/repo");
    expect(open).toHaveBeenCalledTimes(1);
  }

  it("offers to reconnect once the provider reports it working", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    lists.claude.mockResolvedValue([ready("notion")]);
    signIn();
    await checkChatConnectionsAfterSettings();
    expect(lists.claude).toHaveBeenCalledWith("/repo");
    expect(chatConnectionLine("c")).toMatchObject({
      text: "notion is ready. Reconnect this chat to use it.",
      action: "Reconnect",
    });
  });

  it("keeps saying so through later turns of the old process", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    lists.claude.mockResolvedValue([ready("notion")]);
    signIn();
    await checkChatConnectionsAfterSettings();
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    expect(chatConnectionLine("c")?.action).toBe("Reconnect");
    // The new process reports it working: nothing more to say.
    noteClaudeInit("c", init(["notion", "connected"]));
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("names several ready servers on one line", async () => {
    noteClaudeInit("c", init(["a", "needs-auth"], ["b", "needs-auth"]));
    lists.claude.mockResolvedValue([ready("a"), ready("b")]);
    signIn();
    await checkChatConnectionsAfterSettings();
    expect(chatConnectionLine("c")?.text).toBe(
      "a and 1 other are ready. Reconnect this chat to use them.",
    );
  });

  it("changes nothing when nothing changed", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    const before = chatConnectionLine("c");
    lists.claude.mockResolvedValue([signedOut("notion")]);
    signIn();
    await checkChatConnectionsAfterSettings();
    expect(chatConnectionLine("c")).toBe(before);
  });

  it("asks when the check can't say", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    lists.claude.mockRejectedValue(new Error("no"));
    signIn();
    await checkChatConnectionsAfterSettings();
    expect(chatConnectionLine("c")).toMatchObject({
      text: "Signed in? Reconnect this chat to use it.",
      action: "Reconnect",
    });
  });

  it("checks with the chat's own provider, and only once", async () => {
    noteCodexServerStatus("x", codexStatus("a", "failed", "no"), "thr_1");
    lists.codex.mockResolvedValue([ready("a")]);
    signIn("x");
    await checkChatConnectionsAfterSettings();
    await checkChatConnectionsAfterSettings();
    expect(lists.codex).toHaveBeenCalledTimes(1);
    expect(lists.claude).not.toHaveBeenCalled();
  });

  it("leaves chats that didn't send anyone there alone", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    await checkChatConnectionsAfterSettings();
    expect(lists.claude).not.toHaveBeenCalled();
  });

  it("drops a finished chat's check", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    lists.claude.mockResolvedValue([ready("notion")]);
    signIn();
    clearChatConnections("c");
    await checkChatConnectionsAfterSettings();
    expect(lists.claude).not.toHaveBeenCalled();
    expect(chatConnectionLine("c")).toBeNull();
  });
});
