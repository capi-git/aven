import { useSyncExternalStore } from "react";
import { crewInboxCard, withInboxResolved } from "./crewInbox";
import { claudeCheckerModel } from "./crewModels";
import { isCodexToolsOpen } from "./harness/codexLockdown";
import {
  cardTriesAgain,
  changedAfterCheck,
  markApplied,
  markDiscarded,
  queueCard,
  resumeCard,
  stopCard,
} from "./crewLoop";
import {
  CREW_EXTRA_RUNS,
  CREW_NOTE_MAX,
  bumpToday,
  cardInCopy,
  queuedCards,
  stackedCards,
  crewCard,
  crewMemberName,
  getCrew,
  updateCrew,
  withCard,
  withFeed,
  withIdea,
  withCheckerOnClaude,
  withDoingCleared,
  CREW_AGENTS,
  CREW_INSTRUCTIONS_MAX,
  crewAgentsFor,
  CREW_LIMIT_RANGES,
  CREW_ROLE_INFO,
  crewMemberById,
  memberCritter,
  newMemberId,
  withMemberId,
  withGoal,
  withNote,
  withoutCard,
  withoutMember,
  type Crew,
  type CrewAgent,
  type CrewCard,
  type CrewLimitName,
  type CrewMember,
  type CrewRole,
  type CrewRoute,
  type CrewScoutSchedule,
} from "./crews";
import { MEMBER_SIGIL_CHOICES, isSigilKey } from "./dotSigils";
import { isMascotName } from "./projectMascots";
import { isHarnessAvailable } from "./harness/availability";
import { pickerModelsFor, preferredModelId } from "./models";
import { CREW_PRESETS, type CrewPreset } from "./crewPresets";
import { errorText, logError } from "./errors";
import {
  addFeatureIdea,
  deleteFeatureCard,
  featureBoardState,
  featureBrief,
  loadFeatureCards,
  moveFeatureCard,
  type FeatureCard,
} from "./featureCards";
import { notifyGitChanged } from "./fs";
import { projectKey, projectName } from "./paths";
import {
  botCopyError,
  botCopyHost,
  isFixChanged,
  isRestackConflict,
  type BotDiff,
} from "./projectBotCopy";
import { protectedFixPaths } from "./projectBotPermissions";
import { jobIsLive, type BotQuietHours } from "./projectBots";
import { normalizeProjectPath } from "./recents";

/**
 * What you do with a crew and its cards: Give to crew, Not now, Pause and
 * Stop, Apply, One more round, Back to Ideas, Tell the crew. These work
 * from any window: they change the shared store, the crew's copy and the
 * Board, never a bot's chat, which the main window's runner drives (a turn
 * you stop is stopped through the workspace).
 */

/** Models a crew's members run on, picked when it is turned on. */
export type CrewModels = Record<
  "builder" | "checker" | "scout",
  { harness: "claude" | "codex"; model: string }
>;

/**
 * The Builder on your usual Claude model. The Checker on Codex when it is
 * installed (fresh eyes from another model), else on a different Claude
 * model. The Scout on a lighter Claude model when there is one.
 */
export function pickCrewModels(input: {
  codex: boolean;
  claudeModels: readonly string[];
  preferredClaude: string;
  preferredCodex?: string;
}): CrewModels {
  const builder = input.preferredClaude;
  const other = input.claudeModels.find((id) => id && id !== builder);
  const lighter =
    input.claudeModels.find((id) => /haiku/i.test(id)) ??
    input.claudeModels.find((id) => /sonnet/i.test(id) && id !== builder) ??
    other ??
    builder;
  return {
    builder: { harness: "claude", model: builder },
    checker:
      input.codex && input.preferredCodex
        ? { harness: "codex", model: input.preferredCodex }
        : { harness: "claude", model: other ?? builder },
    scout: { harness: "claude", model: lighter },
  };
}

/**
 * The apps and models crew roles get on this Mac: the Checker (and
 * Security) on Codex when it is installed, else on another Claude model.
 */
export function crewModelsHere(): CrewModels {
  const codex = isHarnessAvailable("codex");
  return pickCrewModels({
    codex,
    claudeModels: pickerModelsFor("claude").map((model) => model.id),
    preferredClaude: preferredModelId("claude"),
    ...(codex ? { preferredCodex: preferredModelId("codex") } : {}),
  });
}

/** A role's pick from `crewModelsHere`: Security reads like the Checker. */
export function crewModelFor(
  models: CrewModels,
  role: Exclude<CrewRole, "fixer">,
): { harness: "claude" | "codex"; model: string } {
  return models[role === "security" ? "checker" : role];
}

/**
 * Turn the crew on, and it starts working. A member without an app or model
 * yet gets its role's pick; one you set keeps yours.
 */
export function turnOnCrew(path: string, models: CrewModels, now = Date.now()) {
  updateCrew(path, (crew) => {
    let next: Crew = { ...crew, on: true, onAt: now, paused: undefined };
    for (const member of crew.members) {
      if (member.role === "fixer") continue;
      // Security, like the Checker, reads with other eyes than the Builder's.
      const pick = models[member.role === "security" ? "checker" : member.role];
      next = withMemberId(next, member.id, (current) =>
        current.harness && current.model
          ? current
          : current.harness && current.harness !== pick.harness
            ? current
            : {
                ...current,
                harness: current.harness ?? pick.harness,
                model: current.model ?? pick.model,
              },
      );
    }
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "aven",
      text: "The crew is on",
    });
  });
}

/**
 * Turn the crew off: running turns stop, nothing new starts. Its cards and
 * its copy stay, so Ready work is never lost; turning it on again picks up.
 */
export async function turnOffCrew(path: string) {
  const crew = getCrew(path);
  if (!crew) return;
  updateCrew(path, (current) => ({ ...current, on: false }));
  for (const member of crew.members)
    if (member.sessionId && member.role !== "fixer")
      await crewWorkspace()
        ?.stop(member.sessionId)
        .catch((error) => logError("Stop crew", error));
  updateCrew(path, (current) => {
    // Every turn stopped: no member is doing anything any more.
    let next: Crew = withDoingCleared({ ...current, job: undefined });
    for (const card of current.cards)
      if (card.turn) next = withCard(next, { ...card, turn: undefined });
    return next;
  });
}

export function setCrewPaused(path: string, paused: boolean, now = Date.now()) {
  updateCrew(path, (crew) =>
    !!crew.paused === paused
      ? crew
      : withFeed(
          { ...crew, paused: paused || undefined, hold: undefined },
          {
            at: now,
            kind: "note",
            who: "you",
            text: paused ? "You paused the crew" : "You resumed the crew",
          },
        ),
  );
}

/** Stop now: whatever the crew is doing stops, and the crew pauses. */
export async function stopCrewNow(path: string) {
  setCrewPaused(path, true);
  const crew = getCrew(path);
  const card = crew ? cardInCopy(crew) : undefined;
  if (card && (card.stage === "building" || card.stage === "checking"))
    await stopCrewCard(path, card.id);
  // A Scout's look or Security's sweep has no card of its own.
  for (const member of crew?.members ?? [])
    if (
      (member.role === "scout" || member.role === "security") &&
      member.doing &&
      member.sessionId
    )
      await crewWorkspace()
        ?.stop(member.sessionId)
        .catch((error) => logError("Stop crew", error));
}

export function setCrewQuietHours(path: string, quiet: BotQuietHours) {
  updateCrew(path, (crew) => ({
    ...crew,
    limits: {
      ...crew.limits,
      quiet: {
        on: quiet.on,
        start: Math.min(1439, Math.max(0, Math.round(quiet.start))),
        end: Math.min(1439, Math.max(0, Math.round(quiet.end))),
      },
    },
  }));
}

/** "Allow 10 more today": the crew's runs today go up by ten, once each press. */
export function allowMoreRunsToday(path: string, now = Date.now()) {
  updateCrew(path, (crew) =>
    withFeed(
      {
        ...crew,
        extra: bumpToday(crew.extra, now, CREW_EXTRA_RUNS),
        hold: undefined,
      },
      {
        at: now,
        kind: "note",
        who: "you",
        text: `You allowed ${CREW_EXTRA_RUNS} more runs today`,
      },
    ),
  );
}

/** Remember for every card: standing guidance every bot reads at each turn. */
export function tellCrew(path: string, text: string, now = Date.now()) {
  updateCrew(path, (crew) => withNote(crew, text, now));
}

/**
 * Give the crew a goal: it plans its own cards towards it and builds them
 * one after another, within its limits, until the goal is met or it stops
 * to ask (a card is Stuck, or it can't plan more). `by` is the member that
 * took it down from your words in its chat.
 */
export function setCrewGoal(
  path: string,
  text: string,
  now = Date.now(),
  by?: string,
) {
  updateCrew(path, (crew) => withGoal(crew, text, now, by));
}

/** No goal any more: the crew builds only what it's given. */
export function clearCrewGoal(path: string, now = Date.now()) {
  updateCrew(path, (crew) => {
    if (!crew.goal) return crew;
    const next = { ...crew };
    delete next.goal;
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      text: "You cleared the crew's goal",
    });
  });
}

/** Keep going: a goal the crew stopped at is worked on again. */
export function resumeCrewGoal(path: string, now = Date.now()) {
  updateCrew(path, (crew) => {
    if (!crew.goal?.done) return crew;
    return withFeed(
      {
        ...crew,
        goal: {
          text: crew.goal.text,
          at: crew.goal.at,
          ...(crew.goal.by ? { by: crew.goal.by } : {}),
        },
      },
      {
        at: now,
        kind: "note",
        who: "you",
        text: `You asked the crew to keep going: ${crew.goal.text}`,
      },
    );
  });
}

/** What the crew says to a nudge when it has nothing to start. */
export const CREW_NOTHING_TO_BUILD =
  "Tell the crew what to build, or add an idea.";

const escapeWord = (word: string) =>
  word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "go", "keep going", "continue", "start building pom": a nudge with no
 * task in it, which shouldn't become a vague card. `project` is the
 * project's folder: its name counts as no task ("keep working on Pom").
 */
export function crewNudge(text: string, project?: string): boolean {
  const name = project ? projectName(project).trim() : "";
  const it = [
    "it",
    "this",
    "that",
    "everything",
    "the (?:project|app|work|crew)",
    ...(name ? [escapeWord(name)] : []),
  ].join("|");
  const nudge = new RegExp(
    "^(?:(?:ok(?:ay)?|so|now|please|just|then|and|alright|right|hey)\\s+)*" +
      "(?:go(?:\\s+(?:on|ahead))?|get\\s+(?:going|started|to\\s+work)" +
      "|keep\\s+(?:going|at\\s+it|working|building)|carry\\s+on|continue" +
      "|resume|proceed|start(?:\\s+(?:working|building))?|begin|work|build" +
      "|do\\s+it|next)" +
      `(?:\\s+(?:on|with))?(?:\\s+(?:${it}))?` +
      "(?:\\s+(?:please|now|then|again))*$",
    "i",
  );
  return nudge.test(
    text
      .replace(/[.!…]+$/u, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * A Board card's title from what you told the crew: its first line, with a
 * capital first letter, cut at a word near 80 characters.
 */
export function crewTaskTitle(text: string): string {
  const line = text.trim().split("\n")[0]!.replace(/\s+/g, " ").trim();
  const cut =
    line.length <= 80
      ? line
      : `${line.slice(0, 80).replace(/\s+\S*$/, "") || line.slice(0, 80)}…`;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/**
 * Tell the crew…: what you say is a task. It becomes a Board card (its
 * title from your words, your words as its note when they say more) that
 * goes to the crew as Give to crew does, so it starts within the crew's
 * limits. A nudge with no task in it starts or resumes what the crew has
 * waiting, or the crew asks what to build. Resolves with why it couldn't,
 * or null.
 */
export async function tellCrewWork(
  path: string,
  text: string,
  now = Date.now(),
): Promise<string | null> {
  const words = text.trim().slice(0, CREW_NOTE_MAX);
  if (!words) return null;
  if (!getCrew(path)?.on) return "Turn the crew on first.";
  if (crewNudge(words, path)) {
    nudgeCrew(path, words, now);
    return null;
  }
  const title = crewTaskTitle(words);
  const card = await addFeatureIdea(path, {
    title,
    ...(words.toLowerCase() !== title.toLowerCase() ? { note: words } : {}),
  });
  if (!card) return "Couldn't add the card to the Board.";
  return giveCardToCrew(path, card, now);
}

/**
 * A nudge: the crew resumes if you paused it, and the card that waits on
 * you (paused, or stopped without a question) goes again. Otherwise the
 * crew says where things stand, or that it has nothing to build.
 */
function nudgeCrew(path: string, words: string, now: number) {
  const crew = getCrew(path);
  if (!crew) return;
  updateCrew(path, (current) =>
    withFeed(current, { at: now, kind: "note", who: "you", text: words }),
  );
  let acted = false;
  if (crew.paused) {
    setCrewPaused(path, false, now);
    acted = true;
  }
  const card = cardInCopy(crew);
  if (card?.paused) {
    setCrewCardPaused(path, card.id, false);
    updateCrew(path, (current) =>
      withFeed(current, {
        at: now,
        kind: "note",
        who: "you",
        cardId: card.id,
        title: card.title,
        text: `You resumed “${card.title}”`,
      }),
    );
    return;
  }
  if (card?.stage === "stuck" && card.stuck?.reason !== "question") {
    resumeCrewCard(path, card.id, undefined, now);
    return;
  }
  const next = card ?? queuedCards(crew)[0];
  // A goal it stopped at: it keeps going.
  if (!next && crew.goal?.done && !crew.goal.done.met) {
    resumeCrewGoal(path, now);
    return;
  }
  // Resumed with work waiting: that says enough.
  if (acted && next) return;
  const reply = !next
    ? CREW_NOTHING_TO_BUILD
    : next.stage === "stuck"
      ? `“${next.title}” waits for your answer on its card.`
      : next.stage === "ready"
        ? `“${next.title}” is Ready: apply it or send it back from its card.`
        : `The crew is on “${next.title}”.`;
  updateCrew(path, (current) =>
    withFeed(current, { at: now, kind: "note", who: "aven", text: reply }),
  );
}

// ---------------------------------------------------------------------------
// Cards

/**
 * Give a Board card to the crew: it waits in Building as Queued, and starts
 * when the crew's copy is free. Resolves with why it couldn't, or null.
 */
/**
 * Who a card goes to, and how, when you choose (Give to crew ▾): a Builder
 * and a Checker (else the crew's rules pick), the Builder's model and
 * effort for this card only, and its rounds. Anything left out is the
 * crew's own.
 */
export type CrewCardChoice = {
  builderId?: string;
  checkerId?: string;
  model?: string;
  effort?: string;
  maxRounds?: number;
};

/** A choice as the crew can take it: only its own members, and rounds in range. */
export function crewCardChoice(
  crew: Crew,
  choice: CrewCardChoice | undefined,
): Required<Pick<CrewCardChoice, "maxRounds">> & CrewCardChoice {
  const builder = crewMemberById(crew, choice?.builderId);
  const checker = crewMemberById(crew, choice?.checkerId);
  const [low, high] = CREW_LIMIT_RANGES.roundsPerCard;
  const rounds =
    typeof choice?.maxRounds === "number" && Number.isFinite(choice.maxRounds)
      ? Math.min(high, Math.max(low, Math.round(choice.maxRounds)))
      : crew.limits.roundsPerCard;
  const model = choice?.model?.trim().slice(0, 200);
  const effort = choice?.effort?.trim().slice(0, 40);
  return {
    ...(builder?.role === "builder" ? { builderId: builder.id } : {}),
    ...(checker?.role === "checker" ? { checkerId: checker.id } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    maxRounds: rounds,
  };
}

export async function giveCardToCrew(
  path: string,
  card: Pick<FeatureCard, "id" | "title" | "note" | "sourceUrl">,
  now = Date.now(),
  choice?: CrewCardChoice,
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew?.on) return "Turn the crew on first.";
  const known = crewCard(crew, card.id);
  if (known && known.stage !== "applied" && known.stage !== "discarded")
    return null;
  const idea = crew.ideas?.[card.id];
  updateCrew(path, (current) => {
    const chosen = crewCardChoice(current, choice);
    const to = chosen.builderId
      ? ` for ${crewMemberName(current, chosen.builderId)}`
      : "";
    return withFeed(
      withCard(
        withoutCard(current, card.id),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: featureBrief(card),
            from: idea?.by === "security" ? "security" : idea ? "scout" : "you",
            ...(idea ? { size: idea.size } : {}),
            ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
            maxRounds: chosen.maxRounds,
            ...(chosen.builderId ? { builderId: chosen.builderId } : {}),
            ...(chosen.checkerId ? { checkerId: chosen.checkerId } : {}),
            ...(chosen.model || chosen.effort
              ? {
                  override: {
                    ...(chosen.model ? { model: chosen.model } : {}),
                    ...(chosen.effort ? { effort: chosen.effort } : {}),
                  },
                }
              : {}),
          },
          now,
        ),
      ),
      {
        at: now,
        kind: "note",
        who: "you",
        cardId: card.id,
        title: card.title,
        text: `You gave the crew “${card.title}”${to}`,
      },
    );
  });
  await moveFeatureCard(path, card.id, "building", "");
  return null;
}

/**
 * Give to crew from an ideas block in a chat: each idea's Board card in
 * Ideas (by its title), or a new one, goes to the crew. Resolves with why
 * it couldn't, or null.
 */
export async function giveIdeasToCrew(
  path: string,
  titles: readonly string[],
  now = Date.now(),
): Promise<string | null> {
  if (!getCrew(path)?.on) return "Turn the crew on first.";
  await loadFeatureCards(path);
  for (const title of titles) {
    const known = featureBoardState(path).cards.find(
      (card) =>
        card.column === "idea" &&
        card.title.toLowerCase() === title.toLowerCase(),
    );
    const card = known ?? (await addFeatureIdea(path, { title }));
    if (!card) return "Couldn't add the card to the Board.";
    const problem = await giveCardToCrew(path, card, now);
    if (problem) return problem;
  }
  return null;
}

/** Not now: a Scout idea stays in Ideas and never starts by itself. */
export function notNowIdea(path: string, cardId: string) {
  updateCrew(path, (crew) => {
    const idea = crew.ideas?.[cardId];
    return idea && !idea.declined
      ? withIdea(crew, cardId, { ...idea, declined: true })
      : crew;
  });
}

export function setCrewCardPaused(
  path: string,
  cardId: string,
  paused: boolean,
) {
  updateCrew(path, (crew) => {
    const card = crewCard(crew, cardId);
    if (!card || !!card.paused === paused) return crew;
    return withCard(crew, { ...card, paused: paused || undefined });
  });
}

/** Stop the card now: its running turn stops, and it waits on you. */
export async function stopCrewCard(
  path: string,
  cardId: string,
  now = Date.now(),
) {
  const card = getCrew(path) ? crewCard(getCrew(path)!, cardId) : undefined;
  if (!card) return;
  const sessionId = card.turn?.sessionId;
  updateCrew(path, (crew) => {
    const current = crewCard(crew, cardId);
    if (!current) return crew;
    const stopped = stopCard({ ...current, turn: undefined }, now);
    if (stopped === current) return crew;
    // Whoever took its turn isn't working on it any more.
    const freed = sessionId
      ? withDoingCleared(crew, (member) => member.sessionId !== sessionId)
      : crew;
    return withFeed(withCard(freed, stopped), {
      at: now,
      kind: "stopped",
      who: "you",
      cardId,
      title: current.title,
      text: `You stopped “${current.title}”`,
    });
  });
  if (sessionId)
    await crewWorkspace()
      ?.stop(sessionId)
      .catch((error) => logError("Stop crew card", error));
}

/**
 * One more round from Stuck, your answer to the Builder's question, or Send
 * back from Ready: the card goes to the Builder again with your words.
 */
export function resumeCrewCard(
  path: string,
  cardId: string,
  note?: string,
  now = Date.now(),
) {
  updateCrew(path, (current) => {
    let crew = current;
    let card = crewCard(crew, cardId);
    if (!card || (card.stage !== "stuck" && card.stage !== "ready"))
      return crew;
    // A check that failed because Codex couldn't be locked down here goes
    // again with the Checker on Claude: never on an unlocked Codex.
    if (
      card.stuck?.reason === "failed" &&
      (card.holder === "checker" || card.holder === "security") &&
      isCodexToolsOpen(card.stuck.text)
    ) {
      crew = withCheckerOnClaude(
        crew,
        claudeCheckerModel(crew),
        now,
        card.holder === "security"
          ? crew.members.find((member) => member.role === "security")?.id
          : card.checkerId,
      );
      card = crewCard(crew, cardId)!;
    }
    const resumed = withInboxResolved(
      resumeCard(card, { note, now }),
      "done",
      now,
    );
    return withFeed(withCard(crew, { ...resumed, paused: undefined }), {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: card.title,
      text: note?.trim()
        ? `You sent “${card.title}” back: ${note.trim()}`
        : card.stuck?.reason === "question"
          ? `You answered on “${card.title}”`
          : cardTriesAgain(card)
            ? `Trying “${card.title}” again`
            : `One more round on “${card.title}”`,
    });
  });
  void moveFeatureCard(path, cardId, "building", "");
}

const NOT_READY = "This card is no longer ready.";
const STILL_WORKING = "The crew is still working. Apply once it finishes.";

/**
 * A Ready card whose change moved after its check: never re-stamped as
 * Ready. It goes to Needs you with why (One more round checks it again),
 * its Ready card leaves the Inbox and a Needs you card takes its place, and
 * it goes back to Building.
 */
export async function markCrewFixChanged(
  path: string,
  cardId: string,
  now = Date.now(),
): Promise<void> {
  let moved = false;
  updateCrew(path, (crew) => {
    const card = crewCard(crew, cardId);
    if (!card || card.stage !== "ready") return crew;
    moved = true;
    const checker = crewMemberName(crew, card.checkerId ?? "checker");
    const stuck = changedAfterCheck(withInboxResolved(card, "dismissed", now), {
      now,
      checker,
    });
    return withFeed(
      withCard(crew, {
        ...stuck,
        inbox: crewInboxCard(stuck, now, { checker }),
      }),
      {
        at: now,
        kind: "stuck",
        who: "aven",
        cardId,
        title: card.title,
        text: stuck.stuck!.text,
      },
    );
  });
  if (moved) await moveFeatureCard(path, cardId, "building", "");
}

/**
 * Bring a Ready card's change into your files: only the exact change its
 * Checker passed, by its fingerprint, as a project bot's Fix ready. Not
 * while the crew is at work. If the copy moved since the check, nothing
 * lands and the card asks for another check (see `markCrewFixChanged`); a
 * conflict changes nothing either. Resolves with why, or null once applied.
 * The copy isn't touched afterwards: the next card matches it to your files.
 */
export async function applyCrewCard(
  path: string,
  cardId: string,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const card = crew ? crewCard(crew, cardId) : undefined;
  // On the crew's branch: Apply lands the batch up to it.
  if (card?.stage === "ready" && card.stacked)
    return applyCrewBatch(path, { upTo: cardId }, now);
  if (!crew?.copy || !card || card.stage !== "ready" || !card.fix)
    return NOT_READY;
  if (card.turn || jobIsLive(crew.job, now)) return STILL_WORKING;
  const fix = card.fix;
  // Settings an app would run as you, or a hook manager's folder: never
  // applied this way (the host refuses them too).
  const guarded = protectedFixPaths(fix.paths.map((entry) => entry.path));
  if (guarded.length) {
    const text = `Aven didn't apply this fix: it changes settings or hooks that could run commands as you (${guarded.join(", ")}). Take it over in a chat to apply that part yourself.`;
    updateCrew(path, (current) => {
      const known = crewCard(current, cardId);
      return known ? withCard(current, { ...known, error: text }) : current;
    });
    return text;
  }
  try {
    await botCopyHost.apply(path, crew.copy.path, fix.base, fix.hash);
  } catch (error) {
    if (isFixChanged(error)) {
      await markCrewFixChanged(path, cardId, now);
      return `The change moved after ${crewMemberName(crew, card.checkerId ?? "checker")}'s check, so it wasn't applied. One more round checks it again.`;
    }
    logError("Apply crew card", error);
    const text = botCopyError(error);
    updateCrew(path, (current) => {
      const known = crewCard(current, cardId);
      return known ? withCard(current, { ...known, error: text }) : current;
    });
    return text;
  }
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known) return current;
    return withFeed(
      withCard(
        current,
        withInboxResolved(markApplied(known, now), "done", now),
      ),
      {
        at: now,
        kind: "applied",
        who: "you",
        cardId,
        title: known.title,
        text: `Applied “${known.title}” to your files`,
      },
    );
  });
  notifyGitChanged(path);
  await moveFeatureCard(path, cardId, "shipped", "");
  return null;
}

/**
 * Back to Ideas or Throw away: the card's work in the copy is thrown away
 * and the copy is free for the next card. Back to Ideas keeps the Board card
 * in Ideas (a Scout idea won't start by itself again); Throw away removes it.
 */
export async function discardCrewCard(
  path: string,
  cardId: string,
  then: "ideas" | "delete",
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (!crew || !card) return null;
  // On the crew's branch: only the top card comes off it.
  if (card.stage === "ready" && card.stacked)
    return dropStackedCard(path, cardId, then, now);
  if (card.turn) await stopCrewCard(path, cardId, now);
  if (crew.copy && card.base && cardInCopy(crew)?.id === cardId) {
    try {
      await botCopyHost.discard(crew.copy.path, card.base, crew.copy.branch);
    } catch (error) {
      logError("Throw away crew card", error);
      return botCopyError(error);
    }
  }
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known) return current;
    let next = withCard(
      current,
      withInboxResolved(markDiscarded(known, now), "dismissed", now),
    );
    const idea = next.ideas?.[cardId];
    if (idea) next = withIdea(next, cardId, { ...idea, declined: true });
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: known.title,
      text:
        then === "ideas"
          ? `“${known.title}” went back to Ideas`
          : `You threw away “${known.title}”`,
    });
  });
  if (then === "ideas") await moveFeatureCard(path, cardId, "idea", "");
  else await deleteFeatureCard(path, cardId);
  return null;
}

// ---------------------------------------------------------------------------
// The batch on the crew's branch: cards that passed every check, each a
// commit, applied together (or up to one of them) by exactly the change
// reviewed. Your files change only here.

/** The batch waiting on the crew's branch, oldest card first, or null. */
export type CrewBatch = { from: string; cards: CrewCard[] };

export function crewBatch(crew: Crew | undefined): CrewBatch | null {
  if (!crew?.stack) return null;
  const cards = stackedCards(crew);
  return cards.length ? { from: crew.stack.base, cards } : null;
}

const NOT_ON_BRANCH = "That card isn't on the crew's branch any more.";
const BRANCH_MOVED =
  "The crew's branch changed since you looked. Review it again.";

/** Where the batch ends: at `upTo`, else its last card. */
function batchEnd(
  batch: CrewBatch,
  upTo: string | undefined,
): { cards: CrewCard[]; to: string } | null {
  const at = upTo
    ? batch.cards.findIndex((card) => card.id === upTo)
    : batch.cards.length - 1;
  if (at < 0) return null;
  const cards = batch.cards.slice(0, at + 1);
  return { cards, to: cards.at(-1)!.stacked!.commit };
}

/**
 * The batch's combined change up to a card (its last when not given), as
 * the crew's branch holds it: what Apply would land, with its fingerprint.
 */
export async function reviewCrewBatch(
  path: string,
  upTo?: string,
): Promise<
  | { diff: BotDiff; from: string; to: string; cards: CrewCard[] }
  | { error: string }
> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  const end = batch && batchEnd(batch, upTo);
  if (!crew?.copy || !batch || !end) return { error: NOT_ON_BRANCH };
  try {
    const diff = await botCopyHost.range(crew.copy.path, batch.from, end.to);
    return { diff, from: batch.from, to: end.to, cards: end.cards };
  } catch (error) {
    logError("Review crew batch", error);
    return { error: botCopyError(error) };
  }
}

/**
 * Apply the batch, or up to one of its cards, to your files: exactly the
 * combined change between the batch's start and that card's commit, by its
 * fingerprint (`hash`, from the Review you saw, when you saw one). Settings
 * an app would run as you are never applied this way, and a conflict with
 * your files changes nothing: the crew's branch can be updated onto them.
 * Resolves with why it couldn't, or null once applied.
 */
export async function applyCrewBatch(
  path: string,
  options: { upTo?: string; hash?: string } = {},
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  const end = batch && batchEnd(batch, options.upTo);
  if (!crew?.copy || !batch || !end) return NOT_ON_BRANCH;
  const copy = crew.copy;
  let range: BotDiff;
  try {
    range = await botCopyHost.range(copy.path, batch.from, end.to);
  } catch (error) {
    logError("Apply crew batch", error);
    return botCopyError(error);
  }
  if (options.hash && options.hash !== range.hash) return BRANCH_MOVED;
  const guarded = protectedFixPaths(range.files.map((file) => file.path));
  if (guarded.length)
    return `Aven didn't apply this: it changes settings or hooks that could run commands as you (${guarded.join(", ")}). Take it over in a chat to apply that part yourself.`;
  try {
    await botCopyHost.applyRange(
      path,
      copy.path,
      batch.from,
      end.to,
      range.hash,
    );
  } catch (error) {
    if (isFixChanged(error)) return BRANCH_MOVED;
    logError("Apply crew batch", error);
    if (!/conflict/i.test(errorText(error))) return botCopyError(error);
    const text =
      "Your files changed where the crew worked, so nothing was applied. Update the crew's branch onto your files, then Apply again.";
    updateCrew(path, (current) =>
      current.stack
        ? { ...current, stack: { ...current.stack, conflict: text } }
        : current,
    );
    return text;
  }
  const applied = new Set(end.cards.map((card) => card.id));
  updateCrew(path, (current) => {
    let next: Crew = current;
    for (const card of current.cards)
      if (applied.has(card.id))
        next = withCard(
          next,
          withInboxResolved(markApplied(card, now), "done", now),
        );
    const left = stackedCards({ ...next, stack: { base: end.to } }).length;
    next = { ...next, stack: left ? { base: end.to } : undefined };
    if (!next.stack) delete next.stack;
    const only = end.cards.length === 1 ? end.cards[0] : undefined;
    return withFeed(next, {
      at: now,
      kind: "applied",
      who: "you",
      ...(only ? { cardId: only.id, title: only.title } : {}),
      text: only
        ? `Applied “${only.title}” to your files`
        : `Applied ${end.cards.length} cards to your files: ${end.cards
            .map((card) => card.title)
            .join(" · ")}`,
    });
  });
  notifyGitChanged(path);
  for (const card of end.cards)
    await moveFeatureCard(path, card.id, "shipped", "");
  return null;
}

/** The card the crew is at work on (or that waits on you) builds on its branch. */
const BUILDS_ON_TOP = (title: string) =>
  `“${title}” builds on top of the crew's branch. Finish it or throw it away first.`;

/**
 * Take the top card off the crew's branch (Back to Ideas or Throw away):
 * the branch goes back to the card before it. Only the top card, and only
 * while no card builds on top of it.
 */
export async function dropStackedCard(
  path: string,
  cardId: string,
  then: "ideas" | "delete",
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  const card = batch?.cards.at(-1);
  if (!crew?.copy || !batch || !card) return NOT_ON_BRANCH;
  if (card.id !== cardId)
    return "Only the last card on the crew's branch can come off it.";
  const busy = cardInCopy(crew);
  if (busy) return BUILDS_ON_TOP(busy.title);
  try {
    await botCopyHost.discard(
      crew.copy.path,
      card.stacked!.parent,
      crew.copy.branch,
    );
  } catch (error) {
    logError("Drop crew card", error);
    return botCopyError(error);
  }
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known) return current;
    let next = withCard(
      current,
      withInboxResolved(
        { ...markDiscarded(known, now), stacked: undefined },
        "dismissed",
        now,
      ),
    );
    if (!stackedCards(next).length) {
      next = { ...next };
      delete next.stack;
    }
    const idea = next.ideas?.[cardId];
    if (idea) next = withIdea(next, cardId, { ...idea, declined: true });
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: known.title,
      text:
        then === "ideas"
          ? `“${known.title}” came off the crew's branch and went back to Ideas`
          : `You took “${known.title}” off the crew's branch and threw it away`,
    });
  });
  if (then === "ideas") await moveFeatureCard(path, cardId, "idea", "");
  else await deleteFeatureCard(path, cardId);
  return null;
}

/**
 * Your files moved on where the batch would land: replay the crew's branch
 * onto them, one card at a time. A card that no longer fits leaves the
 * branch exactly as it was, and says which. Not while a card builds on it.
 */
export async function restackCrew(
  path: string,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  if (!crew?.copy || !batch) return NOT_ON_BRANCH;
  const busy = cardInCopy(crew);
  if (busy) return BUILDS_ON_TOP(busy.title);
  let moved: { base: string; commits: string[] };
  try {
    moved = await botCopyHost.restack(
      path,
      crew.copy.path,
      crew.copy.branch,
      batch.from,
      batch.cards.map((card) => card.stacked!.commit),
    );
  } catch (error) {
    logError("Restack crew", error);
    const text = isRestackConflict(error)
      ? `${botCopyError(error)}. Nothing was lost: take the last card off the branch, or take it over in a chat.`
      : botCopyError(error);
    updateCrew(path, (current) =>
      current.stack
        ? { ...current, stack: { ...current.stack, conflict: text } }
        : current,
    );
    return text;
  }
  updateCrew(path, (current) => {
    let next: Crew = { ...current, stack: { base: moved.base } };
    let parent = moved.base;
    batch.cards.forEach((card, index) => {
      const known = crewCard(next, card.id);
      const commit = moved.commits[index];
      if (!known || !commit) return;
      next = withCard(next, { ...known, stacked: { commit, parent } });
      parent = commit;
    });
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "aven",
      text: `Updated the crew's branch onto your files (${batch.cards.length} ${batch.cards.length === 1 ? "card" : "cards"})`,
    });
  });
  return null;
}

/** The crew's card for a Board card it still has (queued, in its loop, Ready or Stuck), on or off. */
function heldCrewCard(
  crew: Crew | undefined,
  cardId: string,
): CrewCard | undefined {
  const card = crew ? crewCard(crew, cardId) : undefined;
  return card && card.stage !== "applied" && card.stage !== "discarded"
    ? card
    : undefined;
}

/**
 * What Delete also throws away of the crew's work on a card, as a line for
 * its dialog, or "" when the crew doesn't have it. The crew may be off: its
 * cards and copy stay, and Delete throws them away all the same.
 */
export function crewDeleteNote(crew: Crew | undefined, cardId: string): string {
  const card = heldCrewCard(crew, cardId);
  if (!card) return "";
  if (card.stage === "ready")
    return "The crew's Ready change is thrown away too.";
  if (card.stage === "queued") return "It leaves the crew's queue too.";
  return "The crew's work on it is thrown away too.";
}

/**
 * Delete a Board card. One the crew still has (queued, in its loop, Ready
 * or Stuck) is thrown away with its work first, so the crew never goes on
 * building, or holding its copy for, a card that's gone. Resolves with why
 * it couldn't, or null.
 */
export async function deleteBoardCard(
  path: string,
  cardId: string,
): Promise<string | null> {
  if (heldCrewCard(getCrew(path), cardId))
    return discardCrewCard(path, cardId, "delete");
  await deleteFeatureCard(path, cardId);
  return null;
}

/** Take a Stuck card's Inbox card away without acting on it. */
export function dismissCrewInbox(
  path: string,
  cardId: string,
  now = Date.now(),
) {
  updateCrew(path, (crew) => {
    const card = crewCard(crew, cardId);
    if (!card) return crew;
    const resolved = withInboxResolved(card, "done", now);
    return resolved === card ? crew : withCard(crew, resolved);
  });
}

// ---------------------------------------------------------------------------
// Members: who is in the crew and how each works

/** What you can add: a role's member, or one of your own that works as a Builder or Checker. */
export type CrewTemplate =
  "builder" | "checker" | "security" | "scout" | "custom";

export type CrewNewMember = {
  /** For a custom member: whether it builds or checks. */
  role?: "builder" | "checker";
  name?: string;
  /** A custom member's title and job: "Designer", "Makes it look right". */
  label?: string;
  job?: string;
  harness?: string;
  model?: string;
  instructions?: string;
};

/** The settings you can change on a member; its role never changes. */
export type CrewMemberChange = {
  name?: string | null;
  critter?: string | null;
  label?: string | null;
  job?: string | null;
  harness?: string;
  model?: string | null;
  effort?: string | null;
  instructions?: string | null;
  /** Paths or globs, as a list or as you typed them (one per line, or commas). */
  scope?: readonly string[] | string | null;
  schedule?: CrewScoutSchedule;
  /** Security's weekly sweep of the whole project. */
  sweep?: "off" | "weekly";
  /** Off: it takes no turns. */
  paused?: boolean;
};

/** Whether a member may run on this app: only the apps that enforce its rules. */
export function crewAgentAllowed(harness: string): harness is CrewAgent {
  return (CREW_AGENTS as readonly string[]).includes(harness);
}

function cleanText(value: string | null | undefined, max: number) {
  const text = value?.trim().slice(0, max);
  return text || undefined;
}

/** Scope as you typed it: one path or glob per line (or comma), tidied. */
export function crewScopeList(
  value: readonly string[] | string | null | undefined,
  /** The project's folder: an absolute path inside it is made relative. */
  project?: string,
): { scope: string[] } | { error: string } {
  const items =
    typeof value === "string" ? value.split(/[\n,]/) : (value ?? []);
  const root = project?.replace(/\\/g, "/").replace(/\/+$/, "");
  const seen = new Set<string>();
  for (const item of items) {
    let entry = item.trim().replace(/\\/g, "/").replace(/\/+$/, "");
    if (!entry) continue;
    if (entry.startsWith("/") || /^[A-Za-z]:\//.test(entry)) {
      // Inside the project: from its folder. Anywhere else can't be a scope.
      if (root && (entry === root || entry.startsWith(`${root}/`)))
        entry = entry.slice(root.length).replace(/^\/+/, "");
      else
        return {
          error: `“${item.trim()}” is outside the project. Use paths inside it, like src/ui.`,
        };
      if (!entry) return { scope: [] };
    }
    entry = entry.replace(/^\.\//, "").slice(0, 200);
    if (entry.split("/").includes(".."))
      return {
        error: `“${item.trim()}” leaves the project with “..”. Use paths inside it, like src/ui.`,
      };
    seen.add(entry);
    if (seen.size >= 20) break;
  }
  return { scope: [...seen] };
}

/**
 * A mark none of the crew wears yet: `own` (its role's, or a custom
 * member's) when free, else the first free one.
 */
function freeMark(crew: Crew, own: string): string {
  const used = new Set(crew.members.map((member) => memberCritter(member)));
  if (!used.has(own)) return own;
  return (
    MEMBER_SIGIL_CHOICES.map((item) => item.key).find(
      (key) => !used.has(key),
    ) ?? own
  );
}

/**
 * Add a member from a template. Several Builders and Checkers; one Scout
 * (and the Fixer is the project's bot, added from its own switch). Resolves
 * with the new member's id, or why it couldn't.
 */
export function addCrewMember(
  path: string,
  template: CrewTemplate,
  input: CrewNewMember = {},
): { id: string } | { error: string } {
  const crew = getCrew(path);
  if (!crew) return { error: "This project has no crew." };
  const role: Exclude<CrewRole, "fixer"> =
    template === "custom" ? (input.role ?? "builder") : template;
  if (
    (role === "scout" || role === "security") &&
    crew.members.some((member) => member.role === role)
  )
    return {
      error: `This crew already has ${role === "scout" ? "a Scout" : "Security"}.`,
    };
  if (crew.members.filter((member) => member.role !== "fixer").length >= 8)
    return { error: "A crew has at most 8 members." };
  const harness =
    input.harness &&
    crewAgentAllowed(input.harness) &&
    crewAgentsFor(role).includes(input.harness)
      ? input.harness
      : undefined;
  const label = template === "custom" ? cleanText(input.label, 40) : undefined;
  const job = template === "custom" ? cleanText(input.job, 120) : undefined;
  if (template === "custom" && !label)
    return { error: "Give your member a title, like Designer." };
  let id = "";
  updateCrew(path, (current) => {
    id = newMemberId(current, role);
    const critter = freeMark(current, template === "custom" ? "custom" : role);
    const name = cleanText(input.name, 40);
    const model = harness ? cleanText(input.model, 200) : undefined;
    const instructions = cleanText(input.instructions, CREW_INSTRUCTIONS_MAX);
    const member: CrewMember = {
      id,
      role,
      ...(name ? { name } : {}),
      critter,
      ...(label ? { label } : {}),
      ...(job ? { job } : {}),
      ...(harness ? { harness } : {}),
      ...(model ? { model } : {}),
      ...(instructions ? { instructions } : {}),
    };
    return { ...current, members: [...current.members, member] };
  });
  return { id };
}

/**
 * Change a member's settings. Its app can only be one that enforces its
 * rules; none of these change what it may do (its sandbox, rules and copy
 * come from its role alone). Resolves with why it couldn't, or null.
 */
export function updateCrewMember(
  path: string,
  id: string,
  change: CrewMemberChange,
): string | null {
  const crew = getCrew(path);
  const member = crew ? crewMemberById(crew, id) : undefined;
  if (!crew || !member) return "That member isn't in the crew.";
  if (member.role === "fixer") return "The Fixer is set in its own settings.";
  if (change.harness !== undefined && !crewAgentAllowed(change.harness))
    return "Crews run only on apps that keep their rules: Claude Code or Codex.";
  if (
    change.harness !== undefined &&
    !crewAgentsFor(member.role).includes(change.harness as CrewAgent)
  )
    return "A Builder runs on Claude Code: Codex can't keep it out of the copy's settings yet.";
  if (
    change.critter &&
    !isSigilKey(change.critter) &&
    !isMascotName(change.critter)
  )
    return "That mark isn't one of Aven's.";
  const scoped =
    change.scope !== undefined
      ? crewScopeList(change.scope, crew.path)
      : undefined;
  if (scoped && "error" in scoped) return scoped.error;
  updateCrew(path, (current) =>
    withMemberId(current, id, (entry) => {
      const next: CrewMember = { ...entry };
      const set = <K extends keyof CrewMember>(
        key: K,
        value: CrewMember[K],
      ) => {
        if (value === undefined) delete next[key];
        else next[key] = value;
      };
      if (change.name !== undefined) set("name", cleanText(change.name, 40));
      if (change.critter !== undefined)
        set("critter", change.critter ?? undefined);
      if (change.label !== undefined) set("label", cleanText(change.label, 40));
      if (change.job !== undefined) set("job", cleanText(change.job, 120));
      if (change.harness !== undefined && change.harness !== entry.harness) {
        // Another app: its model and effort were the old app's.
        set("harness", change.harness as CrewAgent);
        set("model", undefined);
        set("effort", undefined);
        set("fallback", undefined);
      }
      if (change.model !== undefined)
        set("model", cleanText(change.model, 200));
      if (change.effort !== undefined)
        set("effort", cleanText(change.effort, 40));
      if (change.instructions !== undefined)
        set(
          "instructions",
          cleanText(change.instructions, CREW_INSTRUCTIONS_MAX),
        );
      if (scoped && "scope" in scoped)
        set("scope", scoped.scope.length ? scoped.scope : undefined);
      if (change.schedule !== undefined && entry.role === "scout")
        set(
          "schedule",
          change.schedule === "daily" ? undefined : change.schedule,
        );
      if (change.sweep !== undefined && entry.role === "security")
        set("sweep", change.sweep === "weekly" ? "weekly" : undefined);
      if (change.paused !== undefined)
        set("paused", change.paused || undefined);
      return next;
    }),
  );
  return null;
}

/**
 * Whether a ready-made member is in the crew already: added from it, or (for
 * the plain Builder, Checker, Scout and Security) a member of its role
 * wearing its mark, with no title of its own.
 */
export function presetInCrew(crew: Crew, preset: CrewPreset): boolean {
  return crew.members.some(
    (member) =>
      member.preset === preset.key ||
      (preset.role === "security" && member.role === "security") ||
      (preset.role === "scout" && member.role === "scout") ||
      (!preset.label &&
        member.role === preset.role &&
        !member.label &&
        memberCritter(member) === preset.mark),
  );
}

/**
 * Add a ready-made member in one click: its role, mark, title, job,
 * instructions and paths, on the app and model given (else its role's
 * usual). Everything stays editable. Resolves with its id, or why not.
 */
export function addCrewPreset(
  path: string,
  key: string,
  app?: { harness?: string; model?: string },
): { id: string } | { error: string } {
  const preset = CREW_PRESETS.find((item) => item.key === key);
  const crew = getCrew(path);
  if (!preset || !crew) return { error: "That member isn't available." };
  if (presetInCrew(crew, preset)) return { error: "It's in the crew already." };
  if (crew.members.filter((member) => member.role !== "fixer").length >= 8)
    return { error: "A crew has at most 8 members." };
  if (
    (preset.role === "scout" || preset.role === "security") &&
    crew.members.some((member) => member.role === preset.role)
  )
    return { error: "It's in the crew already." };
  const harness =
    app?.harness &&
    crewAgentAllowed(app.harness) &&
    crewAgentsFor(preset.role).includes(app.harness)
      ? app.harness
      : undefined;
  const model = harness ? cleanText(app?.model, 200) : undefined;
  let id = "";
  updateCrew(path, (current) => {
    id = newMemberId(current, preset.role);
    const member: CrewMember = {
      id,
      role: preset.role,
      preset: preset.key,
      critter: freeMark(current, preset.mark),
      ...(preset.label ? { label: preset.label, job: preset.job } : {}),
      instructions: preset.instructions,
      ...(preset.scope?.length ? { scope: [...preset.scope] } : {}),
      ...(harness ? { harness } : {}),
      ...(model ? { model } : {}),
    };
    return { ...current, members: [...current.members, member] };
  });
  return { id };
}

/**
 * Remove a member. The last Builder or Checker stays (a crew needs one of
 * each), and one at work stays until its card is stopped. Its chat stays
 * the crew's and never starts again. Resolves with why it couldn't, or null.
 */
export function removeCrewMember(path: string, id: string): string | null {
  const crew = getCrew(path);
  const member = crew ? crewMemberById(crew, id) : undefined;
  if (!crew || !member) return null;
  if (member.role === "fixer")
    return "The Fixer is the project's bot: turn it off in its own settings.";
  if (
    (member.role === "builder" || member.role === "checker") &&
    crew.members.filter((entry) => entry.role === member.role).length <= 1
  )
    return `A crew needs a ${CREW_ROLE_INFO[member.role].label}.`;
  const working =
    !!member.doing ||
    crew.cards.some(
      (card) => !!card.turn && card.turn.sessionId === member.sessionId,
    );
  if (working) return "It's working on a card. Stop the card first.";
  // A card in the copy keeps who built and checked it (and so its scope).
  const holding = crew.cards.find(
    (card) =>
      (card.stage === "building" ||
        card.stage === "checking" ||
        card.stage === "ready" ||
        card.stage === "stuck") &&
      (card.builderId === id || card.checkerId === id),
  );
  if (holding)
    return `“${holding.title}” is still in the crew's copy. Apply it, send it back to Ideas or throw it away first.`;
  updateCrew(path, (current) => withoutMember(current, id));
  return null;
}

/** Make sure a list of routing rules only names the crew's own Builders. */
export function crewRoutesFor(
  crew: Crew,
  routes: readonly {
    id?: string;
    words: readonly string[] | string;
    to: string;
  }[],
): CrewRoute[] {
  const builders = new Set(
    crew.members
      .filter((member) => member.role === "builder")
      .map((member) => member.id),
  );
  const out: CrewRoute[] = [];
  routes.forEach((route, index) => {
    const raw =
      typeof route.words === "string"
        ? route.words.split(/[,\n]/)
        : route.words;
    const words = [
      ...new Set(
        raw
          .map((word) =>
            word.trim().replace(/^#/, "").toLowerCase().slice(0, 40),
          )
          .filter(Boolean),
      ),
    ].slice(0, 12);
    if (!words.length || !builders.has(route.to) || out.length >= 12) return;
    out.push({ id: route.id || `rule-${index + 1}`, words, to: route.to });
  });
  return out;
}

/** Your routing rules, in order: the first a card mentions picks its Builder. */
export function setCrewRoutes(
  path: string,
  routes: readonly {
    id?: string;
    words: readonly string[] | string;
    to: string;
  }[],
) {
  updateCrew(path, (crew) => {
    const next = crewRoutesFor(crew, routes);
    const out: Crew = { ...crew, routes: next };
    if (!next.length) delete out.routes;
    return out;
  });
}

/** The Builder a card goes to when no rule matches. */
export function setDefaultBuilder(path: string, id: string | null) {
  updateCrew(path, (crew) => {
    const member = id ? crewMemberById(crew, id) : undefined;
    const next: Crew = { ...crew };
    if (member?.role === "builder") next.defaultBuilder = member.id;
    else delete next.defaultBuilder;
    return next;
  });
}

/** Set one of the crew's limits, kept within what it may be. */
export function setCrewLimit(path: string, name: CrewLimitName, value: number) {
  if (!Number.isFinite(value)) return;
  const [low, high] = CREW_LIMIT_RANGES[name];
  const next = Math.min(high, Math.max(low, Math.round(value)));
  updateCrew(path, (crew) =>
    crew.limits[name] === next
      ? crew
      : { ...crew, limits: { ...crew.limits, [name]: next } },
  );
}

// ---------------------------------------------------------------------------
// What the crew UI needs from the main workspace, supplied by App.

export type CrewWorkspace = {
  /** Show a member's chat in a tab: by its id, or a role for its first. */
  openChat: (path: string, who: string) => void;
  /** Open the crew: the project's Board with the crew on it. */
  openCrew: (path: string) => void;
  /**
   * Open the crew's settings (turning it on, when it is off); with "add",
   * at its gallery of members to add, or with a member's id, at that member.
   */
  openSettings: (path: string, page?: string) => void;
  /** Stop a chat's turn, and wait until it has. */
  stop: (sessionId: string) => Promise<void>;
};

let workspace: CrewWorkspace | null = null;
const workspaceListeners = new Set<() => void>();

export function installCrewWorkspace(next: CrewWorkspace): () => void {
  workspace = next;
  for (const listener of workspaceListeners) listener();
  return () => {
    if (workspace !== next) return;
    workspace = null;
    for (const listener of workspaceListeners) listener();
  };
}

export function crewWorkspace(): CrewWorkspace | null {
  return workspace;
}

function subscribeCrewWorkspace(listener: () => void) {
  workspaceListeners.add(listener);
  return () => {
    workspaceListeners.delete(listener);
  };
}

export function useCrewWorkspace(): CrewWorkspace | null {
  return useSyncExternalStore(
    subscribeCrewWorkspace,
    crewWorkspace,
    crewWorkspace,
  );
}

/** The card that holds the copy, so a button can say what waits. */
export function crewCardHolding(crew: Crew): CrewCard | undefined {
  return cardInCopy(crew);
}

// ---------------------------------------------------------------------------
// Tell the crew… from elsewhere (the sidebar): the crew's Board opens with
// the cursor in its Feed's box.

let tellFor: string | null = null;
const tellListeners = new Set<() => void>();

const tellKey = (path: string) => projectKey(normalizeProjectPath(path));

/** Ask the crew's Feed to put the cursor in its Tell the crew box. */
export function focusCrewTell(path: string) {
  tellFor = tellKey(path);
  for (const listener of [...tellListeners]) listener();
}

/** The Feed takes a request for its crew, once: true when there was one. */
export function takeCrewTell(path: string): boolean {
  if (tellFor === null || tellFor !== tellKey(path)) return false;
  tellFor = null;
  return true;
}

export function subscribeCrewTell(listener: () => void): () => void {
  tellListeners.add(listener);
  return () => {
    tellListeners.delete(listener);
  };
}
