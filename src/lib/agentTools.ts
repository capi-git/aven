import { invoke, isTauri } from "@tauri-apps/api/core";
import { createPath, homeDir, writeTextFile } from "./fs";
import { joinPath } from "./paths";
import { invalidateSkills } from "./skills";
import {
  COMPUTER_USE_SKILL_BODY,
  COMPUTER_USE_SKILL_NAME,
} from "./computerUseSkill";

export type ToolPermission = {
  name: "Screen Recording" | "Accessibility";
  granted: boolean;
  required: boolean;
};
export type DesktopPermission = "screenRecording" | "accessibility";
export type DesktopControlStatus = {
  state: "ready" | "permissionsRequired" | "off" | "unsupported";
  enabled: boolean;
  permissions: ToolPermission[];
};
export type AgentToolStatus = {
  browserAvailable: boolean;
  desktop: DesktopControlStatus;
};

const unsupportedDesktop = (): DesktopControlStatus => ({
  state: "unsupported",
  enabled: false,
  permissions: [],
});

export function getAgentToolStatus(): Promise<AgentToolStatus> {
  if (!isTauri())
    return Promise.resolve({
      browserAvailable: false,
      desktop: unsupportedDesktop(),
    });
  return invoke("agent_tool_status");
}

export function getDesktopControlStatus(): Promise<DesktopControlStatus> {
  if (!isTauri()) return Promise.resolve(unsupportedDesktop());
  return invoke("desktop_control_status");
}

export function setDesktopControlEnabled(
  enabled: boolean,
): Promise<DesktopControlStatus> {
  return invoke("desktop_control_set_enabled", { enabled });
}

export function requestDesktopPermission(
  permission: DesktopPermission,
): Promise<DesktopControlStatus> {
  return invoke("desktop_control_request_permission", { permission });
}

export function openComputerUseSettings(
  permission: DesktopPermission,
): Promise<void> {
  return invoke("open_computer_use_settings", { permission });
}

/** Exclusive file creation preserves an existing skill, including concurrent attempts. */
export async function installPersonalComputerUseSkill(): Promise<string> {
  const root = await homeDir();
  const relative = `.agents/skills/${COMPUTER_USE_SKILL_NAME}/SKILL.md`;
  await createPath(root, relative, false);
  const path = joinPath(root, relative);
  await writeTextFile(path, COMPUTER_USE_SKILL_BODY);
  invalidateSkills();
  return path;
}
