import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installSessionPermissions,
  launchRefusal,
  normalPath,
  registerGuardedChats,
  type SessionPermissions,
} from "./sessionPermissions";

/*
 * A bot or crew turned off while its agent's process is being prepared:
 * both harnesses ask again with nothing awaited before the spawn, so the
 * process never starts (crews-verify: fixer-off, and a stop that arrives
 * before the process exists).
 */

const spawned: string[] = [];
const hooks = vi.hoisted(() => ({ midStart: () => {} }));

vi.mock("./child", () => ({
  resolveClaudeBinary: async () => {
    hooks.midStart();
    return { path: "/fake/claude" };
  },
  resolveCodexBinary: async () => ({ path: "/fake/codex" }),
  prepareCodexStorage: async () => {
    hooks.midStart();
    return { home: "/aven/codex-home" };
  },
  spawnChild: async (id: string) => {
    spawned.push(id);
  },
  killChild: async () => undefined,
  unwatchChild: () => undefined,
  watchChild: () => undefined,
  writeChild: async () => undefined,
}));

const { sendClaudeTurn, __claudeTestReset } = await import("./claude");
const { sendCodexTurn } = await import("./codex");

const COPY = "/data/bots/site-crew";
let refuse: string | undefined;
let uninstall: () => void;

function rules(): SessionPermissions {
  return {
    mode: "auto",
    rules: { deny: ["Bash(git push)"] },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
    },
    noMcp: true,
    workFolder: COPY,
    ...(refuse ? { refuse } : {}),
  };
}

const input = (sessionId: string) => ({
  sessionId,
  cwd: COPY,
  model: "claude:claude-sonnet-5",
  modelSettings: {},
  runtimeMode: "auto" as const,
  text: "check",
  onEvent: () => undefined,
});

beforeEach(() => {
  spawned.length = 0;
  refuse = undefined;
  hooks.midStart = () => {};
  uninstall = installSessionPermissions((id) =>
    id.startsWith("crew-") ? rules() : undefined,
  );
});
afterEach(() => {
  uninstall();
  __claudeTestReset();
});

describe("a launch is refused at the last moment before its process starts", () => {
  it("Claude: the crew turned off while the CLI was found never spawns", async () => {
    hooks.midStart = () => {
      refuse = "This crew is off, so its chat didn't start.";
    };
    await expect(sendClaudeTurn(input("crew-claude"))).rejects.toThrow(
      /crew is off/,
    );
    expect(spawned).toEqual([]);
  });

  it("Codex: the crew turned off while its storage was prepared never spawns", async () => {
    hooks.midStart = () => {
      refuse = "This crew is off, so its chat didn't start.";
    };
    await expect(
      sendCodexTurn({ ...input("crew-codex"), model: "codex:gpt-5.6" }),
    ).rejects.toThrow(/crew is off/);
    expect(spawned).toEqual([]);
  });

  it("refuses up front a guarded chat with no rules, in either harness", async () => {
    const stop = registerGuardedChats((id) => id === "guarded");
    expect(launchRefusal("guarded", COPY)).toMatch(/couldn't be read/);
    await expect(sendClaudeTurn(input("guarded"))).rejects.toThrow(
      /couldn't be read/,
    );
    await expect(
      sendCodexTurn({ ...input("guarded"), model: "codex:gpt-5.6" }),
    ).rejects.toThrow(/couldn't be read/);
    expect(spawned).toEqual([]);
    stop();
  });
});

describe("the work folder check reads paths as the file system does", () => {
  it("resolves . and .. before comparing", () => {
    expect(normalPath("/data/bots/site-crew/../../../Users/me/site")).toBe(
      "/Users/me/site",
    );
    expect(normalPath("/data/bots/site-crew/./src/../src")).toBe(
      "/data/bots/site-crew/src",
    );
    expect(normalPath("C:\\data\\bots\\..\\x")).toBe("C:/data/x");
    expect(normalPath("/../..")).toBe("/");
  });

  it("refuses a work folder escaped with ..", () => {
    expect(launchRefusal("crew-x", `${COPY}/../../../Users/me/site`)).toMatch(
      /only in its own copy/,
    );
    expect(launchRefusal("crew-x", `${COPY}/src/../lib`)).toBeNull();
    expect(launchRefusal("crew-x", `${COPY}-evil`)).toMatch(
      /only in its own copy/,
    );
  });
});
