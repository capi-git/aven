import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** The label of the window this page runs in ("main" outside Tauri). */
export function currentWindowLabel(): string {
  try {
    return isTauri() ? getCurrentWindow().label : "main";
  } catch {
    return "main";
  }
}

/**
 * A window opened with File > New Window. It starts empty and never saves
 * the workspace layout: the main window's saved workspace is the one Aven
 * restores, and a second window holding the same chats would write them
 * back over each other.
 */
export function isSecondaryWindow(): boolean {
  return currentWindowLabel() !== "main";
}
