// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionPermissions } from "./harness/sessionPermissions";
import {
  absolutePathRule,
  botPermissionRules,
  botSandbox,
  installBotPermissions,
} from "./projectBotPermissions";
import { resetProjectBotsCache, updateProjectBot } from "./projectBots";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, String(value)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
});

it("never pushes, opens pull requests, publishes or deploys, and asks before the rest", () => {
  const { ask, allow, deny } = botPermissionRules({ path: "/Users/me/Orbit" });
  expect(allow).toBeUndefined();
  for (const rule of [
    "Bash(git push)",
    "Bash(git push *)",
    "Bash(git * push *)",
    "Bash(gh pr create *)",
    "Bash(gh pr merge *)",
    "Bash(gh release *)",
    "Bash(npm publish *)",
    "Bash(pnpm publish *)",
    "Bash(yarn publish *)",
    "Bash(vercel *)",
    "Bash(supabase *)",
    "Bash(netlify *)",
    "Bash(fly deploy *)",
    "Bash(docker push *)",
  ]) {
    expect(deny).toContain(rule);
    expect(ask).not.toContain(rule);
  }
  for (const rule of [
    "Edit(//Users/me/Orbit/**)",
    "Bash(git commit *)",
    "Bash(git merge *)",
    "Bash(gh pr close *)",
    "Bash(gh issue comment *)",
    "Bash(gh issue close *)",
    "Bash(rm *)",
    "Bash(curl * -X *)",
  ])
    expect(ask).toContain(rule);
  // Only Claude Code's two Bash pattern forms, never a bare tool name.
  for (const rule of [...ask!, ...deny!])
    expect(rule).toMatch(/^(Bash|Edit)\(.+\)$/);
});

it("sandboxes a bot's commands: its copy and temp only, never the shared refs, registries only", () => {
  const sandbox = botSandbox(
    {
      copy: {
        path: "/data/bots/orbit-1a2b",
        branch: "aven/bot/jelly-1a2b",
        root: "/Users/me/Orbit",
        gitDir: "/Users/me/Orbit/.git",
      },
    },
    undefined,
  );
  expect(sandbox).toMatchObject({
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: true,
    network: { allowLocalBinding: true },
  });
  expect(sandbox.network?.allowedDomains).toContain("registry.npmjs.org");
  expect(sandbox.network?.allowedDomains).not.toContain("github.com");
  expect(sandbox.filesystem?.denyWrite).toEqual([
    "/Users/me/Orbit/.git/refs",
    "/Users/me/Orbit/.git/packed-refs",
    "/Users/me/Orbit/.git/logs",
    "/Users/me/Orbit/.git/HEAD",
    "/Users/me/Orbit/.git/index",
    // What git runs, and where the copy finds its repository.
    "/Users/me/Orbit/.git/hooks",
    "/Users/me/Orbit/.git/config",
    "/Users/me/Orbit/.git/worktrees",
    "/data/bots/orbit-1a2b/.git",
    // Settings an app would load from the copy and run as you.
    "/data/bots/orbit-1a2b/.claude",
    "/data/bots/orbit-1a2b/.mcp.json",
    "/data/bots/orbit-1a2b/.vscode",
  ]);
  // Aven's own browser and desktop commands: that one socket, once known.
  expect(sandbox.network?.allowUnixSockets).toBeUndefined();
  expect(
    botSandbox({}, "/tmp/sm-browser-1/agent.sock").network?.allowUnixSockets,
  ).toEqual(["/tmp/sm-browser-1/agent.sock"]);
  // A copy stored before its git folder was known: the root's .git.
  expect(
    botSandbox({
      copy: { path: "/data/bots/x", branch: "aven/bot/x", root: "/w/x/" },
    }).filesystem?.denyWrite?.[0],
  ).toBe("/w/x/.git/refs");
});

it("writes absolute folders as Claude Code path rules", () => {
  expect(absolutePathRule("/Users/me/Orbit/")).toBe("//Users/me/Orbit/**");
  expect(absolutePathRule("C:\\Code\\Orbit")).toBe("//c/Code/Orbit/**");
});

it("gives a bot's chat its rules in auto mode, and other chats none", () => {
  const stop = installBotPermissions();
  updateProjectBot("/Users/me/Orbit", (bot) => ({
    ...bot,
    on: true,
    sessionId: "bot-chat",
  }));
  const permissions = sessionPermissions("bot-chat");
  expect(permissions?.mode).toBe("auto");
  expect(permissions?.rules.deny).toContain("Bash(git push *)");
  expect(permissions?.sandbox?.enabled).toBe(true);
  expect(sessionPermissions("chat")).toBeUndefined();
  updateProjectBot("/Users/me/Orbit", (bot) => ({ ...bot, on: false }));
  expect(sessionPermissions("bot-chat")).toBeUndefined();
  stop();
  expect(sessionPermissions("bot-chat")).toBeUndefined();
});
