import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Block, BlockRole, Session } from "./session";

/**
 * Blocks that are not the chat's messages: tool calls and their output
 * (which include every screenshot command's own result), approvals and
 * reasoning. The native check of the saved chat skips the same roles.
 */
const NOT_MESSAGES: ReadonlySet<BlockRole> = new Set([
  "tool",
  "approval",
  "reasoning",
]);

/**
 * A page screenshot's file name, `<millis>-<label>.jpg` (`.png` from earlier
 * versions), wherever it appears: a pasted Markdown image, a plain or
 * URL-encoded path, or the name alone.
 */
const SHOT_NAME =
  /(?<!\d)\d+-[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpe?g|png)(?![a-z0-9])/gi;

/** Lowercase screenshot file names mentioned in `text`. */
export function turnShotNames(text: string): string[] {
  return [...text.matchAll(SHOT_NAME)].map(([name]) => name.toLowerCase());
}

/**
 * Screenshot file names the chat's messages show or mention, attachments
 * included. A screenshot that is mentioned stays, so this errs towards
 * keeping: any name that looks like one counts.
 */
export function referencedTurnShots(blocks: readonly Block[]): string[] {
  const names = new Set<string>();
  for (const block of blocks) {
    if (NOT_MESSAGES.has(block.role)) continue;
    const texts = [block.text ?? ""];
    for (const attachment of block.attachments ?? [])
      texts.push(attachment.name, attachment.path ?? "");
    for (const text of texts)
      for (const name of turnShotNames(text)) names.add(name);
  }
  return [...names];
}

/** Screenshots a chat's turn took, to tidy once the turn has ended. */
export type TurnShotTidy = {
  sessionId: string;
  /** Epoch ms: when the chat was first seen working, less a little slack. */
  from: number;
  /** Epoch ms: when it was seen to stop. */
  to: number;
  /** File names its messages show or mention. */
  referenced: string[];
};

/**
 * A chat is seen working a moment after its turn starts; a screenshot taken
 * in that moment still belongs to the turn.
 */
export const TURN_START_SLACK_MS = 2_000;

/**
 * Compare the chats working now (a turn, an approval or question it waits
 * on, or helper agents) with those working before. Returns when each
 * working chat started, and a tidy request for each chat that stopped. A
 * chat that is no longer loaded is skipped, so its screenshots stay.
 */
export function endedTurns(
  working: ReadonlyMap<string, number>,
  workingIds: ReadonlySet<string>,
  sessions: readonly Session[],
  now: number,
): { working: Map<string, number>; ended: TurnShotTidy[] } {
  const next = new Map<string, number>();
  for (const id of workingIds)
    next.set(id, working.get(id) ?? now - TURN_START_SLACK_MS);
  const ended: TurnShotTidy[] = [];
  for (const [sessionId, from] of working) {
    if (next.has(sessionId)) continue;
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) continue;
    ended.push({
      sessionId,
      from,
      to: now,
      referenced: referencedTurnShots(session.blocks),
    });
  }
  return { working: next, ended };
}

/**
 * Delete the turn's screenshots that are neither labelled nor shown in the
 * chat (see `turn_shots_tidy`). Best effort: whatever cannot be checked is
 * kept, and a failure leaves every file in place.
 */
export async function tidyTurnShots(request: TurnShotTidy): Promise<void> {
  if (!isTauri()) return;
  await invoke("turn_shots_tidy", request);
}
