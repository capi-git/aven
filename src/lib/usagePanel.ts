import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useLayoutEffect, useState } from "react";
import type { ProviderRateLimits } from "./rateLimits";

export type UsagePanelSnapshot = {
  context: { used: number; window?: number } | null;
  costUsd: number | null;
  providers: ProviderRateLimits[];
  theme: {
    mode: "dark" | "light";
    accent: string;
    background?: string;
    text?: string;
  };
};

export function usagePanelTheme(): UsagePanelSnapshot["theme"] {
  const mode = document.documentElement.classList.contains("theme-light")
    ? "light"
    : "dark";
  const style = getComputedStyle(
    document.querySelector(".personal-shell") ?? document.documentElement,
  );
  const accent = style.getPropertyValue("--personal-accent").trim();
  return {
    mode,
    accent: accent || (mode === "dark" ? "#5ed9d0" : "#157d82"),
    background:
      style.getPropertyValue("--personal-main-surface").trim() ||
      (mode === "dark" ? "#101416" : "#edf5f7"),
    text:
      style.getPropertyValue("--color-content").trim() ||
      (mode === "dark" ? "#ededed" : "#1c1c1c"),
  };
}

/** Read after workspace layout effects apply their palette. Only observe while
 * open, and only publish actual palette changes, not transcript renders. */
export function useUsagePanelTheme(open: boolean): UsagePanelSnapshot["theme"] {
  const [theme, setTheme] = useState(usagePanelTheme);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const next = usagePanelTheme();
      setTheme((current) =>
        current.mode === next.mode &&
        current.accent === next.accent &&
        current.background === next.background &&
        current.text === next.text
          ? current
          : next,
      );
    };
    const observer = new MutationObserver(update);
    const options = { attributes: true, attributeFilter: ["class", "style"] };
    observer.observe(document.documentElement, options);
    const shell = document.querySelector(".personal-shell");
    if (shell) observer.observe(shell, options);
    update();
    return () => observer.disconnect();
  }, [open]);
  return theme;
}

/** Owned utility window; never mounts an occluding HTML element over Chromium. */
export const nativeUsagePanel = {
  open: (anchor: HTMLElement, snapshot: UsagePanelSnapshot) => {
    const { x, y, width, height } = anchor.getBoundingClientRect();
    return invoke<string>("usage_panel_open", {
      anchor: { x, y, width, height, dpr: window.devicePixelRatio || 1 },
      snapshot,
    });
  },
  update: (snapshot: UsagePanelSnapshot) =>
    invoke<void>("usage_panel_update", { snapshot }),
  close: () => invoke<void>("usage_panel_close"),
  getState: () => invoke<UsagePanelSnapshot>("usage_panel_get_state"),
  ready: () => invoke<void>("usage_panel_ready"),
  action: (action: "refresh" | "close") =>
    invoke<void>("usage_panel_action", { action }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
