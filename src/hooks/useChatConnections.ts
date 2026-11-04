import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  chatConnectionLine,
  checkChatConnectionsAfterSettings,
  installChatConnectionsOpener,
  subscribeChatConnections,
  type ChatConnectionLine,
} from "../lib/chatConnections";
import type { SettingsSectionId } from "../lib/settings";

const nothing = () => () => undefined;
const noLine = () => null;

/**
 * This chat's line about its connections. Renders only when the line changes,
 * so a provider's reports never reach the transcript.
 */
export function useChatConnectionLine(
  sessionId: string | undefined,
): ChatConnectionLine | null {
  return useSyncExternalStore(
    sessionId
      ? (listener) => subscribeChatConnections(sessionId, listener)
      : nothing,
    sessionId ? () => chatConnectionLine(sessionId) : noLine,
    noLine,
  );
}

/** Lets a chat's line open Settings, and checks that chat on the way back. */
export function useChatConnectionsSettings(
  openSettings: (section?: SettingsSectionId) => void,
  settingsOpen: boolean,
): void {
  useEffect(
    () => installChatConnectionsOpener(() => openSettings("connections")),
    [openSettings],
  );
  const wasOpen = useRef(settingsOpen);
  useEffect(() => {
    if (wasOpen.current && !settingsOpen)
      void checkChatConnectionsAfterSettings();
    wasOpen.current = settingsOpen;
  }, [settingsOpen]);
}
