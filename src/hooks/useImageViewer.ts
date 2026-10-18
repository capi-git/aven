import { useSyncExternalStore } from "react";
import {
  imageViewerAvailable,
  imageViewerSnapshot,
  subscribeImageViewer,
} from "../lib/imageViewer";

const unavailable = () => false;
const closed = () => null;

/** The open image viewer's pictures and position, or null while it is closed. */
export function useImageViewerState() {
  return useSyncExternalStore(
    subscribeImageViewer,
    imageViewerSnapshot,
    closed,
  );
}

/** Whether this window has a viewer, so a picture can offer to open in it. */
export function useImageViewerAvailable(): boolean {
  return useSyncExternalStore(
    subscribeImageViewer,
    imageViewerAvailable,
    unavailable,
  );
}
