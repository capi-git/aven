import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { MoreHorizontal, Pause, Play } from "../chrome/icons";
import { ProjectMark } from "../chrome/ProjectMark";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useTeamPipeline } from "../hooks/useTeamPipeline";
import { useTeamView } from "../hooks/useTeamView";
import {
  allowMoreRunsToday,
  clearCrewGoal,
  resumeCrewGoal,
  setCrewPaused,
  stopCrewNow,
  subscribeCrewTell,
  takeCrewReview,
  turnOffCrew,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { Pipeline } from "../lib/crewPipeline";
import type { Crew } from "../lib/crews";
import type { CrewBoardActionId } from "../lib/crewView";
import type { BotStatus } from "../lib/projectBots";
import type { TeamView } from "../lib/teamView";
import type { BoardAction, BoardCard, BoardColumnId } from "../lib/workBoard";
import { Segmented } from "./SettingsControls";
import { CrewBatchSheet, CrewPipeline } from "./CrewPipeline";
import { TeamChat } from "./TeamChat";
import "./TeamScreen.css";

/**
 * A project's team, on its Board while the team is on: one header (its
 * mark, name, one sentence on what it's doing and what needs you, Chat |
 * Cards, Pause and ⋯), then its Chat (a roster and the team thread) or its
 * Cards (the Pipeline). Chat unless you chose Cards for this project.
 */
export function TeamScreen({
  project,
  crew,
  fixer,
  columns,
  now,
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
  /** The team's Fixer (the project bot), while it is on. */
  fixer?: { status: BotStatus; runs: number; sessionId?: string };
  columns: Readonly<Record<BoardColumnId, readonly BoardCard[]>>;
  now: number;
  /** A member's name, by its id or role. */
  name: (who: string) => string;
  answering: string | null;
  onAnswerDone: () => void;
  problems: Readonly<Record<string, string>>;
  editing: string | null;
  onCrewAction: (card: BoardCard, id: CrewBoardActionId) => void;
  onMenu: (cardId: string, anchor: HTMLElement) => void;
  onChoose: (cardId: string, anchor: HTMLElement) => void;
  boardButtons: (card: BoardCard, actions: readonly BoardAction[]) => ReactNode;
  editor: (card: BoardCard) => ReactNode;
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
  const { view, range, dailyCap } = useTeamPipeline({
    project,
    crew,
    cards,
    now,
    fixerRuns: fixer?.runs ?? 0,
    name,
  });
  const labels = useProjectLabels();
  const [mode, setMode] = useTeamView(project);
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
  // ⋯ → Set a goal…: the box on screen (the chat's, or the Cards' task box)
  // takes it.
  const goal = useRef<{ goal: () => void } | null>(null);
  const count =
    (view.batch?.cards.length ?? 0) +
    view.ready.length +
    view.inProgress.length +
    view.upNext.length;
  return (
    <section
      className="team-screen"
      data-team-view={mode}
      aria-label={`${projectDisplayName(project, labels)} team`}
    >
      <TeamHeader
        crew={crew}
        project={project}
        view={view}
        mode={mode}
        count={count}
        dailyCap={dailyCap}
        onMode={setMode}
        onSetGoal={() => goal.current?.goal()}
      />
      {mode === "chat" ? (
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
          onCards={() => setMode("cards")}
          control={goal}
        />
      ) : (
        <CrewPipeline
          project={project}
          crew={crew}
          view={view}
          range={range}
          columns={columns}
          name={name}
          answering={answering}
          onAnswerDone={onAnswerDone}
          problems={problems}
          editing={editing}
          onCrewAction={onCrewAction}
          onMenu={onMenu}
          onChoose={onChoose}
          onReview={() => setReviewing(true)}
          boardButtons={boardButtons}
          editor={editor}
          addIdea={addIdea}
          taskBox={goal}
        />
      )}
      {reviewing && view.batch ? (
        <CrewBatchSheet
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * The team's one header: its mark and name, one sentence (the card it
 * names in bold), its goal, Chat | Cards, Pause and ⋯.
 */
function TeamHeader({
  crew,
  project,
  view,
  mode,
  count,
  dailyCap,
  onMode,
  onSetGoal,
}: {
  crew: Crew;
  project: string;
  view: Pipeline;
  mode: TeamView;
  /** Cards the team has now, for the Cards switch. */
  count: number;
  dailyCap: boolean;
  onMode: (mode: TeamView) => void;
  onSetGoal: () => void;
}) {
  const labels = useProjectLabels();
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const name = projectDisplayName(crew.path, labels);
  const { sentence, focus, goal } = view;
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
    { kind: "item", id: "off", label: "Turn the team off" },
  ];
  // The card the sentence names stands out, once.
  const at = focus ? sentence.indexOf(focus) : -1;
  return (
    <header className="team-head" data-crew-header={crew.path}>
      <ProjectMark path={project} className="team-head-mark" />
      <div className="team-head-heading">
        <h1>{name} team</h1>
        <p className="team-head-sentence" data-crew-sentence>
          {at >= 0 ? (
            <>
              {sentence.slice(0, at)}
              <b>{focus}</b>
              {sentence.slice(at + focus!.length)}
            </>
          ) : (
            sentence
          )}
          {view.offerScout && workspace ? (
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
          <p className="team-head-goal" data-crew-goal={goal.state}>
            <span className="team-head-goal-word">Goal</span> {goal.text}
            <span>
              {goal.state === "met"
                ? " · met"
                : goal.state === "stopped"
                  ? ` · stopped: ${goal.why ?? ""}`
                  : " · the team keeps going"}
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
      <div className="team-head-actions">
        <Segmented
          label="Show the team as"
          className="team-head-switch"
          value={mode}
          options={[
            { value: "chat", label: "Chat" },
            { value: "cards", label: count ? `Cards · ${count}` : "Cards" },
          ]}
          onChange={onMode}
        />
        <TeamCardButton
          onClick={() => setCrewPaused(crew.path, !crew.paused)}
          title={crew.paused ? "Resume the team" : "Pause the team"}
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
          aria-label="More for the team"
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
          ariaLabel={`${name} team actions`}
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
          title="Turn the team off?"
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
