import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSessionPermissions,
  type SessionPermissions,
} from "./sessionPermissions";

/*
 * A crew's Checker on Codex runs with its tools closed: no web search, no
 * apps, plugins or MCP servers, checked in Codex's own `config/read` before
 * it starts (crews-verify: Codex web search, plugins); and a running process
 * is reused only while its tools and rules still match.
 */

const spawns: string[][] = [];
let onLine: ((line: string) => void) | undefined;
/** The fake app-server honours `-c` overrides unless this is off. */
let honoursOverrides = true;
let currentArgs: string[] = [];
let turnCount = 0;

/** What `config/read` reports for the process started with `args`. */
function effectiveConfig(args: string[]) {
  const config: Record<string, unknown> & {
    features: Record<string, unknown>;
    mcp_servers: Record<string, Record<string, unknown>>;
    plugins: Record<string, Record<string, unknown>>;
  } = {
    sqlite_home: "/aven/codex-home",
    web_search: null,
    features: { plugins: true, remote_plugin: true, tool_suggest: true },
    mcp_servers: { github: { url: "https://mcp.example" } },
    // Names as the user's Codex has them: `@` and all, one with a dot.
    plugins: {
      "github@openai-curated": { enabled: true },
      "browser@openai-bundled": { enabled: true },
      "anthropic-skills@claude-cowork": { enabled: true },
      "odd.name@x": { enabled: true },
    },
  };
  if (!honoursOverrides) return { config };
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] !== "-c") continue;
    // Codex's own parser: split on every dot, quotes kept as part of a name.
    const [key, value] = args[index + 1]!.split("=");
    const path = key!.split(".");
    if (path[0] === "web_search") config.web_search = JSON.parse(value!);
    else if (path[0] === "features") config.features[path[1]!] = false;
    else if (path[0] === "mcp_servers" && config.mcp_servers[path[1]!])
      config.mcp_servers[path[1]!]!.enabled = false;
    else if (path[0] === "plugins" && config.plugins[path[1]!])
      config.plugins[path[1]!]!.enabled = false;
  }
  return { config };
}

function respond(line: string) {
  const message = JSON.parse(line) as {
    id?: number;
    method?: string;
  };
  if (message.id == null) return;
  const reply = (result: unknown) =>
    queueMicrotask(() => onLine?.(JSON.stringify({ id: message.id, result })));
  switch (message.method) {
    case "initialize":
      return reply({});
    case "config/read":
      return reply(effectiveConfig(currentArgs));
    case "thread/start":
    case "thread/resume":
      return reply({ thread: { id: "thr_1" } });
    case "turn/start": {
      const id = `turn_${(turnCount += 1)}`;
      reply({ turn: { id, status: "inProgress" } });
      setTimeout(
        () =>
          onLine?.(
            JSON.stringify({
              method: "turn/completed",
              params: { turn: { id, status: "completed" } },
            }),
          ),
        5,
      );
      return;
    }
  }
}

vi.mock("./child", () => ({
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  prepareCodexStorage: async () => ({ home: "/aven/codex-home" }),
  spawnChild: async (_id: string, _path: string, args: string[]) => {
    spawns.push(args);
    currentArgs = args;
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: (_id: string, line: (l: string) => void) => {
    onLine = line;
  },
  writeChild: async (_id: string, line: string) => respond(line),
}));

const {
  codexClosedToolArgs,
  codexMcpOffArgs,
  codexOpenTools,
  sendCodexTurn,
  stopCodexSession,
  __codexTestReset,
} = await import("./codex");

const COPY = "/data/bots/site-crew";
let closed = true;
let uninstall: () => void;

function rules(): SessionPermissions | undefined {
  if (!closed) return undefined;
  return {
    mode: "auto",
    rules: { deny: ["Bash(git push)"] },
    readOnly: true,
    noMcp: true,
    workFolder: COPY,
  };
}

const turn = () =>
  sendCodexTurn({
    sessionId: "checker",
    cwd: COPY,
    model: "codex:gpt-5.6",
    runtimeMode: "auto",
    text: "check",
    onEvent: () => undefined,
  });

beforeEach(() => {
  spawns.length = 0;
  honoursOverrides = true;
  closed = true;
  uninstall = installSessionPermissions((id) =>
    id === "checker" ? rules() : undefined,
  );
});
afterEach(async () => {
  uninstall();
  await stopCodexSession("checker");
  __codexTestReset?.();
});

describe("a closed Codex chat", () => {
  it("switches off web search, apps, plugins and MCP, and starts once Codex says so", async () => {
    await turn();
    // First start: the servers and plugins weren't known yet, so Codex
    // reported them on; Aven started again with each switched off.
    expect(spawns).toHaveLength(2);
    expect(spawns[1]).toEqual([
      ...codexClosedToolArgs(
        ["github"],
        [
          "github@openai-curated",
          "browser@openai-bundled",
          "anthropic-skills@claude-cowork",
          "odd.name@x",
        ],
      ),
      "app-server",
    ]);
    expect(spawns[1]).toEqual(
      expect.arrayContaining([
        'web_search="disabled"',
        "features.apps=false",
        "features.plugins=false",
        "features.remote_plugin=false",
        "features.computer_use=false",
        "mcp_servers.github.enabled=false",
        // Bare, as Codex's -c parser reads them: quotes would be part of the name.
        "plugins.github@openai-curated.enabled=false",
        "plugins.anthropic-skills@claude-cowork.enabled=false",
      ]),
    );
    // A name with a dot can't be written for -c; the plugins switch covers it.
    expect(spawns[1]!.join(" ")).not.toContain("odd.name");
  });

  it("refuses to start when Codex keeps a tool on", async () => {
    honoursOverrides = false;
    const error = await turn().catch((reason: Error) => reason);
    expect(String(error)).toMatch(
      /Codex couldn't be locked down here: web search, plugins, remote_plugin and \d+ more stayed on, so this chat didn't start\./,
    );
    expect(spawns).toHaveLength(2);
  });

  it("restarts a running process whose tools no longer match", async () => {
    closed = false;
    await turn();
    expect(spawns.at(-1)).toEqual(["app-server"]);
    // The chat became a crew's Checker: its next turn starts a new, closed
    // process instead of reusing the open one.
    closed = true;
    const before = spawns.length;
    await turn();
    expect(spawns.length).toBeGreaterThan(before);
    expect(spawns.at(-1)).toContain('web_search="disabled"');
    // And a closed process that still matches is reused.
    const after = spawns.length;
    await turn();
    expect(spawns.length).toBe(after);
  });
});

describe("naming plugins and servers for Codex", () => {
  it("writes names bare, and skips any its -c can't hold", () => {
    expect(
      codexMcpOffArgs(["github", "my server", "a.b", 'q"x', "x@y"]),
    ).toEqual([
      "-c",
      "mcp_servers.github.enabled=false",
      "-c",
      "mcp_servers.x@y.enabled=false",
    ]);
  });

  it("counts no plugin as open while the plugins switch is off", () => {
    expect(
      codexOpenTools({
        config: {
          web_search: "disabled",
          features: { plugins: false },
          plugins: { "github@openai-curated": { enabled: true } },
        },
      }),
    ).toEqual([]);
  });
});

describe("what counts as open", () => {
  it("lists every tool still on", () => {
    expect(
      codexOpenTools({
        config: {
          web_search: "cached",
          features: { apps: true, remote_plugin: false },
          mcp_servers: { a: {}, b: { enabled: false } },
          plugins: { p: { enabled: true } },
        },
      }),
    ).toEqual(["web search", "apps", "MCP a", "plugin p"]);
    expect(
      codexOpenTools({
        config: {
          web_search: "disabled",
          features: { apps: false, remote_plugin: false, tool_suggest: false },
          mcp_servers: {},
          plugins: {},
        },
      }),
    ).toEqual([]);
  });
});
