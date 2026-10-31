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
  | { kind: "to-security"; round: number }
  | {
      kind: "to-builder";
      round: number;
      mustFix: number;
      /** Who sent it back: the Checker, or Security after the Checker passed it. */
      from?: "checker" | "security";
    }
  | { kind: "ready"; round: number }
  | { kind: "stuck"; reason: CrewStuckReason; text: string }
  | { kind: "question"; text: string };

export type LoopStep = { card: CrewCard; event: LoopEvent };

/** The most rounds a card may be given. */
export const CREW_MAX_ROUNDS = 5;

/** The rounds a card gets: those it was given, and any you allowed on top. */
export function roundLimit(
  card: Pick<CrewCard, "maxRounds" | "granted">,
): number {
  return card.maxRounds + (card.granted ?? 0);
}

/**
 * A Builder's scope joins the card's: the card keeps every scope that
 * built a round of it, so a change outside them stays a must-fix even after
 * another Builder takes it, or its first one is removed. A Builder without
 * a scope opens it to the whole project.
 */
export function withBuilderScope(
  card: CrewCard,
  scope: readonly string[] | undefined,
): CrewCard {
  if (card.anywhere) return card;
  if (!scope?.length) return { ...card, anywhere: true, scope: undefined };
  return { ...card, scope: [...new Set([...(card.scope ?? []), ...scope])] };
}

/** The paths a card's change must keep to: none means anywhere. */
export function cardScope(
  card: Pick<CrewCard, "scope" | "anywhere">,
): string[] {
  return card.anywhere ? [] : (card.scope ?? []);
}

/**
 * A Builder kept to its scope: a change to files outside it is a must-fix,
 * whatever the Checker said, so it never lands as Ready. Aven adds it from
 * the copy's own diff, not from any bot's words.
 */
export function withScopeCheck(
  verdict: CrewVerdict | null,
  outside: readonly string[],
  input: { builder: string; scope: readonly string[] },
): CrewVerdict | null {
  if (!verdict || !outside.length) return verdict;
  const shown = outside.slice(0, 5).join(", ");
  const finding: CrewFinding = {
    text: `${input.builder} changed files outside its scope (${input.scope.join(", ")}): ${shown}${
      outside.length > 5 ? `, and ${outside.length - 5} more` : ""
    }. Undo those changes, or keep the work inside its scope.`,
  };
  const already = verdict.mustFix.some((item) => item.text === finding.text);
  return {
    ...verdict,
    pass: false,
    mustFix: already
      ? verdict.mustFix
      : [...verdict.mustFix.slice(0, 4), finding],
  };
}

/** A Board card given to the crew: it waits its turn in Building. */
export function queueCard(
  input: {
    id: string;
    title: string;
    brief: string;
    from: "you" | "scout" | "security" | "member";
    /** The member that took it down in its chat (`from: "member"`). */
    fromMember?: string;
    size?: CrewIdeaSize;
    sourceUrl?: string;
    maxRounds: number;
    /** You chose who builds and checks it (else the crew's rules do). */
    builderId?: string;
    checkerId?: string;
    /** For this card only: the Builder's model and effort. */
    override?: { model?: string; effort?: string };
  },
  now: number,
): CrewCard {
  const override =
    input.override?.model || input.override?.effort
      ? {
          ...(input.override.model ? { model: input.override.model } : {}),
          ...(input.override.effort ? { effort: input.override.effort } : {}),
        }
      : undefined;
  return {
    id: input.id,
    title: input.title,
    brief: input.brief,
    from: input.from,
    ...(input.from === "member" && input.fromMember
      ? { fromMember: input.fromMember }
      : {}),
    ...(input.size ? { size: input.size } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.builderId ? { builderId: input.builderId } : {}),
    ...(input.checkerId ? { checkerId: input.checkerId } : {}),
    ...(override ? { override } : {}),
    stage: "queued",
    round: 0,
    maxRounds: Math.min(CREW_MAX_ROUNDS, Math.max(1, input.maxRounds)),
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
    /** The crew's Security is on: a pass goes to it before Ready. */
    security?: boolean;
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
    // Security reviews exactly what the Checker passed before it is Ready.
    if (input.security)
      return {
        card: {
          ...checked,
          stage: "checking",
          holder: "security",
          stuck: undefined,
          ...(fix ? { reviewing: fix } : {}),
        },
        event: { kind: "to-security", round: card.round },
      };
    return {
      card: {
        ...checked,
        stage: "ready",
        holder: undefined,
        stuck: undefined,
        reviewing: undefined,
        ...(fix ? { fix } : {}),
        endedAt: now,
      },
      event: { kind: "ready", round: card.round },
    };
  }
  if (card.round >= roundLimit(card)) {
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
      reviewing: undefined,
    },
    event: {
      kind: "to-builder",
      round,
      mustFix: verdict.mustFix.length,
      from: "checker",
    },
  };
}

/**
 * Security's turn ended, on the change the Checker passed. An edit to the
 * copy during it voids it; a reply without a verdict stops the card. No
 * must-fix item: Ready, with exactly the reviewed change as the fix, both
 * checks passed. Must-fix items: back to the Builder, which counts as a
 * round, or Stuck after the last one.
 */
export function afterSecurity(
  card: CrewCard,
  input: {
    verdict: CrewVerdict | null;
    /** The copy changed during the review. */
    edited: boolean;
    now: number;
    names?: Partial<Record<CrewLoopRole, string>>;
  },
): LoopStep {
  const { now } = input;
  const security = input.names?.security ?? NAME("security");
  const next: CrewCard = { ...card, turn: undefined, updatedAt: now };
  if (input.edited) {
    const text = `${security} changed files during its review, so its verdict wasn't used`;
    return {
      card: stuck(next, "checker-edited", text, now),
      event: { kind: "stuck", reason: "checker-edited", text },
    };
  }
  if (!input.verdict) {
    const text = `${security}'s review ended without a verdict`;
    return {
      card: stuck(next, "no-verdict", text, now),
      event: { kind: "stuck", reason: "no-verdict", text },
    };
  }
  const verdict = input.verdict;
  const later = [...new Set([...card.later, ...verdict.later])].slice(-20);
  const rounds = withRound(card, card.round, (round) => ({
    ...round,
    security: verdict,
    securedAt: now,
  }));
  const reviewed: CrewCard = { ...next, rounds, later };
  if (!verdict.mustFix.length) {
    const fix = card.reviewing ?? roundOf(reviewed)?.change;
    return {
      card: {
        ...reviewed,
        stage: "ready",
        holder: undefined,
        stuck: undefined,
        reviewing: undefined,
        ...(fix ? { fix } : {}),
        endedAt: now,
      },
      event: { kind: "ready", round: card.round },
    };
  }
  if (card.round >= roundLimit(card)) {
    const text = `Stuck after ${card.round} ${card.round === 1 ? "round" : "rounds"}: ${security} found a security problem`;
    return {
      card: {
        ...stuck(reviewed, "rounds", text, now),
        holder: undefined,
        reviewing: undefined,
      },
      event: { kind: "stuck", reason: "rounds", text },
    };
  }
  const round = card.round + 1;
  return {
    card: {
      ...reviewed,
      stage: "building",
      holder: "builder",
      round,
      rounds: [...rounds, { n: round }],
      stuck: undefined,
      reviewing: undefined,
    },
    event: {
      kind: "to-builder",
      round,
      mustFix: verdict.mustFix.length,
      from: "security",
    },
  };
}

/**
 * The change moved between the Checker's pass and Security's turn: Security
 * never reviews something the Checker didn't see. It waits on you, and Try
 * again checks it from the Checker.
 */
export function reviewMoved(
  card: CrewCard,
  input: { now: number; checker?: string },
): LoopStep {
  const text = `The change moved after ${input.checker ?? NAME("checker")}'s check, so Security didn't review it`;
  return {
    card: {
      ...stuck(card, "changed", text, input.now),
      holder: "checker",
      reviewing: undefined,
    },
    event: { kind: "stuck", reason: "changed", text },
  };
}

/**
 * Security was turned off or removed while a card the Checker passed waited
 * for its review: it is Ready on the Checker's pass, with exactly the change
 * the Checker passed as the fix (Apply still lands only that fingerprint).
 * Null when there is no passed change to make Ready.
 */
export function securityOff(card: CrewCard, now: number): LoopStep | null {
  if (card.stage !== "checking" || card.holder !== "security") return null;
  const fix = card.reviewing ?? roundOf(card)?.change;
  if (!fix) return null;
  return {
    card: {
      ...card,
      stage: "ready",
      holder: undefined,
      stuck: undefined,
      reviewing: undefined,
      turn: undefined,
      fix,
      endedAt: now,
      updatedAt: now,
    },
    event: { kind: "ready", round: card.round },
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
 * A Stuck card whose turn didn't finish (it failed, ran too long, was
 * stopped, or ended without a verdict): Try again runs that turn again.
 */
/**
 * Whether the crew can take a Stuck card further: not one whose file's name
 * reads as a settings folder on a Mac, which would only stop again.
 */
export function cardCanGoOn(card: Pick<CrewCard, "stage" | "stuck">) {
  return !(card.stage === "stuck" && card.stuck?.reason === "unsafe-name");
}

export function cardTriesAgain(card: Pick<CrewCard, "stage" | "stuck">) {
  const reason = card.stage === "stuck" ? card.stuck?.reason : undefined;
  return (
    reason === "failed" ||
    reason === "timeout" ||
    reason === "stopped" ||
    reason === "no-verdict"
  );
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
  // Its file's name can't go to your files: only you can change that.
  if (!cardCanGoOn(card)) return card;
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
      stage: holder === "builder" ? "building" : "checking",
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
    // A card past its rounds gets exactly one more, kept apart from those it was given.
    ...(round > roundLimit(card) ? { granted: round - card.maxRounds } : {}),
    rounds: [...card.rounds.filter((item) => item.n < round), { n: round }],
    stuck: undefined,
    ...(note ? { note } : {}),
    fix: undefined,
    reviewing: undefined,
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
 * Security's earlier must-fix items, which it re-checks from round 2: those
 * of the last round it sent back. None: it reviews the whole change.
 */
export function earlierSecurityFindings(card: CrewCard): CrewFinding[] {
  for (let n = card.round - 1; n >= 1; n -= 1) {
    const found = roundOf(card, n)?.security?.mustFix;
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
  return `round ${card.round} of ${roundLimit(card)}`;
}

/** Where the card stands, as its Board line says it. */
export function crewStageLabel(card: CrewCard): string {
  switch (card.stage) {
    case "queued":
      return "Queued";
    case "building":
      return card.round > 1 ? "Fixing" : "Building";
    case "checking":
      return card.holder === "security" ? "Security check" : "Checking";
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
