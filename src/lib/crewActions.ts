import { useSyncExternalStore } from "react";
import { crewInboxCard, withInboxResolved } from "./crewInbox";
import {
  changedAfterCheck,
  markApplied,
  markDiscarded,
  queueCard,
  resumeCard,
  stopCard,
} from "./crewLoop";
import {
  CREW_EXTRA_RUNS,
  bumpToday,
  cardInCopy,
  crewCard,
  crewMember,
  crewMemberName,
  getCrew,
  updateCrew,
  withCard,
  withFeed,
  withIdea,
  withMember,
  withNote,
  withoutCard,
  type Crew,
  type CrewCard,
  type CrewRole,
} from "./crews";
import { logError } from "./errors";
import {
  deleteFeatureCard,
  featureBrief,
  moveFeatureCard,
  type FeatureCard,
} from "./featureCards";
import { notifyGitChanged } from "./fs";
import { botCopyError, botCopyHost, isFixChanged } from "./projectBotCopy";
import { jobIsLive, type BotQuietHours } from "./projectBots";

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

/** Turn the crew on: its members get their models, and it starts working. */
export function turnOnCrew(path: string, models: CrewModels, now = Date.now()) {
  updateCrew(path, (crew) => {
    let next: Crew = { ...crew, on: true, onAt: now, paused: undefined };
    for (const role of ["builder", "checker", "scout"] as const)
      next = withMember(next, role, (member) => ({
        ...member,
        harness: models[role].harness,
        model: models[role].model,
      }));
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
    let next: Crew = { ...current, job: undefined };
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
  const scout = crew ? crewMember(crew, "scout") : undefined;
  if (scout?.doing && scout.sessionId)
    await crewWorkspace()
      ?.stop(scout.sessionId)
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

/** Tell the crew: standing guidance every bot reads at each turn. */
export function tellCrew(path: string, text: string, now = Date.now()) {
  updateCrew(path, (crew) => withNote(crew, text, now));
}

// ---------------------------------------------------------------------------
// Cards

/**
 * Give a Board card to the crew: it waits in Building as Queued, and starts
 * when the crew's copy is free. Resolves with why it couldn't, or null.
 */
export async function giveCardToCrew(
  path: string,
  card: Pick<FeatureCard, "id" | "title" | "note" | "sourceUrl">,
  now = Date.now(),
): Promise<string | null> {
  const crew = getCrew(path);
  if (!crew?.on) return "Turn the crew on first.";
  const known = crewCard(crew, card.id);
  if (known && known.stage !== "applied" && known.stage !== "discarded")
    return null;
  const idea = crew.ideas?.[card.id];
  updateCrew(path, (current) =>
    withFeed(
      withCard(
        withoutCard(current, card.id),
        queueCard(
          {
            id: card.id,
            title: card.title,
            brief: featureBrief(card),
            from: idea ? "scout" : "you",
            ...(idea ? { size: idea.size } : {}),
            ...(card.sourceUrl ? { sourceUrl: card.sourceUrl } : {}),
            maxRounds: current.limits.roundsPerCard,
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
        text: `You gave the crew “${card.title}”`,
      },
    ),
  );
  await moveFeatureCard(path, card.id, "building", "");
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
    return stopped === current
      ? crew
      : withFeed(withCard(crew, stopped), {
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
  updateCrew(path, (crew) => {
    const card = crewCard(crew, cardId);
    if (!card || (card.stage !== "stuck" && card.stage !== "ready"))
      return crew;
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
    const checker = crewMemberName(crew, "checker");
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
  if (!crew?.copy || !card || card.stage !== "ready" || !card.fix)
    return NOT_READY;
  if (card.turn || jobIsLive(crew.job, now)) return STILL_WORKING;
  const fix = card.fix;
  try {
    await botCopyHost.apply(path, crew.copy.path, fix.base, fix.hash);
  } catch (error) {
    if (isFixChanged(error)) {
      await markCrewFixChanged(path, cardId, now);
      return `The change moved after ${crewMemberName(crew, "checker")}'s check, so it wasn't applied. One more round checks it again.`;
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
// What the crew UI needs from the main workspace, supplied by App.

export type CrewWorkspace = {
  /** Show a member's chat in a tab. */
  openChat: (path: string, role: CrewRole) => void;
  /** Open the crew: the project's Board with the crew on it. */
  openCrew: (path: string) => void;
  /** Open the crew's settings (turning it on, when it is off). */
  openSettings: (path: string) => void;
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
