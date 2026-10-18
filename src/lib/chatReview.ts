import { useSyncExternalStore } from "react";
import type { CheckpointFile } from "./checkpoint";
import {
  createChatRecordStore,
  finiteTime,
  shortText,
  type ChatRecord,
} from "./chatRecords";
import { basename } from "./fs";
import { HARNESSES, type HarnessId } from "./session";

/**
 * Changes a chat's turns left in the project that are not kept, undone or
 * shipped yet, as its checkpoint reports them (see `checkpoint.ts`). Only
 * the counts and a few file names are kept, never contents.
 */
export type ChatReview = ChatRecord & {
  /** The chat's project folder. */
  project: string;
  /** The working copy its checkpoint lives in. */
  cwd: string;
  files: number;
  additions: number;
  deletions: number;
  /** The first few changed files' names, for a card's line. */
  names: string[];
  /**
   * `at`: when the changes were first seen as they are now. Reading the same
   * changes again keeps it, so a ship after them stays newer.
   */
  title?: string;
  harness?: HarnessId;
};

const NAMES_KEPT = 3;

const store = createChatRecordStore<ChatReview>({
  key: "aven.chatReviews.v1",
  limit: 200,
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
    const count = (key: string) =>
      typeof row[key] === "number" && Number.isFinite(row[key])
        ? Math.max(0, Math.floor(row[key] as number))
        : 0;
    const files = count("files");
    if (!files) return null;
    const title = shortText(row.title, 180);
    const harness = HARNESSES.includes(row.harness as HarnessId)
      ? (row.harness as HarnessId)
      : undefined;
    return {
      sessionId: row.sessionId.slice(0, 256),
      project: row.project.slice(0, 2048),
      cwd: row.cwd.slice(0, 2048),
      at: row.at,
      files,
      additions: count("additions"),
      deletions: count("deletions"),
      names: Array.isArray(row.names)
        ? row.names
            .filter((name): name is string => typeof name === "string")
            .slice(0, NAMES_KEPT)
            .map((name) => name.slice(0, 256))
        : [],
      ...(title ? { title } : {}),
      ...(harness ? { harness } : {}),
    };
  },
});

export const chatReviewsSnapshot = store.snapshot;
export const subscribeChatReviews = store.subscribe;

/** Every chat's open review; re-renders only when one changes. */
export function useChatReviews(): Readonly<Record<string, ChatReview>> {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}

function sameChanges(
  a: Pick<ChatReview, "files" | "additions" | "deletions" | "names">,
  b: Pick<ChatReview, "files" | "additions" | "deletions" | "names">,
): boolean {
  return (
    a.files === b.files &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.names.join("\n") === b.names.join("\n")
  );
}

/**
 * What a chat's checkpoint holds now. No files clears its review; the same
 * changes as before keep their time, so only new changes look newer than a
 * ship.
 */
export function noteChatReview(
  input: {
    sessionId: string;
    project: string;
    cwd: string;
    files: readonly Pick<
      CheckpointFile,
      "relative" | "additions" | "deletions"
    >[];
    title?: string;
    harness?: HarnessId;
  },
  now = Date.now(),
): void {
  store.update((current) => {
    const previous = current[input.sessionId];
    if (!input.files.length) {
      if (!previous) return current;
      const next = { ...current };
      delete next[input.sessionId];
      return next;
    }
    const changes = {
      files: input.files.length,
      additions: input.files.reduce((sum, file) => sum + file.additions, 0),
      deletions: input.files.reduce((sum, file) => sum + file.deletions, 0),
      names: input.files
        .slice(0, NAMES_KEPT)
        .map((file) => basename(file.relative) || file.relative),
    };
    const title = input.title ?? previous?.title;
    const harness = input.harness ?? previous?.harness;
    const record: ChatReview = {
      sessionId: input.sessionId,
      project: input.project,
      cwd: input.cwd,
      at: previous && sameChanges(previous, changes) ? previous.at : now,
      ...changes,
      ...(title ? { title } : {}),
      ...(harness ? { harness } : {}),
    };
    if (
      previous &&
      previous.at === record.at &&
      previous.project === record.project &&
      previous.cwd === record.cwd &&
      previous.title === record.title &&
      previous.harness === record.harness &&
      sameChanges(previous, record)
    )
      return current;
    return { ...current, [input.sessionId]: record };
  });
}

/** Forget a chat's review, as when the chat is deleted. */
export function forgetChatReview(sessionId: string): void {
  store.update((current) => {
    if (!current[sessionId]) return current;
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}
