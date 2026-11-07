import { useEffect, useRef, useState } from "react";
import { reviewCrewBatch } from "../lib/crewActions";
import { stackedCards, type Crew, type CrewCard } from "../lib/crews";
import { logError } from "../lib/errors";
import { botCopyHost, type BotDiff } from "../lib/projectBotCopy";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import type { UnifiedDiffFileModel } from "../surfaces/UnifiedDiffView";

/** Text files shown line by line in a Review; every file is named either way. */
const PREVIEWED = 40;

/** The files a Review shows line by line: the first few dozen text files. */
export function previewedFiles(diff: BotDiff): BotDiff["files"] {
  return diff.files
    .filter((file) => !file.binary && file.newMode !== "120000")
    .slice(0, PREVIEWED);
}

export type CrewBatchReview = {
  diff: BotDiff;
  from: string;
  to: string;
  cards: CrewCard[];
};

/**
 * The batch on Avos's branch, read for its Review: the combined change up
 * to a card (`upTo`, else all of it), each file's lines, and whether what's
 * shown is exactly what an Apply would land (`shown`). A card stacked while
 * it's open is read again, and nothing can be applied until it has been.
 */
export function useCrewBatchReview(
  crew: Crew,
  project: string,
  upTo: string | undefined,
) {
  const [review, setReview] = useState<CrewBatchReview | null>(null);
  const [files, setFiles] = useState<UnifiedDiffFileModel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const copy = crew.copy?.path;
  // The branch's top: a card stacked while this is open is read again.
  const top = stackedCards(crew).at(-1)?.stacked?.commit;
  const readTop = useRef(top);
  const [rereading, setRereading] = useState(false);
  useEffect(() => {
    let live = true;
    // A new selection, or the branch moved: nothing is shown, so nothing
    // can be applied, until its own change has been read.
    setRereading(!upTo && readTop.current !== top);
    readTop.current = top;
    setReview(null);
    setFiles(null);
    void reviewCrewBatch(project, upTo)
      .then(async (found) => {
        if (!live) return;
        setRereading(false);
        if ("error" in found) {
          setProblem(found.error);
          setReview(null);
          return;
        }
        setReview(found);
        if (!copy) return;
        const models = await Promise.all(
          previewedFiles(found.diff).map(async (file) => {
            const texts = await botCopyHost
              .rangeFileDiff(copy, found.from, found.to, file.path)
              .catch(() => null);
            const unreadable =
              !texts ||
              file.binary ||
              (texts.original == null && file.status !== "added") ||
              (texts.current == null && file.status !== "deleted");
            const unified = unreadable
              ? null
              : buildUnifiedFile(texts.original ?? "", texts.current ?? "");
            return {
              id: file.path,
              path: file.path,
              label: file.path,
              binary: file.binary,
              emptyMessage: unreadable
                ? "No text preview for this file."
                : undefined,
              additions: unified?.additions ?? file.additions,
              deletions: unified?.deletions ?? file.deletions,
              blocks: unified?.blocks ?? [],
            } satisfies UnifiedDiffFileModel;
          }),
        );
        if (live) setFiles(models);
      })
      .catch((error) => {
        logError("Crew batch review", error);
        if (live) setFiles([]);
      });
    return () => {
      live = false;
    };
  }, [project, upTo, copy, top]);
  const order = stackedCards(crew);
  // The commit the selection ends at: Apply lands only a review of exactly it.
  const selected = (
    upTo ? order.find((card) => card.id === upTo) : order.at(-1)
  )?.stacked?.commit;
  const shown = !!review && review.to === selected;
  return {
    review,
    files,
    problem,
    setProblem,
    rereading,
    shown,
    order,
  };
}
