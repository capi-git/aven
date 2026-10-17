import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  mascotReactionForSessions,
  subscribeMascotReactions,
} from "../lib/mascotReactions";
import { playMotion } from "../lib/motion";

const idle = () => () => {};

/**
 * When a turn or a team of one of these chats finishes, the element (a
 * chat's sidebar row or its tab) gets a brief underline sweep, alongside
 * the mascot's hop. It rides the mascot's reaction, so it plays once per
 * turn end, in the one window that cheers, and never loops.
 */
export function useTurnEndFlash(
  element: { readonly current: Element | null },
  sessionIds: readonly string[] | string | undefined,
) {
  const key =
    typeof sessionIds === "string" ? sessionIds : (sessionIds ?? []).join("\n");
  const getSnapshot = useCallback(
    () => mascotReactionForSessions(key ? key.split("\n") : []),
    [key],
  );
  const reaction = useSyncExternalStore(
    key ? subscribeMascotReactions : idle,
    getSnapshot,
    () => null,
  );
  const played = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (reaction?.kind !== "cheer" || played.current === reaction.id) return;
    played.current = reaction.id;
    playMotion(element.current, "flash");
  }, [element, reaction]);
}
