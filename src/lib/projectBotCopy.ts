import { invoke } from "@tauri-apps/api/core";
import type { GitSetupNeed } from "./projectGitSetup";
import type { RaceDiff, RaceFileDiff } from "./race";

/**
 * The bot's copy of its project, made and read by the host (see
 * src-tauri/src/project_bots.rs, which reuses the race code). The copy lives
 * in Aven's app data and is kept between jobs.
 */

export type BotCopyInfo = {
  path: string;
  branch: string;
  root: string;
  /** The repository's shared git folder. */
  gitDir: string;
};

/** What the bot changed, with a fingerprint of exactly those changes. */
export type BotDiff = RaceDiff & { hash: string };

export type BotSyncResult = {
  root: string;
  base: string;
  uncommitted: boolean;
  untracked: boolean;
};

export const botCopyHost = {
  /** Resolves when the folder can have a bot (a git repository with a commit). */
  ready: (cwd: string) => invoke<void>("bot_project_ready", { cwd }),
  /** Make the copy when missing; an existing copy is left as it is. */
  prepare: (cwd: string, key: string, branch: string) =>
    invoke<BotCopyInfo>("bot_copy_prepare", { cwd, key, branch }),
  /** Match the copy to the user's files: HEAD plus uncommitted changes. */
  sync: (cwd: string, copy: string, branch: string) =>
    invoke<BotSyncResult>("bot_copy_sync", { cwd, copy, branch }),
  diff: (copy: string, base: string) =>
    invoke<BotDiff>("bot_copy_diff", { copy, base }),
  fileDiff: (copy: string, base: string, path: string) =>
    invoke<RaceFileDiff>("bot_copy_file_diff", { copy, base, path }),
  /**
   * Apply what the bot changed onto the user's files, only while it is the
   * fix with this fingerprint (the one the user reviewed).
   */
  apply: (cwd: string, copy: string, base: string, hash: string) =>
    invoke<RaceDiff>("bot_copy_apply", { cwd, copy, base, hash }),
  discard: (copy: string, base: string, branch: string) =>
    invoke<void>("bot_copy_discard", { copy, base, branch }),
  remove: (cwd: string, copy: string, branch: string) =>
    invoke<void>("bot_copy_remove", { cwd, copy, branch }),
};

/** The host refused to apply a fix that changed after it was reviewed. */
export function isFixChanged(error: unknown): boolean {
  return /fix changed since you looked/i.test(
    String(error instanceof Error ? error.message : error),
  );
}

/**
 * Whether a project can have a bot: ready, or not yet because it isn't
 * using Git or Git has nothing saved (both fixed by setting up Git), or
 * not at all (its folder is gone, say).
 */
export type BotProjectState = "ready" | GitSetupNeed | "unavailable";

/** Which state the host's "not ready" reason means. */
export function botProjectState(error: unknown): BotProjectState {
  const text = String(error instanceof Error ? error.message : error);
  if (/needs a git repository/i.test(text)) return "no-git";
  if (/needs at least one commit/i.test(text)) return "no-commit";
  return "unavailable";
}

/** Each of `paths`' states, in the same order. */
export function botProjectStates(
  paths: readonly string[],
): Promise<BotProjectState[]> {
  return Promise.all(
    paths.map((path) =>
      botCopyHost
        .ready(path)
        .then((): BotProjectState => "ready", botProjectState),
    ),
  );
}

/**
 * Before a bot is added: what the project needs first, setting up Git or a
 * first save, or null when it can try now (any other problem is said then).
 */
export async function gitSetupNeeded(
  path: string,
): Promise<GitSetupNeed | null> {
  const [state] = await botProjectStates([path]);
  return state === "no-git" || state === "no-commit" ? state : null;
}

/** A host error as one plain sentence, without git's own prefix. */
export function botCopyError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error).trim();
  if (isFixChanged(text))
    return "The fix changed since you looked. Review it again, then apply.";
  if (/conflict with edits in your project/i.test(text))
    return "These changes conflict with edits in your files. Save or undo those edits, then try again.";
  if (/needs a git repository/i.test(text))
    return "Bots need a Git project. This folder isn't a Git repository yet.";
  if (/needs at least one commit/i.test(text))
    return "Bots need a Git project with at least one commit.";
  const line = text.split("\n")[0] ?? text;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
