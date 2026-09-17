import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { RuntimeMode } from "./session";
import type { UsagePanelSnapshot } from "./usagePanel";

export type AccessPanelSnapshot = {
  value: RuntimeMode;
  busy: boolean;
  theme: UsagePanelSnapshot["theme"];
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
  update: (snapshot: AccessPanelSnapshot) =>
    invoke<void>("access_panel_update", { snapshot }),
  close: () => invoke<void>("access_panel_close"),
  getState: () => invoke<AccessPanelSnapshot>("access_panel_get_state"),
  ready: () => invoke<void>("access_panel_ready"),
  action: (action: RuntimeMode | "close") =>
    invoke<void>("access_panel_action", { action }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
