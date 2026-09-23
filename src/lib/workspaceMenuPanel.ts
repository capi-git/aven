import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UsagePanelSnapshot } from "./usagePanel";

export type WorkspaceMenuPanelSnapshot = {
  title: string;
  items: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  theme: UsagePanelSnapshot["theme"];
};

/** A controlled menu above native browser children; its owner performs actions. */
export const nativeWorkspaceMenuPanel = {
  supported: isTauri,
  open: (anchor: HTMLElement, snapshot: WorkspaceMenuPanelSnapshot) => {
    const { x, y, width, height } = anchor.getBoundingClientRect();
    return invoke<string>("workspace_menu_panel_open", {
      anchor: { x, y, width, height, dpr: window.devicePixelRatio || 1 },
      snapshot,
    });
  },
  update: (snapshot: WorkspaceMenuPanelSnapshot) =>
    invoke<void>("workspace_menu_panel_update", { snapshot }),
  close: () => invoke<void>("workspace_menu_panel_close"),
  getState: () =>
    invoke<WorkspaceMenuPanelSnapshot>("workspace_menu_panel_get_state"),
  ready: () => invoke<void>("workspace_menu_panel_ready"),
  action: (action: string) =>
    invoke<void>("workspace_menu_panel_action", { action }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
