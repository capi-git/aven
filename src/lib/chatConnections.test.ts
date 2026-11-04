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
const CONFIGURED = new Set(["a", "b"]);
const codexNote = (chat: string, params: unknown, threadId?: string) =>
  noteCodexServerStatus(chat, params, threadId, CONFIGURED);
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
        ["notion", "needs-auth"],
        ["slack", "needs-auth"],
      ),
    );
    expect(chatConnectionLine("c")).toEqual({
      harness: "claude",
      text: "notion and 2 others aren't connected",
      action: "Sign in",
      title: "notion, slack, tools",
    });
  });

  it("stays quiet about servers a plugin or an account brought", () => {
    noteClaudeInit(
      "c",
      init(
        ["plugin:design:asana", "needs-auth"],
        ["plugin:design:figma", "needs-auth"],
        ["plugin:vercel:vercel", "failed"],
        ["claude.ai Gmail", "needs-auth"],
      ),
    );
    expect(chatConnectionLine("c")).toBeNull();
  });

  it("still names a server the person added, among those", () => {
    // `source` is "user" for a user-level server, as Claude Code printed it.
    noteClaudeInit("c", {
      type: "system",
      subtype: "init",
      mcp_servers: [
        {
          name: "plugin:design:asana",
          status: "needs-auth",
          source: "dynamic",
        },
        { name: "mine", status: "needs-auth", source: "user" },
      ],
    });
    expect(chatConnectionLine("c")?.text).toBe("mine isn't signed in");
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
    codexNote("x", codexStatus("a", "starting"), undefined);
    expect(chatConnectionLine("x")).toBeNull();
    codexNote(
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
    codexNote("x", codexStatus("b", "failed", "No such file"), "thr_1");
    expect(chatConnectionLine("x")?.text).toBe(
      "a and 1 other aren't connected",
    );
    codexNote("x", codexStatus("a", "starting"), "thr_1");
    expect(chatConnectionLine("x")).toMatchObject({
      text: "b couldn't connect",
      action: "Connections",
    });
    codexNote("x", codexStatus("b", "ready"), "thr_1");
    expect(chatConnectionLine("x")).toBeNull();
  });

  it("treats Codex's reauthentication reason as signed out", () => {
    codexNote(
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
    codexNote("x", codexStatus("a", "failed", "no"), "thr_2");
    expect(chatConnectionLine("x")).toBeNull();
  });

  it("stays quiet about a server it didn't configure, like a plugin's", () => {
    codexNote("x", codexStatus("codex_apps", "failed", "no"), "thr_1");
    codexNote("x", codexStatus("fx-plugin", "failed", "no"), "thr_1");
    expect(chatConnectionLine("x")).toBeNull();
  });
});

describe("teammate and bot chats", () => {
  it("record nothing, from either provider", () => {
    uninstall = installSessionPermissions((id) =>
      id === "closed" ? { mode: "auto", rules: {}, noMcp: true } : undefined,
    );
    noteClaudeInit("closed", init(["notion", "needs-auth"]));
    codexNote("closed", codexStatus("a", "failed", "no"), "thr_1");
    expect(chatConnectionLine("closed")).toBeNull();
  });
});

describe("dismissing", () => {
  it("holds for that connection in every chat, across a restart of Aven", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    noteClaudeInit("d", init(["notion", "needs-auth"]));
    const heard = vi.fn();
    subscribeChatConnections("d", heard);
    dismissChatConnections("c");
    expect(chatConnectionLine("c")).toBeNull();
    // A chat with the line open loses it at once.
    expect(chatConnectionLine("d")).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get("aven.chatConnections.dismissed")!)).toEqual([
      "claude:notion",
    ]);

    __chatConnectionsTestReset();
    noteClaudeInit("new", init(["notion", "needs-auth"]));
    expect(chatConnectionLine("new")).toBeNull();
  });

  it("still speaks up about a different connection", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    dismissChatConnections("c");
    noteClaudeInit("c", init(["notion", "needs-auth"], ["slack", "failed"]));
    expect(chatConnectionLine("c")?.text).toBe("slack couldn't connect");
  });

  it("keeps each provider's connections apart", () => {
    noteClaudeInit("c", init(["a", "failed"]));
    dismissChatConnections("c");
    codexNote("x", codexStatus("a", "failed", "no"), "thr_1");
    expect(chatConnectionLine("x")?.text).toBe("a couldn't connect");
  });

  it("forgets once the connection works, so a new failure is news", () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    dismissChatConnections("c");
    noteClaudeInit("d", init(["notion", "connected"]));
    expect(JSON.parse(values.get("aven.chatConnections.dismissed")!)).toEqual(
      [],
    );
    noteClaudeInit("e", init(["notion", "failed"]));
    expect(chatConnectionLine("e")?.text).toBe("notion couldn't connect");
  });

  it("forgets from Codex's own report too", () => {
    codexNote("x", codexStatus("a", "failed", "no"), "thr_1");
    dismissChatConnections("x");
    codexNote("x", codexStatus("a", "ready"), "thr_1");
    codexNote("x", codexStatus("a", "failed", "no"), "thr_1");
    expect(chatConnectionLine("x")?.text).toBe("a couldn't connect");
  });

  it("forgets when the check after Settings finds it working", async () => {
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    dismissChatConnections("c");
    noteClaudeInit("d", init(["slack", "needs-auth"]));
    lists.claude.mockResolvedValue([
      { name: "notion", key: "notion", state: "ready" },
    ]);
    const uninstall2 = installChatConnectionsOpener(() => undefined);
    openConnectionsFromChat("d", "/repo");
    await checkChatConnectionsAfterSettings();
    uninstall2();
    expect(JSON.parse(values.get("aven.chatConnections.dismissed")!)).toEqual(
      [],
    );
  });

  it("survives unreadable storage", () => {
    values.set("aven.chatConnections.dismissed", "{not json");
    noteClaudeInit("c", init(["notion", "needs-auth"]));
    expect(chatConnectionLine("c")).not.toBeNull();
  });

  it("remembers only so many connections, dropping the oldest", () => {
    for (let i = 0; i <= 200; i++) {
      noteClaudeInit("c", init([`s${i}`, "failed"]));
      dismissChatConnections("c");
    }
    const stored: string[] = JSON.parse(
      values.get("aven.chatConnections.dismissed")!,
    );
    expect(stored).toHaveLength(200);
    expect(stored).not.toContain("claude:s0");
    expect(stored).toContain("claude:s200");
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
    codexNote("x", codexStatus("a", "failed", "no"), "thr_1");
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
