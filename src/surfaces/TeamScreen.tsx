import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { CrewCritters } from "../chrome/CrewCritter";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { MoreHorizontal, Pause, Play } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
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
  crewTellWaiting,
  resumeCrewGoal,
  setCrewPaused,
  stopCrewNow,
  subscribeCrewTell,
  takeCrewReview,
  turnOffCrew,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { Pipeline } from "../lib/crewPipeline";
import { crewMembers, memberCritter, type Crew } from "../lib/crews";
import type { CrewBoardActionId } from "../lib/crewView";
import type { BotStatus } from "../lib/projectBots";
import type { TeamView } from "../lib/teamView";
import type { BoardCard, BoardColumnId } from "../lib/workBoard";
import { CrewFeed } from "./CrewBoard";
import { Segmented } from "./SettingsControls";
import { BatchCard, CrewBatchSheet } from "./TeamBatch";
import { TeamChat } from "./TeamChat";
import type { BoardTop } from "./WorkBoard";
import "./TeamScreen.css";

/**
 * A project's team, on its Board while the team is on: one header (its
 * name, one sentence on what it's doing and what waits for you, Board |
 * Chat, Team, Pause and ⋯), then the Board's four columns or the team's
 * chat. The Board unless you chose the Chat for this project.
 */
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
  /** The team's Fixer (the project bot), while it is on. */
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
  // Answer on its card shows the Board for now, and Tell the team… the
  // Chat; how this team opens stays what you chose with the switch.
  const [peek, setPeek] = useState<{ project: string; view: TeamView } | null>(
    null,
  );
  const mode = peek?.project === project ? peek.view : saved;
  const setMode = (view: TeamView) => {
    setPeek(null);
    save(view);
  };
  const [reviewing, setReviewing] = useState(false);
  const [activity, setActivity] = useState(false);
  useEffect(() => {
    // Review from the Inbox or a Ready card: the batch's Review opens here.
    // Tell the team… from the sidebar: the Chat shows, and its box takes it.
    const take = () => {
      if (takeCrewReview(project)) setReviewing(true);
      if (crewTellWaiting(project)) setPeek({ project, view: "chat" });
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
  // ⋯ → Set a goal…: the Chat shows, and its box turns to the goal.
  const goal = useRef<{ goal: () => void } | null>(null);
  const [goalAsked, setGoalAsked] = useState(false);
  useEffect(() => {
    if (!goalAsked || mode !== "chat" || !goal.current) return;
    goal.current.goal();
    setGoalAsked(false);
  }, [goalAsked, mode]);
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
        dailyCap={dailyCap}
        onMode={setMode}
        onSetGoal={() => {
          setPeek({ project, view: "chat" });
          setGoalAsked(true);
        }}
        onActivity={() => setActivity(true)}
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
          onCards={() => setPeek({ project, view: "board" })}
          control={goal}
        />
      ) : (
        <div className="work-board-columns" data-team-board={project}>
          {sections(
            view.batch
              ? {
                  review: {
                    node: (
                      <BatchCard
                        crew={crew}
                        batch={view.batch}
                        range={range}
                        onReview={() => setReviewing(true)}
                      />
                    ),
                    covers: new Set(view.batch.cards.map((card) => card.id)),
                    count: view.batch.cards.length,
                  },
                }
              : {},
          )}
        </div>
      )}
      {reviewing && view.batch ? (
        <CrewBatchSheet
          crew={crew}
          project={project}
          onClose={() => setReviewing(false)}
        />
      ) : null}
      {activity ? (
        <Modal
          onClose={() => setActivity(false)}
          title="Activity"
          description={`${projectDisplayName(project, labels)} team · ${view.limits}`}
          className="crew-activity"
        >
          <CrewFeed crew={crew} name={name} />
        </Modal>
      ) : null}
    </section>
  );
}

/**
 * The team's one header: its name, one sentence (the card it names in
 * bold), its goal, Board | Chat, Team (its marks), Pause and ⋯.
 */
function TeamHeader({
  crew,
  project,
  view,
  mode,
  dailyCap,
  onMode,
  onSetGoal,
  onActivity,
}: {
  crew: Crew;
  project: string;
  view: Pipeline;
  mode: TeamView;
  dailyCap: boolean;
  onMode: (mode: TeamView) => void;
  onSetGoal: () => void;
  onActivity: () => void;
}) {
  const labels = useProjectLabels();
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const name = projectDisplayName(crew.path, labels);
  const { sentence, focus, goal } = view;
  const faces = crewMembers(crew).map((member) => ({
    id: member.id,
    role: member.role,
    ...(member.critter ? { critter: memberCritter(member) } : {}),
  }));
  const working = crew.members.find((member) => member.doing)?.id;
  const goalGoing = !!goal && (goal.state === "on" || goal.state === "waits");
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "stop", label: "Stop now" },
    ...(dailyCap
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    goalGoing
      ? { kind: "item", id: "clear-goal", label: "Clear the goal" }
      : { kind: "item", id: "goal", label: "Set a goal…" },
    { kind: "item", id: "activity", label: "Activity" },
    { kind: "sep" },
    { kind: "item", id: "off", label: "Turn the team off" },
  ];
  // The card the sentence names stands out, once.
  const at = focus ? sentence.indexOf(focus) : -1;
  return (
    <header className="team-head" data-crew-header={crew.path}>
      <ProjectMark path={project} className="team-head-mark" />
      <div className="team-head-heading">
        <h1>{name}</h1>
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
                  : goal.state === "waits"
                    ? ` · ${goal.why ?? "waits"}`
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
            { value: "board", label: "Board" },
            { value: "chat", label: "Chat" },
          ]}
          onChange={onMode}
        />
        <TeamCardButton
          className="team-head-team"
          title="Your teammates: add one, or change what one does"
          onClick={() => workspace?.openSettings(crew.path)}
        >
          <CrewCritters path={project} roles={faces} max={4} active={working} />
          <span>Team</span>
        </TeamCardButton>
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
            else if (id === "activity") onActivity();
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
