import { memo, useMemo, useRef, type CSSProperties } from "react";
import { useMotionOnChange } from "../hooks/useMotionOnChange";
import { useTeamAct } from "../hooks/useTeamAct";
import { RoleBadge } from "../chrome/AgentRoles";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import {
  ArrowRight,
  Check,
  GitCompare,
  Play,
  Sparkles,
  Square,
} from "../chrome/icons";
import { LineChanges, MemberClock, TeamCardButton } from "../chrome/TeamCard";
import { agentNameWithModel, appName } from "../lib/agentNames";
import {
  memberVoice,
  teamMascots,
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
import { plural } from "../lib/words";
import { DiscussionThreadPanel } from "./DiscussionPanel";
import { RaceReviewerPicker } from "./RaceReviewerPicker";
import { TeamPanelBar, type TeamPanelControls } from "./TeamPanelBar";
import "./TeamWatchPanel.css";

/** The most mascots in the header; the rows below show every member. */
const FACES = 6;

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
  const statusRef = useRef<HTMLParagraphElement>(null);
  useMotionOnChange(statusRef, status);
  const tone = teamTone(team);
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
              title={`${member.fullName ?? member.label} · ${member.stateLabel}`}
            >
              <DiscussionAvatar
                voice={voice}
                size="large"
                typing={member.state === "working"}
              />
              <span className="team-watch-tile-name">
                {member.role === "lead"
                  ? "Lead"
                  : member.role === "worker"
                    ? appName(member.harness)
                    : member.label}
              </span>
            </li>
          );
        })}
        {more > 0 ? <li className="team-watch-more">+{more}</li> : null}
      </ul>
      <p
        ref={statusRef}
        className="team-watch-status"
        data-tone={tone}
        title={status}
      >
        {status}
      </p>
      {/* Said aloud when it changes what you should do, not on each tick. */}
      <span className="sr-only" aria-live="polite">
        {tone === "live" ? "" : status}
      </span>
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
    if (team.status === "needs-you" && team.need)
      return `Needs you · ${team.need.text}`;
    if (team.status === "ready") return team.progress;
    return `${memberNames(team.members)} are racing · ${team.progress}`;
  }
  if (team.kind === "orchestrate") {
    if (team.status === "finished" || team.status === "stopped")
      return team.result?.headline ?? team.progress;
    if (view.run?.stalled)
      return "Needs you · The lead stopped without finishing.";
    if (team.status === "needs-you" && team.need)
      return team.need.kind === "paused"
        ? `Paused · ${team.need.text}`
        : `Needs you · ${team.need.text}`;
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
  const action = useTeamAct(act);
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
          kind={team.kind}
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
        <RunRows
          view={view}
          voices={voices}
          run={action.run}
          pending={action.pending}
        />
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
  const review = view.race?.review;
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
      {review && !over ? <RaceReviewer review={review} team={team} /> : null}
      {suggestion?.status === "done" && !over ? (
        <p className="team-watch-suggestion" data-team-suggestion>
          <Sparkles className="size-3 shrink-0" />
          <span>
            {suggestion.by
              ? `${review ? appName(review.harness) : suggestion.by} (Reviewer)`
              : "Aven"}{" "}
            suggests {team.members[suggestion.lane]?.label ?? "an agent"}:{" "}
            {suggestion.why}
          </span>
        </p>
      ) : review?.status === "failed" && team.status === "ready" ? (
        <p className="team-watch-suggestion" data-team-suggestion="failed">
          {review.error ??
            "The reviewer didn't pick one. Read its reply in its chat, or compare the agents' changes."}
        </p>
      ) : suggestion?.status === "failed" && team.status === "ready" ? (
        <p className="team-watch-suggestion" data-team-suggestion="failed">
          Couldn't suggest a winner. Compare the agents' changes to choose.
        </p>
      ) : null}
    </div>
  );
}

/** The chat asked to review the race, with its role on its mascot. */
function RaceReviewer({
  review,
  team,
}: {
  review: NonNullable<NonNullable<TeamWatchView["race"]>["review"]>;
  team: TeamRun;
}) {
  const voice = useMemo(() => {
    const mascots = teamMascots([
      ...team.members.map((member) => member.sessionId),
      review.sessionId,
    ]);
    return memberVoice(
      {
        sessionId: review.sessionId,
        harness: review.harness,
        label: appName(review.harness),
        fullName: review.label,
        stateLabel: "",
        agentRole: "reviewer",
      },
      mascots[mascots.length - 1],
    );
  }, [review.harness, review.label, review.sessionId, team.members]);
  return (
    <p
      className="team-watch-suggestion"
      data-team-reviewer={review.sessionId}
      data-review-state={review.status}
    >
      <span
        className="team-watch-member-face"
        style={{ "--discussion-voice": voice.color } as CSSProperties}
        aria-hidden
      >
        <DiscussionAvatar voice={voice} typing={review.status === "running"} />
      </span>
      <span className="min-w-0 flex-1" title={review.label}>
        {voice.name}{" "}
        {review.status === "running"
          ? "is comparing the agents' work…"
          : review.status === "done"
            ? "has picked."
            : "didn't pick one."}
      </span>
      <RoleBadge role="reviewer" />
    </p>
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
        <span
          className="team-watch-name"
          title={member.fullName ?? member.label}
        >
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
        <TeamCardButton
          variant="needs-you"
          size="compact"
          className="self-start"
          data-team-goto={member.sessionId}
          title={`Open ${member.label}'s chat`}
          onClick={() =>
            run({ kind: "open-chat", sessionId: member.sessionId })
          }
        >
          <ArrowRight className="size-3" />
          Go to chat
        </TeamCardButton>
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
  const model = agentNameWithModel(member);
  if (over && member.summary) return `${model} · ${member.summary}`;
  // What it asks names it already.
  if (member.state === "lead-deciding")
    return member.asking
      ? `Lead deciding: ${member.asking.text}`
      : `${model} · Lead deciding`;
  // A request the lead left unanswered, which is now yours.
  if (member.state === "needs-you" && member.asking) return member.asking.text;
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
  pending,
}: {
  view: TeamWatchView;
  voices: readonly DiscussionVoice[];
  run: (action: TeamWatchAction) => void;
  pending: TeamWatchAction["kind"] | null;
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
            <TeamCardButton
              size="compact"
              data-team-finish
              disabled={pending === "finish"}
              title="End the run as it is. Tasks that never started are cancelled."
              onClick={() => run({ kind: "finish" })}
            >
              <Check className="size-3" strokeWidth={2} />
              Finish run
            </TeamCardButton>
          ) : (
            <TeamCardButton
              size="compact"
              data-team-resume
              disabled={lead?.state === "working" || pending === "resume"}
              title={
                lead?.state === "working"
                  ? "Wait for the lead to finish its turn, then resume."
                  : "Resume the run"
              }
              onClick={() => run({ kind: "resume" })}
            >
              <Play className="size-3" />
              Resume
            </TeamCardButton>
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
            nameTitle={`Lead · ${lead.fullName ?? lead.label}`}
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
            nameTitle={
              member.fullName
                ? `${member.label} · ${member.fullName}`
                : member.label
            }
            detail={workerDetail(member, over)}
            files={filesLine(member)}
            canOpen={view.can.openChat}
            run={run}
          />
        ))}
      </ul>
      {!workers.length && !over ? (
        <p className="team-watch-verdict" data-team-empty>
          The lead hasn't handed out any tasks yet.
        </p>
      ) : null}
    </div>
  );
}

const RunRow = memo(function RunRow({
  member,
  voice,
  name,
  nameTitle = name,
  detail,
  files,
  canOpen,
  run,
}: {
  member: TeamMember;
  voice: DiscussionVoice;
  name: string;
  nameTitle?: string;
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
        {member.agentRole ? (
          <span className="team-watch-name-line">
            <span className="team-watch-name" title={nameTitle}>
              {name}
            </span>
            <RoleBadge role={member.agentRole} />
          </span>
        ) : (
          <span className="team-watch-name" title={nameTitle}>
            {name}
          </span>
        )}
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
          title={
            member.role === "lead"
              ? "Open the lead's chat"
              : `Open the chat for “${member.label}”`
          }
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
    const reviewing =
      view.race?.review?.status === "running" || pending === "review";
    // One judge at a time: a suggestion and a review never overwrite each
    // other's pick.
    const judging = suggesting || reviewing;
    const reviewers = view.race?.reviewers;
    if (!open) return null;
    return (
      <div className="team-watch-actions">
        {view.can.compare ? (
          <TeamCardButton
            variant={team.status === "ready" ? "primary" : "default"}
            data-team-compare
            title="Compare the agents' changes and keep one"
            onClick={() => run({ kind: "compare" })}
          >
            <GitCompare className="size-3" strokeWidth={1.75} />
            Compare
          </TeamCardButton>
        ) : null}
        {team.status === "ready" && suggestion?.status !== "done" ? (
          <TeamCardButton
            data-team-suggest
            disabled={judging}
            title={
              reviewing
                ? "Wait for the reviewer to finish first."
                : "Ask the cheapest model which result to keep, from the agents' last replies and changes"
            }
            onClick={() => run({ kind: "suggest" })}
          >
            {suggesting ? "Suggesting…" : "Suggest a winner"}
          </TeamCardButton>
        ) : null}
        {team.status === "ready" &&
        suggestion?.status !== "done" &&
        reviewers ? (
          // The window that owns the race lists the chats and checks the
          // one picked again before asking it.
          <RaceReviewerPicker
            choices={() => reviewers}
            originId={team.origin.sessionId}
            disabled={judging}
            reviewing={reviewing}
            side="top"
            align="end"
            onPick={(choice) =>
              run({ kind: "review", sessionId: choice.sessionId })
            }
          />
        ) : null}
        {working ? (
          <TeamCardButton
            data-team-stop="race"
            disabled={pending === "stop"}
            title="Stop every agent still working. You can still compare what they wrote."
            onClick={() => run({ kind: "stop" })}
          >
            <Square className="size-2.5" />
            Stop race
          </TeamCardButton>
        ) : null}
      </div>
    );
  }
  const agents = team.members.length > 1;
  if (!open && !(agents && view.can.openAgents)) return null;
  return (
    <div className="team-watch-actions">
      {agents && view.can.openAgents ? (
        <TeamCardButton
          data-team-open-agents
          title="Open the agents' chats beside the lead"
          onClick={() => run({ kind: "open-agents" })}
        >
          <ArrowRight className="size-3" />
          Open agents
        </TeamCardButton>
      ) : null}
      {open ? (
        <TeamCardButton
          data-team-stop="run"
          disabled={pending === "stop"}
          title="Stop the lead and every agent in this run"
          onClick={() => run({ kind: "stop" })}
        >
          <Square className="size-2.5" />
          Stop run
        </TeamCardButton>
      ) : null}
    </div>
  );
}
