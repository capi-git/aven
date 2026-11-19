import { useSyncExternalStore } from "react";
import {
  sidePanelTab,
  subscribeSidePanelTab,
  type SidePanelTab,
} from "../lib/sidePanel";

/** The side panel's tab; re-renders only its readers on a change. */
export function useSidePanelTab(): SidePanelTab {
  return useSyncExternalStore(
    subscribeSidePanelTab,
    sidePanelTab,
    sidePanelTab,
  );
}
