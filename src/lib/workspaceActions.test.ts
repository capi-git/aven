// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  githubCompareUrl,
  isValidRunCommand,
  loadRunScripts,
  personalProjectInfo,
  routedCloneUrl,
  saveRunScripts,
} from "./workspaceActions";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("repository clone URL validation", () => {
  it.each([
    "https://github.com/owner/repo",
    "git@github.com:owner/repo.git",
    "ssh://git@github.com/owner/repo",
    "git@github-work:owner/repo.git",
  ])(
    "preserves the explicitly supplied repository transport: %s",
    (input) => {
      expect(routedCloneUrl(input)).toBe(input);
    },
  );
  it.each([
    "https://token@github.com/owner/repo",
    "ssh://git:password@github.com/owner/repo",
    "http://github.com/owner/repo",
    "https://github.com/owner/repo?token=x",
    "ssh://git@github.com:123/owner/repo",
    "git@github:owner/repo.git",
    "https://github.com/owner/\nrepo",
    "git@github.com:../repo",
  ])(
    "rejects ambiguous, credential-bearing, or malformed input %s",
    (input) => {
      expect(() => routedCloneUrl(input)).toThrow();
    },
  );
  it("preserves explicit non-GitHub HTTPS/SSH origins", () => {
    expect(routedCloneUrl("https://gitlab.com/team/repo.git")).toBe(
      "https://gitlab.com/team/repo.git",
    );
    expect(routedCloneUrl("ssh://git@gitlab.com/team/repo.git")).toBe(
      "ssh://git@gitlab.com/team/repo.git",
    );
  });
});

describe("GitHub comparison drafts", () => {
  it("encodes refs/title/body in a fixed GitHub comparison URL", () => {
    const value = new URL(
      githubCompareUrl(
        "git@github-personal:owner/repo.git",
        " release/v1 ",
        "feature/a#b",
        "A & B",
        "first line\nsecond?x=1#fragment",
      ),
    );
    expect(value.origin).toBe("https://github.com");
    expect(value.pathname).toBe(
      "/owner/repo/compare/release%2Fv1...feature%2Fa%23b",
    );
    expect(value.searchParams.get("title")).toBe("A & B");
    expect(value.searchParams.get("body")).toBe(
      "first line\nsecond?x=1#fragment",
    );
    expect(value.searchParams.get("expand")).toBe("1");
    expect(value.hash).toBe("");
  });
  it.each([
    "https://github.com.attacker.example/owner/repo",
    "file://github.com/owner/repo",
    "https://token@github.com/owner/repo",
    "https://github.com/owner/repo?token=x",
    "https://gitlab.com/owner/repo",
    "git@github-personal:../repo",
    "ssh://evil@github.com/owner/repo",
  ])("rejects unsupported remote %s", (remote) => {
    expect(() => githubCompareUrl(remote, "main", "feature", "", "")).toThrow();
  });
  it("rejects blank or identical normalized refs", () => {
    expect(() =>
      githubCompareUrl("https://github.com/o/r", " ", "feature", "", ""),
    ).toThrow();
    expect(() =>
      githubCompareUrl("https://github.com/o/r", " main ", "main", "", ""),
    ).toThrow();
  });
  it("queries only the requested project through the read-only native command", async () => {
    native.invoke.mockResolvedValue({
      root: "/one",
      branch: "feature",
      remoteUrl: null,
      defaultBranch: null,
    });
    await personalProjectInfo("/one");
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
      "personal_project_info",
      { cwd: "/one" },
    );
  });
});

describe("saved run commands", () => {
  it("keeps commands scoped to their project and does not invoke native execution", () => {
    const first = { id: "dev", name: "Dev", command: "npm run dev" };
    const second = { id: "test", name: "Test", command: "npm test -- --run" };
    saveRunScripts("/one", [first]);
    saveRunScripts("/two", [second]);
    expect(loadRunScripts("/one")).toEqual([first]);
    expect(loadRunScripts("/two")).toEqual([second]);
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "  ",
    "echo hi\nrm file",
    "echo hi\rwhoami",
    "echo\0hi",
    "\x1b[31m",
    "echo\x7f",
  ])("rejects empty or terminal-control commands %j", (command) => {
    expect(isValidRunCommand(command)).toBe(false);
    localStorage.setItem(
      "monocode.personal.runScripts",
      JSON.stringify({ "/one": [{ id: "a", name: "Action", command }] }),
    );
    expect(loadRunScripts("/one")).toEqual([]);
  });
  it("recovers malformed storage and retains explicit shell syntax", () => {
    localStorage.setItem("monocode.personal.runScripts", "{");
    expect(loadRunScripts("/one")).toEqual([]);
    const script = {
      id: "dev",
      name: "Dev",
      command: "PORT=3000 npm run dev && echo 'ready'",
    };
    saveRunScripts("/one", [script]);
    expect(loadRunScripts("/one")).toEqual([script]);
  });
});
