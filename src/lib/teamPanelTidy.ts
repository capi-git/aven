/**
 * Keeping the window's floating team panel to live work:
 *
 * - A race that was kept or discarded says so on its pill for a moment,
 *   then the pill goes; nothing about it is left to watch.
 * - A finished discussion's panel shrinks to its pill once its plan is sent
 *   to build, or when it floats over a view that shows neither of its chats
 *   (Home, the board, another chat). A running one is left as it is.
 */
import type { Discussion } from "./discussions";
import type { RaceRecord } from "./race";
import { teamIdOf, teamKeyOf, teamKindOf } from "./teamRuns";
import type { TeamPanelState } from "./teamWatch";

/** How long a kept or discarded race's pill says so before it goes. */
export const ENDED_RACE_PILL_MS = 4_000;

/**
 * The races shown here as pills (watched, and neither the open panel nor
 * popped out) that ended: due once each has said how it ended for
 * `ENDED_RACE_PILL_MS`, counted from when it ended or from when it first
 * showed as a pill (`shownSince`), whichever is later. `next` is when the
 * next one is due, or null.
 */
export function endedRacePills(
  state: Pick<TeamPanelState, "watching" | "expanded" | "popped">,
  races: readonly Pick<RaceRecord, "id" | "state" | "finishedAt">[],
  shownSince: ReadonlyMap<string, number>,
  now: number,
): { ended: string[]; due: string[]; next: number | null } {
  const ended: string[] = [];
  const due: string[] = [];
  let next: number | null = null;
  for (const id of state.watching) {
    if (
      teamKindOf(id) !== "race" ||
      id === state.expanded ||
      state.popped.includes(id)
    )
      continue;
    const race = races.find((entry) => entry.id === teamKeyOf(id));
    if (!race || race.state === "running") continue;
    ended.push(id);
    const at =
      Math.max(race.finishedAt ?? 0, shownSince.get(id) ?? now) +
      ENDED_RACE_PILL_MS;
    if (at <= now) due.push(id);
    else next = next === null ? at : Math.min(next, at);
  }
  return { ended, due, next };
}

/** What the open panel showed when last looked at. */
export type FinishedPanelLook = {
  id: string;
  ended: boolean;
  /** The sides its plan was sent to for this ending, as one key. */
  built: string;
  /** The chats on screen, as one key. */
  view: string;
};

/** The panel's discussion as `finishedPanelShrinks` reads it. */
export function finishedPanelLook(
  expanded: string | null,
  discussions: readonly Discussion[],
  view: string,
): (FinishedPanelLook & { shows: boolean }) | null {
  if (!expanded || teamKindOf(expanded) !== "discuss") return null;
  const discussion = discussions.find(
    (entry) => teamIdOf("discuss", entry.id) === expanded,
  );
  if (!discussion) return null;
  const onScreen = new Set(view ? view.split("\n") : []);
  return {
    id: expanded,
    ended: discussion.status === "ended",
    built: (["a", "b"] as const)
      .filter((side) => discussion.built?.[side] === discussion.settled)
      .join(""),
    view,
    shows:
      onScreen.has(discussion.a.sessionId) ||
      onScreen.has(discussion.b.sessionId),
  };
}

/**
 * Whether the open panel, a finished discussion, shrinks to its pill now:
 * its plan was just sent to build, or it ended, the view changed or the
 * window opened while neither of its chats is on screen. One the user just
 * opened stays open where they opened it. `before` is the last look, or
 * undefined when the window has only just opened.
 */
export function finishedPanelShrinks(
  before: FinishedPanelLook | null | undefined,
  now: (FinishedPanelLook & { shows: boolean }) | null,
): boolean {
  if (!now?.ended) return false;
  if (before === undefined) return !now.shows;
  if (!before || before.id !== now.id) return false;
  if (now.built !== before.built && now.built.length > before.built.length)
    return true;
  if (now.shows) return false;
  return !before.ended || before.view !== now.view;
}
