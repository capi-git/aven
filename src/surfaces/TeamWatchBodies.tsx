import { memo, useMemo, useState, type CSSProperties } from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { Check, ExternalLink, Play, Sparkles, Square } from "../chrome/icons";
import { LineChanges, MemberClock } from "../chrome/TeamCard";
import {
  memberVoice,
  providerShortName,
  teamMascots,
  voiceName,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import type { TeamMember, TeamRun } from "../lib/teamRuns";
import {
  memberNames,
  teamTone,
  teamWatchTitle,
  type TeamTone,
  type TeamWatchAct,
  type TeamWatchAction,
  type TeamWatchView,
} from "../lib/teamWatch";
import { DiscussionThreadPanel } from "./DiscussionPanel";
import { TeamPanelBar, type TeamPanelControls } from "./TeamPanelBar";
import "./TeamWatchPanel.css";

/** The most mascots in the header; the rows below show every member. */
const FACES = 6;

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

/** Each member's face, as the team's cards draw it. */
export function useTeamVoices(team: TeamRun | null): DiscussionVoice[] {
  return useMemo(() => {
    if (!team) return [];
    const mascots = teamMascots(team.members.map((member) => member.sessionId));
    return team.members.map((member, index) =>
      memberVoice(member, mascots[index], index === 0),
    );
  }, [team]);
}

/**
 * Runs an action from a button, keeping its refusal to show and disabling
 * the button while a slower one (from a window of its own) is answered.
 */
function useAct(act: TeamWatchAct) {
  const [pending, setPending] = useState<TeamWatchAction["kind"] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (action: TeamWatchAction) => {
    setProblem(null);
    let result: ReturnType<TeamWatchAct>;
    try {
      result = act(action);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!(result instanceof Promise)) {
      setProblem(result);
      return;
    }
    setPending(action.kind);
    void result.then(
      (refused) => {
        setPending(null);
        setProblem(refused);
      },
      (error: unknown) => {
        setPending(null);
        setProblem(error instanceof Error ? error.message : String(error));
      },
    );
  };
  return { run, pending, problem };
}

/**
 * A member's tone, for its state label and its tile's glow. An agent whose
 * request its lead decides reads neutral: it is not yours to answer.
 */
function memberTone(
  member: TeamMember,
): TeamTone | "failed" | "muted" | "deciding" {
  switch (member.state) {
    case "working":
      return "live";
    case "lead-deciding":
      return "deciding";
    case "needs-you":
      return "needs-you";
    case "done":
      return "done";
    case "failed":
    case "interrupted":
      return "failed";
    default:
      return "muted";
  }
}

/**
 * The header's face-off, for a team of any size: every member's mascot on
 * its tile, the ones at work glowing in their colour and the one waiting on
 * you in amber, then one status line.
 */
export const TeamFaceoff = memo(function TeamFaceoff({
  team,
  voices,
  status,
}: {
  team: TeamRun;
  voices: readonly DiscussionVoice[];
  status: string;
}) {
  const shown = team.members.slice(0, FACES);
  const more = team.members.length - shown.length;
  return (
    <div className="team-watch-faceoff" data-team-cast>
      <ul className="team-watch-tiles" aria-hidden>
        {shown.map((member, index) => {
          const voice = voices[index];
          const tone = memberTone(member);
          return (
            <li
              key={member.sessionId}
              className="team-watch-tile"
              data-tone={tone}
              data-active={member.state === "working" || undefined}
              style={{ "--discussion-voice": voice.color } as CSSProperties}
              title={`${member.label} · ${member.stateLabel}`}
            >
              <DiscussionAvatar
                voice={voice}
                size="large"
                typing={member.state === "working"}
              />
              <span className="team-watch-tile-name">
                {member.role === "lead"
                  ? "Lead"
                  : providerShortName(member.harness)}
              </span>
            </li>
          );
        })}
        {more > 0 ? <li className="team-watch-more">+{more}</li> : null}
      </ul>
      <p
        className="team-watch-status"
        data-tone={teamTone(team)}
        role="status"
        title={status}
      >
        {status}
      </p>
    </div>
  );
});

/** The header's status line for a race or a run. */
export function teamWatchStatus(view: TeamWatchView): string {
  const { team } = view;
  if (team.kind === "race") {
    if (team.status === "finished" || team.status === "stopped")
      return team.result?.why
        ? `${team.progress} · ${team.result.why}`
        : team.progress;
    if (team.status === "needs-you" && team.need) return team.need.text;
    if (team.status === "ready") return team.progress;
    return `${memberNames(team.members)} are racing · ${team.progress}`;
  }
  if (team.kind === "orchestrate") {
    if (team.status === "finished" || team.status === "stopped")
      return team.result?.headline ?? team.progress;
    if (view.run?.stalled) return "The lead stopped without finishing";
    if (team.status === "needs-you" && team.need)
      return team.need.kind === "paused"
        ? `Paused · ${team.need.text}`
        : team.need.text;
    return `Orchestrating · ${team.progress}`;
  }
  return team.progress;
}

/**
 * One team's panel from its view: a discussion's thread, a race's lanes or
 * a run's lead and agents. The same in the window that owns the team and
 * in a window of its own; `act` does what its buttons ask.
 */
export function TeamWatchPanelView({
  view,
  act,
  controls,
}: {
  view: TeamWatchView;
  act: TeamWatchAct;
  controls?: TeamPanelControls;
}) {
  if (view.team.kind === "discuss" && view.discussion)
    return (
      <DiscussionThreadPanel
        discussion={view.discussion.record}
        items={view.discussion.items}
        cwd={view.discussion.cwd}
        act={act}
        can={{
          jumpIn: view.can.jumpIn,
          build: view.can.build,
          openChat: view.can.openChat,
        }}
        controls={controls}
      />
    );
  return <TeamBody view={view} act={act} controls={controls} />;
}

/** A race's or a run's panel. */
const TeamBody = memo(function TeamBody({
  view,
  act,
  controls,
}: {
  view: TeamWatchView;
  act: TeamWatchAct;
  controls?: TeamPanelControls;
}) {
  const { team } = view;
  const voices = useTeamVoices(team);
  const action = useAct(act);
  return (
    <div
      className="team-watch-view"
      data-team-view={team.id}
      data-team-kind={team.kind}
      data-status={team.status}
    >
      <div className="discussion-float-head">
        <TeamPanelBar
          title={teamWatchTitle(team)}
          fullTitle={team.title}
          controls={controls}
        />
        <TeamFaceoff
          team={team}
          voices={voices}
          status={teamWatchStatus(view)}
        />
      </div>
      {team.kind === "race" ? (
        <RaceLanes view={view} voices={voices} run={action.run} />
      ) : (
        <RunRows view={view} voices={voices} run={action.run} />
      )}
      {action.problem ? (
        <p className="team-watch-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
      <TeamActions view={view} run={action.run} pending={action.pending} />
    </div>
  );
});

// --- A race ---------------------------------------------------------------------------

/**
 * One column per lane, side by side when the panel is wide and stacked when
 * it is narrow: its mascot and model, its state and clock, what it is doing,
 * its changes, the first lines of its last reply once it stopped, and a way
 * to its chat when it needs you.
 */
function RaceLanes({
  view,
  voices,
  run,
}: {
  view: TeamWatchView;
  voices: readonly DiscussionVoice[];
  run: (action: TeamWatchAction) => void;
}) {
  const { team } = view;
  const suggestion = view.race?.suggestion;
  const over = team.status === "finished" || team.status === "stopped";
  return (
    <div className="team-watch-body">
      <ol
        className="team-watch-lanes"
        data-lanes={team.members.length}
        aria-label="Agents"
      >
        {team.members.map((member, index) => (
          <RaceLane
            key={member.sessionId}
            member={member}
            index={index}
            voice={voices[index]}
            kept={view.race?.kept === index}
            suggested={
              !over &&
              suggestion?.status === "done" &&
              suggestion.lane === index
            }
            canOpen={view.can.openChat}
            run={run}
          />
        ))}
      </ol>
      {suggestion?.status === "done" && !over ? (
        <p className="team-watch-suggestion" data-team-suggestion>
          <Sparkles className="size-3 shrink-0" />
          <span>
            Suggested: {team.members[suggestion.lane]?.label ?? "an agent"} —{" "}
            {suggestion.why}
          </span>
        </p>
      ) : suggestion?.status === "failed" && team.status === "ready" ? (
        <p className="team-watch-suggestion" data-team-suggestion="failed">
          Couldn't suggest a winner. Compare their changes to choose.
        </p>
      ) : null}
    </div>
  );
}

const RaceLane = memo(function RaceLane({
  member,
  index,
  voice,
  kept,
  suggested,
  canOpen,
  run,
}: {
  member: TeamMember;
  index: number;
  voice: DiscussionVoice;
  kept: boolean;
  suggested: boolean;
  canOpen: boolean;
  run: (action: TeamWatchAction) => void;
}) {
  const tone = kept ? "done" : memberTone(member);
  const changes = member.changes;
  return (
    <li
      className="team-watch-lane"
      data-team-lane={index}
      data-lane-state={member.state}
      data-tone={tone}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <div className="team-watch-lane-head">
        <span className="team-watch-member-face" aria-hidden>
          <DiscussionAvatar voice={voice} typing={member.state === "working"} />
        </span>
        <span className="team-watch-name" title={member.label}>
          {member.label}
        </span>
      </div>
      <div className="team-watch-lane-state">
        <span className="team-watch-state" data-tone={tone}>
          {kept ? "Kept" : member.stateLabel}
        </span>
        <MemberClock
          startedAt={member.startedAt}
          durationMs={member.durationMs}
          running={member.state === "working"}
        />
      </div>
      {member.state === "working" && member.doing ? (
        <p className="team-watch-doing" title={member.doing}>
          {member.doing}
        </p>
      ) : null}
      {member.state === "needs-you" && member.asking ? (
        <p className="team-watch-asking" title={member.asking.text}>
          {member.asking.text}
        </p>
      ) : null}
      {changes ? (
        <p className="team-watch-numbers">
          <LineChanges
            additions={changes.additions}
            deletions={changes.deletions}
          />
          <span>{plural(changes.files, "file")}</span>
        </p>
      ) : null}
      {member.reply ? (
        <p className="team-watch-reply" title={member.reply}>
          <span>{member.reply}</span>
        </p>
      ) : null}
      {suggested ? (
        <span className="team-watch-tag">
          <Sparkles className="size-3" />
          Suggested winner
        </span>
      ) : null}
      {member.state === "needs-you" && canOpen ? (
        <button
          type="button"
          className="team-watch-needs"
          data-team-goto={member.sessionId}
          title={`Open ${member.label}'s chat`}
          onClick={() =>
            run({ kind: "open-chat", sessionId: member.sessionId })
          }
        >
          Needs you · Go to chat
        </button>
      ) : null}
    </li>
  );
});

// --- An orchestration -------------------------------------------------------------------

/** "App.tsx, Form.tsx +2". */
function filesLine(member: TeamMember): string | undefined {
  const files = member.files ?? [];
  const total = member.changes?.files ?? files.length;
  if (!total) return undefined;
  if (!files.length) return plural(total, "file");
  const names = files.slice(0, 3).map(basename).join(", ");
  return total > 3 ? `${names} +${total - 3}` : names;
}

/** What a worker's second line says: what it does, waits for, or asks. */
function workerDetail(member: TeamMember, over: boolean): string {
  const model = voiceName(member);
  if (over && member.summary) return `${model} · ${member.summary}`;
  if (member.state === "lead-deciding")
    return member.asking
      ? `${model} · Lead deciding: ${member.asking.text}`
      : `${model} · its lead is deciding a request`;
  if (member.state === "working" && member.doing)
    return `${model} · ${member.doing}`;
  if (member.state === "queued" && member.waiting)
    return `${model} · ${member.waiting}`;
  return model;
}

/**
 * The lead's row, then a row per agent: its task, model and state, what it
 * is doing, waiting for or asking its lead, and the files it touched. A
 * paused or stalled run says why first, with Resume or Finish run.
 */
function RunRows({
  view,
  voices,
  run,
}: {
  view: TeamWatchView;
  voices: readonly DiscussionVoice[];
  run: (action: TeamWatchAction) => void;
}) {
  const { team } = view;
  const [lead, ...workers] = team.members;
  const over = team.status === "finished" || team.status === "stopped";
  const paused = team.status === "needs-you" && team.need?.kind === "paused";
  const stalled = !!view.run?.stalled && !over;
  return (
    <div className="team-watch-body">
      {paused || stalled ? (
        <div
          className="team-watch-notice"
          data-team-notice={stalled ? "stalled" : "paused"}
        >
          <p>
            {stalled
              ? "The lead stopped without finishing. Finish the run as it is, or ask the lead in its chat to wrap up."
              : team.need?.text}
          </p>
          {stalled ? (
            <button
              type="button"
              className="discussion-action"
              data-team-finish
              title="End the run as it is. Tasks that never started are cancelled."
              onClick={() => run({ kind: "finish" })}
            >
              <Check className="size-3" strokeWidth={2} />
              Finish run
            </button>
          ) : (
            <button
              type="button"
              className="discussion-action"
              data-team-resume
              disabled={lead?.state === "working"}
              onClick={() => run({ kind: "resume" })}
            >
              <Play className="size-3" />
              Resume
            </button>
          )}
        </div>
      ) : null}
      {over && team.result?.why ? (
        <p className="team-watch-verdict">{team.result.why}</p>
      ) : null}
      <ul className="team-watch-rows" aria-label="Lead and agents">
        {lead ? (
          <RunRow
            member={lead}
            voice={voices[0]}
            name={`Lead · ${lead.label}`}
            detail={
              lead.state === "working" && lead.doing
                ? lead.doing
                : lead.state === "needs-you" && lead.asking
                  ? lead.asking.text
                  : undefined
            }
            canOpen={view.can.openChat}
            run={run}
          />
        ) : null}
        {workers.map((member, index) => (
          <RunRow
            key={member.sessionId}
            member={member}
            voice={voices[index + 1]}
            name={member.label}
            detail={workerDetail(member, over)}
            files={filesLine(member)}
            canOpen={view.can.openChat}
            run={run}
          />
        ))}
      </ul>
    </div>
  );
}

const RunRow = memo(function RunRow({
  member,
  voice,
  name,
  detail,
  files,
  canOpen,
  run,
}: {
  member: TeamMember;
  voice: DiscussionVoice;
  name: string;
  detail?: string;
  files?: string;
  canOpen: boolean;
  run: (action: TeamWatchAction) => void;
}) {
  const tone = memberTone(member);
  const body = (
    <>
      <span
        className="team-watch-member-face"
        style={{ "--discussion-voice": voice.color } as CSSProperties}
        aria-hidden
      >
        <DiscussionAvatar voice={voice} typing={member.state === "working"} />
      </span>
      <span className="team-watch-row-text">
        <span className="team-watch-name" title={name}>
          {name}
        </span>
        {detail ? (
          <span className="team-watch-detail" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
      <span className="team-watch-row-side">
        <span className="team-watch-state" data-tone={tone}>
          {member.stateLabel}
        </span>
        {files ? (
          <span className="team-watch-files" title={member.files?.join("\n")}>
            {files}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li
      className="team-watch-row"
      data-team-member={member.sessionId}
      data-role={member.role}
      data-member-state={member.state}
    >
      {canOpen ? (
        <button
          type="button"
          className="team-watch-row-open"
          title={`Open ${member.role === "lead" ? "the lead's" : `${member.label}'s`} chat`}
          onClick={() =>
            run({ kind: "open-chat", sessionId: member.sessionId })
          }
        >
          {body}
        </button>
      ) : (
        <span className="team-watch-row-open">{body}</span>
      )}
    </li>
  );
});

// --- The actions at the bottom ----------------------------------------------------------

function TeamActions({
  view,
  run,
  pending,
}: {
  view: TeamWatchView;
  run: (action: TeamWatchAction) => void;
  pending: TeamWatchAction["kind"] | null;
}) {
  const { team } = view;
  const open = team.status !== "finished" && team.status !== "stopped";
  if (team.kind === "race") {
    const working = team.members.some(
      (member) => member.state === "working" || member.state === "needs-you",
    );
    const suggestion = view.race?.suggestion;
    const suggesting =
      suggestion?.status === "running" || pending === "suggest";
    if (!open) return null;
    return (
      <div className="team-watch-actions">
        {view.can.compare ? (
          <button
            type="button"
            className="team-watch-button"
            data-variant={team.status === "ready" ? "primary" : undefined}
            data-team-compare
            title="Compare the agents' changes and keep one"
            onClick={() => run({ kind: "compare" })}
          >
            Compare
          </button>
        ) : null}
        {team.status === "ready" && suggestion?.status !== "done" ? (
          <button
            type="button"
            className="team-watch-button"
            data-team-suggest
            disabled={suggesting}
            title="Ask the cheapest model which result to keep, from the agents' last replies and changes"
            onClick={() => run({ kind: "suggest" })}
          >
            {suggesting ? "Suggesting…" : "Suggest a winner"}
          </button>
        ) : null}
        {working ? (
          <button
            type="button"
            className="team-watch-button"
            data-team-stop="race"
            disabled={pending === "stop"}
            title="Stop every agent still working in this race"
            onClick={() => run({ kind: "stop" })}
          >
            <Square className="size-2.5" />
            Stop all
          </button>
        ) : null}
      </div>
    );
  }
  const agents = team.members.length > 1;
  if (!open && !(agents && view.can.openAgents)) return null;
  return (
    <div className="team-watch-actions">
      {agents && view.can.openAgents ? (
        <button
          type="button"
          className="team-watch-button"
          data-team-open-agents
          title="Open the agents' chats beside the lead"
          onClick={() => run({ kind: "open-agents" })}
        >
          <ExternalLink className="size-3" />
          Open agents
        </button>
      ) : null}
      {open ? (
        <button
          type="button"
          className="team-watch-button"
          data-team-stop="run"
          disabled={pending === "stop"}
          title="Stop the lead and every agent in this run"
          onClick={() => run({ kind: "stop" })}
        >
          <Square className="size-2.5" />
          Stop run
        </button>
      ) : null}
    </div>
  );
}
