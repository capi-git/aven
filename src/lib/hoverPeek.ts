/**
 * What the hover cards say: a chat's pull request, a project's Git state,
 * a tab's last reply, the unread Activity and the changed files. Pure, so
 * the cards stay thin and the wording is tested in one place.
 */
import { proseSummary } from "../surfaces/transcriptActivity";
import type { ActivityEntry } from "./activity";
import type { GitChangedFile, GitPr } from "./fs";
import type { PrChecksSummary } from "./prChecks";
import type { Block } from "./session";
import { plural } from "./words";

/** "now", "3m", "2h", "4d": a card's quiet age. */
export function peekAge(at: number | undefined, now: number): string {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Where a chat's pull request stands, for its card's footer. */
export type ChatPrState =
  | { kind: "ready"; label: string }
  | { kind: "running"; label: string }
  | { kind: "failing"; label: string }
  | { kind: "merged"; label: string };

/**
 * An open pull request is ready once its checks pass or none are reported,
 * as the Checks tab offers Squash and merge then. Unknown checks say
 * nothing yet; a closed pull request says nothing at all.
 */
export function chatPrState(
  pr: GitPr | null | undefined,
  checks: PrChecksSummary | null | undefined,
): ChatPrState | null {
  if (!pr) return null;
  if (pr.state === "merged") return { kind: "merged", label: "Merged" };
  if (pr.state !== "open" || !checks) return null;
  if (checks.state === "failing")
    return {
      kind: "failing",
      label: `${plural(checks.failed, "check")} failing`,
    };
  if (checks.state === "pending")
    return {
      kind: "running",
      label: `${plural(checks.pending, "check")} running`,
    };
  return { kind: "ready", label: "Ready to merge" };
}

/** The changed files a card lists: the first few, and how many more. */
export type ChangesPeek = {
  files: number;
  additions: number;
  deletions: number;
  shown: readonly Pick<
    GitChangedFile,
    "relative" | "additions" | "deletions"
  >[];
  more: number;
};

export const CHANGES_PEEK_LIMIT = 8;

export function changesPeek(
  files: readonly GitChangedFile[],
  limit = CHANGES_PEEK_LIMIT,
): ChangesPeek {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  // Exactly one past the limit reads better as the file than "and 1 more".
  const cut = files.length === limit + 1 ? files.length : limit;
  const shown = files.slice(0, cut);
  return {
    files: files.length,
    additions,
    deletions,
    shown,
    more: files.length - shown.length,
  };
}

/** One Activity row in its card: what it is and how long ago. */
export type ActivityPeekRow = {
  id: string;
  sessionId: string;
  title: string;
  state: "ready" | "needs" | "failed" | "stopped";
  /** "Ready · 3m" */
  end: string;
};

const ACTIVITY_WORD: Record<ActivityPeekRow["state"], string> = {
  ready: "Ready",
  needs: "Needs you",
  failed: "Failed",
  stopped: "Stopped",
};

export const ACTIVITY_PEEK_LIMIT = 5;

/** Unread entries, newest first, as the Activity button's card lists them. */
export function activityPeek(
  entries: readonly ActivityEntry[],
  now: number,
  limit = ACTIVITY_PEEK_LIMIT,
): { unread: number; rows: ActivityPeekRow[] } {
  const unread = entries
    .filter((entry) => entry.readAt === null && !entry.team?.member)
    .sort((a, b) => b.createdAt - a.createdAt);
  return {
    unread: unread.length,
    rows: unread.slice(0, limit).map((entry) => {
      const state: ActivityPeekRow["state"] =
        entry.outcome === "approval" || entry.outcome === "question"
          ? "needs"
          : entry.outcome === "failed"
            ? "failed"
            : entry.outcome === "stopped"
              ? "stopped"
              : "ready";
      const age = peekAge(entry.createdAt, now);
      return {
        id: entry.id,
        sessionId: entry.sessionId,
        title: entry.title.trim() || "Chat",
        state,
        end: age ? `${ACTIVITY_WORD[state]} · ${age}` : ACTIVITY_WORD[state],
      };
    }),
  };
}

/** The last reply an agent wrote, as plain words for a short quote. */
export function lastReplyQuote(
  blocks: readonly Pick<Block, "role" | "text">[],
  max = 320,
): string {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user") return "";
    if (block.role !== "assistant" || !block.text.trim()) continue;
    const words = block.text
      .replace(/```[\s\S]*?(?:```|$)/g, " ")
      .split(/\n\s*\n/)
      .map(proseSummary)
      .filter(Boolean)
      .join(" ");
    return words.length > max ? `${words.slice(0, max - 1).trimEnd()}…` : words;
  }
  return "";
}

/** When the chat's last turn ended, if it has. */
export function lastTurnEndedAt(
  blocks: readonly Pick<Block, "role" | "startedAt" | "durationMs">[],
): number | undefined {
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role !== "user" || block.startedAt === undefined) continue;
    return block.durationMs !== undefined
      ? block.startedAt + block.durationMs
      : undefined;
  }
  return undefined;
}

/** Chats touched since midnight. */
export function chatsToday(
  chats: readonly { updatedAt: number; archived?: boolean }[],
  now: number,
): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  return chats.filter((chat) => !chat.archived && chat.updatedAt >= start)
    .length;
}

/**
 * A few seconds' memory of what a card fetched, so pointing at the same
 * row again shows it at once while it reads again in the background.
 */
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_LIMIT = 64;

export const PEEK_FRESH_MS = 15_000;

export function readPeekCache<T>(
  key: string,
  now = Date.now(),
): { value: T; fresh: boolean } | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  return { value: hit.value as T, fresh: now - hit.at < PEEK_FRESH_MS };
}

export function writePeekCache(key: string, value: unknown, now = Date.now()) {
  cache.delete(key);
  cache.set(key, { at: now, value });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function clearPeekCache() {
  cache.clear();
}
