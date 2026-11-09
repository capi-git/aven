import { avosPickOverride } from "./crewModels";
import { holdIdeaStarts } from "./crewLimits";
import { useSyncExternalStore } from "react";
import { crewInboxCard, withInboxResolved } from "./crewInbox";
import { claudeCheckerModel } from "./crewModels";
import { isCodexToolsOpen } from "./harness/codexLockdown";
import {
  cardCanGoOn,
  cardTriesAgain,
  changedAfterCheck,
  markApplied,
  markDiscarded,
  markMockupDone,
  markResearchRead,
  queueCard,
  resumeCard,
  stopCard,
} from "./crewLoop";
import {
  CREW_EXTRA_RUNS,
  CREW_GOAL_MAX,
  CREW_NOTE_MAX,
  bumpToday,
  cardInCopy,
  cardDesigner,
  cardResearcher,
  claimCrewJob,
  releaseCrewJob,
  renewCrewJob,
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
  crewMember,
  crewMemberById,
  memberCritter,
  newMemberId,
  withMemberId,
  withMemberMemory,
  withGoal,
  withGoalCardDropped,
  stackedHash,
  waitsForReview,
  yourGoal,
  withNote,
  withMessage,
  withTalk,
  crewLead,
  CREW_MESSAGE_MAX,
  withoutCard,
  withoutMember,
  type Crew,
  type CrewHelperModel,
  type CrewAccess,
  type CrewAgent,
  type CrewCard,
  type CrewLimitName,
  type CrewMember,
  type CrewMessageFrom,
  type CrewMessageKind,
  type CrewMockup,
  type CrewRole,
  type CrewRoutine,
  type CrewRoute,
  type CrewScoutSchedule,
  crewCardByTitle,
  cardSteppedAside,
} from "./crews";
import { MEMBER_SIGIL_CHOICES, isSigilKey } from "./dotSigils";
import { isMascotName } from "./projectMascots";
import { isHarnessAvailable } from "./harness/availability";
import { pickerModelsFor, preferredModelId } from "./models";
import { CREW_PRESETS, type CrewPreset } from "./crewPresets";
import { errorText, logError } from "./errors";
import {
  FEATURE_TITLE_MAX,
  addFeatureCards,
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
import { projectAppearance } from "./projectAppearance";
import { avosIntro, avosUnmet } from "./avos";
import { prBranch, prText } from "./avosReview";
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
import { plural } from "./words";

/**
 * What you do with a crew and its cards: Give to crew, Not now, Pause and
 * Stop, Apply, One more round, Back to Ideas, Tell the crew. These work
 * from any window: they change the shared store, the crew's copy and the
 * Board, never a bot's chat, which the main window's runner drives (a turn
 * you stop is stopped through the workspace).
 */

/** Models a crew's members run on, picked when it is turned on. */
export type CrewModels = Record<
  "builder" | "checker" | "scout" | "researcher" | "designer",
  { harness: "claude" | "codex"; model: string }
> & { lead?: { harness: "claude" | "codex"; model: string } };

/**
 * The Builder on your usual Claude model. The Checker on Codex when it is
 * installed (fresh eyes from another model), else on a different Claude
 * model. The Scout on a lighter Claude model when there is one; the
 * Researcher reads and writes at length, so it gets the Builder's.
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
    // It mostly reads and writes a line: a lighter model.
    lead: { harness: "claude", model: lighter },
    builder: { harness: "claude", model: builder },
    checker:
      input.codex && input.preferredCodex
        ? { harness: "codex", model: input.preferredCodex }
        : { harness: "claude", model: other ?? builder },
    scout: { harness: "claude", model: lighter },
    researcher: { harness: "claude", model: builder },
    // It draws a whole screen: the Builder's model, on Claude, as it writes.
    designer: { harness: "claude", model: builder },
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
  if (role === "lead" || role === "helper") return models.lead ?? models.scout;
  return models[role === "security" ? "checker" : role];
}

/**
 * Turn the crew on, and it starts working. A member without an app or model
 * yet gets its role's pick; one you set keeps yours.
 */
export function turnOnCrew(path: string, models: CrewModels, now = Date.now()) {
  updateCrew(path, (crew) => {
    let next: Crew = { ...crew, on: true, onAt: now, paused: undefined };
    // A team starting for the first time gets its Lead. One that has run
    // keeps the teammates it has; you can add one from the gallery.
    if (!crew.onAt && !crew.members.some((member) => member.role === "lead"))
      next = {
        ...next,
        members: [
          { id: "lead", role: "lead", critter: "lead" },
          ...next.members,
        ],
      };
    for (const member of next.members) {
      if (member.role === "fixer") continue;
      // Security, like the Checker, reads with other eyes than the Builder's.
      const pick = crewModelFor(models, member.role);
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
    // Meeting Avos, your answer wakes it: its reply says so, not a line.
    return crew.onAt
      ? withFeed(next, {
          at: now,
          kind: "note",
          who: "aven",
          text: "Avos is on",
        })
      : next;
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

/**
 * A project deleted or archived: its team stops (as Turn off does) and
 * nothing new starts. Its cards, copy, branch and settings stay, so it
 * picks up again if the project comes back and you turn it on.
 */
export async function stopTeamForProject(path: string) {
  if (!getCrew(path)?.on) return;
  await turnOffCrew(path);
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
            text: paused ? "You paused Avos" : "You resumed Avos",
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
      text: "You cleared Avos's goal",
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
        text: `You asked Avos to keep going: ${crew.goal.text}`,
      },
    );
  });
}

/** What the crew says to a nudge when it has nothing to start. */
export const CREW_NOTHING_TO_BUILD = "Tell Avos what to build, or add an idea.";

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
    "the (?:project|app|work|crew|team)",
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
  /** Said to the Builder after your words, as what the card is about. */
  about?: string,
): Promise<string | null> {
  const words = text.trim().slice(0, CREW_NOTE_MAX);
  if (!words) return null;
  if (!getCrew(path)?.on) return AVOS_ASLEEP;
  if (crewNudge(words, path)) {
    nudgeCrew(path, words, now);
    return null;
  }
  const title = crewTaskTitle(words);
  const note = [
    words.toLowerCase() !== title.toLowerCase() ? words : "",
    about?.trim() ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const card = await addFeatureIdea(path, {
    title,
    ...(note ? { note } : {}),
  });
  if (!card) return "Couldn't add the card to the Board.";
  return giveCardToCrew(path, card, now);
}

/**
 * Write to the team, as the team chat does: your words are kept as your
 * message, and they become what you chose: a card the team builds (Tell
 * the team…), a rule for every card, or the goal. A nudge ("go") starts
 * what waits, as in the task box. Resolves with why it couldn't, or null;
 * a message that didn't go through isn't kept.
 */
export async function tellTeam(
  path: string,
  text: string,
  as: CrewMessageKind = "card",
  now = Date.now(),
  /** The chat you wrote it from with @Avos (a message to Avos only). */
  from?: CrewMessageFrom,
  /** For a card: what it is about, said to the Builder after your words. */
  about?: string,
): Promise<string | null> {
  const words = text.trim();
  if (!words) return null;
  // A message to Avos is a chat message; the rest become cards or rules.
  if (words.length > (as === "lead" ? CREW_MESSAGE_MAX : CREW_NOTE_MAX))
    return TOO_LONG_FOR_EVERYONE;
  if (as === "goal" && words.length > CREW_GOAL_MAX) return TOO_LONG_FOR_A_GOAL;
  // Writing to Avos wakes it. The first time, its introduction stays in
  // its chat above what you said, as it was on screen.
  const meeting = avosUnmet(getCrew(path));
  const woke = await wakeAvos(path);
  if (woke) return woke;
  if (meeting) keepAvosIntro(path, now);
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  // "keep going" starts what waits: no card, so it isn't called one.
  const nudge = as === "card" && crewNudge(words, path);
  const before = new Set(crew.feed.map((entry) => entry.id));
  if (as === "lead") {
    const lead = crewLead(crew);
    if (!lead) return "This project has no Avos yet. Open Avos first.";
    updateCrew(path, (current) =>
      withMessage(
        withTalk(current, {
          at: now,
          from: "you",
          to: lead.id,
          // Avos hears where you wrote it from; your words stay as you wrote them.
          text: from
            ? `${words}\n\n(The user wrote this to you from their chat “${from.title || "Untitled"}”.)`
            : words,
          hop: 0,
        }),
        { at: now, text: words, as, ...(from ? { from } : {}) },
      ),
    );
    return null;
  }
  if (as === "rule") tellCrew(path, words, now);
  else if (as === "goal") setCrewGoal(path, words, now);
  else {
    const problem = await tellCrewWork(path, words, now, about);
    if (problem) return problem;
  }
  // The Feed's own line for what you wrote: your message stands for it.
  // Anything else it led to ("You resumed Avos") stays as it is.
  const echo = getCrew(path)?.feed.find(
    (entry) => !before.has(entry.id) && entry.who === "you" && entry.at === now,
  )?.id;
  updateCrew(path, (current) =>
    withMessage(current, {
      at: now,
      text: words,
      ...(nudge ? {} : { as }),
      ...(echo ? { echo } : {}),
    }),
  );
  return null;
}

/** Said when a goal is longer than a goal can be: it's never cut. */
export const TOO_LONG_FOR_A_GOAL = `A goal has to fit in ${CREW_GOAL_MAX} characters. Shorten it, or send it as a card.`;

/** Said when a message to everyone is longer than a card's note can be. */
export const TOO_LONG_FOR_EVERYONE = `That's too long for Avos: keep it under ${CREW_NOTE_MAX} characters, or write to one helper.`;

/**
 * A teammate's own chat starts with Avos's copy, which is made at its
 * first card: until then there is no chat to open or write to. The Fixer's
 * chat is the project bot's, so it is always there.
 */
export function teammateChatReady(
  crew: Pick<Crew, "copy" | "members">,
  memberId: string,
): boolean {
  return crewMemberById(crew, memberId)?.role === "fixer" || !!crew.copy;
}

/** Said while a teammate's chat waits for Avos's first card. */
export function firstCardChatText(name: string): string {
  return `${name}'s chat starts with Avos's first card.`;
}

/**
 * Write to one teammate: your words go to its own chat as a message you
 * typed there, so its chat can offer to queue what it takes down (Queue
 * these, Set as goal), and nothing is queued by itself. Resolves with why
 * it couldn't, or null.
 */
export async function tellTeammate(
  path: string,
  memberId: string,
  text: string,
  now = Date.now(),
): Promise<string | null> {
  const words = text.trim().slice(0, CREW_MESSAGE_MAX);
  if (!words) return null;
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  if (!crewMemberById(crew, memberId))
    return "That helper isn't with Avos any more.";
  const send = crewWorkspace()?.sendToMember;
  if (!send) return "Open Aven's main window to write to a helper.";
  const problem = await send(path, memberId, words).catch((error) =>
    errorText(error),
  );
  if (problem) return problem;
  updateCrew(path, (current) =>
    withMessage(current, { at: now, text: words, to: memberId }),
  );
  return null;
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
  if (
    card?.stage === "stuck" &&
    card.stuck?.reason !== "question" &&
    cardCanGoOn(card)
  ) {
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
  if (acted && next && !waitsForReview(crew)) return;
  // Passed work waiting on the branch is yours to review, not the crew's.
  const waiting = stackedCards(crew).length;
  const onBranch = `${waiting === 1 ? "One card waits" : `${waiting} cards wait`} for you on Avos's branch`;
  const reply = !next
    ? waiting
      ? `${onBranch}: ${waiting === 1 ? "review it to apply it" : "review them to apply them"}.`
      : CREW_NOTHING_TO_BUILD
    : next.stage === "stuck"
      ? cardCanGoOn(next)
        ? `“${next.title}” waits for your answer on its card.`
        : (next.stuck?.text ?? `“${next.title}” waits for you.`)
      : next.stage === "ready"
        ? `“${next.title}” is Ready: apply it or send it back from its card.`
        : next.stage === "queued" && waitsForReview(crew)
          ? `${onBranch}: review them to keep going.`
          : `Avos is on “${next.title}”.`;
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
  let crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  const known = crewCard(crew, card.id);
  if (known && known.stage !== "applied" && known.stage !== "discarded")
    return null;
  // Building happens in a copy, which needs Git: Avos offers to set it up.
  const noGit = await buildingProblem(path, now);
  if (noGit) return noGit;
  // Avos brings in the helpers building needs, the first time it does.
  crew = bringInBuilders(path, now) ?? crew;
  const idea = crew.ideas?.[card.id];
  updateCrew(path, (current) => {
    const chosen = crewCardChoice(current, choice);
    const to = chosen.builderId
      ? ` for ${crewMemberName(current, chosen.builderId)}`
      : "";
    return withFeed(
      withCard(
        withNotNow(withoutCard(current, card.id), card.id, false),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: featureBrief(card),
            from:
              idea?.by === "lead"
                ? "member"
                : idea?.by
                  ? idea.by
                  : idea
                    ? "scout"
                    : "you",
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
              : (() => {
                  // Let Avos choose: its pick for the Builder that takes it.
                  const override = avosPickOverride(
                    crewMemberById(current, chosen.builderId) ??
                      crewMember(current, "builder"),
                    idea?.pick,
                  );
                  return override ? { override } : {};
                })()),
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
        text: `You gave Avos “${card.title}”${to}`,
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
  if (!getCrew(path)?.on) return AVOS_ASLEEP;
  await loadFeatureCards(path);
  for (const title of titles) {
    // One the team already has (started by itself, say) isn't made twice.
    const crew = getCrew(path);
    if (crew && crewCardByTitle(crew, title)) continue;
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

// ---------------------------------------------------------------------------
// Questions for the Researcher

/**
 * "Research: how do other apps do X" in the Add an idea box: the question
 * after the prefix, or null for an ordinary idea. The prefix ends in a
 * colon, or a dash with space on both sides: "Research-based pricing" is
 * an idea.
 */
export function researchQuestion(text: string): string | null {
  const match =
    /^\s*(?:research|ask(?:\s+the)?\s+researcher)(?:\s*[:：]\s*|\s+[—–-]\s+)(.+)$/is.exec(
      text,
    );
  const question = match?.[1]?.trim();
  return question || null;
}

export const NO_RESEARCHER = "Add a Researcher as a helper first.";
const RESEARCHER_OFF = "Turn the Researcher on first.";

/**
 * Ask the Researcher a Board card's question: it waits in Building as
 * Queued and takes one read-only turn when Avos's copy is free, ending
 * in Findings for you. Resolves with why it couldn't, or null.
 */
export async function askResearcher(
  path: string,
  card: Pick<FeatureCard, "id" | "title" | "note" | "sourceUrl">,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  if (!cardResearcher(crew))
    return crew.members.some((member) => member.role === "researcher")
      ? RESEARCHER_OFF
      : NO_RESEARCHER;
  const known = crewCard(crew, card.id);
  if (known && known.stage !== "applied" && known.stage !== "discarded")
    return null;
  // An idea the Scout, Security or the Researcher put there is their
  // words, quoted as data in the question; yours are the question itself.
  const idea = crew.ideas?.[card.id];
  updateCrew(path, (current) => {
    const who = crewMemberName(
      current,
      cardResearcher(current)?.id ?? "researcher",
    );
    return withFeed(
      withCard(
        withNotNow(withoutCard(current, card.id), card.id, false),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: featureBrief(card),
            from:
              idea?.by === "lead"
                ? "member"
                : idea?.by
                  ? idea.by
                  : idea
                    ? "scout"
                    : "you",
            kind: "research",
            ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
            maxRounds: 1,
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
        text: `You asked ${who} “${card.title}”`,
      },
    );
  });
  await moveFeatureCard(path, card.id, "building", "");
  return null;
}

/** Why a question can't go to the Researcher now, or null. */
function researcherProblem(crew: Crew): string | null {
  if (cardResearcher(crew)) return null;
  return crew.members.some((member) => member.role === "researcher")
    ? RESEARCHER_OFF
    : NO_RESEARCHER;
}

/** Why a screen can't go to the Designer now, or null. */
function designerProblem(crew: Crew): string | null {
  if (cardDesigner(crew)) return null;
  return crew.members.some((member) => member.role === "designer")
    ? DESIGNER_OFF
    : NO_DESIGNER;
}

/** How the Researcher came to look into a question Avos passed it. */
export type ResearcherBroughtIn = "added" | "on";

/**
 * The Researcher, there and on for a question Avos passes it from your
 * message (Avos itself has no web): added as the ready-made Researcher when
 * the team has none, or turned back on. Its web follows Access, as any
 * Researcher's does. Resolves with how it came (null when it was on), or
 * what you need to do first.
 */
export function bringInResearcher(
  path: string,
): { broughtIn: ResearcherBroughtIn | null } | { problem: string } {
  const crew = getCrew(path);
  if (!crew?.on) return { problem: AVOS_ASLEEP };
  if (cardResearcher(crew)) return { broughtIn: null };
  const off = crew.members.find((member) => member.role === "researcher");
  if (off) {
    const problem = updateCrewMember(path, off.id, { paused: false });
    return problem ? { problem } : { broughtIn: "on" };
  }
  const added = addCrewPreset(
    path,
    "researcher",
    crewModelFor(crewModelsHere(), "researcher"),
  );
  if (!("error" in added)) return { broughtIn: "added" };
  return {
    problem:
      added.error === HELPERS_FULL
        ? "Avos needs the Researcher to look into that, but it has 8 helpers already. Remove one in Settings, then ask again."
        : added.error,
  };
}

/**
 * A new question for the Researcher ("Research: …") or screen for the
 * Designer ("Design: …"), typed in the Add an idea box or set up with the
 * team: the team's card is made first, queued as research or a mock-up,
 * and only then the Board's card for it, straight into Building. The loop
 * never sees it as an idea, so no tick between the two can hand it to a
 * Builder. Resolves with the Board card, or why it couldn't.
 */
export async function addQuestionCard(
  path: string,
  title: string,
  kind: "research" | "mockup",
  now = Date.now(),
  options: {
    /** For setup: the team is made before it is turned on. */
    whileOff?: boolean;
    /** Whose words it is: yours, or a setup suggestion (quoted as data). */
    from?: "you" | "setup";
    /** Avos brought the Researcher in for it (see `bringInResearcher`). */
    broughtIn?: ResearcherBroughtIn;
  } = {},
): Promise<{ card: FeatureCard | null; problem: string | null }> {
  const crew = getCrew(path);
  if (!crew || (!crew.on && !options.whileOff))
    return { card: null, problem: AVOS_ASLEEP };
  const problem =
    kind === "research" ? researcherProblem(crew) : designerProblem(crew);
  if (problem) return { card: null, problem };
  const clean = title.replace(/\s+/g, " ").trim().slice(0, FEATURE_TITLE_MAX);
  if (!clean) return { card: null, problem: "Say what to ask." };
  const id = crypto.randomUUID();
  updateCrew(path, (current) =>
    withCard(
      current,
      queueCard(
        {
          id,
          title: clean,
          brief: clean,
          from: options.from ?? "you",
          kind,
          maxRounds: 1,
        },
        now,
      ),
    ),
  );
  let card: FeatureCard | null = null;
  try {
    card = await addFeatureIdea(path, { id, title: clean, column: "building" });
  } catch (error) {
    logError("Crew question card", error);
  }
  if (!card) {
    updateCrew(path, (current) => withoutCard(current, id));
    return { card: null, problem: "Couldn't add the card to the Board." };
  }
  updateCrew(path, (current) => {
    const member =
      kind === "research" ? cardResearcher(current) : cardDesigner(current);
    const who = crewMemberName(
      current,
      member?.id ?? (kind === "research" ? "researcher" : "designer"),
    );
    const them = member?.name ? who : `the ${who}`;
    return withFeed(current, {
      at: now,
      kind: "note",
      who: "you",
      cardId: id,
      title: clean,
      text:
        kind === "mockup"
          ? `You asked ${who} to mock up “${clean}”`
          : options.broughtIn === "added"
            ? `Avos brought in ${them} to look into “${clean}”`
            : options.broughtIn === "on"
              ? `Avos turned ${them} back on to look into “${clean}”`
              : `You asked ${who} “${clean}”`,
    });
  });
  return { card, problem: null };
}

// ---------------------------------------------------------------------------
// Screens for the Designer

/**
 * "Design: the timer screen" or "Mock up: the today list" in the Add an
 * idea box: the card after the prefix, or null for an ordinary idea. As
 * for Research:, the prefix ends in a colon or a spaced dash.
 */
export function designQuestion(text: string): string | null {
  const match =
    /^\s*(?:design|mock(?:\s*-?\s*)up|ask(?:\s+the)?\s+designer)(?:\s*[:：]\s*|\s+[—–-]\s+)(.+)$/is.exec(
      text,
    );
  const asked = match?.[1]?.trim();
  return asked || null;
}

export const NO_DESIGNER = "Add a Designer as a helper first.";
const DESIGNER_OFF = "Turn the Designer on first.";

/**
 * Ask the Designer to mock up a Board card: it waits in Building as Queued
 * and takes one turn when Avos's copy is free, ending in a Mock-up for
 * you to look at. Resolves with why it couldn't, or null.
 */
export async function askDesigner(
  path: string,
  card: Pick<FeatureCard, "id" | "title" | "note" | "sourceUrl">,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  if (!cardDesigner(crew))
    return crew.members.some((member) => member.role === "designer")
      ? DESIGNER_OFF
      : NO_DESIGNER;
  const known = crewCard(crew, card.id);
  if (known && known.stage !== "applied" && known.stage !== "discarded")
    return null;
  const idea = crew.ideas?.[card.id];
  updateCrew(path, (current) => {
    const who = crewMemberName(
      current,
      cardDesigner(current)?.id ?? "designer",
    );
    return withFeed(
      withCard(
        withNotNow(withoutCard(current, card.id), card.id, false),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: featureBrief(card),
            from:
              idea?.by === "lead"
                ? "member"
                : idea?.by
                  ? idea.by
                  : idea
                    ? "scout"
                    : "you",
            kind: "mockup",
            ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
            maxRounds: 1,
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
        text: `You asked ${who} to mock up “${card.title}”`,
      },
    );
  });
  await moveFeatureCard(path, card.id, "building", "");
  return null;
}

const NO_MOCKUP = "This card has no mock-up.";

/**
 * Cards whose ideas are being added to the Board now (findings, a mock-up
 * to build): a second press waits.
 */
const addingIdeas = new Set<string>();

/**
 * Build it on a mock-up: an ordinary idea of yours, "Build the mock-up: …",
 * whose note points a Builder at the file Aven keeps (read-only to it,
 * never part of the project). The mock-up card is done. Resolves with why
 * it couldn't, or null. Pressed twice before the Board answers, the second
 * press does nothing: one idea, not two.
 */
export async function buildMockup(
  path: string,
  cardId: string,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (!card || card.kind !== "mockup" || card.stage !== "ready")
    return NOT_READY;
  const mockup = card.mockup;
  if (!mockup) return NO_MOCKUP;
  const key = `${projectKey(path)}\n${cardId}`;
  if (addingIdeas.has(key)) return null;
  addingIdeas.add(key);
  try {
    return await buildMockupOnce(path, crew!, { ...card, mockup }, now);
  } finally {
    addingIdeas.delete(key);
  }
}

async function buildMockupOnce(
  path: string,
  crew: Crew,
  card: CrewCard & { mockup: CrewMockup },
  now: number,
): Promise<string | null> {
  const cardId = card.id;
  const who = crewMemberName(crew, cardDesigner(crew)?.id ?? "designer");
  const idea = await addFeatureIdea(path, {
    title: `Build the mock-up: ${card.title}`,
    note: [
      `Build what the mock-up shows. Read it at ${card.mockup.file} (Aven's own copy of ${who}'s mock-up: read it, never change it; it isn't part of the project).`,
      card.mockup.note ? `${who} says: ${card.mockup.note}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
  if (!idea) return "Couldn't add the card to the Board.";
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known || known.stage !== "ready") return current;
    return withFeed(withCard(current, markMockupDone(known, now, "built")), {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: known.title,
      text: `You asked for “${known.title}” to be built from ${who}'s mock-up`,
    });
  });
  await moveFeatureCard(path, cardId, "shipped", "");
  return null;
}

/** You looked at the mock-up and want nothing built: the card is done. */
export async function dismissMockup(
  path: string,
  cardId: string,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (!card || card.kind !== "mockup" || card.stage !== "ready")
    return NOT_READY;
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known || known.stage !== "ready") return current;
    return withFeed(
      withCard(current, markMockupDone(known, now, "dismissed")),
      {
        at: now,
        kind: "note",
        who: "you",
        cardId,
        title: known.title,
        text: `You dismissed the mock-up for “${known.title}”`,
      },
    );
  });
  await moveFeatureCard(path, cardId, "shipped", "");
  return null;
}

const NO_FINDINGS = "This card has no findings to read.";

/**
 * Put the ideas the Researcher proposed on the Board (those you ticked, or
 * all of them), each an idea that waits for you: none ever builds by
 * itself. The card is done. Resolves with why it couldn't, or null. Pressed
 * twice before the Board answers, the second press does nothing.
 */
export async function addResearchIdeas(
  path: string,
  cardId: string,
  chosen?: readonly string[],
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  const card = crew ? crewCard(crew, cardId) : undefined;
  if (!card || card.kind !== "research" || card.stage !== "ready")
    return NOT_READY;
  if (!card.findings) return NO_FINDINGS;
  const key = `${projectKey(path)}\n${cardId}`;
  if (addingIdeas.has(key)) return null;
  addingIdeas.add(key);
  try {
    return await addResearchIdeasOnce(path, card, crew!, chosen, now);
  } finally {
    addingIdeas.delete(key);
  }
}

async function addResearchIdeasOnce(
  path: string,
  card: CrewCard,
  crew: Crew,
  chosen: readonly string[] | undefined,
  now: number,
): Promise<string | null> {
  const cardId = card.id;
  const titles = card.findings!.ideas.filter(
    (idea) => !chosen || chosen.includes(idea),
  );
  const who = crewMemberName(crew, cardResearcher(crew)?.id ?? "researcher");
  let added: readonly FeatureCard[] = [];
  // Not to start as your own before they are marked as the Researcher's.
  const releaseIdeas = holdIdeaStarts(path);
  if (titles.length) {
    try {
      added = await addFeatureCards(
        path,
        titles.map((title) => ({ title, column: "idea" as const })),
      );
    } catch (error) {
      releaseIdeas();
      logError("Add research ideas", error);
      return errorText(error);
    }
    if (added.length < titles.length) {
      releaseIdeas();
      return "Couldn't add the ideas to the Board.";
    }
  }
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known || known.stage !== "ready") return current;
    let next = withCard(current, markResearchRead(known, now, added.length));
    added.forEach((idea, index) => {
      next = withIdea(next, idea.id, {
        at: now + index,
        size: "medium",
        why: `From ${who}'s findings for “${known.title}”`,
        // Its words came from what the Researcher read: it waits for you.
        outside: true,
        by: "researcher",
      });
    });
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: known.title,
      text: added.length
        ? `You added ${plural(added.length, "idea")} from ${who}'s findings for “${known.title}”: ${added
            .map((idea) => idea.title)
            .join(" · ")}`
        : `You read ${who}'s findings for “${known.title}”`,
    });
  });
  releaseIdeas();
  await moveFeatureCard(path, cardId, "shipped", "");
  return null;
}

/** You read the findings and want none of its ideas: the card is done. */
export async function dismissResearch(
  path: string,
  cardId: string,
  now = Date.now(),
): Promise<string | null> {
  return addResearchIdeas(path, cardId, [], now);
}

// ---------------------------------------------------------------------------
// Work a member took down in its own chat

/** Whether a member's reply was already queued or set as the goal. */
export function memberAskTaken(
  crew: Pick<Crew, "asks"> | undefined,
  replyId: string,
): boolean {
  return !!crew?.asks?.includes(replyId);
}

/** Marks a reply as taken, once; false when it already was. */
function takeAsk(path: string, replyId: string): boolean {
  let fresh = false;
  updateCrew(path, (crew) => {
    if (memberAskTaken(crew, replyId)) return crew;
    fresh = true;
    return { ...crew, asks: [...(crew.asks ?? []), replyId].slice(-50) };
  });
  return fresh;
}

/**
 * Queue these: the cards a member took down from your words in its chat
 * (its `aven-tasks` block) go to the crew, marked as from that member. Only
 * ever from your press, and once per reply. Resolves with why it couldn't,
 * or null.
 */
export async function queueMemberTasks(
  path: string,
  memberId: string,
  replyId: string,
  tasks: readonly { title: string; why?: string }[],
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  if (!crewMemberById(crew, memberId))
    return "That helper isn't with Avos any more.";
  if (!tasks.length) return null;
  if (!takeAsk(path, replyId)) return null;
  const added: FeatureCard[] = [];
  for (const task of tasks) {
    const card = await addFeatureIdea(path, {
      title: task.title,
      ...(task.why ? { note: task.why } : {}),
    });
    if (!card) return "Couldn't add the card to the Board.";
    added.push(card);
  }
  updateCrew(path, (current) => {
    let next = current;
    for (const [index, card] of added.entries()) {
      const task = tasks[index]!;
      // It started by itself while the Board added the rest: it goes on.
      const known = crewCard(next, card.id);
      if (known && known.stage !== "applied" && known.stage !== "discarded")
        continue;
      next = withCard(
        withoutCard(next, card.id),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: [card.title, task.why].filter(Boolean).join("\n\n"),
            // The member's words for what you asked: read as data.
            from: "member",
            fromMember: memberId,
            maxRounds: current.limits.roundsPerCard,
          },
          now,
        ),
      );
    }
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      member: memberId,
      text: `You queued ${added.length === 1 ? "the card" : `${added.length} cards`} ${crewMemberName(current, memberId)} took down in its chat: ${added
        .map((card) => card.title)
        .join(" · ")}`,
    });
  });
  for (const card of added)
    await moveFeatureCard(path, card.id, "building", "");
  return null;
}

/**
 * Set as goal: the goal a member took down from your words in its chat
 * becomes the crew's, from your press. It replaces a goal you set yourself
 * only with `replace` (you said so).
 */
export function setMemberGoal(
  path: string,
  memberId: string,
  replyId: string,
  goal: string,
  options: { replace?: boolean } = {},
  now = Date.now(),
): string | null {
  const crew = getCrew(path);
  if (!crew?.on) return AVOS_ASLEEP;
  if (!crewMemberById(crew, memberId))
    return "That helper isn't with Avos any more.";
  if (yourGoal(crew) && !options.replace)
    return "Avos already has your goal. Replace it to use this one.";
  if (!takeAsk(path, replyId)) return null;
  updateCrew(path, (current) =>
    withGoal(
      current,
      goal,
      now,
      memberId,
      crewMemberName(current, memberId),
      options.replace,
    ),
  );
  return null;
}

/** Not now: a Scout idea stays in Ideas and never starts by itself. */
export function notNowIdea(path: string, cardId: string) {
  updateCrew(path, (crew) => {
    const idea = crew.ideas?.[cardId];
    const next =
      idea && !idea.declined
        ? withIdea(crew, cardId, { ...idea, declined: true })
        : crew;
    return withNotNow(next, cardId, true);
  });
}

/** Ideas you said Not now to wait in Ideas; Build it takes one off the list. */
function withNotNow(crew: Crew, cardId: string, held: boolean): Crew {
  const list = crew.notNow ?? [];
  if (list.includes(cardId) === held) return crew;
  const notNow = held
    ? [...list, cardId].slice(-200)
    : list.filter((id) => id !== cardId);
  return { ...crew, notNow: notNow.length ? notNow : undefined };
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
      cardSteppedAside(card)
        ? againFromTheTop(crew, card, note, now)
        : resumeCard(card, { note, now }),
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
          : cardTriesAgain(card) || cardSteppedAside(card)
            ? `Trying “${card.title}” again`
            : `One more round on “${card.title}”`,
    });
  });
  void moveFeatureCard(path, cardId, "building", "");
}

/**
 * A card that stepped aside (it changed nothing) goes again from the top:
 * first in line, built afresh on whatever the team has now, with your words
 * (and the question they answer) for its Builder.
 */
function againFromTheTop(
  crew: Crew,
  card: CrewCard,
  note: string | undefined,
  now: number,
): CrewCard {
  // Your words whole; the question they answer in what room is left.
  const words = note?.replace(/\s+/g, " ").trim().slice(0, CREW_NOTE_MAX);
  const question =
    card.stuck?.reason === "question"
      ? card.stuck.text.replace(/^[^:]*asked: /, "")
      : "";
  const room = CREW_NOTE_MAX - (words?.length ?? 0) - 30;
  const asked =
    question && room > 20
      ? question.length > room
        ? `${question.slice(0, room - 1)}…`
        : question
      : "";
  const said = words
    ? asked
      ? `You asked: ${asked} Their answer: ${words}`
      : words
    : undefined;
  const first = Math.min(
    now,
    ...queuedCards(crew).map((item) => item.queuedAt),
  );
  return {
    ...card,
    stage: "queued",
    round: 0,
    rounds: [],
    holder: undefined,
    stuck: undefined,
    base: undefined,
    fix: undefined,
    granted: undefined,
    startedAt: undefined,
    endedAt: undefined,
    queuedAt: first - 1,
    note: said?.slice(0, CREW_NOTE_MAX),
    updatedAt: now,
  };
}

const NOT_READY = "This card is no longer ready.";
const STILL_WORKING = "Avos is still working. Apply once it finishes.";

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
  // On the crew's branch: it lands only as part of the batch you reviewed.
  if (card?.stage === "ready" && card.stacked) return REVIEW_FIRST;
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
    let next = withGoalCardDropped(
      withCard(
        current,
        withInboxResolved(markDiscarded(known, now), "dismissed", now),
      ),
      known,
    );
    const idea = next.ideas?.[cardId];
    if (idea) next = withIdea(next, cardId, { ...idea, declined: true });
    // Back in Ideas, it waits there: it doesn't build by itself again.
    if (then === "ideas") next = withNotNow(next, cardId, true);
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

const NOT_ON_BRANCH = "That card isn't on Avos's branch any more.";
const BRANCH_MOVED = "Avos's branch changed since you looked. Review it again.";
/** Said when an Apply didn't say exactly what it reviewed. */
export const REVIEW_FIRST =
  "Review Avos's branch first: Apply lands exactly the change you reviewed.";
/** Said when the crew is at work in its copy. */
const CREW_AT_WORK =
  "Avos is at work in its copy. Try again once its turn ends.";

/**
 * Why an Apply clashed with your files, in words that say what to do. A
 * file Avos adds that your folder already has outside Git can't be fixed by
 * updating Avos's branch (its copy never sees such files), so that says
 * which file instead of offering the update.
 */
export function applyConflictText(error: unknown): string {
  const found = [
    ...new Set(
      [
        ...errorText(error).matchAll(
          /([^\s:]+): already exists in working directory/g,
        ),
      ].map((match) => match[1]!),
    ),
  ];
  if (!found.length)
    return "Your files changed where Avos worked, so nothing was applied. Update Avos's branch onto your files, then Apply again.";
  const one = found.length === 1;
  const names = found.slice(0, 3).join(", ") + (found.length > 3 ? "…" : "");
  return `Nothing was applied: Avos's change adds ${names}, and your folder already has ${one ? "a file" : "files"} by that name that Git doesn't track. Commit or move ${one ? "it" : "them"} aside, then Apply again.`;
}

/** Where the batch ends: at `upTo` (a card's id), else its last card. */
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

/** The batch's cards up to the one whose commit is `to`. */
function batchTo(batch: CrewBatch, to: string): CrewCard[] | null {
  const at = batch.cards.findIndex((card) => card.stacked?.commit === to);
  return at < 0 ? null : batch.cards.slice(0, at + 1);
}

/** A card a restack replayed onto your files, not checked again since. */
export function cardReplayed(card: CrewCard): boolean {
  return card.stacked?.replayed === true;
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
 * change you saw, named by its last commit (`to`) and fingerprint (`hash`),
 * and every card in it the change its checks passed. A card a restack
 * replayed lands only from the batch's Review (`reviewed`). Settings an app
 * would run as you are never applied this way, and a conflict with your
 * files changes nothing: the crew's branch can be updated onto them.
 * Resolves with why it couldn't, or null once applied.
 */
export async function applyCrewBatch(
  path: string,
  shown: { to: string; hash: string; reviewed?: boolean },
  now = Date.now(),
): Promise<string | null> {
  if (!shown.to || !shown.hash) return REVIEW_FIRST;
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  if (!crew?.copy || !batch) return NOT_ON_BRANCH;
  const cards = batchTo(batch, shown.to);
  if (!cards) return BRANCH_MOVED;
  if (!shown.reviewed && cards.some(cardReplayed)) return REVIEW_FIRST;
  const chain = cards.map((card) => ({
    commit: card.stacked!.commit,
    hash: stackedHash(card) ?? "",
  }));
  if (chain.some((card) => !card.hash)) return REVIEW_FIRST;
  const copy = crew.copy;
  let range: BotDiff;
  try {
    range = await botCopyHost.range(copy.path, batch.from, shown.to);
  } catch (error) {
    logError("Apply crew batch", error);
    return botCopyError(error);
  }
  if (shown.hash !== range.hash) return BRANCH_MOVED;
  const guarded = protectedFixPaths(range.files.map((file) => file.path));
  if (guarded.length)
    return `Aven didn't apply this: it changes settings or hooks that could run commands as you (${guarded.join(", ")}). Take it over in a chat to apply that part yourself.`;
  try {
    await botCopyHost.applyRange(
      path,
      copy.path,
      batch.from,
      shown.to,
      shown.hash,
      chain,
    );
  } catch (error) {
    if (isFixChanged(error)) return BRANCH_MOVED;
    logError("Apply crew batch", error);
    if (!/conflict/i.test(errorText(error))) return botCopyError(error);
    const text = applyConflictText(error);
    updateCrew(path, (current) =>
      current.stack
        ? { ...current, stack: { ...current.stack, conflict: text } }
        : current,
    );
    return text;
  }
  const to = shown.to;
  const applied = new Set(cards.map((card) => card.id));
  updateCrew(path, (current) => {
    let next: Crew = current;
    for (const card of current.cards)
      if (applied.has(card.id))
        next = withCard(
          next,
          withInboxResolved(markApplied(card, now), "done", now),
        );
    const left = stackedCards({ ...next, stack: { base: to } }).length;
    next = { ...next, stack: left ? { base: to } : undefined };
    if (!next.stack) delete next.stack;
    const only = cards.length === 1 ? cards[0] : undefined;
    return withFeed(next, {
      at: now,
      kind: "applied",
      who: "you",
      ...(only ? { cardId: only.id, title: only.title } : {}),
      text: only
        ? `Applied “${only.title}” to your files`
        : `Applied ${cards.length} cards to your files: ${cards
            .map((card) => card.title)
            .join(" · ")}`,
    });
  });
  notifyGitChanged(path);
  for (const card of cards) await moveFeatureCard(path, card.id, "shipped", "");
  return null;
}

/**
 * Send the batch, or up to one of its cards, as a pull request instead of
 * applying it: exactly the change you reviewed (`to`, `hash`), which Aven
 * puts on the project's main branch as one commit, pushes to a new `avos/`
 * branch and opens a pull request from. Avos itself never pushes, and your
 * files stay as they are. Its cards leave Avos's branch as sent, each
 * keeping the pull request's address. Resolves with that address, or why
 * it couldn't.
 */
export async function openCrewBatchPr(
  path: string,
  shown: { to: string; hash: string },
  now = Date.now(),
): Promise<{ url: string } | { error: string }> {
  if (!shown.to || !shown.hash) return { error: REVIEW_FIRST };
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  if (!crew?.copy || !batch) return { error: NOT_ON_BRANCH };
  const cards = batchTo(batch, shown.to);
  if (!cards) return { error: BRANCH_MOVED };
  const chain = cards.map((card) => ({
    commit: card.stacked!.commit,
    hash: stackedHash(card) ?? "",
  }));
  if (chain.some((card) => !card.hash)) return { error: REVIEW_FIRST };
  const copy = crew.copy;
  let range: BotDiff;
  try {
    range = await botCopyHost.range(copy.path, batch.from, shown.to);
  } catch (error) {
    logError("Crew pull request", error);
    return { error: botCopyError(error) };
  }
  if (shown.hash !== range.hash) return { error: BRANCH_MOVED };
  const guarded = protectedFixPaths(range.files.map((file) => file.path));
  if (guarded.length)
    return {
      error: `Aven didn't send this: it changes settings or hooks that could run commands as you (${guarded.join(", ")}). Take it over in a chat to send that part yourself.`,
    };
  const text = prText(cards);
  let url: string;
  try {
    url = await botCopyHost.publishRange(
      path,
      copy.path,
      batch.from,
      shown.to,
      shown.hash,
      chain,
      { branch: prBranch(text.title, now), ...text },
    );
  } catch (error) {
    if (isFixChanged(error)) return { error: BRANCH_MOVED };
    logError("Crew pull request", error);
    const why = errorText(error);
    return {
      error: /doesn't fit/.test(why)
        ? why
        : `Couldn't open the pull request: ${why}`,
    };
  }
  const sent = new Set(cards.map((card) => card.id));
  const to = shown.to;
  updateCrew(path, (current) => {
    let next: Crew = current;
    for (const card of current.cards)
      if (sent.has(card.id))
        next = withCard(
          next,
          withInboxResolved(
            { ...markApplied(card, now), pr: url },
            "done",
            now,
          ),
        );
    const left = stackedCards({ ...next, stack: { base: to } }).length;
    next = { ...next, stack: left ? { base: to } : undefined };
    if (!next.stack) delete next.stack;
    const only = cards.length === 1 ? cards[0] : undefined;
    return withFeed(next, {
      at: now,
      kind: "applied",
      who: "you",
      ...(only ? { cardId: only.id, title: only.title } : {}),
      text: only
        ? `Opened a pull request for “${only.title}”`
        : `Opened a pull request for ${cards.length} cards: ${cards
            .map((card) => card.title)
            .join(" · ")}`,
    });
  });
  for (const card of cards) await moveFeatureCard(path, card.id, "shipped", "");
  return { url };
}

/**
 * Try it: run Avos's version, while its copy holds exactly the change you
 * reviewed (`to`, `hash`) and nothing Apply would refuse, on its own port.
 * Aven runs it, not an agent, from a fresh checkout of that commit with
 * freshly installed packages: nothing git ignores in the copy, and none of
 * your keys or `.env` files. Only on a Mac for now. Resolves with its
 * address once it answers, or why it couldn't.
 */
export async function tryCrewBatch(
  path: string,
  shown: { to: string; hash: string },
): Promise<{ url: string } | { error: string }> {
  if (!shown.to || !shown.hash) return { error: REVIEW_FIRST };
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  if (!crew?.copy || !batch) return { error: NOT_ON_BRANCH };
  const cards = batchTo(batch, shown.to);
  if (!cards) return { error: BRANCH_MOVED };
  const chain = cards.map((card) => ({
    commit: card.stacked!.commit,
    hash: stackedHash(card) ?? "",
  }));
  if (chain.some((card) => !card.hash)) return { error: REVIEW_FIRST };
  try {
    return await botCopyHost.serve(
      crew.copy.path,
      batch.from,
      shown.to,
      shown.hash,
      chain,
    );
  } catch (error) {
    if (isFixChanged(error)) return { error: BRANCH_MOVED };
    logError("Try Avos's copy", error);
    return { error: errorText(error) };
  }
}

/** Stop running Avos's copy for Try it, if it runs. */
export function stopCrewTry(path: string): Promise<void> {
  const copy = getCrew(path)?.copy?.path;
  return copy
    ? botCopyHost.serveStop(copy).catch((error) => {
        logError("Stop Avos's copy", error);
      })
    : Promise.resolve();
}

/**
 * Ask Avos for changes to the work you're reviewing: your words become a
 * card that builds on top of Avos's branch, told what it changes, and is
 * checked like any other before it joins the batch. Resolves with why it
 * couldn't, or null.
 */
export function askAvosForChanges(
  path: string,
  words: string,
  titles: readonly string[],
  now = Date.now(),
): Promise<string | null> {
  const named = titles.map((title) => `“${title}”`).join(", ");
  return tellTeam(
    path,
    words,
    "card",
    now,
    undefined,
    named
      ? `This asks for changes to ${named}, which ${titles.length === 1 ? "waits" : "wait"} on Avos's branch for review: change it there, on top of it.`
      : undefined,
  );
}

/** The card the crew is at work on (or that waits on you) builds on its branch. */
const BUILDS_ON_TOP = (title: string) =>
  `“${title}” builds on top of Avos's branch. Finish it or throw it away first.`;

/**
 * Take the top card off the crew's branch (Back to Ideas or Throw away):
 * the branch goes back to the card before it. Only the top card, and only
 * while no card builds on top of it.
 */
export function dropStackedCard(
  path: string,
  cardId: string,
  then: "ideas" | "delete",
  now = Date.now(),
): Promise<string | null> {
  return holdingCrewJob(path, now, () =>
    dropStackedCardHeld(path, cardId, then, now),
  );
}

let branchHolds = 0;

/**
 * Hold the crew's job (its copy) for as long as `work` moves the crew's
 * branch, so the runner starts nothing in the copy meanwhile: renewed while
 * it runs, and let go however it ends. Says the crew is at work when it
 * holds the copy itself.
 */
async function holdingCrewJob(
  path: string,
  now: number,
  work: () => Promise<string | null>,
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew) return NOT_ON_BRANCH;
  branchHolds += 1;
  const owner = `branch-${branchHolds}-${now}`;
  // Claimed on or off: off, no runner works in the copy, but another window
  // (or a second press here) may move the branch, and two moves at once
  // would tread on each other.
  if (!claimCrewJob(path, owner, now, true)) return CREW_AT_WORK;
  const renew = setInterval(() => renewCrewJob(path, owner), 30_000);
  try {
    return await work();
  } finally {
    clearInterval(renew);
    releaseCrewJob(path, owner);
  }
}

async function dropStackedCardHeld(
  path: string,
  cardId: string,
  then: "ideas" | "delete",
  now: number,
): Promise<string | null> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  const card = batch?.cards.at(-1);
  if (!crew?.copy || !batch || !card) return NOT_ON_BRANCH;
  if (card.id !== cardId)
    return "Only the last card on Avos's branch can come off it.";
  const busy = cardInCopy(crew);
  if (busy) return BUILDS_ON_TOP(busy.title);
  try {
    // Only while the branch is still at this card: nothing stacked since
    // is thrown away with it.
    await botCopyHost.discard(
      crew.copy.path,
      card.stacked!.parent,
      crew.copy.branch,
      card.stacked!.commit,
    );
  } catch (error) {
    logError("Drop crew card", error);
    return botCopyError(error);
  }
  updateCrew(path, (current) => {
    const known = crewCard(current, cardId);
    if (!known) return current;
    let next = withGoalCardDropped(
      withCard(
        current,
        withInboxResolved(
          { ...markDiscarded(known, now), stacked: undefined },
          "dismissed",
          now,
        ),
      ),
      known,
    );
    if (!stackedCards(next).length) {
      next = { ...next };
      delete next.stack;
    } else if (next.stack?.conflict) {
      // What conflicted may have been this card: Apply finds out again.
      next = { ...next, stack: { base: next.stack.base } };
    }
    const idea = next.ideas?.[cardId];
    if (idea) next = withIdea(next, cardId, { ...idea, declined: true });
    // Back in Ideas, it waits there: it doesn't build by itself again.
    if (then === "ideas") next = withNotNow(next, cardId, true);
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "you",
      cardId,
      title: known.title,
      text:
        then === "ideas"
          ? `“${known.title}” came off Avos's branch and went back to Ideas`
          : `You took “${known.title}” off Avos's branch and threw it away`,
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
export function restackCrew(
  path: string,
  now = Date.now(),
): Promise<string | null> {
  return holdingCrewJob(path, now, () => restackCrewHeld(path, now));
}

async function restackCrewHeld(
  path: string,
  now: number,
): Promise<string | null> {
  const crew = getCrew(path);
  const batch = crewBatch(crew);
  if (!crew?.copy || !batch) return NOT_ON_BRANCH;
  const busy = cardInCopy(crew);
  if (busy) return BUILDS_ON_TOP(busy.title);
  let moved: { base: string; commits: string[]; hashes: string[] };
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
      const hash = moved.hashes[index];
      if (!known || !commit || !hash) return;
      // Replayed onto your files, each card is no longer exactly what its
      // checks passed: its Apply goes through Review.
      next = withCard(next, {
        ...known,
        stacked: { commit, parent, hash, replayed: true },
      });
      parent = commit;
    });
    return withFeed(next, {
      at: now,
      kind: "note",
      who: "aven",
      text: `Updated Avos's branch onto your files (${batch.cards.length} ${batch.cards.length === 1 ? "card" : "cards"}): replayed, not checked again, so Review them before you apply`,
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
  if (card.stage === "ready") return "Avos's Ready change is thrown away too.";
  if (card.stage === "queued") return "It leaves Avos's queue too.";
  return "Avos's work on it is thrown away too.";
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
  | "builder"
  | "checker"
  | "security"
  | "scout"
  | "researcher"
  | "designer"
  | "custom";

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
  /**
   * False hands its model and effort back to Avos to pick for each job;
   * picking a model or effort yourself makes it yours.
   */
  chosen?: boolean;
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

const HELPERS_FULL = "Avos has at most 8 helpers.";

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
  if (!crew) return { error: "This project has no Avos yet." };
  const role: Exclude<CrewRole, "fixer"> =
    template === "custom" ? (input.role ?? "builder") : template;
  if (
    (role === "scout" ||
      role === "security" ||
      role === "researcher" ||
      role === "designer") &&
    crew.members.some((member) => member.role === role)
  )
    return {
      error: `This team already has ${
        role === "scout"
          ? "a Scout"
          : role === "researcher"
            ? "a Researcher"
            : role === "designer"
              ? "a Designer"
              : "Security"
      }.`,
    };
  if (crew.members.filter((member) => member.role !== "fixer").length >= 8)
    return { error: HELPERS_FULL };
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
    const next = { ...current, members: [...current.members, member] };
    // Said in Avos's chat, so you see who joined.
    return withFeed(next, {
      at: Date.now(),
      kind: "note",
      who: "aven",
      member: id,
      text: `${crewMemberName(next, id)} has been added to the team.`,
    });
  });
  return { id };
}

/**
 * Change a member's settings. Its app can only be one that enforces its
 * rules; none of these change what it may do (its sandbox, rules and copy
 * come from its role alone). Resolves with why it couldn't, or null.
 */
/** Set or clear a teammate's routine. A new one first runs at the next look. */
export function updateCrewRoutine(
  path: string,
  id: string,
  routine: CrewRoutine | null,
) {
  updateCrew(path, (current) =>
    withMemberId(current, id, (member) => {
      const { routine: _old, ...rest } = member;
      return routine ? { ...rest, routine } : rest;
    }),
  );
}

export function updateCrewMember(
  path: string,
  id: string,
  change: CrewMemberChange,
): string | null {
  const crew = getCrew(path);
  const member = crew ? crewMemberById(crew, id) : undefined;
  if (!crew || !member) return "That helper isn't with Avos any more.";
  if (member.role === "fixer") return "The Fixer is set in its own settings.";
  if (change.harness !== undefined && !crewAgentAllowed(change.harness))
    return "Teams run only on apps that keep their rules: Claude Code or Codex.";
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
      // Picking its model or effort yourself is choosing; Let Avos choose
      // hands them back.
      if (change.chosen === false) set("chosen", undefined);
      else if (
        change.chosen === true ||
        (change.model !== undefined && change.model !== null) ||
        (change.effort !== undefined && change.effort !== null)
      )
        set("chosen", true);
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
  return crew.members.some((member) => memberIsPreset(member, preset));
}

/**
 * Whether a member is that ready-made one (see `presetInCrew`). A key alone
 * isn't enough: the Designer's key once named a Builder preset, and a member
 * made from that is still a Builder, not the Designer.
 */
export function memberIsPreset(
  member: CrewMember,
  preset: CrewPreset,
): boolean {
  return (
    (member.preset === preset.key && member.role === preset.role) ||
    (preset.role === "security" && member.role === "security") ||
    (preset.role === "scout" && member.role === "scout") ||
    (!preset.label &&
      member.role === preset.role &&
      !member.label &&
      memberCritter(member) === preset.mark)
  );
}

/** A ready-made teammate added to the team (no checks: the callers make them). */
function withPreset(
  crew: Crew,
  preset: CrewPreset,
  app?: { harness?: string; model?: string },
): Crew {
  const harness =
    app?.harness &&
    crewAgentAllowed(app.harness) &&
    crewAgentsFor(preset.role).includes(app.harness)
      ? app.harness
      : undefined;
  const model = harness ? cleanText(app?.model, 200) : undefined;
  const member: CrewMember = {
    id: newMemberId(crew, preset.role),
    role: preset.role,
    preset: preset.key,
    critter: freeMark(crew, preset.mark),
    ...(preset.label ? { label: preset.label, job: preset.job } : {}),
    instructions: preset.instructions,
    ...(preset.scope?.length ? { scope: [...preset.scope] } : {}),
    ...(harness ? { harness } : {}),
    ...(model ? { model } : {}),
  };
  return { ...crew, members: [...crew.members, member] };
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
  if (presetInCrew(crew, preset))
    return { error: "It's helping Avos already." };
  if (crew.members.filter((member) => member.role !== "fixer").length >= 8)
    return { error: HELPERS_FULL };
  if (
    (preset.role === "scout" ||
      preset.role === "lead" ||
      preset.role === "security" ||
      preset.role === "researcher" ||
      preset.role === "designer") &&
    crew.members.some((member) => member.role === preset.role)
  )
    return { error: "It's helping Avos already." };
  let id = "";
  updateCrew(path, (current) => {
    id = newMemberId(current, preset.role);
    return withPreset(current, preset, app);
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
    return `Avos needs a ${CREW_ROLE_INFO[member.role].label}.`;
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
    return `“${holding.title}” is still in Avos's copy. Apply it, send it back to Ideas or throw it away first.`;
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

/**
 * A teammate's notes, as you edited them (the Fixer's included): replaced,
 * or cleared with null or nothing. Resolves with why it couldn't, or null.
 */
export function setMemberMemory(
  path: string,
  id: string,
  memory: string | null,
  now = Date.now(),
): string | null {
  const crew = getCrew(path);
  if (!crew || !crewMemberById(crew, id))
    return "That helper isn't with Avos any more.";
  updateCrew(path, (current) => withMemberMemory(current, id, memory, now));
  return null;
}

/** What the team may do without stopping to ask you. */
export function setCrewAccess(path: string, patch: Partial<CrewAccess>) {
  updateCrew(path, (crew) => ({
    ...crew,
    access: { ...crew.access, ...patch },
  }));
}

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
  /**
   * Show a member's chat in a tab: by its id, or a role for its first.
   * Resolves with why it couldn't (the team is off, its chat hasn't
   * started yet), or null once the chat is on screen.
   */
  openChat: (path: string, who: string) => Promise<string | null> | void;
  /**
   * A helper's chat beside Avos, in the same tab (a split), never instead
   * of it. Resolves with why it couldn't, or null.
   */
  openChatBeside?: (path: string, who: string) => Promise<string | null>;
  /** Open the crew: the project's Board with the crew on it. */
  openCrew: (path: string) => void;
  /**
   * Open the crew's settings (turning it on, when it is off); with "add",
   * at its gallery of members to add, or with a member's id, at that member.
   */
  openSettings: (path: string, page?: string) => void;
  /** Stop a chat's turn, and wait until it has. */
  stop: (sessionId: string) => Promise<void>;
  /**
   * Send your words to a member's own chat, as a message you typed there
   * (the Fixer's is the project bot's). Resolves with why it couldn't, or
   * null. Only the main workspace has it.
   */
  sendToMember?: (
    path: string,
    who: string,
    text: string,
  ) => Promise<string | null>;
  /**
   * Wake the project's Avos: turn it on (it needs Claude Code, not Git).
   * Resolves with why it couldn't, or null.
   */
  wake?: (path: string) => Promise<string | null>;
  /** What the project lacks before anything can be built in a copy of it. */
  gitNeeded?: (path: string) => Promise<"no-git" | "no-commit" | null>;
  /** Offer to set up Git for the project (its own dialog). */
  setUpGit?: (path: string) => void;
  /** Show one of your chats, by its id (a message's link back to it). */
  openSession?: (sessionId: string) => void;
};

/**
 * Turn the project's Avos on if it's off, as writing to it does. Resolves
 * with why it couldn't, or null (also when there's no workspace to do it).
 */
export async function wakeAvos(path: string): Promise<string | null> {
  if (getCrew(path)?.on) return null;
  const wake = crewWorkspace()?.wake;
  return wake ? wake(path).catch((error) => errorText(error)) : null;
}

/**
 * Whether Avos's own jobs wait for your Build it (on) or start at once in
 * its copy (off, the default).
 */
/**
 * What new helpers run on: a model and effort, "avos" for Avos's pick per
 * job, or null for the default (Opus 5.5 · Medium).
 */
export function setCrewHelperModel(
  path: string,
  value: CrewHelperModel | null,
) {
  updateCrew(path, (crew) => {
    const { helperModel: _was, ...rest } = crew;
    return value ? { ...rest, helperModel: value } : rest;
  });
}

export function setCrewAskBeforeBuilding(path: string, on: boolean) {
  updateCrew(path, (crew) => {
    const { askBeforeBuilding: _was, ...rest } = crew;
    return on ? { ...rest, askBeforeBuilding: true } : rest;
  });
}

/**
 * Your answer to "Can Avos read this project?". Allowing it lets Avos wake;
 * taking it back turns Avos off, so nothing it runs reads the project.
 */
export async function setAvosReadAccess(path: string, allowed: boolean) {
  updateCrew(path, (crew) => ({
    ...crew,
    readAccess: allowed ? "allowed" : "declined",
  }));
  if (!allowed && getCrew(path)?.on) await turnOffCrew(path);
}

/** Avos's introduction, kept as its first lines, just before your answer. */
function keepAvosIntro(path: string, now: number) {
  const intro = avosIntro(projectAppearance(path).label || projectName(path));
  updateCrew(path, (crew) => {
    const lead = crewLead(crew);
    if (!lead || crew.feed.some((entry) => entry.kind === "say")) return crew;
    let next = crew;
    for (const [index, text] of [intro.hello, intro.ask].entries())
      next = withFeed(next, {
        at: now - 2 + index,
        kind: "say",
        who: "lead",
        member: lead.id,
        text,
      });
    return next;
  });
}

/** Said when Avos is off: writing to it, or opening it, wakes it. */
export const AVOS_ASLEEP = "Avos is off. Open Avos to wake it.";

/**
 * The helpers building needs, brought in by Avos when a card first needs
 * them: a Builder, and a Checker to look at its work. Returns the crew
 * when it changed.
 */
export function bringInBuilders(
  path: string,
  now = Date.now(),
  models: CrewModels = crewModelsHere(),
): Crew | null {
  const crew = getCrew(path);
  if (!crew) return null;
  const has = (role: CrewRole) =>
    crew.members.some((member) => member.role === role);
  const needed = (["builder", "checker"] as const).filter((role) => !has(role));
  if (!needed.length) return null;
  const names: string[] = [];
  const next = updateCrew(path, (current) => {
    let updated = current;
    for (const role of needed) {
      const preset = CREW_PRESETS.find((item) => item.key === role);
      if (!preset) continue;
      updated = withPreset(updated, preset, crewModelFor(models, role));
      names.push(crewMemberName(updated, updated.members.at(-1)!.id));
    }
    return names.length
      ? withFeed(updated, {
          at: now,
          kind: "note",
          who: "lead",
          text: `I brought in ${names.join(" and ")} to build this.`,
        })
      : updated;
  });
  return names.length ? next : null;
}

/** Said when building is asked for in a folder without Git. */
export const BUILDING_NEEDS_GIT =
  "Building happens in a copy of the project, which needs Git. Set up Git for this folder, then ask again.";

/**
 * Whether the project can build in a copy now. When it can't, Avos says so
 * once in its chat with Set up Git beside it, and this resolves with why.
 */
export async function buildingProblem(
  path: string,
  now = Date.now(),
): Promise<string | null> {
  const need = await crewWorkspace()
    ?.gitNeeded?.(path)
    .catch(() => null);
  if (!need) return null;
  const text =
    need === "no-git"
      ? BUILDING_NEEDS_GIT
      : "Building happens in a copy of the project, which needs at least one commit. Commit your files, then ask again.";
  updateCrew(path, (crew) => {
    const last = crew.feed.at(-1);
    return last?.text === text
      ? crew
      : withFeed(crew, {
          at: now,
          kind: "note",
          who: "lead",
          text,
          ...(need === "no-git" ? { action: "set-up-git" as const } : {}),
        });
  });
  return text;
}

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

// ---------------------------------------------------------------------------
// Tell the crew… from elsewhere (the sidebar): the crew's Board opens with
// the cursor in its Feed's box.

let tellFor: string | null = null;
/** The teammate the box should write to, when the request named one. */
let tellTo: string | null = null;
const tellListeners = new Set<() => void>();

const tellKey = (path: string) => projectKey(normalizeProjectPath(path));

/**
 * Ask the crew's Feed to put the cursor in its Tell the crew box, writing
 * to `to` (a member id) when given: a follow-up for the Researcher.
 */
export function focusCrewTell(path: string, to?: string) {
  tellFor = tellKey(path);
  tellTo = to ?? null;
  for (const listener of [...tellListeners]) listener();
}

/** The teammate a taken request named, once; null for everyone. */
export function takeCrewTellTo(): string | null {
  const to = tellTo;
  tellTo = null;
  return to;
}

/** The team's box takes a request for its team, once: true when there was one. */
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

let reviewFor: string | null = null;

/**
 * Open the batch's Review on the crew's Pipeline (from the Inbox): the
 * only way an Apply there knows exactly what you saw.
 */
export function requestCrewReview(path: string) {
  reviewFor = tellKey(path);
  for (const listener of [...tellListeners]) listener();
}

/** The Pipeline takes a Review request for its crew, once. */
export function takeCrewReview(path: string): boolean {
  if (reviewFor === null || reviewFor !== tellKey(path)) return false;
  reviewFor = null;
  return true;
}
