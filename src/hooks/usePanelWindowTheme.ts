import { useLayoutEffect } from "react";
import type { ToolbarPanelTheme } from "../chrome/ToolbarPanel";

/**
 * A separate native panel window (a menu, Access or Usage) renders in its own
 * document, which knows nothing of the workspace's palette. Give that
 * document the owner's mode, text and accent, so its shared tokens (light
 * mode's fills and separators, the focus ring, a field's edge) resolve as
 * they do in the workspace window, and its controls match the in-window
 * menus. The panel's own surface comes from the snapshot (ToolbarPanel).
 *
 * The window class is set on mount, before any snapshot arrives, so even an
 * error shown before the first snapshot sits on a transparent window.
 */
export function usePanelWindowTheme(
  windowClass: string,
  theme: ToolbarPanelTheme | null | undefined,
) {
  useLayoutEffect(() => {
    document.documentElement.classList.add(windowClass);
    document.getElementById("boot-splash")?.remove();
  }, [windowClass]);
  const mode = theme?.mode;
  const text = theme?.text;
  const accent = theme?.accent;
  useLayoutEffect(() => {
    if (!mode) return;
    const root = document.documentElement;
    root.classList.toggle("theme-light", mode === "light");
    root.style.colorScheme = mode;
    const paint = (property: string, color: string | undefined) => {
      if (color) root.style.setProperty(property, color);
      else root.style.removeProperty(property);
    };
    paint("--theme-content-color", text);
    paint("--theme-accent-color", accent);
  }, [mode, text, accent]);
}
