import {
  CREW_ALL_RUNS_PER_DAY,
  CREW_ROLE_INFO,
  cardInCopy,
  countToday,
  crewExtraToday,
  crewRunsToday,
  queuedCards,
  type Crew,
  type CrewHoldReason,
  type CrewIdea,
} from "./crews";
import {
  formatClockMinutes,
  inQuietHours,
  localDay,
  type BotQuietHours,
} from "./projectBots";

/**
 * A crew's limits, kept by Aven, never by a bot, and always shown as plain
 * counts. Ideas start themselves, so these are what stop a crew from
 * spending your week:
 *
 * - runs a day per crew (every member's turns, the Fixer's included), and a
 *   ceiling for all crews together;
 * - one card at a time: a Ready or Stuck card holds the copy until you act;
 * - a daily cap on Scout ideas that start by themselves, and on ideas added;
 * - quiet hours, and a pause near the end of your Claude week.
 *
 * A limit holds the crew with a reason it states. Nothing polls a model
 * while a crew waits.
 */

export type CrewGate =
  | { ok: true }
  | {
      ok: false;
      reason: CrewHoldReason;
      /** One line: "Today's 20 runs are used". */
      title: string;
      /** What happens next: "The crew picks up again tomorrow." */
      detail: string;
    };

export type CrewGateInput = {
  crew: Crew;
  now: number;
  /** The Claude week's use, percent, when known. */
  weeklyUsed: number | null;
  /** The Fixer's runs today (the project bot's own count). */
  fixerRuns: number;
  /** Every crew's runs today, Fixers included. */
  allRuns: number;
  /** Every crew's runs a day together (your setting; 60 unless you changed it). */
  allRunsCap?: number;
};

/** The crew's runs today, its Fixer's included. */
export function crewRunsUsed(crew: Crew, now: number, fixerRuns = 0): number {
  return crewRunsToday(crew, now) + fixerRuns;
}

/** Runs the crew may use today: its daily runs and any you allowed on top. */
export function crewRunsAllowed(crew: Crew, now: number): number {
  return crew.limits.runsPerDay + crewExtraToday(crew, now);
}

/** "11 pm–8 am". */
export function quietText(quiet: BotQuietHours): string {
  return `${formatClockMinutes(quiet.start)}–${formatClockMinutes(quiet.end)}`;
}

/**
 * Whether the crew may start a turn now, or why it holds. Your pause comes
 * first, then quiet hours, then your Claude week, then the run caps.
 */
export function crewGate(input: CrewGateInput): CrewGate {
  const { crew, now } = input;
  if (crew.paused)
    return {
      ok: false,
      reason: "paused",
      title: "Paused",
      detail: "You paused the crew. Nothing new starts until you resume it.",
    };
  if (inQuietHours(crew.limits.quiet, now))
    return {
      ok: false,
      reason: "quiet-hours",
      title: `Quiet hours, ${quietText(crew.limits.quiet)}`,
      detail: "Nothing new starts. A turn already running finishes.",
    };
  if (
    input.weeklyUsed != null &&
    input.weeklyUsed >= crew.limits.pauseAtPercent
  )
    return {
      ok: false,
      reason: "usage",
      title: `Claude is ${Math.round(input.weeklyUsed)}% used for the week`,
      detail: `Crews pause at ${crew.limits.pauseAtPercent}% so your own chats keep working.`,
    };
  const used = crewRunsUsed(crew, now, input.fixerRuns);
  const allowed = crewRunsAllowed(crew, now);
  if (used >= allowed)
    return {
      ok: false,
      reason: "daily-cap",
      title: `Today's ${allowed} runs are used`,
      detail: "The crew picks up again tomorrow.",
    };
  const cap = input.allRunsCap ?? CREW_ALL_RUNS_PER_DAY;
  if (input.allRuns >= cap)
    return {
      ok: false,
      reason: "all-crews-cap",
      title: `All crews' ${cap} runs today are used`,
      detail: "Crews pick up again tomorrow.",
    };
  return { ok: true };
}

/** Every Builder (or Checker) is off or removed: the card waits, and says why. */
export function crewNoMemberGate(
  role: "builder" | "checker",
): Exclude<CrewGate, { ok: true }> {
  const label = CREW_ROLE_INFO[role].label;
  return {
    ok: false,
    reason: "no-member",
    title: `No ${label} is on`,
    detail: `Turn one on, or add one, in the crew's settings. The card waits.`,
  };
}

/**
 * One card at a time: the next queued card starts only once no card holds
 * the copy (being built or checked, Ready for your Apply, or Stuck).
 */
export function nextCardToStart(crew: Crew): string | null {
  if (cardInCopy(crew)) return null;
  return queuedCards(crew)[0]?.id ?? null;
}

/** Scout ideas started by themselves today, and how many may. */
export function autoStartsLeft(crew: Crew, now: number): number {
  return Math.max(
    0,
    crew.limits.autoStartsPerDay - countToday(crew.autoStarts, now),
  );
}

/**
 * Whether a Scout idea may start by itself: the Scout called it small, it
 * is not based on outside material, you didn't say Not now, and it has not
 * started before.
 */
export function ideaMayAutoStart(idea: CrewIdea | undefined): boolean {
  return (
    !!idea &&
    idea.size === "small" &&
    !idea.sourceUrl &&
    !idea.outside &&
    !idea.declined &&
    !idea.autoStarted
  );
}

/**
 * The Scout idea that starts by itself next, oldest first: only while the
 * crew is idle (no card in its copy, none queued) and under today's cap.
 * `inIdeas` says which of the ideas' cards still sit in Ideas.
 */
export function nextAutoStart(
  crew: Crew,
  now: number,
  inIdeas: (cardId: string) => boolean,
): string | null {
  if (cardInCopy(crew) || queuedCards(crew).length) return null;
  if (autoStartsLeft(crew, now) <= 0) return null;
  const known = new Set(crew.cards.map((card) => card.id));
  const ideas = Object.entries(crew.ideas ?? {})
    .filter(
      ([id, idea]) => ideaMayAutoStart(idea) && !known.has(id) && inIdeas(id),
    )
    .sort((a, b) => a[1].at - b[1].at);
  return ideas[0]?.[0] ?? null;
}

/** Ideas the Scout may still add today. */
export function ideasLeft(crew: Crew, now: number): number {
  return Math.max(
    0,
    crew.limits.ideasPerDay - countToday(crew.ideasAdded, now),
  );
}

const WEEK_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether the Scout looks for ideas now: as often as you set it (once a
 * day, once a week, or never), while the crew is idle with nothing it could
 * start, and with ideas left today.
 */
export function scoutShouldLook(
  crew: Crew,
  now: number,
  hasIdeaToStart: boolean,
): boolean {
  const scout = crew.members.find((member) => member.role === "scout");
  if (!scout || scout.paused || scout.schedule === "off") return false;
  if (cardInCopy(crew) || queuedCards(crew).length || hasIdeaToStart)
    return false;
  if (ideasLeft(crew, now) <= 0) return false;
  if (!crew.scoutAt) return true;
  if (scout.schedule === "weekly") return now - crew.scoutAt >= WEEK_MS;
  return localDay(crew.scoutAt) !== localDay(now);
}

// ---------------------------------------------------------------------------
// Words for the header

/** "7 of 20 runs today". */
export function crewRunsLine(crew: Crew, now: number, fixerRuns = 0): string {
  return `${crewRunsUsed(crew, now, fixerRuns)} of ${crewRunsAllowed(crew, now)} runs today`;
}

/**
 * "7 of 20 runs today · one card at a time · quiet 11 pm–8 am · pauses at
 * 80% of your week": every limit as a plain count, in the crew's header.
 */
export function crewLimitsLine(crew: Crew, now: number, fixerRuns = 0): string {
  return [
    crewRunsLine(crew, now, fixerRuns),
    "one card at a time",
    crew.limits.quiet.on ? `quiet ${quietText(crew.limits.quiet)}` : "",
    `pauses at ${crew.limits.pauseAtPercent}% of your week`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The limits in words. */
export function crewLimitRows(
  crew: Crew,
  allRunsCap = CREW_ALL_RUNS_PER_DAY,
): { title: string; detail: string }[] {
  const builder = CREW_ROLE_INFO.builder.label;
  const checker = CREW_ROLE_INFO.checker.label;
  return [
    {
      title: `${crew.limits.roundsPerCard} rounds a card`,
      detail: "Then it stops and asks you",
    },
    {
      title: `${crew.limits.runsPerDay} runs a day per crew · ${allRunsCap} for all crews`,
      detail: `One run is one bot turn. ${builder} + ${checker} × ${crew.limits.roundsPerCard} rounds = ${crew.limits.roundsPerCard * 2}`,
    },
    {
      title: "One card at a time",
      detail: `${builder} and ${checker} take turns in the crew's copy`,
    },
    {
      title: `${crew.limits.autoStartsPerDay} ideas start by themselves a day`,
      detail: "Only small ones the Scout found in the project",
    },
    {
      title: `Pause at ${crew.limits.pauseAtPercent}% of your Claude week`,
      detail: "Your own chats keep working",
    },
    {
      title: `Turns stop after ${crew.limits.turnMinutes} minutes`,
      detail: "The card waits for you with why",
    },
  ];
}
