import {
  devPreviewsSnapshot,
  duplicateDevServers,
  markDuplicateDevServer,
  previewBelongsTo,
  type DevPreview,
  type DuplicateDevServer,
} from "./devPreviews";
import { logError } from "./errors";
import { writePty } from "./pty";
import { agentName, sharedWorkSession } from "./sharedWork";
import { chatName } from "./sharedWorkNote";

/**
 * What the duplicate dev-server chip offers. Aven can stop a server it runs
 * itself: one in an Aven terminal gets Ctrl+C, the way the user would stop it.
 * A server an agent started belongs to that agent's own shell, which Aven
 * cannot reach, so the chip asks the agent instead: a short message queued
 * in its chat, sent now if it is idle.
 */

const TERMINAL_SOURCE = "terminal:";

export type DuplicateStop =
  | { kind: "terminal"; terminalId: string }
  | { kind: "ask"; sessionId: string; agent: string }
  | { kind: "none" };

/** How the second copy can be stopped, as far as Aven can tell. */
export function duplicateStop(preview: DevPreview): DuplicateStop {
  if (
    preview.source === "terminal" &&
    preview.sourceId.startsWith(TERMINAL_SOURCE)
  )
    return {
      kind: "terminal",
      terminalId: preview.sourceId.slice(TERMINAL_SOURCE.length),
    };
  const session = preview.sessionId
    ? sharedWorkSession(preview.sessionId)
    : undefined;
  return preview.sessionId && session
    ? {
        kind: "ask",
        sessionId: preview.sessionId,
        agent: agentName(session.harness),
      }
    : { kind: "none" };
}

/** "Codex", "Your terminal", "Another chat": who started the second copy. */
export function duplicateStarter(preview: DevPreview): string {
  if (preview.source === "terminal") return "Your terminal";
  const session = preview.sessionId
    ? sharedWorkSession(preview.sessionId)
    : undefined;
  return session ? agentName(session.harness) : "Another chat";
}

/** "Codex started a second dev server on :5174 while :5173 is running". */
export function duplicateSummary({
  preview,
  original,
}: DuplicateDevServer): string {
  return `${duplicateStarter(preview)} started a second dev server on :${preview.port} while :${original.port} is running`;
}

/** The message that asks an agent to stop its copy. */
export function stopRequestText({
  preview,
  original,
}: DuplicateDevServer): string {
  const by =
    original.source === "terminal"
      ? "the user's terminal"
      : original.sessionId === preview.sessionId
        ? "you"
        : chatName(original.sessionId);
  return `Please stop the dev server you started on port ${preview.port}. The same app is already running at ${original.url} (started by ${by}); use that one instead of starting another.`;
}

/** Second copies to show in a chat (those it started) or a terminal panel. */
export function duplicatesFor(
  list: readonly DevPreview[],
  where:
    | { placement: "chat"; sessionId: string }
    | { placement: "terminal"; project: string },
): DuplicateDevServer[] {
  return duplicateDevServers(list).filter(({ preview }) =>
    where.placement === "chat"
      ? preview.source === "agent" && preview.sessionId === where.sessionId
      : preview.source === "terminal" &&
        previewBelongsTo(preview, where.project),
  );
}

type Messenger = (sessionId: string, text: string) => boolean | void;
let messenger: Messenger | null = null;

/** The workspace queues messages to its chats. */
export function installDuplicateServerMessenger(next: Messenger): () => void {
  messenger = next;
  return () => {
    if (messenger === next) messenger = null;
  };
}

/**
 * Stop the second copy: Ctrl+C in its terminal, or ask its agent. Returns
 * false when nothing could be done.
 */
export async function stopDuplicateServer(key: string): Promise<boolean> {
  const duplicate = duplicateDevServers(devPreviewsSnapshot()).find(
    (entry) => entry.preview.key === key,
  );
  if (!duplicate) return false;
  const stop = duplicateStop(duplicate.preview);
  if (stop.kind === "terminal") {
    markDuplicateDevServer(key, "stopping");
    try {
      // The terminal's own echo of ^C marks the server stopped.
      await writePty(stop.terminalId, "\x03");
      return true;
    } catch (error) {
      logError("Could not stop the second dev server", error);
      markDuplicateDevServer(key, undefined);
      return false;
    }
  }
  if (stop.kind === "ask" && messenger) {
    let sent: boolean | void = false;
    try {
      sent = messenger(stop.sessionId, stopRequestText(duplicate));
    } catch (error) {
      logError("Could not ask the agent to stop its dev server", error);
      return false;
    }
    if (sent === false) return false;
    markDuplicateDevServer(key, "asked");
    return true;
  }
  return false;
}

export function keepDuplicateServer(key: string): void {
  markDuplicateDevServer(key, "kept");
}

/** Tests only. */
export function resetDuplicateServerMessenger(): void {
  messenger = null;
}
