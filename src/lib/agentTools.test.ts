import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  createPath: vi.fn(),
  homeDir: vi.fn(async () => "/home/me"),
  writeTextFile: vi.fn(),
  invalidateSkills: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));
vi.mock("./fs", () => ({
  createPath: mocks.createPath,
  homeDir: mocks.homeDir,
  writeTextFile: mocks.writeTextFile,
}));
vi.mock("./skills", () => ({ invalidateSkills: mocks.invalidateSkills }));
import {
  getAgentToolStatus,
  installPersonalComputerUseSkill,
  openComputerUseSettings,
} from "./agentTools";
import { COMPUTER_USE_SKILL_BODY } from "./computerUseSkill";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.createPath.mockResolvedValue(undefined);
});

describe("optional agent tools", () => {
  it("checks through the native status command without requesting permissions", async () => {
    mocks.invoke.mockResolvedValue({
      browserAvailable: true,
      desktop: { state: "ready" },
    });
    expect((await getAgentToolStatus()).desktop.state).toBe("ready");
    expect(mocks.invoke.mock.calls).toEqual([["agent_tool_status"]]);
  });
  it("reports web preview as unsupported without pretending it has desktop access", async () => {
    mocks.isTauri.mockReturnValue(false);
    expect(await getAgentToolStatus()).toMatchObject({
      browserAvailable: false,
      desktop: { state: "unsupported" },
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("opens only the requested privacy pane when explicitly invoked", async () => {
    await openComputerUseSettings("accessibility");
    expect(mocks.invoke.mock.calls).toEqual([
      ["open_computer_use_settings", { permission: "accessibility" }],
    ]);
  });
  it("exports portable instructions and invalidates the catalog after a successful write", async () => {
    await expect(installPersonalComputerUseSkill()).resolves.toBe(
      "/home/me/.agents/skills/aven-computer-use/SKILL.md",
    );
    expect(mocks.createPath).toHaveBeenCalledWith(
      "/home/me",
      ".agents/skills/aven-computer-use/SKILL.md",
      false,
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "/home/me/.agents/skills/aven-computer-use/SKILL.md",
      COMPUTER_USE_SKILL_BODY,
    );
    expect(mocks.invalidateSkills).toHaveBeenCalledOnce();
  });
  it("never overwrites an existing personal skill", async () => {
    mocks.createPath.mockRejectedValue(new Error("Already exists"));
    await expect(installPersonalComputerUseSkill()).rejects.toThrow(
      "Already exists",
    );
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
    expect(mocks.invalidateSkills).not.toHaveBeenCalled();
  });
});
