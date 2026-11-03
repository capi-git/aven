// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrewsCache, updateCrew, type Crew } from "./crews";
import {
  WEB_TOOLS,
  crewChatPermissions,
  crewPermissionRules,
  crewSandbox,
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

const crew: Pick<Crew, "path" | "copy" | "access"> = {
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

describe("the Researcher's rules", () => {
  it("reads the web under Builders and Everyone, and not when no one may", () => {
    const denies = (web: "none" | "builders" | "everyone") =>
      crewPermissionRules({ ...crew, access: { web } }, "researcher").deny ??
      [];
    expect(denies("none")).toEqual(expect.arrayContaining(WEB_TOOLS));
    for (const tool of WEB_TOOLS) {
      expect(denies("builders")).not.toContain(tool);
      expect(denies("everyone")).not.toContain(tool);
    }
    // Planning a goal: offline, whatever you set (it never plans, but the
    // rule holds for every role).
    expect(
      crewPermissionRules(
        { ...crew, access: { web: "everyone" } },
        "researcher",
        true,
      ).deny,
    ).toEqual(expect.arrayContaining(WEB_TOOLS));
  });

  it("never writes: no edits to the copy or your folder, no deleting, and the read-only sandbox", () => {
    for (const web of ["none", "builders", "everyone"] as const) {
      const { deny = [], ask = [] } = crewPermissionRules(
        { ...crew, access: { web } },
        "researcher",
      );
      expect(deny).toContain(`Edit(/${COPY}/**)`);
      expect(deny).toContain(`Edit(/${PROJECT}/**)`);
      expect(deny).toContain("Bash(rm *)");
      expect(deny).toContain("Bash(git push)");
      expect(deny).toContain("Bash(npm publish *)");
      expect(ask).toEqual([]);
    }
    const sandbox = crewSandbox(crew, "researcher", undefined);
    expect(sandbox.allowUnsandboxedCommands).toBe(false);
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([`${COPY}/src`, `${COPY}/package.json`]),
    );
  });

  it("gets Aven's browser exactly when it may read the web", () => {
    const socket = (web: "none" | "builders" | "everyone") =>
      crewSandbox({ ...crew, access: { web } }, "researcher", "/tmp/aven.sock")
        .network?.allowUnixSockets;
    expect(socket("none")).toBeUndefined();
    expect(socket("builders")).toEqual(["/tmp/aven.sock"]);
    expect(socket("everyone")).toEqual(["/tmp/aven.sock"]);
  });

  it("launches its chat read-only, in the copy, with no MCP servers", () => {
    updateCrew(PROJECT, (current) => ({
      ...current,
      on: true,
      copy: crew.copy,
      members: [
        { id: "builder", role: "builder", sessionId: "b-chat" },
        { id: "researcher", role: "researcher", sessionId: "r-chat" },
      ],
    }));
    const permissions = crewChatPermissions("r-chat")!;
    expect(permissions).toMatchObject({
      mode: "auto",
      readOnly: true,
      noMcp: true,
      noEscalation: true,
      workFolder: COPY,
    });
    expect(permissions.refuse).toBeUndefined();
    expect(permissions.rules.deny).toContain(`Edit(/${COPY}/**)`);
    expect(permissions.rules.deny).not.toContain("WebFetch");
  });
});
