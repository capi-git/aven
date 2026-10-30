// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  launchRefusal,
  sessionPermissions,
} from "./harness/sessionPermissions";
import { installBotPermissions } from "./projectBotPermissions";
import { resetProjectBotsCache, updateProjectBot } from "./projectBots";

/*
 * The second verification's proof (crews-verify/fixer-off), as a test of
 * the fix: a project bot turned off mid-start never launches its chat
 * without rules, while its chat becomes an ordinary chat again once its
 * copy is gone.
 */

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

const PATH = "/Users/me/site";
const COPY = "/data/bots/site-jelly";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
});

function onBot() {
  updateProjectBot(PATH, (bot) => ({
    ...bot,
    on: true,
    onAt: 1,
    sessionId: "fixer-chat",
    copy: { path: COPY, branch: "aven/bot/jelly", root: PATH },
  }));
}

it("runs a bot's chat only in its copy, with no MCP servers", () => {
  const stop = installBotPermissions();
  onBot();
  expect(sessionPermissions("fixer-chat")).toMatchObject({
    noMcp: true,
    workFolder: COPY,
  });
  expect(launchRefusal("fixer-chat", COPY)).toBeNull();
  expect(launchRefusal("fixer-chat", PATH)).toMatch(/only in its own copy/);
  stop();
});

it("refuses a bot turned off mid-start while its copy is still there", () => {
  const stop = installBotPermissions();
  onBot();
  // Turning off sets `on` first, then stops it and removes its copy.
  updateProjectBot(PATH, (bot) => ({ ...bot, on: false }));
  const off = sessionPermissions("fixer-chat")!;
  expect(off.sandbox?.enabled).toBe(true);
  expect(off.refuse).toMatch(/bot is off/);
  expect(launchRefusal("fixer-chat", COPY)).toMatch(/bot is off/);
  expect(launchRefusal("fixer-chat", PATH)).toMatch(/bot is off/);
  stop();
});

it("refuses anything launched in a bot's copy without rules", () => {
  onBot();
  // No resolver installed: a window that never set rules up.
  expect(launchRefusal("fixer-chat", COPY)).toMatch(/couldn't be read/);
  expect(launchRefusal("another-chat", `${COPY}/src`)).toMatch(
    /couldn't be read/,
  );
});

it("lets an off bot's chat be an ordinary chat once its copy is gone", () => {
  const stop = installBotPermissions();
  onBot();
  updateProjectBot(PATH, (bot) => ({ ...bot, on: false, copy: undefined }));
  expect(sessionPermissions("fixer-chat")).toBeUndefined();
  expect(launchRefusal("fixer-chat", PATH)).toBeNull();
  stop();
});
