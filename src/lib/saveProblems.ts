import { useSyncExternalStore } from "react";

/**
 * Changes Aven couldn't save. A store that fails to write (storage full or
 * unavailable, or a store another version of Aven wrote that this one
 * keeps as it is) reports it here, and the app shows one notice: what
 * can't be saved and why, until it is dismissed or the save works again.
 * Changes still hold for as long as the window is open.
 */
export type SaveProblem = {
  /** Which store: its storage key. */
  key: string;
  /** What couldn't be saved, in the user's words: "your teams". */
  what: string;
  /** Why, in a sentence. */
  why: string;
  at: number;
};

let problem: SaveProblem | null = null;
/** Stores that failed since their last good save, by key. */
const failing = new Map<string, SaveProblem>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** A store couldn't save: shown once per cause, not on every try. */
export function reportSaveProblem(
  key: string,
  what: string,
  why: string,
  now = Date.now(),
): void {
  const known = failing.get(key);
  if (known && known.why === why) return;
  const next = { key, what, why, at: now };
  failing.set(key, next);
  problem = next;
  emit();
}

/** A store saved again: its notice goes, and the next failing store's shows. */
export function clearSaveProblem(key: string): void {
  if (!failing.delete(key)) return;
  if (problem?.key === key) problem = [...failing.values()].at(-1) ?? null;
  emit();
}

/** Dismissed: the notice goes until a store fails for a new reason. */
export function dismissSaveProblem(): void {
  if (!problem) return;
  problem = null;
  emit();
}

export function saveProblem(): SaveProblem | null {
  return problem;
}

export function subscribeSaveProblems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSaveProblem(): SaveProblem | null {
  return useSyncExternalStore(subscribeSaveProblems, saveProblem, saveProblem);
}

/** Tests: nothing reported. */
export function resetSaveProblems(): void {
  problem = null;
  failing.clear();
}

/** Why a store couldn't write, in a sentence (storage full, or unavailable). */
export function saveFailureWhy(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED")
    return "Aven's storage is full.";
  return "Aven's storage isn't available.";
}

/** Why a store from another version of Aven is left as it is. */
export const FOREIGN_STORE_WHY =
  "they were saved by another version of Aven, which this one keeps as they are.";
