import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { RuntimeMode } from "./session";
import type { UsagePanelSnapshot } from "./usagePanel";

export type AccessPanelSnapshot = {
  value: RuntimeMode;
  busy: boolean;
  theme: UsagePanelSnapshot["theme"];
};

export type AccessPanelState = {
  snapshot: AccessPanelSnapshot;
  openId: string;
  revision: number;
};

/** A themed app surface above browser children, without hiding their contents. */
export const nativeAccessPanel = {
  supported: isTauri,
  open: (anchor: HTMLElement, snapshot: AccessPanelSnapshot) => {
    const { x, y, width, height } = anchor.getBoundingClientRect();
    return invoke<string>("access_panel_open", {
      anchor: { x, y, width, height, dpr: window.devicePixelRatio || 1 },
      snapshot,
    });
  },
  update: (snapshot: AccessPanelSnapshot, openId: string) =>
    invoke<void>("access_panel_update", { snapshot, openId }),
  close: (openId: string) => invoke<void>("access_panel_close", { openId }),
  getState: () => invoke<AccessPanelState>("access_panel_get_state"),
  ready: (openId: string, revision: number) =>
    invoke<void>("access_panel_ready", { openId, revision }),
  action: (action: RuntimeMode | "close", openId: string) =>
    invoke<void>("access_panel_action", { action, openId }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
