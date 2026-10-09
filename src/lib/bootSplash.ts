import { useLayoutEffect } from "react";
import { activateWindowAppearance } from "./appearance";

/** Finish startup recovery as soon as the themed workspace commits. */
export function useBootSplashReady(
  ready: boolean,
  activateNativeAppearance = false,
) {
  useLayoutEffect(() => {
    if (!ready) return;
    const recovery = document.getElementById("boot-splash");
    if (!recovery || recovery.dataset.dismissed === "1") return;
    recovery.dataset.dismissed = "1";
    if (activateNativeAppearance) activateWindowAppearance();
    recovery.remove();
  }, [ready, activateNativeAppearance]);
}
