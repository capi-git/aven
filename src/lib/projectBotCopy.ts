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
  /** Settings files an agent had left in the copy, now removed. */
  planted?: string[];
};

export const botCopyHost = {
  /** Resolves when the folder can have a bot (a git repository with a commit). */
  ready: (cwd: string) => invoke<void>("bot_project_ready", { cwd }),
  /**
   * Make the copy when missing; an existing copy is left as it is. A
   * crew's copy made again starts `at` its stack, so the cards there stay.
   */
  prepare: (cwd: string, key: string, branch: string, at?: string) =>
    invoke<BotCopyInfo>("bot_copy_prepare", {
      cwd,
      key,
      branch,
      at: at ?? null,
    }),
  /** Match the copy to the user's files: HEAD plus uncommitted changes. */
  sync: (cwd: string, copy: string, branch: string) =>
    invoke<BotSyncResult>("bot_copy_sync", { cwd, copy, branch }),
  diff: (copy: string, base: string) =>
    invoke<BotDiff>("bot_copy_diff", { copy, base }),
  /**
   * Settings files an agent left in the copy that an app would run as the
   * user (Claude's project and local settings, MCP servers); with `remove`,
   * they are removed.
   */
  planted: (copy: string, remove: boolean) =>
    invoke<string[]>("bot_copy_planted", { copy, remove }),
  fileDiff: (copy: string, base: string, path: string) =>
    invoke<RaceFileDiff>("bot_copy_file_diff", { copy, base, path }),
  /**
   * Apply what the bot changed onto the user's files, only while it is the
   * fix with this fingerprint (the one the user reviewed).
   */
  apply: (cwd: string, copy: string, base: string, hash: string) =>
    invoke<RaceDiff>("bot_copy_apply", { cwd, copy, base, hash }),
  /**
   * Throw the copy's work away, back to `base`; with `expect`, only while
   * the branch is still at that commit.
   */
  discard: (copy: string, base: string, branch: string, expect?: string) =>
    invoke<void>("bot_copy_discard", {
      copy,
      base,
      branch,
      expect: expect ?? null,
    }),
  remove: (cwd: string, copy: string, branch: string) =>
    invoke<void>("bot_copy_remove", { cwd, copy, branch }),
  /**
   * A crew's stack: what the copy holds now becomes a commit on the crew's
   * branch on top of `parent` (the card's starting point, the branch's
   * commit), only while it is exactly the change its checks passed (`hash`).
   * Resolves with the card's commit.
   */
  stack: (
    copy: string,
    branch: string,
    parent: string,
    message: string,
    hash: string,
  ) =>
    invoke<string>("bot_copy_stack", { copy, branch, parent, message, hash }),
  /** Take a card's commit back off the branch, keeping its files in the copy. */
  unstack: (copy: string, branch: string, commit: string, parent: string) =>
    invoke<void>("bot_copy_unstack", { copy, branch, commit, parent }),
  /** What changed between two of the stack's commits, with its fingerprint. */
  range: (copy: string, from: string, to: string) =>
    invoke<BotDiff>("bot_copy_range", { copy, from, to }),
  rangeFileDiff: (copy: string, from: string, to: string, path: string) =>
    invoke<RaceFileDiff>("bot_copy_range_file_diff", { copy, from, to, path }),
  /**
   * Apply the stacked range onto the user's files, only while it is the
   * change with this fingerprint (the one the user reviewed) and each of
   * its cards (`cards`, in order, the last at `to`) is the change its checks
   * passed. Protected paths are refused; a conflict changes nothing.
   */
  applyRange: (
    cwd: string,
    copy: string,
    from: string,
    to: string,
    hash: string,
    cards: readonly { commit: string; hash: string }[],
  ) =>
    invoke<RaceDiff>("bot_copy_apply_range", {
      cwd,
      copy,
      from,
      to,
      hash,
      cards,
    }),
  /**
   * Replay the stacked cards onto the user's files now, each its own commit
   * again. A card that no longer fits leaves the stack exactly as it was.
   */
  restack: (
    cwd: string,
    copy: string,
    branch: string,
    from: string,
    commits: readonly string[],
  ) =>
    invoke<{ base: string; commits: string[]; hashes: string[] }>(
      "bot_copy_restack",
      {
        cwd,
        copy,
        branch,
        from,
        commits,
      },
    ),
};

/** The host refused a restack: the user's files changed where the crew worked. */
export function isRestackConflict(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).startsWith(
    "Your files changed where the crew worked",
  );
}

/**
 * The file whose name reads as a settings folder on a Mac, when that's why
 * the host refused a change (see `look_alike` in project_bots.rs).
 */
export function lookAlikePath(error: unknown): string | null {
  const text = String(error instanceof Error ? error.message : error);
  const found =
    /reads as a settings folder on a Mac: (.+?)(?: \(card \d+ of \d+\))?$/.exec(
      text.split("\n")[0] ?? "",
    );
  return found ? found[1]!.trim() : null;
}

/** Why a change with a look-alike settings name can't go on, in plain words. */
export function lookAlikeText(path: string): string {
  return `“${path}” reads as a settings folder on a Mac, so it can't go to your files. Take it over in a chat to rename it, or throw the card away.`;
}

/** The copy changed after a card's checks, so it wasn't stacked. */
export function isStackChanged(error: unknown): boolean {
  return /copy changed after the card's checks/i.test(
    String(error instanceof Error ? error.message : error),
  );
}

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
  const lookAlike = lookAlikePath(text);
  if (lookAlike) return lookAlikeText(lookAlike);
  if (/isn't the change its checks passed/i.test(text))
    return "A card on the crew's branch isn't the change its checks passed, so nothing was applied. Take it off the branch, or update the branch and review it again.";
  if (/name has characters Aven can't read safely/i.test(text))
    return "A changed file's name has characters Aven can't read safely, so Aven won't use this change. Take it over in a chat.";
  if (/conflict with edits in your project/i.test(text))
    return "These changes conflict with edits in your files. Save or undo those edits, then try again.";
  if (/needs a git repository/i.test(text))
    return "Bots need a Git project. This folder isn't a Git repository yet.";
  if (/needs at least one commit/i.test(text))
    return "Bots need a Git project with at least one commit.";
  const line = text.split("\n")[0] ?? text;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
