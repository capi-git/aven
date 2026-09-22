import { invoke, isTauri } from "@tauri-apps/api/core";
import { createPath, homeDir, writeTextFile } from "./fs";
import { joinPath } from "./paths";
import { invalidateSkills } from "./skills";
import {
  COMPUTER_USE_SKILL_BODY,
  COMPUTER_USE_SKILL_NAME,
} from "./computerUseSkill";

export type ToolPermission = {
  name: string;
  granted: boolean;
  required: boolean;
};
export type AgentToolStatus = {
  browserAvailable: boolean;
  desktop: {
    state:
      | "ready"
      | "permissionsRequired"
      | "missing"
      | "unsupported"
      | "unverified";
    executable: string | null;
    version: string | null;
    source: string | null;
    permissions: ToolPermission[];
  };
};

export function getAgentToolStatus(): Promise<AgentToolStatus> {
  if (!isTauri())
    return Promise.resolve({
      browserAvailable: false,
      desktop: {
        state: "unsupported",
        executable: null,
        version: null,
        source: null,
        permissions: [],
      },
    });
  return invoke("agent_tool_status");
}

export function openComputerUseSettings(
  permission: "screenRecording" | "accessibility",
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
