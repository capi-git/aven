import { useLayoutEffect } from "react";
import { activateWindowAppearance } from "./appearance";
import { revealWhenDrawn } from "./windowReveal";

/**
 * Finish startup recovery as soon as the themed workspace commits. A
 * workspace window (`activateNativeAppearance`) also gets its native glass or
 * colour now, and is shown once a frame with both has been drawn.
 */
export function useBootSplashReady(
  ready: boolean,
  activateNativeAppearance = false,
) {
  useLayoutEffect(() => {
    if (!ready) return;
    const recovery = document.getElementById("boot-splash");
    if (!recovery || recovery.dataset.dismissed === "1") return;
    recovery.dataset.dismissed = "1";
    if (activateNativeAppearance)
      void revealWhenDrawn(activateWindowAppearance());
    recovery.remove();
  }, [ready, activateNativeAppearance]);
}
