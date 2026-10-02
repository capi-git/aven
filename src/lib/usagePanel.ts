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
    /** Native popup windows may frost behind a translucent tint. Owners that
     *  predate this field omit it, and their popups remain opaque. */
    glass?: boolean;
    /** Workspace background opacity (0-1) for the glass tint. */
    opacity?: number;
  };
};

const OPAQUE_PREFERENCE_QUERIES = [
  "(prefers-reduced-transparency: reduce)",
  "(prefers-contrast: more)",
];

function opaquePreferenceQueries(): MediaQueryList[] {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return [];
  return OPAQUE_PREFERENCE_QUERIES.map((query) => window.matchMedia(query));
}

/** Mirrors the main window: native glass shows only in dark appearance on a
 *  platform with native glass, when the workspace opacity is below 100% and
 *  its "Include workspace" glass is on, and the system does not ask for
 *  reduced transparency or increased contrast. */
function popupGlassOpacity(mode: "dark" | "light"): number | null {
  const root = document.documentElement;
  if (
    mode !== "dark" ||
    !root.classList.contains("has-native-glass") ||
    !root.classList.contains("glass-body") ||
    opaquePreferenceQueries().some((query) => query.matches)
  )
    return null;
  const opacity = Number.parseFloat(
    root.style.getPropertyValue("--sidebar-opacity"),
  );
  return Number.isFinite(opacity) && opacity >= 0 && opacity < 1
    ? opacity
    : null;
}

/** One popup palette for toolbar panels, including their separate native webviews. */
export function usagePanelTheme(): UsagePanelSnapshot["theme"] {
  const mode = document.documentElement.classList.contains("theme-light")
    ? "light"
    : "dark";
  const style = getComputedStyle(
    document.querySelector(".personal-shell") ?? document.documentElement,
  );
  // `--personal-accent` resolves `--theme-accent-color`, which the active
  // workspace paints on the document root.
  const accent = style.getPropertyValue("--personal-accent").trim();
  const opacity = popupGlassOpacity(mode);
  return {
    mode,
    accent: accent || (mode === "dark" ? "#5ed9d0" : "#157d82"),
    background:
      style.getPropertyValue("--aven-popup").trim() ||
      style.getPropertyValue("--personal-main-surface").trim() ||
      (mode === "dark" ? "#101416" : "#edf5f7"),
    text:
      style.getPropertyValue("--color-content").trim() ||
      (mode === "dark" ? "#ededed" : "#1c1c1c"),
    glass: opacity !== null,
    ...(opacity === null ? {} : { opacity }),
  };
}

function sameTheme(
  a: UsagePanelSnapshot["theme"],
  b: UsagePanelSnapshot["theme"],
) {
  return (
    a.mode === b.mode &&
    a.accent === b.accent &&
    a.background === b.background &&
    a.text === b.text &&
    a.glass === b.glass &&
    a.opacity === b.opacity
  );
}

/** Read after workspace layout effects apply their palette. Only observe while
 * open, and only publish actual palette changes, not transcript renders. */
export function useUsagePanelTheme(open: boolean): UsagePanelSnapshot["theme"] {
  const [theme, setTheme] = useState(usagePanelTheme);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const next = usagePanelTheme();
      setTheme((current) => (sameTheme(current, next) ? current : next));
    };
    const observer = new MutationObserver(update);
    const options = { attributes: true, attributeFilter: ["class", "style"] };
    observer.observe(document.documentElement, options);
    const shell = document.querySelector(".personal-shell");
    if (shell) observer.observe(shell, options);
    // Reduce transparency and Increase contrast can change while a popup is open.
    const queries = opaquePreferenceQueries();
    for (const query of queries) query.addEventListener?.("change", update);
    update();
    return () => {
      observer.disconnect();
      for (const query of queries)
        query.removeEventListener?.("change", update);
    };
  }, [open]);
  return theme;
}

export type UsagePanelState = {
  snapshot: UsagePanelSnapshot;
  openId: string;
  revision: number;
};

/** Owned utility window; never mounts an occluding HTML element over Chromium. */
export const nativeUsagePanel = {
  open: (anchor: HTMLElement, snapshot: UsagePanelSnapshot) => {
    const { x, y, width, height } = anchor.getBoundingClientRect();
    return invoke<string>("usage_panel_open", {
      anchor: { x, y, width, height, dpr: window.devicePixelRatio || 1 },
      snapshot,
    });
  },
  update: (snapshot: UsagePanelSnapshot, openId: string) =>
    invoke<void>("usage_panel_update", { snapshot, openId }),
  close: (openId: string) => invoke<void>("usage_panel_close", { openId }),
  getState: () => invoke<UsagePanelState>("usage_panel_get_state"),
  ready: (openId: string, revision: number) =>
    invoke<void>("usage_panel_ready", { openId, revision }),
  action: (action: "refresh" | "close", openId: string) =>
    invoke<void>("usage_panel_action", { action, openId }),
  listen: <T>(event: string, callback: (payload: T) => void) =>
    getCurrentWebview().listen<T>(event, ({ payload }) => callback(payload)),
};
