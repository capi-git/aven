import { useEffect, useRef, useState } from "react";
import { claudeCheckerModel } from "../lib/crewModels";
import { CrewRunner } from "../lib/crewRunner";
import {
  anyCrewOn,
  crewMemberName,
  migrateBotsIntoCrews,
  subscribeCrews,
  type Crew,
} from "../lib/crews";
import {
  addFeatureCards,
  featureBoardState,
  loadFeatureCards,
  moveFeatureCard,
} from "../lib/featureCards";
import { listDir } from "../lib/fs";
import { botCopyHost } from "../lib/projectBotCopy";
import type { BotSendOptions } from "../lib/projectBotRunner";
import {
  botName,
  botsAvailable,
  getProjectBot,
  runsToday,
} from "../lib/projectBots";
import { projectAppearance } from "../lib/projectAppearance";
import type { Session } from "../lib/session";
import { claudeWeeklyUsed } from "./useProjectBots";

/** This window, so two windows never drive the same crew. */
const OWNER = `window-${Math.random().toString(36).slice(2, 10)}`;

/** The copy's own files: its top-level entries Git doesn't ignore. */
async function copySources(copy: string): Promise<string[]> {
  const entries = await listDir(copy);
  return entries
    .filter((entry) => !entry.ignored && entry.name !== ".git")
    .map((entry) => entry.path);
}

export type CrewsHost = {
  /**
   * Load a member's chat, or make it, without a tab, in the crew's copy, on
   * its app with its model and effort (or the card's own, for a Builder).
   */
  ensureChat: (
    crew: Crew,
    memberId: string,
    override?: { model?: string; effort?: string },
  ) => Promise<Session | null>;
  send: (sessionId: string, text: string, options: BotSendOptions) => boolean;
  /** Stop a chat's turn. */
  stopChat: (sessionId: string) => void;
  /** Start the chat's agent on a new conversation at its next turn. */
  freshConversation: (sessionId: string) => void;
  /** The chats crews work in now, which stay loaded without a tab. */
  onWorking: (ids: ReadonlySet<string>) => void;
};

/**
 * Drives this window's crews (see `CrewRunner`). Only the main window
 * passes `enabled`, and a lease in the store keeps any other from running
 * the same crew at once. With no crew on, nothing listens and nothing runs:
 * crews work only while Aven is open and the Mac awake.
 */
export function useCrews(
  sessions: readonly Session[],
  sessionsRef: { readonly current: readonly Session[] },
  host: CrewsHost,
  enabled: boolean,
) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const runnerRef = useRef<CrewRunner | null>(null);
  if (!runnerRef.current)
    runnerRef.current = new CrewRunner({
      owner: OWNER,
      now: () => Date.now(),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (id) => window.clearTimeout(id),
      sessions: () => sessionsRef.current,
      ensureChat: (crew, memberId, override) =>
        hostRef.current.ensureChat(crew, memberId, override),
      send: (sessionId, text, options) =>
        hostRef.current.send(sessionId, text, options),
      stopChat: (sessionId) => hostRef.current.stopChat(sessionId),
      freshConversation: (sessionId) =>
        hostRef.current.freshConversation(sessionId),
      checkerFallbackModel: (crew) => claudeCheckerModel(crew),
      copy: {
        prepare: botCopyHost.prepare,
        sync: botCopyHost.sync,
        diff: botCopyHost.diff,
        sources: copySources,
      },
      weeklyUsed: claudeWeeklyUsed,
      fixerRuns: (path, now) => {
        const bot = getProjectBot(path);
        return bot ? runsToday(bot, now) : 0;
      },
      fixerBranch: (path) => getProjectBot(path)?.copy?.branch,
      board: {
        cards: async (project) => {
          await loadFeatureCards(project);
          return featureBoardState(project).cards;
        },
        move: (project, id, column) => moveFeatureCard(project, id, column, ""),
        add: (project, drafts) => addFeatureCards(project, drafts),
      },
      name: (crew, who) => {
        const bot = getProjectBot(crew.path);
        return crewMemberName(
          crew,
          who,
          bot ? botName(bot, projectAppearance(crew.path).mascot) : undefined,
        );
      },
      onWorking: (ids) => hostRef.current.onWorking(ids),
    });
  const runner = runnerRef.current;

  // Each project bot joins its project's crew as the Fixer, saved once by
  // the main window (the bot's own store is never touched).
  useEffect(() => {
    if (enabled && botsAvailable()) migrateBotsIntoCrews();
  }, [enabled]);

  const [anyOn, setAnyOn] = useState(anyCrewOn);
  useEffect(() => {
    const sync = () => setAnyOn(anyCrewOn());
    sync();
    return subscribeCrews(sync);
  }, []);
  useEffect(() => {
    if (!enabled || !anyOn) return;
    runner.start();
    return () => runner.stop();
  }, [anyOn, enabled, runner]);
  useEffect(() => {
    if (enabled && anyOn) runner.observe(sessions);
  }, [anyOn, enabled, runner, sessions]);
}
