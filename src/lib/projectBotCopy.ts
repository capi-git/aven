import { invoke } from "@tauri-apps/api/core";
import type { RaceDiff, RaceFileDiff } from "./race";

/**
 * The bot's copy of its project, made and read by the host (see
 * src-tauri/src/project_bots.rs, which reuses the race code). The copy lives
 * in Aven's app data and is kept between jobs.
 */

export type BotCopyInfo = { path: string; branch: string; root: string };

export type BotSyncResult = {
  root: string;
  base: string;
  uncommitted: boolean;
  untracked: boolean;
};

export const botCopyHost = {
  /** Make the copy when missing; an existing copy is left as it is. */
  prepare: (cwd: string, key: string, branch: string) =>
    invoke<BotCopyInfo>("bot_copy_prepare", { cwd, key, branch }),
  /** Match the copy to the user's files: HEAD plus uncommitted changes. */
  sync: (cwd: string, copy: string, branch: string) =>
    invoke<BotSyncResult>("bot_copy_sync", { cwd, copy, branch }),
  diff: (copy: string, base: string) =>
    invoke<RaceDiff>("bot_copy_diff", { copy, base }),
  fileDiff: (copy: string, base: string, path: string) =>
    invoke<RaceFileDiff>("bot_copy_file_diff", { copy, base, path }),
  /** Apply everything the bot changed onto the user's files. */
  apply: (cwd: string, copy: string, base: string) =>
    invoke<RaceDiff>("bot_copy_apply", { cwd, copy, base }),
  discard: (copy: string, base: string, branch: string) =>
    invoke<void>("bot_copy_discard", { copy, base, branch }),
  remove: (cwd: string, copy: string, branch: string) =>
    invoke<void>("bot_copy_remove", { cwd, copy, branch }),
};

/** A host error as one plain sentence, without git's own prefix. */
export function botCopyError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error).trim();
  if (/conflict with edits in your project/i.test(text))
    return "These changes conflict with edits in your files. Save or undo those edits, then try again.";
  if (/needs a git repository/i.test(text))
    return "Bots need a Git project. This folder isn't a Git repository yet.";
  if (/needs at least one commit/i.test(text))
    return "Bots need a Git project with at least one commit.";
  const line = text.split("\n")[0] ?? text;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
