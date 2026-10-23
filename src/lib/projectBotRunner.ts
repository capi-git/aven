import {
  getActivitySnapshot,
  subscribeActivity,
  type ActivityEntry,
} from "./activity";
import { subscribeDevServerStops, type DevServerStop } from "./devServerStops";
import { errorText, logError } from "./errors";
import type { SessionActivityEvent } from "./notifications";
import type { ControlOutcome } from "./orchestration";
import { isEqualOrInside, projectKey } from "./paths";
import type { BotCopyInfo, BotSyncResult } from "./projectBotCopy";
import { botCopyError } from "./projectBotCopy";
import {
  activeProjectBots,
  botChatIds,
  botForChat,
  botSkipText,
  botWakeDecision,
  claimBotJob,
  getProjectBot,
  pendingFix,
  releaseBotJob,
  renewBotJob,
  resolveFix,
  skipKeepsEvents,
  updateProjectBot,
  withReadyFix,
  withRunCounted,
  fixMatches,
  type ProjectBot,
} from "./projectBots";
import {
  BOT_SETTLE_MS,
  botBrief,
  buildDirectMessage,
  buildWakeMessage,
  coalesceEvents,
  eventKind,
  isNothingToReport,
  lastLines,
  replyHeadline,
  wakeLabel,
  wakesFromActivity,
  type BotChangedFile,
  type BotEvent,
  type BotSyncNote,
} from "./projectBotWake";
import type { RaceDiff } from "./race";
import type { Attachment, Session } from "./session";
import { latestTurnTests } from "./turnTests";

/**
 * Drives the project bots of one window (the main one): hears what happens
 * in each project with a bot on, waits for a burst of events to settle,
 * checks the bot may wake (`botWakeDecision`), syncs its copy, sends it the
 * wake-up and reads what it changed once its turn ends. Everything outside
 * the store and the copy (the chat, sending, Activity) comes in as `deps`,
 * so the rules can be tested without a workspace.
 */

/** A burst of events never waits longer than this for the bot. */
export const BOT_MAX_WAIT_MS = 2 * 60_000;
/** A held event (the bot is busy elsewhere) is looked at again this often. */
const RETRY_MS = 60_000;
/** A job's lease is renewed this often while it runs. */
const HEARTBEAT_MS = 60_000;
/** After a turn, events that waited for it go after this pause. */
const AFTER_TURN_MS = 5_000;

export type BotSendOptions = {
  /** What the chat shows for the message: the event's tag, or your own words. */
  displayText: string;
  /** Set for a wake-up: the chat shows a small tag instead of a message. */
  botWake?: { label: string };
  attachments?: Attachment[];
  /** The id the message gets, so its turn is known before it renders. */
  blockId: string;
  onSettled: (outcome: ControlOutcome) => void;
};

export type BotRunnerDeps = {
  /** This window, which alone drives the jobs it claims. */
  owner: string;
  now: () => number;
  setTimer: (run: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  /** The window's loaded chats now. */
  sessions: () => readonly Session[];
  /** Load the bot's chat, or make it, without a tab. */
  ensureChat: (bot: ProjectBot) => Promise<Session | null>;
  /** Send a message into a chat; false when it could not go. */
  send: (sessionId: string, text: string, options: BotSendOptions) => boolean;
  announce: (session: Session, event: SessionActivityEvent) => void;
  copy: {
    prepare: (cwd: string, key: string, branch: string) => Promise<BotCopyInfo>;
    sync: (cwd: string, copy: string, branch: string) => Promise<BotSyncResult>;
    diff: (copy: string, base: string) => Promise<RaceDiff>;
  };
  /** True for the first window to ask about this event (see `scheduled_agent_claim`). */
  claimEvent: (id: string) => Promise<boolean>;
  /** The Claude account's weekly usage, percent, when known. */
  weeklyUsed: (now: number) => number | null;
  /** Files a chat changed that it has not had reviewed. */
  changedFiles: (
    sessionId: string,
    cwd: string,
  ) => Promise<BotChangedFile[] | undefined>;
  scheduledChats: () => ReadonlySet<string>;
  /** The bot's name, from its critter when it has none of its own. */
  name: (bot: ProjectBot) => string;
  /** The chats bots are working in now changed: they stay loaded. */
  onWorking: (ids: ReadonlySet<string>) => void;
  /** Say something in a chat (a message that could not be sent). */
  notice?: (sessionId: string, text: string) => void;
  /** A new message id; random outside tests. */
  newId?: () => string;
  subscribeActivity?: typeof subscribeActivity;
  activity?: () => readonly ActivityEntry[];
  subscribeStops?: typeof subscribeDevServerStops;
};

type Pending = {
  events: BotEvent[];
  firstAt: number;
  timer?: number;
};

type Turn = {
  sessionId: string;
  /** Known for turns this runner sent; read from the message otherwise. */
  wake?: boolean;
  /** The bot chat's message that started it, once known. */
  turnId?: string;
  /** When it went to the bot; unset while Aven prepares it. */
  sentAt?: number;
};

function lastUserBlockId(session: Session | undefined): string | undefined {
  for (let index = (session?.blocks.length ?? 0) - 1; index >= 0; index--) {
    const block = session!.blocks[index];
    if (block.role === "user") return block.id;
  }
  return undefined;
}

function lastReply(session: Session | undefined): string {
  for (let index = (session?.blocks.length ?? 0) - 1; index >= 0; index--) {
    const block = session!.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

/** The chat is working, has messages waiting, or waits on you. */
function chatAtWork(chat: Session): boolean {
  return (
    !!chat.busy ||
    !!chat.queuedMessages?.length ||
    !!chat.pendingQuestion ||
    chat.blocks.some((block) => block.approval && !block.approval.decided)
  );
}

function filesText(diff: Pick<RaceDiff, "files" | "additions" | "deletions">) {
  const count = diff.files.length;
  return `${count} ${count === 1 ? "file" : "files"} · +${diff.additions} −${diff.deletions}`;
}

export class BotRunner {
  private readonly deps: BotRunnerDeps;
  private running = false;
  private unsubscribe: (() => void)[] = [];
  private known = new Set<string>();
  private pending = new Map<string, Pending>();
  /** Jobs this window runs now, by project key. */
  private turns = new Map<string, Turn>();
  private heartbeat: number | undefined;
  /** Each bot chat's busy state when last seen, to catch turns it ran on its own. */
  private seenBusy = new Map<string, boolean>();
  /** Turns already read, by their message's id: each is read once. */
  private handled = new Set<string>();
  private working: ReadonlySet<string> = new Set();

  constructor(deps: BotRunnerDeps) {
    this.deps = deps;
  }

  /** Start listening. Only while some bot is on, so bots that are off cost nothing. */
  start() {
    if (this.running) return;
    this.running = true;
    // Jobs an earlier page left behind died with it.
    for (const bot of activeProjectBots())
      if (bot.job && bot.job.owner !== this.deps.owner)
        updateProjectBot(bot.path, (current) => ({
          ...current,
          job: undefined,
        }));
    const activity = this.deps.activity ?? getActivitySnapshot;
    for (const entry of activity()) this.known.add(entry.id);
    const onActivity = () => this.onActivity();
    this.unsubscribe.push(
      (this.deps.subscribeActivity ?? subscribeActivity)(onActivity),
      (this.deps.subscribeStops ?? subscribeDevServerStops)((stop) =>
        this.onDevServerStop(stop),
      ),
    );
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const pending of this.pending.values())
      if (pending.timer != null) this.deps.clearTimer(pending.timer);
    this.pending.clear();
    if (this.heartbeat != null) this.deps.clearTimer(this.heartbeat);
    this.heartbeat = undefined;
    // Nothing carries over to the next start: jobs end and leases go.
    for (const key of [...this.turns.keys()]) {
      const bot = activeProjectBots().find(
        (item) => projectKey(item.path) === key,
      );
      this.turns.delete(key);
      if (bot) releaseBotJob(bot.path, this.deps.owner);
    }
    this.seenBusy.clear();
    this.updateWorking();
  }

  /** Test seam: events waiting per project key. */
  pendingEvents(key: string): readonly BotEvent[] {
    return this.pending.get(key)?.events ?? [];
  }

  // -------------------------------------------------------------------------
  // Hearing events

  private onActivity() {
    const entries = (this.deps.activity ?? getActivitySnapshot)();
    const listed = new Set(entries.map((entry) => entry.id));
    for (const id of this.known) if (!listed.has(id)) this.known.delete(id);
    const bots = activeProjectBots();
    if (!bots.length) return;
    const now = this.deps.now();
    const context = {
      now,
      botChats: botChatIds(),
      scheduledChats: this.deps.scheduledChats(),
    };
    for (const entry of entries) {
      if (this.known.has(entry.id)) continue;
      this.known.add(entry.id);
      const bot = bots.find((item) => wakesFromActivity(entry, item, context));
      if (bot) void this.chatFinished(bot, entry);
    }
  }

  private async chatFinished(bot: ProjectBot, entry: ActivityEntry) {
    if (!bot.wakes.chatFinished) return;
    if (!(await this.deps.claimEvent(`bot:${entry.id}`))) return;
    const chat = this.deps
      .sessions()
      .find((session) => session.id === entry.sessionId);
    const cwd = chat ? (chat.worktreeCwd ?? chat.cwd) : entry.cwd;
    const files = await this.deps
      .changedFiles(entry.sessionId, cwd)
      .catch(() => undefined);
    this.queue(bot, {
      kind: "chatFinished",
      id: entry.id,
      at: entry.createdAt,
      sessionId: entry.sessionId,
      title: entry.title,
      outcome: entry.outcome === "failed" ? "failed" : "completed",
      ...(files ? { files } : {}),
      ...(chat ? { tests: latestTurnTests(chat.blocks).latest } : {}),
      ...(entry.summary ? { summary: entry.summary } : {}),
    });
  }

  private onDevServerStop(stop: DevServerStop) {
    if (stop.byUser) return;
    const bot = activeProjectBots().find(
      (item) =>
        item.wakes.devServer &&
        isEqualOrInside(stop.project, item.path) &&
        !(item.copy && isEqualOrInside(stop.cwd, item.copy.path)),
    );
    if (!bot) return;
    const id = `${stop.sourceId}:${stop.port}:${stop.at}`;
    void this.deps.claimEvent(`bot:${id}`).then((claimed) => {
      if (!claimed) return;
      this.queue(bot, {
        kind: "devServer",
        id,
        at: stop.at,
        label: stop.label,
        ...(stop.app ? { app: stop.app } : {}),
        output: lastLines(stop.output),
      });
    });
  }

  /**
   * Hold an event for the bot and (re)start its settle timer: a burst wakes
   * it once, never later than `BOT_MAX_WAIT_MS` after the first event.
   */
  queue(bot: Pick<ProjectBot, "path">, event: BotEvent) {
    if (!this.running) return;
    const key = projectKey(bot.path);
    const now = this.deps.now();
    const current = this.pending.get(key);
    const next: Pending = {
      events: coalesceEvents(current?.events ?? [], event),
      firstAt: current?.firstAt ?? now,
    };
    if (current?.timer != null) this.deps.clearTimer(current.timer);
    const wait = Math.max(
      0,
      Math.min(BOT_SETTLE_MS, next.firstAt + BOT_MAX_WAIT_MS - now),
    );
    next.timer = this.deps.setTimer(() => void this.fire(bot.path), wait);
    this.pending.set(key, next);
  }

  private later(path: string, ms: number) {
    const key = projectKey(path);
    const pending = this.pending.get(key);
    if (!pending || !this.running) return;
    if (pending.timer != null) this.deps.clearTimer(pending.timer);
    pending.timer = this.deps.setTimer(() => void this.fire(path), ms);
  }

  // -------------------------------------------------------------------------
  // Waking

  /** The bot's chat is at work, or Aven is already working for it here. */
  private chatBusy(bot: ProjectBot): boolean {
    if (this.turns.has(projectKey(bot.path))) return true;
    const chat = bot.sessionId
      ? this.deps.sessions().find((session) => session.id === bot.sessionId)
      : undefined;
    return !!chat && chatAtWork(chat);
  }

  async fire(path: string) {
    const key = projectKey(path);
    const pending = this.pending.get(key);
    if (!pending || !this.running) return;
    pending.timer = undefined;
    const bot = getProjectBot(path);
    if (!bot?.on) {
      this.pending.delete(key);
      return;
    }
    const now = this.deps.now();
    const decision = botWakeDecision({
      bot,
      kinds: pending.events.map(eventKind),
      now,
      weeklyUsed: this.deps.weeklyUsed(now),
      busy: this.chatBusy(bot),
      owner: this.deps.owner,
    });
    if ("skip" in decision) {
      if (skipKeepsEvents(decision.skip)) {
        // A busy bot hears about it once its turn ends (see `observe`).
        this.later(path, RETRY_MS);
        return;
      }
      this.pending.delete(key);
      if (botSkipText(decision.skip))
        updateProjectBot(path, (current) => ({
          ...current,
          lastSkip: { at: now, reason: decision.skip },
        }));
      return;
    }
    const events = pending.events.filter((event) =>
      decision.kinds.includes(eventKind(event)),
    );
    this.pending.delete(key);
    await this.wake(bot, events);
  }

  /** The bot is still on; anything else stops a job between its steps. */
  private stillOn(path: string): boolean {
    return getProjectBot(path)?.on === true;
  }

  private async wake(bot: ProjectBot, events: BotEvent[]) {
    const key = projectKey(bot.path);
    const now = this.deps.now();
    if (!claimBotJob(bot.path, this.deps.owner, now)) {
      for (const event of events) this.queue(bot, event);
      return;
    }
    const label = wakeLabel(events);
    const turn: Turn = { sessionId: bot.sessionId ?? "", wake: true };
    this.beginTurn(key, turn);
    updateProjectBot(bot.path, (current) => ({
      ...current,
      lastWake: { at: now, label },
      lastSkip: undefined,
    }));
    try {
      const chat = await this.deps.ensureChat(bot);
      if (!chat) throw new Error("Couldn't open the bot's chat.");
      if (!this.stillOn(bot.path)) return this.endTurn(bot.path, turn);
      turn.sessionId = chat.id;
      this.updateWorking();
      const ready = await this.prepare(bot.path, chat.id);
      if (!ready || !this.stillOn(bot.path))
        return this.endTurn(bot.path, turn);
      if (this.chatAtWorkNow(chat.id)) {
        // You messaged it meanwhile: the events wait for that turn.
        this.endTurn(bot.path, turn);
        for (const event of events) this.queue(bot, event);
        return;
      }
      const text = buildWakeMessage({
        events,
        sync: ready.sync,
        canFix: ready.bot.can.fix,
        brief: this.briefFor(ready.bot, chat.id),
      });
      turn.turnId = this.newId();
      const sent = this.deps.send(chat.id, text, {
        displayText: label,
        botWake: { label },
        blockId: turn.turnId,
        onSettled: (outcome) => void this.afterTurn(bot.path, turn, outcome),
      });
      if (!sent) throw new Error("Couldn't send the bot its wake-up.");
      turn.sentAt = this.deps.now();
      // Only a wake-up that went counts toward the day's runs.
      updateProjectBot(bot.path, (current) =>
        withRunCounted(current, this.deps.now()),
      );
    } catch (error) {
      logError("Project bot", error);
      updateProjectBot(bot.path, (current) => ({
        ...current,
        lastError: { at: this.deps.now(), text: errorText(error) },
      }));
      this.endTurn(bot.path, turn);
    }
  }

  private newId(): string {
    return this.deps.newId?.() ?? crypto.randomUUID();
  }

  private chatNow(sessionId: string): Session | undefined {
    return this.deps.sessions().find((session) => session.id === sessionId);
  }

  private chatAtWorkNow(sessionId: string): boolean {
    const chat = this.chatNow(sessionId);
    return !!chat && chatAtWork(chat);
  }

  /**
   * Make sure the copy exists and, unless a fix waits there, match it to the
   * user's files. Changes no one has read yet (a turn whose end was missed,
   * or one sent from another window) become a fix first: a sync never wipes
   * them. Returns the bot as saved and what to tell it.
   */
  private async prepare(
    path: string,
    chatId: string,
  ): Promise<{ bot: ProjectBot; sync: BotSyncNote | null } | null> {
    let bot = getProjectBot(path);
    if (!bot?.on) return null;
    const branch = bot.copy?.branch;
    if (!branch) return null;
    try {
      const copy = await this.deps.copy.prepare(path, projectKey(path), branch);
      if (!this.stillOn(path)) return null;
      if (copy.path !== bot.copy?.path)
        bot = updateProjectBot(path, (current) => ({ ...current, copy }));
    } catch (error) {
      const text = botCopyError(error);
      updateProjectBot(path, (current) => ({
        ...current,
        lastError: { at: this.deps.now(), text },
      }));
      return null;
    }
    if (pendingFix(bot)) return { bot, sync: { kind: "fix-waiting" } };
    if (bot.base) {
      const unread = await this.deps.copy
        .diff(bot.copy!.path, bot.base)
        .catch(() => null);
      if (!this.stillOn(path)) return null;
      const applied = bot.fixes?.at(-1);
      if (
        unread?.files.length &&
        !(applied?.state === "applied" && fixMatches(applied, unread))
      ) {
        const base = bot.base;
        bot = updateProjectBot(path, (current) =>
          withReadyFix(current, {
            base,
            turnId:
              lastUserBlockId(this.chatNow(chatId)) ??
              `unread-${this.deps.now()}`,
            files: unread.files.length,
            additions: unread.additions,
            deletions: unread.deletions,
            paths: unread.files.map((file) => file.path),
            at: this.deps.now(),
          }),
        );
        return { bot, sync: { kind: "fix-waiting" } };
      }
    }
    try {
      const synced = await this.deps.copy.sync(
        path,
        bot.copy!.path,
        bot.copy!.branch,
      );
      if (!this.stillOn(path)) return null;
      bot = updateProjectBot(path, (current) => ({
        ...current,
        base: synced.base,
      }));
      return {
        bot,
        sync: {
          kind: "synced",
          base: synced.base,
          uncommitted: synced.uncommitted,
          untracked: synced.untracked,
        },
      };
    } catch (error) {
      logError("Project bot sync", error);
      return { bot, sync: { kind: "failed", error: botCopyError(error) } };
    }
  }

  /** Its role, on the first message of a conversation with the provider. */
  private briefFor(bot: ProjectBot, chatId: string): string | undefined {
    if (this.chatNow(chatId)?.providerSessionId) return undefined;
    return botBrief({
      name: this.deps.name(bot),
      project: bot.path,
      copyPath: bot.copy?.path ?? "",
      can: bot.can,
    });
  }

  /**
   * You messaged the bot. Unless a fix is waiting, its copy is synced to
   * your files first. Returns false when the message is not the bot's to
   * handle (the caller sends it as usual: queued behind a turn, say).
   */
  message(sessionId: string, text: string, attachments: Attachment[]): boolean {
    const bot = botForChat(sessionId);
    if (!bot?.copy || !this.running) return false;
    if (this.chatBusy(bot)) return false;
    const key = projectKey(bot.path);
    const claimed = claimBotJob(bot.path, this.deps.owner, this.deps.now());
    const turn: Turn = { sessionId, wake: false };
    this.beginTurn(key, turn);
    const lost = () =>
      this.deps.notice?.(
        sessionId,
        `Your message didn't reach the bot: “${text.slice(0, 300)}”`,
      );
    void (async () => {
      const ready = claimed ? await this.prepare(bot.path, sessionId) : null;
      const chat = this.chatNow(sessionId);
      if (!chat) {
        this.endTurn(bot.path, turn);
        lost();
        return;
      }
      const message = this.stillOn(bot.path)
        ? buildDirectMessage({
            text,
            sync: ready?.sync ?? null,
            brief: this.briefFor(ready?.bot ?? bot, sessionId),
          })
        : text;
      if (chatAtWork(chat) || !this.stillOn(bot.path)) {
        // A turn started while the copy synced, or the bot was turned off:
        // this goes as usual, and a bot's turn is read when it ends (see
        // `observe`).
        this.endTurn(bot.path, turn);
        if (
          !this.deps.send(sessionId, message, {
            displayText: text,
            attachments,
            blockId: this.newId(),
            onSettled: () => undefined,
          })
        )
          lost();
        return;
      }
      turn.turnId = this.newId();
      const sent = this.deps.send(sessionId, message, {
        displayText: text,
        attachments,
        blockId: turn.turnId,
        onSettled: (outcome) => void this.afterTurn(bot.path, turn, outcome),
      });
      if (!sent) {
        this.endTurn(bot.path, turn);
        lost();
        return;
      }
      turn.sentAt = this.deps.now();
    })().catch((error) => {
      logError("Project bot", error);
      this.endTurn(bot.path, turn);
      lost();
    });
    return true;
  }

  private beginTurn(key: string, turn: Turn) {
    this.turns.set(key, turn);
    this.updateWorking();
    if (this.heartbeat == null)
      this.heartbeat = this.deps.setTimer(() => this.beat(), HEARTBEAT_MS);
  }

  private beat() {
    this.heartbeat = undefined;
    if (!this.turns.size) return;
    const now = this.deps.now();
    for (const bot of activeProjectBots()) {
      const turn = this.turns.get(projectKey(bot.path));
      if (!turn) continue;
      renewBotJob(bot.path, this.deps.owner, now);
      // A turn whose end never reported (it was cancelled, say) is read once
      // its chat has been idle a while, so the bot is never stuck working.
      if (
        turn.sentAt != null &&
        now - turn.sentAt > 2 * HEARTBEAT_MS &&
        !this.chatAtWorkNow(turn.sessionId)
      )
        void this.afterTurn(bot.path, turn);
    }
    if (this.turns.size)
      this.heartbeat = this.deps.setTimer(() => this.beat(), HEARTBEAT_MS);
  }

  /** End `turn` for the bot: never a newer one that has started since. */
  private endTurn(path: string, turn: Turn) {
    const key = projectKey(path);
    if (this.turns.get(key) !== turn) return;
    this.turns.delete(key);
    releaseBotJob(path, this.deps.owner);
    this.updateWorking();
    if (!this.turns.size && this.heartbeat != null) {
      this.deps.clearTimer(this.heartbeat);
      this.heartbeat = undefined;
    }
    if (this.pending.has(key)) this.later(path, AFTER_TURN_MS);
  }

  private updateWorking() {
    const ids = new Set(
      [...this.turns.values()].map((turn) => turn.sessionId).filter(Boolean),
    );
    if (
      ids.size === this.working.size &&
      [...ids].every((id) => this.working.has(id))
    )
      return;
    this.working = ids;
    this.deps.onWorking(ids);
  }

  // -------------------------------------------------------------------------
  // After a turn

  /**
   * The bot's turn ended: read what it changed in its copy. Changes become
   * (or grow) the waiting fix, with one Activity entry; a wake-up with
   * nothing to report posts nothing and counts as nothing unread. Each turn
   * is read once, whichever of its end report, the chat going idle or the
   * heartbeat comes first.
   */
  async afterTurn(path: string, turn: Turn, outcome?: ControlOutcome) {
    try {
      const bot = getProjectBot(path);
      if (!bot?.on) return;
      const chat = this.chatNow(turn.sessionId || bot.sessionId || "");
      const turnId = turn.turnId ?? lastUserBlockId(chat);
      if (!turnId || !this.markHandled(turnId)) return;
      // Its last message: earlier ones in the turn are its working notes.
      const reply = lastReply(chat) || outcome?.text.trim() || "";
      const now = this.deps.now();
      let diff: RaceDiff | null = null;
      if (bot.copy && bot.base)
        diff = await this.deps.copy
          .diff(bot.copy.path, bot.base)
          .catch((error) => {
            logError("Project bot diff", error);
            return null;
          });
      if (!this.stillOn(path)) return;
      const waiting = pendingFix(bot);
      // A fix you applied while it worked is still in its copy until the
      // next sync: those same changes are not a new fix.
      const applied = bot.fixes?.at(-1);
      const alreadyApplied =
        !waiting &&
        applied?.state === "applied" &&
        !!diff &&
        fixMatches(applied, diff);
      const changed = !!diff?.files.length && !alreadyApplied;
      const wake =
        turn.wake ??
        !!chat?.blocks.find((block) => block.id === turnId)?.botWake;
      const quiet = wake && !changed && isNothingToReport(reply);
      const headline = replyHeadline(reply);
      const failed = outcome?.status === "failed";
      let fixed = false;
      updateProjectBot(path, (current) => {
        let next = current;
        if (diff && changed && current.base) {
          const grew =
            !waiting ||
            waiting.files !== diff.files.length ||
            waiting.additions !== diff.additions ||
            waiting.deletions !== diff.deletions;
          fixed = grew;
          next = withReadyFix(next, {
            base: current.base,
            turnId,
            files: diff.files.length,
            additions: diff.additions,
            deletions: diff.deletions,
            paths: diff.files.map((file) => file.path),
            at: now,
            ...(headline ? { summary: headline } : {}),
          });
        } else if (diff && !changed && waiting)
          // The bot undid its own fix: nothing waits any more.
          next = resolveFix(next, waiting.id, "gone", now);
        const post = fixed
          ? { at: now, text: `Fix ready · ${filesText(diff!)}` }
          : quiet
            ? { at: now, text: "Checked · nothing to report", quiet: true }
            : headline
              ? { at: now, text: headline }
              : current.lastPost;
        return {
          ...next,
          ...(post ? { lastPost: post } : {}),
          ...(failed
            ? {
                lastError: {
                  at: now,
                  text: outcome?.error || "Its last check didn't finish.",
                },
              }
            : { lastError: undefined }),
        };
      });
      if (!chat || quiet || outcome?.status === "cancelled") return;
      const turnKey = `${chat.id}:bot:${turnId}`;
      if (fixed && diff)
        this.deps.announce(chat, {
          id: `${turnKey}:fix:${diff.files.length}:${diff.additions}:${diff.deletions}`,
          outcome: "completed",
          summary: `Fix ready · ${filesText(diff)}${headline ? ` · ${headline}` : ""}`,
        });
      else if (!failed && headline)
        this.deps.announce(chat, {
          id: `${turnKey}:said`,
          outcome: "completed",
          summary: headline,
        });
    } catch (error) {
      logError("Project bot", error);
    } finally {
      this.endTurn(path, turn);
    }
  }

  /** True the first time a turn is read. */
  private markHandled(turnId: string): boolean {
    if (this.handled.has(turnId)) return false;
    this.handled.add(turnId);
    for (const oldest of this.handled) {
      if (this.handled.size <= 200) break;
      this.handled.delete(oldest);
    }
    return true;
  }

  /**
   * Watch the bots' chats: a turn this runner did not send (a queued
   * message, a steer that ran on) is read the same way when it ends.
   */
  observe(sessions: readonly Session[]) {
    if (!this.running) return;
    for (const bot of activeProjectBots()) {
      if (!bot.sessionId) continue;
      const chat = sessions.find((session) => session.id === bot.sessionId);
      if (!chat) {
        this.seenBusy.delete(bot.sessionId);
        continue;
      }
      const was = this.seenBusy.get(chat.id) ?? false;
      const busy = !!chat.busy;
      this.seenBusy.set(chat.id, busy);
      const key = projectKey(bot.path);
      const turnId = lastUserBlockId(chat);
      if (
        was &&
        !busy &&
        !this.turns.has(key) &&
        turnId &&
        !this.handled.has(turnId)
      ) {
        const turn: Turn = { sessionId: chat.id, turnId };
        this.beginTurn(key, turn);
        void this.afterTurn(bot.path, turn);
      } else if (was && !busy && this.pending.has(key))
        this.later(bot.path, AFTER_TURN_MS);
    }
  }
}
