import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { Menu, type MenuOptions } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_MAC } from "./platform";

export type WorkspaceNativeMenuItem =
  | { id: string; label: string; disabled?: boolean; checked?: boolean }
  | { separator: true };

export function supportsWorkspaceNativeMenu(): boolean {
  return IS_MAC && isTauri();
}

/** AppKit menus remain above the live browser without an HTML occlusion layer. */
export async function showWorkspaceNativeMenu(
  anchor: HTMLElement,
  items: WorkspaceNativeMenuItem[],
): Promise<string | null> {
  if (!supportsWorkspaceNativeMenu())
    throw new Error("Native workspace menus are unavailable.");
  if (!anchor.isConnected) return null;
  const currentWindow = getCurrentWindow();
  const nativeScale = await currentWindow.scaleFactor();
  if (!Number.isFinite(nativeScale) || nativeScale <= 0)
    throw new Error("The window scale is unavailable.");
  const scale = (window.devicePixelRatio || 1) / nativeScale;
  let choice: string | null = null;
  let accepting = true;
  const options: NonNullable<MenuOptions["items"]> = items.map((item) => {
    if ("separator" in item) return { item: "Separator" as const };
    const { id, label, disabled, checked } = item;
    return {
      text: label,
      enabled: !disabled,
      ...(checked == null ? {} : { checked }),
      action: () => {
        if (!accepting || choice !== null || disabled) return;
        choice = id;
      },
    };
  });
  const menu = await Menu.new({ items: options });
  try {
    if (!anchor.isConnected) return null;
    const rect = anchor.getBoundingClientRect();
    // Tauri holds the webview resource-table lock through AppKit tracking.
    // A nested menu.get/set/close IPC can deadlock the main thread. Keep this
    // popup immutable and release its resource only after tracking returns.
    await menu.popup(
      new LogicalPosition(rect.left * scale, rect.bottom * scale),
      currentWindow,
    );
    return choice;
  } finally {
    accepting = false;
    await menu.close().catch(() => {});
  }
}
