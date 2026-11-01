import { useEffect, useMemo, useState } from "react";
import {
  applyCrewBatch,
  restackCrew,
  reviewCrewBatch,
} from "../lib/crewActions";
import { allCrewRunsToday, crewHoldGate } from "../lib/crewLimits";
import {
  crewPipeline,
  type Pipeline,
  type PipelineBatch,
  type PipelineBoardCard,
} from "../lib/crewPipeline";
import { stackedCards, useCrewsAllRunsPerDay, type Crew } from "../lib/crews";
import { errorText } from "../lib/errors";
import { getProjectBot, runsToday } from "../lib/projectBots";
import { claudeWeeklyUsed } from "./useProjectBots";

/** What the batch shows of the branch: its last commit, fingerprint and files. */
export type BatchRange = { to: string; hash: string; files: number };

/**
 * The batch's range as the branch holds it now, read again whenever a card
 * is stacked or applied: what Apply all lands, and its files. Null while it
 * is read, or once its top moved on (so Apply waits).
 */
export function useBatchRange(project: string, crew: Crew): BatchRange | null {
  const top = stackedCards(crew).at(-1)?.stacked?.commit;
  const base = crew.stack?.base;
  const [range, setRange] = useState<BatchRange | null>(null);
  useEffect(() => {
    let live = true;
    if (!top) return;
    void reviewCrewBatch(project).then((found) => {
      if (!live) return;
      setRange(
        "error" in found
          ? null
          : {
              to: found.to,
              hash: found.diff.hash,
              files: found.diff.files.length,
            },
      );
    });
    return () => {
      live = false;
    };
  }, [project, top, base]);
  return range && range.to === top ? range : null;
}

/**
 * The team's Pipeline as both of its screens show it (Chat and Cards): the
 * one sentence, the batch and every card's row, worked out once.
 */
export function useTeamPipeline(input: {
  project: string;
  crew: Crew;
  cards: readonly PipelineBoardCard[];
  now: number;
  fixerRuns: number;
  name: (who: string) => string;
}): {
  view: Pipeline;
  range: BatchRange | null;
  /** The daily cap holds the team now: ⋯ offers to allow more. */
  dailyCap: boolean;
} {
  const { project, crew, cards, now, fixerRuns, name } = input;
  const allRunsCap = useCrewsAllRunsPerDay();
  const held = crewHoldGate({
    crew,
    now,
    weeklyUsed: claudeWeeklyUsed(now),
    fixerRuns,
    allRuns: allCrewRunsToday(now, (path) => {
      const bot = getProjectBot(path);
      return bot ? runsToday(bot, now) : 0;
    }),
    allRunsCap,
  });
  const range = useBatchRange(project, crew);
  const hold =
    held && held.gate.reason !== "paused" ? held.gate.title : undefined;
  const files = range?.files;
  const view = useMemo(
    () =>
      crewPipeline({
        crew,
        cards,
        now,
        name,
        fixerRuns,
        ...(hold ? { hold } : {}),
        ...(files != null ? { batchFiles: files } : {}),
      }),
    [crew, cards, now, name, fixerRuns, hold, files],
  );
  return { view, range, dailyCap: held?.gate.reason === "daily-cap" };
}

/** Whether a conflict says to update the branch onto your files (old words too). */
export function offersRestack(conflict: string | undefined): boolean {
  return !!conflict && /Update the (?:crew|team)'s branch/.test(conflict);
}

/**
 * Apply all for the batch, exactly as its row reads it (its last commit and
 * fingerprint), and Update onto your files after a conflict. The Cards row
 * and the chat's Ready for you both use this, so both land the same way.
 */
export function useBatchActions(
  crew: Crew,
  batch: PipelineBatch,
  range: BatchRange | null,
): {
  busy: boolean;
  /** Why it didn't land, or the branch's conflict. */
  problem: string | null;
  /** The problem offers Update onto your files. */
  restack: boolean;
  applyAll: () => void;
  update: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(null);
    const why = await work().catch((error) => errorText(error));
    setBusy(false);
    setProblem(why);
  };
  return {
    busy,
    problem: problem ?? batch.conflict ?? null,
    restack: offersRestack(batch.conflict),
    applyAll: () => {
      if (!range) return;
      void run(() =>
        applyCrewBatch(crew.path, { to: range.to, hash: range.hash }),
      );
    },
    update: () => void run(() => restackCrew(crew.path)),
  };
}
