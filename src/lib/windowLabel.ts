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
