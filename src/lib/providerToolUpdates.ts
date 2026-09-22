import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HarnessId } from "./session";

const PREFERENCE_KEY = "aven.autoUpdateProviderTools";
export const PROVIDER_TOOL_UPDATE_PREFERENCE_EVENT =
  "aven:provider-tool-update-preference";

export function loadProviderToolAutoUpdates(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveProviderToolAutoUpdates(enabled: boolean): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, String(enabled));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(PROVIDER_TOOL_UPDATE_PREFERENCE_EVENT));
}

export function subscribeProviderToolAutoUpdates(
  listener: () => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFERENCE_KEY || event.key === null) listener();
  };
  window.addEventListener(PROVIDER_TOOL_UPDATE_PREFERENCE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PROVIDER_TOOL_UPDATE_PREFERENCE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Native code applies the once-daily throttle and only updates supported installs. */
export async function refreshAutomaticProviderTools(
  providers: readonly HarnessId[],
): Promise<Set<HarnessId>> {
  const updated = new Set<HarnessId>();
  if (!loadProviderToolAutoUpdates() || !isTauri()) return updated;
  await Promise.all(
    [...new Set(providers)].map(async (provider) => {
      if (provider !== "codex" && provider !== "claude") return;
      try {
        const result = await invoke<{ updated: boolean }>(
          "provider_refresh_cli",
          {
            provider,
          },
        );
        if (result?.updated === true) updated.add(provider);
      } catch (error) {
        // A failed tool update never blocks discovery through the installed CLI.
        console.debug(`[aven] ${provider} tool update`, error);
      }
    }),
  );
  return updated;
}
