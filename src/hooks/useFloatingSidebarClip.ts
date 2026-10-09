import { useLayoutEffect, type RefObject } from "react";
import { effectiveCssZoom } from "../lib/drag";

/** Expose the window's existing glass behind a revealed sidebar without
 * reflowing the workspace or blurring its text a second time. Native browser
 * children already crop this same edge in BrowserPane. */
export function useFloatingSidebarClip(
  sidebar: RefObject<HTMLElement | null>,
  revealed: boolean,
) {
  useLayoutEffect(() => {
    const panel = sidebar.current;
    const body = panel?.closest<HTMLElement>(".personal-shell-body");
    if (!panel || !body || !revealed) return;
    const update = () => {
      // Ignore the panel's reveal transform, as native browser clipping does.
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const shift =
        style.transform && style.transform !== "none"
          ? new DOMMatrixReadOnly(style.transform).m41
          : 0;
      const right = Math.max(
        0,
        (rect.right - Math.min(0, shift) - body.getBoundingClientRect().left) /
          effectiveCssZoom(body),
      );
      const value = `${right}px`;
      if (body.style.getPropertyValue("--floating-sidebar-right") !== value)
        body.style.setProperty("--floating-sidebar-right", value);
    };
    update();
    body.dataset.floatingSidebarRevealed = "true";
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      delete body.dataset.floatingSidebarRevealed;
      body.style.removeProperty("--floating-sidebar-right");
    };
  }, [sidebar, revealed]);
}
