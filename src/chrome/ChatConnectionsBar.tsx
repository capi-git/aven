import { memo } from "react";
import { X } from "./icons";
import { useChatConnectionLine } from "../hooks/useChatConnections";
import {
  clearChatConnections,
  dismissChatConnections,
  openConnectionsFromChat,
} from "../lib/chatConnections";
import { reconnectHarnessSession } from "../lib/harness/registry";
import { sessionPermissions } from "../lib/harness/sessionPermissions";
import type { HarnessId } from "../lib/session";
import "./ChatConnectionsBar.css";

/**
 * "Notion isn't signed in": one quiet line above the message box when a
 * connection this chat has isn't working. Nothing shows when all is well, and
 * dismissing it holds for the chat. It reads its own store, so neither provider
 * reports nor streaming render it or the transcript.
 */
export const ChatConnectionsBar = memo(function ChatConnectionsBar({
  sessionId,
  harness,
  folder,
}: {
  sessionId?: string;
  harness: HarnessId;
  /** Where the chat runs, which decides the connections it has. */
  folder: string;
}) {
  const line = useChatConnectionLine(sessionId);
  if (
    !sessionId ||
    !line ||
    line.harness !== harness ||
    sessionPermissions(sessionId)?.noMcp
  )
    return null;
  const reconnecting = line.action === "Reconnect";
  return (
    <div className="px-2 pb-1" data-chat-connections={sessionId} data-no-drag>
      <div className="chat-connections-bar" role="status" aria-live="polite">
        <span className="chat-connections-text" title={line.title ?? line.text}>
          {line.text}
        </span>
        <button
          type="button"
          className="chat-connections-action"
          {...(reconnecting
            ? { title: "Keeps this chat. It reconnects on your next message." }
            : {})}
          onClick={() => {
            if (reconnecting) {
              reconnectHarnessSession(harness, sessionId);
              clearChatConnections(sessionId);
            } else openConnectionsFromChat(sessionId, folder);
          }}
        >
          {line.action}
        </button>
        <button
          type="button"
          className="chat-connections-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => dismissChatConnections(sessionId)}
        >
          <X size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
});
