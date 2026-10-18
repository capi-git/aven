import { useContext, useMemo } from "react";
import { useTeamRun } from "../hooks/useTeamRuns";
import { memberVoice, teamMascots } from "../lib/discussionVoices";
import type { OrchestrationRun } from "../lib/orchestration";
import { orchestrationStatusWord } from "../lib/orchestrationSummary";
import type { TeamMember } from "../lib/teamRuns";
import { agentNameWithModel } from "../lib/agentNames";
import { useTeamWorkspace } from "../lib/teamWorkspace";
import { plural } from "../lib/words";
import { OrchestrationActions } from "./OrchestrationActions";
import {
  TeamCard,
  TeamCardButton,
  TeamCardMember,
  TeamFaces,
  type TeamCardTone,
} from "./TeamCard";

const MEMBER_TONE: Record<
  TeamMember["state"],
  "live" | "needs-you" | "done" | "failed" | "muted"
> = {
  working: "live",
  "lead-deciding": "live",
  "needs-you": "needs-you",
  done: "done",
  failed: "failed",
  interrupted: "failed",
  stopped: "muted",
  queued: "muted",
};

/** The most mascots in the header; the rows show every agent. */
const FACES = 5;

/**
 * An orchestration's card once its plan is confirmed: the lead and its
 * agents, each with its state and what it is doing, then, once the run is
 * over, its result: the lead's one-line verdict, one row per agent (title,
 * model, Accepted / Cancelled / Failed, files touched, and a line on what it
 * did once the cheap model has written one), Review changes and Open
 * agents. Show plan unfolds the plan it started from. Stop run is the bar's.
 * Until the run's record exists it shows that the run is starting, so the
 * plan's card never blinks out.
 */
export function OrchestrationTeamCard({
  run,
  modelName,
  planShown,
  onTogglePlan,
}: {
  run: OrchestrationRun;
  /** A model id's display name, from the plan's choices. */
  modelName: (harness: TeamMember["harness"], model: string) => string;
  planShown: boolean;
  onTogglePlan: () => void;
}) {
  const actions = useContext(OrchestrationActions);
  const workspace = useTeamWorkspace();
  const team = useTeamRun(`orchestrate:${run.leadId}`, { detail: true });
  const voices = useMemo(() => {
    if (!team) return [];
    const mascots = teamMascots(team.members.map((member) => member.sessionId));
    return team.members.map((member, index) =>
      memberVoice(member, mascots[index], index === 0),
    );
  }, [team]);
  if (!team)
    return (
      <TeamCard
        kind="orchestrate"
        bare
        tone="live"
        attributes={{ "data-orchestration-run": run.leadId }}
        faces={<TeamFaces voices={[]} />}
        title={run.title || "Run"}
        badge="Starting"
        status="Starting the run…"
      />
    );
  const over = run.status === "finished" || run.status === "stopped";
  const workers = team.members.slice(1);
  const tone: TeamCardTone =
    run.status === "finished"
      ? "done"
      : run.status === "stopped"
        ? "stopped"
        : team.status === "needs-you"
          ? "needs-you"
          : "live";
  const status = over
    ? team.result?.why ||
      (run.status === "finished"
        ? "The lead finished without a closing note."
        : "Stopped before the lead finished.")
    : team.status === "needs-you" && team.need
      ? team.need.text
      : team.progress;
  const openAgents =
    actions?.openAgents && run.tasks.length
      ? () =>
          actions.openAgents?.(
            run.tasks.map((task) => ({
              sessionId: task.sessionId,
              leadId: run.leadId,
              title: task.title,
              harness: task.harness,
            })),
          )
      : undefined;
  const openAgent = actions?.openAgents
    ? (sessionId: string) => {
        const task = run.tasks.find((entry) => entry.sessionId === sessionId);
        if (task)
          actions.openAgents?.([
            {
              sessionId: task.sessionId,
              leadId: run.leadId,
              title: task.title,
              harness: task.harness,
            },
          ]);
      }
    : undefined;
  // The per-agent lines are written after the run finishes, by the cheap
  // model; say so while they are written, and when they could not be.
  const summaries =
    run.status === "finished" && run.tasks.length
      ? run.summaries === "running"
        ? "Writing a line on what each agent did…"
        : run.summaries === "failed"
          ? "Couldn't write the summaries. Open agents to read their replies."
          : undefined
      : undefined;
  const shown = voices.slice(0, FACES);
  return (
    <TeamCard
      kind="orchestrate"
      bare
      tone={tone}
      attributes={{
        "data-orchestration-review": "",
        "data-orchestration-run": run.leadId,
        ...(over ? { "data-orchestration-ended": run.status } : {}),
      }}
      faces={<TeamFaces voices={shown} />}
      title={over ? (team.result?.headline ?? team.title) : team.title}
      badge={
        <span data-orchestration-status>
          {orchestrationStatusWord(run.status)}
        </span>
      }
      status={status}
      statusTitle={status}
      members={
        workers.length
          ? workers.map((member, index) => {
              // "Codex GPT-5": the agent's app and model, as the panel says.
              const model = agentNameWithModel({
                harness: member.harness,
                model: modelName(member.harness, member.model),
              });
              const files = member.changes?.files;
              return (
                <TeamCardMember
                  key={member.sessionId}
                  voice={voices[index + 1]}
                  name={member.label}
                  nameTitle={`${member.label} · ${member.fullName ?? model}`}
                  onOpen={openAgent && (() => openAgent(member.sessionId))}
                  detail={
                    over
                      ? member.summary
                        ? `${model} · ${member.summary}`
                        : model
                      : member.state === "lead-deciding"
                        ? `${model} · Lead deciding`
                        : member.doing
                          ? `${model} · ${member.doing}`
                          : model
                  }
                  state={member.stateLabel}
                  tone={MEMBER_TONE[member.state]}
                  attributes={{
                    "data-orchestration-agent": member.sessionId,
                    "data-orchestration-task-status": member.stateLabel,
                  }}
                  meta={
                    files ? <span>{plural(files, "file")}</span> : undefined
                  }
                />
              );
            })
          : undefined
      }
      actions={
        <>
          {over && run.status === "finished" ? (
            <TeamCardButton
              data-orchestration-review-changes
              onClick={() => workspace?.reviewChanges(run.cwd)}
            >
              Review changes
            </TeamCardButton>
          ) : null}
          {openAgents ? (
            <TeamCardButton
              title="Open the agents' chats beside the lead"
              onClick={openAgents}
            >
              Open agents
            </TeamCardButton>
          ) : null}
          {!over && workspace?.watch ? (
            <TeamCardButton
              data-team-watch={team.id}
              title="Watch the run in a floating panel"
              onClick={() => workspace.watch?.(team.id)}
            >
              Watch
            </TeamCardButton>
          ) : null}
          <button
            type="button"
            className="team-card-toggle"
            aria-expanded={planShown}
            onClick={onTogglePlan}
          >
            {planShown ? "Hide plan" : "Show plan"}
          </button>
        </>
      }
    >
      {!workers.length && !over ? (
        <p className="team-card-note">
          The lead hasn't handed out any tasks yet.
        </p>
      ) : null}
      {summaries ? (
        <p
          className="team-card-note"
          role="status"
          data-orchestration-summaries={run.summaries}
        >
          {summaries}
        </p>
      ) : null}
    </TeamCard>
  );
}
