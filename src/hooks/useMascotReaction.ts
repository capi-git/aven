import { useCallback, useSyncExternalStore } from "react";
import {
  mascotReactionFor,
  subscribeMascotReactions,
  type MascotReaction,
} from "../lib/mascotReactions";

const idle = () => () => {};

/**
 * The one-shot reaction playing for a project (`projectKey`), or null.
 * Re-renders the caller only when a reaction starts or ends. Without a key it
 * does not watch at all, so a window with nothing that reacts never claims a
 * reaction another window could show.
 */
export function useMascotReaction(
  key: string | null | undefined,
): MascotReaction | null {
  const getSnapshot = useCallback(() => mascotReactionFor(key), [key]);
  return useSyncExternalStore(
    key ? subscribeMascotReactions : idle,
    getSnapshot,
    () => null,
  );
}
