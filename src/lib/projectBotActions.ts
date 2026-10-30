import { useSyncExternalStore } from "react";
import { logError } from "./errors";
import { notifyGitChanged } from "./fs";
import {
  isHarnessAvailable,
  probeHarnessAvailability,
} from "./harness/availability";
import { projectKey } from "./paths";
import { botCopyError, botCopyHost, isFixChanged } from "./projectBotCopy";
import {
  botBranch,
  botName,
  forgetProjectBot,
  getProjectBot,
  jobIsLive,
  newProjectBot,
  noteFixError,
  resolveFix,
  updateProjectBot,
  withReadyFix,
  type ProjectBot,
} from "./projectBots";

/**
 * Turning a bot on and off, and acting on a fix it made. These work from
 * any window: they change the shared store and the bot's copy, never the
 * bot's chat, which the main window drives.
 */

export type BotSettings = Pick<ProjectBot, "name" | "wakes" | "can">;

/**
 * Turn the project's bot on with these settings: make its copy first, so a
 * folder that is not a Git project says so instead. Resolves with why it
 * could not, or null once on.
 */
export async function turnOnProjectBot(
  path: string,
  settings: BotSettings,
  branchName: string,
): Promise<string | null> {
  const existing = getProjectBot(path);
  const branch = existing?.copy?.branch ?? botBranch(branchName, path);
  let copy: ProjectBot["copy"];
  try {
    copy = await botCopyHost.prepare(path, projectKey(path), branch);
  } catch (error) {
    logError("Bot copy", error);
    return botCopyError(error);
  }
  updateProjectBot(path, (bot) => ({
    ...bot,
    ...settings,
    on: true,
    onAt: Date.now(),
    paused: undefined,
    copy,
    lastError: undefined,
    lastSkip: undefined,
  }));
  return null;
}

/**
 * Turn the bot on as it comes: called the Fixer, looking when a chat
 * finishes or the dev server crashes, and fixing in its own copy. Resolves
 * with why it could not, in plain words, or null once on.
 */
export async function turnOnBotWithDefaults(
  path: string,
): Promise<string | null> {
  await probeHarnessAvailability();
  if (!isHarnessAvailable("claude"))
    return "Bots use Claude Code. Install it and sign in, then add the bot again.";
  const bot = getProjectBot(path) ?? newProjectBot(path);
  const name = botName(bot);
  return turnOnProjectBot(
    path,
    { name: bot.name, wakes: bot.wakes, can: bot.can },
    name,
  );
}

/** Change a bot's settings; turning it on or off goes through its own calls. */
export function saveBotSettings(path: string, settings: Partial<BotSettings>) {
  updateProjectBot(path, (bot) => ({ ...bot, ...settings }));
}

export function setBotPaused(path: string, paused: boolean) {
  updateProjectBot(path, (bot) =>
    !!bot.paused === paused ? bot : { ...bot, paused: paused || undefined },
  );
}

/**
 * Turn the bot off: its copy (and any fix waiting there) is removed and what
 * it was doing is forgotten. Its settings, name and chat are kept for next
 * time. Resolves with why the copy could not be removed, or null.
 */
export async function turnOffProjectBot(path: string): Promise<string | null> {
  const bot = getProjectBot(path);
  if (!bot) return null;
  // Off first, so nothing new starts; then whatever it is doing stops before
  // its copy goes.
  updateProjectBot(path, (current) => ({ ...current, on: false }));
  await workspace?.stop(path).catch((error) => logError("Stop bot", error));
  let problem: string | null = null;
  if (bot.copy) {
    try {
      await botCopyHost.remove(path, bot.copy.path, bot.copy.branch);
    } catch (error) {
      logError("Bot copy", error);
      problem = "Its copy couldn't be removed completely.";
    }
  }
  updateProjectBot(path, (current) => ({
    ...current,
    on: false,
    onAt: undefined,
    paused: undefined,
    copy: undefined,
    base: undefined,
    fixes: undefined,
    job: undefined,
    runs: undefined,
    lastWake: undefined,
    lastPost: undefined,
    lastSkip: undefined,
    lastError: undefined,
  }));
  workspace?.release(path);
  return problem;
}

/** The project is being deleted: the bot's copy goes and so does its entry. */
export async function forgetBotForProject(path: string): Promise<void> {
  const bot = getProjectBot(path);
  if (!bot) return;
  if (bot.copy)
    await botCopyHost
      .remove(path, bot.copy.path, bot.copy.branch)
      .catch((error) => logError("Bot copy", error));
  forgetProjectBot(path);
}

const FIX_CHANGED_TEXT =
  "The fix changed since you looked. Review it again, then apply.";

/**
 * Read the waiting fix again from the bot's copy, on the same turn, with its
 * new fingerprint: what Review shows next is what Apply applies. Resolves
 * with why it couldn't, or null.
 */
export async function refreshBotFix(
  path: string,
  fixId: string,
): Promise<string | null> {
  const bot = getProjectBot(path);
  const fix = bot?.fixes?.find((item) => item.id === fixId);
  if (!bot?.copy || !fix || fix.state !== "ready")
    return "This fix is no longer waiting.";
  try {
    const now = await botCopyHost.diff(bot.copy.path, fix.base);
    updateProjectBot(path, (current) =>
      now.files.length
        ? withReadyFix(current, {
            ...fix,
            files: now.files.length,
            additions: now.additions,
            deletions: now.deletions,
            paths: now.files.map((file) => file.path),
            hash: now.hash,
            at: Date.now(),
          })
        : resolveFix(current, fixId, "gone"),
    );
    return now.files.length ? null : "This fix is no longer waiting.";
  } catch (error) {
    logError("Bot fix", error);
    return botCopyError(error);
  }
}

/**
 * Bring the waiting fix into the user's files. A conflict changes nothing
 * and keeps the fix; resolves with why, in plain words, or null once applied.
 */
export async function applyBotFix(
  path: string,
  fixId: string,
): Promise<string | null> {
  const bot = getProjectBot(path);
  const fix = bot?.fixes?.find((item) => item.id === fixId);
  if (!bot?.copy || !fix || fix.state !== "ready")
    return "This fix is no longer waiting.";
  if (jobIsLive(bot.job, Date.now()))
    return "It's still working on this. Apply it once it finishes.";
  // What goes into your files is exactly the fix you reviewed: the host
  // applies only a patch with its fingerprint. One that changed since (or
  // one recorded before fingerprints) is shown again first.
  if (!fix.hash) return (await refreshBotFix(path, fixId)) ?? FIX_CHANGED_TEXT;
  try {
    await botCopyHost.apply(path, bot.copy.path, fix.base, fix.hash);
  } catch (error) {
    if (isFixChanged(error))
      return (await refreshBotFix(path, fixId)) ?? FIX_CHANGED_TEXT;
    logError("Apply bot fix", error);
    const text = botCopyError(error);
    updateProjectBot(path, (current) => noteFixError(current, fixId, text));
    return text;
  }
  updateProjectBot(path, (current) => resolveFix(current, fixId, "applied"));
  notifyGitChanged(path);
  // Its copy now matches your files, fix included, so the next look starts
  // from there and never offers the same changes again. Not under a bot at
  // work: its next job syncs instead.
  if (jobIsLive(getProjectBot(path)?.job, Date.now())) return null;
  try {
    const synced = await botCopyHost.sync(path, bot.copy.path, bot.copy.branch);
    updateProjectBot(path, (current) => ({ ...current, base: synced.base }));
  } catch (error) {
    logError("Bot copy sync", error);
  }
  return null;
}

/** Throw the waiting fix away: the copy goes back to where it started. */
export async function discardBotFix(
  path: string,
  fixId: string,
): Promise<string | null> {
  const bot = getProjectBot(path);
  const fix = bot?.fixes?.find((item) => item.id === fixId);
  if (!bot?.copy || !fix || fix.state !== "ready")
    return "This fix is no longer waiting.";
  if (jobIsLive(bot.job, Date.now()))
    return "It's still working on this. Throw it away once it finishes.";
  try {
    await botCopyHost.discard(bot.copy.path, fix.base, bot.copy.branch);
  } catch (error) {
    logError("Throw away bot fix", error);
    return botCopyError(error);
  }
  updateProjectBot(path, (current) => resolveFix(current, fixId, "discarded"));
  return null;
}

// ---------------------------------------------------------------------------
// What the bot UI needs from the main workspace, supplied by App.

export type BotWorkspace = {
  /** Show the bot's chat in a tab, making it when it has none yet. */
  openChat: (path: string) => void;
  /** Open the bot's settings sheet (turning it on, when it is off). */
  openSettings: (path: string) => void;
  /** The bot was turned off: its chat stops working in the copy. */
  release: (path: string) => void;
  /** Stop whatever the bot's chat is doing, and wait until it has. */
  stop: (path: string) => Promise<void>;
};

let workspace: BotWorkspace | null = null;
const workspaceListeners = new Set<() => void>();

export function installBotWorkspace(next: BotWorkspace): () => void {
  workspace = next;
  for (const listener of workspaceListeners) listener();
  return () => {
    if (workspace !== next) return;
    workspace = null;
    for (const listener of workspaceListeners) listener();
  };
}

export function botWorkspace(): BotWorkspace | null {
  return workspace;
}

function subscribeBotWorkspace(listener: () => void) {
  workspaceListeners.add(listener);
  return () => {
    workspaceListeners.delete(listener);
  };
}

export function useBotWorkspace(): BotWorkspace | null {
  return useSyncExternalStore(
    subscribeBotWorkspace,
    botWorkspace,
    botWorkspace,
  );
}
