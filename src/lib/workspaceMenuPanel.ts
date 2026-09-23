import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UsagePanelSnapshot } from "./usagePanel";

export type WorkspaceMenuPanelAnchor =
  | HTMLElement
  | { x: number; y: number; width: number; height: number };

export type WorkspaceMenuPanelSnapshot = {
  title: string;
  compact?: boolean;
  width?: number;
  align?: "start" | "end";
  gap?: number;
  items: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
    checked?: boolean;
    shortcut?: string;
    danger?: boolean;
    separatorBefore?: boolean;
  }>;
  theme: UsagePanelSnapshot["theme"];
};

export type WorkspaceMenuPanelHandle = {
  label: string;
  presentation: string;
};

export type WorkspaceMenuPanelState = {
  presentation: string;
  snapshot: WorkspaceMenuPanelSnapshot;
};

/** A controlled menu above native browser children; its owner performs actions. */
export const nativeWorkspaceMenuPanel = {
  supported: isTauri,
  open: (
    anchor: WorkspaceMenuPanelAnchor,
    snapshot: WorkspaceMenuPanelSnapshot,
  ) => {
    const { x, y, width, height } =
      anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    return invoke<WorkspaceMenuPanelHandle>("workspace_menu_panel_open", {
      anchor: { x, y, width, height, dpr: window.devicePixelRatio || 1 },
      snapshot,
    });
  },
  update: (presentation: string, snapshot: WorkspaceMenuPanelSnapshot) =>
    invoke<WorkspaceMenuPanelHandle | null>("workspace_menu_panel_update", {
      presentation,
      snapshot,
    }),
  close: (presentation: string) =>
    invoke<void>("workspace_menu_panel_close", { presentation }),
  getState: () =>
    invoke<WorkspaceMenuPanelState | null>("workspace_menu_panel_get_state"),
  ready: (presentation: string) =>
    invoke<boolean>("workspace_menu_panel_ready", { presentation }),
  action: (presentation: string, action: string) =>
    invoke<void>("workspace_menu_panel_action", { presentation, action }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
