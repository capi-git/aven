import { useSyncExternalStore } from "react";
import { sidePanelOpen, subscribeSidePanelOpen } from "../lib/sidePanel";

/** Whether the side panel is open; re-renders only its readers on a change. */
export function useSidePanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeSidePanelOpen,
    sidePanelOpen,
    sidePanelOpen,
  );
}
