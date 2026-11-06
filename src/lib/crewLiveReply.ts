import { projectKey } from "./paths";

/**
 * What a teammate is writing to you right now, in memory only: the runner
 * fills it from the teammate's chat as the reply streams, and the Avos
 * screen shows it in place of "Answering a message…". It is never saved;
 * the finished answer lands in the thread as a post.
 */
const live = new Map<string, string>();
const listeners = new Set<() => void>();

function key(path: string, memberId: string): string {
  return `${projectKey(path)}\n${memberId}`;
}

/** The reply as far as it's written, or null to clear it. */
export function setCrewLiveReply(
  path: string,
  memberId: string,
  text: string | null,
): void {
  const id = key(path, memberId);
  const before = live.get(id) ?? null;
  const next = text?.trim() ? text : null;
  if (before === next) return;
  if (next) live.set(id, next);
  else live.delete(id);
  for (const listener of listeners) listener();
}

export function crewLiveReply(path: string, memberId: string): string | null {
  return live.get(key(path, memberId)) ?? null;
}

export function subscribeCrewLiveReplies(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
