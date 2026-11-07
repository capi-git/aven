import { useEffect, useRef, useState } from "react";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import { useBatchActions, type BatchRange } from "../hooks/useTeamPipeline";
import {
  applyCrewBatch,
  dropStackedCard,
  reviewCrewBatch,
} from "../lib/crewActions";
import { reviewFileNotes, type PipelineBatch } from "../lib/crewPipeline";
import { cardInCopy, stackedCards, type Crew } from "../lib/crews";
import { errorText, logError } from "../lib/errors";
import { botCopyHost, type BotDiff } from "../lib/projectBotCopy";
import { plural } from "../lib/words";
import { LazyUnifiedDiffView, prepareDiffView } from "./LazyUnifiedDiffView";
import type { UnifiedDiffFileModel } from "./UnifiedDiffView";
import "../chrome/TeamCard.css";
import "./TeamBatch.css";

/**
 * The batch on Avos's branch: its card on the Board, its buttons
 * (Review, Apply all) and its Review. The rest of the team's screen is in
 * `TeamScreen`.
 */

/**
 * The batch on the Board: one card at the top of Ready for you (its cards
 * aren't cards of their own), with Review and Apply all. Its title opens
 * Review too.
 */
export function BatchCard({
  crew,
  batch,
  range,
  onReview,
}: {
  crew: Crew;
  batch: PipelineBatch;
  range: BatchRange | null;
  onReview: () => void;
}) {
  const single = batch.cards.length === 1 ? batch.cards[0]! : undefined;
  return (
    <article
      className="work-board-card"
      data-crew-batch
      data-crew-stage="Ready"
      data-fixed
    >
      <button
        type="button"
        className="work-board-card-open"
        title="Review what lands in your files"
        onClick={onReview}
      >
        <span className="work-board-card-title">
          <span className="work-board-card-name">
            {single ? single.title : batch.title}
          </span>
        </span>
        <span className="crew-card-stage" data-tone="ready">
          <strong>Ready</strong>
          <span>
            {" "}
            ·{" "}
            {single
              ? batch.status.slice(single.title.length + 3)
              : batch.status}
          </span>
        </span>
      </button>
      <BatchButtons
        crew={crew}
        batch={batch}
        range={range}
        onReview={onReview}
        className="work-board-card-actions"
        problemClass="crew-card-problem"
      />
    </article>
  );
}

/**
 * The batch's Review and Apply all (or Review to apply, for a replayed
 * card), and why the last Apply didn't land, with Update onto your files.
 * The Board's batch card and the chat's Ready for you draw these.
 */
export function BatchButtons({
  crew,
  batch,
  range,
  onReview,
  className,
  problemClass,
}: {
  crew: Crew;
  batch: PipelineBatch;
  range: BatchRange | null;
  onReview: () => void;
  className: string;
  problemClass: string;
}) {
  const actions = useBatchActions(crew, batch, range);
  return (
    <>
      <div className={className}>
        {batch.reviewFirst ? (
          <TeamCardButton size="compact" variant="primary" onClick={onReview}>
            Review to apply
          </TeamCardButton>
        ) : (
          <>
            <TeamCardButton size="compact" onClick={onReview}>
              Review
            </TeamCardButton>
            <TeamCardButton
              size="compact"
              variant="primary"
              disabled={actions.busy || !range}
              onClick={actions.applyAll}
            >
              {actions.busy ? "Applying…" : "Apply all"}
            </TeamCardButton>
          </>
        )}
      </div>
      {actions.problem ? (
        <p className={problemClass} role="alert">
          {actions.problem}
          {actions.restack ? (
            <>
              {" "}
              <button
                type="button"
                className="crew-pipe-link"
                disabled={actions.busy}
                onClick={actions.update}
              >
                Update onto your files
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The batch's Review

/** Text files shown line by line in a Review; every file is named either way. */
const PREVIEWED = 40;

/**
 * Review the batch: the combined change it would land in your files, each
 * card's part of it, Apply all, Apply up to a card, and taking the last
 * card off the branch. Apply lands exactly the change shown here.
 */
export function CrewBatchSheet({
  crew,
  project,
  onClose,
}: {
  crew: Crew;
  project: string;
  onClose: () => void;
}) {
  const [upTo, setUpTo] = useState<string | undefined>();
  const [review, setReview] = useState<{
    diff: BotDiff;
    from: string;
    to: string;
    cards: { id: string; title: string }[];
  } | null>(null);
  const [files, setFiles] = useState<UnifiedDiffFileModel[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    const builder = prepareDiffView();
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
        const buildUnifiedFile = await builder;
        if (!live) return;
        const models = await Promise.all(
          found.diff.files
            .filter((file) => !file.binary && file.newMode !== "120000")
            .slice(0, PREVIEWED)
            .map(async (file) => {
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
  const ordered = review?.cards ?? [];
  const last = stackedCards(crew).at(-1);
  // The commit the selection ends at: Apply lands only a review of exactly it.
  const selected = (
    upTo
      ? stackedCards(crew).find((card) => card.id === upTo)
      : stackedCards(crew).at(-1)
  )?.stacked?.commit;
  const shown = !!review && review.to === selected;
  const apply = async () => {
    if (!review || !shown) return;
    setBusy(true);
    setProblem(null);
    // Exactly the change shown here: its last commit and fingerprint.
    const why = await applyCrewBatch(project, {
      to: review.to,
      hash: review.diff.hash,
      reviewed: true,
    }).catch((error) => errorText(error));
    setBusy(false);
    if (why) setProblem(why);
    else onClose();
  };
  const drop = async () => {
    if (!last) return;
    setBusy(true);
    setProblem(null);
    const why = await dropStackedCard(project, last.id, "ideas").catch(
      (error) => errorText(error),
    );
    setBusy(false);
    if (why) setProblem(why);
    else if (stackedCards(crew).length <= 1) onClose();
    else setUpTo(undefined);
  };
  const order = stackedCards(crew);
  return (
    <Modal
      onClose={onClose}
      title={`${plural(order.length, "card")} ready on Avos's branch`}
      description={
        review
          ? `${upTo ? `Up to ${ordered.at(-1)?.title}` : "All of them"} · ${plural(review.diff.files.length, "file")} · +${review.diff.additions} −${review.diff.deletions}`
          : "Reading the change…"
      }
      className="crew-sheet crew-batch"
    >
      <div className="crew-sheet-body" data-crew-batch-review>
        <section className="crew-sheet-section">
          <h3>Each card, checked on its own</h3>
          <ol className="crew-batch-cards">
            {order.map((card, index) => {
              const included =
                !upTo || order.findIndex((item) => item.id === upTo) >= index;
              return (
                <li key={card.id} data-included={included || undefined}>
                  <span className="crew-batch-card">
                    <span>{card.title}</span>
                    <span className="crew-batch-meta">
                      {card.fix
                        ? `${plural(card.fix.files, "file")} · +${card.fix.additions} −${card.fix.deletions}`
                        : ""}
                      {card.stacked?.replayed
                        ? " · replayed onto your files, not re-checked"
                        : card.rounds.some(
                              (round) =>
                                round.n === card.round && round.security,
                            )
                          ? " · checked and secured"
                          : " · checked"}
                    </span>
                  </span>
                  {index < order.length - 1 ? (
                    <button
                      type="button"
                      className="crew-pipe-link"
                      aria-pressed={upTo === card.id}
                      onClick={() =>
                        setUpTo(upTo === card.id ? undefined : card.id)
                      }
                    >
                      {upTo === card.id ? "Apply all" : "Apply up to here"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="crew-pipe-link"
                      disabled={busy || !!cardInCopy(crew)}
                      title={
                        cardInCopy(crew)
                          ? "A card builds on top of it: finish or throw it away first"
                          : undefined
                      }
                      onClick={() => void drop()}
                    >
                      Take it off the branch
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        {review ? (
          <section className="crew-sheet-section">
            <h3>{`Everything it changes · ${plural(review.diff.files.length, "file")}`}</h3>
            <ul className="crew-batch-files" data-crew-batch-files>
              {review.diff.files.map((file) => {
                const notes = reviewFileNotes(file);
                return (
                  <li key={file.path} data-flagged={notes.length || undefined}>
                    <span className="crew-batch-file">{file.path}</span>
                    <span className="crew-batch-meta">
                      {[file.status, ...notes].join(" · ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {files ? (
          files.length ? (
            <div className="crew-sheet-diff">
              <LazyUnifiedDiffView
                files={files}
                fill={false}
                fileLayout="cards"
                initialExpansion="all"
              />
            </div>
          ) : (
            <p className="crew-sheet-note">Couldn't read the change.</p>
          )
        ) : (
          <p className="crew-sheet-note" role="status">
            {rereading
              ? "The branch changed: reviewing again"
              : "Reading the change…"}
          </p>
        )}
        {problem ? (
          <p className="crew-sheet-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <footer className="crew-sheet-foot">
          <span className="crew-sheet-small">
            Applies to your files only when you press Apply, exactly as shown.
          </span>
          <div className="crew-sheet-actions">
            <TeamCardButton
              variant="primary"
              disabled={busy || !shown}
              onClick={() => void apply()}
            >
              {busy
                ? "Applying…"
                : upTo
                  ? `Apply ${plural(ordered.length, "card")}`
                  : "Apply all"}
            </TeamCardButton>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
