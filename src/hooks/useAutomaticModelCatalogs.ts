import { useEffect, useRef } from "react";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "../lib/harness/availability";
import {
  HARNESS_CATALOG_RETRY_MS,
  isLiveHarness,
  refreshHarnessCatalogs,
} from "../lib/harness/registry";
import { hasLiveCatalog, isPickerProviderVisible } from "../lib/models";
import { HARNESSES, type HarnessId } from "../lib/session";
import {
  refreshAutomaticProviderTools,
  subscribeProviderToolAutoUpdates,
} from "../lib/providerToolUpdates";

const isVisible = () => document.visibilityState !== "hidden";

/**
 * Refresh catalogs without changing any task's selected model or settings.
 * The registry owns freshness, backoff and shared in-flight work; this hook
 * supplies the lifecycle events that a long-running desktop app needs.
 */
export function useAutomaticModelCatalogs(
  sessions: readonly { harness: HarnessId }[],
): void {
  const usedKey = [...new Set(sessions.map((session) => session.harness))]
    .sort()
    .join(",");
  const usedRef = useRef(new Set<HarnessId>());
  usedRef.current = new Set(sessions.map((session) => session.harness));

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (disposed || pending || !isVisible()) return;
      if (navigator.onLine === false) return;
      pending = true;
      try {
        await probeHarnessAvailability();
        if (disposed || !isVisible()) return;
        const wanted = HARNESSES.filter((harness) => {
          if (!isLiveHarness(harness)) return false;
          if (usedRef.current.has(harness) || hasLiveCatalog(harness))
            return true;
          // Keep the two built-in account providers ready even on an empty
          // workspace. Other CLIs are discovered only after the user uses them;
          // probing unused extension hosts such as Pi can be expensive.
          return (
            (harness === "codex" || harness === "claude") &&
            isHarnessAvailable(harness) &&
            isPickerProviderVisible(harness)
          );
        });
        const updated = await refreshAutomaticProviderTools(wanted);
        if (disposed) return;
        await Promise.all([
          refreshHarnessCatalogs(wanted.filter((id) => !updated.has(id))),
          updated.size > 0
            ? refreshHarnessCatalogs(updated, { force: true })
            : Promise.resolve(),
        ]);
      } catch (error) {
        // Background discovery must never turn a temporary offline/provider
        // failure into a broken workspace or an unhandled rejection.
        console.debug("[aven] automatic model catalog refresh", error);
      } finally {
        pending = false;
      }
    };
    const check = () => void refresh();
    check();
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    const unsubscribePreference = subscribeProviderToolAutoUpdates(check);
    const timer = window.setInterval(check, HARNESS_CATALOG_RETRY_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      unsubscribePreference();
    };
  }, [usedKey]);
}
