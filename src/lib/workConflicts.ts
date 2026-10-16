import {
  devPreviewsSnapshot,
  duplicateDevServers,
  subscribeDevPreviews,
  type DevPreview,
} from "./devPreviews";
import { duplicateSummary } from "./devServerDuplicates";
import {
  editOverlapsSnapshot,
  overlapSentence,
  subscribeSharedWork,
  type EditOverlapMap,
} from "./sharedWork";

/**
 * Chats that bump into another chat's work: editing a file another working
 * chat is editing, or running a second copy of an app that already runs.
 * The sidebar marks their rows. Plain data, so the floating sidebar's
 * snapshot carries it unchanged.
 */
export type WorkConflict = {
  kind: "files" | "server";
  /** What the row's marker says, in a sentence. */
  label: string;
};

export type WorkConflictMap = Readonly<Record<string, WorkConflict>>;

const EMPTY: WorkConflictMap = Object.freeze({});

export function computeWorkConflicts(
  overlaps: EditOverlapMap,
  previews: readonly DevPreview[],
): WorkConflictMap {
  const out: Record<string, WorkConflict> = {};
  for (const duplicate of duplicateDevServers(previews)) {
    const { preview } = duplicate;
    if (preview.source !== "agent" || !preview.sessionId) continue;
    out[preview.sessionId] = {
      kind: "server",
      label: duplicateSummary(duplicate),
    };
  }
  for (const [sessionId, list] of Object.entries(overlaps)) {
    const files = overlapSentence(list);
    const server = out[sessionId];
    out[sessionId] = {
      kind: "files",
      label: server ? `${files}. ${server.label}` : files,
    };
  }
  return Object.keys(out).length ? out : EMPTY;
}

export function sameWorkConflicts(
  a: WorkConflictMap,
  b: WorkConflictMap,
): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) => b[key]?.kind === a[key].kind && b[key]?.label === a[key].label,
    )
  );
}

let cache: {
  overlaps: EditOverlapMap;
  previews: readonly DevPreview[];
  value: WorkConflictMap;
} | null = null;

/** Recomputed only when overlaps or dev servers change; same identity otherwise. */
export function workConflictsSnapshot(): WorkConflictMap {
  const overlaps = editOverlapsSnapshot();
  const previews = devPreviewsSnapshot();
  if (cache && cache.overlaps === overlaps && cache.previews === previews)
    return cache.value;
  const next = computeWorkConflicts(overlaps, previews);
  const value =
    cache && sameWorkConflicts(cache.value, next) ? cache.value : next;
  cache = { overlaps, previews, value };
  return value;
}

export function subscribeWorkConflicts(listener: () => void): () => void {
  const stopWork = subscribeSharedWork(listener);
  const stopPreviews = subscribeDevPreviews(listener);
  return () => {
    stopWork();
    stopPreviews();
  };
}
