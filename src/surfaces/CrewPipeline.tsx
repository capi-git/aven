import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CrewCritter, crewMarkState } from "../chrome/CrewCritter";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import {
  ArrowUp,
  ChevronDown,
  MoreHorizontal,
  Pause,
  Play,
} from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { claudeWeeklyUsed } from "../hooks/useProjectBots";
import {
  allowMoreRunsToday,
  applyCrewBatch,
  clearCrewGoal,
  dropStackedCard,
  restackCrew,
  resumeCrewGoal,
  reviewCrewBatch,
  setCrewGoal,
  setCrewPaused,
  stopCrewNow,
  subscribeCrewTell,
  takeCrewReview,
  takeCrewTell,
  tellCrew,
  tellCrewWork,
  turnOffCrew,
  useCrewWorkspace,
} from "../lib/crewActions";
import { allCrewRunsToday, crewHoldGate } from "../lib/crewLimits";
import {
  crewPipeline,
  reviewFileNotes,
  type PipelineBatch,
  type PipelineRow,
  type PipelineStep,
} from "../lib/crewPipeline";
import {
  cardHolderId,
  cardInCopy,
  crewMembers,
  memberCritter,
  stackedCards,
  useCrewsAllRunsPerDay,
  type Crew,
} from "../lib/crews";
import type { CrewBoardActionId } from "../lib/crewView";
import { errorText, logError } from "../lib/errors";
import { botCopyHost, type BotDiff } from "../lib/projectBotCopy";
import { getProjectBot, runsToday } from "../lib/projectBots";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import type { BoardAction, BoardCard, BoardColumnId } from "../lib/workBoard";
import { plural } from "../lib/words";
import { CrewAnswerBox, CrewFeed } from "./CrewBoard";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";
import "../chrome/TeamCard.css";
import "./CrewPipeline.css";

/**
 * The crew's Pipeline (its Board, while the crew is on): one header with
 * its marks and one sentence on what it's doing and what needs you, the
 * box for telling it what to build next, its cards as rows grouped Ready
 * for you → In progress → Up next → Ideas, each with its path through
 * Build, Check, Security and You, and a quiet footer: shipped this week,
 * Activity (the Feed) and the limits. Every button says Aven's words.
 */
export function CrewPipeline({
  project,
  crew,
  columns,
  now,
  fixerRuns,
  name,
  answering,
  onAnswerDone,
  problems,
  editing,
  onCrewAction,
  onMenu,
  onChoose,
  boardButtons,
  editor,
  addIdea,
}: {
  project: string;
  crew: Crew;
  columns: Readonly<Record<BoardColumnId, readonly BoardCard[]>>;
  now: number;
  fixerRuns: number;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  answering: string | null;
  onAnswerDone: () => void;
  /** Why the last crew action on a card didn't go through. */
  problems: Readonly<Record<string, string>>;
  editing: string | null;
  onCrewAction: (card: BoardCard, id: CrewBoardActionId) => void;
  /** Open a card's ⋯ menu (draft, edit, delete, and the crew's own). */
  onMenu: (cardId: string, anchor: HTMLElement) => void;
  /** Give to crew ▾: who builds and checks it. */
  onChoose: (cardId: string, anchor: HTMLElement) => void;
  /** A Board card's own buttons (Review, Ship it…), as the Board draws them. */
  boardButtons: (card: BoardCard, actions: readonly BoardAction[]) => ReactNode;
  /** The card's editor, while it is being edited. */
  editor: (card: BoardCard) => ReactNode;
  /** Add an idea, under Ideas. */
  addIdea: ReactNode;
}) {
  const cards = useMemo(
    () => [
      ...columns.review,
      ...columns.building,
      ...columns.idea,
      ...columns.shipped,
    ],
    [columns],
  );
  const byId = useMemo(
    () => new Map(cards.map((card) => [card.id, card])),
    [cards],
  );
  const labels = useProjectLabels();
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
  const view = crewPipeline({
    crew,
    cards,
    now,
    name,
    fixerRuns,
    ...(held && held.gate.reason !== "paused" ? { hold: held.gate.title } : {}),
    ...(range ? { batchFiles: range.files } : {}),
  });
  const [activity, setActivity] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    // Review from the Inbox: the batch's Review opens here.
    const take = () => {
      if (takeCrewReview(project)) setReviewing(true);
    };
    take();
    return subscribeCrewTell(take);
  }, [project]);
  // Nothing on the branch to review: the request is over, so a batch that
  // arrives later never opens its Review by itself.
  const hasBatch = !!view.batch;
  useEffect(() => {
    if (reviewing && !hasBatch) setReviewing(false);
  }, [reviewing, hasBatch]);
  const taskBox = useRef<{ goal: () => void } | null>(null);
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
      <PipelineHeader
        crew={crew}
        project={project}
        sentence={view.sentence}
        focus={view.focus}
        offerScout={view.offerScout}
        goal={view.goal}
        dailyCap={held?.gate.reason === "daily-cap"}
        onSetGoal={() => taskBox.current?.goal()}
      />
      <CrewTaskBox path={project} control={taskBox} />
      {view.batch || view.ready.length ? (
        <PipelineGroup label="Ready for you">
          {view.batch ? (
            <BatchRow
              project={project}
              crew={crew}
              batch={view.batch}
              range={range}
              onReview={() => setReviewing(true)}
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
          description={`${projectDisplayName(project, labels)} crew`}
          className="crew-activity"
        >
          <CrewFeed crew={crew} name={name} />
        </Modal>
      ) : null}
      {reviewing && view.batch ? (
        <CrewBatchSheet
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
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
// The header

function PipelineHeader({
  crew,
  project,
  sentence,
  focus,
  offerScout,
  goal,
  dailyCap,
  onSetGoal,
}: {
  crew: Crew;
  project: string;
  sentence: string;
  focus?: string;
  offerScout: boolean;
  goal?: { text: string; state: "on" | "met" | "stopped"; why?: string };
  dailyCap: boolean;
  onSetGoal: () => void;
}) {
  const labels = useProjectLabels();
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const name = projectDisplayName(crew.path, labels);
  const working = cardInCopy(crew);
  const holder = working ? cardHolderId(crew, working) : undefined;
  const members = crewMembers(crew);
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "stop", label: "Stop now" },
    ...(dailyCap
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    goal
      ? { kind: "item", id: "clear-goal", label: "Clear the goal" }
      : { kind: "item", id: "goal", label: "Set a goal…" },
    { kind: "item", id: "settings", label: "Settings…" },
    { kind: "sep" },
    { kind: "item", id: "off", label: "Turn the crew off" },
  ];
  // The card the sentence names stands out, once.
  const at = focus ? sentence.indexOf(focus) : -1;
  return (
    <header className="crew-pipe-head" data-crew-header={crew.path}>
      <div className="crew-pipe-marks" role="list" aria-label="The crew">
        {members.map((member) => {
          const busy =
            !!member.doing ||
            (holder === member.id && working?.stage !== "stuck");
          const needs = holder === member.id && working?.stage === "stuck";
          return (
            <button
              key={member.id}
              type="button"
              role="listitem"
              className="crew-pipe-mark"
              data-crew-tile={member.id}
              title={`${workspace ? "Settings for " : ""}${member.name ?? member.id}`}
              aria-label={`${member.role} ${member.id}`}
              onClick={() => workspace?.openSettings(crew.path, member.id)}
            >
              <CrewCritter
                path={project}
                role={member.role}
                {...(member.critter ? { critter: memberCritter(member) } : {})}
                state={crewMarkState(
                  needs ? "needs-you" : undefined,
                  busy,
                  member.paused ? "idle" : "still",
                )}
                className="crew-pipe-mark-dots"
              />
            </button>
          );
        })}
      </div>
      <div className="crew-pipe-heading">
        <h1>{name} crew</h1>
        <p className="crew-pipe-sentence" data-crew-sentence>
          {at >= 0 ? (
            <>
              {sentence.slice(0, at)}
              <b>{focus}</b>
              {sentence.slice(at + focus!.length)}
            </>
          ) : (
            sentence
          )}
          {offerScout && workspace ? (
            <>
              {" "}
              <button
                type="button"
                className="crew-pipe-link"
                data-crew-add-scout
                onClick={() => workspace.openSettings(crew.path, "add")}
              >
                Add a Scout to suggest ideas
              </button>
            </>
          ) : null}
        </p>
        {goal ? (
          <p className="crew-pipe-goal" data-crew-goal={goal.state}>
            <span className="crew-pipe-goal-word">Goal</span> {goal.text}
            <span className="crew-pipe-goal-state">
              {goal.state === "met"
                ? " · met"
                : goal.state === "stopped"
                  ? ` · stopped: ${goal.why ?? ""}`
                  : " · the crew keeps going"}
            </span>
            {goal.state === "stopped" ? (
              <button
                type="button"
                className="crew-pipe-link"
                onClick={() => resumeCrewGoal(crew.path)}
              >
                Keep going
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
      <div className="crew-pipe-head-actions">
        <TeamCardButton
          onClick={() => setCrewPaused(crew.path, !crew.paused)}
          title={crew.paused ? "Resume the crew" : "Pause the crew"}
        >
          {crew.paused ? (
            <Play className="size-3" />
          ) : (
            <Pause className="size-3" />
          )}
          <span>{crew.paused ? "Resume" : "Pause"}</span>
        </TeamCardButton>
        <TeamCardButton
          variant="ghost"
          aria-label="More for the crew"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}
        >
          <MoreHorizontal size={14} />
        </TeamCardButton>
      </div>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel={`${name} crew actions`}
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "stop") void stopCrewNow(crew.path);
            else if (id === "more") allowMoreRunsToday(crew.path);
            else if (id === "goal") onSetGoal();
            else if (id === "clear-goal") clearCrewGoal(crew.path);
            else if (id === "settings") workspace?.openSettings(crew.path);
            else if (id === "off") setConfirmingOff(true);
          }}
        />
      ) : null}
      {confirmingOff ? (
        <ConfirmDialog
          title="Turn the crew off?"
          body="What it is doing stops and nothing new starts. Its cards and its copy stay, so Ready work is still there when you turn it on."
          confirmLabel="Turn off"
          onConfirm={() => {
            setConfirmingOff(false);
            void turnOffCrew(crew.path);
          }}
          onCancel={() => setConfirmingOff(false)}
        />
      ) : null}
    </header>
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
    placeholder: "What should the crew build next?",
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
    placeholder: "A goal the crew keeps going towards…",
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
          aria-label="Tell the crew"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="button"
          className="crew-pipe-ask-mode"
          data-mode={mode}
          aria-label={`How the crew takes this: ${current.label}`}
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
          aria-label="Send to the crew"
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
          ariaLabel="How the crew takes this"
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
            step.state === "skip" ? "This crew has no Security" : undefined
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

/** What the batch row shows of the branch: its last commit, fingerprint and files. */
type BatchRange = { to: string; hash: string; files: number };

/**
 * The batch's range as the branch holds it now, read again whenever a card
 * is stacked or applied: what the row's Apply all lands, and its files.
 * Null while it's read, or once its top moved on (so Apply waits).
 */
function useBatchRange(project: string, crew: Crew): BatchRange | null {
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
 * The batch on the crew's branch: one row, Review and Apply all. Apply all
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(null);
    const why = await work().catch((error) => errorText(error));
    setBusy(false);
    setProblem(why);
  };
  const conflict = problem ?? batch.conflict;
  return (
    <article className="crew-pipe-row" data-crew-batch>
      <div className="crew-pipe-row-name">
        <span className="crew-pipe-row-title">{batch.title}</span>
        <span className="crew-pipe-row-status" title={batch.status}>
          {batch.status}
        </span>
      </div>
      <StepTrack project={project} steps={batch.steps} />
      <div className="crew-pipe-row-actions">
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
              disabled={busy || !range}
              onClick={() => {
                if (!range) return;
                void run(() =>
                  applyCrewBatch(crew.path, {
                    to: range.to,
                    hash: range.hash,
                  }),
                );
              }}
            >
              {busy ? "Applying…" : "Apply all"}
            </TeamCardButton>
          </>
        )}
      </div>
      {conflict ? (
        <p className="crew-pipe-problem" role="alert">
          {conflict}
          {batch.conflict && /Update the crew's branch/.test(batch.conflict) ? (
            <>
              {" "}
              <button
                type="button"
                className="crew-pipe-link"
                disabled={busy}
                onClick={() => void run(() => restackCrew(crew.path))}
              >
                Update onto your files
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </article>
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
  useEffect(() => {
    let live = true;
    // A new selection: nothing is shown, so nothing can be applied, until
    // its own change has been read.
    setReview(null);
    setFiles(null);
    void reviewCrewBatch(project, upTo)
      .then(async (found) => {
        if (!live) return;
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
  }, [project, upTo, copy]);
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
      title={`${plural(order.length, "card")} ready on the crew's branch`}
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
          <p className="crew-sheet-note">Reading the change…</p>
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
