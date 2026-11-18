import { useSyncExternalStore } from "react";
import { pathKey } from "./paths";

/**
 * Comments left on a diff, waiting in a project's Review tab until they are
 * sent to a chat. Open ones have not been sent; done ones have.
 */
export type ReviewComment = {
  id: string;
  /** The project folder the comment belongs to. */
  project: string;
  /** The file, as the diff named it (usually relative to the project). */
  path: string;
  /** First and last line commented on; absent for a whole file. */
  startLine?: number;
  endLine?: number;
  /** The line's text, quoted when the comment is sent. */
  quote?: string;
  /** "+", "-" or " ": the side of the diff the line is on. */
  marker?: string;
  text: string;
  /** The ready-to-send message for a chat. */
  message: string;
  createdAt: number;
  /** When it was sent to a chat; set means done. */
  sentAt?: number;
};

const KEY = "aven.reviewQueue";
/** Done comments kept per project; older ones are dropped. */
const MAX_DONE = 50;

let comments: ReviewComment[] | null = null;
let version = 0;
let project = "";
const listeners = new Set<() => void>();

function read(): ReviewComment[] {
  if (comments) return comments;
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    comments = Array.isArray(value)
      ? value.filter(
          (item): item is ReviewComment =>
            !!item &&
            typeof item.id === "string" &&
            typeof item.project === "string" &&
            typeof item.path === "string" &&
            typeof item.message === "string",
        )
      : [];
  } catch {
    comments = [];
  }
  return comments;
}

function write(next: ReviewComment[]) {
  comments = next;
  version += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* The queue still holds for this run. */
  }
  for (const listener of [...listeners]) listener();
}

function sameProject(a: string, b: string): boolean {
  return !!a && !!b && pathKey(a) === pathKey(b);
}

/** The project a new comment is filed under: the one the side panel shows. */
export function setReviewProject(path: string) {
  project = path && path !== "~" ? path : "";
}

export function reviewProject(): string {
  return project;
}

export function reviewComments(path: string): ReviewComment[] {
  return read().filter((comment) => sameProject(comment.project, path));
}

/** Files a comment under the side panel's project; null without one. */
export function addReviewComment(
  comment: Omit<ReviewComment, "id" | "project" | "createdAt"> & {
    project?: string;
  },
): ReviewComment | null {
  const where = comment.project || project;
  if (!where) return null;
  const added: ReviewComment = {
    ...comment,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    project: where,
    createdAt: Date.now(),
  };
  write([...read(), added]);
  return added;
}

export function markReviewSent(id: string, at = Date.now()) {
  const all = read();
  const target = all.find((comment) => comment.id === id);
  if (!target || target.sentAt) return;
  const next = all.map((comment) =>
    comment.id === id ? { ...comment, sentAt: at } : comment,
  );
  // Keep the newest done comments of that project only.
  const done = next
    .filter(
      (comment) =>
        comment.sentAt && sameProject(comment.project, target.project),
    )
    .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
  const dropped = new Set(done.slice(MAX_DONE).map((comment) => comment.id));
  write(next.filter((comment) => !dropped.has(comment.id)));
}

export function removeReviewComment(id: string) {
  const all = read();
  if (!all.some((comment) => comment.id === id)) return;
  write(all.filter((comment) => comment.id !== id));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A project's comments; re-renders only when the queue changes. */
export function useReviewComments(path: string): ReviewComment[] {
  const at = useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  return cachedList(path, at);
}

let cache: { path: string; version: number; list: ReviewComment[] } | null =
  null;
function cachedList(path: string, at: number): ReviewComment[] {
  if (!cache || cache.path !== path || cache.version !== at)
    cache = { path, version: at, list: reviewComments(path) };
  return cache.list;
}

/** For tests: start from what storage holds. */
export function resetReviewQueueForTest() {
  comments = null;
  cache = null;
  project = "";
  version += 1;
}
