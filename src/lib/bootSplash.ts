import { useLayoutEffect } from "react";
import { activateWindowAppearance } from "./appearance";

/** Reveal this window only after its themed content (or startup error) commits. */
export function useBootSplashReady(
  ready: boolean,
  activateNativeAppearance = false,
) {
  useLayoutEffect(() => {
    if (!ready) return;
    const splash = document.getElementById("boot-splash");
    if (!splash || splash.dataset.dismissed === "1") return;
    splash.dataset.dismissed = "1";
    let faded = false;
    let frame = 0;
    const fade = () => {
      if (faded) return;
      faded = true;
      window.clearTimeout(fallback);
      cancelAnimationFrame(frame);
      if (activateNativeAppearance) activateWindowAppearance();
      splash.classList.add("boot-splash-out");
      window.setTimeout(() => splash.remove(), 180);
    };
    // Keep the main window's existing timing. WebKit can throttle frames when
    // inactive, so ready content must also be revealed by the bounded timer.
    const fallback = window.setTimeout(fade, 250);
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(fade);
    });
  }, [ready, activateNativeAppearance]);
}
