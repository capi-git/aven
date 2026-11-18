import { ask } from "@tauri-apps/plugin-dialog";
import { notifyGitChanged } from "./fs";
import { gitPrSquashMerge } from "./gitHousekeeping";

/** The question asked before a squash merge, wherever it starts. */
export function squashMergeQuestion(number: number, base: string | null) {
  return `Squash and merge PR #${number} into ${base ?? "the default branch"}? Its commits become one commit, and GitHub deletes the branch afterwards.`;
}

/** Asks first, as the Checks tab does. False when the person says no. */
export async function confirmSquashMerge(
  number: number,
  base: string | null,
): Promise<boolean> {
  return ask(squashMergeQuestion(number, base), {
    title: "Aven",
    kind: "warning",
    okLabel: "Squash and merge",
  });
}

/**
 * Squash-merges a copy's pull request after asking. Resolves false when
 * the person said no; a failed merge rejects for the caller to show.
 */
export async function squashMergeAfterAsking(
  cwd: string,
  number: number,
  base: string | null,
): Promise<boolean> {
  if (!(await confirmSquashMerge(number, base))) return false;
  try {
    await gitPrSquashMerge(cwd, number);
  } finally {
    notifyGitChanged(cwd);
  }
  return true;
}
