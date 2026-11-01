import { crewBatch } from "./crewActions";
import { quietText, crewRunsLine } from "./crewLimits";
import { roundLimit, roundOf } from "./crewLoop";
import {
  cardBuilder,
  cardChecker,
  cardInCopy,
  cardSecurity,
  crewMemberById,
  memberCritter,
  queuedCards,
  waitsForReview,
  type Crew,
  type CrewCard,
  type CrewLoopRole,
} from "./crews";
import type { CrewBoardAction, CrewBoardInfo } from "./crewView";
import type { RaceFile } from "./race";
import type { BoardAction } from "./workBoard";
import { plural } from "./words";

/**
 * The crew's Pipeline: one sentence on what it's doing and what needs you,
 * then its cards as rows grouped Ready for you → In progress → Up next →
 * Ideas, each with its path through Build, Check, Security and You, and a
 * quiet footer (shipped this week, the limits). Worked out from the store
 * and the Board alone, so it can be tested without rendering.
 */

export type PipelineStepId = "build" | "check" | "security" | "you";

export const PIPELINE_STEPS: readonly { id: PipelineStepId; label: string }[] =
  [
    { id: "build", label: "Build" },
    { id: "check", label: "Check" },
    { id: "security", label: "Security" },
    { id: "you", label: "You" },
  ];

export type PipelineStep = {
  id: PipelineStepId;
  label: string;
  /** done ✓, now (the working member's mark), stuck (waits on you), todo, or skip (no Security). */
  state: "done" | "now" | "stuck" | "todo" | "skip";
  /** The member at this step now: its id, role and mark. */
  who?: { id: string; role: CrewLoopRole | "you"; critter?: string };
};

/** A Board card the Pipeline shows, as the Board worked it out. */
export type PipelineBoardCard = {
  id: string;
  title: string;
  column: "idea" | "building" | "review" | "shipped";
  at: number;
  line?: string;
  needsYou?: string;
  actions: readonly BoardAction[];
  crew?: CrewBoardInfo;
};

export type PipelineRow = {
  id: string;
  title: string;
  /** One line on where it stands. */
  status: string;
  /** For a card at work: how far along, 0–1. */
  progress?: number;
  /** Its path through Build, Check, Security and You; none for an idea or a plain card. */
  steps?: PipelineStep[];
  needsYou?: boolean;
  /** Aven's buttons for it (the crew's), first the main one. */
  actions: CrewBoardAction[];
  /** A Board card that isn't the crew's: its own actions (Review, Ship it…). */
  boardActions?: readonly BoardAction[];
  /** When its current step started, for the elapsed time. */
  since?: number;
};

export type PipelineBatch = {
  /** "3 cards ready on the crew's branch". */
  title: string;
  /** Their names, and what they changed. */
  status: string;
  cards: { id: string; title: string }[];
  /** Why the last Apply couldn't land, when your files moved on. */
  conflict?: string;
  steps: PipelineStep[];
  /** A card on it was replayed and not checked again: Apply goes through Review. */
  reviewFirst: boolean;
};

export type Pipeline = {
  /** One sentence: what the crew is doing now, and what needs you. */
  sentence: string;
  /** The card the sentence names, in bold. */
  focus?: string;
  /** No work at all: the header offers a Scout when the crew has none. */
  idle: boolean;
  offerScout: boolean;
  goal?: { text: string; state: "on" | "met" | "stopped"; why?: string };
  batch: PipelineBatch | null;
  /** Ready for you that isn't on the branch: an older Ready card, or a chat's work to review. */
  ready: PipelineRow[];
  inProgress: PipelineRow[];
  upNext: PipelineRow[];
  ideas: PipelineRow[];
  shipped: string[];
  /** "4 of 20 runs today · quiet 11 pm–8 am". */
  limits: string;
};

const WEEK_MS = 7 * 24 * 60 * 60_000;

/** A member's mark at a step. */
function at(
  crew: Crew,
  id: string | undefined,
  role: CrewLoopRole,
): PipelineStep["who"] {
  const member = crewMemberById(crew, id);
  return member
    ? {
        id: member.id,
        role,
        ...(member.critter ? { critter: memberCritter(member) } : {}),
      }
    : undefined;
}

/** The step a card is at, and who holds it. */
function cardSteps(crew: Crew, card: CrewCard): PipelineStep[] {
  const withSecurity =
    !!cardSecurity(crew) || card.rounds.some((round) => round.security);
  const index =
    card.stage === "queued"
      ? -1
      : card.stage === "ready"
        ? 3
        : card.holder === "security"
          ? 2
          : card.holder === "checker"
            ? 1
            : card.stage === "checking"
              ? 1
              : 0;
  const stuck = card.stage === "stuck" || !!card.paused;
  return PIPELINE_STEPS.map((step, position): PipelineStep => {
    if (step.id === "security" && !withSecurity && position !== index)
      return { ...step, state: "skip" };
    if (position < index) return { ...step, state: "done" };
    if (position > index || index < 0) return { ...step, state: "todo" };
    const who =
      step.id === "you"
        ? ({ id: "you", role: "you" } as const)
        : step.id === "build"
          ? at(crew, card.builderId ?? cardBuilder(crew, card)?.id, "builder")
          : step.id === "check"
            ? at(crew, card.checkerId ?? cardChecker(crew, card)?.id, "checker")
            : at(crew, cardSecurity(crew)?.id, "security");
    return {
      ...step,
      state: stuck && step.id !== "you" ? "stuck" : "now",
      ...(who ? { who } : {}),
    };
  });
}

/** How far along a card at work is: by round and step, never quite done. */
function progressOf(card: CrewCard): number {
  const step =
    card.holder === "security" ? 2 : card.holder === "checker" ? 1 : 0;
  const total = Math.max(1, roundLimit(card)) * 3;
  return Math.min(0.95, ((card.round - 1) * 3 + step + 0.5) / total);
}

/** "Fixing", "Checking"… the verb for who holds a card now. */
function doing(card: CrewCard): string {
  if (card.holder === "security") return "reviewing it for security";
  if (card.holder === "checker" || card.stage === "checking")
    return "checking the build";
  return card.round > 1 ? "fixing" : "building it";
}

/** The must-fixes the card is back for, in a few words. */
function fixesFor(card: CrewCard): string {
  const last = roundOf(card, card.round - 1);
  const found = last?.security?.mustFix.length
    ? last.security.mustFix
    : (last?.verdict?.mustFix ?? []);
  return found.length ? found[0]!.text.replace(/\s+/g, " ").slice(0, 80) : "";
}

function inProgressRow(
  crew: Crew,
  card: CrewCard,
  info: CrewBoardInfo | undefined,
  name: (who: string) => string,
): PipelineRow {
  const steps = cardSteps(crew, card);
  const holder = steps.find((step) => step.who && step.state !== "done");
  const who =
    holder?.who && holder.who.role !== "you" ? name(holder.who.id) : "";
  const rounds = `Round ${card.round} of ${roundLimit(card)}`;
  const status =
    card.stage === "stuck"
      ? (card.stuck?.text ?? "Waiting on you")
      : card.paused
        ? `${rounds} · paused`
        : [
            rounds,
            [who, doing(card)].filter(Boolean).join(" ") +
              (card.round > 1 && card.holder === "builder" && fixesFor(card)
                ? `: ${fixesFor(card)}`
                : ""),
          ]
            .filter(Boolean)
            .join(" · ");
  return {
    id: card.id,
    title: card.title,
    status,
    ...(card.stage !== "stuck" && !card.paused
      ? { progress: progressOf(card) }
      : {}),
    steps,
    ...(card.stage === "stuck" ? { needsYou: true } : {}),
    actions: info?.actions ? [...info.actions] : [],
    ...(card.turn ? { since: card.turn.sentAt } : {}),
  };
}

/**
 * What a file in a Review does besides its lines, in a few words: a link
 * and where it points, a program that runs (or no longer does), binary.
 */
export function reviewFileNotes(
  file: Pick<RaceFile, "binary" | "oldMode" | "newMode" | "linkTarget">,
): string[] {
  const notes: string[] = [];
  if (file.newMode === "120000")
    notes.push(`a link to ${file.linkTarget ?? "somewhere"}`);
  else if (file.oldMode === "120000" && file.newMode !== "000000")
    notes.push("no longer a link");
  if (file.newMode === "100755" && file.oldMode !== "100755")
    notes.push("runs as a program");
  if (file.oldMode === "100755" && file.newMode === "100644")
    notes.push("no longer runs as a program");
  if (file.newMode === "160000") notes.push("another repository");
  if (file.binary) notes.push("binary");
  return notes;
}

/** Where an Up next card came from. */
/** You picked who builds or checks it, its model, or its rounds. */
function chose(crew: Crew, card: CrewCard): boolean {
  return (
    !!card.builderId ||
    !!card.checkerId ||
    !!card.override ||
    card.maxRounds !== crew.limits.roundsPerCard
  );
}

function fromWords(card: CrewCard, name: (who: string) => string): string {
  if (card.goal) return "Planned for the goal";
  if (card.from === "security") return `From ${name("security")}`;
  if (card.from === "scout") return `From ${name("scout")}`;
  if (card.from === "member")
    return `From you, via ${name(card.fromMember ?? "builder")}`;
  return "From you";
}

export function crewPipeline(input: {
  crew: Crew;
  /** The Board's cards, as `crewBoardColumns` placed them. */
  cards: readonly PipelineBoardCard[];
  now: number;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  /** The Fixer's runs today, which count towards the crew's. */
  fixerRuns?: number;
  /** Why a limit holds the crew now, when one does: its title. */
  hold?: string;
  /** The files the batch changes, as the branch's range reads (once read). */
  batchFiles?: number;
}): Pipeline {
  const { crew, now, name } = input;
  const byId = new Map(input.cards.map((card) => [card.id, card]));
  const batchOf = crewBatch(crew);
  const working = cardInCopy(crew);
  const queued = queuedCards(crew);
  const crewIds = new Set(crew.cards.map((card) => card.id));

  // Ready for you: the batch on the crew's branch, as one row. Its checks
  // are what every card on it had: a card a restack replayed wasn't checked
  // again, and one Security didn't review makes the batch only "checked".
  const replayed = !!batchOf?.cards.some((card) => card.stacked?.replayed);
  const secured =
    !!batchOf &&
    batchOf.cards.every((card) =>
      card.rounds.some((round) => round.n === card.round && round.security),
    );
  const batch: PipelineBatch | null = batchOf
    ? {
        title: `${plural(batchOf.cards.length, "card")} ready on the crew's branch`,
        status: [
          batchOf.cards.map((card) => card.title).join(" · "),
          input.batchFiles != null ? plural(input.batchFiles, "file") : "",
          replayed
            ? "replayed onto your files, not re-checked"
            : secured
              ? "checked and secured"
              : "checked",
        ]
          .filter(Boolean)
          .join(" · "),
        cards: batchOf.cards.map((card) => ({
          id: card.id,
          title: card.title,
        })),
        ...(crew.stack?.conflict ? { conflict: crew.stack.conflict } : {}),
        steps: cardSteps(crew, batchOf.cards.at(-1)!),
        reviewFirst: replayed,
      }
    : null;

  // An older Ready card that holds the copy (from before the branch), and
  // chats' work waiting for review on the Board.
  const ready: PipelineRow[] = [];
  for (const card of crew.cards)
    if (card.stage === "ready" && !card.stacked) {
      const info = byId.get(card.id)?.crew;
      ready.push({
        id: card.id,
        title: card.title,
        status: info?.detail
          ? `${info.label ?? "Ready"} · ${info.detail}`
          : "Ready",
        steps: cardSteps(crew, card),
        actions: info?.actions ? [...info.actions] : [],
      });
    }
  for (const card of input.cards)
    if (card.column === "review" && !crewIds.has(card.id))
      ready.push({
        id: card.id,
        title: card.title,
        status: card.needsYou ?? card.line ?? "Ready to review",
        actions: [],
        boardActions: card.actions,
      });

  const inProgress: PipelineRow[] = [];
  if (working)
    inProgress.push(
      inProgressRow(crew, working, byId.get(working.id)?.crew, name),
    );
  for (const card of input.cards)
    if (card.column === "building" && !crewIds.has(card.id))
      inProgress.push({
        id: card.id,
        title: card.title,
        status: card.needsYou ?? card.line ?? "In a chat",
        ...(card.needsYou ? { needsYou: true } : {}),
        actions: [],
        boardActions: card.actions,
      });

  const upNext: PipelineRow[] = queued.map((card) => ({
    id: card.id,
    title: card.title,
    status: [
      fromWords(card, name),
      // Who it went to, and how, only when you chose.
      (chose(crew, card) ? byId.get(card.id)?.crew?.assigned : undefined) ??
        (working ? `waits for ${working.title}` : "next up"),
    ].join(" · "),
    steps: cardSteps(crew, card),
    actions: byId.get(card.id)?.crew?.actions
      ? [...byId.get(card.id)!.crew!.actions]
      : [],
  }));

  const ideas: PipelineRow[] = input.cards
    .filter((card) => card.column === "idea")
    .map((card) => ({
      id: card.id,
      title: card.title,
      status: card.crew?.line ?? "Idea · not given yet",
      actions: card.crew?.actions ? [...card.crew.actions] : [],
    }));

  const shipped = [
    ...crew.cards
      .filter(
        (card) =>
          card.stage === "applied" && now - (card.endedAt ?? 0) < WEEK_MS,
      )
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .map((card) => card.title),
    ...input.cards
      .filter(
        (card) =>
          card.column === "shipped" &&
          !crewIds.has(card.id) &&
          now - card.at < WEEK_MS,
      )
      .map((card) => card.title),
  ];

  // The sentence: what it's doing now, then what waits for you.
  const waiting =
    (batchOf?.cards.length ?? 0) +
    ready.filter((row) => !row.boardActions).length;
  const waits =
    waiting === 1
      ? "One card waits for you."
      : waiting > 1
        ? `${plural(waiting, "card")} wait for you.`
        : "";
  let sentence = "";
  let focus: string | undefined;
  if (crew.paused) sentence = "Paused.";
  else if (working) {
    focus = working.title;
    const rounds = `round ${working.round} of ${roundLimit(working)}`;
    if (working.stage === "stuck")
      sentence = `${working.title} needs you: ${working.stuck?.text ?? "it stopped"}.`;
    else if (working.paused) sentence = `${working.title} is paused.`;
    else if (working.holder === "security")
      sentence = `${name("security")} is reviewing ${working.title} for security, ${rounds}.`;
    else if (working.holder === "checker" || working.stage === "checking")
      sentence = `Checking ${working.title}, ${rounds}.`;
    else if (working.round > 1) {
      const last = roundOf(working, working.round - 1);
      const asked = last?.security?.mustFix.length
        ? `${name("security")} asked for ${plural(last.security.mustFix.length, "fix", "fixes")}`
        : last?.verdict?.mustFix.length
          ? `${name(working.checkerId ?? "checker")} asked for ${plural(last.verdict.mustFix.length, "fix", "fixes")}`
          : "";
      sentence = `Building ${working.title}, ${rounds}${asked ? `: ${asked}` : ""}.`;
    } else sentence = `Building ${working.title}, ${rounds}.`;
  } else if (queued.length) {
    focus = queued[0]!.title;
    sentence = `Starting ${queued[0]!.title}.`;
  } else if (crew.goal && !crew.goal.done)
    sentence = "Planning the next card for the goal.";
  if (input.hold && !crew.paused && (working || queued.length))
    sentence = `${input.hold}: ${focus ?? "the crew"} waits.`;
  // Enough waits on the branch: nothing new starts until you review it.
  const capped = waitsForReview(crew);
  if (
    capped &&
    !crew.paused &&
    !working &&
    (queued.length || (crew.goal && !crew.goal.done))
  )
    sentence = `${capped} cards wait for you: review them to keep going.`;
  const idle =
    !working &&
    !queued.length &&
    !batchOf &&
    !ready.length &&
    !(crew.goal && !crew.goal.done);
  if (idle && !crew.paused)
    sentence = "Nothing to build. Tell the crew what to do, or add an idea.";
  sentence = (
    capped && sentence.startsWith(`${capped} cards wait`)
      ? [sentence]
      : [sentence, waits]
  )
    .filter(Boolean)
    .join(" ");

  const goal = crew.goal
    ? {
        text: crew.goal.text,
        state: crew.goal.done
          ? crew.goal.done.met
            ? ("met" as const)
            : ("stopped" as const)
          : ("on" as const),
        ...(crew.goal.done ? { why: crew.goal.done.text } : {}),
      }
    : undefined;

  const limits = [
    crewRunsLine(crew, now, input.fixerRuns ?? 0),
    crew.limits.quiet.on ? `quiet ${quietText(crew.limits.quiet)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    sentence,
    ...(focus ? { focus } : {}),
    idle,
    offerScout: idle && !crew.members.some((member) => member.role === "scout"),
    ...(goal ? { goal } : {}),
    batch,
    ready,
    inProgress,
    upNext,
    ideas,
    shipped,
    limits,
  };
}
