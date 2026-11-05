import { useSyncExternalStore } from "react";
import {
  devPreviewsSnapshot,
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
