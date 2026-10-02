import { invoke } from "@tauri-apps/api/core";
import { useLayoutEffect } from "react";
import type { UsagePanelSnapshot } from "./usagePanel";

type PopupTheme = UsagePanelSnapshot["theme"];

/** The panel rectangle in CSS pixels plus the viewport that maps them to points. */
export type PopupGlassFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  viewportWidth: number;
  viewportHeight: number;
};

/** Set on the popup document only while native frost sits behind the panel. */
export const POPUP_GLASS_CLASS = "popup-glass";
const OPACITY_PROPERTY = "--popup-glass-opacity";

const native = {
  /** Whether this popup window currently has its native material. */
  applied: false,
  /** Serializes native requests so a removal cannot overtake an application. */
  queue: Promise.resolve() as Promise<unknown>,
  /** The latest application the popup must await before it is shown. */
  pending: null as Promise<void> | null,
};

/** The tint opacity for a glass snapshot, or null to keep the opaque palette.
 *  Older owners send no glass hint; light snapshots are always opaque. */
export function popupGlassOpacity(theme?: PopupTheme | null): number | null {
  if (theme?.mode !== "dark" || theme.glass !== true) return null;
  const opacity = theme.opacity;
  return typeof opacity === "number" &&
    Number.isFinite(opacity) &&
    opacity >= 0 &&
    opacity < 1
    ? opacity
    : null;
}

export function popupGlassFrame(panel: Element): PopupGlassFrame | null {
  const { x, y, width, height } = panel.getBoundingClientRect();
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight =
    document.documentElement.clientHeight || window.innerHeight;
  if (!(width > 0 && height > 0 && viewportWidth > 0 && viewportHeight > 0))
    return null;
  const radius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius);
  return {
    x,
    y,
    width,
    height,
    radius: Number.isFinite(radius) ? radius : 0,
    viewportWidth,
    viewportHeight,
  };
}

function send(frame: PopupGlassFrame | null): Promise<boolean> {
  const request = native.queue.then(() =>
    invoke<boolean>("popup_glass_set", { frame }),
  );
  native.queue = request.catch(() => undefined);
  return request;
}

function track(work: Promise<void>) {
  const pending = work.catch(() => undefined);
  native.pending = pending;
  void pending.then(() => {
    if (native.pending === pending) native.pending = null;
  });
}

/** Run `show` once the latest native glass change is in place, so a popup is
 *  never shown translucent without its frost. Synchronous when idle. */
export function afterPopupGlass(show: () => void) {
  if (native.pending) void native.pending.then(show);
  else show();
}

function setTranslucent(opacity: number | null) {
  const root = document.documentElement;
  root.classList.toggle(POPUP_GLASS_CLASS, opacity !== null);
  if (opacity === null) root.style.removeProperty(OPACITY_PROPERTY);
  else
    root.style.setProperty(
      OPACITY_PROPERTY,
      `${Math.round(opacity * 1000) / 10}%`,
    );
}

/**
 * Match a separate native popup window to the workspace's frosted glass.
 * With a glass snapshot, place native frost behind the measured panel, then
 * tint the panel with the workspace background at the workspace opacity.
 * Otherwise turn opaque first and remove the frost. `presentation` changes
 * for each opening or update, re-measuring the panel before it is shown.
 */
export function usePopupGlass(
  theme: PopupTheme | null | undefined,
  presentation: unknown,
) {
  const opacity = popupGlassOpacity(theme);
  useLayoutEffect(() => {
    let current = true;
    const panel =
      opacity === null ? null : document.querySelector(".toolbar-panel");
    const frame = panel ? popupGlassFrame(panel) : null;
    if (!panel || !frame || opacity === null) {
      // Opaque before the frost goes, so the panel never shows bare desktop.
      setTranslucent(null);
      // Also follow an application still in flight; requests run in order.
      if (native.applied || native.pending)
        track(
          send(null).then(() => {
            native.applied = false;
          }),
        );
      return () => {
        current = false;
      };
    }
    track(
      send(frame).then(
        (applied) => {
          native.applied = applied;
          if (current) setTranslucent(applied ? opacity : null);
        },
        () => {
          // Keep the opaque palette when the material is unavailable.
          if (current) setTranslucent(null);
        },
      ),
    );
    // Searching or an inline error can resize the panel while it is open.
    let last = frame;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const next = popupGlassFrame(panel);
            if (
              !next ||
              (next.x === last.x &&
                next.y === last.y &&
                next.width === last.width &&
                next.height === last.height &&
                next.radius === last.radius)
            )
              return;
            last = next;
            void send(next).catch(() => undefined);
          });
    observer?.observe(panel);
    return () => {
      current = false;
      observer?.disconnect();
    };
  }, [opacity, presentation]);
  useLayoutEffect(() => () => setTranslucent(null), []);
}
