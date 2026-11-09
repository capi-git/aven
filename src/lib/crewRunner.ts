import { addAvosJob } from "./avosJobs";
import { setCrewLiveReply } from "./crewLiveReply";
import {
  avosPickChoices,
  avosPickOverride,
  avosTalkModel,
  builderRunsOn,
  helperRunsOn,
} from "./crewModels";
import {
  TALK_HOPS,
  TALK_TEXT_MAX,
  jobReport,
  parseTalk,
  talkAnswerText,
  talkMayAddJob,
  talkMayHop,
  talkMessage,
  talkPassedLine,
  talkTarget,
} from "./crewTalk";
import {
  botLine,
  parseFindings,
  parseMockup,
  parseGoal,
  parseHandoff,
  parseIdeas,
  parseMemory,
  parseTasks,
  parseVerdict,
  withoutMemory,
  type CrewTask,
} from "./crewHandoff";
import { crewInboxCard, withInboxResolved } from "./crewInbox";
import {
  allCrewRunsToday,
  crewGate,
  crewNoMemberGate,
  crewReviewGate,
  ideasLeft,
  ideaWaits,
  holdIdeaStarts,
  ideaStartsHeld,
  nextIdeaToBuild,
  nextCardToStart,
  scoutShouldLook,
  securitySweepDue,
  type CrewGate,
} from "./crewLimits";
import {
  afterBuild,
  afterCheck,
  afterMockup,
  afterResearch,
  afterSecurity,
  cardScope,
  changedAfterCheck,
  earlierFindings,
  earlierSecurityFindings,
  reviewMoved,
  roundLimit,
  securityOff,
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
  crewGuidanceText,
  crewTurnLabel,
  goalMessage,
  mockupMessage,
  researchMessage,
  scoutMessage,
  securityMessage,
  sweepMessage,
  SWEEP_CARDS,
} from "./crewPrompts";
import {
  CREW_ROLE_INFO,
  crewRoleUsesBrowser,
  crewRoleUsesWeb,
  AVEN_DIR,
  MOCKUP_DIR,
  activeCrews,
  bumpToday,
  cardBuilder,
  cardChecker,
  cardInCopy,
  cardDesigner,
  cardResearcher,
  cardSecurity,
  claimCrewJob,
  crewCard,
  crewMember,
  crewMemberApp,
  crewMemberById,
  crewsAllRunsPerDay,
  outsideScope,
  crewsSnapshot,
  getCrew,
  migrateBotsIntoCrews,
  releaseCrewJob,
  renewCrewJob,
  subscribeCrews,
  updateCrew,
  withCard,
  helpersLeft,
  memberOn,
  routineDue,
  withHelper,
  withoutHelper,
  withTalk,
  crewLead,
  withCrewRun,
  withMemberMemory,
  securityReviewBy,
  securityReviewsIt,
  withFeed,
  withGoalFromYou,
  withIdea,
  withNote,
  CREW_FEED_TEXT_MAX,
  withMemberId,
  withCheckerOnClaude,
  withDoingCleared,
  withoutFallbacks,
  stackHead,
  stackedCards,
  goalCardsDone,
  goalDropped,
  goalPlanner,
  waitsForReview,
  GOAL_NEEDS,
  NO_PLANNER,
  goalNeed,
  type BuildingNeed,
  queuedCards,
  type Crew,
  type CrewMember,
  type CrewCard,
  type CrewChange,
  type CrewCardHolder,
  type CrewFeedEntry,
  type CrewLoopRole,
  type CrewRole,
} from "./crews";
import { basename } from "./fs";
import { insideMockupDir, mockupFileName, mockupProblem } from "./crewMockups";
import { sourcesText } from "./crewView";
import { errorText, logError } from "./errors";
import type {
  FeatureCard,
  FeatureCardDraft,
  FeatureColumn,
} from "./featureCards";
import type { ControlOutcome } from "./orchestration";
import { projectKey } from "./paths";
import type { BotCopyInfo, BotDiff, BotSyncResult } from "./projectBotCopy";
import {
  botCopyError,
  isStackChanged,
  lookAlikePath,
  lookAlikeText,
} from "./projectBotCopy";
import type { BotSendOptions } from "./projectBotRunner";
import { botBranch, jobIsLive } from "./projectBots";
import { findModel } from "./models";
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
    /** Stop Try it running the copy: its files are about to change. */
    serveStop?: (copy: string) => Promise<void>;
    /** Make the copy when missing; made again, it starts `at` the stack. */
    prepare: (
      cwd: string,
      key: string,
      branch: string,
      at?: string,
    ) => Promise<BotCopyInfo>;
    sync: (cwd: string, copy: string, branch: string) => Promise<BotSyncResult>;
    diff: (copy: string, base: string) => Promise<BotDiff>;
    /** The copy's own files: its top-level entries Git doesn't ignore. */
    sources: (copy: string) => Promise<string[]>;
    /**
     * Every top-level entry of the copy, ignored ones too (`.git` aside):
     * what a Designer may not write, and what its turn is checked against.
     */
    entries?: (copy: string) => Promise<string[]>;
    /**
     * Settings files an agent left in the copy that an app would run as
     * the user; with `remove`, removed. Checked before every turn.
     */
    planted: (copy: string, remove: boolean) => Promise<string[]>;
    /**
     * Stack a passed card: what the copy holds becomes a commit on the
     * crew's branch on top of `parent`, only while it is the change its
     * checks passed (`hash`). Resolves with the commit.
     */
    stack: (
      copy: string,
      branch: string,
      parent: string,
      message: string,
      hash: string,
    ) => Promise<string>;
    /** Take a card's commit back off the branch; its files stay. */
    unstack: (
      copy: string,
      branch: string,
      commit: string,
      parent: string,
    ) => Promise<void>;
    /**
     * Throw away what the copy holds since `base` (it goes back to `base`),
     * only while the branch is at `expect`, when given.
     */
    discard: (
      copy: string,
      base: string,
      branch: string,
      expect?: string,
    ) => Promise<void>;
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
  /** Why a chat refused a message just now, in words, when known. */
  whyNotSent?: (sessionId: string) => string | undefined;
  /**
   * Avos brings in the helpers building needs (a Builder and a Checker)
   * before its first card builds. None here: such a card waits.
   */
  bringInBuilders?: (path: string) => void;
  /**
   * Why the project can't build in a copy now (no Git), said once in Avos's
   * chat with Set up Git; null when it can.
   */
  buildingProblem?: (path: string) => Promise<string | null>;
  /**
   * What the project lacks before it can build in a copy (Git, or a first
   * commit), saying nothing in the chat; null when it can.
   */
  buildingNeed?: (path: string) => Promise<BuildingNeed | null>;
  /** The chats crews are working in changed: they stay loaded. */
  onWorking: (ids: ReadonlySet<string>) => void;
  /**
   * The Designer's mock-ups: read the file it drew in the copy, keep it in
   * Aven's own data (resolves with where), and empty the copy's folder
   * (with `stray`, those new top-level entries of the copy as well).
   * Without these, a mock-up card stops and says Aven can't keep one here.
   */
  mockups?: {
    read: (path: string) => Promise<string>;
    save: (copyPath: string, cardId: string, html: string) => Promise<string>;
    clear: (copyPath: string, stray?: readonly string[]) => Promise<void>;
  };
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
  /** A Scout that could read the web as this turn started. */
  web?: boolean;
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
  /**
   * A goal turn: the commit the copy held when it began, so anything a
   * Builder planning it wrote there is undone.
   */
  goal?: {
    base?: string;
    /** The goal it was asked about: its words and when it was set. */
    text?: string;
    at?: number;
  };
};

/** Where a card stood when Aven began preparing its turn. */
type CardAt = {
  stage: CrewCard["stage"];
  round: number;
  holder?: CrewCardHolder;
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

/**
 * What a member took down in its chat for the crew: a reply's `aven-tasks`
 * block, when that reply answers a message you typed yourself (never a
 * turn Aven sent it, nor another agent's words). Aven only offers it, as
 * Queue these and Set as goal on the block's card: nothing starts until
 * you press one.
 */
export function memberAsk(
  chat: Pick<Session, "blocks">,
  replyId: string,
): { replyId: string; tasks: CrewTask[]; goal?: string } | null {
  const at = chat.blocks.findIndex((block) => block.id === replyId);
  const reply = chat.blocks[at];
  if (!reply || reply.role !== "assistant") return null;
  for (let index = at - 1; index >= 0; index -= 1) {
    const block = chat.blocks[index]!;
    if (block.role !== "user") continue;
    if (block.botWake || !block.typed) return null;
    const asked = parseTasks(reply.text);
    return asked ? { replyId: reply.id, ...asked } : null;
  }
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

/**
 * Whether a turn searched the web or read a page: any of its tool calls
 * carries the web mark (Claude's WebSearch and WebFetch), or is a fetch.
 */
export function turnUsedWeb(
  session: Session | undefined,
  turnId: string,
): boolean {
  if (!session) return false;
  const start = session.blocks.findIndex((block) => block.id === turnId);
  if (start < 0) return false;
  for (let index = start + 1; index < session.blocks.length; index += 1) {
    const block = session.blocks[index]!;
    if (block.role === "user") break;
    const kind = block.tool?.kind?.toLowerCase() ?? "";
    if (block.tool?.web || kind === "fetch" || kind === "webfetch") return true;
  }
  return false;
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

/** How long after stopping a late message Aven stops waiting to hear it end. */
const TALK_GIVE_UP_MS = 30_000;

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
  /** Busy chats a turn waits for: once one is free, the crews are looked at. */
  private waitingOn = new Set<string>();
  /** Messages this window is carrying now, by id: each one's chat and timer. */
  private talking = new Map<
    string,
    {
      path: string;
      to: string;
      sessionId: string;
      /** The turn it started in that chat, for the reply as it streams. */
      turnId?: string;
      /** Your own message: its answer shows as it's written. */
      live?: boolean;
      /** Avos answered on the quick model, not one you picked for it. */
      quick?: boolean;
      /** Whether its reply may start helpers, as it stood when it went. */
      mayStartHelpers: boolean;
      timer?: number;
      giveUp?: number;
      timedOut?: true;
    }
  >();

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
    // So did their members' lines, but for a card's turn, which is read
    // again (see `recover`) and clears its own.
    for (const crew of activeCrews())
      updateCrew(crew.path, (current) =>
        withDoingCleared(current, (member) =>
          current.cards.some(
            (card) =>
              !!member.sessionId && card.turn?.sessionId === member.sessionId,
          ),
        ),
      );
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
    this.waitingOn.clear();
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
    // A message under way when its team is turned off stops with it.
    for (const entry of this.talking.values())
      if (!crews[projectKey(entry.path)]?.on)
        this.deps.stopChat(entry.sessionId);
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
        for (const crew of activeCrews()) {
          await this.stepTalks(crew.path);
          await this.step(crew.path);
        }
      } while (this.pumpAgain && this.running);
    } finally {
      this.pumping = false;
    }
  }

  private gate(crew: Crew, now: number): CrewGate {
    return crewGate({
      crew,
      now,
      weeklyUsed: this.deps.weeklyUsed(now),
      fixerRuns: this.deps.fixerRuns(crew.path, now),
      // Every crew's runs today, Fixers included, for the ceiling.
      allRuns: allCrewRunsToday(now, (path) => this.deps.fixerRuns(path, now)),
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

  /** Messages on their way: each goes once its teammate's chat is free. */
  private async stepTalks(path: string) {
    const crew = getCrew(path);
    if (!crew?.on) return;
    const now = this.deps.now();
    this.startRoutines(crew, now);
    const talks = getCrew(path)?.talks ?? [];
    // A helper whose message is gone (a restart, say) is gone with it.
    for (const helper of crew.helpers ?? [])
      if (!talks.some((talk) => talk.to === helper.id))
        updateCrew(path, (current) => withoutHelper(current, helper.id));
    for (const talk of talks) {
      if (!talk.sent) await this.sendTalk(path, talk.id, now);
      else if (!this.talking.has(talk.id))
        // Carried by a page that's gone: nothing will read its end. Only the
        // main window runs teams, so no other page is carrying it now.
        this.dropTalk(
          path,
          talk.id,
          now,
          talk.from === "you" && !talk.routine
            ? `${this.deps.name(crew, talk.to)} didn't finish answering your message, because Aven restarted. Send it again.`
            : undefined,
        );
    }
  }

  /** Teammates' routines whose time came, within the team's limits. */
  private startRoutines(crew: Crew, now: number) {
    const due = crew.members.filter((member) => routineDue(member, now));
    if (!due.length || !this.gate(crew, now).ok) return;
    updateCrew(crew.path, (current) => {
      let next = current;
      for (const member of due)
        next = withTalk(
          withMemberId(next, member.id, (entry) =>
            entry.routine
              ? { ...entry, routine: { ...entry.routine, at: now } }
              : entry,
          ),
          {
            at: now,
            from: "you",
            to: member.id,
            text: member.routine!.text,
            hop: 0,
            routine: true,
          },
        );
      return next;
    });
  }

  /** A message that won't arrive, said once when it was yours or it asks why. */
  private dropTalk(path: string, talkId: string, now: number, why?: string) {
    updateCrew(path, (current) => {
      const to = current.talks?.find((talk) => talk.id === talkId)?.to;
      const next = withMemberId(
        {
          ...current,
          talks: current.talks?.filter((talk) => talk.id !== talkId),
        },
        to ?? "",
        (member) => (member.doing ? { ...member, doing: undefined } : member),
      );
      return why
        ? withFeed(next, { at: now, kind: "note", who: "aven", text: why })
        : next;
    });
  }

  private async sendTalk(path: string, talkId: string, now: number) {
    let crew = getCrew(path);
    const talk = crew?.talks?.find((entry) => entry.id === talkId);
    if (!crew?.on || !talk || talk.sent) return;
    const member = crewMemberById(crew, talk.to);
    const toName = this.deps.name(crew, talk.to);
    if (!member || !memberOn(member))
      return this.dropTalk(
        path,
        talkId,
        now,
        `${toName} is off, so a message to it wasn't passed on.`,
      );
    // Your own message always goes; teammates talking keep to the crew's limits.
    const costsARun = talk.from !== "you" || !!talk.routine;
    if (costsARun && !this.gate(crew, now).ok) return;
    const key = projectKey(path);
    // Only a Lead or a helper can't touch the copy, so anyone else waits for a
    // turn working in it: a stray file would void a check. One that writes
    // waits out the whole card, so a message can't fold into its change.
    if (member.role !== "lead" && member.role !== "helper") {
      if (this.turns.has(key)) return;
      const inCopy = cardInCopy(crew);
      if (
        CREW_ROLE_INFO[member.role].edits &&
        (inCopy?.stage === "building" || inCopy?.stage === "checking")
      )
        return;
    }
    if (
      this.turns.get(key)?.memberId === member.id ||
      [...this.talking.values()].some(
        (entry) => entry.path === path && entry.to === member.id,
      )
    )
      return;
    try {
      // Avos reads your folder until there's a copy. Everyone else waits for
      // one, a helper too (starting in your folder as the copy is made, its
      // chat would be moved before it ran). Only where no copy can be made,
      // a project without Git, does a helper read your folder, as Avos does.
      if (!crew.copy && member.role !== "lead") {
        let prepared: { crew: Crew } | null | undefined;
        try {
          prepared = await this.prepareCopy(path, false);
        } catch (error) {
          if (member.role !== "helper") throw error;
          prepared = undefined;
        }
        if (prepared === null) return;
        if (prepared) crew = prepared.crew;
      }
      // Avos runs on Opus 5.5 at Medium unless you picked a model for it.
      const avos = avosTalkModel(member);
      const chat = await this.deps.ensureChat(
        crew,
        member.id,
        ...(avos ? [avos] : []),
      );
      if (!chat) throw new Error(`Couldn't open ${toName}'s chat.`);
      if (chatAtWork(chat)) {
        this.waitingOn.add(chat.id);
        return;
      }
      const turnId = this.newId();
      const owner = this.deps.owner;
      let claimed = false;
      updateCrew(path, (current) => {
        const talks = current.talks?.map((entry) => {
          if (entry.id !== talkId || entry.sent) return entry;
          claimed = true;
          return {
            ...entry,
            sent: { at: now, owner, turnId, sessionId: chat.id },
          };
        });
        const claimedIt = claimed;
        return claimedIt
          ? withMemberId(
              costsARun
                ? withCrewRun({ ...current, talks }, now)
                : { ...current, talks },
              member.id,
              (entry) => ({
                ...entry,
                sessionId: chat.id,
                doing: { at: now, text: "Answering a message" },
              }),
            )
          : current;
      });
      if (!claimed) return;
      const fresh = getCrew(path) ?? crew;
      // A turn that could read the web starts nobody: a page could ask it to.
      // Nor does one whose crew turned quick helpers off.
      // Avos has the web too, so it is judged by what its turn did: a
      // reply that used the web starts no one (see `turnUsedWeb` below).
      const mayStartHelpers =
        member.role !== "helper" &&
        fresh.limits.helpersPerDay > 0 &&
        !talk.answer &&
        (member.role === "lead" || !crewRoleUsesWeb(fresh, member.role)) &&
        !crewRoleUsesBrowser(fresh, member.role);
      this.talking.set(talkId, {
        path,
        to: member.id,
        sessionId: chat.id,
        turnId,
        live: talk.from === "you" && !talk.routine,
        ...(avos ? { quick: true } : {}),
        mayStartHelpers,
      });
      this.updateWorking();
      const fromName =
        talk.from === "you"
          ? "You"
          : (talk.fromName ?? this.deps.name(fresh, talk.from));
      const text = talkMessage({
        talk,
        fromName,
        isLead: member.role === "lead",
        others: fresh.members
          .filter(
            (entry) =>
              entry.id !== member.id &&
              entry.role !== "fixer" &&
              memberOn(entry),
          )
          .map((entry) => this.deps.name(fresh, entry.id)),
        mayAsk: member.role !== "helper" && talkMayHop(talk),
        mayStartHelpers,
        mayAddJob: talkMayAddJob(talk, member.role),
        mayKeep: member.role === "lead" && talk.from === "you" && !talk.routine,
        helpersOn: { mockup: !!cardDesigner(fresh) },
        ...(member.role === "lead" &&
        crewRoleUsesWeb(fresh, "lead") &&
        crewMemberApp(member).harness !== "codex"
          ? { web: true }
          : {}),
        ...(fresh.askBeforeBuilding ? { asksFirst: true } : {}),
        // Let Avos choose: it picks the Builder's model and effort per card.
        ...(member.role === "lead" && talk.from === "you" && !talk.routine
          ? (() => {
              const picks = avosPickChoices(fresh);
              return picks ? { picks } : {};
            })()
          : {}),
        guidance: crewGuidanceText({
          ...(member.instructions ? { instructions: member.instructions } : {}),
          ...(member.memory ? { memory: member.memory } : {}),
        }),
        ...(chat.providerSessionId
          ? {}
          : {
              brief: crewBrief({
                role: member.role as CrewChatRole,
                name: toName,
                project: fresh.path,
                copyPath: fresh.copy?.path ?? "",
                names: this.names(fresh),
                harness: crewMemberApp(member).harness,
                maxRounds: fresh.limits.roundsPerCard,
              }),
            }),
      });
      const label = talk.routine ? "Routine" : `From ${fromName}`;
      const yours = talk.from === "you" && !talk.routine;
      const sent = this.deps.send(chat.id, text, {
        displayText: yours ? talk.text : label,
        ...(yours ? {} : { botWake: { label } }),
        blockId: turnId,
        onSettled: (outcome) =>
          void this.afterTalk(path, talkId, turnId, chat.id, outcome),
      });
      if (!sent)
        throw new Error(
          this.deps.whyNotSent?.(chat.id) ??
            `Couldn't send ${toName} a message.`,
        );
      const carrying = this.talking.get(talkId);
      if (carrying)
        carrying.timer = this.deps.setTimer(() => {
          carrying.timedOut = true;
          this.deps.stopChat(chat.id);
          // Its end may never report: the teammate isn't kept waiting on it.
          carrying.giveUp = this.deps.setTimer(
            () => void this.afterTalk(path, talkId, turnId, chat.id),
            TALK_GIVE_UP_MS,
          );
        }, fresh.limits.turnMinutes * 60_000);
    } catch (error) {
      logError("Crew message", error);
      this.talking.delete(talkId);
      setCrewLiveReply(path, talk.to, null);
      this.updateWorking();
      this.dropTalk(
        path,
        talkId,
        now,
        `A message to ${toName} didn't go through: ${errorText(error)}`,
      );
    }
  }

  /**
   * A teammate answered. Its line goes in the team chat, the Lead's cards to
   * Ideas (where they wait for you), and what it asks to the teammates it
   * names, up to the limit. Only the block ending this reply is read, and
   * nothing here can approve anything or move a card already on the Board.
   */
  private async afterTalk(
    path: string,
    talkId: string,
    turnId: string,
    sessionId: string,
    outcome?: ControlOutcome,
  ) {
    if (!this.markHandled(turnId)) return;
    const carrying = this.talking.get(talkId);
    if (carrying) setCrewLiveReply(carrying.path, carrying.to, null);
    if (carrying?.timer != null) this.deps.clearTimer(carrying.timer);
    if (carrying?.giveUp != null) this.deps.clearTimer(carrying.giveUp);
    this.talking.delete(talkId);
    this.updateWorking();
    const crew = getCrew(path);
    const talk = crew?.talks?.find((entry) => entry.id === talkId);
    if (!crew || !talk) return;
    const now = this.deps.now();
    const member = crewMemberById(crew, talk.to);
    const who = this.deps.name(crew, talk.to);
    const failed =
      !!carrying?.timedOut ||
      outcome?.status === "failed" ||
      outcome?.status === "cancelled";
    const reply = failed
      ? ""
      : withoutMemory(
          replyForTurn(this.chatNow(sessionId), turnId) ||
            outcome?.text?.trim() ||
            "",
        );
    const isHelper = member?.role === "helper";
    if (member && !failed && !isHelper)
      this.remember(
        path,
        {
          role: member.role as CrewChatRole,
          memberId: member.id,
          sessionId,
          turnId,
        },
        outcome,
      );
    const said = parseTalk(reply);
    const isLead = member?.role === "lead";
    // A reply that searched the web or read a page: what it proposes could
    // be the page's words, not yours. For this reply only, its cards wait
    // for you, and no rule, goal, job or helper comes of it.
    const usedWeb =
      !failed && turnUsedWeb(this.chatNow(sessionId) ?? undefined, turnId);
    // Only your own message, to a Lead that has read no other agent's words,
    // can build by itself. A routine runs with nobody watching.
    const yours =
      talk.from === "you" && !talk.routine && !member?.heardOthers && !usedWeb;
    // Its answer to you, as you watched it being written: the thread keeps
    // it, unless it's too long for a post (then its one line).
    const answer =
      !failed && talk.from === "you" && !talk.routine
        ? talkAnswerText(reply)
        : "";
    const shown =
      answer && answer.length <= CREW_FEED_TEXT_MAX ? answer : said.line;
    // A rule or a goal, taken down from your own words only.
    const keep = isLead && yours && crew.on && !failed;
    // A question for the Researcher or a screen for the Designer: their own
    // cards, as the box once made them. Avos has no web, so a link goes to
    // the Researcher, brought in (or back on) when the team has none on.
    if (keep && (said.research || said.mockup)) {
      const { addQuestionCard, bringInResearcher } =
        await import("./crewActions");
      for (const [text, kind] of [
        [said.research, "research"],
        [said.mockup, "mockup"],
      ] as const)
        if (text) {
          const ready =
            kind === "research" ? bringInResearcher(path) : { broughtIn: null };
          const made =
            "problem" in ready
              ? ready
              : await addQuestionCard(path, text, kind, now, {
                  ...(ready.broughtIn ? { broughtIn: ready.broughtIn } : {}),
                }).catch((error) => ({ problem: errorText(error) }));
          if (made.problem)
            updateCrew(path, (current) =>
              withFeed(current, {
                at: now,
                kind: "note",
                who: "aven",
                text: made.problem!,
              }),
            );
        }
    }
    // Repeating work becomes the team's job, in the project itself, and only
    // from your own message asking for it. The reply is about the job, so
    // cards beside it would be the same work again.
    const jobAsked = isLead && crew.on && !failed && !!said.job;
    const jobAllowed =
      jobAsked && !usedWeb && talkMayAddJob(talk, member?.role);
    const lead = this.chatNow(sessionId);
    const job =
      jobAllowed && said.job
        ? addAvosJob({
            crew,
            draft: said.job,
            lead: member,
            // A job runs on your usual model, not the quick one Avos
            // answered on.
            ...(lead
              ? {
                  chat: {
                    harness: lead.harness,
                    model: carrying?.quick ? "" : lead.model,
                  },
                }
              : {}),
            now,
          })
        : null;
    const cards =
      isLead && crew.on && !failed && !job && said.cards.length
        ? await this.deps.board
            .add(
              path,
              said.cards.map((card) => ({
                title: card.title,
                ...(card.why ? { note: card.why } : {}),
                column: "idea" as const,
              })),
            )
            .catch((error) => {
              logError("Crew message cards", error);
              return [];
            })
        : [];
    updateCrew(path, (current) => {
      let next: Crew = {
        ...current,
        talks: current.talks?.filter((entry) => entry.id !== talkId),
      };
      if (member)
        next = withMemberId(next, member.id, (entry) => {
          const heard = isLead && talk.from !== "you" && !entry.heardOthers;
          return entry.doing || heard
            ? {
                ...entry,
                doing: undefined,
                ...(heard ? { heardOthers: true } : {}),
              }
            : entry;
        });
      // Done either way. Its answer goes back to who started it, whatever
      // the hops: it's what that teammate is waiting for.
      if (isHelper) {
        next = withFeed(withoutHelper(next, talk.to), {
          at: now,
          kind: "say",
          who: "helper",
          text: failed
            ? `Helper “${who}” didn't finish.`
            : `Helper “${who}”${said.line ? `: ${said.line}` : " finished."}`,
        });
        return !failed && reply && crew.on
          ? withTalk(next, {
              at: now,
              from: talk.to,
              fromName: `Your helper “${who}”`,
              to: talk.from,
              text: reply.slice(0, TALK_TEXT_MAX),
              hop: talk.hop,
              answer: true,
            })
          : next;
      }
      cards.forEach((card, index) => {
        const asked = said.cards[index]!;
        next = withIdea(next, card.id, {
          at: now + index,
          size: asked.size,
          ...(asked.why ? { why: asked.why } : {}),
          ...(yours ? { asked: true } : { by: "lead" as const }),
          // Avos's pick of the Builder's model and effort for it.
          ...(asked.model || asked.effort
            ? {
                pick: {
                  ...(asked.model ? { model: asked.model } : {}),
                  ...(asked.effort ? { effort: asked.effort } : {}),
                },
              }
            : {}),
        });
      });
      if (!member) return next;
      if (failed)
        return withFeed(next, {
          at: now,
          kind: "note",
          who: "aven",
          text: `${who} didn't finish answering.`,
        });
      if (shown)
        next = withFeed(next, {
          at: now,
          kind: "say",
          who: member.role,
          member: member.id,
          text: shown,
        });
      if (keep && said.remember)
        next = withNote(next, said.remember, now, {
          member: member.id,
          name: who,
        });
      if (keep && said.goal)
        next = withGoalFromYou(next, said.goal, now, {
          member: member.id,
          name: who,
        });
      if (jobAsked && !jobAllowed && said.job)
        next = withFeed(next, {
          at: now,
          kind: "note",
          who: "aven",
          text: `${who} wanted to keep an eye on “${said.job.name}”, but only a message of yours asking for it can set that up. Ask again, and say how often.`,
        });
      if (!crew.on) return next;
      // Its answer goes back to whoever asked, while there are hops left.
      const hop = talk.hop + 1;
      if (talk.from !== "you" && !talk.answer && reply && talkMayHop(talk))
        next = withTalk(next, {
          at: now,
          from: member.id,
          to: talk.from,
          text: reply.slice(0, TALK_TEXT_MAX),
          hop,
          answer: true,
        });
      for (const asked of carrying?.mayStartHelpers && !usedWeb
        ? said.helpers
        : []) {
        if (helpersLeft(next, member.id, now) <= 0) {
          next = withFeed(next, {
            at: now,
            kind: "note",
            who: "aven",
            text: `${who} wanted a helper for “${asked.title}”, but there are as many at work as there can be.`,
          });
          break;
        }
        // On what you picked for new helpers (Opus 5.5 · Medium until you
        // do); when Avos picks per job, on what its asker runs on.
        const app = crewMemberApp(member);
        const runs = helperRunsOn(next) ?? {
          model: avosTalkModel(member)?.model ?? app.model ?? "",
        };
        const runsHarness = findModel(runs.model)?.harness ?? app.harness;
        const helper: CrewMember = {
          id: `helper-${this.newId()}`.slice(0, 40),
          role: "helper",
          name: asked.title.slice(0, 40),
          helperOf: member.id,
          harness: runsHarness === "codex" ? "codex" : "claude",
          ...(runs.model ? { model: runs.model } : {}),
          ...("effort" in runs && runs.effort ? { effort: runs.effort } : {}),
        };
        next = withTalk(
          withFeed(withHelper(next, helper, now), {
            at: now,
            kind: "say",
            who: member.role,
            member: member.id,
            text: `${who} started a helper: ${asked.title}`,
          }),
          {
            at: now,
            from: member.id,
            to: helper.id,
            text: asked.task,
            hop: talk.hop,
            helper: true,
          },
        );
      }
      for (const ask of said.asks) {
        if (!talkMayHop(talk)) {
          next = withFeed(next, {
            at: now,
            kind: "note",
            who: "aven",
            text: `${who} wanted to ask ${botLine(ask.to, 60)}, but this message has been passed on as far as it goes.`,
          });
          break;
        }
        const target = talkTarget(next, member.id, ask.to);
        next = target
          ? withTalk(
              withFeed(next, {
                at: now,
                kind: "say",
                who: member.role,
                member: member.id,
                text: talkPassedLine(
                  who,
                  this.deps.name(next, target.id),
                  ask.text,
                ),
              }),
              {
                at: now,
                from: member.id,
                to: target.id,
                text: ask.text,
                hop,
              },
            )
          : withFeed(next, {
              at: now,
              kind: "note",
              who: "aven",
              text: `${who} asked for ${botLine(ask.to, 60)}, who isn't one of Avos's helpers.`,
            });
      }
      return next;
    });
    this.schedule();
  }

  private async step(path: string) {
    const crew = getCrew(path);
    if (!crew?.on) return;
    const key = projectKey(path);
    if (this.turns.has(key)) return;
    const now = this.deps.now();
    if (jobIsLive(crew.job, now) && crew.job?.owner !== this.deps.owner) return;
    // A plan cut off by a restart: the member goes back to what you set.
    if (crew.planning)
      updateCrew(path, (current) => ({ ...current, planning: undefined }));
    const inCopy = cardInCopy(crew);
    if (inCopy) {
      if (
        (inCopy.stage !== "building" && inCopy.stage !== "checking") ||
        inCopy.paused
      )
        return this.clearHold(crew);
      // A turn sent before (by an earlier page, say) whose end was never read.
      if (inCopy.turn) return this.recover(crew, inCopy);
      // A question for the Researcher, or a screen for the Designer: one
      // turn of its own.
      if (inCopy.kind === "research" || inCopy.kind === "mockup")
        return this.stepSolo(crew, inCopy, now);
      const role =
        inCopy.holder === "researcher" || inCopy.holder === "designer"
          ? "builder"
          : (inCopy.holder ?? "builder");
      const member =
        role === "builder"
          ? cardBuilder(crew, inCopy)
          : role === "security"
            ? cardSecurity(crew)
            : cardChecker(crew, inCopy);
      // Security is off or gone: the Checker's pass is the card's last check.
      if (!member && role === "security")
        return this.withoutSecurity(crew, inCopy);
      // Every Builder (or Checker) is off or gone: the card waits, and says why.
      if (!member) return this.hold(crew, crewNoMemberGate(role));
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendCardTurn(path, inCopy.id, role, member.id);
    }
    // Enough passed work waits on the branch: nothing new starts until you
    // review it (the Scout may still look, below).
    const waiting = waitsForReview(crew);
    const next = nextCardToStart(crew);
    if (next) {
      if (waiting) return this.hold(crew, crewReviewGate(waiting));
      const queued = crewCard(crew, next)!;
      if (queued.kind === "research" || queued.kind === "mockup")
        return this.stepSolo(crew, queued, now);
      const builder = cardBuilder(crew, queued);
      if (!builder) return this.hold(crew, crewNoMemberGate("builder"));
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendCardTurn(path, next, "builder", builder.id);
    }
    // Idle: the next idea in Ideas builds by itself, top first (yours and
    // the Scout's alike); then the goal's next card; then the Scout looks,
    // or Security sweeps.
    let cards: readonly FeatureCard[] | null = null;
    try {
      cards = await this.deps.board.cards(path);
    } catch (error) {
      logError("Crew board", error);
    }
    // Avos with no Builder yet builds only what it took down from your own
    // words: ideas already on the Board wait for you to say Build it.
    const builds = crew.members.some(
      (member) => member.role === "builder" && memberOn(member),
    );
    const idea = cards
      ? nextIdeaToBuild(
          crew,
          builds ? cards : cards.filter((card) => !!crew.ideas?.[card.id]),
          now,
        )
      : null;
    if (idea) {
      if (waiting) return this.hold(crew, crewReviewGate(waiting));
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      if (!builds) {
        // No Git: it says so, with Set up Git, and the idea waits for you.
        const problem = await this.deps.buildingProblem?.(path);
        if (problem || !this.deps.bringInBuilders) {
          updateCrew(path, (current) =>
            current.notNow?.includes(idea.id)
              ? current
              : { ...current, notNow: [...(current.notNow ?? []), idea.id] },
          );
          return;
        }
        this.deps.bringInBuilders(path);
      }
      return this.autoStart(path, idea);
    }
    // Idle with a goal: is it met, and what's the next card towards it.
    // The team keeps going, card after card, until it's met or it stops
    // to ask (a Stuck card with work holds the copy, so nothing gets here).
    // A goal that stopped for want of Git goes on by itself once the
    // folder has it: its panel never says "Needs Git" of a folder with Git.
    if (
      crew.goal?.done &&
      !crew.goal.done.met &&
      goalNeed(crew.goal.done.text) &&
      this.deps.buildingNeed &&
      !(await this.deps.buildingNeed(path))
    ) {
      updateCrew(path, (current) =>
        current.goal?.done && goalNeed(current.goal.done.text)
          ? {
              ...current,
              goal: {
                text: current.goal.text,
                at: current.goal.at,
                ...(current.goal.by ? { by: current.goal.by } : {}),
              },
            }
          : current,
      );
      return;
    }
    if (crew.goal && !crew.goal.done && waiting)
      return this.hold(crew, crewReviewGate(waiting));
    if (crew.goal && !crew.goal.done) {
      // No one to plan it yet: Avos brings in its Builder, which plans the
      // goal's next card, as it would build Avos's own jobs. In a folder
      // that can't build yet, the goal waits and its panel says on what
      // (with Set up Git): nothing more is said in the chat.
      if (!goalPlanner(crew) && this.deps.bringInBuilders) {
        const need = await this.deps.buildingNeed?.(path);
        if (need) return this.stopGoal(crew, GOAL_NEEDS[need], now);
        this.deps.bringInBuilders(path);
        return;
      }
      if (!goalPlanner(crew)) return this.stopGoal(crew, NO_PLANNER, now);
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendGoalTurn(path, cards ?? []);
    }
    const scoutDue = scoutShouldLook(crew, now, false);
    const sweepDue = securitySweepDue(crew, now);
    if ((!scoutDue && !sweepDue) || !cards) return this.clearHold(crew);
    if (scoutDue) {
      const gate = this.gate(crew, now);
      if (!gate.ok) return this.hold(crew, gate);
      this.clearHold(crew);
      return this.sendScoutTurn(path, cards);
    }
    const gate = this.gate(crew, now);
    if (!gate.ok) return this.hold(crew, gate);
    this.clearHold(crew);
    return this.sendScoutTurn(path, cards, "security");
  }

  /**
   * Security was turned off or removed while a card the Checker passed
   * waited for it: the card is Ready on the Checker's pass, and the feed
   * says Security didn't review it. Without a passed change, it waits.
   */
  private async withoutSecurity(crew: Crew, card: CrewCard) {
    const now = this.deps.now();
    const passed = securityOff(card, now);
    if (!passed) return this.hold(crew, crewNoMemberGate("security"));
    const checkerId =
      card.checkerId ?? cardChecker(crew, card)?.id ?? "checker";
    // Stacked on the crew's branch like any passed card, the copy held
    // meanwhile so nothing else starts on top of it.
    if (!claimCrewJob(crew.path, this.deps.owner, now)) return;
    let step: LoopStep;
    try {
      step = await this.stackPassed(crew, passed, "checker", checkerId, now);
    } finally {
      releaseCrewJob(crew.path, this.deps.owner);
    }
    let ready = false;
    let saved = false;
    updateCrew(crew.path, (current) => {
      const known = crewCard(current, card.id);
      if (
        !known ||
        known.turn ||
        known.paused ||
        !securityOff(known, now) ||
        cardSecurity(current)
      )
        return current;
      saved = true;
      ready = step.event.kind === "ready";
      const checker = this.deps.name(current, checkerId);
      const noted = withFeed(
        { ...current, hold: undefined },
        {
          at: now,
          kind: "note",
          who: "aven",
          cardId: card.id,
          title: card.title,
          text: `Security is off, so “${card.title}” is Ready on ${checker}'s check alone`,
        },
      );
      return this.commit(noted, step, "checker", now, checkerId);
    });
    if (!saved) await this.unstackUnsaved(crew, step.card);
    if (ready)
      await Promise.resolve(this.deps.board.move(crew.path, card.id, "review"));
  }

  /**
   * The next idea in Ideas starts by itself: queued and said in the feed. A
   * Scout idea counts towards the day's cap on those; yours never does.
   */
  private async autoStart(path: string, card: FeatureCard) {
    const now = this.deps.now();
    let started = false;
    updateCrew(path, (crew) => {
      // Not now, or a card the team has, since the Board was read: it waits.
      if (ideaStartsHeld(path) || ideaWaits(crew, card, now)) return crew;
      const idea = crew.ideas?.[card.id];
      // Avos's own job: its own, not the Scout's, and not on the Scout's
      // count of ideas that start by themselves.
      const avos = !!idea?.asked;
      started = true;
      let next = withCard(
        crew,
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: [card.title, card.note].filter(Boolean).join("\n\n"),
            from: avos ? "lead" : idea ? "scout" : "you",
            ...(idea ? { size: idea.size } : {}),
            maxRounds: crew.limits.roundsPerCard,
            ...(() => {
              const override = avosPickOverride(
                crewMember(crew, "builder"),
                idea?.pick,
                crew,
              );
              return override ? { override } : {};
            })(),
          },
          now,
        ),
      );
      if (idea) {
        next = withIdea(next, card.id, { ...idea, autoStarted: true });
        if (!avos)
          next = { ...next, autoStarts: bumpToday(next.autoStarts, now) };
      }
      return withFeed(next, {
        at: now,
        kind: "start",
        who: "aven",
        cardId: card.id,
        title: card.title,
        text: avos
          ? `Avos started “${card.title}”`
          : idea
            ? `Started ${this.deps.name(crew, "scout")}'s idea “${card.title}” by itself`
            : `Started your idea “${card.title}” by itself`,
      });
    });
    if (!started) return;
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
   * The member's chat is at work (you're talking to it, or it waits on you):
   * its turn waits, and nothing is prepared or saved meanwhile. The next
   * look comes once the chat is free (see `observe`), or at the next tick.
   */
  private memberChatAtWork(crew: Crew, memberId: string): boolean {
    const sessionId = crewMemberById(crew, memberId)?.sessionId;
    const chat = sessionId ? this.chatNow(sessionId) : undefined;
    if (!chat || !chatAtWork(chat)) return false;
    this.waitingOn.add(chat.id);
    return true;
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
    // Made again (git forgot it), it starts where the stack is.
    const at = stackedCards(crew).length ? stackHead(crew) : undefined;
    try {
      copy = await this.deps.copy.prepare(
        path,
        crewCopyKey(path),
        branch,
        ...(at ? [at] : []),
      );
    } catch (error) {
      throw new Error(`Couldn't make Avos's copy: ${botCopyError(error)}`);
    }
    // Work starts in the copy: Try it would show it half done.
    await this.deps.copy.serveStop?.(copy.path).catch(() => {});
    const sources = await this.deps.copy
      .sources(copy.path)
      .catch(() => crew.copy?.sources);
    const entries = this.deps.copy.entries
      ? await this.deps.copy.entries(copy.path).catch(() => crew.copy?.entries)
      : undefined;
    let saved = updateCrew(path, (current) => ({
      ...current,
      copy: {
        path: copy.path,
        branch: copy.branch,
        root: copy.root,
        gitDir: copy.gitDir,
        ...(sources ? { sources } : {}),
        ...(entries ? { entries } : {}),
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
      throw new Error(`Couldn't update Avos's copy: ${botCopyError(error)}`);
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
        text: `Aven removed ${files.join(", ")} from Avos's copy: settings there could run commands as you.`,
      }),
    );
  }

  private beginTurn(key: string, turn: LiveTurn) {
    this.turns.set(key, turn);
    this.updateWorking();
    if (this.heartbeat == null)
      this.heartbeat = this.deps.setTimer(() => this.beat(), HEARTBEAT_MS);
  }

  private endTurn(path: string, turn: LiveTurn, backOff = false) {
    const key = projectKey(path);
    if (turn.timer != null) this.deps.clearTimer(turn.timer);
    turn.timer = undefined;
    if (this.turns.get(key) !== turn) return;
    this.turns.delete(key);
    if (turn.goal)
      updateCrew(path, (crew) =>
        crew.planning ? { ...crew, planning: undefined } : crew,
      );
    releaseCrewJob(path, this.deps.owner);
    this.updateWorking();
    if (!this.turns.size && this.heartbeat != null) {
      this.deps.clearTimer(this.heartbeat);
      this.heartbeat = undefined;
    }
    // A turn that waits for a busy chat backs off: the pause wins over the
    // immediate look its own saves asked for, so it never spins.
    if (backOff && this.soon != null) {
      this.deps.clearTimer(this.soon);
      this.soon = undefined;
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
      [...this.turns.values(), ...this.talking.values()]
        .map((turn) => turn.sessionId)
        .filter(Boolean),
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
    if (
      !before ||
      this.memberChatAtWork(before, memberId) ||
      !claimCrewJob(path, this.deps.owner, now)
    )
      return;
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
      // With passed work stacked on the crew's branch, a new card builds on
      // top of it; the copy is matched to your files only when none is.
      const onStack = fresh ? stackHead(before) : undefined;
      const prepared = await this.prepareCopy(path, fresh && !onStack);
      if (!prepared || !this.stillOn(path, onAt))
        return this.endTurn(path, turn);
      const crew = prepared.crew;
      let card = crewCard(crew, cardId);
      if (!card) return this.endTurn(path, turn);
      if (fresh)
        card = { ...startCard(card, now), base: onStack ?? prepared.base };
      begun = card;
      if (!card.base)
        throw new Error("The card has no starting point in the copy.");
      // Switched off or removed meanwhile: the next look picks again.
      const member = crewMemberById(crew, memberId);
      if (!member || member.paused) return this.endTurn(path, turn);
      // A mock-up left in the copy is never this card's work: the folder
      // goes before a Builder, Checker or Security turn, so nothing of it
      // is ever stacked or applied to your files.
      await this.deps.mockups?.clear(crew.copy!.path).catch((error) => {
        logError("Crew mock-up folder", error);
      });
      // Settings an agent left in the copy (hooks, MCP servers) would run as
      // you: removed, and this turn doesn't start.
      const planted = await this.deps.copy.planted(crew.copy!.path, true);
      if (planted.length)
        throw new Error(
          `Aven found ${planted.join(", ")} in Avos's copy and removed ${
            planted.length === 1 ? "it" : "them"
          }: settings there could run commands as you. Look over the card before you try again.`,
        );
      const chat = await this.deps.ensureChat(
        crew,
        memberId,
        role === "builder"
          ? builderRunsOn(crew, crewMemberById(crew, memberId), card)
          : undefined,
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
        this.waitingOn.add(chat.id);
        return this.endTurn(path, turn, true);
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
        ...(member.memory ? { memory: member.memory } : {}),
        ...(member.scope?.length ? { scope: member.scope } : {}),
      };
      const text =
        role === "builder"
          ? builderMessage({
              card,
              notes: crew.notes,
              about: crew.about,
              names,
              brief,
              sync: prepared.sync,
              guidance,
            })
          : role === "security"
            ? securityMessage({
                card,
                notes: crew.notes,
                about: crew.about,
                names,
                brief,
                guidance,
              })
            : checkerMessage({
                card,
                notes: crew.notes,
                about: crew.about,
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
          this.deps.whyNotSent?.(chat.id) ??
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
          : sent.role === "researcher"
            ? cardResearcher(crew)
            : sent.role === "designer"
              ? cardDesigner(crew)
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

  /** The member's reply to a turn, without its notes block (read apart). */
  private turnReply(turn: LiveTurn, outcome?: ControlOutcome): string {
    return withoutMemory(
      replyForTurn(this.chatNow(turn.sessionId), turn.turnId) ||
        outcome?.text?.trim() ||
        "",
    );
  }

  /**
   * The member rewrote its notes at the end of a turn that finished: they
   * replace what it had, for it alone. A turn that failed, was stopped or
   * ran too long keeps the notes as they were.
   */
  private remember(path: string, turn: LiveTurn, outcome?: ControlOutcome) {
    if (
      turn.timedOut ||
      turn.stopping ||
      outcome?.status === "failed" ||
      outcome?.status === "cancelled"
    )
      return;
    let memory: string | null;
    try {
      memory = parseMemory(
        replyForTurn(this.chatNow(turn.sessionId), turn.turnId) ||
          outcome?.text?.trim() ||
          "",
      );
    } catch (error) {
      logError("Crew notes", error);
      return;
    }
    if (!memory) return;
    const now = this.deps.now();
    updateCrew(path, (current) =>
      crewMemberById(current, turn.memberId)
        ? withMemberMemory(current, turn.memberId, memory, now)
        : current,
    );
  }

  /** A turn ended: read it once, whichever of its end, the heartbeat or a recovery comes first. */
  async afterTurn(path: string, turn: LiveTurn, outcome?: ControlOutcome) {
    if (!this.markHandled(turn.turnId)) return;
    try {
      this.remember(path, turn, outcome);
      if (turn.goal) await this.afterGoal(path, turn, outcome);
      else if (turn.role === "scout" || turn.sweep)
        await this.afterScout(path, turn, outcome);
      else if (turn.role === "researcher")
        await this.afterResearchTurn(path, turn, outcome);
      else if (turn.role === "designer")
        await this.afterMockupTurn(path, turn, outcome);
      else await this.afterCardTurn(path, turn, outcome);
    } catch (error) {
      logError("Crew", error);
    } finally {
      // Its member's line goes with it, however it ended (stopped, thrown
      // away, or the crew turned off): it never shows Working afterwards.
      updateCrew(path, (current) =>
        withMemberId(current, turn.memberId, (member) =>
          member.doing ? { ...member, doing: undefined } : member,
        ),
      );
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
    if (turn.role === "researcher" || turn.role === "designer") return;
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
      const reply = this.turnReply(turn, outcome);
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
        // What changed can't be read: never "changed nothing" (that card
        // would step aside with its work still in the copy). It stops, and
        // holds the copy until you try it again.
        step =
          !diff && crew.copy && card.base
            ? turnFailed(card, {
                role,
                error: "Aven couldn't read what changed in Avos's copy",
                now,
                name: names.builder,
              })
            : afterBuild(card, {
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
    if (step.event.kind === "ready")
      step = await this.stackPassed(crew, step, role, turn.memberId, now);
    let saved = false;
    updateCrew(path, (current) => {
      // Stopped, thrown away or picked up again while this was read: the
      // card is yours now, not this turn's.
      if (crewCard(current, card.id)?.turn?.turnId !== turn.turnId)
        return current;
      saved = true;
      return this.commit(current, step, role, now, turn.memberId);
    });
    if (!saved) {
      await this.unstackUnsaved(crew, step.card);
      return;
    }
    if (step.event.kind === "ready")
      await Promise.resolve(this.deps.board.move(path, step.card.id, "review"));
  }

  /**
   * A card was stacked but not saved as Ready (stopped or thrown away
   * meanwhile): its commit comes back off the branch, its files left in
   * the copy as they are.
   */
  private async unstackUnsaved(crew: Crew, card: CrewCard) {
    if (!card.stacked || !crew.copy) return;
    await this.deps.copy
      .unstack(
        crew.copy.path,
        crew.copy.branch,
        card.stacked.commit,
        card.stacked.parent,
      )
      .catch((error) => logError("Crew unstack", error));
  }

  /**
   * A card passed every check: its work becomes a commit on the crew's
   * branch, so the next card builds on top and it waits, with the others,
   * for your Apply. It can't be stacked (the copy moved): it stops, with
   * why, and nothing is lost.
   */
  private async stackPassed(
    crew: Crew,
    step: LoopStep,
    role: CrewLoopRole,
    memberId: string,
    now: number,
  ): Promise<LoopStep> {
    const card = step.card;
    if (!crew.copy || !card.base) return step;
    const hash = card.fix?.hash;
    try {
      if (!hash) throw new Error("it has no checked change");
      const commit = await this.deps.copy.stack(
        crew.copy.path,
        crew.copy.branch,
        card.base,
        card.title,
        hash,
      );
      return {
        ...step,
        card: { ...card, stacked: { commit, parent: card.base, hash } },
      };
    } catch (error) {
      logError("Crew stack", error);
      // A file's name reads as a settings folder on a Mac: it stops for
      // good, with which file, rather than fail the same way run after run.
      const lookAlike = lookAlikePath(error);
      if (lookAlike) {
        const text = lookAlikeText(lookAlike);
        return {
          card: {
            ...card,
            stage: "stuck",
            stuck: { reason: "unsafe-name", text },
            turn: undefined,
            endedAt: now,
            updatedAt: now,
          },
          event: { kind: "stuck", reason: "unsafe-name", text },
        };
      }
      // The copy changed after its checks: it's checked again, never
      // stacked as something that wasn't checked.
      if (isStackChanged(error)) {
        const checker = this.deps.name(
          crew,
          card.checkerId ?? cardChecker(crew, card)?.id ?? "checker",
        );
        const text = `The copy changed after ${checker}'s check, so it wasn't stacked. One more round checks it again`;
        const moved = changedAfterCheck(card, { now, checker });
        return {
          card: { ...moved, stuck: { reason: "changed", text } },
          event: { kind: "stuck", reason: "changed", text },
        };
      }
      return turnFailed(card, {
        role,
        error: `its work couldn't be stacked on Avos's branch: ${errorText(error)}`,
        now,
        name: this.deps.name(crew, memberId),
      });
    }
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
          text: `${checker} passed round ${event.round}; ${securityReviewsIt(security)}`,
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
            ? `Ready for you · passed ${checker}'s check and ${securityReviewBy(security)} in round ${event.round}`
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
    // The first card on the crew's branch starts the batch.
    if (card.stacked && !next.stack)
      next = { ...next, stack: { base: card.stacked.parent } };
    next = withMemberId(next, memberId, (member) =>
      member.doing ? { ...member, doing: undefined } : member,
    );
    // What came of it goes back to Avos, which tells you in its own words,
    // over the buttons to review it. A question asks you itself.
    const lead = crewLead(next);
    if (
      lead &&
      memberOn(lead) &&
      next.on &&
      (event.kind === "ready" || event.kind === "stuck")
    )
      next = withTalk(next, {
        at: now,
        from: memberId,
        fromName:
          role === "builder"
            ? builder
            : role === "checker"
              ? checker
              : security,
        to: lead.id,
        text: jobReport({
          title: card.title,
          outcome:
            event.kind === "ready"
              ? { ready: event.round }
              : { stopped: event.text },
          builder,
          checker,
          ...(round ? { round } : {}),
        }),
        // Nothing is passed on for it, and nothing comes back.
        hop: TALK_HOPS,
        answer: true,
        report: true,
      });
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
    if (!before) return;
    const looker =
      by === "security" ? cardSecurity(before) : crewMember(before, "scout");
    if (
      !looker ||
      this.memberChatAtWork(before, looker.id) ||
      !claimCrewJob(path, this.deps.owner, now)
    )
      return;
    const sweep = by === "security";
    const turn: LiveTurn = {
      role: by,
      memberId: looker.id,
      // As its turn starts: a change meanwhile doesn't unread what it read.
      ...(by === "scout" && crewRoleUsesWeb(before, "scout")
        ? { web: true }
        : {}),
      ...(sweep ? { sweep: true } : {}),
      sessionId: "",
      turnId: this.newId(),
      onAt: before.onAt,
    };
    this.beginTurn(key, turn);
    try {
      // The copy is idle (no card in it), so it is safe to match it to your
      // files, unless passed work waits on the crew's branch: never lost.
      const prepared = await this.prepareCopy(path, !stackHead(before));
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
      if (chatAtWork(chat)) {
        this.waitingOn.add(chat.id);
        return this.endTurn(path, turn, true);
      }
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
        ...(member.memory ? { memory: member.memory } : {}),
        ...(member.scope?.length ? { scope: member.scope } : {}),
      };
      const text = sweep
        ? sweepMessage({
            notes: crew.notes,
            about: crew.about,
            boardTitles,
            brief,
            sync: prepared.sync,
            guidance,
          })
        : scoutMessage({
            notes: crew.notes,
            about: crew.about,
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
          this.deps.whyNotSent?.(chat.id) ??
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
      const at = this.deps.now();
      const text = errorText(error);
      updateCrew(path, (current) =>
        // It looked, even if it failed: no retry loop. The feed says why.
        withFeed(
          {
            ...current,
            ...(sweep ? { sweepAt: at } : { scoutAt: at }),
            lastError: { at, text },
          },
          {
            at,
            kind: "hold",
            who: "aven",
            member: turn.memberId,
            text: sweep
              ? `${this.deps.name(current, turn.memberId)}'s security sweep didn't go: ${text}`
              : `${this.deps.name(current, turn.memberId)} couldn't look for ideas: ${text}`,
          },
        ),
      );
      this.endTurn(path, turn);
    }
  }

  // -------------------------------------------------------------------------
  // The Researcher and the Designer: a card's one turn of its own

  /**
   * A research or mock-up card's next step: its member's one turn, or a
   * hold while that member is off or gone.
   */
  private stepSolo(crew: Crew, card: CrewCard, now: number) {
    const role = card.kind === "mockup" ? "designer" : "researcher";
    const member =
      role === "designer" ? cardDesigner(crew) : cardResearcher(crew);
    if (!member) return this.hold(crew, crewNoMemberGate(role));
    const gate = this.gate(crew, now);
    if (!gate.ok) return this.hold(crew, gate);
    this.clearHold(crew);
    return this.sendSoloTurn(crew.path, card.id, member.id, role);
  }

  /**
   * A research card's one turn: the Researcher reads (the copy, and the web
   * when Access allows it) and hands back findings. Read-only, like a
   * check: a change to the copy during it voids its findings. A mock-up
   * card's the same for the Designer, which writes one file in its folder
   * and nothing else.
   */
  private async sendSoloTurn(
    path: string,
    cardId: string,
    memberId: string,
    role: "researcher" | "designer",
  ) {
    const key = projectKey(path);
    const now = this.deps.now();
    const before = getCrew(path);
    if (
      !before ||
      this.memberChatAtWork(before, memberId) ||
      !claimCrewJob(path, this.deps.owner, now)
    )
      return;
    const onAt = before.onAt;
    const turn: LiveTurn = {
      role,
      memberId,
      cardId,
      // As its turn starts: a change meanwhile doesn't unread what it read.
      ...(role === "researcher" && crewRoleUsesWeb(before, "researcher")
        ? { web: true }
        : {}),
      sessionId: "",
      turnId: this.newId(),
      onAt,
    };
    this.beginTurn(key, turn);
    const queued = crewCard(before, cardId);
    const from = queued ? cardAt(queued) : undefined;
    let begun: CrewCard | undefined;
    try {
      if (!queued || !from || !cardStillAt(queued, from))
        return this.endTurn(path, turn);
      const fresh = queued.stage === "queued";
      const onStack = fresh ? stackHead(before) : undefined;
      const prepared = await this.prepareCopy(path, fresh && !onStack);
      if (!prepared || !this.stillOn(path, onAt))
        return this.endTurn(path, turn);
      const crew = prepared.crew;
      let card = crewCard(crew, cardId);
      if (!card) return this.endTurn(path, turn);
      if (fresh)
        card = { ...startCard(card, now), base: onStack ?? prepared.base };
      begun = card;
      if (!card.base)
        throw new Error("The card has no starting point in the copy.");
      // Read again after a turn that changed files: whatever it left in the
      // copy goes, so a reader's stray change never reaches the next card.
      if (!fresh && crew.copy)
        await this.deps.copy.discard(
          crew.copy.path,
          card.base,
          crew.copy.branch,
        );
      const member = crewMemberById(crew, memberId);
      if (!member || member.paused || member.role !== role)
        return this.endTurn(path, turn);
      const planted = await this.deps.copy.planted(crew.copy!.path, true);
      if (planted.length)
        throw new Error(
          `Aven found ${planted.join(", ")} in Avos's copy and removed ${
            planted.length === 1 ? "it" : "them"
          }: settings there could run commands as you. Look over the card before you try again.`,
        );
      const chat = await this.deps.ensureChat(crew, memberId);
      if (!chat)
        throw new Error(
          `Couldn't open ${this.deps.name(crew, memberId)}'s chat.`,
        );
      if (!this.stillOn(path, onAt)) return this.endTurn(path, turn);
      if (chatAtWork(chat)) {
        if (fresh)
          updateCrew(path, (current) =>
            cardStillAt(crewCard(current, cardId), from)
              ? withCard(current, card!)
              : current,
          );
        this.waitingOn.add(chat.id);
        return this.endTurn(path, turn, true);
      }
      turn.sessionId = chat.id;
      this.updateWorking();
      // Each question starts a new conversation: nothing from one card
      // reaches another.
      if (chat.providerSessionId) this.deps.freshConversation?.(chat.id);
      const brief =
        chat.providerSessionId && !this.deps.freshConversation
          ? undefined
          : crewBrief({
              role,
              name: this.deps.name(crew, memberId),
              project: crew.path,
              copyPath: crew.copy?.path ?? "",
              names: this.names(crew),
              harness: crewMemberApp(member).harness,
              maxRounds: 1,
            });
      const diff = await this.deps.copy.diff(crew.copy!.path, card.base);
      const hashBefore = diff.hash;
      const guidance = {
        ...(member.instructions ? { instructions: member.instructions } : {}),
        ...(member.memory ? { memory: member.memory } : {}),
      };
      const text =
        role === "designer"
          ? mockupMessage({
              card,
              notes: crew.notes,
              about: crew.about,
              brief,
              sync: prepared.sync,
              guidance,
              file: `${MOCKUP_DIR}/${mockupFileName(card.id)}`,
            })
          : researchMessage({
              card,
              notes: crew.notes,
              about: crew.about,
              brief,
              sync: prepared.sync,
              guidance,
              web: !!turn.web,
            });
      const label = crewTurnLabel({ role, card });
      await this.deps.beforeSend?.(chat.id);
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
          this.deps.whyNotSent?.(chat.id) ??
            `Couldn't send ${this.deps.name(crew, memberId)} the card.`,
        );
      turn.sentAt = this.deps.now();
      const started = card;
      const who = this.deps.name(crew, memberId);
      let saved = false;
      updateCrew(path, (current) => {
        if (!cardStillAt(crewCard(current, cardId), from)) return current;
        saved = true;
        let next = withCrewRun(current, turn.sentAt!);
        next = withCard(next, {
          ...started,
          turn: {
            role,
            sessionId: chat.id,
            turnId: turn.turnId,
            sentAt: turn.sentAt!,
            hashBefore,
          },
          runs: started.runs + 1,
          updatedAt: turn.sentAt!,
        });
        next = withMemberId(next, memberId, (entry) => ({
          ...entry,
          sessionId: chat.id,
          doing: {
            at: turn.sentAt!,
            text:
              role === "designer"
                ? `Mocking up ${started.title}`
                : `Reading for ${started.title}`,
          },
        }));
        return fresh
          ? withFeed(next, {
              at: turn.sentAt!,
              kind: "start",
              who: role,
              member: memberId,
              cardId: started.id,
              title: started.title,
              text:
                role === "designer"
                  ? `${who} started mocking up “${started.title}”`
                  : `${who} started reading for “${started.title}”`,
            })
          : next;
      });
      if (!saved) {
        turn.stopping = true;
        this.deps.stopChat(chat.id);
        this.markHandled(turn.turnId);
        return this.endTurn(path, turn);
      }
      this.armTimeout(path, turn, crew.limits.turnMinutes);
    } catch (error) {
      logError(role === "designer" ? "Crew mock-up" : "Crew research", error);
      const now = this.deps.now();
      updateCrew(path, (current) => {
        const card = crewCard(current, cardId);
        if (!card || !from || !cardStillAt(card, from)) return current;
        const started =
          card.stage === "queued" ? (begun ?? startCard(card, now)) : card;
        return this.commitSolo(
          current,
          turnFailed(started, {
            role,
            error: errorText(error),
            now,
            name: this.deps.name(current, memberId),
          }),
          now,
          memberId,
        );
      });
      this.endTurn(path, turn);
    }
  }

  /**
   * The Designer's turn ended: the one file it drew in its folder, if that
   * is all it wrote and Aven accepts it, is kept in Aven's own data and the
   * card is Mock-up, in Ready for you. The copy's folder is emptied and the
   * copy put back to the card's base, so nothing of it reaches the next
   * card or Avos's branch. A turn that wrote elsewhere holds the copy
   * and stops with why; one that failed, was stopped, ran too long or left
   * nothing Aven can keep stops too.
   */
  private async afterMockupTurn(
    path: string,
    turn: LiveTurn,
    outcome?: ControlOutcome,
  ) {
    const crew = getCrew(path);
    if (!crew?.on || !turn.cardId) return;
    const card = crewCard(crew, turn.cardId);
    if (!card || card.turn?.turnId !== turn.turnId) return;
    const now = this.deps.now();
    const name = this.deps.name(crew, turn.memberId);
    const copy = crew.copy?.path;
    let step: LoopStep;
    if (turn.timedOut)
      step = turnTimedOut(card, {
        role: "designer",
        minutes: crew.limits.turnMinutes,
        now,
        name,
      });
    else if (outcome?.status === "failed" || outcome?.status === "cancelled")
      step = turnFailed(card, {
        role: "designer",
        error:
          outcome.status === "cancelled" ? "it was stopped" : outcome.error,
        now,
        name,
      });
    else step = await this.readMockup(crew, card, turn, outcome, now, name);
    // However it ended, nothing of the turn's own stays in the copy: its
    // folder goes and the copy is put back to the card's base, so the card
    // steps aside with a clean copy and nothing is ever stacked from it. A
    // turn that wrote elsewhere keeps its stray files, for you to see (Try
    // again discards them first).
    const strayed =
      step.event.kind === "stuck" && step.event.reason === "checker-edited";
    if (copy && !strayed) {
      await this.deps.mockups?.clear(copy).catch((error) => {
        logError("Crew mock-up folder", error);
      });
      if (card.base && crew.copy)
        await this.deps.copy
          .discard(copy, card.base, crew.copy.branch)
          .catch((error) => {
            logError("Crew copy discard", error);
          });
    }
    if (!this.stillOn(path, turn.onAt)) return;
    let saved = false;
    updateCrew(path, (current) => {
      if (crewCard(current, card.id)?.turn?.turnId !== turn.turnId)
        return current;
      saved = true;
      return this.commitSolo(current, step, now, turn.memberId);
    });
    if (saved && step.event.kind === "ready")
      await Promise.resolve(this.deps.board.move(path, card.id, "review"));
  }

  /** What the Designer's turn left: its one file, kept by Aven, or why not. */
  private async readMockup(
    crew: Crew,
    card: CrewCard,
    turn: LiveTurn,
    outcome: ControlOutcome | undefined,
    now: number,
    name: string,
  ): Promise<LoopStep> {
    const reply = this.turnReply(turn, outcome);
    const copy = crew.copy?.path;
    const diff =
      copy && card.base
        ? await this.deps.copy.diff(copy, card.base).catch((error) => {
            logError("Crew diff", error);
            return null;
          })
        : null;
    if (!diff || !copy)
      return afterMockup(card, {
        mockup: null,
        problem: "Aven couldn't read Avos's copy after its turn",
        now,
        name,
      });
    const written = diff.files.map((file) => file.path);
    // Anything outside its folder, or a link (which could point anywhere,
    // your project included), is a stray: the turn stops with why.
    const stray = diff.files
      .filter(
        (file) => !insideMockupDir(file.path) || file.newMode === "120000",
      )
      .map((file) =>
        file.newMode === "120000" ? `${file.path} (a link)` : file.path,
      );
    // New top-level entries Git can't see (ignored ones, `.env`, a folder of
    // its own): strays too, and gone at once, since no diff would show them.
    // Aven's own folder isn't one (see `AVEN_DIR`): the Designer's rules
    // keep it out, and what Aven keeps there stays.
    const before = new Set(
      (crew.copy?.entries ?? []).map((entry) => basename(entry)),
    );
    const after = this.deps.copy.entries
      ? await this.deps.copy.entries(copy).catch((error) => {
          logError("Crew copy listing", error);
          return null;
        })
      : [];
    // A listing that fails can't say the copy is clean: the mock-up isn't kept.
    if (!after)
      return afterMockup(card, {
        mockup: null,
        problem: "Aven couldn't list Avos's copy after its turn",
        now,
        name,
      });
    const unseen = after
      .map((entry) => basename(entry))
      .filter(
        (entry) =>
          !before.has(entry) &&
          entry !== MOCKUP_DIR &&
          entry !== AVEN_DIR &&
          entry !== ".git",
      );
    if (unseen.length)
      await this.deps.mockups?.clear(copy, unseen).catch((error) => {
        logError("Crew mock-up folder", error);
      });
    if (stray.length || unseen.length)
      return afterMockup(card, {
        mockup: null,
        strayed: true,
        // A stray top-level file is in the diff and in the listing: once.
        problem: [...new Set([...stray, ...unseen])].slice(0, 5).join(", "),
        now,
        name,
      });
    const parsed = parseMockup(reply);
    const fail = (problem: string) =>
      afterMockup(card, { mockup: null, problem, now, name });
    if (!parsed) {
      if (!written.length)
        return afterMockup(card, { mockup: null, now, name });
      return fail("its reply named no file");
    }
    if (!insideMockupDir(parsed.file))
      return fail(`the file it named isn't inside ${MOCKUP_DIR}/`);
    const relative = parsed.file.replace(/\\/g, "/").replace(/^\.\//, "");
    if (written.length !== 1)
      return fail(
        written.length
          ? `it wrote ${written.length} files; a mock-up is one`
          : "it wrote no file",
      );
    if (written[0] !== relative)
      return fail(`it named ${relative} but wrote ${written[0]}`);
    if (!this.deps.mockups) return fail("Aven can't keep mock-ups here");
    let html: string;
    try {
      html = await this.deps.mockups.read(`${copy}/${relative}`);
    } catch (error) {
      logError("Crew mock-up read", error);
      return fail("Aven couldn't read the file");
    }
    const problem = mockupProblem(html);
    if (problem) return fail(problem);
    let kept: string;
    try {
      kept = await this.deps.mockups.save(copy, card.id, html);
    } catch (error) {
      logError("Crew mock-up save", error);
      return fail("Aven couldn't keep the file");
    }
    return afterMockup(card, {
      mockup: {
        file: kept,
        note: parsed.note,
        bytes: new TextEncoder().encode(html).length,
      },
      now,
      name,
    });
  }

  /**
   * The Researcher's turn ended: its findings make the card Findings, in
   * Ready for you, with nothing to apply. A turn that failed, was stopped
   * or ran too long, or one that changed the copy, stops the card with why.
   */
  private async afterResearchTurn(
    path: string,
    turn: LiveTurn,
    outcome?: ControlOutcome,
  ) {
    const crew = getCrew(path);
    if (!crew?.on || !turn.cardId) return;
    const card = crewCard(crew, turn.cardId);
    if (!card || card.turn?.turnId !== turn.turnId) return;
    const now = this.deps.now();
    const name = this.deps.name(crew, turn.memberId);
    let step: LoopStep;
    if (turn.timedOut)
      step = turnTimedOut(card, {
        role: "researcher",
        minutes: crew.limits.turnMinutes,
        now,
        name,
      });
    else if (outcome?.status === "failed" || outcome?.status === "cancelled")
      step = turnFailed(card, {
        role: "researcher",
        error:
          outcome.status === "cancelled" ? "it was stopped" : outcome.error,
        now,
        name,
      });
    else {
      const reply = this.turnReply(turn, outcome);
      const diff =
        crew.copy && card.base
          ? await this.deps.copy
              .diff(crew.copy.path, card.base)
              .catch((error) => {
                logError("Crew diff", error);
                return null;
              })
          : null;
      // A reader that changed the copy is void; a copy Aven can't read says so.
      const unreadable = !diff && !!crew.copy && !!card.base;
      const edited =
        !!diff && !!card.turn.hashBefore && diff.hash !== card.turn.hashBefore;
      step = afterResearch(card, {
        findings: parseFindings(reply),
        edited,
        unreadable,
        now,
        name,
      });
    }
    if (!this.stillOn(path, turn.onAt)) return;
    let saved = false;
    updateCrew(path, (current) => {
      if (crewCard(current, card.id)?.turn?.turnId !== turn.turnId)
        return current;
      saved = true;
      return this.commitSolo(current, step, now, turn.memberId);
    });
    if (saved && step.event.kind === "ready")
      await Promise.resolve(this.deps.board.move(path, card.id, "review"));
  }

  /** Save a solo step (research or mock-up): the card, the feed line, and the member's line. */
  private commitSolo(
    crew: Crew,
    step: LoopStep,
    now: number,
    memberId: string,
  ): Crew {
    const { card, event } = step;
    const who = this.deps.name(crew, memberId);
    const mockup = card.kind === "mockup";
    const entry: Omit<CrewFeedEntry, "id"> =
      event.kind === "ready"
        ? {
            at: now,
            kind: mockup ? "mockup" : "findings",
            who: mockup ? "designer" : "researcher",
            member: memberId,
            cardId: card.id,
            title: card.title,
            text: mockup
              ? `${who} mocked up “${card.title}”${card.mockup?.note ? `: ${card.mockup.note}` : ""}`
              : `${who} read ${sourcesText(card.findings?.sources ?? 0)} for “${card.title}”: ${card.findings?.summary ?? ""}`,
          }
        : {
            at: now,
            kind: "stuck",
            who: "aven",
            member: memberId,
            cardId: card.id,
            title: card.title,
            text: event.kind === "stuck" ? event.text : "",
          };
    // Findings live on the Board, not in the Inbox: nothing to apply there.
    const noted = withFeed(withCard(crew, card), entry);
    return withMemberId(noted, memberId, (member) =>
      member.doing ? { ...member, doing: undefined } : member,
    );
  }

  // -------------------------------------------------------------------------
  // The goal

  /** The goal stops, with why: met, nothing left to plan, or no one to plan. */
  private stopGoal(crew: Crew, text: string, now: number, met = false) {
    updateCrew(crew.path, (current) =>
      current.goal && !current.goal.done
        ? withFeed(
            {
              ...current,
              goal: { ...current.goal, done: { at: now, text, met } },
            },
            {
              at: now,
              kind: met ? "ready" : "hold",
              who: "aven",
              text: met ? `Goal met: ${text}` : text,
            },
          )
        : current,
    );
  }

  /**
   * A goal turn: the Scout (or a Builder, when the crew has no Scout) reads
   * the project as the crew's copy holds it and says whether the goal is
   * met, or plans the next card. It only reads: anything written in the
   * copy meanwhile is undone.
   */
  private async sendGoalTurn(path: string, cards: readonly FeatureCard[]) {
    const key = projectKey(path);
    const now = this.deps.now();
    const before = getCrew(path);
    const planner = before ? goalPlanner(before) : undefined;
    if (
      !before?.goal ||
      !planner ||
      this.memberChatAtWork(before, planner.id) ||
      !claimCrewJob(path, this.deps.owner, now)
    )
      return;
    const turn: LiveTurn = {
      role: planner.role === "scout" ? "scout" : "builder",
      memberId: planner.id,
      goal: {},
      sessionId: "",
      turnId: this.newId(),
      onAt: before.onAt,
    };
    this.beginTurn(key, turn);
    // It plans offline: its chat launches without the web for this turn.
    updateCrew(path, (crew) => ({ ...crew, planning: planner.id }));
    try {
      const onStack = stackHead(before);
      const prepared = await this.prepareCopy(path, !onStack);
      if (!prepared || !this.stillOn(path, turn.onAt))
        return this.endTurn(path, turn);
      turn.goal = {
        ...((onStack ?? prepared.base)
          ? { base: onStack ?? prepared.base }
          : {}),
        ...(prepared.crew.goal
          ? { text: prepared.crew.goal.text, at: prepared.crew.goal.at }
          : {}),
      };
      const crew = prepared.crew;
      const member = crewMemberById(crew, turn.memberId);
      if (!member || member.paused || !crew.goal || crew.goal.done)
        return this.endTurn(path, turn);
      const chat = await this.deps.ensureChat(crew, turn.memberId);
      if (!chat)
        throw new Error(
          `Couldn't open ${this.deps.name(crew, turn.memberId)}'s chat.`,
        );
      if (chatAtWork(chat)) {
        this.waitingOn.add(chat.id);
        return this.endTurn(path, turn, true);
      }
      turn.sessionId = chat.id;
      this.updateWorking();
      if (chat.providerSessionId) this.deps.freshConversation?.(chat.id);
      const brief =
        chat.providerSessionId && !this.deps.freshConversation
          ? undefined
          : crewBrief({
              role: turn.role === "scout" ? "scout" : "builder",
              name: this.deps.name(crew, turn.memberId),
              project: crew.path,
              copyPath: crew.copy?.path ?? "",
              names: this.names(crew),
              harness: crewMemberApp(member).harness,
              maxRounds: crew.limits.roundsPerCard,
            });
      const text = goalMessage({
        goal: crew.goal.text,
        ...(crew.goal.by ? { goalBy: this.deps.name(crew, crew.goal.by) } : {}),
        done: goalCardsDone(crew),
        dropped: crew.goal.dropped ?? [],
        notes: crew.notes,
        about: crew.about,
        boardTitles: cards
          .filter((card) => card.column !== "shipped")
          .map((card) => card.title),
        brief,
        sync: prepared.sync,
        guidance: {
          ...(member.instructions ? { instructions: member.instructions } : {}),
          ...(member.memory ? { memory: member.memory } : {}),
        },
      });
      const label = "Goal · what's next";
      const idle = getCrew(path);
      if (
        !this.mayStillSend(path, turn.onAt) ||
        !idle?.goal ||
        idle.goal.done ||
        cardInCopy(idle) ||
        queuedCards(idle).length
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
          this.deps.whyNotSent?.(chat.id) ??
            `Couldn't send ${this.deps.name(crew, turn.memberId)} its turn.`,
        );
      turn.sentAt = this.deps.now();
      updateCrew(path, (current) =>
        withMemberId(
          {
            ...withCrewRun(current, turn.sentAt!),
            // The Scout's look for today is this one.
            ...(turn.role === "scout" ? { scoutAt: turn.sentAt } : {}),
          },
          turn.memberId,
          (entry) => ({
            ...entry,
            sessionId: chat.id,
            doing: {
              at: turn.sentAt!,
              text: "Planning the next card for the goal",
            },
          }),
        ),
      );
      this.armTimeout(path, turn, crew.limits.turnMinutes);
    } catch (error) {
      logError("Crew goal", error);
      const current = getCrew(path);
      if (current)
        this.stopGoal(
          current,
          `${this.deps.name(current, turn.memberId)} couldn't plan the next card: ${errorText(error)}`,
          this.deps.now(),
        );
      this.endTurn(path, turn);
    }
  }

  /**
   * A goal turn ended: the goal is met, or its next card is queued (and
   * starts within the crew's limits), or the crew found nothing left to
   * plan and stops to ask. A turn that failed or ran too long stops it too.
   */
  private async afterGoal(
    path: string,
    turn: LiveTurn,
    outcome?: ControlOutcome,
  ) {
    const crew = getCrew(path);
    if (!crew) return;
    const now = this.deps.now();
    const who = this.deps.name(crew, turn.memberId);
    // Planning only reads: whatever was written in the copy meanwhile goes,
    // whether or not the goal or the crew is still on, and only while the
    // branch is still where the turn began (nothing stacked since is lost).
    const base = turn.goal?.base;
    if (base && crew.copy) {
      const diff = await this.deps.copy
        .diff(crew.copy.path, base)
        .catch((error) => {
          logError("Crew goal undo check", error);
          return null;
        });
      // Unchecked, the copy may hold what planning wrote: nothing builds on
      // it until you look. The goal stops, and the feed says why.
      if (!diff)
        return this.stopGoal(
          crew,
          `Aven couldn't check Avos's copy after ${who}'s planning, so Avos stopped. Look over the copy, then Keep going to try again.`,
          now,
        );
      if (diff.files.length) {
        await this.deps.copy
          .discard(crew.copy.path, base, crew.copy.branch, base)
          .catch((error) => logError("Crew goal undo", error));
        updateCrew(path, (current) =>
          withFeed(current, {
            at: now,
            kind: "hold",
            who: "aven",
            text: `Aven undid what ${who} changed in Avos's copy while planning: planning only reads.`,
          }),
        );
      }
    }
    if (!crew.on || !this.stillOn(path, turn.onAt) || !crew.goal) return;
    if (crew.goal.done) return;
    // The answer is about the goal it was asked: a goal you changed or set
    // again meanwhile is planned afresh.
    if (turn.goal?.text !== crew.goal.text || turn.goal?.at !== crew.goal.at)
      return;
    if (
      outcome?.status === "failed" ||
      outcome?.status === "cancelled" ||
      turn.stopping ||
      turn.timedOut
    )
      return this.stopGoal(
        crew,
        turn.timedOut
          ? `${who}'s planning ran past ${crew.limits.turnMinutes} minutes, so Avos stopped. Keep going to try again.`
          : `${who}'s planning didn't finish${outcome?.error ? `: ${outcome.error}` : ""}. Keep going to try again.`,
        now,
      );
    const reply = this.turnReply(turn, outcome);
    const answer = parseGoal(reply);
    if (!answer)
      return this.stopGoal(
        crew,
        `${who}'s planning ended without an answer, so Avos stopped. Keep going to try again.`,
        now,
      );
    if (answer.met)
      return this.stopGoal(crew, answer.summary || crew.goal.text, now, true);
    if (!answer.next.length)
      return this.stopGoal(
        crew,
        `Nothing left to plan for the goal${answer.summary ? `: ${answer.summary.replace(/[.!]+$/, "")}` : ""}. Avos stops here.`,
        now,
      );
    // A card you threw away is never planned again.
    const fresh = answer.next.filter((task) => !goalDropped(crew, task.title));
    if (!fresh.length)
      return this.stopGoal(
        crew,
        `${who} planned only cards you threw away (${answer.next
          .map((task) => task.title)
          .join(" · ")}), so Avos stopped. Keep going to plan again.`,
        now,
      );
    answer.next = fresh;
    const drafts = answer.next.map((task) => ({
      title: task.title,
      ...(task.why ? { note: task.why } : {}),
      column: "building" as const,
    }));
    let added: readonly FeatureCard[] = [];
    try {
      added = await this.deps.board.add(path, drafts);
    } catch (error) {
      logError("Crew goal card", error);
    }
    // Nothing was added: it stops, with why, rather than plan again and again.
    if (!added.length)
      return this.stopGoal(
        crew,
        `Aven couldn't add the card ${who} planned for the goal to the Board, so Avos stopped. Keep going to try again.`,
        now,
      );
    updateCrew(path, (current) => {
      let next = withMemberId(current, turn.memberId, (member) =>
        member.doing ? { ...member, doing: undefined } : member,
      );
      added.forEach((card, index) => {
        const task = answer.next[index]!;
        next = withCard(next, {
          ...queueCard(
            {
              id: card.id,
              title: card.title,
              brief: [card.title, task.why].filter(Boolean).join("\n\n"),
              // A bot's words: the Builder reads them as data.
              from: "scout",
              maxRounds: current.limits.roundsPerCard,
            },
            now,
          ),
          goal: true,
        });
      });
      return withFeed(next, {
        at: now,
        kind: "idea",
        who: turn.role === "scout" ? "scout" : "builder",
        member: turn.memberId,
        text: `${who} planned the next card for the goal: ${added
          .map((card) => card.title)
          .join(" · ")}`,
      });
    });
    this.schedule();
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
    const reply = this.turnReply(turn, outcome);
    // A look that failed, was stopped, or ran too long adds nothing.
    const ideas =
      outcome?.status === "failed" ||
      outcome?.status === "cancelled" ||
      turn.stopping ||
      turn.timedOut
        ? []
        : parseIdeas(reply).slice(
            0,
            sweep ? SWEEP_CARDS : ideasLeft(crew, now),
          );
    // Not to start before they are marked as the Scout's, below.
    const releaseIdeas = holdIdeaStarts(path);
    const added = await (
      ideas.length
        ? this.deps.board.add(
            path,
            ideas.map((idea) => ({
              title: idea.title,
              ...(idea.why ? { note: idea.why } : {}),
              ...(idea.sourceUrl ? { sourceUrl: idea.sourceUrl } : {}),
              column: "idea" as const,
            })),
          )
        : Promise.resolve([])
    ).catch((error: unknown) => {
      releaseIdeas();
      throw error;
    });
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
          // A Scout that may read the web: what it found could be anyone's
          // words, so its ideas wait for you.
          ...(idea.outside || turn.web || crewRoleUsesWeb(next, "scout")
            ? { outside: true }
            : {}),
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
    releaseIdeas();
  }

  // -------------------------------------------------------------------------
  // Watching the crews' chats

  /**
   * A turn that waits on you (an approval, a question) puts its card in
   * Needs you while it waits, and back once you answer. A busy chat a turn
   * waited for is free again: the crews are looked at now.
   */
  observe(sessions: readonly Session[]) {
    if (!this.running) return;
    // Your message's answer, as far as it's written, for the Avos screen.
    for (const entry of this.talking.values()) {
      if (!entry.live || !entry.turnId) continue;
      const chat = sessions.find((session) => session.id === entry.sessionId);
      setCrewLiveReply(
        entry.path,
        entry.to,
        chat ? talkAnswerText(replyForTurn(chat, entry.turnId)) : null,
      );
    }
    for (const id of [...this.waitingOn]) {
      const chat = sessions.find((session) => session.id === id);
      if (chat && chatAtWork(chat)) continue;
      this.waitingOn.delete(id);
      this.schedule();
    }
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
