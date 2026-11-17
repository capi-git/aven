import { TALK_FENCE, parseTalk } from "./crewTalk";
import {
  CREW_ROLE_INFO,
  crewCardByTitle,
  type Crew,
  type CrewRole,
} from "./crews";

/**
 * Avos's plan: the work a reply of its is about to start, and the agent
 * each part goes to. It is read from the block that ends the reply (the
 * same one Aven acts on, see `CrewRunner.afterTalk`), so the card in the
 * chat and what starts can never disagree. Where each step stands is read
 * from the team's own record, never from the reply.
 */

/** Who a step goes to. A build is built, then checked. */
export type AvosPlanAgent = Extract<
  CrewRole,
  "helper" | "researcher" | "designer" | "builder" | "checker"
>;

export type AvosPlanStep = {
  /** Stable within one plan: its kind and place. */
  key: string;
  kind: "look" | "research" | "mockup" | "build";
  /** A few words: the helper's name, the question, the screen, the job. */
  title: string;
  /** One line more, when the reply gave one. */
  detail?: string;
  /** In the order they take it. */
  agents: AvosPlanAgent[];
};

/**
 * The steps in a reply's closing block, in the order the work runs: what is
 * looked into first, then read up on and drawn, then built. Empty for a
 * reply that starts nothing (an answer), or whose block can't be read.
 */
export function avosPlanSteps(body: string): AvosPlanStep[] {
  const talk = parseTalk(`\`\`\`${TALK_FENCE}\n${body}\n\`\`\``);
  const steps: AvosPlanStep[] = [];
  talk.helpers.forEach((helper, index) =>
    steps.push({
      key: `look:${index}`,
      kind: "look",
      title: helper.title,
      detail: helper.task,
      agents: ["helper"],
    }),
  );
  if (talk.research)
    steps.push({
      key: "research",
      kind: "research",
      title: talk.research,
      agents: ["researcher"],
    });
  if (talk.mockup)
    steps.push({
      key: "mockup",
      kind: "mockup",
      title: talk.mockup,
      agents: ["designer"],
    });
  talk.cards.forEach((card, index) =>
    steps.push({
      key: `build:${index}`,
      kind: "build",
      title: card.title,
      ...(card.why ? { detail: card.why } : {}),
      agents: ["builder", "checker"],
    }),
  );
  return steps;
}

/** "Builder, then Checker": who takes a step, in words. */
export function avosPlanAgents(step: Pick<AvosPlanStep, "agents">): string {
  return step.agents.map((role) => CREW_ROLE_INFO[role].label).join(", then ");
}

/**
 * Where a step stands. `waiting`: nothing has started it (it waits for your
 * go-ahead, or for a free helper). `queued`: it starts when the build before
 * it ends. `working`: an agent has it now, `agent`
 * says which. `ready`: built and checked, waiting for your review. `asks`:
 * its agent needs your answer. `done`: finished, and for a build, applied.
 */
export type AvosPlanState = {
  at: "waiting" | "queued" | "working" | "ready" | "asks" | "done";
  agent?: AvosPlanAgent;
};

/** Where a step stands now, from the team's record. */
export function avosPlanStepState(
  crew: Pick<Crew, "cards" | "helpers" | "feed"> | undefined,
  step: AvosPlanStep,
): AvosPlanState {
  if (!crew) return { at: "waiting" };
  if (step.kind === "look") {
    const name = step.title.slice(0, 40);
    if (crew.helpers?.some((helper) => helper.name === name))
      return { at: "working", agent: "helper" };
    // A helper goes when it has answered: its start stays in the record.
    const started = crew.feed.some(
      (entry) =>
        entry.kind === "say" &&
        entry.text.endsWith(`started a helper: ${step.title}`),
    );
    return { at: started ? "done" : "waiting" };
  }
  const card = crewCardByTitle(crew, step.title);
  if (!card) return { at: "waiting" };
  const first = step.agents[0]!;
  switch (card.stage) {
    case "queued":
      return { at: "queued" };
    case "building":
      return { at: "working", agent: first };
    case "checking":
      return { at: "working", agent: step.agents.at(-1)! };
    case "ready":
      return { at: "ready" };
    case "stuck":
      return { at: "asks", agent: first };
    default:
      return { at: "done" };
  }
}

/** Steps nothing has started, which a go-ahead would start: the builds. */
export function avosPlanWaiting(
  crew: Pick<Crew, "cards" | "helpers" | "feed"> | undefined,
  steps: readonly AvosPlanStep[],
): AvosPlanStep[] {
  return steps.filter(
    (step) =>
      step.kind === "build" && avosPlanStepState(crew, step).at === "waiting",
  );
}
