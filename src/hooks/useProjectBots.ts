import { useCallback, useEffect, useRef, useState } from "react";
import { sessionCheckpointStatus } from "../lib/checkpoint";
import type { SessionActivityEvent } from "../lib/notifications";
import { botCopyHost } from "../lib/projectBotCopy";
import {
  BotRunner,
  type BotRunnerDeps,
  type BotSendOptions,
} from "../lib/projectBotRunner";
import {
  anyProjectBotOn,
  botName,
  subscribeProjectBots,
  type ProjectBot,
} from "../lib/projectBots";
import { projectAppearance } from "../lib/projectAppearance";
import { claimScheduledSlot, listScheduledRuns } from "../lib/scheduledAgents";
import type { Attachment, Session } from "../lib/session";
import { getUsageForecasts } from "../lib/usageHistory";
import { loadSavedRateLimits } from "../lib/rateLimits";

/** This window, so two windows never drive the same bot. */
const OWNER = `window-${Math.random().toString(36).slice(2, 10)}`;

/** The Claude account's weekly usage, from Aven's latest reading. */
export function claudeWeeklyUsed(now: number): number | null {
  const sample = getUsageForecasts().providers.claude?.latest.weekly;
  if (sample && (sample.resetsAt == null || sample.resetsAt > now))
    return sample.used;
  const saved = loadSavedRateLimits().claude?.weekly;
  if (saved && (saved.resetsAt == null || saved.resetsAt > now))
    return saved.usedPercent;
  return null;
}

export type ProjectBotsHost = {
  /** Load the bot's chat, or make it, without a tab. */
  ensureChat: (bot: ProjectBot) => Promise<Session | null>;
  send: (sessionId: string, text: string, options: BotSendOptions) => boolean;
  announce: (session: Session, event: SessionActivityEvent) => void;
  /** The chats bots work in now, which stay loaded without a tab. */
  onWorking: (ids: ReadonlySet<string>) => void;
};

/**
 * Drives this window's project bots (see `BotRunner`). Only the main
 * window passes `enabled`; with no bot on, nothing listens and nothing runs.
 * Returns `message`, which sends what you type to a bot through its copy;
 * false when the message is not the bot's to handle.
 */
export function useProjectBots(
  sessions: readonly Session[],
  host: ProjectBotsHost,
  enabled: boolean,
): (sessionId: string, text: string, attachments: Attachment[]) => boolean {
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const hostRef = useRef(host);
  hostRef.current = host;
  const runnerRef = useRef<BotRunner | null>(null);
  if (!runnerRef.current) {
    const deps: BotRunnerDeps = {
      owner: OWNER,
      now: () => Date.now(),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (id) => window.clearTimeout(id),
      sessions: () => sessionsRef.current,
      ensureChat: (bot) => hostRef.current.ensureChat(bot),
      send: (sessionId, text, options) =>
        hostRef.current.send(sessionId, text, options),
      announce: (session, event) => hostRef.current.announce(session, event),
      copy: botCopyHost,
      claimEvent: claimScheduledSlot,
      weeklyUsed: claudeWeeklyUsed,
      changedFiles: async (sessionId, cwd) => {
        const status = await sessionCheckpointStatus(sessionId, cwd);
        return status.files.map((file) => ({
          path: file.relative,
          additions: file.additions,
          deletions: file.deletions,
        }));
      },
      scheduledChats: () =>
        new Set(
          listScheduledRuns()
            .map((run) => run.sessionId)
            .filter((id): id is string => !!id),
        ),
      name: (bot) => botName(bot, projectAppearance(bot.path).mascot),
      onWorking: (ids) => hostRef.current.onWorking(ids),
    };
    runnerRef.current = new BotRunner(deps);
  }
  const runner = runnerRef.current;

  // Listen only while a bot is on in this window's store.
  const [anyOn, setAnyOn] = useState(anyProjectBotOn);
  useEffect(() => {
    const sync = () => setAnyOn(anyProjectBotOn());
    sync();
    return subscribeProjectBots(sync);
  }, []);
  useEffect(() => {
    if (!enabled || !anyOn) return;
    runner.start();
    return () => runner.stop();
  }, [anyOn, enabled, runner]);

  useEffect(() => {
    if (enabled && anyOn) runner.observe(sessions);
  }, [anyOn, enabled, runner, sessions]);

  const live = enabled && anyOn;
  return useCallback(
    (sessionId: string, text: string, attachments: Attachment[]) =>
      live ? runner.message(sessionId, text, attachments) : false,
    [live, runner],
  );
}
