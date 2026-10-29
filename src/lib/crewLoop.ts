import {
  CREW_ROLE_INFO,
  type CrewCard,
  type CrewChange,
  type CrewFinding,
  type CrewHandoff,
  type CrewIdeaSize,
  type CrewLoopRole,
  type CrewRound,
  type CrewStuckReason,
  type CrewVerdict,
} from "./crews";

/**
 * The loop one crew card goes through, run by Aven, never by a bot:
 *
 *   Queued → Building (Builder, round 1) → Checking (Checker)
 *     → pass: Ready, waiting in Review for your Apply
 *     → must-fix: Fixing (Builder, round 2) → Checking → …
 *
 * It ends **Ready** after a pass. It ends **Stuck** (Needs you) after the
 * last round without a pass, when a Builder round changes nothing, or when
 * the Builder asks a question. Only must-fix items send a card back; notes
 * for later ride along to the Ready card.
 *
 * Every function here takes a card and returns the next one with what
 * happened, and touches nothing else: the runner saves it, posts the line to
 * the feed and wakes the next bot.
 */

/** What a step did, for the crew's feed and the Inbox. */
export type LoopEvent =
  | { kind: "to-checker"; round: number }
  | { kind: "to-builder"; round: number; mustFix: number }
  | { kind: "ready"; round: number }
  | { kind: "stuck"; reason: CrewStuckReason; text: string }
  | { kind: "question"; text: string };

export type LoopStep = { card: CrewCard; event: LoopEvent };

/** A Board card given to the crew: it waits its turn in Building. */
export function queueCard(
  input: {
    id: string;
    title: string;
    brief: string;
    from: "you" | "scout";
    size?: CrewIdeaSize;
    sourceUrl?: string;
    maxRounds: number;
  },
  now: number,
): CrewCard {
  return {
    id: input.id,
    title: input.title,
    brief: input.brief,
    from: input.from,
    ...(input.size ? { size: input.size } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    stage: "queued",
    round: 0,
    maxRounds: Math.max(1, input.maxRounds),
    rounds: [],
    later: [],
    runs: 0,
    queuedAt: now,
    updatedAt: now,
  };
}

/** The card's turn comes: round 1 goes to the Builder. */
export function startCard(card: CrewCard, now: number): CrewCard {
  if (card.stage !== "queued") return card;
  return {
    ...card,
    stage: "building",
    round: 1,
    holder: "builder",
    rounds: [{ n: 1 }],
    startedAt: now,
    updatedAt: now,
  };
}

function withRound(
  card: CrewCard,
  n: number,
  update: (round: CrewRound) => CrewRound,
): CrewRound[] {
  const known = card.rounds.some((round) => round.n === n);
  const rounds = known ? card.rounds : [...card.rounds, { n }];
  return rounds.map((round) => (round.n === n ? update(round) : round));
}

export function roundOf(card: CrewCard, n = card.round): CrewRound | undefined {
  return card.rounds.find((round) => round.n === n);
}

function stuck(
  card: CrewCard,
  reason: CrewStuckReason,
  text: string,
  now: number,
): CrewCard {
  return {
    ...card,
    stage: "stuck",
    stuck: { reason, text },
    turn: undefined,
    updatedAt: now,
  };
}

const NAME = (role: CrewLoopRole) => CREW_ROLE_INFO[role].label;

/**
 * The Builder's turn ended. With a question, the card waits for you. A round
 * that changed nothing (no change at all in round 1; the same change as the
 * last round after that) stops the card. Otherwise the Checker has it.
 */
export function afterBuild(
  card: CrewCard,
  input: {
    handoff: CrewHandoff | null;
    change: CrewChange | null;
    now: number;
    /** Names for the lines, as the user knows the bots. */
    names?: Partial<Record<CrewLoopRole, string>>;
  },
): LoopStep {
  const { now } = input;
  const builder = input.names?.builder ?? NAME("builder");
  const checker = input.names?.checker ?? NAME("checker");
  const rounds = withRound(card, card.round, (round) => ({
    ...round,
    ...(input.handoff ? { handoff: input.handoff } : {}),
    ...(input.change ? { change: input.change } : {}),
    builtAt: now,
  }));
  const next: CrewCard = {
    ...card,
    rounds,
    note: undefined,
    turn: undefined,
    updatedAt: now,
  };
  if (input.handoff?.question) {
    const text = `${builder} asked: ${input.handoff.question}`;
    return {
      card: { ...stuck(next, "question", text, now), holder: "builder" },
      event: { kind: "question", text },
    };
  }
  const changed = !!input.change && input.change.files > 0;
  if (!changed) {
    const text =
      card.round <= 1
        ? `${builder} changed nothing`
        : `Stopped early: round ${card.round} changed nothing`;
    return {
      card: stuck(next, "no-change", text, now),
      event: { kind: "stuck", reason: "no-change", text },
    };
  }
  const previous = roundOf(card, card.round - 1)?.change;
  if (card.round > 1 && previous && previous.hash === input.change!.hash) {
    const text = `Stopped early: round ${card.round} changed nothing ${checker} asked for`;
    return {
      card: stuck(next, "no-change", text, now),
      event: { kind: "stuck", reason: "no-change", text },
    };
  }
  return {
    card: { ...next, stage: "checking", holder: "checker", stuck: undefined },
    event: { kind: "to-checker", round: card.round },
  };
}

/**
 * The Checker's turn ended. An edit to the copy during a check voids it; a
 * reply without a verdict stops the card. No must-fix item: Ready, with the
 * last round's change as the fix. Must-fix items: back to the Builder for
 * the next round, or Stuck after the last one. Notes for later are kept
 * either way and never send a card back.
 */
export function afterCheck(
  card: CrewCard,
  input: {
    verdict: CrewVerdict | null;
    /** The copy changed during the check. */
    edited: boolean;
    /** The copy as the Checker saw it: a pass makes exactly this the fix. */
    seen?: CrewChange | null;
    now: number;
    names?: Partial<Record<CrewLoopRole, string>>;
  },
): LoopStep {
  const { now } = input;
  const checker = input.names?.checker ?? NAME("checker");
  const next: CrewCard = { ...card, turn: undefined, updatedAt: now };
  if (input.edited) {
    const text = `${checker} changed files during its check, so its verdict wasn't used`;
    return {
      card: stuck(next, "checker-edited", text, now),
      event: { kind: "stuck", reason: "checker-edited", text },
    };
  }
  if (!input.verdict) {
    const text = `${checker}'s check ended without a verdict`;
    return {
      card: stuck(next, "no-verdict", text, now),
      event: { kind: "stuck", reason: "no-verdict", text },
    };
  }
  const verdict = input.verdict;
  const later = [...new Set([...card.later, ...verdict.later])].slice(-20);
  const rounds = withRound(card, card.round, (round) => ({
    ...round,
    verdict,
    checkedAt: now,
  }));
  const checked: CrewCard = { ...next, rounds, later };
  if (!verdict.mustFix.length) {
    const fix = input.seen ?? roundOf(checked)?.change;
    return {
      card: {
        ...checked,
        stage: "ready",
        holder: undefined,
        stuck: undefined,
        ...(fix ? { fix } : {}),
        endedAt: now,
      },
      event: { kind: "ready", round: card.round },
    };
  }
  if (card.round >= card.maxRounds) {
    const text = `Stuck after ${card.round} ${card.round === 1 ? "round" : "rounds"}`;
    return {
      card: { ...stuck(checked, "rounds", text, now), holder: undefined },
      event: { kind: "stuck", reason: "rounds", text },
    };
  }
  const round = card.round + 1;
  return {
    card: {
      ...checked,
      stage: "building",
      holder: "builder",
      round,
      rounds: [...rounds, { n: round }],
      stuck: undefined,
    },
    event: { kind: "to-builder", round, mustFix: verdict.mustFix.length },
  };
}

/** A turn that failed or was cancelled stops the card with why. */
export function turnFailed(
  card: CrewCard,
  input: { role: CrewLoopRole; error?: string; now: number; name?: string },
): LoopStep {
  const who = input.name ?? NAME(input.role);
  const text = input.error
    ? `${who}'s turn didn't finish: ${input.error}`
    : `${who}'s turn didn't finish`;
  return {
    card: stuck(card, "failed", text.slice(0, 300), input.now),
    event: { kind: "stuck", reason: "failed", text },
  };
}

/** A turn ran past the crew's turn limit and was stopped. */
export function turnTimedOut(
  card: CrewCard,
  input: { role: CrewLoopRole; minutes: number; now: number; name?: string },
): LoopStep {
  const who = input.name ?? NAME(input.role);
  const text = `${who}'s turn ran past ${input.minutes} minutes and was stopped`;
  return {
    card: stuck(card, "timeout", text, input.now),
    event: { kind: "stuck", reason: "timeout", text },
  };
}

/** You stopped it: whatever it was doing stops, and it waits on you. */
export function stopCard(card: CrewCard, now: number): CrewCard {
  if (card.stage !== "building" && card.stage !== "checking") return card;
  return stuck(card, "stopped", "You stopped it", now);
}

/**
 * One more round, from Stuck, Send back from Ready, or your answer to the
 * Builder's question: the Builder gets the card again with your words. An
 * answer continues the same round; anything else is a new round, and a card
 * past its rounds gets exactly one more.
 */
export function resumeCard(
  card: CrewCard,
  input: { note?: string; now: number },
): CrewCard {
  if (card.stage !== "stuck" && card.stage !== "ready") return card;
  const note = input.note?.replace(/\s+/g, " ").trim().slice(0, 500);
  const answering = card.stuck?.reason === "question";
  const sameRound =
    answering ||
    // A turn that never finished, or that you stopped, runs again.
    (card.stage === "stuck" &&
      (card.stuck?.reason === "failed" ||
        card.stuck?.reason === "timeout" ||
        card.stuck?.reason === "stopped" ||
        card.stuck?.reason === "no-verdict" ||
        card.stuck?.reason === "changed") &&
      card.holder !== undefined);
  if (sameRound) {
    const holder = card.holder ?? "builder";
    return {
      ...card,
      stage: holder === "checker" ? "checking" : "building",
      holder,
      stuck: undefined,
      ...(note ? { note } : {}),
      fix: undefined,
      endedAt: undefined,
      updatedAt: input.now,
    };
  }
  const round = card.round + 1;
  return {
    ...card,
    stage: "building",
    holder: "builder",
    round,
    maxRounds: Math.max(card.maxRounds, round),
    rounds: [...card.rounds.filter((item) => item.n < round), { n: round }],
    stuck: undefined,
    ...(note ? { note } : {}),
    fix: undefined,
    endedAt: undefined,
    updatedAt: input.now,
  };
}

/**
 * A Ready card whose change moved after its check (you chatted with the
 * Builder, or something it left running wrote to the copy): it is never
 * re-stamped as Ready. It waits on you, and One more round checks it again.
 */
export function changedAfterCheck(
  card: CrewCard,
  input: { now: number; checker?: string },
): CrewCard {
  if (card.stage !== "ready") return card;
  return {
    ...card,
    stage: "stuck",
    holder: "checker",
    fix: undefined,
    stuck: {
      reason: "changed",
      text: `The change moved after ${input.checker ?? NAME("checker")}'s check, so it wasn't applied`,
    },
    turn: undefined,
    endedAt: undefined,
    updatedAt: input.now,
  };
}

/** Its change is in your files now. */
export function markApplied(card: CrewCard, now: number): CrewCard {
  return {
    ...card,
    stage: "applied",
    holder: undefined,
    turn: undefined,
    error: undefined,
    endedAt: now,
    updatedAt: now,
  };
}

/** Its work was thrown away (Back to Ideas, Throw away). */
export function markDiscarded(card: CrewCard, now: number): CrewCard {
  return {
    ...card,
    stage: "discarded",
    holder: undefined,
    turn: undefined,
    endedAt: now,
    updatedAt: now,
  };
}

/**
 * The earlier must-fix items the Checker re-checks from round 2: those of
 * the last round that had any.
 */
export function earlierFindings(card: CrewCard): CrewFinding[] {
  for (let n = card.round - 1; n >= 1; n -= 1) {
    const found = roundOf(card, n)?.verdict?.mustFix;
    if (found?.length) return found;
  }
  return [];
}

/**
 * The files whose change differs from the round before, with the paths the
 * Builder's change touched in round 1: what the Checker looks at from round 2.
 */
export function changedSinceLastRound(card: CrewCard): string[] {
  const now = roundOf(card)?.change;
  if (!now) return [];
  const before = roundOf(card, card.round - 1)?.change;
  if (!before) return now.paths.map((entry) => entry.path);
  const old = new Map(
    before.paths.map((entry) => [
      entry.path,
      `${entry.additions}:${entry.deletions}`,
    ]),
  );
  const changed = now.paths
    .filter(
      (entry) =>
        old.get(entry.path) !== `${entry.additions}:${entry.deletions}`,
    )
    .map((entry) => entry.path);
  const gone = before.paths
    .filter((entry) => !now.paths.some((item) => item.path === entry.path))
    .map((entry) => entry.path);
  return [...changed, ...gone];
}

// ---------------------------------------------------------------------------
// Words

function roundsText(card: CrewCard): string {
  return `round ${card.round} of ${card.maxRounds}`;
}

/** Where the card stands, as its Board line says it. */
export function crewStageLabel(card: CrewCard): string {
  switch (card.stage) {
    case "queued":
      return "Queued";
    case "building":
      return card.round > 1 ? "Fixing" : "Building";
    case "checking":
      return "Checking";
    case "ready":
      return "Ready";
    case "stuck":
      return "Needs you";
    case "applied":
      return "Applied";
    case "discarded":
      return "Thrown away";
  }
}

/** The line after the label: "round 2 of 3", "passed in round 1". */
export function crewStageDetail(card: CrewCard): string {
  switch (card.stage) {
    case "queued":
      return "next up";
    case "building":
    case "checking":
      return roundsText(card);
    case "ready":
      return `passed in round ${card.round}`;
    case "stuck":
      return card.stuck?.text ?? "";
    case "applied":
      return "in your files";
    default:
      return "";
  }
}
