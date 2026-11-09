import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { Modal } from "../chrome/Modal";
import { useNarrow } from "../hooks/useNarrow";
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
  type AvosWeekRow,
} from "../lib/avos";
import { subscribeCrewTell, takeCrewReview } from "../lib/crewActions";
import { avosPickOverride, pickLabel } from "../lib/crewModels";
import {
  crewMember,
  crewMemberById,
  stackedCards,
  type Crew,
} from "../lib/crews";
import { crewMemberViews, type CrewBoardActionId } from "../lib/crewView";
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
import type { BoardCard, BoardColumnId } from "../lib/workBoard";
import { AvosForYou, type AvosAsk } from "./AvosForYou";
import type { AvosProfileProps } from "./AvosProfile";
import {
  AVOS_TABS,
  AvosPanel,
  AvosPanelBar,
  AvosTabBody,
  type AvosPanelProps,
  type AvosTab,
} from "./AvosPanel";
import { avosJobs } from "../lib/avosJobs";
import { CrewAnswerBox, CrewFeed } from "./CrewBoard";
import { AvosReview } from "./AvosReview";
import { BatchCard, CrewBatchSheet } from "./TeamBatch";
import { TeamCardButton } from "../chrome/TeamCard";
import { TeamChat } from "./TeamChat";
import { TeamNotes } from "./TeamPanel";
import type { BoardTop } from "./WorkBoard";
import "./TeamScreen.css";

/**
 * A project's Avos (13B of the Avos mocks), like a messenger with someone
 * you work with: the chat, with Avos's panel beside it (Overview, Helpers,
 * Documents, Habits and Changes, as a Mono's in MonoCode; its Bot, name and
 * ⋯, what it's up to, what it keeps an eye on, remembers and who's
 * helping). What needs you is Avos's own message at the end of the chat,
 * with its buttons. On a narrow pane the panel folds into one header whose
 * tab icons open in a sheet.
 * Meeting Avos for the first time is the chat alone. The work stays in a
 * copy until you press Apply.
 */

/** Below this width Avos's panel folds into a header over the chat. */
const PROFILE_NARROW = 720;

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
  onDeleteCard,
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
  /** Delete a card, after asking (the Board's own question). */
  onDeleteCard?: (card: BoardCard) => void;
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
  // The old Board, kept only for the real-app check to read cards off (it
  // sets the view itself): nothing on screen leads there.
  const [saved, save] = useTeamView(project);
  const [reviewing, setReviewing] = useState(false);
  const [notes, setNotes] = useState(false);
  // What the helpers did, in a sheet.
  const [activity, setActivity] = useState(false);
  // Avos's panel: its open tab beside the chat, or (narrow) in a sheet.
  const [tab, setTab] = useState<AvosTab>("overview");
  const [sheet, setSheet] = useState<AvosTab | null>(null);
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
  // A helper in the panel shows its posts.
  const chat = useRef<{
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
  const [measure, narrow] = useNarrow<HTMLElement>(PROFILE_NARROW);
  // Wide again: the panel stands beside the chat, so its sheet goes.
  useEffect(() => {
    if (!narrow) setSheet(null);
  }, [narrow]);
  const shown = !meeting && saved === "board" ? "board" : "chat";
  const workspace = useTeamWorkspace();
  const open = (row: AvosWeekRow) => {
    const target = row.open;
    if (!target) return;
    if (target.kind === "review") {
      if (view.batch) setReviewing(true);
    } else if (target.kind === "card") setAnswering(target.cardId);
    else if (target.kind === "run") workspace?.openRun?.(target.runId);
    else openAutomation(target.jobId);
  };
  const act = (cardId: string, id: CrewBoardActionId | "delete") => {
    if (id === "answer") return setAnswering(cardId);
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    if (id === "delete") onDeleteCard?.(card);
    else onCrewAction(card, id);
  };
  const stuck = useMemo(
    () => (crew.on ? crew.cards.filter((card) => card.stage === "stuck") : []),
    [crew],
  );
  // What needs you, as Avos's message in the chat: ready changes with
  // Review and Apply all, other ready work with its buttons, a card waiting
  // on your answer, and ideas waiting for Build it. (A job's run that waits
  // for you is its own post in the chat already.)
  const asks = useMemo<AvosAsk[]>(() => {
    const rows: AvosAsk[] = [];
    if (view.batch) {
      const batch = view.batch;
      const single = batch.cards.length === 1 ? batch.cards[0]! : undefined;
      const builder = crewMemberById(
        crew,
        stackedCards(crew).at(-1)?.builderId,
      );
      rows.push({
        id: "batch",
        kind: "ready",
        text: single ? single.title : plural(batch.cards.length, "change"),
        line: single
          ? [
              builder ? name(builder.id) : "",
              batch.status.startsWith(`${single.title} · `)
                ? batch.status.slice(single.title.length + 3)
                : batch.status,
            ]
              .filter(Boolean)
              .join(" · ")
          : batch.status,
        batch,
      });
    }
    for (const row of view.ready)
      if (!row.boardActions)
        rows.push({
          id: `ready:${row.id}`,
          kind: "ready",
          text: row.title,
          line: row.status,
          cardId: row.id,
          // Work you don't want goes, after asking.
          actions: row.actions.some((action) => action.id === "throw-away")
            ? row.actions
            : [...row.actions, { id: "throw-away", label: "Throw away" }],
        });
    for (const card of stuck)
      rows.push({
        id: `stuck:${card.id}`,
        kind: "answer",
        text: card.title,
        ...(card.stuck?.text ? { line: card.stuck.text } : {}),
        cardId: card.id,
        actions: [{ id: "answer", label: "Answer", primary: true }],
      });
    for (const card of columns.idea) {
      const give = card.crew?.actions.find((action) => action.id === "give");
      if (!give || card.crew?.later) continue;
      // Set aside with Not now: it waits behind the "set aside" line.
      const aside = !!crew.notNow?.includes(card.id);
      // Avos's pick of the Builder's model and effort, while it chooses.
      const pick = avosPickOverride(
        crewMember(crew, "builder"),
        crew.ideas?.[card.id]?.pick,
      );
      const picked = pickLabel(pick);
      rows.push({
        id: `idea:${card.id}`,
        kind: "idea",
        text: card.title,
        ...(card.crew?.line ? { line: card.crew.line } : {}),
        ...(picked ? { pick: picked } : {}),
        cardId: card.id,
        actions: aside ? [give] : [give, { id: "not-now", label: "Not now" }],
        deletable: true,
        ...(aside ? { aside: true as const } : {}),
      });
    }
    return rows;
  }, [view.batch, view.ready, stuck, columns.idea, crew, name]);
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
  const glance = avosGlance(project, crew, { name, jobs });
  const profileProps: AvosProfileProps = {
    project,
    crew,
    glance,
    line: headerLine(crew, view.sentence, avosReviews(project, jobs), name),
    goal: view.goal,
    watching: week.watching,
    members,
    dailyCap,
    now,
    onOpen: open,
    onHelper: (id) => {
      setSheet(null);
      save("chat");
      chat.current?.select(id);
    },
    onNotes: () => {
      setSheet(null);
      setNotes(true);
    },
    onActivity: () => {
      setSheet(null);
      setActivity(true);
    },
    onReview: () => {
      setSheet(null);
      setReviewing(true);
    },
    batch: view.batch ?? null,
    name,
  };
  const panelProps: AvosPanelProps = {
    ...profileProps,
    tab,
    onTab: setTab,
    jobs: avosJobs(project, agents),
    runs,
    shipped: [...columns.shipped].sort((a, b) => b.at - a.at),
    range,
    onOpenJob: (id) => {
      setSheet(null);
      openAutomation(id);
    },
  };
  return (
    <section
      ref={measure}
      className="team-screen avos-screen"
      data-team-view={shown}
      data-meeting={meeting || undefined}
      data-narrow={narrow || undefined}
      data-reviewing={(reviewing && !!view.batch && !narrow) || undefined}
      aria-label={`${projectDisplayName(project, labels)}'s Avos`}
    >
      <div className="avos-main">
        {meeting || !narrow ? null : (
          <AvosPanelBar {...panelProps} sheet={sheet} onSheet={setSheet} />
        )}
        {/* The chat stays put under the Board, so its place and what you
            were writing are there when you come back. */}
        <div className="avos-body" hidden={shown !== "chat"}>
          <TeamChat
            project={project}
            crew={crew}
            now={now}
            name={name}
            {...(fixer ? { fixer } : {})}
            forYou={
              <AvosForYou
                project={project}
                crew={crew}
                asks={asks}
                range={range}
                problems={problems}
                onReview={() => setReviewing(true)}
                onAct={act}
              />
            }
            forYouKey={asks
              .filter((ask) => !ask.aside)
              .map((ask) => ask.id)
              .join(",")}
            onCards={() => {
              // Answer on its card: its question, in its own sheet.
              if (stuck[0]) setAnswering(stuck[0].id);
            }}
            onSelected={() => undefined}
            control={chat}
          />
        </div>
        {shown === "board" ? (
          <div className="avos-body avos-pane">
            <p className="avos-board-back">
              <button
                type="button"
                className="crew-pipe-link"
                onClick={() => save("chat")}
              >
                Back to the chat
              </button>
            </p>
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
          </div>
        ) : null}
      </div>
      {meeting || narrow ? null : reviewing && view.batch ? (
        <AvosReview
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
      ) : (
        <AvosPanel {...panelProps} />
      )}
      {sheet ? (
        <Modal
          onClose={() => setSheet(null)}
          title={AVOS_TABS.find((entry) => entry.id === sheet)?.label ?? "Avos"}
          leading={
            <CrewCritter
              path={project}
              role="lead"
              state={glance.state}
              className="avos-sheet-mark"
            />
          }
          className="avos-profile-sheet"
        >
          <div
            className="avos-sheet-body avos-panel-sheet"
            data-avos-sheet={sheet}
          >
            <AvosTabBody {...panelProps} tab={sheet} />
          </div>
        </Modal>
      ) : null}
      {activity ? (
        <Modal
          onClose={() => setActivity(false)}
          title="Activity"
          {...(view.limits ? { description: view.limits } : {})}
          size="lg"
          className="avos-activity-sheet"
        >
          <div className="crew-activity" data-avos-activity>
            <CrewFeed crew={crew} name={name} />
          </div>
        </Modal>
      ) : null}
      {notes ? (
        <Modal
          onClose={() => setNotes(false)}
          title="What Avos remembers"
          description="Your rules, and what it learned about this project"
          className="avos-notes-sheet"
        >
          <div className="avos-sheet-body">
            <TeamNotes crew={crew} />
          </div>
        </Modal>
      ) : null}
      {reviewing && view.batch && narrow ? (
        <CrewBatchSheet
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
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
    </section>
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
