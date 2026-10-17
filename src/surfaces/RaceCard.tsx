import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { Popover } from "../chrome/Popover";
import {
  LineChanges,
  MemberClock,
  TeamCard,
  TeamCardButton,
  TeamCardMember,
  TeamFaces,
  type TeamCardTone,
} from "../chrome/TeamCard";
import { useTeamRun } from "../hooks/useTeamRuns";
import { memberVoice, teamMascots } from "../lib/discussionVoices";
import { moveMenuFocus } from "../lib/keyboard";
import { LiveSessionsContext } from "../lib/liveSessions";
import {
  getRace,
  noteRaceStats,
  raceHost,
  raceWorkspace,
  subscribeRaces,
  type RaceRecord,
} from "../lib/race";
import { reviewerChoices, type ReviewerChoice } from "../lib/raceReviewers";
import {
  askRaceReviewer,
  continueLane,
  continueRace,
  requestRaceSuggestion,
  reviewRunning,
  suggestionRunning,
  type ReviewSend,
} from "../lib/teamResult";
import { raceAgentNames, raceShortNames } from "../lib/raceNames";
import type { TeamMember, TeamRun } from "../lib/teamRuns";
import { teamWorkspace } from "../lib/teamWorkspace";

/** "A", "A and B", "A, B and C". */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** What a race with no agent working says, by how its agents ended. */
export function readyText(members: readonly Pick<TeamMember, "state">[]) {
  const done = members.filter((member) => member.state === "done").length;
  if (done === members.length)
    return "Every agent is done. Compare their changes and keep one.";
  if (done)
    return "No agent is working now. Compare their changes and keep one, or retry the others.";
  return "Every agent was stopped. Retry one, compare what they wrote, or discard the race.";
}

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

/**
 * Each lane's changes, read again when a lane's state moves: on the card's
 * first showing and after each lane's turn. No timer: the overview refreshes
 * the numbers while it is open, and both keep them with the race.
 */
export function useRaceStats(
  race: RaceRecord | undefined,
  team: TeamRun | null,
) {
  const running = race?.state === "running";
  const key = team?.members.map((member) => member.state).join(" ") ?? "";
  const raceId = race?.id;
  const base = race?.base;
  const paths = race?.lanes.map((lane) => lane.path).join("\n") ?? "";
  useEffect(() => {
    if (!running || !raceId || !base || !paths) return;
    let cancelled = false;
    void Promise.all(
      paths
        .split("\n")
        .map((path) => raceHost.diff(path, base).catch(() => undefined)),
    ).then((diffs) => {
      if (!cancelled) noteRaceStats(raceId, diffs);
    });
    return () => {
      cancelled = true;
    };
  }, [base, key, paths, raceId, running]);
}

/**
 * Ask a reviewer: the chats that could compare the agents' results as a
 * Reviewer. The chosen chat gets the comparison as your message.
 */
function ReviewerButton({
  race,
  disabled,
  onPick,
}: {
  race: RaceRecord;
  disabled: boolean;
  onPick: (choice: ReviewerChoice) => void;
}) {
  const live = useContext(LiveSessionsContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choices = open && live ? reviewerChoices(race, live) : [];
  return (
    <>
      <TeamCardButton
        ref={anchor}
        data-race-review-ask
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || !live}
        title="Send the agents' results to a chat of your choice, to compare them as a Reviewer"
        onClick={() => setOpen((value) => !value)}
      >
        Ask a reviewer
      </TeamCardButton>
      {open ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={280}
          autoFocus
          tabIndex={-1}
          aria-label="Ask a reviewer"
          onKeyDown={moveMenuFocus}
          onDismiss={() => setOpen(false)}
          data-race-reviewers
          className="p-1 outline-none"
        >
          <p className="px-2 pb-1 pt-1.5 text-ui-caption leading-4 text-content/50">
            The chat you pick gets the agents' last replies and changes, with a
            Reviewer's instruction, and suggests one to keep.
          </p>
          {choices.length ? (
            choices.map((choice) => (
              <button
                key={choice.sessionId}
                type="button"
                data-race-reviewer={choice.sessionId}
                disabled={!!choice.busy}
                title={
                  choice.busy
                    ? `${choice.title}: ${choice.busy}`
                    : `${choice.title} · ${choice.label}`
                }
                onClick={() => {
                  setOpen(false);
                  onPick(choice);
                }}
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-ui-body text-content/85 hover:bg-content/5 hover:text-content disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <HarnessIcon
                  harness={choice.harness}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">
                  {choice.sessionId === race.origin?.sessionId
                    ? "This chat"
                    : choice.title}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-ui-caption text-content/45">
                  {choice.busy ?? choice.label}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-2 text-ui-label text-content/45">
              No other chat in this project can review it.
            </p>
          )}
        </Popover>
      ) : null}
    </>
  );
}

/**
 * A race in the chat it was sent from, after your message: one row per
 * lane (mascot, model, state, time, +/−) with Compare while it runs; "Ready
 * to compare" with Suggest a winner once every lane is done; then the result,
 * "Kept Codex · GPT-5's version (7 files)" with why, Review changes and
 * Continue with the agent. Stop all is the bar's, in the message box below.
 */
export const RaceCard = memo(function RaceCard({ raceId }: { raceId: string }) {
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const race = useSyncExternalStore(
    subscribeRaces,
    () => getRace(raceId),
    () => undefined,
  );
  const team = useTeamRun(`race:${raceId}`, { detail: true });
  useRaceStats(race, team);
  const live = useContext(LiveSessionsContext);
  // The team keeps its identity until something it shows changes.
  const voices = useMemo(() => {
    if (!team) return [];
    const mascots = teamMascots(team.members.map((member) => member.sessionId));
    return team.members.map((member, index) =>
      memberVoice(member, mascots[index], index === 0),
    );
  }, [team]);
  if (!race || !team)
    return (
      <TeamCard
        kind="race"
        tone="stopped"
        faces={null}
        title="Race"
        status="This race is no longer kept."
        attributes={{ "data-race-card": raceId }}
      />
    );
  const workspace = raceWorkspace();
  const names = listNames(raceShortNames(team.members));
  const kept = race.state === "kept";
  const over = race.state !== "running";
  const ready = team.status === "ready";
  const needsYou = team.status === "needs-you";
  const suggestion = race.suggestion;
  const suggesting = suggestionRunning(suggestion);
  const review = race.review;
  const reviewing = reviewRunning(review);
  const tone: TeamCardTone = kept
    ? "done"
    : over
      ? "stopped"
      : needsYou
        ? "needs-you"
        : ready
          ? "ready"
          : "live";
  const keptLane =
    kept && race.outcome?.kind === "lane" ? race.outcome.lane : undefined;
  const title = over
    ? (team.result?.headline ?? "Race")
    : ready
      ? "Ready to compare"
      : `${names} are racing`;
  const suggested =
    suggestion?.status === "done" && race.lanes[suggestion.lane]
      ? `${suggestion.by === "reviewer" ? `${suggestion.model}, as Reviewer, suggests` : "Suggested:"} ${race.lanes[suggestion.lane].label} — ${suggestion.why}`
      : undefined;
  const status = kept
    ? continueError
      ? continueError
      : team.result?.why
        ? `Why: ${team.result.why}`
        : "Your project has the kept changes."
    : over
      ? "Your project is unchanged."
      : needsYou && team.need
        ? team.need.text
        : suggesting
          ? "Suggesting a winner…"
          : reviewing && review
            ? `${review.label} is reviewing their results as a Reviewer…`
            : suggested
              ? suggested
              : review?.status === "failed" && ready
                ? "The reviewer didn't name a winner. Read its reply in its chat, or compare their changes."
                : suggestion?.status === "failed" && ready
                  ? "Couldn't suggest a winner. Compare their changes to choose."
                  : ready
                    ? readyText(team.members)
                    : "Each agent works in its own copy. Your project is unchanged until you keep one.";
  const continueAt = continueLane(race);
  const continueWith =
    continueAt !== undefined ? race.lanes[continueAt] : undefined;
  const suggest = () =>
    void requestRaceSuggestion(
      race.id,
      (id) => live?.session(id),
      team.members.map((member) => member.stateLabel),
    );
  const askReviewer = (choice: ReviewerChoice) => {
    const send = teamWorkspace()?.send;
    if (!send) return;
    void askRaceReviewer(
      race.id,
      choice,
      (id) => live?.session(id),
      team.members.map((member) => member.stateLabel),
      send as ReviewSend,
    );
  };
  // The reviewer stands beside the lanes, wearing its role.
  const reviewer = review
    ? (() => {
        const mascots = teamMascots([
          ...team.members.map((member) => member.sessionId),
          review.sessionId,
        ]);
        const pick =
          suggestion?.status === "done" && suggestion.by === "reviewer"
            ? race.lanes[suggestion.lane]
            : undefined;
        const stateLabel = reviewing
          ? "Reviewing"
          : review.status === "done"
            ? "Done"
            : review.status === "failed"
              ? "No pick"
              : "Stopped";
        return {
          voice: memberVoice(
            {
              sessionId: review.sessionId,
              harness: review.harness,
              label: review.label,
              stateLabel,
              agentRole: review.role,
            },
            mascots[mascots.length - 1],
          ),
          stateLabel,
          detail: reviewing
            ? "Comparing the agents' results"
            : pick
              ? `Suggests ${pick.label}`
              : review.status === "failed"
                ? "Didn't name a winner"
                : undefined,
        };
      })()
    : undefined;
  return (
    <TeamCard
      kind="race"
      tone={tone}
      attributes={{
        "data-race-card": race.id,
        "data-race-card-state": kept
          ? "kept"
          : over
            ? "discarded"
            : ready
              ? "ready"
              : team.status,
      }}
      faces={<TeamFaces voices={voices} />}
      title={title}
      badge={
        over
          ? undefined
          : needsYou
            ? "Needs you"
            : team.progress.replace(/^Ready to compare · /, "")
      }
      status={status}
      statusTitle={typeof status === "string" ? status : undefined}
      members={team.members
        .map((member, index) => {
          const changes = member.changes;
          const isKept = keptLane === index;
          return (
            <TeamCardMember
              key={member.sessionId}
              voice={voices[index]}
              name={member.label}
              detail={
                member.state === "needs-you"
                  ? member.asking?.text
                  : member.state === "working"
                    ? member.doing
                    : suggestion?.status === "done" &&
                        suggestion.lane === index &&
                        !over
                      ? "Suggested winner"
                      : undefined
              }
              state={isKept ? "Kept" : member.stateLabel}
              tone={isKept ? "done" : MEMBER_TONE[member.state]}
              attributes={{
                "data-race-card-lane": String(index),
                "data-lane-state": member.state,
              }}
              meta={
                <>
                  <MemberClock
                    startedAt={member.startedAt}
                    durationMs={member.durationMs}
                    running={member.state === "working"}
                  />
                  {changes ? (
                    <>
                      <LineChanges
                        additions={changes.additions}
                        deletions={changes.deletions}
                      />
                      <span>{plural(changes.files, "file")}</span>
                    </>
                  ) : null}
                </>
              }
              onOpen={
                workspace
                  ? () => workspace.openChat(member.sessionId)
                  : undefined
              }
            />
          );
        })
        .concat(
          reviewer && review
            ? [
                <TeamCardMember
                  key={`review:${review.sessionId}`}
                  voice={reviewer.voice}
                  name={review.label}
                  detail={reviewer.detail}
                  state={reviewer.stateLabel}
                  tone={
                    reviewing
                      ? "live"
                      : review.status === "failed"
                        ? "muted"
                        : "done"
                  }
                  attributes={{ "data-race-reviewer-row": review.sessionId }}
                  onOpen={
                    workspace
                      ? () => workspace.openChat(review.sessionId)
                      : undefined
                  }
                />,
              ]
            : [],
        )}
      actions={
        over ? (
          kept ? (
            <>
              <TeamCardButton
                data-race-review
                onClick={() => teamWorkspace()?.reviewChanges(race.project)}
              >
                Review changes
              </TeamCardButton>
              {continueWith ? (
                <TeamCardButton
                  data-race-continue
                  disabled={!!race.continuedAt || continuing}
                  title={
                    race.continuedAt
                      ? `${continueWith.label} has its recap`
                      : "Send this agent a short recap, to carry on in the project"
                  }
                  onClick={() => {
                    setContinuing(true);
                    setContinueError(null);
                    void continueRace(race.id, teamWorkspace()?.send).then(
                      (error) => {
                        setContinuing(false);
                        setContinueError(error);
                      },
                    );
                  }}
                >
                  {race.continuedAt
                    ? `Continued with ${continueWith.label}`
                    : `Continue with ${continueWith.label}`}
                </TeamCardButton>
              ) : null}
            </>
          ) : null
        ) : (
          <>
            {needsYou && team.need?.blocking && workspace ? (
              <TeamCardButton
                onClick={() => workspace.openChat(team.need!.sessionId)}
              >
                Go to{" "}
                {raceAgentNames(team.members)[
                  team.members.findIndex(
                    (member) => member.sessionId === team.need?.sessionId,
                  )
                ] ?? "chat"}
              </TeamCardButton>
            ) : null}
            {workspace ? (
              <TeamCardButton
                variant={ready ? "primary" : "default"}
                data-race-compare
                onClick={() => workspace.compare(race.id)}
              >
                Compare
              </TeamCardButton>
            ) : null}
            {teamWorkspace()?.watch ? (
              <TeamCardButton
                data-team-watch={team.id}
                title="Watch the agents in a floating panel"
                onClick={() => teamWorkspace()?.watch?.(team.id)}
              >
                Watch
              </TeamCardButton>
            ) : null}
            {ready && suggestion?.status !== "done" ? (
              <>
                <TeamCardButton
                  data-race-suggest
                  disabled={suggesting || reviewing}
                  title="Ask the cheapest model which result to keep, from the agents' last replies and changes"
                  onClick={suggest}
                >
                  {suggesting ? "Suggesting…" : "Suggest a winner"}
                </TeamCardButton>
                <ReviewerButton
                  race={race}
                  disabled={suggesting || reviewing}
                  onPick={askReviewer}
                />
              </>
            ) : null}
          </>
        )
      }
    />
  );
});
