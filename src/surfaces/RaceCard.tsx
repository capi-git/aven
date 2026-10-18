import {
  memo,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
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
import { LiveSessionsContext } from "../lib/liveSessions";
import {
  getRace,
  noteRaceStats,
  raceHost,
  subscribeRaces,
  useRaceWorkspace,
  type RaceRecord,
} from "../lib/race";
import { appName } from "../lib/agentNames";
import {
  raceLaneName,
  raceReviewerName,
  raceSuggestionText,
} from "../lib/raceLanes";
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
import type { TeamMember, TeamRun } from "../lib/teamRuns";
import { useTeamWorkspace } from "../lib/teamWorkspace";
import { RaceReviewerPicker } from "./RaceReviewerPicker";
import { listText, plural } from "../lib/words";

/** How a race explains itself while its agents work. */
export const RACE_EXPLAINER =
  "Each agent works separately. Your project doesn't change until you keep one.";

/** What a race with no agent working says, by how its agents ended. */
export function readyText(members: readonly Pick<TeamMember, "state">[]) {
  const done = members.filter((member) => member.state === "done").length;
  if (done === members.length)
    return "Every agent is done. Compare their changes and keep one.";
  if (done)
    return "No agent is working now. Compare their changes to keep one, or open Compare to retry the others.";
  return "Every agent was stopped. Open Compare to retry one, keep what they wrote, or discard the race.";
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
 * A race in the chat it was sent from, after your message: one row per
 * agent (mascot, name, state, time, +/−) with Compare while it runs; "Ready
 * to compare" with Suggest a winner once no agent works; then the result,
 * "Kept Codex's version · 7 files" with why, Review changes and Continue
 * with the agent. Stop race is the bar's, in the message box below.
 */
export const RaceCard = memo(function RaceCard({ raceId }: { raceId: string }) {
  const workspace = useRaceWorkspace();
  const teamActions = useTeamWorkspace();
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
        status="This race is no longer available. Aven keeps the 20 most recent finished races."
        attributes={{ "data-race-card": raceId }}
      />
    );
  const names = listText(team.members.map((member) => member.label));
  const kept = race.state === "kept";
  const over = race.state !== "running";
  const ready = team.status === "ready";
  const needsYou = team.status === "needs-you";
  const suggestion = race.suggestion;
  const suggesting = suggestionRunning(suggestion);
  const review = race.review;
  const reviewing = reviewRunning(
    review,
    Date.now(),
    review ? live?.session(review.sessionId) : undefined,
  );
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
  const suggested = raceSuggestionText(race);
  const reviewerName = raceReviewerName(race);
  const status = kept
    ? continueError
      ? continueError
      : team.result?.why
        ? `Why: ${team.result.why}`
        : "Kept in your project."
    : over
      ? "Your project didn't change."
      : needsYou && team.need
        ? team.need.text
        : suggesting
          ? "Suggesting a winner…"
          : reviewing && review
            ? `${reviewerName} is comparing the agents' work…`
            : suggested
              ? suggested
              : review?.status === "failed" && ready
                ? (review.error ??
                  "The reviewer didn't pick one. Read its reply in its chat, or compare the agents' changes.")
                : suggestion?.status === "failed" && ready
                  ? "Couldn't suggest a winner. Compare the agents' changes to choose."
                  : ready
                    ? readyText(team.members)
                    : RACE_EXPLAINER;
  const continueAt = continueLane(race);
  const continueWith =
    continueAt !== undefined && race.lanes[continueAt]
      ? raceLaneName(race, continueAt)
      : undefined;
  const suggest = () =>
    void requestRaceSuggestion(
      race.id,
      (id) => live?.session(id),
      team.members.map((member) => member.stateLabel),
    );
  const askReviewer = (choice: ReviewerChoice) => {
    const send = teamActions?.send;
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
          suggestion?.status === "done" &&
          suggestion.by === "reviewer" &&
          race.lanes[suggestion.lane]
            ? raceLaneName(race, suggestion.lane)
            : undefined;
        const stateLabel = reviewing
          ? "Reviewing"
          : review.status === "done"
            ? "Done"
            : review.status === "failed"
              ? review.error
                ? "Not sent"
                : "No pick"
              : "Stopped";
        return {
          voice: memberVoice(
            {
              sessionId: review.sessionId,
              harness: review.harness,
              label: appName(review.harness),
              fullName: review.label,
              stateLabel,
              agentRole: review.role,
            },
            mascots[mascots.length - 1],
          ),
          stateLabel,
          detail: reviewing
            ? "Comparing the agents' work"
            : pick
              ? `Suggests ${pick}`
              : review.status === "failed" && !review.error
                ? "Didn't pick one"
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
                  name={reviewerName}
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
                onClick={() => teamActions?.reviewChanges(race.project)}
              >
                Review changes
              </TeamCardButton>
              {continueWith ? (
                <TeamCardButton
                  data-race-continue
                  disabled={!!race.continuedAt || continuing}
                  title={
                    race.continuedAt
                      ? `Recap sent to ${continueWith}`
                      : "Send this agent a short recap so it can carry on in your project"
                  }
                  onClick={() => {
                    setContinuing(true);
                    setContinueError(null);
                    void continueRace(race.id, teamActions?.send).then(
                      (error) => {
                        setContinuing(false);
                        setContinueError(error);
                      },
                    );
                  }}
                >
                  {race.continuedAt
                    ? `Continued with ${continueWith}`
                    : continuing
                      ? "Sending recap…"
                      : `Continue with ${continueWith}`}
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
                {team.members.find(
                  (member) => member.sessionId === team.need?.sessionId,
                )?.label ?? "chat"}
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
            {teamActions?.watch ? (
              <TeamCardButton
                data-team-watch={team.id}
                title="Watch the race in a floating panel"
                onClick={() => teamActions?.watch?.(team.id)}
              >
                Watch
              </TeamCardButton>
            ) : null}
            {ready && suggestion?.status !== "done" ? (
              <>
                <TeamCardButton
                  data-race-suggest
                  disabled={suggesting || reviewing}
                  title={
                    reviewing
                      ? "Wait for the reviewer to finish first."
                      : "Ask the cheapest model which result to keep, from the agents' last replies and changes"
                  }
                  onClick={suggest}
                >
                  {suggesting ? "Suggesting…" : "Suggest a winner"}
                </TeamCardButton>
                <RaceReviewerPicker
                  choices={() => (live ? reviewerChoices(race, live) : [])}
                  originId={race.origin?.sessionId}
                  disabled={suggesting || reviewing || !live}
                  reviewing={reviewing}
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
