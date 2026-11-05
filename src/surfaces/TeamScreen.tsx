import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { MoreHorizontal } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { useNarrowMark } from "../hooks/useNarrow";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useTeamPipeline } from "../hooks/useTeamPipeline";
import { useTeamView } from "../hooks/useTeamView";
import {
  avosGlance,
  avosLine,
  avosReviews,
  avosUnmet,
  avosWeek,
  type AvosJobsInput,
  type AvosWeek,
  type AvosWeekRow,
} from "../lib/avos";
import {
  allowMoreRunsToday,
  clearCrewGoal,
  resumeCrewGoal,
  setCrewPaused,
  stopCrewNow,
  subscribeCrewTell,
  takeCrewReview,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { PipelineBatch, PipelineGoal } from "../lib/crewPipeline";
import { type Crew } from "../lib/crews";
import {
  crewMemberViews,
  type CrewBoardAction,
  type CrewBoardActionId,
  type CrewMemberView,
} from "../lib/crewView";
import type { BotStatus } from "../lib/projectBots";
import {
  listScheduledAgents,
  listScheduledRuns,
  openAutomation,
  subscribeScheduledAgents,
  subscribeScheduledRuns,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import { useTeamWorkspace } from "../lib/teamWorkspace";
import { reviewHeading } from "../lib/automationReview";
import { plural } from "../lib/words";
import type { TeamView } from "../lib/teamView";
import type { BoardCard, BoardColumnId } from "../lib/workBoard";
import { CrewAnswerBox, CrewFeed } from "./CrewBoard";
import { BatchButtons, BatchCard, CrewBatchSheet } from "./TeamBatch";
import { TeamCardButton } from "../chrome/TeamCard";
import type { BatchRange } from "../hooks/useTeamPipeline";
import { TeamChat } from "./TeamChat";
import { TeamNotes, TeamSchedule } from "./TeamPanel";
import type { BoardTop } from "./WorkBoard";
import "./TeamScreen.css";

/**
 * A project's Avos (board 2 of the Avos mocks): one thread with Avos and its
 * helpers, under one header (Avos's Bot, a live line on what's happening,
 * and Chat, Changes and Notes), with This week beside it. The Board, the
 * schedule and Activity are one level deeper, in ⋯. Meeting Avos for the
 * first time is the chat alone. The work stays in a copy until you press
 * Apply.
 */
const TABS: readonly { id: TeamView; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "changes", label: "Changes" },
  { id: "notes", label: "Notes" },
];

/**
 * The old Board, kept only for the real-app check to read cards off (it
 * sets the view itself): nothing on screen leads there. Named in the header
 * while it's shown, so there's a way back.
 */
const DEEPER: Partial<Record<TeamView, string>> = {
  board: "Board",
};

/** Below this width This week gives the thread its room. */
const WEEK_NARROW = 720;

export function TeamScreen({
  project,
  crew,
  fixer,
  columns,
  sections,
  now,
  name,
  problems,
  onCrewAction,
}: {
  project: string;
  crew: Crew;
  /** Avos's Fixer (the project bot), while it is on. */
  fixer?: { status: BotStatus; runs: number; sessionId?: string };
  columns: Readonly<Record<BoardColumnId, readonly BoardCard[]>>;
  /** The Board's four columns, as the Board draws them, with what goes on top. */
  sections: (top?: BoardTop) => ReactNode;
  now: number;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  problems: Readonly<Record<string, string>>;
  onCrewAction: (card: BoardCard, id: CrewBoardActionId) => void;
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
  const { view, range, dailyCap } = useTeamPipeline({
    project,
    crew,
    cards,
    now,
    fixerRuns: fixer?.runs ?? 0,
    name,
  });
  const labels = useProjectLabels();
  const [saved, save] = useTeamView(project);
  // Answer on its card shows the Board for now; which view this Avos opens
  // on stays what you chose.
  const [peek, setPeek] = useState<{ project: string; view: TeamView } | null>(
    null,
  );
  const mode = peek?.project === project ? peek.view : saved;
  const setMode = (next: TeamView) => {
    setPeek(null);
    save(next);
  };
  const [reviewing, setReviewing] = useState(false);
  const [activity, setActivity] = useState(false);
  const [schedule, setSchedule] = useState(false);
  // A card waiting on your answer, open in its own sheet.
  const [answering, setAnswering] = useState<string | null>(null);
  useEffect(() => {
    // Review from the Inbox or a Ready card: the batch's Review opens here.
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
  // ⋯ → Set a goal…: the Chat's box turns to the goal; a helper in This
  // week shows its posts.
  const chat = useRef<{
    goal: () => void;
    select: (id: string | null) => void;
  } | null>(null);
  // Meeting Avos is the chat alone: nothing else applies yet.
  const meeting = avosUnmet(crew);
  // Its jobs, and what their runs left for you.
  const agents = useSyncExternalStore(
    subscribeScheduledAgents,
    listScheduledAgents,
  );
  const runs = useSyncExternalStore(subscribeScheduledRuns, listScheduledRuns);
  const jobs = useMemo<AvosJobsInput>(() => ({ agents, runs }), [agents, runs]);
  const members = useMemo(
    () =>
      crewMemberViews(crew, {
        name,
        ...(fixer
          ? {
              fixer: {
                status: fixer.status,
                ...(fixer.sessionId ? { sessionId: fixer.sessionId } : {}),
              },
            }
          : {}),
      }),
    [crew, name, fixer],
  );
  const week = useMemo(() => avosWeek(crew, { jobs, now }), [crew, jobs, now]);
  const [node, setNode] = useState<HTMLElement | null>(null);
  useNarrowMark(node, WEEK_NARROW);
  const shown: TeamView = meeting ? "chat" : mode;
  const workspace = useTeamWorkspace();
  const open = (row: AvosWeekRow) => {
    const target = row.open;
    if (!target) return;
    if (target.kind === "review") {
      if (view.batch) setReviewing(true);
      else setPeek({ project, view: "board" });
    } else if (target.kind === "card") setPeek({ project, view: "board" });
    else if (target.kind === "run") workspace?.openRun?.(target.runId);
    else openAutomation(target.jobId);
  };
  // What needs you, in This week: what the Board's columns once asked of
  // you. Ready changes as one line with Review and Apply all, other ready
  // work with its buttons, a card waiting on your answer, ideas waiting for
  // Build it, and what Avos's jobs left for you.
  const act = (cardId: string, id: CrewBoardActionId) => {
    if (id === "answer") return setAnswering(cardId);
    const card = cards.find((item) => item.id === cardId);
    if (card) onCrewAction(card, id);
  };
  const stuck = useMemo(
    () => (crew.on ? crew.cards.filter((card) => card.stage === "stuck") : []),
    [crew],
  );
  const needs = useMemo<NeedsRow[]>(() => {
    const rows: NeedsRow[] = [];
    if (view.batch)
      rows.push({
        id: "batch",
        text: `${plural(view.batch.cards.length, "change")} ready`,
        title: view.batch.status,
        batch: view.batch,
      });
    for (const row of view.ready)
      if (!row.boardActions)
        rows.push({
          id: `ready:${row.id}`,
          text: row.title,
          title: row.status,
          cardId: row.id,
          actions: row.actions,
        });
    for (const card of stuck)
      rows.push({
        id: `stuck:${card.id}`,
        text: `“${card.title}” needs your answer`,
        ...(card.stuck?.text ? { title: card.stuck.text } : {}),
        cardId: card.id,
        actions: [{ id: "answer", label: "Answer", primary: true }],
      });
    for (const card of columns.idea) {
      const give = card.crew?.actions.find((action) => action.id === "give");
      if (!give || card.crew?.later) continue;
      const from = card.crew?.line?.split(" · ")[0];
      rows.push({
        id: `idea:${card.id}`,
        text: `${from?.startsWith("From ") ? from : "Idea"}: ${card.title}`,
        ...(card.crew?.line ? { title: card.crew.line } : {}),
        cardId: card.id,
        actions: [give],
        idea: true,
      });
    }
    for (const row of week.needs)
      if (row.open?.kind === "run")
        rows.push({ id: row.id, text: row.text, open: row });
    return rows;
  }, [view.batch, view.ready, stuck, columns.idea, week.needs]);
  const answeringCard = answering
    ? crew.cards.find((card) => card.id === answering && card.stage === "stuck")
    : undefined;
  const batch = view.batch ? (
    <BatchCard
      crew={crew}
      batch={view.batch}
      range={range}
      onReview={() => setReviewing(true)}
    />
  ) : null;
  return (
    <section
      ref={setNode}
      className="team-screen avos-screen"
      data-team-view={shown}
      data-meeting={meeting || undefined}
      aria-label={`${projectDisplayName(project, labels)}'s Avos`}
    >
      <div className="avos-main">
        {meeting ? null : (
          <AvosHeader
            crew={crew}
            project={project}
            mode={shown}
            name={name}
            jobs={jobs}
            sentence={view.sentence}
            dailyCap={dailyCap}
            onMode={setMode}
            onSetGoal={() => {
              setMode("chat");
              chat.current?.goal();
            }}
            onActivity={() => setActivity(true)}
            onSchedule={() => setSchedule(true)}
          />
        )}
        {/* The chat stays put under the other views, so its place and what
            you were writing are there when you come back. */}
        <div className="avos-body" hidden={shown !== "chat"}>
          <TeamChat
            project={project}
            crew={crew}
            view={view}
            range={range}
            now={now}
            name={name}
            {...(fixer ? { fixer } : {})}
            cards={cards}
            problems={problems}
            onCrewAction={onCrewAction}
            onReview={() => setReviewing(true)}
            onCards={() => {
              // Answer on its card: its question, in its own sheet.
              if (stuck[0]) setAnswering(stuck[0].id);
            }}
            onSelected={() => undefined}
            control={chat}
          />
        </div>
        {shown === "chat" ? null : (
          <div className="avos-body avos-pane" role="tabpanel">
            {shown === "board" ? (
              <div className="work-board-columns" data-team-board={project}>
                {sections(
                  view.batch && batch
                    ? {
                        review: {
                          node: batch,
                          covers: new Set(
                            view.batch.cards.map((card) => card.id),
                          ),
                          count: view.batch.cards.length,
                        },
                      }
                    : {},
                )}
              </div>
            ) : shown === "notes" ? (
              <TeamNotes crew={crew} />
            ) : (
              (batch ?? (
                <p className="team-panel-empty">
                  Nothing to apply yet. Finished work shows up here, and stays
                  in Avos's copy until you apply it.
                </p>
              ))
            )}
          </div>
        )}
      </div>
      {meeting || shown === "board" ? null : (
        <AvosWeekPanel
          project={project}
          week={week}
          needs={needs}
          crew={crew}
          range={range}
          problems={problems}
          onReview={() => setReviewing(true)}
          onAct={act}
          goal={view.goal}
          members={members}
          onOpen={open}
          onHelper={(id) => {
            setMode("chat");
            chat.current?.select(id);
          }}
        />
      )}
      {reviewing && view.batch ? (
        <CrewBatchSheet
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
      ) : null}
      {schedule ? (
        <Modal
          onClose={() => setSchedule(false)}
          title="Schedule"
          description="When Avos and its helpers work"
          className="avos-schedule-sheet"
        >
          <div className="avos-sheet-body">
            <TeamSchedule crew={crew} />
          </div>
        </Modal>
      ) : null}
      {answeringCard ? (
        <Modal
          onClose={() => setAnswering(null)}
          title={answeringCard.title}
          description={
            answeringCard.stuck?.text ?? "It stopped, and waits for you."
          }
          className="avos-answer-sheet"
        >
          <div className="avos-sheet-body" data-avos-answer={answeringCard.id}>
            {answeringCard.stuck?.reason === "question" ? (
              <CrewAnswerBox
                path={project}
                cardId={answeringCard.id}
                onDone={() => setAnswering(null)}
              />
            ) : null}
            <div className="avos-answer-ways">
              {(
                cards.find((card) => card.id === answeringCard.id)?.crew
                  ?.actions ?? []
              )
                .filter((action) => action.id !== "answer")
                .map((action) => (
                  <TeamCardButton
                    key={action.id}
                    size="compact"
                    variant={action.primary ? "primary" : "default"}
                    onClick={() => {
                      setAnswering(null);
                      act(answeringCard.id, action.id);
                    }}
                  >
                    {action.label}
                  </TeamCardButton>
                ))}
            </div>
          </div>
        </Modal>
      ) : null}
      {activity ? (
        <Modal
          onClose={() => setActivity(false)}
          title="Activity"
          description={`${projectDisplayName(project, labels)}'s Avos · ${view.limits}`}
          className="crew-activity"
        >
          <CrewFeed crew={crew} name={name} />
        </Modal>
      ) : null}
    </section>
  );
}

/**
 * Avos's one header: its Bot, its name, one live line on what's happening
 * (who is doing what, or what waits for you), Chat, Changes and Notes, and
 * ⋯ for the rest.
 */
function AvosHeader({
  crew,
  project,
  mode,
  name,
  jobs,
  sentence,
  dailyCap,
  onMode,
  onSetGoal,
  onActivity,
  onSchedule,
}: {
  crew: Crew;
  project: string;
  mode: TeamView;
  /** What the work is at, as the pipeline says it. */
  sentence: string;
  name: (who: string) => string;
  jobs: AvosJobsInput;
  dailyCap: boolean;
  onMode: (view: TeamView) => void;
  onSetGoal: () => void;
  onActivity: () => void;
  /** When Avos and its helpers work, in a sheet. */
  onSchedule: () => void;
}) {
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const glance = avosGlance(project, crew, { name, jobs });
  const line = headerLine(crew, sentence, avosReviews(project, jobs), name);
  const goal = crew.goal;
  const goalGoing = !!goal && !goal.done;
  const deeper = DEEPER[mode];
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "schedule", label: "Schedule" },
    { kind: "item", id: "activity", label: "Activity" },
    { kind: "sep" },
    goalGoing
      ? { kind: "item", id: "clear-goal", label: "Clear the goal" }
      : { kind: "item", id: "goal", label: "Set a goal…" },
    ...(glance.note === "working"
      ? [{ kind: "item" as const, id: "stop", label: "Stop now" }]
      : []),
    ...(dailyCap
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    crew.paused
      ? { kind: "item", id: "resume", label: "Resume Avos" }
      : { kind: "item", id: "pause", label: "Pause Avos" },
    { kind: "sep" },
    { kind: "item", id: "add", label: "Add a helper…" },
    { kind: "item", id: "settings", label: "Settings…" },
  ];
  return (
    <header className="avos-head" data-crew-header={crew.path}>
      <CrewCritter
        path={project}
        role="lead"
        state={glance.state}
        className="avos-head-mark"
      />
      <h1 className="avos-head-name">Avos</h1>
      <p
        className="avos-head-line"
        data-crew-sentence
        data-avos-note={glance.note ?? undefined}
        title={line}
      >
        {line}
      </p>
      <div className="avos-head-tabs" role="tablist" aria-label="Avos">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            data-team-tab={tab.id}
            onClick={() => onMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        {deeper ? (
          <button
            type="button"
            role="tab"
            aria-selected
            data-team-tab={mode}
            onClick={() => onMode("chat")}
            title="Back to the chat"
          >
            {deeper}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="avos-head-more"
        aria-label="More for Avos"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(event) => setMenu(menu ? null : event.currentTarget)}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="Avos actions"
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "schedule") onSchedule();
            else if (id === "activity") onActivity();
            else if (id === "goal") onSetGoal();
            else if (id === "clear-goal") clearCrewGoal(crew.path);
            else if (id === "stop") void stopCrewNow(crew.path);
            else if (id === "more") allowMoreRunsToday(crew.path);
            else if (id === "pause" || id === "resume")
              setCrewPaused(crew.path, id === "pause");
            else if (id === "add") workspace?.openSettings(crew.path, "add");
            else if (id === "settings") workspace?.openSettings(crew.path);
          }}
        />
      ) : null}
    </header>
  );
}

/**
 * The live line under Avos's name: what Avos or a helper is doing when it
 * isn't a card (answering you, looking for ideas), or asleep; otherwise
 * where the work is ("Building … round 2", a limit that holds it, what
 * waits for you), with what its jobs left for you.
 */
function headerLine(
  crew: Crew,
  sentence: string,
  reviews: readonly ScheduledRun[],
  name: (who: string) => string,
): string {
  const offCard = crew.members.some(
    (member) =>
      member.role !== "fixer" &&
      !!member.doing &&
      !crew.cards.some(
        (card) =>
          !!card.turn &&
          (card.turn.sessionId === member.sessionId ||
            card.builderId === member.id),
      ),
  );
  if (!crew.on || offCard) return avosLine(crew, { name });
  const jobs =
    reviews.length === 1 && reviews[0]!.review?.status === "open"
      ? `${reviewHeading(reviews[0]!.review)}: ${reviews[0]!.review.title}.`
      : reviews.length
        ? `${plural(reviews.length, "thing")} from its jobs ${reviews.length === 1 ? "waits" : "wait"} for you.`
        : "";
  return [sentence, jobs].filter(Boolean).join(" ");
}

const SECTIONS: readonly {
  key: keyof AvosWeek;
  title: string;
  needs?: true;
}[] = [
  { key: "needs", title: "Needs you", needs: true },
  { key: "doing", title: "Doing now" },
  { key: "watching", title: "Keeping an eye on" },
  { key: "done", title: "Done" },
];

/** A helper's one word in This week. */
function helperWord(member: CrewMemberView): string {
  if (member.status === "needs-you" || member.status === "ready")
    return "Needs you";
  if (member.status === "working" || member.active) return "Working";
  if (member.status === "paused") return "Paused";
  return "Resting";
}

/**
 * This week, beside the thread: what needs you, what Avos is doing, what it
 * keeps an eye on and what's done, each shown only when it has something;
 * then who is helping out, each with its Bot and one word.
 */
/** One line under Needs you, and the buttons that sort it out. */
type NeedsRow = {
  id: string;
  text: string;
  /** Its whole line, for the tooltip. */
  title?: string;
  /** Ready changes on Avos's branch: Review and Apply all. */
  batch?: PipelineBatch;
  /** The card it's about, and its buttons (Build it, Answer, Apply…). */
  cardId?: string;
  actions?: readonly CrewBoardAction[];
  /** An idea waiting for Build it. */
  idea?: true;
  /** A job's run: opens where its card waits. */
  open?: AvosWeekRow;
};

/** Ideas waiting for you shown before "N more". */
const IDEAS_SHOWN = 4;

function AvosWeekPanel({
  project,
  week,
  needs,
  crew,
  range,
  problems,
  onReview,
  onAct,
  goal,
  members,
  onOpen,
  onHelper,
}: {
  project: string;
  week: AvosWeek;
  needs: readonly NeedsRow[];
  crew: Crew;
  range: BatchRange | null;
  problems: Readonly<Record<string, string>>;
  onReview: () => void;
  onAct: (cardId: string, id: CrewBoardActionId) => void;
  /** The goal Avos keeps building towards, and where it stands. */
  goal?: PipelineGoal;
  members: readonly CrewMemberView[];
  onOpen: (row: AvosWeekRow) => void;
  onHelper: (id: string) => void;
}) {
  const helpers = members.filter((member) => member.role !== "lead");
  const empty =
    !goal &&
    !needs.length &&
    SECTIONS.every(
      (section) => section.key === "needs" || !week[section.key].length,
    );
  const ideas = needs.filter((row) => row.idea);
  const shownNeeds = [
    ...needs.filter((row) => !row.idea),
    ...ideas.slice(0, IDEAS_SHOWN),
  ];
  const moreIdeas = ideas.length - Math.min(ideas.length, IDEAS_SHOWN);
  return (
    <aside className="avos-week" aria-label="This week" data-avos-week>
      <h2 className="avos-week-title">This week</h2>
      {SECTIONS.map((section) =>
        section.key === "needs" ? (
          needs.length ? (
            <section
              key={section.key}
              className="avos-week-section"
              data-avos-week-section={section.key}
            >
              <h3 data-needs-you>{section.title}</h3>
              {shownNeeds.map((row) => (
                <div
                  key={row.id}
                  className="avos-week-need"
                  data-avos-need={row.id}
                >
                  {row.open ? (
                    <button
                      type="button"
                      className="avos-week-row"
                      title={row.title}
                      onClick={() => onOpen(row.open!)}
                    >
                      {row.text}
                    </button>
                  ) : (
                    <p className="avos-week-row" title={row.title}>
                      {row.text}
                    </p>
                  )}
                  {row.batch ? (
                    <BatchButtons
                      crew={crew}
                      batch={row.batch}
                      range={range}
                      onReview={onReview}
                      className="avos-week-buttons"
                      problemClass="avos-week-problem"
                    />
                  ) : row.actions?.length && row.cardId ? (
                    <span className="avos-week-buttons">
                      {row.actions.map((action) => (
                        <TeamCardButton
                          key={action.id}
                          size="compact"
                          variant={action.primary ? "primary" : "default"}
                          onClick={() => onAct(row.cardId!, action.id)}
                        >
                          {action.label}
                        </TeamCardButton>
                      ))}
                    </span>
                  ) : null}
                  {row.cardId && problems[row.cardId] ? (
                    <p className="avos-week-problem" role="alert">
                      {problems[row.cardId]}
                    </p>
                  ) : null}
                </div>
              ))}
              {moreIdeas > 0 ? (
                <p className="avos-week-more">
                  {plural(moreIdeas, "more idea")}{" "}
                  {moreIdeas === 1 ? "waits" : "wait"} for you
                </p>
              ) : null}
            </section>
          ) : null
        ) : section.key === "doing" && goal ? (
          <section
            key={section.key}
            className="avos-week-section"
            data-avos-week-section={section.key}
          >
            <h3>{section.title}</h3>
            {week.doing.map((row) => (
              <p key={row.id} className="avos-week-row">
                {row.text}
              </p>
            ))}
            <p
              className="avos-week-row avos-week-goal"
              data-crew-goal={goal.state}
            >
              <span className="avos-week-goal-word">Goal</span> {goal.text}
              <span className="avos-week-goal-state">
                {goal.state === "met"
                  ? " · met"
                  : goal.state === "stopped"
                    ? ` · stopped: ${goal.why ?? ""}`
                    : goal.state === "waits"
                      ? ` · ${goal.why ?? "waits"}`
                      : " · Avos keeps going"}
              </span>
              {goal.state === "stopped" ? (
                <button
                  type="button"
                  className="crew-pipe-link"
                  onClick={() => resumeCrewGoal(project)}
                >
                  Keep going
                </button>
              ) : null}
            </p>
          </section>
        ) : week[section.key].length ? (
          <section
            key={section.key}
            className="avos-week-section"
            data-avos-week-section={section.key}
          >
            <h3 data-needs-you={section.needs || undefined}>{section.title}</h3>
            {week[section.key].map((row) =>
              row.open ? (
                <button
                  key={row.id}
                  type="button"
                  className="avos-week-row"
                  onClick={() => onOpen(row)}
                >
                  {row.text}
                </button>
              ) : (
                <p key={row.id} className="avos-week-row">
                  {row.text}
                </p>
              ),
            )}
          </section>
        ) : null,
      )}
      {empty ? <p className="avos-week-empty">Nothing yet this week.</p> : null}
      {helpers.length ? (
        <section
          className="avos-week-section avos-week-helpers"
          data-avos-week-section="helpers"
        >
          <h3>Helping out</h3>
          {helpers.map((member) => {
            const word = helperWord(member);
            return (
              <button
                key={member.id}
                type="button"
                className="avos-week-helper"
                data-avos-helper={member.id}
                title={member.line ?? member.roleLabel}
                onClick={() => onHelper(member.id)}
              >
                <CrewCritter
                  path={project}
                  role={member.role}
                  {...(member.critter ? { critter: member.critter } : {})}
                  state={
                    word === "Needs you"
                      ? "needs"
                      : word === "Working"
                        ? "working"
                        : "resting"
                  }
                  className="avos-week-helper-mark"
                />
                <span className="avos-week-helper-name">{member.name}</span>
                <span
                  className="avos-week-helper-word"
                  data-needs-you={word === "Needs you" || undefined}
                >
                  {word}
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
    </aside>
  );
}
