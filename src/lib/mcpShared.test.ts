import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke,
}));

import {
  installSessionPermissions,
  registerGuardedChats,
} from "./harness/sessionPermissions";
import type { McpEntry } from "./mcpOverview";
import {
  acpResumeParams,
  acpServersForChat,
  acpTakesHttp,
  loadSharedList,
  offerServersToOpenCode,
  rowReach,
  serversForChat,
  withServersOrWithout,
  type SharedList,
  type SharedServer,
} from "./mcpShared";
import type { HarnessId } from "./session";

const remote: SharedServer = {
  name: "remote",
  from: "claude",
  kind: "http",
  url: "https://mcp.example.com/mcp",
};
const local: SharedServer = {
  name: "local",
  from: "codex",
  kind: "stdio",
  command: "npx",
  args: ["-y", "@acme/mcp"],
};
const keyed: SharedServer = {
  name: "keyed",
  from: "claude",
  withheld: "secret",
};
const list: SharedList = { servers: [remote, local, keyed], own: {} };
const HTTP_INIT = { agentCapabilities: { mcpCapabilities: { http: true } } };

describe("what a chat is given", () => {
  it("leaves out anything withheld", () => {
    expect(serversForChat(list, "cursor")).toEqual([remote, local]);
  });

  it("never shadows a server the provider has for itself", () => {
    expect(
      serversForChat({ ...list, own: { cursor: ["remote"] } }, "cursor"),
    ).toEqual([local]);
  });

  it("gives Grok only Codex's, since it reads Claude's itself", () => {
    expect(serversForChat(list, "grok")).toEqual([local]);
    // Grok would already have Claude's copy of a name both have.
    expect(
      serversForChat(
        { servers: [remote, { ...remote, from: "codex" }], own: {} },
        "grok",
      ),
    ).toEqual([]);
  });

  it("lists a name once when two providers have it", () => {
    expect(
      serversForChat(
        { servers: [remote, { ...remote, from: "codex" }], own: {} },
        "fx",
      ),
    ).toEqual([remote]);
  });
});

describe("session start", () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(list);
    installSessionPermissions(() => undefined);
  });

  it("reads the shape ACP asks for, with no env or headers filled in", async () => {
    expect(await acpServersForChat("cursor", "chat", "/p", HTTP_INIT)).toEqual([
      {
        type: "http",
        name: "remote",
        url: "https://mcp.example.com/mcp",
        headers: [],
      },
      { name: "local", command: "npx", args: ["-y", "@acme/mcp"], env: [] },
    ]);
  });

  it("sends a remote server only to an agent that says it takes one", async () => {
    expect(acpTakesHttp(HTTP_INIT)).toBe(true);
    expect(acpTakesHttp({})).toBe(false);
    expect(acpTakesHttp(undefined)).toBe(false);
    expect(await acpServersForChat("fx", "chat", "/p", {})).toEqual([
      { name: "local", command: "npx", args: ["-y", "@acme/mcp"], env: [] },
    ]);
  });

  it("gives a teammate's or a bot's chat nothing, without even looking", async () => {
    installSessionPermissions(() => ({
      mode: "auto",
      rules: {},
      noMcp: true,
    }));
    expect(await acpServersForChat("cursor", "bot", "/p", HTTP_INIT)).toEqual(
      [],
    );
    const add = vi.fn();
    await offerServersToOpenCode(add, "bot", "/p");
    expect(add).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("gives nothing to a guarded chat whose rules can't be read", async () => {
    const stop = registerGuardedChats((id) => id === "crew");
    expect(await acpServersForChat("grok", "crew", "/p", HTTP_INIT)).toEqual(
      [],
    );
    stop();
  });

  it("starts with an empty list when the native side can't answer", async () => {
    invoke.mockRejectedValue(new Error("no"));
    expect(await loadSharedList("/p")).toEqual({ servers: [], own: {} });
    invoke.mockResolvedValue(undefined);
    expect(await loadSharedList("/p")).toEqual({ servers: [], own: {} });
  });

  it("retries without servers if the provider refuses them, and says nothing of them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("Invalid params"))
      .mockResolvedValueOnce("ok");
    await expect(withServersOrWithout([remote], start)).resolves.toBe("ok");
    expect(start.mock.calls).toEqual([[[remote]], [[]]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(remote.url);
    warn.mockRestore();
  });

  it("passes on the error when there were no servers to blame", async () => {
    const start = vi.fn().mockRejectedValue(new Error("signed out"));
    await expect(withServersOrWithout([], start)).rejects.toThrow("signed out");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("leaves a resume request as it was when there is nothing to give", () => {
    expect(acpResumeParams("s", "/p", [])).toEqual({ sessionId: "s" });
    expect(acpResumeParams("s", "/p", [{}])).toEqual({
      sessionId: "s",
      cwd: "/p",
      mcpServers: [{}],
    });
  });

  it("offers OpenCode its own shapes, and shrugs off a refusal", async () => {
    const add = vi.fn().mockRejectedValueOnce(new Error("404"));
    add.mockResolvedValue(undefined);
    await offerServersToOpenCode(add, "chat", "/p");
    expect(add.mock.calls).toEqual([
      ["remote", { type: "remote", url: "https://mcp.example.com/mcp" }],
      ["local", { type: "local", command: ["npx", "-y", "@acme/mcp"] }],
    ]);
  });
});

describe("what a row says", () => {
  const entry = (
    provider: McpEntry["provider"],
    key: string,
    extra: Partial<McpEntry["connection"]> = {},
  ): McpEntry => ({
    provider,
    id: `${provider}:${key}`,
    connection: { name: key, key, state: "ready", ...extra },
  });
  const row = (entries: McpEntry[], state: "ready" | "off" = "ready") => ({
    entries,
    state,
  });
  const apps = (...ids: HarnessId[]) => new Set<HarnessId>(ids);

  it("is silent when nothing else is installed", () => {
    expect(
      rowReach(row([entry("claude", "remote")]), list, apps("claude")).line,
    ).toBeUndefined();
  });

  it("names who it reaches, and who it could be added to", () => {
    const reach = rowReach(
      row([entry("claude", "remote")]),
      list,
      apps("claude", "codex", "cursor", "opencode"),
    );
    expect(reach.line).toBe("Also on Cursor and OpenCode. Not on Codex yet.");
    expect(reach.addTo).toEqual(["codex"]);
    expect(reach.server).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: {},
    });
  });

  it("says why a server with a key stays put, and offers no copy", () => {
    const reach = rowReach(
      row([entry("claude", "keyed")]),
      list,
      apps("claude", "codex", "cursor"),
    );
    expect(reach.line).toBe("Not on Codex and Cursor: it uses a private key.");
    expect(reach.addTo).toEqual([]);
    expect(reach.server).toBeUndefined();
  });

  it("knows Grok and omp read Claude's own list, keys and all", () => {
    expect(
      rowReach(
        row([entry("claude", "keyed")]),
        list,
        apps("claude", "grok", "omp"),
      ).line,
    ).toBe("Also on Grok and omp.");
  });

  it("says plainly when an account or plugin keeps a server to itself", () => {
    expect(
      rowReach(
        row([entry("claude", "claude.ai Gmail", { account: true })]),
        { servers: [], own: {} },
        apps("claude", "cursor"),
      ).line,
    ).toBe("Not on Cursor: it comes with your account.");
    expect(
      rowReach(
        row([entry("claude", "plugin:x:y", { plugin: "x" })]),
        { servers: [], own: {} },
        apps("claude", "fx"),
      ).line,
    ).toBe("Not on fx: it comes from a plugin.");
    expect(
      rowReach(
        row([entry("claude", "repo-only", { scope: "project" })]),
        { servers: [], own: {} },
        apps("claude", "fx"),
      ).line,
    ).toBe("Not on fx: it’s set up for one project.");
  });

  it("warns that fx can't sign in, only for a remote server", () => {
    expect(
      rowReach(row([entry("claude", "remote")]), list, apps("claude", "fx"))
        .line,
    ).toBe("Also on fx. fx can’t sign in here.");
    expect(
      rowReach(row([entry("codex", "local")]), list, apps("codex", "fx")).line,
    ).toBe("Also on fx.");
  });

  it("is silent on a row that is off", () => {
    expect(
      rowReach(row([entry("claude", "remote")], "off"), list, apps("cursor"))
        .line,
    ).toBeUndefined();
  });

  it("doesn't offer Pi a name it can't hold", () => {
    const dotted = { ...remote, name: "a.b" };
    const reach = rowReach(
      row([entry("claude", "a.b")]),
      { servers: [dotted], own: {} },
      apps("claude", "pi"),
    );
    expect(reach.addTo).toEqual([]);
  });
});
