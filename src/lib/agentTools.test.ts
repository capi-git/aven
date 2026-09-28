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
  getDesktopControlStatus,
  installPersonalComputerUseSkill,
  openComputerUseSettings,
  requestDesktopPermission,
  setDesktopControlEnabled,
  type DesktopControlStatus,
} from "./agentTools";
import { COMPUTER_USE_SKILL_BODY } from "./computerUseSkill";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isTauri.mockReturnValue(true);
  mocks.createPath.mockResolvedValue(undefined);
});

const ready: DesktopControlStatus = {
  state: "ready",
  enabled: true,
  permissions: [
    { name: "Screen Recording", granted: true, required: true },
    { name: "Accessibility", granted: true, required: true },
  ],
};

describe("built-in agent tools", () => {
  it("checks through the native status command without requesting permissions", async () => {
    mocks.invoke.mockResolvedValue({
      browserAvailable: true,
      desktop: ready,
    });
    expect((await getAgentToolStatus()).desktop.state).toBe("ready");
    expect(mocks.invoke.mock.calls).toEqual([["agent_tool_status"]]);
  });
  it("reports web preview as unsupported without pretending it has desktop access", async () => {
    mocks.isTauri.mockReturnValue(false);
    expect(await getAgentToolStatus()).toEqual({
      browserAvailable: false,
      desktop: { state: "unsupported", enabled: false, permissions: [] },
    });
    expect(await getDesktopControlStatus()).toEqual({
      state: "unsupported", enabled: false, permissions: [],
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("reads desktop status without enabling it or requesting access", async () => {
    const off = { ...ready, state: "off", enabled: false };
    mocks.invoke.mockResolvedValue(off);
    expect(await getDesktopControlStatus()).toBe(off);
    expect(mocks.invoke.mock.calls).toEqual([["desktop_control_status"]]);
  });
  it.each([true, false])("sets desktop enabled to %s and returns native status", async (enabled) => {
    const result = { ...ready, enabled, state: enabled ? "ready" : "off" };
    mocks.invoke.mockResolvedValue(result);
    expect(await setDesktopControlEnabled(enabled)).toBe(result);
    expect(mocks.invoke.mock.calls).toEqual([
      ["desktop_control_set_enabled", { enabled }],
    ]);
  });
  it.each(["screenRecording", "accessibility"] as const)(
    "requests only %s when explicitly invoked and returns native status",
    async (permission) => {
      mocks.invoke.mockResolvedValue(ready);
      expect(await requestDesktopPermission(permission)).toBe(ready);
      expect(mocks.invoke.mock.calls).toEqual([
        ["desktop_control_request_permission", { permission }],
      ]);
    },
  );
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
