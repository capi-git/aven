import { invoke } from "@tauri-apps/api/core";
import { loadBrowserLowMemory, subscribeBrowserLowMemory } from "./settings";

let restartNeeded = false;
const listeners = new Set<() => void>();

/**
 * Hand the engine options to the host before the first browser tab starts
 * Chromium. Later changes are recorded for the next launch; the host reports
 * whether they still applied to this one.
 */
export function syncBrowserEngineOptions() {
  const push = () =>
    invoke<boolean>("browser_engine_options", {
      options: { lowMemory: loadBrowserLowMemory() },
    })
      .then((applies) => {
        const next = !applies;
        if (next === restartNeeded) return;
        restartNeeded = next;
        for (const listener of [...listeners]) listener();
      })
      .catch(() => {
        // Browser previews have no host.
      });
  void push();
  return subscribeBrowserLowMemory(() => void push());
}

/** True once an engine option changed after Chromium already started. */
export function browserEngineRestartNeeded() {
  return restartNeeded;
}

export function subscribeBrowserEngineRestart(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
