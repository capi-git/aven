import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { ExplorerMenu } from "../chrome/ExplorerMenu";
import { ArrowUp, ChevronDown, MoreHorizontal } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useBatchActions, type BatchRange } from "../hooks/useTeamPipeline";
import {
  applyCrewBatch,
  dropStackedCard,
  reviewCrewBatch,
  setCrewGoal,
  subscribeCrewTell,
  takeCrewTell,
  tellCrew,
  tellCrewWork,
} from "../lib/crewActions";
import {
  reviewFileNotes,
  type Pipeline,
  type PipelineBatch,
  type PipelineRow,
  type PipelineStep,
} from "../lib/crewPipeline";
import { cardInCopy, stackedCards, type Crew } from "../lib/crews";
import type { CrewBoardActionId } from "../lib/crewView";
import { errorText, logError } from "../lib/errors";
import { botCopyHost, type BotDiff } from "../lib/projectBotCopy";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import type { BoardAction, BoardCard, BoardColumnId } from "../lib/workBoard";
import { plural } from "../lib/words";
import { CrewAnswerBox, CrewFeed } from "./CrewBoard";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";
import "../chrome/TeamCard.css";
import "./CrewPipeline.css";

/**
 * The team's Cards (its Pipeline): the box for telling it what to build
 * next, its cards as rows grouped Ready for you → In progress → Up next →
 * Ideas, each with its path through Build, Check, Security and You, and a
 * quiet footer: shipped this week, Activity (the Feed) and the limits. The
 * team's header is the team screen's (see `TeamScreen`). Every button says
 * Aven's words.
 */
export function CrewPipeline({
  project,
  crew,
  view,
  range,
  columns,
  name,
  answering,
  onAnswerDone,
  problems,
  editing,
  onCrewAction,
  onMenu,
  onChoose,
  onReview,
  boardButtons,
  editor,
  addIdea,
  taskBox,
}: {
  project: string;
  crew: Crew;
  view: Pipeline;
  range: BatchRange | null;
  columns: Readonly<Record<BoardColumnId, readonly BoardCard[]>>;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  answering: string | null;
  onAnswerDone: () => void;
  /** Why the last team action on a card didn't go through. */
  problems: Readonly<Record<string, string>>;
  editing: string | null;
  onCrewAction: (card: BoardCard, id: CrewBoardActionId) => void;
  /** Open a card's ⋯ menu (draft, edit, delete, and the team's own). */
  onMenu: (cardId: string, anchor: HTMLElement) => void;
  /** Give to team ▾: who builds and checks it. */
  onChoose: (cardId: string, anchor: HTMLElement) => void;
  /** Open the batch's Review. */
  onReview: () => void;
  /** A Board card's own buttons (Review, Ship it…), as the Board draws them. */
  boardButtons: (card: BoardCard, actions: readonly BoardAction[]) => ReactNode;
  /** The card's editor, while it is being edited. */
  editor: (card: BoardCard) => ReactNode;
  /** Add an idea, under Ideas. */
  addIdea: ReactNode;
  /** Lets ⋯ → Set a goal… put the task box in goal mode. */
  taskBox?: { current: { goal: () => void } | null };
}) {
  const byId = useMemo(
    () =>
      new Map(
        [
          ...columns.review,
          ...columns.building,
          ...columns.idea,
          ...columns.shipped,
        ].map((card) => [card.id, card]),
      ),
    [columns],
  );
  const labels = useProjectLabels();
  const [activity, setActivity] = useState(false);
  const row = (item: PipelineRow) => {
    const card = byId.get(item.id);
    return (
      <PipelineRowView
        key={item.id}
        project={project}
        row={item}
        menuFor={card ? (anchor) => onMenu(card.id, anchor) : undefined}
        onAction={(id) => {
          if (card) onCrewAction(card, id);
        }}
        onChoose={card ? (anchor) => onChoose(card.id, anchor) : undefined}
        boardButtons={
          card && item.boardActions
            ? boardButtons(card, item.boardActions)
            : null
        }
        below={
          <>
            {card && editing === card.id ? editor(card) : null}
            {answering === item.id ? (
              <CrewAnswerBox
                path={project}
                cardId={item.id}
                onDone={onAnswerDone}
              />
            ) : null}
            {problems[item.id] ? (
              <p className="crew-pipe-problem" role="alert">
                {problems[item.id]}
              </p>
            ) : null}
          </>
        }
      />
    );
  };
  return (
    <div className="crew-pipe" data-crew-pipeline={project}>
      <CrewTaskBox path={project} control={taskBox} />
      {view.batch || view.ready.length ? (
        <PipelineGroup label="Ready for you">
          {view.batch ? (
            <BatchRow
              project={project}
              crew={crew}
              batch={view.batch}
              range={range}
              onReview={onReview}
            />
          ) : null}
          {view.ready.map(row)}
        </PipelineGroup>
      ) : null}
      {view.inProgress.length ? (
        <PipelineGroup label="In progress">
          {view.inProgress.map(row)}
        </PipelineGroup>
      ) : null}
      {view.upNext.length ? (
        <PipelineGroup label="Up next">{view.upNext.map(row)}</PipelineGroup>
      ) : null}
      <PipelineGroup label="Ideas">
        {view.ideas.map(row)}
        {addIdea}
      </PipelineGroup>
      <footer className="crew-pipe-foot" data-crew-foot>
        <span className="crew-pipe-shipped">
          {view.shipped.length
            ? `Shipped this week: ${view.shipped.slice(0, 3).join(" · ")}${
                view.shipped.length > 3
                  ? ` and ${view.shipped.length - 3} more`
                  : ""
              }`
            : ""}
        </span>
        <button
          type="button"
          className="crew-pipe-activity"
          aria-haspopup="dialog"
          onClick={() => setActivity(true)}
        >
          Activity ›
        </button>
        <span aria-hidden="true">·</span>
        <span data-crew-limits>{view.limits}</span>
      </footer>
      {activity ? (
        <Modal
          onClose={() => setActivity(false)}
          title="Activity"
          description={`${projectDisplayName(project, labels)} team`}
          className="crew-activity"
        >
          <CrewFeed crew={crew} name={name} />
        </Modal>
      ) : null}
    </div>
  );
}

function PipelineGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="crew-pipe-group" aria-label={label}>
      <h2 className="crew-pipe-label">{label}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The task box

type TellMode = "card" | "rule" | "goal";

const TELL_MODES: readonly {
  id: TellMode;
  label: string;
  word: string;
  placeholder: string;
}[] = [
  {
    id: "card",
    label: "Build it",
    word: "Card",
    placeholder: "What should the team build next?",
  },
  {
    id: "rule",
    label: "Remember for every card",
    word: "Rule",
    placeholder: "A rule for every card, like “Use pnpm”…",
  },
  {
    id: "goal",
    label: "Make it a goal",
    word: "Goal",
    placeholder: "A goal the team keeps going towards…",
  },
];

/**
 * What should the crew build next? A card by default; Remember for every
 * card keeps it as a standing rule, and Make it a goal has the crew plan
 * its own cards towards it and keep going. One control picks which.
 */
export function CrewTaskBox({
  path,
  control,
}: {
  path: string;
  /** Lets ⋯ → Set a goal… put the box in goal mode. */
  control?: { current: { goal: () => void } | null };
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<TellMode>("card");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const current = TELL_MODES.find((item) => item.id === mode)!;
  useEffect(() => {
    // Tell the crew… from the sidebar: the cursor goes in the box.
    const take = () => {
      if (takeCrewTell(path)) requestAnimationFrame(() => box.current?.focus());
    };
    take();
    return subscribeCrewTell(take);
  }, [path]);
  useEffect(() => {
    if (!control) return;
    control.current = {
      goal: () => {
        setMode("goal");
        requestAnimationFrame(() => box.current?.focus());
      },
    };
    return () => {
      control.current = null;
    };
  }, [control]);
  return (
    <>
      <form
        className="crew-pipe-ask"
        data-crew-tell
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          setProblem(null);
          if (mode === "rule") tellCrew(path, text);
          else if (mode === "goal") setCrewGoal(path, text);
          else
            void tellCrewWork(path, text)
              .catch((error) => errorText(error))
              .then(setProblem);
          setText("");
          setMode("card");
        }}
      >
        <input
          ref={box}
          className="crew-pipe-ask-input"
          type="text"
          placeholder={current.placeholder}
          aria-label="Tell the team"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          className="crew-pipe-ask-mode"
          data-mode={mode}
          aria-label={`How the team takes this: ${current.label}`}
          title="A card to build, a rule for every card, or a goal"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}
        >
          {current.word}
          <ChevronDown size={11} />
        </button>
        <button
          type="submit"
          className="crew-pipe-ask-send"
          aria-label="Send to the team"
          disabled={!text.trim()}
        >
          <ArrowUp className="size-3.5" />
        </button>
      </form>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="How the team takes this"
          items={TELL_MODES.map((item) => ({
            kind: "item" as const,
            id: item.id,
            label: item.label,
            ...(item.id === mode ? { checked: true } : {}),
          }))}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            setMode(id as TellMode);
            box.current?.focus();
          }}
        />
      ) : null}
      {problem ? (
        <p className="crew-pipe-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Rows

/** A card's path: Build · Check · Security · You, the current step marked. */
function StepTrack({
  project,
  steps,
}: {
  project: string;
  steps: readonly PipelineStep[];
}) {
  return (
    <div className="crew-pipe-steps" aria-label="Its path">
      {steps.map((step) => (
        <span
          key={step.id}
          className="crew-pipe-step"
          data-step={step.id}
          data-state={step.state}
          title={
            step.state === "skip" ? "This team has no Security" : undefined
          }
        >
          {step.state === "done" ? (
            <span className="crew-pipe-tick" aria-hidden="true">
              ✓
            </span>
          ) : step.who && step.who.role !== "you" ? (
            <CrewCritter
              path={project}
              role={step.who.role}
              {...(step.who.critter ? { critter: step.who.critter } : {})}
              state={step.state === "stuck" ? "needs" : "working"}
              className="crew-pipe-step-mark"
            />
          ) : step.who?.role === "you" ? (
            <span className="crew-pipe-you" aria-hidden="true" />
          ) : null}
          <span className="crew-pipe-step-label">{step.label}</span>
        </span>
      ))}
    </div>
  );
}

function PipelineRowView({
  project,
  row,
  menuFor,
  onAction,
  onChoose,
  boardButtons,
  below,
}: {
  project: string;
  row: PipelineRow;
  menuFor?: (anchor: HTMLElement) => void;
  onAction: (id: CrewBoardActionId) => void;
  onChoose?: (anchor: HTMLElement) => void;
  boardButtons: ReactNode;
  below: ReactNode;
}) {
  const [more, setMore] = useState<HTMLElement | null>(null);
  // The first two of the crew's buttons show; the rest are in its ⋯.
  const shown = row.actions.slice(0, row.actions.length > 2 ? 1 : 2);
  const rest = row.actions.slice(shown.length);
  return (
    <article
      className="crew-pipe-row"
      data-board-card={row.id}
      data-needs-you={row.needsYou ? "" : undefined}
    >
      <div className="crew-pipe-row-name">
        <span className="crew-pipe-row-title">{row.title}</span>
        <span className="crew-pipe-row-status" title={row.status}>
          {row.status}
        </span>
        {row.progress !== undefined ? (
          <span className="crew-pipe-bar" aria-hidden="true">
            <i style={{ width: `${Math.round(row.progress * 100)}%` }} />
          </span>
        ) : null}
      </div>
      {row.steps ? (
        <StepTrack project={project} steps={row.steps} />
      ) : (
        <span className="crew-pipe-nosteps" aria-hidden="true">
          —
        </span>
      )}
      <div className="crew-pipe-row-actions">
        {boardButtons}
        {shown.map((action) =>
          action.id === "give" && onChoose ? (
            <span key="give" className="crew-give-split">
              <TeamCardButton
                size="compact"
                onClick={() => onAction(action.id)}
              >
                {action.label}
              </TeamCardButton>
              <button
                type="button"
                className="crew-give-more"
                data-crew-give-more
                aria-label={`Choose who builds “${row.title}”`}
                title="Choose who builds and checks it"
                aria-haspopup="dialog"
                onClick={(event) => onChoose(event.currentTarget)}
              >
                <ChevronDown size={12} />
              </button>
            </span>
          ) : (
            <TeamCardButton
              key={action.id}
              size="compact"
              variant={
                action.primary && action.id !== "give" ? "primary" : "default"
              }
              onClick={() => onAction(action.id)}
            >
              {action.label}
            </TeamCardButton>
          ),
        )}
        {menuFor || rest.length ? (
          <button
            type="button"
            className="crew-pipe-more"
            aria-label={`More for “${row.title}”`}
            aria-haspopup="menu"
            onClick={(event) => {
              if (rest.length) setMore(event.currentTarget);
              else menuFor?.(event.currentTarget);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        ) : null}
      </div>
      {below}
      {more ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={more}
          align="end"
          gap={4}
          ariaLabel={`More for “${row.title}”`}
          items={[
            ...rest.map((action) => ({
              kind: "item" as const,
              id: action.id,
              label: action.label,
              ...(action.id === "throw-away" ? { danger: true } : {}),
            })),
            ...(menuFor
              ? [
                  { kind: "sep" as const },
                  {
                    kind: "item" as const,
                    id: "menu",
                    label: "Edit or delete…",
                  },
                ]
              : []),
          ]}
          onClose={() => setMore(null)}
          onPick={(id) => {
            const anchor = more;
            setMore(null);
            if (id === "menu") menuFor?.(anchor);
            else onAction(id as CrewBoardActionId);
          }}
        />
      ) : null}
    </article>
  );
}

/**
 * The batch on the team's branch: one row, Review and Apply all. Apply all
 * lands exactly the range this row read (its last commit and fingerprint);
 * a card a restack replayed goes through Review instead.
 */
function BatchRow({
  project,
  crew,
  batch,
  range,
  onReview,
}: {
  project: string;
  crew: Crew;
  batch: PipelineBatch;
  range: BatchRange | null;
  onReview: () => void;
}) {
  return (
    <article className="crew-pipe-row" data-crew-batch>
      <div className="crew-pipe-row-name">
        <span className="crew-pipe-row-title">{batch.title}</span>
        <span className="crew-pipe-row-status" title={batch.status}>
          {batch.status}
        </span>
      </div>
      <StepTrack project={project} steps={batch.steps} />
      <BatchButtons
        crew={crew}
        batch={batch}
        range={range}
        onReview={onReview}
        className="crew-pipe-row-actions"
        problemClass="crew-pipe-problem"
      />
    </article>
  );
}

/**
 * The batch's Review and Apply all (or Review to apply, for a replayed
 * card), and why the last Apply didn't land, with Update onto your files.
 * Both the Cards row and the chat's Ready for you draw these.
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
      title={`${plural(order.length, "card")} ready on the team's branch`}
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
              <UnifiedDiffView
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
