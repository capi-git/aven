import type { ChatAutomationDraft } from "./chatAutomation";
import {
  crewAccess,
  crewAccessLevel,
  crewMemberApp,
  getCrew,
  type Crew,
  type CrewMember,
} from "./crews";
import { sameProjectPath } from "./recents";
import type { RuntimeMode } from "./runtimeMode";
import {
  getScheduledAgent,
  nextRunAt,
  saveScheduledAgent,
  type ScheduledAgent,
  type ScheduledRun,
} from "./scheduledAgents";
import type { HarnessId } from "./session";

/**
 * A team's standing jobs: work you asked its Lead for that repeats or keeps
 * watching ("watch this Notion page; when it updates, add it to the site").
 * Each is an ordinary automation the team owns. It runs in the project's own
 * folder, as automations do, never in Avos's copy, leaves anything to
 * publish as a draft behind a Publish button, shows in the team's chat, and
 * waits while the team is paused.
 */

/** One id per job, so a repeat of the same reply can't add a second. */
export function avosJobId(
  path: string,
  draft: Pick<ChatAutomationDraft, "name" | "prompt">,
): string {
  let hash = 5381;
  for (const char of `${path}\n${draft.name}\n${draft.prompt}`)
    hash = (hash * 33 + char.charCodeAt(0)) % 2147483647;
  return `avos-${hash.toString(36)}`;
}

/**
 * How much a job may do by itself: the team's Access, never more than Auto,
 * since nobody watches it run.
 */
export function avosJobMode(crew: Pick<Crew, "access">): RuntimeMode {
  return crewAccessLevel(crewAccess(crew)) === "ask" ? "supervised" : "auto";
}

/**
 * Sets up the job a Lead's reply describes, owned by its team, on the
 * Lead's app and model. Returns the job, or the one already set up from the
 * same words.
 */
export function addAvosJob(input: {
  crew: Pick<Crew, "path" | "access">;
  draft: ChatAutomationDraft;
  lead: CrewMember | undefined;
  /** The Lead's chat, for its app and model. */
  chat?: { harness: HarnessId; model: string };
  now: number;
}): ScheduledAgent {
  const { crew, draft, now } = input;
  const id = avosJobId(crew.path, draft);
  const existing = getScheduledAgent(id);
  if (existing) return existing;
  const app = crewMemberApp(input.lead);
  const agent: ScheduledAgent = {
    id,
    name: draft.name,
    prompt: draft.prompt,
    // The project itself: a job's drafts are for you, not for the copy.
    project: crew.path,
    harness: input.chat?.harness ?? app.harness,
    model: input.chat?.model || app.model || "",
    runtimeMode: avosJobMode(crew),
    ...(draft.connections ? { connections: draft.connections } : {}),
    schedule: draft.schedule,
    enabled: true,
    createdAt: now,
    nextRunAt: nextRunAt(draft.schedule, new Date(now)),
    owner: { avos: crew.path },
  };
  saveScheduledAgent(agent);
  return agent;
}

/**
 * The team a job stays with once you edit it: its own while it still runs
 * in the team's project, none once you move it elsewhere.
 */
export function ownerAfterEdit(
  initial: Pick<ScheduledAgent, "owner"> | undefined,
  project: string,
): Pick<ScheduledAgent, "owner"> {
  return initial?.owner && sameProjectPath(initial.owner.avos, project)
    ? { owner: initial.owner }
    : {};
}

/** Whether a job is its team's. */
export function ownedBy(agent: ScheduledAgent, path: string): boolean {
  return !!agent.owner && sameProjectPath(agent.owner.avos, path);
}

/**
 * A job waits while its team is paused or off. One whose team is gone runs
 * as an ordinary automation, as an older build would run it.
 */
export function avosJobHeld(
  agent: ScheduledAgent,
  team: (path: string) => Pick<Crew, "on" | "paused"> | undefined = getCrew,
): boolean {
  if (!agent.owner) return false;
  const crew = team(agent.owner.avos);
  return !!crew && (!!crew.paused || !crew.on);
}

/** The team's jobs, oldest first. */
export function avosJobs(
  path: string,
  agents: readonly ScheduledAgent[],
): ScheduledAgent[] {
  return agents
    .filter((agent) => ownedBy(agent, path))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The runs of a team's jobs worth showing in its chat: a card waiting for
 * you (a draft to publish, a preview to look at), and a job's latest run
 * when it failed. A run that just finished says nothing.
 */
export function avosJobRuns(
  jobs: readonly ScheduledAgent[],
  runs: readonly ScheduledRun[],
): ScheduledRun[] {
  const ids = new Set(jobs.map((job) => job.id));
  const latest = new Map<string, ScheduledRun>();
  const shown: ScheduledRun[] = [];
  for (const run of runs) {
    if (!ids.has(run.scheduleId)) continue;
    const before = latest.get(run.scheduleId);
    if (!before || run.startedAt > before.startedAt)
      latest.set(run.scheduleId, run);
    if (run.review?.status === "open") shown.push(run);
  }
  for (const run of latest.values())
    if (run.status === "failed" && run.review?.status !== "open")
      shown.push(run);
  return shown;
}
