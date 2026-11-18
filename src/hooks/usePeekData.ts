import { useEffect, useRef, useState } from "react";
import { readPeekCache, writePeekCache } from "../lib/hoverPeek";

/**
 * What a hover card fetches, read only while the card is open. It shows the
 * last value it had for `key` at once and reads again when that is stale.
 * Failures stay quiet: the card shows what it knows without them.
 */
export function usePeekData<T>(
  key: string | null,
  open: boolean,
  load: () => Promise<T>,
): T | undefined {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!open || !key) return;
    const hit = readPeekCache<T>(key);
    if (hit) setState({ key, value: hit.value });
    if (hit?.fresh) return;
    let cancelled = false;
    loadRef
      .current()
      .then((value) => {
        writePeekCache(key, value);
        if (!cancelled) setState({ key, value });
      })
      .catch(() => {
        // Best effort: the card keeps what it already shows.
      });
    return () => {
      cancelled = true;
    };
  }, [key, open]);

  if (!key || state?.key !== key) return readPeekCache<T>(key ?? "")?.value;
  return state.value;
}
