// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sessionPermissions } from "./harness/sessionPermissions";
import {
  absolutePathRule,
  botPermissionRules,
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

it("asks before pushing, committing, merging, publishing, sending, deleting and changing your files", () => {
  const { ask, allow, deny } = botPermissionRules({ path: "/Users/me/Orbit" });
  expect(allow).toBeUndefined();
  expect(deny).toBeUndefined();
  for (const rule of [
    "Edit(//Users/me/Orbit/**)",
    "Bash(git push *)",
    "Bash(git * push *)",
    "Bash(git commit *)",
    "Bash(git merge *)",
    "Bash(gh pr create *)",
    "Bash(gh pr merge *)",
    "Bash(gh pr close *)",
    "Bash(gh issue comment *)",
    "Bash(gh issue close *)",
    "Bash(gh release *)",
    "Bash(npm publish *)",
    "Bash(pnpm publish *)",
    "Bash(yarn publish *)",
    "Bash(vercel *)",
    "Bash(supabase *)",
    "Bash(netlify *)",
    "Bash(fly deploy *)",
    "Bash(docker push *)",
    "Bash(rm *)",
    "Bash(curl * -X *)",
  ])
    expect(ask).toContain(rule);
  // Only Claude Code's two Bash pattern forms, never a bare tool name.
  for (const rule of ask!) expect(rule).toMatch(/^(Bash|Edit)\(.+\)$/);
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
  expect(permissions?.rules.ask).toContain("Bash(git push *)");
  expect(sessionPermissions("chat")).toBeUndefined();
  updateProjectBot("/Users/me/Orbit", (bot) => ({ ...bot, on: false }));
  expect(sessionPermissions("bot-chat")).toBeUndefined();
  stop();
  expect(sessionPermissions("bot-chat")).toBeUndefined();
});
