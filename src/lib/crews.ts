import { useSyncExternalStore } from "react";
import { isEqualOrInside, projectKey } from "./paths";
import {
  BOT_DEFAULT_QUIET,
  BOT_JOB_STALE_MS,
  botsAvailable,
  jobIsLive,
  localDay,
  projectBotsSnapshot,
  registerBotChatSource,
  subscribeProjectBots,
  type BotJob,
  type BotQuietHours,
  type ProjectBot,
} from "./projectBots";
import { SECURITY_INSTRUCTIONS } from "./crewPresets";
import { normalizeProjectPath } from "./recents";
import type { AutomationReview } from "./automationReview";
import { registerGuardedChats } from "./harness/sessionPermissions";

/**
 * Crews: a project's bots working as one. Each member has a role (Builder,
 * Checker, Scout, and the project bot as Fixer). Aven passes a Board card
 * from the Builder to the Checker and back, counts the rounds and keeps the
 * limits (see `crewLoop`, `crewLimits` and `crewRunner`); the bots never
 * message each other.
 *
 * This module keeps each project's crew, keyed by `projectKey`, in one
 * store every window shares. The project bot keeps its own store, untouched:
 * a crew only points at it as its Fixer, so a crew can be turned off (or this
 * build rolled back) without losing anything the bot had.
 */

export const CREWS_KEY = "aven.crews.v1";

/**
 * The roles this build knows. A new role (Keeper, a custom one) adds itself
 * here, to `CREW_ROLE_INFO`, and to the runner's wake rules; members of a
 * role this build does not know are kept in storage as they are.
 */
export type CrewRole = "builder" | "checker" | "security" | "scout" | "fixer";

/** The roles that take turns on cards in the crew's copy. */
export type CrewLoopRole = "builder" | "checker" | "security";

export type CrewRoleInfo = {
  role: CrewRole;
  label: string;
  /** The critter it is drawn as; the Fixer is the project's own. */
  critter?: string;
  /** Its critter's colour. */
  color?: string;
  /** Its job, one line. */
  job: string;
  /** May it change files in the crew's copy? */
  edits: boolean;
};

export const CREW_ROLE_INFO: Readonly<Record<CrewRole, CrewRoleInfo>> = {
  builder: {
    role: "builder",
    label: "Builder",
    critter: "beetle",
    color: "hsl(28 82% 58%)",
    job: "Builds the cards you give the crew",
    edits: true,
  },
  checker: {
    role: "checker",
    label: "Checker",
    critter: "owl",
    color: "hsl(232 72% 76%)",
    job: "Checks every build before you see it",
    edits: false,
  },
  security: {
    role: "security",
    label: "Security",
    critter: "hedgehog",
    color: "hsl(30 32% 64%)",
    job: "Reviews each passed build for security before you see it",
    edits: false,
  },
  scout: {
    role: "scout",
    label: "Scout",
    critter: "fox",
    color: "hsl(338 74% 72%)",
    job: "Finds small ideas worth building",
    edits: false,
  },
  fixer: {
    role: "fixer",
    label: "Fixer",
    job: "Checks each chat and the dev server, and fixes what breaks",
    edits: true,
  },
};

/** The order members are listed in: who builds, who checks, who finds. */
export const CREW_ROLE_ORDER: readonly CrewRole[] = [
  "builder",
  "checker",
  "security",
  "scout",
  "fixer",
];

export type CrewMember = {
  /**
   * Stable within its crew. Members from before ids keep their role's name
   * ("builder", "checker"…), so older crews read unchanged.
   */
  id: string;
  role: CrewRole;
  /** A name the user gave it; its critter's otherwise. */
  name?: string;
  /** Its critter (a mascot's name); its role's otherwise. */
  critter?: string;
  /** A custom role's own name and job: "Designer", "Makes it look right". */
  label?: string;
  job?: string;
  /** Effort for its model, as the model's own effort setting names it. */
  effort?: string;
  /** Standing rules for this member, in your words. */
  instructions?: string;
  /**
   * Paths (or areas) it works in. A Builder stays inside them; a change
   * outside a Builder's paths is a must-fix for its Checker.
   */
  scope?: string[];
  /** The Scout's rhythm: off, once a day or once a week. */
  schedule?: CrewScoutSchedule;
  /** Security's own look at the whole project, off unless you set it weekly. */
  sweep?: "weekly";
  /** The ready-made member it was added from ("designer", "tester"…). */
  preset?: string;
  /** Its own chat. The Fixer has none here: its chat is the project bot's. */
  sessionId?: string;
  /** The app and model it runs on, picked when the crew is made. */
  harness?: "claude" | "codex";
  model?: string;
  /**
   * The app it runs on for now instead (a Checker that couldn't be locked
   * down on Codex here runs on Claude). Cleared when Aven starts again, so
   * Codex gets one more try each session.
   */
  fallback?: { harness: "claude"; model?: string; at: number };
  /** Off: it takes no turns (a Builder gets no cards, a Scout doesn't look). */
  paused?: boolean;
  /** What it is doing, one line, for the crew strip and the sidebar. */
  doing?: { at: number; text: string };
};

export type CrewScoutSchedule = "off" | "daily" | "weekly";

/** The agents a crew member may run on: the apps that enforce its rules. */
export const CREW_AGENTS = ["claude", "codex"] as const;
export type CrewAgent = (typeof CREW_AGENTS)[number];

/**
 * The apps a role may run on. A Builder writes in the copy, and only Claude
 * Code's sandbox keeps it out of the copy's settings files (Codex can't be
 * told to), so a Builder runs on Claude Code; a role that only reads may
 * also run on Codex, locked down.
 */
export function crewAgentsFor(role: CrewRole): readonly CrewAgent[] {
  return CREW_ROLE_INFO[role].edits ? ["claude"] : CREW_AGENTS;
}

/** "If the card mentions ui, css or design, give it to Designer." */
export type CrewRoute = {
  id: string;
  /** Words or labels; any one matching the card's title or note. */
  words: string[];
  /** The Builder's member id. */
  to: string;
};

/** The app and model a member runs on now: its fallback while it has one. */
export function crewMemberApp(member: CrewMember | undefined): {
  harness: "claude" | "codex";
  model?: string;
} {
  if (member?.fallback)
    return {
      harness: member.fallback.harness,
      ...(member.fallback.model ? { model: member.fallback.model } : {}),
    };
  const harness = member?.harness ?? "claude";
  // A role that writes runs only on an app that keeps it to its rules.
  if (member && !crewAgentsFor(member.role).includes(harness))
    return { harness: "claude" };
  return {
    harness,
    ...(member?.model ? { model: member.model } : {}),
  };
}

export type CrewLimits = {
  /** Bot turns a day, every member's (the Fixer's included). */
  runsPerDay: number;
  /** Builder → Checker rounds before a card stops and asks you. */
  roundsPerCard: number;
  /** Scout ideas that may start by themselves each day. */
  autoStartsPerDay: number;
  /** Ideas the Scout may add each day. */
  ideasPerDay: number;
  /** Cards in flight: one copy, one card. */
  cardsAtOnce: 1;
  /** Pause while the Claude week is at least this percent used. */
  pauseAtPercent: number;
  /** A turn running longer than this is stopped. */
  turnMinutes: number;
  quiet: BotQuietHours;
};

export const CREW_DEFAULT_RUNS_PER_DAY = 20;
/** Every crew together, a day: a hard ceiling (you can set it). */
export const CREW_ALL_RUNS_PER_DAY = 60;
export const CREW_DEFAULT_ROUNDS = 3;
export const CREW_DEFAULT_AUTO_STARTS = 3;
export const CREW_DEFAULT_IDEAS = 3;
export const CREW_DEFAULT_PAUSE_PERCENT = 80;
export const CREW_DEFAULT_TURN_MINUTES = 20;
/** "Allow 10 more today". */
export const CREW_EXTRA_RUNS = 10;

/** What each limit may be set to, lowest and highest. */
export const CREW_LIMIT_RANGES = {
  roundsPerCard: [1, 5],
  runsPerDay: [1, 200],
  autoStartsPerDay: [0, 20],
  ideasPerDay: [0, 10],
  turnMinutes: [5, 120],
  pauseAtPercent: [10, 100],
} as const satisfies Record<string, readonly [number, number]>;
export type CrewLimitName = keyof typeof CREW_LIMIT_RANGES;
export const CREW_ALL_RUNS_RANGE = [1, 500] as const;

export function defaultCrewLimits(): CrewLimits {
  return {
    runsPerDay: CREW_DEFAULT_RUNS_PER_DAY,
    roundsPerCard: CREW_DEFAULT_ROUNDS,
    autoStartsPerDay: CREW_DEFAULT_AUTO_STARTS,
    ideasPerDay: CREW_DEFAULT_IDEAS,
    cardsAtOnce: 1,
    pauseAtPercent: CREW_DEFAULT_PAUSE_PERCENT,
    turnMinutes: CREW_DEFAULT_TURN_MINUTES,
    quiet: { ...BOT_DEFAULT_QUIET },
  };
}

// ---------------------------------------------------------------------------
// Cards

/**
 * Where a crew card is. `queued` waits its turn in Building; `building` and
 * `checking` are the loop; `ready` waits in Review for your Apply; `stuck`
 * waits on you; `applied` and `discarded` are done.
 */
export type CrewStage =
  | "queued"
  | "building"
  | "checking"
  | "ready"
  | "stuck"
  | "applied"
  | "discarded";

export type CrewStuckReason =
  | "changed"
  | "rounds"
  | "no-change"
  | "question"
  | "checker-edited"
  | "no-verdict"
  | "failed"
  | "timeout"
  | "stopped";

export type CrewRan = {
  /** The command, or what was checked. */
  command: string;
  ok: boolean;
  note?: string;
};

/** The Builder's note at the end of its turn. */
export type CrewHandoff = {
  summary: string;
  /** What to try, step by step. */
  howToCheck: string[];
  ran: CrewRan[];
  /** Something only you can answer: the card waits for it. */
  question?: string;
};

export type CrewFinding = {
  text: string;
  /** "theme.ts:41". */
  where?: string;
  /** How to see it. */
  how?: string;
  /** Round 2 on: the earlier must-fix it is about (1-based), if any. */
  about?: number;
  /** Round 2 on: something the latest changes broke. */
  regression?: boolean;
};

/** The Checker's verdict. Only must-fix items send a card back. */
export type CrewVerdict = {
  pass: boolean;
  summary: string;
  mustFix: CrewFinding[];
  later: string[];
  ran: CrewRan[];
};

/** What the copy held after a Builder round: the change and its fingerprint. */
export type CrewChange = {
  base: string;
  hash: string;
  files: number;
  additions: number;
  deletions: number;
  /** Changed paths, with each one's +/−. */
  paths: { path: string; additions: number; deletions: number }[];
};

export type CrewRound = {
  n: number;
  handoff?: CrewHandoff;
  verdict?: CrewVerdict;
  /** The copy after the Builder's turn. */
  change?: CrewChange;
  builtAt?: number;
  checkedAt?: number;
  /** Security's verdict on the change the Checker passed. */
  security?: CrewVerdict;
  securedAt?: number;
};

/** A turn Aven sent for a card, so a restart and other windows know. */
export type CrewTurn = {
  role: CrewLoopRole;
  sessionId: string;
  /** The message that started it. */
  turnId: string;
  sentAt: number;
  /** The Checker's turn: the copy's fingerprint before it, to catch edits. */
  hashBefore?: string;
};

export type CrewCard = {
  /** The Board card's id. */
  id: string;
  title: string;
  /** What to build: the card's title and note. */
  brief: string;
  /** You, or an idea from the Scout or Security's sweep (quoted as data). */
  from: "you" | "scout" | "security";
  /** The Scout's size for its idea. */
  size?: CrewIdeaSize;
  /** Where the card came from (an issue, a page): outside words. */
  sourceUrl?: string;
  stage: CrewStage;
  /** 1-based once started; 0 while queued. */
  round: number;
  /** Its rounds (1–5), as given; see `granted` for more you allowed. */
  maxRounds: number;
  /** Rounds you allowed past `maxRounds` (One more round, Send back). */
  granted?: number;
  /**
   * Every scope a Builder that built a round of it worked in, together: a
   * change outside them is a must-fix, whoever builds it next. `anywhere`
   * once a Builder without a scope built a round.
   */
  scope?: string[];
  anywhere?: boolean;
  paused?: boolean;
  /** Who holds it now. */
  holder?: CrewLoopRole;
  rounds: CrewRound[];
  /** Notes for later: they never send a card back. */
  later: string[];
  stuck?: { reason: CrewStuckReason; text: string };
  /** Your words with One more round or Send back, for the Builder's next turn. */
  note?: string;
  /** The Builder and Checker it was given to (by you, a rule, or the default). */
  builderId?: string;
  checkerId?: string;
  /** For this card only: the Builder's model and effort. */
  override?: { model?: string; effort?: string };
  /** The commit the copy was synced to when the card started: changes are measured from it. */
  base?: string;
  /** The Ready change: Apply lands exactly this fingerprint. */
  fix?: CrewChange;
  /** The change the Checker passed, which Security reviews as it is. */
  reviewing?: CrewChange;
  turn?: CrewTurn;
  /** Turns it took. */
  runs: number;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  /** Its card in the Inbox, once it is Ready or Stuck. */
  inbox?: AutomationReview;
  /** Why the last Apply did not go through. */
  error?: string;
};

export type CrewIdeaSize = "small" | "medium" | "large";

/** A Scout idea on the Board, by its card's id. */
export type CrewIdea = {
  at: number;
  size: CrewIdeaSize;
  why?: string;
  /** Outside material it came from: it never starts by itself. */
  sourceUrl?: string;
  /** Its words point outside the project (Aven's check): never by itself. */
  outside?: boolean;
  /** You said Not now: it never starts by itself. */
  declined?: boolean;
  /** It started by itself. */
  autoStarted?: boolean;
  /** Security's sweep found it: it never starts by itself. */
  by?: "security";
};

export type CrewFeedKind =
  | "start"
  | "handoff"
  | "verdict"
  | "ready"
  | "stuck"
  | "idea"
  | "note"
  | "applied"
  | "hold"
  | "stopped";

/** One line in the crew's feed: handoffs, verdicts, ideas, your notes. */
export type CrewFeedEntry = {
  id: string;
  at: number;
  kind: CrewFeedKind;
  who?: CrewRole | "you" | "aven";
  /** The member it was, when the crew has more than one of a role. */
  member?: string;
  to?: CrewRole;
  cardId?: string;
  title?: string;
  round?: number;
  text: string;
};

/** Standing guidance you gave the crew; every bot reads it at each turn. */
export type CrewNote = { id: string; at: number; text: string };

export type CrewHoldReason =
  | "paused"
  | "quiet-hours"
  | "daily-cap"
  | "all-crews-cap"
  | "usage"
  | "no-member";

export type Crew = {
  /** The project's folder. */
  path: string;
  /** Ordered: the first whose words a card mentions picks its Builder. */
  routes?: CrewRoute[];
  /** The Builder a card goes to when no rule matches. */
  defaultBuilder?: string;
  /**
   * Members of roles this build doesn't know (a later build's Keeper, a
   * custom role), kept as they were and written back with the rest.
   */
  otherMembers?: unknown[];
  /**
   * Chats of members you removed: still the crew's, so they never start as
   * ordinary chats in its copy (each is refused, see `crewChatPermissions`).
   */
  retired?: { sessionId: string; role: CrewRole }[];
  /** The Builder, Checker and Scout are at work. The Fixer has its own switch. */
  on: boolean;
  onAt?: number;
  createdAt: number;
  members: CrewMember[];
  limits: CrewLimits;
  paused?: boolean;
  /** "Allow 10 more today": extra runs for one day. */
  extra?: { day: string; count: number };
  /** Its copy: one per crew, apart from the Fixer's. */
  copy?: {
    path: string;
    branch: string;
    root: string;
    gitDir?: string;
    /**
     * The copy's own files (its top-level entries Git does not ignore): a
     * Checker's or Scout's turn may not write them.
     */
    sources?: string[];
  };
  /** Bot turns today, the Builder's, Checker's and Scout's. */
  runs?: { day: string; count: number };
  /** Scout ideas started by themselves today. */
  autoStarts?: { day: string; count: number };
  /** Ideas the Scout added today, and when it last looked. */
  ideasAdded?: { day: string; count: number };
  scoutAt?: number;
  /** When Security last swept the project. */
  sweepAt?: number;
  ideas?: Record<string, CrewIdea>;
  cards: CrewCard[];
  feed: CrewFeedEntry[];
  notes: CrewNote[];
  job?: BotJob;
  /** Why the crew is holding now, when a limit holds it. */
  hold?: { reason: CrewHoldReason; at: number };
  lastError?: { at: number; text: string };
};

type Store = {
  version: 1;
  crews: Record<string, Crew>;
  /** Every crew's runs a day together, Fixers included: a hard ceiling. */
  allRunsPerDay?: number;
  /** Crews this build could not read: written back untouched. */
  others: Record<string, unknown>;
};

/** Feed entries kept: the Feed shows the newest, and older ones on Show earlier. */
const FEED_KEPT = 200;
const NOTES_KEPT = 20;
const DONE_CARDS_KEPT = 20;
const IDEAS_KEPT = 60;
export const CREW_NOTE_MAX = 500;
export const CREW_BRIEF_MAX = 4_000;
const TEXT_MAX = 600;
const FINDINGS_KEPT = 5;
const LATER_KEPT = 8;
const RAN_KEPT = 8;

const EMPTY_STORE: Store = { version: 1, crews: {}, others: {} };

/**
 * A new crew: off, with a Builder, a Checker and Security, and the Fixer if
 * the project has a bot. A Scout is yours to add. Crews made before keep
 * the members they have.
 */
export function newCrew(path: string, now = Date.now()): Crew {
  return {
    path: normalizeProjectPath(path),
    on: false,
    createdAt: now,
    members: [
      { id: "builder", role: "builder" },
      { id: "checker", role: "checker" },
      {
        id: "security",
        role: "security",
        instructions: SECURITY_INSTRUCTIONS,
      },
    ],
    limits: defaultCrewLimits(),
    cards: [],
    feed: [],
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Reading what storage holds

function finite(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function text(value: unknown, max = TEXT_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function strings(value: unknown, keep: number, max = TEXT_MAX): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => text(item, max))
        .filter((item): item is string => !!item)
        .slice(0, keep)
    : [];
}

function dayCount(value: unknown): { day: string; count: number } | undefined {
  const raw = value as { day?: unknown; count?: unknown } | undefined;
  return raw && typeof raw.day === "string" && typeof raw.count === "number"
    ? { day: raw.day, count: finite(raw.count, 0, 100_000, 0) }
    : undefined;
}

const ROLES = new Set<CrewRole>(CREW_ROLE_ORDER);
const STAGES = new Set<CrewStage>([
  "queued",
  "building",
  "checking",
  "ready",
  "stuck",
  "applied",
  "discarded",
]);
const STUCK = new Set<CrewStuckReason>([
  "changed",
  "rounds",
  "no-change",
  "question",
  "checker-edited",
  "no-verdict",
  "failed",
  "timeout",
  "stopped",
]);
const SIZES = new Set<CrewIdeaSize>(["small", "medium", "large"]);
const FEED_KINDS = new Set<CrewFeedKind>([
  "start",
  "handoff",
  "verdict",
  "ready",
  "stuck",
  "idea",
  "note",
  "applied",
  "hold",
  "stopped",
]);
const HOLDS = new Set<CrewHoldReason>([
  "paused",
  "quiet-hours",
  "daily-cap",
  "all-crews-cap",
  "usage",
  "no-member",
]);

export function readRan(value: unknown): CrewRan[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): CrewRan | null => {
      const raw = item as Partial<CrewRan> | null;
      const command = text(raw?.command, 200);
      if (!command) return null;
      const note = text(raw?.note, 200);
      return { command, ok: raw?.ok === true, ...(note ? { note } : {}) };
    })
    .filter((item): item is CrewRan => !!item)
    .slice(0, RAN_KEPT);
}

export function readFinding(value: unknown): CrewFinding | null {
  if (typeof value === "string") {
    const only = text(value, 300);
    return only ? { text: only } : null;
  }
  const raw = value as Partial<CrewFinding> | null;
  const body = text(raw?.text, 300);
  if (!body) return null;
  const where = text(raw?.where, 120);
  const how = text(raw?.how, 300);
  const about =
    typeof raw?.about === "number" && Number.isInteger(raw.about)
      ? finite(raw.about, 1, FINDINGS_KEPT, 1)
      : undefined;
  return {
    text: body,
    ...(where ? { where } : {}),
    ...(how ? { how } : {}),
    ...(about ? { about } : {}),
    ...(raw?.regression === true ? { regression: true } : {}),
  };
}

function readHandoff(value: unknown): CrewHandoff | undefined {
  const raw = value as Partial<CrewHandoff> | null;
  if (!raw || typeof raw !== "object") return undefined;
  const question = text(raw.question, 400);
  return {
    summary: text(raw.summary) ?? "",
    howToCheck: strings(raw.howToCheck, 6, 300),
    ran: readRan(raw.ran),
    ...(question ? { question } : {}),
  };
}

function readVerdict(value: unknown): CrewVerdict | undefined {
  const raw = value as Partial<CrewVerdict> | null;
  if (!raw || typeof raw !== "object") return undefined;
  return {
    pass: raw.pass === true,
    summary: text(raw.summary) ?? "",
    mustFix: Array.isArray(raw.mustFix)
      ? raw.mustFix
          .map(readFinding)
          .filter((item): item is CrewFinding => !!item)
          .slice(0, FINDINGS_KEPT)
      : [],
    later: strings(raw.later, LATER_KEPT, 300),
    ran: readRan(raw.ran),
  };
}

function readChange(value: unknown): CrewChange | undefined {
  const raw = value as Partial<CrewChange> | null;
  if (
    !raw ||
    typeof raw.base !== "string" ||
    typeof raw.hash !== "string" ||
    !raw.base ||
    !raw.hash
  )
    return undefined;
  return {
    base: raw.base.slice(0, 64),
    hash: raw.hash.slice(0, 100),
    files: finite(raw.files, 0, 1e6, 0),
    additions: finite(raw.additions, 0, 1e9, 0),
    deletions: finite(raw.deletions, 0, 1e9, 0),
    paths: Array.isArray(raw.paths)
      ? raw.paths
          .map((item) => {
            const entry = item as {
              path?: unknown;
              additions?: unknown;
              deletions?: unknown;
            };
            return typeof entry?.path === "string"
              ? {
                  path: entry.path.slice(0, 400),
                  additions: finite(entry.additions, 0, 1e9, 0),
                  deletions: finite(entry.deletions, 0, 1e9, 0),
                }
              : null;
          })
          .filter((item): item is CrewChange["paths"][number] => !!item)
          .slice(0, 40)
      : [],
  };
}

function readReview(value: unknown): AutomationReview | undefined {
  const raw = value as Partial<AutomationReview> | null;
  const title = text(raw?.title, 120);
  if (!raw || !title || typeof raw.postedAt !== "number") return undefined;
  return {
    kind: "review",
    title,
    summary: text(raw.summary) ?? "",
    status:
      raw.status === "done" || raw.status === "dismissed" ? raw.status : "open",
    postedAt: raw.postedAt,
    ...(typeof raw.resolvedAt === "number"
      ? { resolvedAt: raw.resolvedAt }
      : {}),
  };
}

export function readCrewCard(value: unknown): CrewCard | null {
  const raw = value as Partial<CrewCard> | null;
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.id, 100);
  const title = text(raw.title, 200);
  if (!id || !title || !STAGES.has(raw.stage as CrewStage)) return null;
  const rounds = Array.isArray(raw.rounds)
    ? raw.rounds
        .map((item): CrewRound | null => {
          const round = item as Partial<CrewRound> | null;
          if (!round || typeof round.n !== "number") return null;
          const handoff = readHandoff(round.handoff);
          const verdict = readVerdict(round.verdict);
          const security = readVerdict(round.security);
          const change = readChange(round.change);
          return {
            n: finite(round.n, 1, 20, 1),
            ...(handoff ? { handoff } : {}),
            ...(verdict ? { verdict } : {}),
            ...(change ? { change } : {}),
            ...(typeof round.builtAt === "number"
              ? { builtAt: round.builtAt }
              : {}),
            ...(typeof round.checkedAt === "number"
              ? { checkedAt: round.checkedAt }
              : {}),
            ...(security ? { security } : {}),
            ...(typeof round.securedAt === "number"
              ? { securedAt: round.securedAt }
              : {}),
          };
        })
        .filter((item): item is CrewRound => !!item)
        .slice(-20)
    : [];
  const stuck = raw.stuck as CrewCard["stuck"] | undefined;
  const turn = raw.turn as CrewTurn | undefined;
  const fix = readChange(raw.fix);
  const reviewing = readChange(raw.reviewing);
  const inbox = readReview(raw.inbox);
  const note = text(raw.note, CREW_NOTE_MAX);
  const sourceUrl = text(raw.sourceUrl, 2048);
  const error = text(raw.error, 300);
  return {
    id,
    title,
    brief: text(raw.brief, CREW_BRIEF_MAX) ?? title,
    from: raw.from === "scout" || raw.from === "security" ? raw.from : "you",
    ...(SIZES.has(raw.size as CrewIdeaSize)
      ? { size: raw.size as CrewIdeaSize }
      : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    stage: raw.stage as CrewStage,
    round: finite(raw.round, 0, 20, 0),
    maxRounds: finite(raw.maxRounds, 1, 5, CREW_DEFAULT_ROUNDS),
    ...(typeof raw.granted === "number" && raw.granted > 0
      ? { granted: finite(raw.granted, 0, 20, 0) }
      : {}),
    ...(strings(raw.scope, 40, 200).length
      ? { scope: strings(raw.scope, 40, 200) }
      : {}),
    ...(raw.anywhere === true ? { anywhere: true } : {}),
    ...(raw.paused === true ? { paused: true } : {}),
    ...(raw.holder === "builder" ||
    raw.holder === "checker" ||
    raw.holder === "security"
      ? { holder: raw.holder }
      : {}),
    rounds,
    later: strings(raw.later, 20, 300),
    ...(stuck && STUCK.has(stuck.reason) && typeof stuck.text === "string"
      ? { stuck: { reason: stuck.reason, text: stuck.text.slice(0, 400) } }
      : {}),
    ...(note ? { note } : {}),
    ...(text(raw.builderId, 60) ? { builderId: text(raw.builderId, 60) } : {}),
    ...(text(raw.checkerId, 60) ? { checkerId: text(raw.checkerId, 60) } : {}),
    ...(raw.override &&
    typeof raw.override === "object" &&
    (text(raw.override.model, 200) || text(raw.override.effort, 40))
      ? {
          override: {
            ...(text(raw.override.model, 200)
              ? { model: text(raw.override.model, 200) }
              : {}),
            ...(text(raw.override.effort, 40)
              ? { effort: text(raw.override.effort, 40) }
              : {}),
          },
        }
      : {}),
    ...(text(raw.base, 64) ? { base: text(raw.base, 64) } : {}),
    ...(fix ? { fix } : {}),
    ...(reviewing ? { reviewing } : {}),
    ...(turn &&
    (turn.role === "builder" ||
      turn.role === "checker" ||
      turn.role === "security") &&
    typeof turn.sessionId === "string" &&
    typeof turn.turnId === "string" &&
    typeof turn.sentAt === "number"
      ? {
          turn: {
            role: turn.role,
            sessionId: turn.sessionId,
            turnId: turn.turnId,
            sentAt: turn.sentAt,
            ...(typeof turn.hashBefore === "string"
              ? { hashBefore: turn.hashBefore }
              : {}),
          },
        }
      : {}),
    runs: finite(raw.runs, 0, 10_000, 0),
    queuedAt: finite(raw.queuedAt, 0, 8.64e15, 0),
    ...(typeof raw.startedAt === "number" ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.endedAt === "number" ? { endedAt: raw.endedAt } : {}),
    updatedAt: finite(raw.updatedAt, 0, 8.64e15, 0),
    ...(inbox ? { inbox } : {}),
    ...(error ? { error } : {}),
  };
}

export const CREW_INSTRUCTIONS_MAX = 2_000;
const SCOPE_KEPT = 20;
const RETIRED_KEPT = 40;

function readMember(value: unknown):
  | (Omit<CrewMember, "id"> & {
      id?: string;
    })
  | null {
  const raw = value as Partial<CrewMember> | null;
  if (!raw || !ROLES.has(raw.role as CrewRole)) return null;
  const id = text(raw.id, 60);
  const name = text(raw.name, 40);
  const critter = text(raw.critter, 40);
  const label = text(raw.label, 40);
  const job = text(raw.job, 120);
  const effort = text(raw.effort, 40);
  const instructions = text(raw.instructions, CREW_INSTRUCTIONS_MAX);
  const scope = strings(raw.scope, SCOPE_KEPT, 200);
  const schedule =
    raw.schedule === "off" ||
    raw.schedule === "daily" ||
    raw.schedule === "weekly"
      ? raw.schedule
      : undefined;
  const preset = text(raw.preset, 40);
  const sessionId = text(raw.sessionId, 256);
  const model = text(raw.model, 200);
  const doing = raw.doing as CrewMember["doing"] | undefined;
  const fallback = raw.fallback as CrewMember["fallback"] | undefined;
  const fallbackModel = text(fallback?.model, 200);
  return {
    ...(id ? { id } : {}),
    role: raw.role as CrewRole,
    ...(name ? { name } : {}),
    ...(critter ? { critter } : {}),
    ...(label ? { label } : {}),
    ...(job ? { job } : {}),
    ...(effort ? { effort } : {}),
    ...(instructions ? { instructions } : {}),
    ...(scope.length ? { scope } : {}),
    ...(schedule ? { schedule } : {}),
    ...(raw.sweep === "weekly" ? { sweep: "weekly" as const } : {}),
    ...(preset ? { preset } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(raw.harness === "claude" || raw.harness === "codex"
      ? { harness: raw.harness }
      : {}),
    ...(model ? { model } : {}),
    ...(fallback?.harness === "claude" && typeof fallback.at === "number"
      ? {
          fallback: {
            harness: "claude" as const,
            ...(fallbackModel ? { model: fallbackModel } : {}),
            at: fallback.at,
          },
        }
      : {}),
    ...(raw.paused === true ? { paused: true } : {}),
    ...(doing && typeof doing.at === "number" && typeof doing.text === "string"
      ? { doing: { at: doing.at, text: doing.text.slice(0, 200) } }
      : {}),
  };
}

/**
 * A stored crew as this build knows it: unknown fields dropped, missing ones
 * filled in, numbers kept in range. A hand-edited or older entry loads
 * rather than taking the sidebar down.
 */
export function readCrew(value: unknown): Crew | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Crew> & Record<string, unknown>;
  if (typeof raw.path !== "string" || !raw.path.trim()) return null;
  const base = newCrew(raw.path, finite(raw.createdAt, 0, 8.64e15, 0));
  const limits = raw.limits as Partial<CrewLimits> | undefined;
  const quiet = limits?.quiet as Partial<BotQuietHours> | undefined;
  const limit = (name: CrewLimitName) =>
    finite(
      limits?.[name],
      CREW_LIMIT_RANGES[name][0],
      CREW_LIMIT_RANGES[name][1],
      base.limits[name],
    );
  const members: CrewMember[] = [];
  const otherMembers: unknown[] = [];
  if (Array.isArray(raw.members))
    for (const item of raw.members) {
      const read = readMember(item);
      // Several Builders and Checkers; one Scout and one Fixer.
      const single =
        read?.role === "scout" ||
        read?.role === "fixer" ||
        read?.role === "security";
      if (
        read &&
        !(single && members.some((entry) => entry.role === read.role))
      ) {
        // A member from before ids takes its role's name, then role-2…
        let id = read.id ?? read.role;
        for (let n = 2; members.some((entry) => entry.id === id); n += 1)
          id = `${read.role}-${n}`;
        members.push({ ...read, id });
      } else if (
        !read &&
        item &&
        typeof item === "object" &&
        typeof (item as { role?: unknown }).role === "string" &&
        !ROLES.has((item as { role: CrewRole }).role)
      )
        otherMembers.push(item);
    }
  const retired = Array.isArray(raw.retired)
    ? raw.retired
        .map((item) => {
          const entry = item as { sessionId?: unknown; role?: unknown } | null;
          const sessionId = text(entry?.sessionId, 256);
          return sessionId && ROLES.has(entry?.role as CrewRole)
            ? { sessionId, role: entry!.role as CrewRole }
            : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry)
        .slice(-RETIRED_KEPT)
    : [];
  const copy = raw.copy as Crew["copy"] | undefined;
  const memberIds = new Set(members.map((member) => member.id));
  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .map((item): CrewRoute | null => {
          const route = item as Partial<CrewRoute> | null;
          const words = strings(route?.words, 12, 40).map((word) =>
            word.toLowerCase(),
          );
          return route &&
            typeof route.id === "string" &&
            typeof route.to === "string" &&
            memberIds.has(route.to) &&
            words.length
            ? { id: route.id.slice(0, 60), words, to: route.to }
            : null;
        })
        .filter((route): route is CrewRoute => !!route)
        .slice(0, 12)
    : [];
  const ideas: Record<string, CrewIdea> = {};
  if (raw.ideas && typeof raw.ideas === "object")
    for (const [id, item] of Object.entries(raw.ideas).slice(-IDEAS_KEPT)) {
      const idea = item as Partial<CrewIdea> | null;
      if (!idea || !SIZES.has(idea.size as CrewIdeaSize)) continue;
      const why = text(idea.why, 300);
      const sourceUrl = text(idea.sourceUrl, 2048);
      ideas[id] = {
        at: finite(idea.at, 0, 8.64e15, 0),
        size: idea.size as CrewIdeaSize,
        ...(why ? { why } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(idea.outside === true ? { outside: true } : {}),
        ...(idea.declined === true ? { declined: true } : {}),
        ...(idea.autoStarted === true ? { autoStarted: true } : {}),
        ...(idea.by === "security" ? { by: "security" as const } : {}),
      };
    }
  const cards = Array.isArray(raw.cards)
    ? raw.cards.map(readCrewCard).filter((card): card is CrewCard => !!card)
    : [];
  const feed = Array.isArray(raw.feed)
    ? raw.feed
        .map((item): CrewFeedEntry | null => {
          const entry = item as Partial<CrewFeedEntry> | null;
          const body = text(entry?.text, TEXT_MAX);
          if (
            !entry ||
            typeof entry.id !== "string" ||
            typeof entry.at !== "number" ||
            !FEED_KINDS.has(entry.kind as CrewFeedKind) ||
            body === undefined
          )
            return null;
          const title = text(entry.title, 200);
          const who = entry.who;
          const member = text(entry.member, 60);
          return {
            id: entry.id,
            at: entry.at,
            kind: entry.kind as CrewFeedKind,
            ...(who === "you" || who === "aven" || ROLES.has(who as CrewRole)
              ? { who }
              : {}),
            ...(member ? { member } : {}),
            ...(ROLES.has(entry.to as CrewRole)
              ? { to: entry.to as CrewRole }
              : {}),
            ...(typeof entry.cardId === "string"
              ? { cardId: entry.cardId }
              : {}),
            ...(title ? { title } : {}),
            ...(typeof entry.round === "number" ? { round: entry.round } : {}),
            text: body,
          };
        })
        .filter((entry): entry is CrewFeedEntry => !!entry)
        .slice(-FEED_KEPT)
    : [];
  const notes = Array.isArray(raw.notes)
    ? raw.notes
        .map((item): CrewNote | null => {
          const note = item as Partial<CrewNote> | null;
          const body = text(note?.text, CREW_NOTE_MAX);
          return note && typeof note.id === "string" && body
            ? { id: note.id, at: finite(note.at, 0, 8.64e15, 0), text: body }
            : null;
        })
        .filter((note): note is CrewNote => !!note)
        .slice(-NOTES_KEPT)
    : [];
  const job = raw.job as BotJob | undefined;
  const hold = raw.hold as Crew["hold"] | undefined;
  const lastError = raw.lastError as Crew["lastError"] | undefined;
  const runs = dayCount(raw.runs);
  const extra = dayCount(raw.extra);
  const autoStarts = dayCount(raw.autoStarts);
  const ideasAdded = dayCount(raw.ideasAdded);
  return {
    ...base,
    on: raw.on === true,
    ...(typeof raw.onAt === "number" ? { onAt: raw.onAt } : {}),
    members: members.length ? members : base.members,
    ...(routes.length ? { routes } : {}),
    ...(typeof raw.defaultBuilder === "string" &&
    memberIds.has(raw.defaultBuilder)
      ? { defaultBuilder: raw.defaultBuilder }
      : {}),
    ...(otherMembers.length ? { otherMembers: otherMembers.slice(0, 20) } : {}),
    ...(retired.length ? { retired } : {}),
    limits: {
      runsPerDay: limit("runsPerDay"),
      roundsPerCard: limit("roundsPerCard"),
      autoStartsPerDay: limit("autoStartsPerDay"),
      ideasPerDay: limit("ideasPerDay"),
      cardsAtOnce: 1,
      pauseAtPercent: limit("pauseAtPercent"),
      turnMinutes: limit("turnMinutes"),
      quiet: {
        on: typeof quiet?.on === "boolean" ? quiet.on : base.limits.quiet.on,
        start: finite(quiet?.start, 0, 1439, base.limits.quiet.start),
        end: finite(quiet?.end, 0, 1439, base.limits.quiet.end),
      },
    },
    ...(raw.paused === true ? { paused: true } : {}),
    ...(extra ? { extra } : {}),
    ...(copy &&
    typeof copy.path === "string" &&
    typeof copy.branch === "string" &&
    typeof copy.root === "string"
      ? {
          copy: {
            path: copy.path,
            branch: copy.branch,
            root: copy.root,
            ...(typeof copy.gitDir === "string" ? { gitDir: copy.gitDir } : {}),
            ...(Array.isArray(copy.sources)
              ? { sources: strings(copy.sources, 400, 1024) }
              : {}),
          },
        }
      : {}),
    ...(runs ? { runs } : {}),
    ...(autoStarts ? { autoStarts } : {}),
    ...(ideasAdded ? { ideasAdded } : {}),
    ...(typeof raw.scoutAt === "number" ? { scoutAt: raw.scoutAt } : {}),
    ...(typeof raw.sweepAt === "number" ? { sweepAt: raw.sweepAt } : {}),
    ...(Object.keys(ideas).length ? { ideas } : {}),
    cards,
    feed,
    notes,
    ...(job &&
    typeof job.owner === "string" &&
    typeof job.since === "number" &&
    typeof job.heartbeat === "number"
      ? {
          job: { owner: job.owner, since: job.since, heartbeat: job.heartbeat },
        }
      : {}),
    ...(hold && HOLDS.has(hold.reason) && typeof hold.at === "number"
      ? { hold: { reason: hold.reason, at: hold.at } }
      : {}),
    ...(lastError &&
    typeof lastError.at === "number" &&
    typeof lastError.text === "string"
      ? { lastError: { at: lastError.at, text: lastError.text.slice(0, 300) } }
      : {}),
  };
}

/**
 * What storage holds, as this build reads it. `foreign` is a store this
 * build can't read (broken, or another version's): it is never overwritten.
 */
function parse(raw: string | null): { store: Store; foreign: boolean } {
  if (!raw) return { store: EMPTY_STORE, foreign: false };
  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (
      parsed?.version !== 1 ||
      !parsed.crews ||
      typeof parsed.crews !== "object" ||
      Array.isArray(parsed.crews)
    )
      return { store: EMPTY_STORE, foreign: true };
    const crews: Record<string, Crew> = {};
    const others: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.crews)) {
      const crew = readCrew(value);
      if (crew) crews[projectKey(crew.path)] = crew;
      else others[key] = value;
    }
    const allRunsPerDay =
      typeof parsed.allRunsPerDay === "number"
        ? finite(
            parsed.allRunsPerDay,
            CREW_ALL_RUNS_RANGE[0],
            CREW_ALL_RUNS_RANGE[1],
            CREW_ALL_RUNS_PER_DAY,
          )
        : undefined;
    return {
      store: {
        version: 1,
        crews,
        others,
        ...(allRunsPerDay !== undefined ? { allRunsPerDay } : {}),
      },
      foreign: false,
    };
  } catch {
    return { store: EMPTY_STORE, foreign: true };
  }
}

/** Where an unreadable store is kept, once, before anything else happens. */
export const CREWS_BACKUP_KEY = `${CREWS_KEY}.backup`;

// ---------------------------------------------------------------------------
// The store

let cache: Store = EMPTY_STORE;
let cacheRaw: string | null | undefined;
/** Session id → its crew and member, for every crew, on or off. */
let chatIndex: Map<string, ChatEntry> | null = null;
const listeners = new Set<() => void>();

/** Storage holds a store this build can't read: saves stay in this window. */
let foreign = false;
let foreignWarned = false;

function read(): Store {
  let raw: string | null;
  try {
    raw = localStorage.getItem(CREWS_KEY);
  } catch {
    return cache;
  }
  if (raw !== cacheRaw) {
    cacheRaw = raw;
    const parsed = parse(raw);
    cache = parsed.store;
    foreign = parsed.foreign;
    chatIndex = null;
    if (foreign && raw)
      try {
        // Keep the first copy; never replace an earlier backup.
        if (localStorage.getItem(CREWS_BACKUP_KEY) === null)
          localStorage.setItem(CREWS_BACKUP_KEY, raw);
      } catch {
        // The original stays where it is either way.
      }
  }
  return cache;
}

/** Storage holds crews this build can't read (another version's): nothing is saved. */
export function crewsStoreUnreadable(): boolean {
  read();
  return foreign;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

/** A crew as storage keeps it: members of unknown roles back among its members. */
function stored(crew: Crew): unknown {
  if (!crew.otherMembers?.length) return crew;
  const { otherMembers, ...rest } = crew;
  return { ...rest, members: [...crew.members, ...otherMembers] };
}

function write(store: Store) {
  const crews: Record<string, unknown> = {};
  for (const [key, crew] of Object.entries(store.crews))
    crews[key] = stored(crew);
  const raw = JSON.stringify({
    version: 1,
    crews: { ...store.others, ...crews },
    ...(store.allRunsPerDay !== undefined
      ? { allRunsPerDay: store.allRunsPerDay }
      : {}),
  });
  cache = store;
  chatIndex = null;
  if (foreign) {
    // Another version's crews: never overwritten. Changes last as long as
    // this window.
    if (!foreignWarned)
      console.error(
        `Crews: ${CREWS_KEY} holds data this version can't read; it is kept as it is (and copied to ${CREWS_BACKUP_KEY}), and nothing is saved.`,
      );
    foreignWarned = true;
    emit();
    return;
  }
  try {
    localStorage.setItem(CREWS_KEY, raw);
    cacheRaw = raw;
  } catch {
    // Without storage crews still work in this window until it closes.
  }
  emit();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== CREWS_KEY) return;
  read();
  emit();
}

let botsUnsubscribe: (() => void) | null = null;

export function subscribeCrews(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    if (typeof window !== "undefined")
      window.addEventListener("storage", onStorage);
    // A Fixer is the project bot: its changes show in the crew too.
    botsUnsubscribe = subscribeProjectBots(emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    if (typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
    botsUnsubscribe?.();
    botsUnsubscribe = null;
  };
}

/** Test seam. */
export function resetCrewsCache() {
  cache = EMPTY_STORE;
  cacheRaw = undefined;
  chatIndex = null;
  merged = null;
  foreign = false;
  foreignWarned = false;
}

// ---------------------------------------------------------------------------
// Migration: each project bot is its project's crew's Fixer

/**
 * A crew for a project bot that has none yet: off (the Builder, Checker and
 * Scout wait for you), with the bot as its Fixer. The bot itself keeps its
 * own store and switch, so nothing it had changes.
 */
export function crewFromBot(bot: Pick<ProjectBot, "path" | "createdAt">): Crew {
  const crew = newCrew(bot.path, bot.createdAt);
  return {
    ...crew,
    members: [...crew.members, { id: "fixer", role: "fixer" }],
  };
}

/**
 * Every project bot in its project's crew as the Fixer: a crew is made for a
 * bot without one, and a crew without a Fixer gets one. Returns the same
 * object when nothing changes.
 */
export function withBotsAsFixers(
  crews: Readonly<Record<string, Crew>>,
  bots: Readonly<Record<string, ProjectBot>>,
): Record<string, Crew> {
  let next: Record<string, Crew> | null = null;
  for (const bot of Object.values(bots)) {
    const key = projectKey(normalizeProjectPath(bot.path));
    const crew = (next ?? crews)[key];
    if (!crew) {
      next ??= { ...crews };
      next[key] = crewFromBot(bot);
    } else if (!crew.members.some((member) => member.role === "fixer")) {
      next ??= { ...crews };
      next[key] = {
        ...crew,
        members: [...crew.members, { id: "fixer", role: "fixer" }],
      };
    }
  }
  return next ?? (crews as Record<string, Crew>);
}

let merged: {
  crews: Record<string, Crew>;
  bots: Readonly<Record<string, ProjectBot>>;
  result: Record<string, Crew>;
} | null = null;

/**
 * Every crew, keyed by `projectKey`, each project bot included as its crew's
 * Fixer even before the migration is saved. The same object until a crew or
 * a bot is saved.
 */
export function crewsSnapshot(): Readonly<Record<string, Crew>> {
  const crews = read().crews;
  const bots = projectBotsSnapshot();
  if (merged?.crews === crews && merged.bots === bots) return merged.result;
  merged = { crews, bots, result: withBotsAsFixers(crews, bots) };
  return merged.result;
}

/**
 * Save the migration: each project bot's crew, with the bot as its Fixer.
 * Run once a window starts driving crews; later runs change nothing.
 */
export function migrateBotsIntoCrews(): boolean {
  const store = read();
  const crews = withBotsAsFixers(store.crews, projectBotsSnapshot());
  if (crews === store.crews) return false;
  write({ ...store, crews });
  return true;
}

export function getCrew(path: string): Crew | undefined {
  return crewsSnapshot()[projectKey(normalizeProjectPath(path))];
}

/** Crews whose Builder, Checker and Scout are on. */
export function activeCrews(): Crew[] {
  if (!botsAvailable()) return [];
  return Object.values(read().crews).filter((crew) => crew.on);
}

export function anyCrewOn(): boolean {
  return activeCrews().length > 0;
}

/**
 * Change one project's crew. `update` gets the current crew (made from the
 * project bot, or new and off) and returns the next, or the same object for
 * no change. Returns what was saved.
 */
export function updateCrew(path: string, update: (crew: Crew) => Crew): Crew {
  const store = read();
  const key = projectKey(normalizeProjectPath(path));
  const current = store.crews[key] ?? getCrew(path) ?? newCrew(path);
  const next = update(current);
  if (next === current) return current;
  write({ ...store, crews: { ...store.crews, [key]: next } });
  return next;
}

/** Every crew's runs a day together, Fixers included. */
export function crewsAllRunsPerDay(): number {
  return read().allRunsPerDay ?? CREW_ALL_RUNS_PER_DAY;
}

export function setCrewsAllRunsPerDay(value: number) {
  const store = read();
  const next = Math.min(
    CREW_ALL_RUNS_RANGE[1],
    Math.max(CREW_ALL_RUNS_RANGE[0], Math.round(value)),
  );
  if (!Number.isFinite(next) || store.allRunsPerDay === next) return;
  write({ ...store, allRunsPerDay: next });
}

export function useCrewsAllRunsPerDay(): number {
  return useSyncExternalStore(
    subscribeCrews,
    crewsAllRunsPerDay,
    crewsAllRunsPerDay,
  );
}

export function forgetCrew(path: string) {
  const store = read();
  const key = projectKey(normalizeProjectPath(path));
  if (!store.crews[key]) return;
  const crews = { ...store.crews };
  delete crews[key];
  write({ ...store, crews });
}

// ---------------------------------------------------------------------------
// Members and their chats

/**
 * A member's name: its own, or its critter's ("Beetle", "Owl", "Fox"). The
 * Fixer's is its bot's, which the caller passes. `who` is a member's id, or
 * a role for the first member of it.
 */
export function crewMemberName(
  crew: Pick<Crew, "members">,
  who: string,
  fixerName = CREW_ROLE_INFO.fixer.label,
): string {
  const member =
    crewMemberById(crew, who) ??
    (ROLES.has(who as CrewRole)
      ? crewMember(crew, who as CrewRole)
      : undefined);
  const role =
    member?.role ??
    (ROLES.has(who as CrewRole) ? (who as CrewRole) : "builder");
  if (role === "fixer") return fixerName;
  if (member?.name) return member.name;
  const critter = memberCritter(member ?? { role });
  return critter
    ? critter[0]!.toUpperCase() + critter.slice(1)
    : CREW_ROLE_INFO[role].label;
}

/** The critter a member is drawn as: yours, or its role's. None for the Fixer. */
export function memberCritter(
  member: Pick<CrewMember, "role" | "critter">,
): string | undefined {
  if (member.role === "fixer") return undefined;
  return member.critter ?? CREW_ROLE_INFO[member.role].critter;
}

/** "Builder", or a custom member's own title ("Designer"). */
export function memberLabel(
  member: Pick<CrewMember, "role" | "label">,
): string {
  return member.label ?? CREW_ROLE_INFO[member.role].label;
}

/** Its job line: a custom member's own, or its role's. */
export function memberJob(member: Pick<CrewMember, "role" | "job">): string {
  return member.job ?? CREW_ROLE_INFO[member.role].job;
}

// ---------------------------------------------------------------------------
// Scope

function scopeEntry(entry: string): string {
  return entry
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

/** Whether a changed path (relative to the project) is inside one of `scope`'s paths or globs. */
export function inScope(path: string, scope: readonly string[]): boolean {
  if (!scope.length) return true;
  const target = scopeEntry(path);
  return scope.some((raw) => {
    const entry = scopeEntry(raw);
    if (!entry) return false;
    if (entry.includes("*")) {
      const pattern = entry
        .split(/(\*\*\/?|\*)/)
        .map((part) =>
          part.startsWith("**")
            ? "(?:.*/)?"
            : part === "*"
              ? "[^/]*"
              : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("");
      return new RegExp(`^${pattern}(?:/.*)?$`).test(target);
    }
    return target === entry || target.startsWith(`${entry}/`);
  });
}

/** The changed paths outside a member's scope (none when it has none). */
export function outsideScope(
  paths: readonly string[],
  scope: readonly string[] | undefined,
): string[] {
  if (!scope?.length) return [];
  return paths.filter((path) => !inScope(path, scope));
}

export function crewMember(
  crew: Pick<Crew, "members">,
  role: CrewRole,
): CrewMember | undefined {
  return crew.members.find((member) => member.role === role);
}

/** Members in the crew's order: Builder, Checker, Scout, Fixer. */
export function crewMembers(crew: Pick<Crew, "members">): CrewMember[] {
  return [...crew.members].sort(
    (a, b) => CREW_ROLE_ORDER.indexOf(a.role) - CREW_ROLE_ORDER.indexOf(b.role),
  );
}

/** Change the first member of a role (made, when the crew has none). */
export function withMember(
  crew: Crew,
  role: CrewRole,
  update: (member: CrewMember) => CrewMember,
): Crew {
  const known = crewMember(crew, role);
  const current = known ?? { id: newMemberId(crew, role), role };
  const next = update(current);
  if (next === current && known) return crew;
  return {
    ...crew,
    members: known
      ? crew.members.map((member) => (member === known ? next : member))
      : [...crew.members, next],
  };
}

/** Change one member by its id; a member that isn't there changes nothing. */
export function withMemberId(
  crew: Crew,
  id: string,
  update: (member: CrewMember) => CrewMember,
): Crew {
  const known = crew.members.find((member) => member.id === id);
  if (!known) return crew;
  const next = update(known);
  if (next === known) return crew;
  return {
    ...crew,
    members: crew.members.map((member) => (member === known ? next : member)),
  };
}

/** An id no member of the crew has: the role's name first, then role-2… */
export function newMemberId(
  crew: Pick<Crew, "members">,
  role: CrewRole,
): string {
  let id: string = role;
  for (let n = 2; crew.members.some((member) => member.id === id); n += 1)
    id = `${role}-${n}`;
  return id;
}

export function crewMemberById(
  crew: Pick<Crew, "members">,
  id: string | undefined,
): CrewMember | undefined {
  return id ? crew.members.find((member) => member.id === id) : undefined;
}

/** A member is on unless you switched it off. */
export const memberOn = (member: CrewMember | undefined): boolean =>
  !!member && !member.paused;

/** The Builder a card goes to when no rule picks one: yours, or the first that's on. */
export function defaultBuilder(crew: Crew): CrewMember | undefined {
  const chosen = crewMemberById(crew, crew.defaultBuilder);
  if (chosen?.role === "builder" && memberOn(chosen)) return chosen;
  return crew.members.find(
    (member) => member.role === "builder" && memberOn(member),
  );
}

/** A card's words as a rule reads them: its title and note, lower-cased. */
function cardWords(card: { title: string; brief?: string; note?: string }) {
  return `${card.title}\n${card.brief ?? ""}\n${card.note ?? ""}`.toLowerCase();
}

/** Whether a card mentions a rule's word (a whole word, or a #label). */
export function cardMentions(text: string, word: string): boolean {
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])#?${escaped}([^a-z0-9]|$)`).test(text);
}

/**
 * The Builder a card goes to: the first rule whose words the card mentions
 * (and whose Builder is on), else the default Builder.
 */
export function routeCard(
  crew: Crew,
  card: { title: string; brief?: string; note?: string },
): CrewMember | undefined {
  const text = cardWords(card);
  for (const route of crew.routes ?? []) {
    const to = crewMemberById(crew, route.to);
    if (to?.role !== "builder" || !memberOn(to)) continue;
    if (route.words.some((word) => cardMentions(text, word))) return to;
  }
  return defaultBuilder(crew);
}

/** The Builder working a card: the one it was given to while on, else by the rules. */
export function cardBuilder(
  crew: Crew,
  card: CrewCard,
): CrewMember | undefined {
  const given = crewMemberById(crew, card.builderId);
  if (given?.role === "builder" && memberOn(given)) return given;
  return routeCard(crew, card);
}

/** The member whose turn a card is on now: by its chat while a turn runs, else by the rules. */
export function cardHolderId(crew: Crew, card: CrewCard): string | undefined {
  if (!card.holder) return undefined;
  if (card.holder === "security" && !card.turn) return cardSecurity(crew)?.id;
  if (card.turn) {
    const by = crew.members.find(
      (member) => member.sessionId === card.turn!.sessionId,
    );
    if (by) return by.id;
  }
  return (
    card.holder === "builder"
      ? cardBuilder(crew, card)
      : cardChecker(crew, card)
  )?.id;
}

/** Security for a card: the crew's, while it is on. */
export function cardSecurity(crew: Crew): CrewMember | undefined {
  return crew.members.find(
    (member) => member.role === "security" && memberOn(member),
  );
}

/** The Checker checking a card: the one it was given to while on, else the first on. */
export function cardChecker(
  crew: Crew,
  card: CrewCard,
): CrewMember | undefined {
  const given = crewMemberById(crew, card.checkerId);
  if (given?.role === "checker" && memberOn(given)) return given;
  return crew.members.find(
    (member) => member.role === "checker" && memberOn(member),
  );
}

/**
 * Every crew member's chat, whether its crew is on or off: a crew's chat is
 * always a crew's chat, so it can never launch as an ordinary one (see
 * `crewChatPermissions`, which refuses while the crew is off).
 */
/**
 * The Checker runs on Claude for this session (Codex couldn't be locked down
 * here), with `model` (a different one from the Builder's). The feed says so
 * once; a Checker already on Claude is left as it is.
 */
export function withCheckerOnClaude(
  crew: Crew,
  model: string | undefined,
  now: number,
  /** The Checker; the crew's first when not given. */
  memberId?: string,
): Crew {
  const checker = memberId
    ? crewMemberById(crew, memberId)
    : crewMember(crew, "checker");
  if (
    !checker ||
    (checker.role !== "checker" && checker.role !== "security") ||
    crewMemberApp(checker).harness === "claude"
  )
    return crew;
  const name = crewMemberName(crew, checker.id);
  return withFeed(
    withMemberId(crew, checker.id, (member) => ({
      ...member,
      fallback: { harness: "claude", ...(model ? { model } : {}), at: now },
    })),
    {
      at: now,
      kind: "note",
      who: "aven",
      member: checker.id,
      text: `${name} is checking with Claude: Codex couldn't be locked down here.`,
    },
  );
}

/**
 * Remove a member: its routes go, cards it had go back to the rules, and
 * its chat stays the crew's (refused from now on), so it can never start
 * as an ordinary chat in the crew's copy.
 */
export function withoutMember(crew: Crew, id: string): Crew {
  const member = crewMemberById(crew, id);
  if (!member) return crew;
  const retired = member.sessionId
    ? [
        ...(crew.retired ?? []).filter(
          (entry) => entry.sessionId !== member.sessionId,
        ),
        { sessionId: member.sessionId, role: member.role },
      ].slice(-RETIRED_KEPT)
    : crew.retired;
  const routes = (crew.routes ?? []).filter((route) => route.to !== id);
  const next: Crew = {
    ...crew,
    members: crew.members.filter((entry) => entry.id !== id),
    ...(retired?.length ? { retired } : {}),
    routes: routes.length ? routes : undefined,
    defaultBuilder:
      crew.defaultBuilder === id ? undefined : crew.defaultBuilder,
    cards: crew.cards.map((card) =>
      card.builderId === id || card.checkerId === id
        ? {
            ...card,
            builderId: card.builderId === id ? undefined : card.builderId,
            checkerId: card.checkerId === id ? undefined : card.checkerId,
          }
        : card,
    ),
  };
  if (!next.routes) delete next.routes;
  if (!next.defaultBuilder) delete next.defaultBuilder;
  return next;
}

/** Every Checker back on its own app: Aven started again, Codex gets a try. */
export function withoutFallbacks(crew: Crew): Crew {
  if (!crew.members.some((member) => member.fallback)) return crew;
  return {
    ...crew,
    members: crew.members.map((member) => {
      if (!member.fallback) return member;
      const rest = { ...member };
      delete rest.fallback;
      return rest;
    }),
  };
}

type ChatEntry = {
  key: string;
  role: CrewRole;
  /** Its member's id; none for a removed member's chat. */
  memberId?: string;
};

function chats(): Map<string, ChatEntry> {
  read();
  if (chatIndex) return chatIndex;
  chatIndex = new Map();
  for (const [key, crew] of Object.entries(cache.crews)) {
    for (const entry of crew.retired ?? [])
      if (entry.role !== "fixer")
        chatIndex.set(entry.sessionId, { key, role: entry.role });
    for (const member of crew.members)
      if (member.sessionId && member.role !== "fixer")
        chatIndex.set(member.sessionId, {
          key,
          role: member.role,
          memberId: member.id,
        });
  }
  return chatIndex;
}

/**
 * The crew and member whose chat this is, on or off. A removed member's
 * chat is still the crew's, with `retired` set and its role kept.
 */
export function crewForChat(
  sessionId: string | undefined,
): { crew: Crew; member: CrewMember; retired?: true } | undefined {
  if (!sessionId) return undefined;
  const found = chats().get(sessionId);
  if (!found) return undefined;
  const crew = cache.crews[found.key];
  if (!crew) return undefined;
  if (!found.memberId)
    return {
      crew,
      member: { id: `retired:${sessionId}`, role: found.role, sessionId },
      retired: true,
    };
  const member = crewMemberById(crew, found.memberId);
  return member ? { crew, member } : undefined;
}

export function isCrewChat(sessionId: string | undefined): boolean {
  return !!sessionId && chats().has(sessionId);
}

export function isCrewCopyPath(path: string | undefined): boolean {
  if (!path) return false;
  return Object.values(read().crews).some(
    (crew) => !!crew.copy && isEqualOrInside(path, crew.copy.path),
  );
}

// Crew chats and copies are bot chats and copies to every bot rule.
registerBotChatSource({
  hasChat: isCrewChat,
  chatIds: () => chats().keys(),
  isCopyPath: isCrewCopyPath,
});

// A crew's chat, or anything launched in a crew's copy, never starts
// without its rules (see `launchRefusal`).
registerGuardedChats(
  (sessionId, cwd) => isCrewChat(sessionId) || isCrewCopyPath(cwd),
);

// ---------------------------------------------------------------------------
// Counting runs

export function crewRunsToday(crew: Pick<Crew, "runs">, now: number): number {
  return crew.runs?.day === localDay(now) ? crew.runs.count : 0;
}

export function withCrewRun(crew: Crew, now: number): Crew {
  return {
    ...crew,
    runs: { day: localDay(now), count: crewRunsToday(crew, now) + 1 },
  };
}

/** Extra runs you allowed today. */
export function crewExtraToday(crew: Pick<Crew, "extra">, now: number): number {
  return crew.extra?.day === localDay(now) ? crew.extra.count : 0;
}

export function countToday(
  value: { day: string; count: number } | undefined,
  now: number,
): number {
  return value?.day === localDay(now) ? value.count : 0;
}

export function bumpToday(
  value: { day: string; count: number } | undefined,
  now: number,
  by = 1,
): { day: string; count: number } {
  return { day: localDay(now), count: countToday(value, now) + by };
}

// ---------------------------------------------------------------------------
// Feed, notes and ideas

export function withFeed(
  crew: Crew,
  entry: Omit<CrewFeedEntry, "id"> & { id?: string },
): Crew {
  const next: CrewFeedEntry = {
    ...entry,
    id: entry.id ?? crypto.randomUUID(),
    text: entry.text.slice(0, TEXT_MAX),
  };
  return { ...crew, feed: [...crew.feed, next].slice(-FEED_KEPT) };
}

/** Standing guidance for the crew: every bot reads it at each turn. */
export function withNote(crew: Crew, body: string, now: number): Crew {
  const clean = body.replace(/\s+/g, " ").trim().slice(0, CREW_NOTE_MAX);
  if (!clean) return crew;
  const note: CrewNote = { id: crypto.randomUUID(), at: now, text: clean };
  return withFeed(
    { ...crew, notes: [...crew.notes, note].slice(-NOTES_KEPT) },
    { at: now, kind: "note", who: "you", text: clean },
  );
}

export function withoutNote(crew: Crew, id: string): Crew {
  if (!crew.notes.some((note) => note.id === id)) return crew;
  return { ...crew, notes: crew.notes.filter((note) => note.id !== id) };
}

export function withIdea(crew: Crew, cardId: string, idea: CrewIdea): Crew {
  const ideas = { ...crew.ideas, [cardId]: idea };
  const keys = Object.keys(ideas);
  for (const key of keys.slice(0, Math.max(0, keys.length - IDEAS_KEPT)))
    delete ideas[key];
  return { ...crew, ideas };
}

// ---------------------------------------------------------------------------
// Cards

/** Cards that hold the crew's copy: one at a time. */
const HOLDS_COPY = new Set<CrewStage>([
  "building",
  "checking",
  "ready",
  "stuck",
]);

export function crewCard(
  crew: Pick<Crew, "cards">,
  id: string,
): CrewCard | undefined {
  return crew.cards.find((card) => card.id === id);
}

/** The card in the crew's copy now: being built or checked, Ready, or Stuck. */
export function cardInCopy(crew: Pick<Crew, "cards">): CrewCard | undefined {
  return crew.cards.find((card) => HOLDS_COPY.has(card.stage));
}

export function queuedCards(crew: Pick<Crew, "cards">): CrewCard[] {
  return crew.cards
    .filter((card) => card.stage === "queued")
    .sort((a, b) => a.queuedAt - b.queuedAt);
}

/** Save a card: replaced in place, or added. Old finished cards drop off. */
export function withCard(crew: Crew, card: CrewCard): Crew {
  const index = crew.cards.findIndex((item) => item.id === card.id);
  const cards =
    index < 0
      ? [...crew.cards, card]
      : crew.cards.map((item, at) => (at === index ? card : item));
  const done = cards.filter(
    (item) => item.stage === "applied" || item.stage === "discarded",
  );
  const drop = new Set(
    done
      .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
      .slice(0, Math.max(0, done.length - DONE_CARDS_KEPT))
      .map((item) => item.id),
  );
  return {
    ...crew,
    cards: drop.size ? cards.filter((item) => !drop.has(item.id)) : cards,
  };
}

export function withoutCard(crew: Crew, id: string): Crew {
  if (!crew.cards.some((card) => card.id === id)) return crew;
  return { ...crew, cards: crew.cards.filter((card) => card.id !== id) };
}

// ---------------------------------------------------------------------------
// The lease: one window drives a crew's turns at a time

export function claimCrewJob(path: string, owner: string, now = Date.now()) {
  let claimed = false;
  updateCrew(path, (crew) => {
    if (!crew.on) return crew;
    if (jobIsLive(crew.job, now) && crew.job?.owner !== owner) return crew;
    claimed = true;
    return {
      ...crew,
      job: {
        owner,
        since: crew.job?.owner === owner ? crew.job.since : now,
        heartbeat: now,
      },
    };
  });
  return claimed;
}

export function renewCrewJob(path: string, owner: string, now = Date.now()) {
  updateCrew(path, (crew) =>
    crew.job?.owner === owner
      ? { ...crew, job: { ...crew.job, heartbeat: now } }
      : crew,
  );
}

export function releaseCrewJob(path: string, owner: string) {
  updateCrew(path, (crew) =>
    crew.job?.owner === owner ? { ...crew, job: undefined } : crew,
  );
}

export { BOT_JOB_STALE_MS as CREW_JOB_STALE_MS };

// ---------------------------------------------------------------------------
// React

export function useCrewsStore(): Readonly<Record<string, Crew>> {
  return useSyncExternalStore(subscribeCrews, crewsSnapshot, crewsSnapshot);
}

export function useCrew(path: string | null | undefined): Crew | undefined {
  const getSnapshot = () => (path ? getCrew(path) : undefined);
  return useSyncExternalStore(subscribeCrews, getSnapshot, getSnapshot);
}

export type CrewChatOf = {
  path: string;
  role: CrewRole;
  /** Its member; none for a removed member's chat. */
  memberId?: string;
};

/** The crew member whose chat this is. */
export function useCrewChat(
  sessionId: string | undefined,
): CrewChatOf | undefined {
  const getSnapshot = () => {
    if (!sessionId) return undefined;
    const found = chats().get(sessionId);
    return found ? memoChat(found) : undefined;
  };
  return useSyncExternalStore(subscribeCrews, getSnapshot, getSnapshot);
}

const chatMemo = new Map<string, CrewChatOf>();
function memoChat(entry: ChatEntry): CrewChatOf {
  const crew = cache.crews[entry.key];
  const id = `${entry.key}\n${entry.role}\n${entry.memberId ?? ""}`;
  const known = chatMemo.get(id);
  if (known && crew && known.path === crew.path) return known;
  const next: CrewChatOf = {
    path: crew?.path ?? entry.key,
    role: entry.role,
    ...(entry.memberId ? { memberId: entry.memberId } : {}),
  };
  chatMemo.set(id, next);
  return next;
}
