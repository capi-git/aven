import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { effectiveCssZoom } from "../lib/drag";

/** Expose the window's existing glass behind a revealed sidebar without
 * reflowing the workspace or blurring its text a second time. Native browser
 * children already crop this same edge in BrowserPane. */
export function useFloatingSidebarClip(
  sidebar: RefObject<HTMLElement | null>,
  revealed: boolean,
) {
  // The crop slides out with the panel, then lifts entirely. An idle crop
  // would make the workspace a backdrop root and drop its menus' blur.
  const lift = useRef<{
    body: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const cancelLift = () => {
    if (lift.current) clearTimeout(lift.current.timer);
    lift.current = null;
  };
  useEffect(
    () => () => {
      if (lift.current)
        delete lift.current.body.dataset.floatingSidebarRevealed;
      cancelLift();
    },
    [],
  );
  useLayoutEffect(() => {
    const panel = sidebar.current;
    const body = panel?.closest<HTMLElement>(".personal-shell-body");
    if (!panel || !body || !revealed) return;
    cancelLift();
    const update = () => {
      // Ignore the panel's reveal transform, as native browser clipping does.
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const shift =
        style.transform && style.transform !== "none"
          ? new DOMMatrixReadOnly(style.transform).m41 * effectiveCssZoom(panel)
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
      body.dataset.floatingSidebarRevealed = "closing";
      body.style.removeProperty("--floating-sidebar-right");
      const duration = Number.parseFloat(
        getComputedStyle(body).getPropertyValue?.("--aven-peek-out-duration") ??
          "",
      );
      cancelLift();
      lift.current = {
        body,
        timer: setTimeout(
          () => {
            lift.current = null;
            if (body.dataset.floatingSidebarRevealed === "closing")
              delete body.dataset.floatingSidebarRevealed;
          },
          (Number.isFinite(duration) ? duration : 240) + 50,
        ),
      };
    };
  }, [sidebar, revealed]);
}
