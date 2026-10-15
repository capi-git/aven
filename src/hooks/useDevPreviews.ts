import { useEffect, useSyncExternalStore } from "react";
import {
  devPreviewsSnapshot,
  openDevPreview,
  pendingAutoOpen,
  subscribeDevPreviews,
  type DevPreview,
} from "../lib/devPreviews";

/** Changes only when a server starts, stops, or is opened or dismissed. */
export function useDevPreviews(): readonly DevPreview[] {
  return useSyncExternalStore(
    subscribeDevPreviews,
    devPreviewsSnapshot,
    devPreviewsSnapshot,
  );
}

/**
 * With "Open dev previews automatically" on, show each new server start of
 * the project on screen once. Detection happens in terminal and agent
 * callbacks; opening waits for a microtask so it never runs inside them or
 * inside a render, and a server found while its project was in the
 * background opens when the user returns to it.
 */
export function useDevPreviewAutoOpen(project: string, enabled = true): void {
  useEffect(() => {
    if (!enabled || !project) return;
    let queued = false;
    let disposed = false;
    const run = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        for (const preview of pendingAutoOpen(devPreviewsSnapshot(), project))
          openDevPreview(preview.key);
      });
    };
    run();
    const unsubscribe = subscribeDevPreviews(run);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [project, enabled]);
}
