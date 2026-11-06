import type { AgentState } from "./agentMark";
import { reviewHeading } from "./automationReview";
import { sameProjectPath } from "./recents";
import { avosJobRuns, avosJobs } from "./avosJobs";
import { crewStatus } from "./crewView";
import type { Crew } from "./crews";
import type { CrewMemberView } from "./crewView";
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

/** One line in Avos's week, and what pressing it does. */
export type AvosWeekRow = {
  id: string;
  text: string;
  /** When it started waiting on you: Needs you rows only. */
  at?: number;
  /** How many things the row stands for, when more than one. */
  count?: number;
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
 * Avos's week. Needs you: a card waiting on your answer, finished work to
 * look at, and what its jobs left for you (the notices and badges count
 * these). Doing now: what Avos and its helpers are at. Keeping an eye on:
 * its jobs, in its profile. Done: work you applied in the last seven days.
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
        at: card.updatedAt,
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
      at: Math.max(...ready.map((card) => card.updatedAt)),
      ...(ready.length > 1 ? { count: ready.length } : {}),
      open: { kind: "review" },
    });
  for (const run of avosReviews(crew.path, input.jobs))
    needs.push({
      id: `run:${run.id}`,
      text:
        run.review?.status === "open"
          ? `${reviewHeading(run.review)}: ${run.review.title}`
          : `“${run.name}” didn't finish`,
      at: run.review?.postedAt ?? run.finishedAt ?? run.startedAt,
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

/** One project's Avos and what waits on you there. */
export type AvosNeeds = { path: string; rows: AvosWeekRow[] };

/**
 * What each met Avos waits on you for: its week's Needs you rows, for
 * every project that has any. The notices, the Dock badge, Home's Needs you
 * and the Inbox's pointer all count these, each thing once.
 */
export function avosNeeds(
  crews: readonly (Crew | undefined)[],
  input: { jobs?: AvosJobsInput; now: number },
): AvosNeeds[] {
  return crews.flatMap((crew) => {
    if (!crew || !avosMet(crew)) return [];
    const rows = avosWeek(crew, input).needs;
    return rows.length ? [{ path: crew.path, rows }] : [];
  });
}

/**
 * How many things these rows wait on you for, as Avos's line counts them:
 * each card, and each job's run, once.
 */
export function avosRowsCount(rows: readonly AvosWeekRow[]): number {
  return rows.reduce((count, row) => count + (row.count ?? 1), 0);
}

/** How many things every Avos waits on you for, each counted once. */
export function avosNeedsCount(needs: readonly AvosNeeds[]): number {
  return needs.reduce((count, entry) => count + avosRowsCount(entry.rows), 0);
}

/** The Inbox's one line pointing at Avos: "2 things in Avos need you". */
export function avosInboxLine(count: number): string {
  return count === 1
    ? "1 thing in Avos needs you"
    : `${count} things in Avos need you`;
}

/**
 * Whether a run belongs to a project's Avos: its job is Avos's and that
 * Avos is there. Its card then lives in Avos alone (its chat and one
 * notice), never also in the Inbox or Activity. A job whose Avos is gone
 * runs as an ordinary automation, and is shown like one.
 */
export function avosOwnsRun(
  run: Pick<ScheduledRun, "scheduleId">,
  agents: readonly Pick<ScheduledAgent, "id" | "owner">[],
  crewFor: (path: string) => Crew | undefined,
): boolean {
  const owner = agents.find((agent) => agent.id === run.scheduleId)?.owner;
  return !!owner && avosMet(crewFor(owner.avos));
}

/**
 * The id a Mac notification about a project's Avos carries in place of a
 * chat's, so pressing it opens that Avos. The folder is encoded, since the
 * notification's own id may not contain "/".
 */
export function avosNotificationId(path: string): string {
  return `avos:${encodeURIComponent(path)}`;
}

/** The project a notification's id opens the Avos of, if it is one. */
export function avosNotificationPath(id: string): string | null {
  if (!id.startsWith("avos:")) return null;
  try {
    return decodeURIComponent(id.slice("avos:".length)) || null;
  } catch {
    return null;
  }
}

/** The most of your last message in a chat that "Give to Avos" passes on. */
const GIVEN_ASK_MAX = 1_500;

/**
 * What "Give to Avos" (a chat's menu) says to the project's Avos: the chat,
 * and the last thing you asked in it when it's open, so Avos can take it
 * from there. The message links back to the chat as an @Avos one does.
 */
export function giveChatToAvosText(title: string, lastAsk?: string): string {
  const ask = lastAsk?.replace(/\s+/g, " ").trim() ?? "";
  const quoted =
    ask.length > GIVEN_ASK_MAX ? `${ask.slice(0, GIVEN_ASK_MAX - 1)}…` : ask;
  return [
    `Please take this chat over: “${title || "Untitled"}”.`,
    ...(quoted ? [`The last thing I asked in it: ${quoted}`] : []),
  ].join("\n\n");
}

/** A "needs you" notice from one project's Avos, with what it offers. */
export type AvosNotice = {
  /** The project and the row of its week it's about: shown once. */
  id: string;
  path: string;
  text: string;
  open?: AvosWeekRow["open"];
  /** A job's run waiting for your word (Publish, Approve): one press. */
  runId?: string;
};

/** Projects with a notice on screen at once: those with the newest. */
export const AVOS_NOTICES_SHOWN = 3;

/**
 * The notices on screen once new ones arrive: each joins its project's
 * card, and only the projects with the newest stay (AVOS_NOTICES_SHOWN).
 */
export function withAvosNotices(
  current: readonly AvosNotice[],
  fresh: readonly AvosNotice[],
): AvosNotice[] {
  const all = [...current, ...fresh];
  const latest: string[] = [];
  for (const notice of [...all].reverse())
    if (!latest.some((path) => sameProjectPath(path, notice.path)))
      latest.push(notice.path);
  const shown = latest.slice(0, AVOS_NOTICES_SHOWN);
  return all.filter((notice) =>
    shown.some((path) => sameProjectPath(path, notice.path)),
  );
}

/**
 * One card per project, where its first notice arrived, so something new
 * updates its card ("2 things need you") rather than stacking another.
 */
export function avosNoticeCards(
  notices: readonly AvosNotice[],
): { path: string; notices: AvosNotice[] }[] {
  const cards: { path: string; notices: AvosNotice[] }[] = [];
  for (const notice of notices) {
    const card = cards.find((entry) =>
      sameProjectPath(entry.path, notice.path),
    );
    if (card) card.notices.push(notice);
    else cards.push({ path: notice.path, notices: [notice] });
  }
  return cards;
}

/**
 * Which "needs you" items deserve a notice now: those that weren't there
 * before (`seen`), for an Avos whose screen isn't in front. The first look
 * (no `seen` yet) only learns what's there, so opening Aven never brings a
 * pile of old notices. Returns the new notices and what's been seen.
 */
export function avosNoticesFor(
  needs: readonly AvosNeeds[],
  seen: ReadonlySet<string> | null,
  inFront: string | null,
): { notices: AvosNotice[]; seen: Set<string> } {
  const next = new Set<string>();
  const notices: AvosNotice[] = [];
  for (const { path, rows } of needs)
    for (const row of rows) {
      const id = `${path}\n${row.id}`;
      next.add(id);
      if (!seen || seen.has(id) || (inFront && sameProjectPath(inFront, path)))
        continue;
      notices.push({
        id,
        path,
        text: row.text,
        ...(row.open ? { open: row.open } : {}),
        ...(row.open?.kind === "run" ? { runId: row.open.runId } : {}),
      });
    }
  return { notices, seen: next };
}

/** A helper's one word, in Avos's profile. */
export function helperWord(
  member: Pick<CrewMemberView, "status" | "active">,
): "Needs you" | "Working" | "Paused" | "Resting" {
  if (member.status === "needs-you" || member.status === "ready")
    return "Needs you";
  if (member.status === "working" || member.active) return "Working";
  if (member.status === "paused") return "Paused";
  return "Resting";
}
