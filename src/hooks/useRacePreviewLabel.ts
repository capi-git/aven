import { useCallback, useSyncExternalStore } from "react";
import { devPreviewsSnapshot, subscribeDevPreviews } from "../lib/devPreviews";
import { racesSnapshot, subscribeRaces } from "../lib/race";
import { racePreviewLabel } from "../lib/racePreviews";

/**
 * Whose race version a page shows, by its address ("Codex's version"),
 * kept current as dev servers start and stop and races end.
 */
export function useRacePreviewLabel(): (
  url: string | undefined,
) => string | undefined {
  const previews = useSyncExternalStore(
    subscribeDevPreviews,
    devPreviewsSnapshot,
    devPreviewsSnapshot,
  );
  const races = useSyncExternalStore(
    subscribeRaces,
    racesSnapshot,
    racesSnapshot,
  );
  return useCallback(
    (url) => (url ? racePreviewLabel(url, previews, races) : undefined),
    [previews, races],
  );
}
