import type { AgentState } from "./agentMark";
import { reviewHeading } from "./automationReview";
import { avosJobRuns, avosJobs } from "./avosJobs";
import { crewStatus } from "./crewView";
import type { Crew } from "./crews";
import type { BotStatus } from "./projectBots";
import type { ScheduledAgent, ScheduledRun } from "./scheduledAgents";

/**
 * Avos: each project's one always-on helper, which you talk to like a
 * person. In storage it is the project's crew and its Lead (`aven.crews.v1`),
 * so teams made before become their project's Avos, their Lead its voice and
 * their teammates its helpers.
 */

/** Avos's name, wherever it is shown. */
export const AVOS = "Avos";

/** The note beside Avos in a list: only when it needs you or is working. */
export type AvosNote = "needs-you" | "working";

export const AVOS_NOTE_LABEL: Readonly<Record<AvosNote, string>> = {
  "needs-you": "Needs you",
  working: "Working",
};

/** One project's Avos at a glance: the sidebar's row and Home's line. */
export type AvosGlance = {
  path: string;
  note: AvosNote | null;
  state: AgentState;
  /** One line on what it's doing or what waits for you. */
  line: string;
};

/** Whether you've met this project's Avos (it is stored with its voice). */
export function avosMet(crew: Pick<Crew, "on" | "members"> | undefined) {
  return (
    !!crew && (crew.on || crew.members.some((member) => member.role === "lead"))
  );
}

/**
 * Whether this is meeting Avos: it has never been awake, and nothing has
 * been said to it yet. Its chat then opens on its introduction.
 */
export function avosUnmet(
  crew: Pick<Crew, "on" | "onAt" | "messages" | "feed"> | undefined,
): boolean {
  return (
    !!crew &&
    !crew.on &&
    !crew.onAt &&
    !crew.messages?.length &&
    !crew.feed.some((entry) => entry.kind === "say")
  );
}

/** What Avos says when you first meet it: who it is, then its question. */
export function avosIntro(project: string): { hello: string; ask: string } {
  return {
    hello: `Hi, I'm Avos. I'll look after ${project}.`,
    ask: "What should I keep an eye on, and what's coming up this week?",
  };
}

const lowerFirst = (text: string) =>
  text ? `${text[0]!.toLowerCase()}${text.slice(1)}` : text;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What the project's Avos owns: its jobs and what their runs left for you. */
export type AvosJobsInput = {
  agents: readonly ScheduledAgent[];
  runs: readonly ScheduledRun[];
};

/** Runs of Avos's jobs waiting for you (a draft to publish, a failed run). */
export function avosReviews(path: string, jobs: AvosJobsInput | undefined) {
  if (!jobs) return [];
  return avosJobRuns(avosJobs(path, jobs.agents), jobs.runs);
}

/**
 * The live line under Avos's name: who is doing what now ("Builder is
 * fixing the pricing table"), else what waits for you, else how it rests.
 */
export function avosLine(
  crew: Crew | undefined,
  input: {
    name: (who: string) => string;
    reviews?: number;
    busy?: ReadonlySet<string>;
  },
): string {
  if (!crew || !avosMet(crew) || avosUnmet(crew)) return "Hasn't met you yet";
  const stuck = crew.on
    ? crew.cards.filter((card) => card.stage === "stuck").length
    : 0;
  const ready = crew.on
    ? crew.cards.filter((card) => card.stage === "ready").length
    : 0;
  const reviews = input.reviews ?? 0;
  const doing = crew.on
    ? crew.members.find(
        (member) => member.role !== "fixer" && !!member.doing?.text,
      )
    : undefined;
  if (doing?.doing) {
    const text = doing.doing.text.replace(/…$/, "");
    return doing.role === "lead"
      ? text
      : `${input.name(doing.id)} is ${lowerFirst(text)}`;
  }
  if (stuck)
    return stuck === 1
      ? "A card needs your answer"
      : `${plural(stuck, "card")} need your answer`;
  if (ready + reviews)
    return `${plural(ready + reviews, "thing")} ready for you`;
  if (!crew.on) return "Asleep. Write to wake it";
  if (crew.paused) return "Paused";
  return "Quiet";
}

/**
 * A project's Avos at a glance. Needs you when a card is stuck or ready to
 * apply, or a job's run left you something; Working while anyone works;
 * resting while paused or asleep; otherwise watching.
 */
export function avosGlance(
  path: string,
  crew: Crew | undefined,
  input: {
    name: (who: string) => string;
    busy?: ReadonlySet<string>;
    fixer?: BotStatus;
    jobs?: AvosJobsInput;
  },
): AvosGlance {
  const reviews = avosReviews(path, input.jobs).length;
  const line = avosLine(crew, {
    name: input.name,
    reviews,
    ...(input.busy ? { busy: input.busy } : {}),
  });
  if (!crew || !avosMet(crew))
    return { path, note: null, state: "still", line };
  // Meeting it: it looks at you, waiting for your answer.
  if (avosUnmet(crew)) return { path, note: null, state: "watching", line };
  const status = crewStatus(crew, {
    ...(input.fixer ? { fixer: input.fixer } : {}),
    ...(input.busy ? { busy: input.busy } : {}),
  });
  if (status === "needs-you" || status === "ready" || (crew.on && reviews))
    return { path, note: "needs-you", state: "needs", line };
  if (status === "working")
    return { path, note: "working", state: "working", line };
  if (!crew.on || status === "paused")
    return { path, note: null, state: "resting", line };
  return { path, note: null, state: "watching", line };
}

/** One line in Avos's This week list, and what pressing it does. */
export type AvosWeekRow = {
  id: string;
  text: string;
  /** Look at what's ready, answer a card, open a run or a job. */
  open?:
    | { kind: "review" }
    | { kind: "card"; cardId: string }
    | { kind: "run"; runId: string }
    | { kind: "job"; jobId: string };
};

/** Avos's week: what needs you, what it's doing, watching, and has done. */
export type AvosWeek = {
  needs: AvosWeekRow[];
  doing: AvosWeekRow[];
  watching: AvosWeekRow[];
  done: AvosWeekRow[];
};

const WEEK = 7 * 24 * 60 * 60_000;
const DONE_SHOWN = 5;

/**
 * The This week list beside Avos's chat. Needs you: a card waiting on your
 * answer, finished work to look at, and what its jobs left for you. Doing
 * now: what Avos and its helpers are at. Keeping
 * an eye on: its jobs. Done: work you applied in the last seven days.
 */
export function avosWeek(
  crew: Crew,
  input: { jobs?: AvosJobsInput; now: number },
): AvosWeek {
  const on = crew.on;
  const needs: AvosWeekRow[] = [];
  for (const card of on ? crew.cards : [])
    if (card.stage === "stuck")
      needs.push({
        id: `stuck:${card.id}`,
        text: `“${card.title}” needs your answer`,
        open: { kind: "card", cardId: card.id },
      });
  const ready = on ? crew.cards.filter((card) => card.stage === "ready") : [];
  if (ready.length)
    needs.push({
      id: "ready",
      text:
        ready.length === 1
          ? `Look at “${ready[0]!.title}”`
          : `Look at ${ready.length} finished cards`,
      open: { kind: "review" },
    });
  for (const run of avosReviews(crew.path, input.jobs))
    needs.push({
      id: `run:${run.id}`,
      text:
        run.review?.status === "open"
          ? `${reviewHeading(run.review)}: ${run.review.title}`
          : `“${run.name}” didn't finish`,
      open: { kind: "run", runId: run.id },
    });
  // Cards at work, then anyone busy with something else (Avos answering
  // you, a Scout looking for ideas).
  const working = on
    ? crew.cards.filter(
        (card) =>
          (card.stage === "building" || card.stage === "checking") &&
          !card.paused,
      )
    : [];
  const doing: AvosWeekRow[] = [
    ...working.map((card) => ({ id: `card:${card.id}`, text: card.title })),
    ...(on ? crew.members : []).flatMap((member) =>
      member.role !== "fixer" &&
      member.doing?.text &&
      !working.some((card) => member.doing!.text.includes(card.title))
        ? [{ id: `doing:${member.id}`, text: member.doing.text }]
        : [],
    ),
  ];
  const watching: AvosWeekRow[] = input.jobs
    ? avosJobs(crew.path, input.jobs.agents)
        .filter((job) => job.enabled)
        .map((job) => ({
          id: `job:${job.id}`,
          text: job.name,
          open: { kind: "job" as const, jobId: job.id },
        }))
    : [];
  const done: AvosWeekRow[] = crew.cards
    .filter(
      (card) =>
        card.stage === "applied" &&
        (card.endedAt ?? card.updatedAt) >= input.now - WEEK,
    )
    .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))
    .slice(0, DONE_SHOWN)
    .map((card) => ({ id: `done:${card.id}`, text: card.title }));
  return { needs, doing, watching, done };
}
