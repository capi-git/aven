import { useSyncExternalStore } from "react";
import {
  isChatAwake,
  isTabAsleep,
  sleepVersion,
  subscribeSleep,
} from "../lib/sleepCenter";

/** Memory saver (or the person) released this browser tab's page. */
export function useTabAsleep(tabId: string): boolean {
  return useSyncExternalStore(subscribeSleep, () => isTabAsleep(tabId));
}

/** No provider process runs for this chat: parked, or not used since start. */
export function useChatAsleep(sessionId: string): boolean {
  return useSyncExternalStore(subscribeSleep, () => !isChatAwake(sessionId));
}

/** Re-renders on any sleep or wake, for lists that read several at once. */
export function useSleepVersion(): number {
  return useSyncExternalStore(subscribeSleep, sleepVersion);
}
