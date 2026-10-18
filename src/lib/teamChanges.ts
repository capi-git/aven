/**
 * Whose changes a team's work is. A team run's files belong to the chat it
 * started from, so that chat's file bar, Review, board card and Ship it
 * carry everything the run wrote, as if its own agent had written it (see
 * `checkpoint.ts`): an orchestration's workers write for their lead, and a
 * kept race lands in the chat the race was sent from.
 */
import {
  captureSessionCheckpoint,
  ensureSessionCheckpoint,
  notifyReviewChanged,
  prepareSessionCheckpoint,
} from "./checkpoint";
import { logError } from "./errors";
import { pathKey } from "./paths";

/** A chat's checkpoint, and the folder it is kept for. */
export type ChangeOwner = { sessionId: string; cwd: string };

/**
 * Whose checkpoint records a turn's edits. A chat's own turn records its
 * own. A turn an orchestration run drives, its lead's or a worker's, records
 * into the lead's, in the folder the lead's own turns use; a worker working
 * anywhere else records nothing, as no driven turn did before.
 */
export function turnChangeOwner({
  sessionId,
  workCwd,
  driven,
  lead,
}: {
  sessionId: string;
  /** The folder this turn works in. */
  workCwd: string;
  /** An orchestration run drives this turn (`orchestrationOwnsTurn`). */
  driven: boolean;
  /** That run's lead chat and its own work folder, when it is loaded. */
  lead?: { id: string; workCwd: string };
}): ChangeOwner | null {
  if (!workCwd || workCwd === "~") return null;
  if (!driven) return { sessionId, cwd: workCwd };
  if (!lead?.workCwd || pathKey(lead.workCwd) !== pathKey(workCwd)) return null;
  return { sessionId: lead.id, cwd: lead.workCwd };
}

type ChatFolder = (sessionId: string) => string | undefined;

let chatFolder: ChatFolder | null = null;

/**
 * Tell team runs where each loaded chat keeps its changes: the folder its
 * own turns work in. Returns a function that takes it back.
 */
export function installChatFolders(lookup: ChatFolder): () => void {
  chatFolder = lookup;
  return () => {
    if (chatFolder === lookup) chatFolder = null;
  };
}

/**
 * Bring changes into a chat's folder on its behalf, as keeping a race does
 * for the chat it was sent from: `paths` (absolute) are read before `apply`
 * and again after it, so they are that chat's to review, undo and ship like
 * its own agent's edits. A chat that is not loaded, or none, just gets the
 * changes, as before; a path outside its folder is left out. A failure of
 * `apply` is thrown as it is, and nothing is recorded.
 */
export async function applyForChat(
  sessionId: string | undefined,
  paths: readonly string[],
  apply: () => Promise<void>,
): Promise<void> {
  const cwd = sessionId ? chatFolder?.(sessionId) : undefined;
  const owner =
    sessionId && cwd && cwd !== "~" && paths.length ? { sessionId, cwd } : null;
  let prepared = false;
  if (owner) {
    try {
      await ensureSessionCheckpoint(owner.sessionId, owner.cwd);
      await prepareSessionCheckpoint(owner.sessionId, owner.cwd, [...paths]);
      prepared = true;
    } catch (error) {
      // The changes still come in; only their place in the chat is missing.
      logError("Prepare kept changes", error);
    }
  }
  await apply();
  if (!owner || !prepared) return;
  try {
    await captureSessionCheckpoint(owner.sessionId, owner.cwd, [...paths]);
  } catch (error) {
    logError("Capture kept changes", error);
  }
  notifyReviewChanged(owner.sessionId);
}
