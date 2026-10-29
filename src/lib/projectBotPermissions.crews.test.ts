// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildThreadStartParams,
  buildTurnStartParams,
} from "./harness/codexProtocol";
import {
  permissionRulesKey,
  sessionPermissions,
} from "./harness/sessionPermissions";
import { resetCrewsCache, updateCrew, type Crew } from "./crews";
import {
  crewPermissionRules,
  crewSandbox,
  installBotPermissions,
} from "./projectBotPermissions";
import { resetProjectBotsCache } from "./projectBots";

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

const PROJECT = "/Users/me/aven-site";
const COPY = "/data/bots/aven-site-crew-1";

const crew: Pick<Crew, "path" | "copy"> = {
  path: PROJECT,
  copy: {
    path: COPY,
    branch: "aven/bot/crew-1a2b",
    root: PROJECT,
    gitDir: `${PROJECT}/.git`,
    sources: [`${COPY}/src`, `${COPY}/package.json`],
  },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetProjectBotsCache();
  resetCrewsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetProjectBotsCache();
  resetCrewsCache();
});

const NEVER = [
  "Bash(git push)",
  "Bash(git push *)",
  "Bash(git * push *)",
  "Bash(gh pr create *)",
  "Bash(gh pr merge *)",
  "Bash(gh release *)",
  "Bash(npm publish *)",
  "Bash(pnpm publish *)",
  "Bash(cargo publish *)",
  "Bash(vercel *)",
  "Bash(netlify *)",
  "Bash(fly deploy *)",
  "Bash(wrangler deploy *)",
  "Bash(docker push *)",
];

describe("no push, no publish, for every crew member", () => {
  it("denies pushing, pull requests, publishing and deploying to each role", () => {
    for (const role of ["builder", "checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      for (const rule of NEVER) {
        expect(deny).toContain(rule);
        expect(ask).not.toContain(rule);
      }
      // Committing and merging still ask: the user's OK, never a bot's.
      expect(ask).toContain("Bash(git commit *)");
      expect(ask).toContain("Bash(git merge *)");
    }
  });

  it("lets the Builder edit its copy, and asks before your folder", () => {
    const { deny = [], ask = [] } = crewPermissionRules(crew, "builder");
    expect(ask).toContain(`Edit(/${PROJECT}/**)`);
    expect(deny).not.toContain(`Edit(/${COPY}/**)`);
    expect(
      crewSandbox(crew, "builder", null).filesystem?.denyWrite,
    ).not.toContain(`${COPY}/src`);
  });

  it("keeps the Checker and Scout read-only: no edits to the copy or your folder", () => {
    for (const role of ["checker", "scout"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(crew, role);
      expect(deny).toContain(`Edit(/${COPY}/**)`);
      expect(deny).toContain(`Edit(/${PROJECT}/**)`);
      expect(ask.some((rule) => rule.startsWith("Edit("))).toBe(false);
      const sandbox = crewSandbox(crew, role, null);
      expect(sandbox.allowUnsandboxedCommands).toBe(false);
      expect(sandbox.failIfUnavailable).toBe(true);
      // Its commands can't write the copy's own files…
      expect(sandbox.filesystem?.denyWrite).toEqual(
        expect.arrayContaining([`${COPY}/src`, `${COPY}/package.json`]),
      );
      // …nor the refs and index it shares with your checkout.
      expect(sandbox.filesystem?.denyWrite).toContain(`${PROJECT}/.git/refs`);
      // Only package registries and local ports.
      expect(sandbox.network?.allowedDomains).not.toContain("github.com");
    }
  });
});

describe("crew chats launch with their rules from any window", () => {
  it("gives each member's chat its rules, and the Checker a read-only flag", () => {
    const stop = installBotPermissions();
    updateCrew(PROJECT, (current) => ({
      ...current,
      ...crew,
      on: true,
      members: [
        { role: "builder", sessionId: "b-chat" },
        { role: "checker", sessionId: "c-chat", harness: "codex" },
        { role: "scout", sessionId: "s-chat" },
      ],
    }));
    const builder = sessionPermissions("b-chat")!;
    expect(builder.mode).toBe("auto");
    expect(builder.readOnly).toBeUndefined();
    expect(builder.rules.deny).toContain("Bash(git push)");
    const checker = sessionPermissions("c-chat")!;
    expect(checker.readOnly).toBe(true);
    expect(checker.rules.deny).toContain(`Edit(/${COPY}/**)`);
    expect(permissionRulesKey(checker)).not.toBe(permissionRulesKey(builder));
    expect(sessionPermissions("s-chat")?.readOnly).toBe(true);
    expect(sessionPermissions("someone-else")).toBeUndefined();
    // Off: an ordinary chat again.
    updateCrew(PROJECT, (current) => ({ ...current, on: false }));
    expect(sessionPermissions("c-chat")).toBeUndefined();
    stop();
  });
});

describe("a Checker on Codex runs read-only", () => {
  it("starts its thread and every turn in Codex's read-only sandbox, never escalating", () => {
    const thread = buildThreadStartParams({
      cwd: COPY,
      runtimeMode: "auto",
      readOnly: true,
    });
    expect(thread).toMatchObject({
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const turn = buildTurnStartParams({
      threadId: "t",
      runtimeMode: "full-access",
      readOnly: true,
      prompt: "check",
    });
    expect(turn).toMatchObject({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    });
    // Without the flag, a mode keeps its own sandbox.
    expect(
      buildTurnStartParams({ threadId: "t", runtimeMode: "auto", prompt: "x" })
        .sandboxPolicy,
    ).toEqual({ type: "workspaceWrite" });
  });
});
