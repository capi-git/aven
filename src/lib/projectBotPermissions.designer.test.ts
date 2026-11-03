// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCrewsCache, updateCrew, type Crew } from "./crews";
import {
  WEB_TOOLS,
  botPermissionRules,
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
    sources: [`${COPY}/src`, `${COPY}/package.json`, `${COPY}/aven-mockups`],
    entries: [
      `${COPY}/src`,
      `${COPY}/package.json`,
      `${COPY}/aven-mockups`,
      `${COPY}/node_modules`,
      `${COPY}/.env`,
      `${COPY}/.github`,
    ],
  },
};
const STORE = "/data/bots/mockups";

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

describe("the Designer's rules", () => {
  it("may edit only its mock-ups folder: the copy's own files and your folder are refused", () => {
    const { deny = [], ask = [] } = crewPermissionRules(crew, "designer");
    expect(deny).toContain(`Edit(/${PROJECT}/**)`);
    expect(deny).toContain(`Edit(/${COPY}/src)`);
    expect(deny).toContain(`Edit(/${COPY}/src/**)`);
    expect(deny).toContain(`Edit(/${COPY}/package.json)`);
    // Ignored entries and dot files too: a cache is no way out.
    expect(deny).toContain(`Edit(/${COPY}/node_modules/**)`);
    expect(deny).toContain(`Edit(/${COPY}/.env)`);
    expect(deny).toContain(`Edit(/${COPY}/.github/**)`);
    expect(deny).not.toContain(`Edit(/${COPY}/**)`);
    // Aven's store of mock-ups is no one's to write.
    expect(deny).toContain(`Edit(/${STORE}/**)`);
    expect(deny.some((rule) => rule.includes("aven-mockups"))).toBe(false);
    // A reader otherwise: no deleting, nothing waits on you.
    expect(deny).toContain("Bash(rm *)");
    expect(deny).toContain("Bash(git push)");
    expect(deny).toContain("Bash(npm publish *)");
    expect(ask).toEqual([]);
  });

  it("never reads the web or gets Aven's browser, whatever Access says", () => {
    for (const web of ["none", "builders", "everyone"] as const) {
      const rules = crewPermissionRules(
        { ...crew, access: { web } },
        "designer",
      );
      expect(rules.deny).toEqual(expect.arrayContaining(WEB_TOOLS));
      expect(
        crewSandbox({ ...crew, access: { web } }, "designer", "/tmp/aven.sock")
          .network?.allowUnixSockets,
      ).toBeUndefined();
    }
  });

  it("has a sandbox that can't write the copy's files, except its folder", () => {
    const sandbox = crewSandbox(crew, "designer", undefined);
    expect(sandbox.allowUnsandboxedCommands).toBe(false);
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([`${COPY}/src`, `${COPY}/package.json`]),
    );
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([`${COPY}/node_modules`, `${COPY}/.env`, STORE]),
    );
    expect(sandbox.filesystem?.denyWrite).not.toContain(`${COPY}/aven-mockups`);
    // A Checker's sandbox refuses that folder too: only the Designer draws.
    expect(
      crewSandbox(crew, "checker", undefined).filesystem?.denyWrite,
    ).toContain(`${COPY}/aven-mockups`);
  });

  it("launches its chat in the copy with its rules, no MCP servers, and not read-only", () => {
    updateCrew(PROJECT, (current) => ({
      ...current,
      on: true,
      copy: crew.copy,
      members: [
        { id: "builder", role: "builder", sessionId: "b-chat" },
        { id: "designer", role: "designer", sessionId: "d-chat" },
      ],
    }));
    const permissions = crewChatPermissions("d-chat")!;
    expect(permissions).toMatchObject({
      mode: "auto",
      noMcp: true,
      noEscalation: true,
      workFolder: COPY,
    });
    expect(permissions.readOnly).toBeUndefined();
    expect(permissions.rules.deny).toContain(`Edit(/${COPY}/src/**)`);
    expect(permissions.rules.deny).toEqual(expect.arrayContaining(WEB_TOOLS));
  });
});

describe("mock-ups and everyone else", () => {
  it("lets no Builder write the copy's mock-up folder or Aven's store, where it only reads", () => {
    const { deny = [] } = crewPermissionRules(crew, "builder");
    expect(deny).toContain(`Edit(/${COPY}/aven-mockups)`);
    expect(deny).toContain(`Edit(/${COPY}/aven-mockups/**)`);
    expect(deny).toContain(`Edit(/${STORE})`);
    expect(deny).toContain(`Edit(/${STORE}/**)`);
    expect(deny).not.toContain(`Edit(/${COPY}/**)`);
    const sandbox = crewSandbox(crew, "builder", undefined);
    expect(sandbox.filesystem?.denyWrite).toEqual(
      expect.arrayContaining([`${COPY}/aven-mockups`, STORE]),
    );
    expect(sandbox.filesystem?.denyWrite).not.toContain(`${COPY}/src`);
    // The Designer's rules name the store too, but never its own folder.
    const designer = crewPermissionRules(crew, "designer").deny ?? [];
    expect(designer).toContain(`Edit(/${STORE}/**)`);
    expect(designer.some((rule) => rule.includes("aven-mockups"))).toBe(false);
  });

  it("falls back to the files Git knows when the copy's full listing isn't known", () => {
    const { deny = [] } = crewPermissionRules(
      { ...crew, copy: { ...crew.copy!, entries: undefined } },
      "designer",
    );
    expect(deny).toContain(`Edit(/${COPY}/src/**)`);
    expect(deny).not.toContain(`Edit(/${COPY}/node_modules/**)`);
  });
});

describe("your keys and sign-ins", () => {
  it("are read by no bot and no teammate, by rule and by sandbox", () => {
    const folders = ["~/.ssh", "~/.aws", "~/.config/gh", "~/.kube", "~/.gnupg"];
    const files = ["~/.docker/config.json", "~/.netrc", "~/.npmrc"];
    const bot = botPermissionRules({ path: PROJECT, copy: { path: COPY } });
    for (const folder of folders)
      expect(bot.deny, folder).toContain(`Read(${folder}/**)`);
    for (const file of files) expect(bot.deny, file).toContain(`Read(${file})`);
    for (const role of [
      "builder",
      "checker",
      "security",
      "scout",
      "researcher",
      "designer",
    ] as const) {
      const { deny = [] } = crewPermissionRules(crew, role);
      for (const folder of folders)
        expect(deny, `${role} ${folder}`).toContain(`Read(${folder}/**)`);
      for (const file of files)
        expect(deny, `${role} ${file}`).toContain(`Read(${file})`);
      expect(crewSandbox(crew, role, undefined).filesystem?.denyRead).toEqual(
        expect.arrayContaining([...folders, ...files]),
      );
    }
  });
});
