import { parseHandoff, parseIdeas, parseVerdict } from "./crewHandoff";
import { crewInboxCard, withInboxResolved } from "./crewInbox";
import {
  crewGate,
  crewNoMemberGate,
  ideaMayAutoStart,
  ideasLeft,
  nextAutoStart,
  nextCardToStart,
  scoutShouldLook,
  securitySweepDue,
  type CrewGate,
} from "./crewLimits";
import {
  afterBuild,
  afterCheck,
  afterSecurity,
  cardScope,
  earlierFindings,
  earlierSecurityFindings,
  reviewMoved,
  roundLimit,
  withBuilderScope,
  queueCard,
  startCard,
  turnFailed,
  turnTimedOut,
  withScopeCheck,
  type LoopStep,
} from "./crewLoop";
import {
  builderMessage,
  checkerMessage,
  crewBrief,
  crewTurnLabel,
  scoutMessage,
  securityMessage,
  sweepMessage,
  SWEEP_CARDS,
} from "./crewPrompts";
import {
  activeCrews,
  bumpToday,
  cardBuilder,
  cardChecker,
  cardInCopy,
  cardSecurity,
  claimCrewJob,
  crewCard,
  crewMember,
  crewMemberApp,
  crewMemberById,
  crewsAllRunsPerDay,
  outsideScope,
  crewRunsToday,
  crewsSnapshot,
  getCrew,
  migrateBotsIntoCrews,
  releaseCrewJob,
  renewCrewJob,
  subscribeCrews,
  updateCrew,
  withCard,
  withCrewRun,
  withFeed,
  withIdea,
  withMemberId,
  withCheckerOnClaude,
  withoutFallbacks,
  type Crew,
  type CrewCard,
  type CrewChange,
  type CrewFeedEntry,
  type CrewLoopRole,
  type CrewRole,
} from "./crews";
import { errorText, logError } from "./errors";
import type {
  FeatureCard,
  FeatureCardDraft,
  FeatureColumn,
} from "./featureCards";
import type { ControlOutcome } from "./orchestration";
import { projectKey } from "./paths";
import type { BotCopyInfo, BotDiff, BotSyncResult } from "./projectBotCopy";
import { botCopyError } from "./projectBotCopy";
import type { BotSendOptions } from "./projectBotRunner";
import { botBranch, jobIsLive } from "./projectBots";
import { isCodexToolsOpen } from "./harness/codexLockdown";
import type { BotSyncNote } from "./projectBotWake";
import { replyHeadline } from "./projectBotWake";
import type { Session } from "./session";

/**
 * Drives the crews of one window (the main one), the way Discuss passes
 * replies between two chats: Aven hands a card to the Builder, reads its
 * handoff note when its turn ends, hands the work to the Checker, reads the
 * verdict, and sends the card back or ends it (see `crewLoop`). The bots
 * never message each other, and never wake for each other.
 *
 * Nothing runs while a crew is idle and nothing new is waiting: a quiet
 * check every so often decides, for free, whether a card, a Scout idea or
 * the Scout itself may go now (see `crewLimits`). Everything outside the
 * store (the chats, sending, the copy, the Board) comes in as `deps`, so the
 * loop can be tested with stand-in agents.
 */

/** How often idle crews are looked at. */
const TICK_MS = 30_000;
/** A running turn's lease is renewed this often. */
const HEARTBEAT_MS = 60_000;
/** After a turn ends, the next step goes after this pause. */
const AFTER_TURN_MS = 3_000;
/** A turn whose end never reported is read once its chat has been idle this long. */
const IDLE_READ_MS = 2 * 60_000;
/** After stopping a turn that ran too long, wait this long for its end. */
const STOP_GRACE_MS = 10_000;

export type CrewChatRole = Exclude<CrewRole, "fixer">;

export type CrewRunnerDeps = {
  /** This window, which alone drives the turns it claims. */
  owner: string;
  now: () => number;
  setTimer: (run: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
  /** The window's loaded chats now. */
  sessions: () => readonly Session[];
  /**
   * Load the member's chat, or make it, without a tab, in the crew's copy,
   * on the member's app with its model and effort (or the card's, for a
   * Builder's turn on a card you gave its own).
   */
  ensureChat: (
    crew: Crew,
    memberId: string,
    override?: { model?: string; effort?: string },
  ) => Promise<Session | null>;
  /** Send a message into a chat; false when it could not go. */
  send: (sessionId: string, text: string, options: BotSendOptions) => boolean;
  /** Stop a chat's turn. */
  stopChat: (sessionId: string) => void;
  copy: {
    prepare: (cwd: string, key: string, branch: string) => Promise<BotCopyInfo>;
    sync: (cwd: string, copy: string, branch: string) => Promise<BotSyncResult>;
    diff: (copy: string, base: string) => Promise<BotDiff>;
    /** The copy's own files: its top-level entries Git doesn't ignore. */
    sources: (copy: string) => Promise<string[]>;
    /**
     * Settings files an agent left in the copy that an app would run as
     * the user; with `remove`, removed. Checked before every turn.
     */
    planted: (copy: string, remove: boolean) => Promise<string[]>;
  };
  /** The Claude week's use, percent, when known. */
  weeklyUsed: (now: number) => number | null;
  /** The Fixer's runs today: the project bot's own count. */
  fixerRuns: (path: string, now: number) => number;
  /** The project bot's branch, so the crew's copy never takes it. */
  fixerBranch: (path: string) => string | undefined;
  board: {
    cards: (project: string) => Promise<readonly FeatureCard[]>;
    move: (project: string, cardId: string, column: FeatureColumn) => unknown;
    add: (
      project: string,
      drafts: readonly FeatureCardDraft[],
    ) => Promise<readonly FeatureCard[]>;
  };
  /** A member's name (by its id, or a role for its first): its own, or its critter's. */
  name: (crew: Crew, who: string) => string;
  /** The chats crews are working in changed: they stay loaded. */
  onWorking: (ids: ReadonlySet<string>) => void;
  /**
   * Start the chat's agent on a new conversation at its next turn (the chat
   * and its history stay): each card gets the Builder and the Checker fresh,
   * so a check is never coloured by an earlier card and no context piles up.
   */
  freshConversation?: (sessionId: string) => void;
  /**
   * The Claude model a Checker falls back to when Codex can't be locked
   * down here: a different one from the Builder's.
   */
  checkerFallbackModel?: (crew: Crew) => string | undefined;
  /**
   * Where a prepared turn may wait before its last look and send (Aven Dev's
   * real-app check holds one there while it turns the crew off).
   */
  beforeSend?: (sessionId: string) => Promise<void>;
  newId?: () => string;
};

/**
 * Whether this page has started a runner yet: a Checker's fallback to
 * Claude lasts for the session it was decided in, and the next session
 * gives Codex a try again.
 */
let sessionStarted = false;

/** Test seam: the next runner start is a new session. */
export function resetCrewRunnerSession() {
  sessionStarted = false;
}

type LiveTurn = {
  role: CrewChatRole;
  /** The member taking it. */
  memberId: string;
  /** Security's sweep of the whole project, not a card's review. */
  sweep?: boolean;
  /** The card it works on; none for the Scout. */
  cardId?: string;
  sessionId: string;
  turnId: string;
  /** When it went to the bot; unset while Aven prepares it. */
  sentAt?: number;
  /** The turn ran past the crew's turn limit and Aven stopped it. */
  timedOut?: boolean;
  timer?: number;
  /** The crew's `onAt` when the turn began: off and on again ends it. */
  onAt?: number;
  /** Aven asked its chat to stop (the card was stopped, the crew turned off). */
  stopping?: boolean;
};

/** Where a card stood when Aven began preparing its turn. */
type CardAt = {
  stage: CrewCard["stage"];
  round: number;
  holder?: CrewLoopRole;
};

function cardAt(card: CrewCard): CardAt {
  return {
    stage: card.stage,
    round: card.round,
    ...(card.holder ? { holder: card.holder } : {}),
  };
}

/** The stored card is still exactly where a turn found it, with no turn of its own. */
function cardStillAt(card: CrewCard | undefined, at: CardAt): boolean {
  return (
    !!card &&
    card.stage === at.stage &&
    card.round === at.round &&
    card.holder === at.holder &&
    !card.turn &&
    !card.paused
  );
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

/** The chat waits on you: a question or an approval. */
function chatNeedsYou(chat: Session): string | null {
  if (chat.pendingQuestion) return "a question";
  if (chat.blocks.some((block) => block.approval && !block.approval.decided))
    return "an approval";
  return null;
}

/** The bot's last message in the turn that `turnId` started. */
export function replyForTurn(
  session: Session | undefined,
  turnId: string,
): string {
  if (!session) return "";
  const start = session.blocks.findIndex((block) => block.id === turnId);
  if (start < 0) return "";
  let reply = "";
  for (let index = start + 1; index < session.blocks.length; index += 1) {
    const block = session.blocks[index];
    if (block.role === "user") break;
    if (block.role === "assistant" && block.text.trim()) reply = block.text;
  }
  return reply;
}

function changeFrom(diff: BotDiff | null, base: string): CrewChange | null {
  if (!diff?.files.length) return null;
  return {
    base,
    hash: diff.hash,
    files: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
    paths: diff.files.slice(0, 40).map((file) => ({
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
    })),
  };
}

/** The copy's key: beside the project bot's, never the same folder. */
export function crewCopyKey(path: string): string {
  return `${projectKey(path)}#crew`;
}

/** The crew's branch, never the project bot's. */
export function crewBranch(path: string, fixerBranch?: string): string {
  const branch = botBranch("crew", path);
  return branch === fixerBranch ? botBranch("crew-builds", path) : branch;
}

export class CrewRunner {
  private readonly deps: CrewRunnerDeps;
  private running = false;
  private unsubscribe: (() => void)[] = [];
  private tick: number | undefined;
  private soon: number | undefined;
  private heartbeat: number | undefined;
  private pumping = false;
  private pumpAgain = false;
  /** Turns this window runs now, by project key. */
  private turns = new Map<string, LiveTurn>();
  /** Turns already read, by their message's id: each is read once. */
  private handled = new Set<string>();
  private working: ReadonlySet<string> = new Set();

  constructor(deps: CrewRunnerDeps) {
    this.deps = deps;
  }

  /** Start: only while some crew is on, so crews that are off cost nothing. */
  start() {
    if (this.running) return;
    this.running = true;
    migrateBotsIntoCrews();
    if (!sessionStarted) {
      sessionStarted = true;
      for (const crew of activeCrews())
        if (crew.members.some((member) => member.fallback))
          updateCrew(crew.path, withoutFallbacks);
    }
    // Turns an earlier page left behind died with it.
    for (const crew of activeCrews())
      if (crew.job && crew.job.owner !== this.deps.owner)
        updateCrew(crew.path, (current) => ({ ...current, job: undefined }));
    this.unsubscribe.push(
      subscribeCrews(() => {
        this.watchTurns();
        this.schedule();
      }),
    );
    this.tick = this.deps.setTimer(() => this.onTick(), TICK_MS);
    this.schedule();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const id of [this.tick, this.soon, this.heartbeat])
      if (id != null) this.deps.clearTimer(id);
    this.tick = this.soon = this.heartbeat = undefined;
    for (const [key, turn] of [...this.turns]) {
      if (turn.timer != null) this.deps.clearTimer(turn.timer);
      // No turn outlives the runner that keeps its limits.
      if (turn.sentAt != null && !this.handled.has(turn.turnId))
        this.deps.stopChat(turn.sessionId);
      this.turns.delete(key);
      const crew = activeCrews().find((item) => projectKey(item.path) === key);
      if (crew) releaseCrewJob(crew.path, this.deps.owner);
    }
    this.updateWorking();
  }

  /**
   * The store changed (in any window): a turn whose card was stopped, thrown
   * away or picked up again, or whose crew turned off, stops now. Only this
   * window holds the turn's process, so only it can stop it.
   */
  private watchTurns() {
    if (!this.running) return;
    const crews = crewsSnapshot();
    for (const [key, turn] of this.turns) {
      if (turn.sentAt == null || turn.stopping) continue;
      if (this.handled.has(turn.turnId)) continue;
      const crew = crews[key];
      const card =
        crew && turn.cardId ? crewCard(crew, turn.cardId) : undefined;
      const gone =
        !crew?.on ||
        (turn.onAt !== undefined && crew.onAt !== turn.onAt) ||
        (!!turn.cardId && card?.turn?.turnId !== turn.turnId);
      if (!gone) continue;
      turn.stopping = true;
      this.deps.stopChat(turn.sessionId);
    }
  }

  private onTick() {
    this.tick = undefined;
    if (!this.running) return;
    this.schedule();
    this.tick = this.deps.setTimer(() => this.onTick(), TICK_MS);
  }

  /** Look at every crew soon (once, however many changes asked). */
  schedule(ms = 0) {
    if (!this.running || this.soon != null) return;
    this.soon = this.deps.setTimer(() => {
      this.soon = undefined;
      void this.pump();
    }, ms);
  }

  /** Test seam: the turn running for a project, if any. */
  liveTurn(path: string): Readonly<LiveTurn> | undefined {
    return this.turns.get(projectKey(path));
  }

  /** Look at each crew that is on and take its next step, if any may go. */
  async pump() {
    if (!this.running) return;
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.pumpAgain = false;
        for (const crew of activeCrews()) await this.step(crew.path);
      } while (this.pumpAgain && this.running);
    } finally {
      this.pumping = false;
    }
  }

  private gate(crew: Crew, now: number): CrewGate {
    // Every crew's runs today, Fixers included, for the ceiling.
    const allRuns = activeCrews().reduce(
      (sum, item) =>
        sum + crewRunsToday(item, now) + this.deps.fixerRuns(item.path, now),
      0,
    );
    return crewGate({
      crew,
      now,
      weeklyUsed: this.deps.weeklyUsed(now),
      fixerRuns: this.deps.fixerRuns(crew.path, now),
      allRuns,
      allRunsCap: crewsAllRunsPerDay(),
    });
  }

  /** A limit holds the crew: say why once, in its feed. */
  private hold(crew: Crew, gate: Exclude<CrewGate, { ok: true }>) {
    if (crew.hold?.reason === gate.reason) return;
    const now = this.deps.now();
    updateCrew(crew.path, (current) => {
      const held = { ...current, hold: { reason: gate.reason, at: now } };
      return gate.reason === "paused"
        ? held
        : withFeed(held, {
            at: now,
            kind: "hold",
            who: "aven",
            text: `${gate.title}. ${gate.detail}`,
          });
    });
  }

  private clearHold(crew: Crew) {
    if (!crew.hold) return;
    updateCrew(crew.path, (current) =>
      current.hold ? { ...current, hold: undefined } : current,
    );
  }

  /** The crew is still on, and the same switch-on as when `onAt` was read. */
  private stillOn(path: string, onAt: number | undefined): boolean {
    const crew = getCrew(path);
    return crew?.on === true && (onAt === undefined || crew.onAt === onAt);
  }

  private async step(path: string) {
    const crew = getCrew(path);
    if (!crew?.on) return;
    const key = projectKey(path);
    if (this.turns.has(key)) return;
    const now = this.deps.now();
    if (jobIsLive(crew.job, now) && crew.job?.owner !== this.deps.owner) return;
    const inCopy = cardInCopy(crew);
    if (inCopy) {
      if (
        (inCopy.stage !== "building" && inCopy.stage !== "checking") ||
        inCopy.paused
      )
        return this.clearHold(crew);
      // A turn sent before (by an earlier page, say) whose end was never read.
      if (inCopy.turn) return this.recover(crew, inCopy);
      const role = inCopy.holder ?? "builder";
      const member =
        role === "builder"
          ? cardBuilder(crew, inCopy)
          : role === "security"
            ? cardSecurity(crew)
            : cardChecker(crew, inCopy);
      // Every Builder (or Checker) is off or gone: the card waits, and says why.
      if (!member) return this.hold(crew, crewNoMemberGate(role));
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendCardTurn(path, inCopy.id, role, member.id);
    }
    const next = nextCardToStart(crew);
    if (next) {
      const builder = cardBuilder(crew, crewCard(crew, next)!);
      if (!builder) return this.hold(crew, crewNoMemberGate("builder"));
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendCardTurn(path, next, "builder", builder.id);
    }
    // Idle. A Scout idea may start by itself, or the Scout may look. The
    // Board is read only when one of them could go.
    const startable = Object.values(crew.ideas ?? {}).some(ideaMayAutoStart);
    const scoutDue = scoutShouldLook(crew, now, false);
    const sweepDue = securitySweepDue(crew, now);
    if (!startable && !scoutDue && !sweepDue) return this.clearHold(crew);
    let cards: readonly FeatureCard[] = [];
    try {
      cards = await this.deps.board.cards(path);
    } catch (error) {
      logError("Crew board", error);
      return;
    }
    const inIdeas = (id: string) =>
      cards.some((card) => card.id === id && card.column === "idea");
    const auto = nextAutoStart(crew, now, inIdeas);
    if (auto) {
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      return this.autoStart(
        path,
        cards.find((card) => card.id === auto)!,
      );
    }
    if (scoutShouldLook(crew, now, false)) {
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendScoutTurn(path, cards);
    }
    if (securitySweepDue(crew, now)) {
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendScoutTurn(path, cards, "security");
    }
    this.clearHold(crew);
  }

  /** A small Scout idea starts by itself: queued, counted, and said in the feed. */
  private async autoStart(path: string, card: FeatureCard) {
    const now = this.deps.now();
    updateCrew(path, (crew) => {
      const idea = crew.ideas?.[card.id];
      if (!idea) return crew;
      let next = withCard(
        crew,
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: [card.title, card.note].filter(Boolean).join("\n\n"),
            from: "scout",
            size: idea.size,
            maxRounds: crew.limits.roundsPerCard,
          },
          now,
        ),
      );
      next = withIdea(next, card.id, { ...idea, autoStarted: true });
      next = {
        ...next,
        autoStarts: bumpToday(next.autoStarts, now),
      };
      return withFeed(next, {
        at: now,
        kind: "start",
        who: "aven",
        cardId: card.id,
        title: card.title,
        text: `Started ${this.deps.name(crew, "scout")}'s idea “${card.title}” by itself (small)`,
      });
    });
    await Promise.resolve(this.deps.board.move(path, card.id, "building"));
    this.schedule();
  }

  /** The names of a card's Builder and Checker: who it was given to, or the rules' pick. */
  private names(
    crew: Crew,
    card?: CrewCard,
    taking?: { role: CrewLoopRole; memberId: string },
  ) {
    const builder =
      (taking?.role === "builder" ? taking.memberId : undefined) ??
      (card?.builderId && crewMemberById(crew, card.builderId)
        ? card.builderId
        : card
          ? cardBuilder(crew, card)?.id
          : undefined) ??
      "builder";
    const checker =
      (taking?.role === "checker" ? taking.memberId : undefined) ??
      (card?.checkerId && crewMemberById(crew, card.checkerId)
        ? card.checkerId
        : card
          ? cardChecker(crew, card)?.id
          : undefined) ??
      "checker";
    const security =
      (taking?.role === "security" ? taking.memberId : undefined) ??
      cardSecurity(crew)?.id ??
      "security";
    return {
      builder: this.deps.name(crew, builder),
      checker: this.deps.name(crew, checker),
      security: this.deps.name(crew, security),
    };
  }

  private newId(): string {
    return this.deps.newId?.() ?? crypto.randomUUID();
  }

  private chatNow(sessionId: string): Session | undefined {
    return this.deps.sessions().find((session) => session.id === sessionId);
  }

  /**
   * Make sure the crew's copy exists (beside the Fixer's, never the same),
   * note which of its files a read-only turn may not write, and, for a new
   * card or the Scout, match it to your files.
   */
  private async prepareCopy(
    path: string,
    sync: boolean,
  ): Promise<{ crew: Crew; sync: BotSyncNote | null; base?: string } | null> {
    const crew = getCrew(path);
    if (!crew?.on) return null;
    const branch =
      crew.copy?.branch ?? crewBranch(path, this.deps.fixerBranch(path));
    let copy: BotCopyInfo;
    try {
      copy = await this.deps.copy.prepare(path, crewCopyKey(path), branch);
    } catch (error) {
      throw new Error(`Couldn't make the crew's copy: ${botCopyError(error)}`);
    }
    const sources = await this.deps.copy
      .sources(copy.path)
      .catch(() => crew.copy?.sources);
    let saved = updateCrew(path, (current) => ({
      ...current,
      copy: {
        path: copy.path,
        branch: copy.branch,
        root: copy.root,
        gitDir: copy.gitDir,
        ...(sources ? { sources } : {}),
      },
      lastError: undefined,
    }));
    if (!sync) return { crew: saved, sync: null };
    try {
      const synced = await this.deps.copy.sync(path, copy.path, copy.branch);
      if (synced.planted?.length) this.notePlanted(path, synced.planted);
      saved = getCrew(path) ?? saved;
      return {
        crew: saved,
        base: synced.base,
        sync: {
          kind: "synced",
          base: synced.base,
          uncommitted: synced.uncommitted,
          untracked: synced.untracked,
        },
      };
    } catch (error) {
      logError("Crew copy sync", error);
      throw new Error(
        `Couldn't update the crew's copy: ${botCopyError(error)}`,
      );
    }
  }

  /** Settings an agent left in the copy were removed: the feed says so. */
  private notePlanted(path: string, files: readonly string[]) {
    const now = this.deps.now();
    updateCrew(path, (crew) =>
      withFeed(crew, {
        at: now,
        kind: "hold",
        who: "aven",
        text: `Aven removed ${files.join(", ")} from the crew's copy: settings there could run commands as you.`,
      }),
    );
  }

  private beginTurn(key: string, turn: LiveTurn) {
    this.turns.set(key, turn);
    this.updateWorking();
    if (this.heartbeat == null)
      this.heartbeat = this.deps.setTimer(() => this.beat(), HEARTBEAT_MS);
  }

  private endTurn(path: string, turn: LiveTurn) {
    const key = projectKey(path);
    if (turn.timer != null) this.deps.clearTimer(turn.timer);
    turn.timer = undefined;
    if (this.turns.get(key) !== turn) return;
    this.turns.delete(key);
    releaseCrewJob(path, this.deps.owner);
    this.updateWorking();
    if (!this.turns.size && this.heartbeat != null) {
      this.deps.clearTimer(this.heartbeat);
      this.heartbeat = undefined;
    }
    this.schedule(AFTER_TURN_MS);
  }

  private beat() {
    this.heartbeat = undefined;
    if (!this.turns.size) return;
    const now = this.deps.now();
    for (const crew of activeCrews()) {
      const turn = this.turns.get(projectKey(crew.path));
      if (!turn) continue;
      renewCrewJob(crew.path, this.deps.owner, now);
      // A turn whose end never reported is read once its chat is idle.
      const chat = turn.sessionId ? this.chatNow(turn.sessionId) : undefined;
      if (
        turn.sentAt != null &&
        now - turn.sentAt > IDLE_READ_MS &&
        chat &&
        !chatAtWork(chat)
      )
        void this.afterTurn(crew.path, turn);
    }
    if (this.turns.size)
      this.heartbeat = this.deps.setTimer(() => this.beat(), HEARTBEAT_MS);
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

  /** A turn past the crew's limit is stopped, and its card waits on you. */
  private armTimeout(path: string, turn: LiveTurn, minutes: number) {
    turn.timer = this.deps.setTimer(() => {
      turn.timer = undefined;
      if (this.handled.has(turn.turnId)) return;
      turn.timedOut = true;
      this.deps.stopChat(turn.sessionId);
      // Its end usually reports at once; if not, read it anyway.
      turn.timer = this.deps.setTimer(
        () => void this.afterTurn(path, turn),
        STOP_GRACE_MS,
      );
    }, minutes * 60_000);
  }

  // -------------------------------------------------------------------------
  // A card's turn

  /**
   * Whether a turn prepared for this card may still go: the crew is on with
   * the same switch-on, not paused, and the card (when there is one) is
   * where the turn found it.
   */
  private mayStillSend(
    path: string,
    onAt: number | undefined,
    cardId?: string,
    from?: CardAt,
  ): boolean {
    const crew = getCrew(path);
    if (!crew?.on || crew.onAt !== onAt || crew.paused) return false;
    if (!this.running) return false;
    if (cardId === undefined) return true;
    return !!from && cardStillAt(crewCard(crew, cardId), from);
  }

  /** Send the card's holder its turn: the Builder's round, or the Checker's check. */
  private async sendCardTurn(
    path: string,
    cardId: string,
    role: CrewLoopRole,
    memberId: string,
  ) {
    const key = projectKey(path);
    const now = this.deps.now();
    const before = getCrew(path);
    if (!before || !claimCrewJob(path, this.deps.owner, now)) return;
    const onAt = before.onAt;
    const turn: LiveTurn = {
      role,
      memberId,
      cardId,
      sessionId: "",
      turnId: this.newId(),
      onAt,
    };
    this.beginTurn(key, turn);
    const queued = crewCard(before, cardId);
    // Where the card stood: everything below holds only while it still does.
    const from = queued ? cardAt(queued) : undefined;
    /** The card as this turn started it (with its base), if it got that far. */
    let begun: CrewCard | undefined;
    try {
      if (!queued || !from || !cardStillAt(queued, from))
        return this.endTurn(path, turn);
      const fresh = queued.stage === "queued";
      const prepared = await this.prepareCopy(path, fresh);
      if (!prepared || !this.stillOn(path, onAt))
        return this.endTurn(path, turn);
      const crew = prepared.crew;
      let card = crewCard(crew, cardId);
      if (!card) return this.endTurn(path, turn);
      if (fresh) card = { ...startCard(card, now), base: prepared.base };
      begun = card;
      if (!card.base)
        throw new Error("The card has no starting point in the copy.");
      // Switched off or removed meanwhile: the next look picks again.
      const member = crewMemberById(crew, memberId);
      if (!member || member.paused) return this.endTurn(path, turn);
      // Settings an agent left in the copy (hooks, MCP servers) would run as
      // you: removed, and this turn doesn't start.
      const planted = await this.deps.copy.planted(crew.copy!.path, true);
      if (planted.length)
        throw new Error(
          `Aven found ${planted.join(", ")} in the crew's copy and removed ${
            planted.length === 1 ? "it" : "them"
          }: settings there could run commands as you. Look over the card before you try again.`,
        );
      const chat = await this.deps.ensureChat(
        crew,
        memberId,
        role === "builder" ? card.override : undefined,
      );
      if (!chat)
        throw new Error(
          `Couldn't open ${this.deps.name(crew, memberId)}'s chat.`,
        );
      if (!this.stillOn(path, onAt)) return this.endTurn(path, turn);
      if (chatAtWork(chat)) {
        // You are talking to it, or it waits on you: the card waits too.
        if (fresh)
          updateCrew(path, (current) =>
            cardStillAt(crewCard(current, cardId), from)
              ? withCard(current, card!)
              : current,
          );
        return this.endTurn(path, turn);
      }
      turn.sessionId = chat.id;
      this.updateWorking();
      const names = this.names(crew, card, { role, memberId });
      // A new card's first build, and its first check, start a new
      // conversation; later rounds keep theirs, so a re-check remembers.
      const freshTalk =
        role === "security"
          ? !card.rounds.some((round) => round.security)
          : card.round <= 1 && (role === "builder" ? fresh : true);
      if (freshTalk && chat.providerSessionId)
        this.deps.freshConversation?.(chat.id);
      const brief =
        chat.providerSessionId && !(freshTalk && this.deps.freshConversation)
          ? undefined
          : crewBrief({
              role,
              name: this.deps.name(crew, memberId),
              ...(member.label ? { label: member.label } : {}),
              ...(member.job ? { job: member.job } : {}),
              project: crew.path,
              copyPath: crew.copy?.path ?? "",
              names,
              harness: crewMemberApp(member).harness,
              maxRounds: roundLimit(card),
            });
      let hashBefore: string | undefined;
      let builderScope:
        { scope: readonly string[]; outside: readonly string[] } | undefined;
      if (role === "security") {
        const diff = await this.deps.copy.diff(crew.copy!.path, card.base);
        hashBefore = diff.hash;
        // Security reviews exactly what the Checker passed, or nothing.
        if (card.reviewing && diff.hash !== card.reviewing.hash) {
          const now = this.deps.now();
          updateCrew(path, (current) =>
            cardStillAt(crewCard(current, cardId), from)
              ? this.commit(
                  current,
                  reviewMoved(card, { now, checker: names.checker }),
                  role,
                  now,
                  memberId,
                )
              : current,
          );
          return this.endTurn(path, turn);
        }
      }
      if (role === "checker") {
        const diff = await this.deps.copy.diff(crew.copy!.path, card.base);
        hashBefore = diff.hash;
        // Every scope that built a round of it: kept on the card.
        const scope = cardScope(card);
        if (scope.length)
          builderScope = {
            scope,
            outside: outsideScope(
              diff.files.map((file) => file.path),
              scope,
            ),
          };
      }
      const guidance = {
        ...(member.instructions ? { instructions: member.instructions } : {}),
        ...(member.scope?.length ? { scope: member.scope } : {}),
      };
      const text =
        role === "builder"
          ? builderMessage({
              card,
              notes: crew.notes,
              names,
              brief,
              sync: prepared.sync,
              guidance,
            })
          : role === "security"
            ? securityMessage({
                card,
                notes: crew.notes,
                names,
                brief,
                guidance,
              })
            : checkerMessage({
                card,
                notes: crew.notes,
                names,
                brief,
                guidance,
                ...(builderScope ? { builderScope } : {}),
              });
      const label = crewTurnLabel({
        role,
        card,
        from:
          role === "checker"
            ? names.builder
            : card.round > 1
              ? names.checker
              : undefined,
      });
      await this.deps.beforeSend?.(chat.id);
      // Last look, with nothing awaited between it and the send: the crew
      // is still on (the same switch-on) and not paused, and the card is
      // where this turn found it. Stopped, paused, thrown away or turned
      // off meanwhile: nothing goes.
      if (!this.mayStillSend(path, onAt, cardId, from))
        return this.endTurn(path, turn);
      const sent = this.deps.send(chat.id, text, {
        displayText: label,
        botWake: { label },
        blockId: turn.turnId,
        onSettled: (outcome) => void this.afterTurn(path, turn, outcome),
      });
      if (!sent)
        throw new Error(
          `Couldn't send ${this.deps.name(crew, memberId)} the card.`,
        );
      turn.sentAt = this.deps.now();
      const started = card;
      let saved = false;
      updateCrew(path, (current) => {
        // Saved only over the card as this turn found it.
        if (!cardStillAt(crewCard(current, cardId), from)) return current;
        saved = true;
        let next = withCrewRun(current, turn.sentAt!);
        next = withCard(next, {
          ...started,
          ...(role === "builder"
            ? {
                builderId: memberId,
                ...withBuilderScope(started, member.scope),
              }
            : role === "checker"
              ? { checkerId: memberId }
              : {}),
          turn: {
            role,
            sessionId: chat.id,
            turnId: turn.turnId,
            sentAt: turn.sentAt!,
            ...(hashBefore ? { hashBefore } : {}),
          },
          runs: started.runs + 1,
          updatedAt: turn.sentAt!,
        });
        next = withMemberId(next, memberId, (member) => ({
          ...member,
          sessionId: chat.id,
          doing: {
            at: turn.sentAt!,
            text:
              role === "checker"
                ? `Checking ${started.title} · round ${started.round}`
                : role === "security"
                  ? `Reviewing ${started.title} for security · round ${started.round}`
                  : `${started.round > 1 ? "Fixing" : "Building"} ${started.title} · round ${started.round}`,
          },
        }));
        return fresh
          ? withFeed(next, {
              at: turn.sentAt!,
              kind: "start",
              who: "builder",
              member: memberId,
              cardId: started.id,
              title: started.title,
              round: 1,
              text: `${names.builder} started “${started.title}”`,
            })
          : next;
      });
      if (!saved) {
        // The card moved on in the moment it went: its turn stops.
        turn.stopping = true;
        this.deps.stopChat(chat.id);
        this.markHandled(turn.turnId);
        return this.endTurn(path, turn);
      }
      this.armTimeout(path, turn, crew.limits.turnMinutes);
    } catch (error) {
      logError("Crew", error);
      const now = this.deps.now();
      updateCrew(path, (current) => {
        const card = crewCard(current, cardId);
        // You stopped or moved it meanwhile: that stands.
        if (!card || !from || !cardStillAt(card, from)) return current;
        // Started with its base when it got that far, so Try again goes on.
        const started =
          card.stage === "queued" ? (begun ?? startCard(card, now)) : card;
        return this.commit(
          current,
          turnFailed(started, {
            role,
            error: errorText(error),
            now,
            name: this.deps.name(current, memberId),
          }),
          role,
          now,
          memberId,
        );
      });
      this.endTurn(path, turn);
    }
  }

  /**
   * A turn sent before whose end this window never read: read it once its
   * chat is idle, or send it again if it never went.
   */
  private async recover(crew: Crew, card: CrewCard) {
    const sent = card.turn!;
    const member =
      crew.members.find((entry) => entry.sessionId === sent.sessionId) ??
      (sent.role === "builder"
        ? cardBuilder(crew, card)
        : sent.role === "security"
          ? cardSecurity(crew)
          : cardChecker(crew, card));
    if (!member) return;
    const chat =
      this.chatNow(sent.sessionId) ??
      (await this.deps.ensureChat(crew, member.id).catch(() => null));
    if (!chat || chatAtWork(chat)) return;
    if (!chat.blocks.some((block) => block.id === sent.turnId)) {
      updateCrew(crew.path, (current) => {
        const known = crewCard(current, card.id);
        return known?.turn?.turnId === sent.turnId
          ? withCard(current, { ...known, turn: undefined })
          : current;
      });
      return this.schedule();
    }
    const now = this.deps.now();
    if (!claimCrewJob(crew.path, this.deps.owner, now)) return;
    const turn: LiveTurn = {
      role: sent.role,
      memberId: member.id,
      cardId: card.id,
      sessionId: chat.id,
      turnId: sent.turnId,
      sentAt: sent.sentAt,
      onAt: crew.onAt,
    };
    this.beginTurn(projectKey(crew.path), turn);
    await this.afterTurn(crew.path, turn);
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

  /** A turn ended: read it once, whichever of its end, the heartbeat or a recovery comes first. */
  async afterTurn(path: string, turn: LiveTurn, outcome?: ControlOutcome) {
    if (!this.markHandled(turn.turnId)) return;
    try {
      if (turn.role === "scout" || turn.sweep)
        await this.afterScout(path, turn, outcome);
      else await this.afterCardTurn(path, turn, outcome);
    } catch (error) {
      logError("Crew", error);
    } finally {
      this.endTurn(path, turn);
    }
  }

  private async afterCardTurn(
    path: string,
    turn: LiveTurn,
    outcome?: ControlOutcome,
  ) {
    const crew = getCrew(path);
    if (!crew?.on || !turn.cardId) return;
    const card = crewCard(crew, turn.cardId);
    // Stopped, thrown away or picked up again meanwhile: nothing to read.
    if (!card || card.turn?.turnId !== turn.turnId) return;
    const role = turn.role as CrewLoopRole;
    const now = this.deps.now();
    const names = this.names(crew, card, { role, memberId: turn.memberId });
    let step: LoopStep;
    if (turn.timedOut)
      step = turnTimedOut(card, {
        role,
        minutes: crew.limits.turnMinutes,
        now,
        name: this.deps.name(crew, turn.memberId),
      });
    else if (
      (role === "checker" || role === "security") &&
      outcome?.status === "failed" &&
      isCodexToolsOpen(`${outcome.error ?? ""} ${outcome.text ?? ""}`) &&
      crewMemberApp(crewMemberById(crew, turn.memberId)).harness === "codex"
    ) {
      // Codex couldn't be locked down here: never run it unlocked. The
      // Checker checks with Claude for this session, and the same check
      // goes again at once.
      if (!this.stillOn(path, turn.onAt)) return;
      updateCrew(path, (current) => {
        const known = crewCard(current, card.id);
        if (!known || known.turn?.turnId !== turn.turnId) return current;
        return withCard(
          withCheckerOnClaude(
            current,
            this.deps.checkerFallbackModel?.(current),
            now,
            turn.memberId,
          ),
          { ...known, turn: undefined, updatedAt: now },
        );
      });
      return;
    } else if (outcome?.status === "failed" || outcome?.status === "cancelled")
      step = turnFailed(card, {
        role,
        error:
          outcome.status === "cancelled" ? "it was stopped" : outcome.error,
        now,
        name: this.deps.name(crew, turn.memberId),
      });
    else {
      const reply =
        replyForTurn(this.chatNow(turn.sessionId), turn.turnId) ||
        outcome?.text?.trim() ||
        "";
      const diff =
        crew.copy && card.base
          ? await this.deps.copy
              .diff(crew.copy.path, card.base)
              .catch((error) => {
                logError("Crew diff", error);
                return null;
              })
          : null;
      if (role === "security") {
        const edited =
          !diff ||
          (!!card.turn.hashBefore && diff.hash !== card.turn.hashBefore);
        const earlier = earlierSecurityFindings(card);
        step = afterSecurity(card, {
          verdict: parseVerdict(reply, {
            // Its first review reads the whole change.
            round: earlier.length ? card.round : 1,
            earlier,
          }),
          edited,
          now,
          names,
        });
      } else if (role === "builder")
        step = afterBuild(card, {
          handoff: parseHandoff(reply),
          change: changeFrom(diff, card.base ?? ""),
          now,
          names,
        });
      else {
        // A check that changed the copy (or whose copy can't be read) is void.
        const edited =
          !diff ||
          (!!card.turn.hashBefore && diff.hash !== card.turn.hashBefore);
        // A Builder kept to its scope: changes outside it are a must-fix,
        // from the copy's own diff, whatever the verdict says.
        const scope = cardScope(card);
        const outside = outsideScope(
          diff?.files.map((file) => file.path) ?? [],
          scope,
        );
        step = afterCheck(card, {
          verdict: withScopeCheck(
            parseVerdict(reply, {
              round: card.round,
              earlier: earlierFindings(card),
            }),
            outside,
            { builder: names.builder, scope },
          ),
          edited,
          // A pass makes exactly what the Checker saw the fix.
          seen: edited ? null : changeFrom(diff, card.base ?? ""),
          // With Security on, a pass goes to it before Ready.
          security: !!cardSecurity(crew),
          now,
          names,
        });
      }
    }
    if (!this.stillOn(path, turn.onAt)) return;
    updateCrew(path, (current) =>
      this.commit(current, step, role, now, turn.memberId),
    );
    if (step.event.kind === "ready")
      await Promise.resolve(this.deps.board.move(path, step.card.id, "review"));
  }

  /** Save a step: the card, the feed line, the member's line, and an Inbox card when it ends. */
  private commit(
    crew: Crew,
    step: LoopStep,
    role: CrewLoopRole,
    now: number,
    memberId: string,
  ): Crew {
    const { event } = step;
    let card = step.card;
    const { builder, checker, security } = this.names(crew, card, {
      role,
      memberId,
    });
    const builderId = role === "builder" ? memberId : card.builderId;
    const checkerId = role === "checker" ? memberId : card.checkerId;
    const securityId = role === "security" ? memberId : cardSecurity(crew)?.id;
    const secured = !!card.rounds.find((item) => item.n === card.round)
      ?.security;
    const entry: Omit<CrewFeedEntry, "id"> = {
      at: now,
      kind: "handoff",
      cardId: card.id,
      title: card.title,
      text: "",
    };
    const round = card.rounds.find((item) => item.n === card.round);
    switch (event.kind) {
      case "to-checker":
        Object.assign(entry, {
          kind: "handoff",
          who: "builder",
          ...(builderId ? { member: builderId } : {}),
          to: "checker",
          round: event.round,
          text:
            round?.handoff?.summary ||
            replyHeadline(`${builder} handed over round ${event.round}`),
        });
        break;
      case "to-security":
        Object.assign(entry, {
          kind: "handoff",
          who: "checker",
          ...(checkerId ? { member: checkerId } : {}),
          to: "security",
          round: event.round,
          text: `${checker} passed round ${event.round}; ${security} reviews it for security`,
        });
        break;
      case "to-builder": {
        const last = card.rounds.find((item) => item.n === event.round - 1);
        const bySecurity = event.from === "security";
        const verdict = bySecurity ? last?.security : last?.verdict;
        Object.assign(entry, {
          kind: "verdict",
          who: bySecurity ? "security" : "checker",
          ...(bySecurity
            ? securityId
              ? { member: securityId }
              : {}
            : checkerId
              ? { member: checkerId }
              : {}),
          to: "builder",
          round: event.round - 1,
          text: `${event.mustFix} must-fix: ${(verdict?.mustFix ?? [])
            .map((item) => item.text)
            .join("; ")}`,
        });
        break;
      }
      case "ready":
        Object.assign(entry, {
          kind: "ready",
          who: secured ? "security" : "checker",
          ...(secured
            ? securityId
              ? { member: securityId }
              : {}
            : checkerId
              ? { member: checkerId }
              : {}),
          round: event.round,
          text: secured
            ? `Ready for you · passed ${checker}'s check and ${security}'s security review in round ${event.round}`
            : `Ready for you · passed ${checker}'s check in round ${event.round}`,
        });
        break;
      case "question":
      case "stuck":
        Object.assign(entry, {
          kind: "stuck",
          who: event.kind === "question" ? "builder" : "aven",
          ...(event.kind === "question" && builderId
            ? { member: builderId }
            : {}),
          text: event.text,
        });
        break;
    }
    if (
      event.kind === "ready" ||
      event.kind === "stuck" ||
      event.kind === "question"
    )
      card = {
        ...withInboxResolved(card, "dismissed", now),
        inbox: crewInboxCard(card, now, {
          checker,
          ...(secured ? { security } : {}),
        }),
      };
    let next = withFeed(withCard(crew, card), entry);
    next = withMemberId(next, memberId, (member) =>
      member.doing ? { ...member, doing: undefined } : member,
    );
    return next;
  }

  // -------------------------------------------------------------------------
  // The Scout

  /**
   * The Scout's look, or Security's weekly sweep: a turn with no card, in the
   * idle copy, whose ideas land in Ideas.
   */
  private async sendScoutTurn(
    path: string,
    cards: readonly FeatureCard[],
    by: "scout" | "security" = "scout",
  ) {
    const key = projectKey(path);
    const now = this.deps.now();
    const before = getCrew(path);
    if (!before || !claimCrewJob(path, this.deps.owner, now)) return;
    const looker =
      by === "security" ? cardSecurity(before) : crewMember(before, "scout");
    if (!looker) return releaseCrewJob(path, this.deps.owner);
    const sweep = by === "security";
    const turn: LiveTurn = {
      role: by,
      memberId: looker.id,
      ...(sweep ? { sweep: true } : {}),
      sessionId: "",
      turnId: this.newId(),
      onAt: before.onAt,
    };
    this.beginTurn(key, turn);
    try {
      // The copy is idle (no card in it), so it is safe to match it to your files.
      const prepared = await this.prepareCopy(path, true);
      if (!prepared || !this.stillOn(path, turn.onAt))
        return this.endTurn(path, turn);
      const crew = prepared.crew;
      const member = crewMemberById(crew, turn.memberId);
      if (!member || member.paused) return this.endTurn(path, turn);
      const chat = await this.deps.ensureChat(crew, turn.memberId);
      if (!chat)
        throw new Error(
          `Couldn't open ${this.deps.name(crew, turn.memberId)}'s chat.`,
        );
      if (chatAtWork(chat)) return this.endTurn(path, turn);
      turn.sessionId = chat.id;
      this.updateWorking();
      const left = ideasLeft(crew, now);
      // Each look starts a new conversation.
      if (chat.providerSessionId) this.deps.freshConversation?.(chat.id);
      const brief =
        chat.providerSessionId && !this.deps.freshConversation
          ? undefined
          : crewBrief({
              role: by,
              name: this.deps.name(crew, turn.memberId),
              project: crew.path,
              copyPath: crew.copy?.path ?? "",
              names: this.names(crew),
              harness: crewMemberApp(member).harness,
              maxRounds: crew.limits.roundsPerCard,
            });
      const boardTitles = cards
        .filter((card) => card.column !== "shipped")
        .map((card) => card.title);
      const guidance = {
        ...(member.instructions ? { instructions: member.instructions } : {}),
        ...(member.scope?.length ? { scope: member.scope } : {}),
      };
      const text = sweep
        ? sweepMessage({
            notes: crew.notes,
            boardTitles,
            brief,
            sync: prepared.sync,
            guidance,
          })
        : scoutMessage({
            notes: crew.notes,
            boardTitles,
            ideasLeft: left,
            brief,
            sync: prepared.sync,
            guidance,
          });
      const label = crewTurnLabel({ role: by });
      // Last look before it goes (see `mayStillSend`): and still idle.
      const idle = getCrew(path);
      if (
        !this.mayStillSend(path, turn.onAt) ||
        !idle ||
        cardInCopy(idle) ||
        !crewMemberById(idle, turn.memberId) ||
        crewMemberById(idle, turn.memberId)?.paused
      )
        return this.endTurn(path, turn);
      const sent = this.deps.send(chat.id, text, {
        displayText: label,
        botWake: { label },
        blockId: turn.turnId,
        onSettled: (outcome) => void this.afterTurn(path, turn, outcome),
      });
      if (!sent)
        throw new Error(
          `Couldn't send ${this.deps.name(crew, turn.memberId)} its turn.`,
        );
      turn.sentAt = this.deps.now();
      updateCrew(path, (current) =>
        withMemberId(
          {
            ...withCrewRun(current, turn.sentAt!),
            ...(sweep ? { sweepAt: turn.sentAt } : { scoutAt: turn.sentAt }),
          },
          turn.memberId,
          (entry) => ({
            ...entry,
            sessionId: chat.id,
            doing: {
              at: turn.sentAt!,
              text: sweep
                ? "Sweeping for security problems"
                : "Looking for ideas",
            },
          }),
        ),
      );
      this.armTimeout(path, turn, crew.limits.turnMinutes);
    } catch (error) {
      logError(sweep ? "Crew security sweep" : "Crew scout", error);
      updateCrew(path, (current) => ({
        ...current,
        // It looked, even if it failed: no retry loop.
        ...(sweep
          ? { sweepAt: this.deps.now() }
          : { scoutAt: this.deps.now() }),
        lastError: { at: this.deps.now(), text: errorText(error) },
      }));
      this.endTurn(path, turn);
    }
  }

  /**
   * The Scout's ideas land in Ideas, at most the day's ideas left. A sweep's
   * security cards land there too, a few at most, marked so that none ever
   * starts by itself.
   */
  private async afterScout(
    path: string,
    turn: LiveTurn,
    outcome?: ControlOutcome,
  ) {
    const crew = getCrew(path);
    if (!crew?.on || !this.stillOn(path, turn.onAt)) return;
    const now = this.deps.now();
    const sweep = !!turn.sweep;
    const reply =
      replyForTurn(this.chatNow(turn.sessionId), turn.turnId) ||
      outcome?.text?.trim() ||
      "";
    const ideas =
      outcome?.status === "failed" || turn.timedOut
        ? []
        : parseIdeas(reply).slice(
            0,
            sweep ? SWEEP_CARDS : ideasLeft(crew, now),
          );
    const added = ideas.length
      ? await this.deps.board.add(
          path,
          ideas.map((idea) => ({
            title: idea.title,
            ...(idea.why ? { note: idea.why } : {}),
            ...(idea.sourceUrl ? { sourceUrl: idea.sourceUrl } : {}),
            column: "idea" as const,
          })),
        )
      : [];
    const who = this.deps.name(crew, turn.memberId);
    updateCrew(path, (current) => {
      let next = withMemberId(current, turn.memberId, (member) =>
        member.doing ? { ...member, doing: undefined } : member,
      );
      added.forEach((card, index) => {
        const idea = ideas[index]!;
        next = withIdea(next, card.id, {
          at: now + index,
          size: idea.size,
          ...(idea.why ? { why: idea.why } : {}),
          ...(idea.sourceUrl ? { sourceUrl: idea.sourceUrl } : {}),
          ...(idea.outside ? { outside: true } : {}),
          ...(sweep ? { by: "security" as const } : {}),
        });
      });
      if (!added.length) return next;
      if (!sweep)
        next = {
          ...next,
          ideasAdded: bumpToday(next.ideasAdded, now, added.length),
        };
      const what = sweep
        ? added.length === 1
          ? "a security card"
          : `${added.length} security cards`
        : added.length === 1
          ? "an idea"
          : `${added.length} ideas`;
      return withFeed(next, {
        at: now,
        kind: "idea",
        who: sweep ? "security" : "scout",
        member: turn.memberId,
        text: `${who} added ${what}: ${added.map((card) => card.title).join(" · ")}`,
      });
    });
  }

  // -------------------------------------------------------------------------
  // Watching the crews' chats

  /**
   * A turn that waits on you (an approval, a question) puts its card in
   * Needs you while it waits, and back once you answer.
   */
  observe(sessions: readonly Session[]) {
    if (!this.running) return;
    for (const [key, turn] of this.turns) {
      if (!turn.cardId || !turn.sessionId) continue;
      const chat = sessions.find((session) => session.id === turn.sessionId);
      const crew = activeCrews().find((item) => projectKey(item.path) === key);
      if (!chat || !crew) continue;
      const card = crewCard(crew, turn.cardId);
      if (!card || card.turn?.turnId !== turn.turnId) continue;
      const waiting = chatNeedsYou(chat);
      const now = this.deps.now();
      if (waiting && card.stage !== "stuck") {
        const who = this.deps.name(crew, turn.memberId);
        const text = `${who} is waiting on ${waiting}`;
        updateCrew(crew.path, (current) => {
          const known = crewCard(current, card.id);
          if (!known || known.stage === "stuck") return current;
          const stuck: CrewCard = {
            ...known,
            stage: "stuck",
            stuck: { reason: "question", text },
            updatedAt: now,
          };
          return withFeed(
            withCard(current, {
              ...stuck,
              inbox: crewInboxCard(stuck, now, this.names(current, stuck)),
            }),
            {
              at: now,
              kind: "stuck",
              who: turn.role,
              member: turn.memberId,
              cardId: card.id,
              title: card.title,
              text,
            },
          );
        });
      } else if (
        !waiting &&
        card.stage === "stuck" &&
        card.stuck?.reason === "question"
      ) {
        updateCrew(crew.path, (current) => {
          const known = crewCard(current, card.id);
          if (!known || known.stage !== "stuck" || !known.turn) return current;
          return withCard(current, {
            ...withInboxResolved(known, "done", now),
            stage: turn.role === "builder" ? "building" : "checking",
            stuck: undefined,
            updatedAt: now,
          });
        });
      }
    }
  }
}
