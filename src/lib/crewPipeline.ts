import { crewBatch } from "./crewActions";
import { quietText, crewRunsLine } from "./crewLimits";
import { roundLimit } from "./crewLoop";
import {
  cardInCopy,
  cardSteppedAside,
  queuedCards,
  waitsForReview,
  type Crew,
} from "./crews";
import type { CrewBoardAction, CrewBoardInfo } from "./crewView";
import type { RaceFile } from "./race";
import type { BoardAction } from "./workBoard";
import { plural } from "./words";

/**
 * What the team's header and chat say, worked out from the store and the
 * Board alone, so it can be tested without rendering: one sentence on what
 * the team is doing and what waits for you, its goal and whether it is
 * really going, and what's ready for you.
 */

/** A Board card as the Board worked it out (its team face included). */
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

/** Something ready for you that isn't on the team's branch. */
export type PipelineRow = {
  id: string;
  title: string;
  /** One line on where it stands. */
  status: string;
  /** Aven's buttons for it (the team's), first the main one. */
  actions: CrewBoardAction[];
  /** A Board card that isn't the team's: its own actions (Review, Ship it…). */
  boardActions?: readonly BoardAction[];
};

export type PipelineBatch = {
  /** "3 cards ready on the team's branch". */
  title: string;
  /** Their names, and what they changed. */
  status: string;
  cards: { id: string; title: string }[];
  /** Why the last Apply couldn't land, when your files moved on. */
  conflict?: string;
  /** A card on it was replayed and not checked again: Apply goes through Review. */
  reviewFirst: boolean;
};

/** The goal as the header says it: going, waiting (and on what), met or stopped. */
export type PipelineGoal = {
  text: string;
  state: "on" | "waits" | "met" | "stopped";
  why?: string;
};

export type Pipeline = {
  /** One sentence: what the team is doing now, and what needs you. */
  sentence: string;
  /** The card the sentence names, in bold. */
  focus?: string;
  /** No work at all: the header offers a Scout when the team has none. */
  idle: boolean;
  offerScout: boolean;
  goal?: PipelineGoal;
  batch: PipelineBatch | null;
  /** Ready for you that isn't on the branch: an older Ready card, or a chat's work to review. */
  ready: PipelineRow[];
  /** "4 of 20 runs today · quiet 11 pm–8 am". */
  limits: string;
};

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

export function crewPipeline(input: {
  crew: Crew;
  /** The Board's cards, as `crewBoardColumns` placed them. */
  cards: readonly PipelineBoardCard[];
  now: number;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  /** The Fixer's runs today, which count towards the team's. */
  fixerRuns?: number;
  /** Why a limit holds the team now, when one does: its title. */
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
  // The idea that builds next, by itself (the Board marks it Next).
  const nextIdea = input.cards.find(
    (card) => card.column === "idea" && card.crew?.label === "Next",
  );

  // Ready for you: the batch on the team's branch, as one row. Its checks
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
        title: `${plural(batchOf.cards.length, "card")} ready on the team's branch`,
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

  // What waits for you: Ready work, and cards that stopped and stepped
  // aside (the team went on without them).
  const aside = crew.cards.filter((card) => cardSteppedAside(card)).length;
  const waiting =
    (batchOf?.cards.length ?? 0) +
    ready.filter((row) => !row.boardActions).length +
    aside;
  const waits =
    waiting === 1
      ? "One thing waits for you."
      : waiting > 1
        ? `${plural(waiting, "thing")} wait for you.`
        : "";

  // The sentence: what it's doing now, then what waits for you.
  let sentence = "";
  let focus: string | undefined;
  const goalOn = !!crew.goal && !crew.goal.done;
  // Why nothing new starts now, for the goal's line.
  let held: string | undefined;
  if (crew.paused) {
    sentence = "Paused.";
    held = "paused";
  } else if (working) {
    focus = working.title;
    const rounds =
      working.round > 1
        ? `, round ${working.round} of ${roundLimit(working)}`
        : "";
    if (working.stage === "stuck") {
      const why = working.stuck?.text ?? "it stopped";
      // A question keeps its own mark: "…fill up?", never "…fill up?."
      sentence = `${working.title} needs you: ${why}${/[.!?…]$/.test(why) ? "" : "."} Nothing else starts until you sort it out.`;
      held = "waits for you";
    } else if (working.paused) {
      sentence = `${working.title} is paused.`;
      held = "waits for you";
    } else if (working.holder === "security")
      sentence = `${name("security")} is reviewing ${working.title}${rounds}.`;
    else if (working.holder === "checker" || working.stage === "checking")
      sentence = `Checking ${working.title}${rounds}.`;
    else sentence = `Building ${working.title}${rounds}.`;
  } else if (queued.length || nextIdea) {
    focus = queued[0]?.title ?? nextIdea!.title;
    sentence = `Starting ${focus}.`;
  } else if (goalOn) sentence = "Planning the next card for the goal.";
  if (input.hold && !crew.paused) {
    sentence = `${input.hold}: ${focus ?? "the team"} waits.`;
    held = "waits";
  }
  // Enough waits on the branch: nothing new starts until you review it.
  const capped = waitsForReview(crew);
  if (
    capped &&
    !crew.paused &&
    !working &&
    (queued.length || nextIdea || goalOn)
  ) {
    sentence = `${capped} cards wait for you: review them to keep going.`;
    held = "waits for your review";
  }
  const idle =
    !working &&
    !queued.length &&
    !nextIdea &&
    !batchOf &&
    !ready.length &&
    !aside &&
    !goalOn;
  if (idle && !crew.paused) {
    // Ideas that wait for you (Not now, from outside): they need your word.
    const ideas = input.cards.filter(
      (card) =>
        card.column === "idea" &&
        card.crew?.actions.some((action) => action.id === "give"),
    ).length;
    sentence = ideas
      ? `${plural(ideas, "idea")} ${ideas === 1 ? "waits" : "wait"} for you to press Build it.`
      : "Nothing to build. Add an idea and the team builds it.";
  }
  sentence = (
    capped && sentence.startsWith(`${capped} cards wait`)
      ? [sentence]
      : [sentence, waits]
  )
    .filter(Boolean)
    .join(" ");

  const goal: PipelineGoal | undefined = crew.goal
    ? crew.goal.done
      ? {
          text: crew.goal.text,
          state: crew.goal.done.met ? "met" : "stopped",
          why: crew.goal.done.text,
        }
      : held
        ? { text: crew.goal.text, state: "waits", why: held }
        : { text: crew.goal.text, state: "on" }
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
    limits,
  };
}
