import { useSyncExternalStore } from "react";
import { chatReviewsSnapshot, type ChatReview } from "./chatReview";
import {
  createChatRecordStore,
  finiteTime,
  shortText,
  type ChatRecord,
} from "./chatRecords";
import { gitHistory, type GitHistory } from "./fs";
import { isEqualOrInside } from "./paths";
import {
  HARNESSES,
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "./session";
import type { ShipResult } from "./shipFlow";
import { queueTurnNote } from "./turnNotes";
import { sessionForShip } from "./turnTests";
import { listText } from "./words";

/**
 * How a chat's changes went out through Ship it: the commit it made, and
 * the pull request it opened or updated. One record per chat, its latest
 * ship; a card links to the commit or the pull request.
 */
export type ShippedChat = ChatRecord & {
  /** The chat's project folder. */
  project: string;
  /** The working copy that was shipped. */
  cwd: string;
  commit?: { sha: string; shortSha: string; subject: string };
  pr?: { number: number; url: string };
  pushed?: true;
  title?: string;
  harness?: HarnessId;
};

/** Ships kept for the board's Shipped column and Show older. */
const SHIPPED_KEPT = 200;

const store = createChatRecordStore<ShippedChat>({
  key: "aven.shippedChats.v1",
  limit: SHIPPED_KEPT,
  parse(value) {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.sessionId !== "string" ||
      !row.sessionId ||
      typeof row.project !== "string" ||
      typeof row.cwd !== "string" ||
      !finiteTime(row.at)
    )
      return null;
    const commit = row.commit as Record<string, unknown> | undefined;
    const pr = row.pr as Record<string, unknown> | undefined;
    const sha = shortText(commit?.sha, 64);
    const title = shortText(row.title, 180);
    const harness = HARNESSES.includes(row.harness as HarnessId)
      ? (row.harness as HarnessId)
      : undefined;
    const prNumber =
      typeof pr?.number === "number" &&
      Number.isInteger(pr.number) &&
      pr.number > 0
        ? pr.number
        : undefined;
    const prUrl = shortText(pr?.url, 2048);
    return {
      sessionId: row.sessionId.slice(0, 256),
      project: row.project.slice(0, 2048),
      cwd: row.cwd.slice(0, 2048),
      at: row.at,
      ...(sha
        ? {
            commit: {
              sha,
              shortSha: shortText(commit?.shortSha, 16) ?? sha.slice(0, 7),
              subject: shortText(commit?.subject, 200) ?? "",
            },
          }
        : {}),
      ...(prNumber && prUrl ? { pr: { number: prNumber, url: prUrl } } : {}),
      ...(row.pushed === true ? { pushed: true as const } : {}),
      ...(title ? { title } : {}),
      ...(harness ? { harness } : {}),
    };
  },
});

export const shippedChatsSnapshot = store.snapshot;
export const subscribeShippedChats = store.subscribe;

/** Every chat's latest ship; re-renders only when one changes. */
export function useShippedChats(): Readonly<Record<string, ShippedChat>> {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

/** Record one ship for each chat it carried. */
export function recordShipped(records: readonly ShippedChat[]): void {
  if (!records.length) return;
  store.update((current) => {
    const next = { ...current };
    for (const record of records) next[record.sessionId] = record;
    return next;
  });
}

/** Forget a chat's ship, as when the chat is deleted. */
export function forgetShippedChat(sessionId: string): void {
  store.update((current) => {
    if (!current[sessionId]) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

/**
 * The chats a ship of `cwd` carried: the chat it was started from; else
 * every chat with changes waiting there, since one commit takes them all;
 * else the chat that worked there last.
 */
export function shipTargets({
  requestedId,
  cwd,
  reviews,
  latestId,
}: {
  requestedId?: string;
  cwd: string;
  reviews: Readonly<Record<string, Pick<ChatReview, "sessionId" | "cwd">>>;
  /** The chat whose latest turn in `cwd` is newest (`sessionForShip`). */
  latestId?: string;
}): string[] {
  if (requestedId) return [requestedId];
  const waiting = Object.values(reviews)
    .filter(
      (review) =>
        isEqualOrInside(review.cwd, cwd) || isEqualOrInside(cwd, review.cwd),
    )
    .map((review) => review.sessionId);
  if (waiting.length) return waiting;
  return latestId ? [latestId] : [];
}

/**
 * Record a finished Ship of `cwd` for the chats it carried (`shipTargets`),
 * with the commit it made (read from Git's HEAD) and its pull request. A
 * ship that sent nothing out records nothing.
 */
export async function recordShip({
  cwd,
  requestedId,
  result,
  sessions,
  reviews = chatReviewsSnapshot(),
  head = () => gitHistory(cwd, 1),
  now = Date.now(),
}: {
  cwd: string;
  /** The chat Ship it was pressed in, if any. */
  requestedId?: string;
  result: Pick<ShipResult, "committed" | "pushed" | "pr">;
  sessions: readonly Session[];
  reviews?: Readonly<Record<string, ChatReview>>;
  head?: () => Promise<GitHistory>;
  now?: number;
}): Promise<ShippedChat[]> {
  if (!result.committed && !result.pushed && !result.pr) return [];
  const ids = shipTargets({
    requestedId,
    cwd,
    reviews,
    latestId: sessionForShip(sessions, cwd)?.id,
  });
  if (!ids.length) return [];
  let commit: ShippedChat["commit"];
  if (result.committed) {
    try {
      const top = (await head()).commits[0];
      if (top)
        commit = {
          sha: top.sha,
          shortSha: top.shortSha,
          subject: top.subject,
        };
    } catch {
      // The ship happened; only the commit's name is missing from its card.
    }
  }
  const records = ids.map((sessionId): ShippedChat => {
    const loaded = sessions.find((session) => session.id === sessionId);
    const review = reviews[sessionId];
    const title = loaded
      ? sessionDisplayTitle(loaded.title, loaded.harness)
      : review?.title;
    const harness = loaded?.harness ?? review?.harness;
    return {
      sessionId,
      project: loaded?.cwd ?? review?.project ?? cwd,
      cwd,
      at: now,
      ...(commit ? { commit } : {}),
      ...(result.pr
        ? { pr: { number: result.pr.number, url: result.pr.url } }
        : {}),
      ...(result.pushed ? { pushed: true as const } : {}),
      ...(title ? { title } : {}),
      ...(harness ? { harness } : {}),
    };
  });
  recordShipped(records);
  // Each chat's agent hears it with its next message, so it does not take
  // the commit for someone else's.
  const note = shipNoteText(result, commit);
  if (note)
    for (const record of records)
      queueTurnNote(record.sessionId, { kind: "ship", text: note, at: now });
  return records;
}

/**
 * What a chat's agent is told, once, after Ship it sent its changes out:
 * the commit, whether it was pushed and the pull request, as the user's.
 */
export function shipNoteText(
  result: Pick<ShipResult, "committed" | "pushed" | "pr">,
  commit?: ShippedChat["commit"],
): string | null {
  const parts: string[] = [];
  if (result.committed)
    parts.push(
      commit ? `commit ${commit.shortSha} “${commit.subject}”` : "a new commit",
    );
  if (result.pushed)
    parts.push(result.committed ? "pushed" : "this branch's commits pushed");
  if (result.pr)
    parts.push(
      `${result.pr.created ? "opened" : "updated"} pull request #${result.pr.number}`,
    );
  if (!parts.length) return null;
  return `The user shipped this chat's changes with Aven's Ship it: ${listText(parts)}. That ${
    result.committed ? "commit is" : "push was"
  } theirs, made through Aven; don't commit those changes again.`;
}
