import { useCallback, useSyncExternalStore } from "react";
import {
  mascotReactionFor,
  subscribeMascotReactions,
  type MascotReaction,
} from "../lib/mascotReactions";

/**
 * The one-shot reaction playing for a project (`projectKey`), or null.
 * Re-renders the caller only when a reaction starts or ends.
 */
export function useMascotReaction(
  key: string | null | undefined,
): MascotReaction | null {
  const getSnapshot = useCallback(() => mascotReactionFor(key), [key]);
  return useSyncExternalStore(
    subscribeMascotReactions,
    getSnapshot,
    () => null,
  );
}
