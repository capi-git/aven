import {
  memo,
  useContext,
  useEffect,
  useMemo,
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
import {
  memberVoice,
  providerShortName,
  teamMascots,
} from "../lib/discussionVoices";
import { LiveSessionsContext } from "../lib/liveSessions";
import {
  getRace,
  noteRaceStats,
  raceHost,
  raceWorkspace,
  subscribeRaces,
  type RaceRecord,
} from "../lib/race";
import {
  continueLane,
  finalReply,
  raceContinueMessage,
  requestRaceSuggestion,
  suggestionRunning,
} from "../lib/teamResult";
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
 * lane (mascot, model, state, time, +/−) with Compare while it runs; "Ready
 * to compare" with Suggest a winner once every lane is done; then the result,
 * "Kept Codex · GPT-5's version (7 files)" with why, Review changes and
 * Continue with the agent. Stop all is the bar's, in the message box below.
 */
export const RaceCard = memo(function RaceCard({ raceId }: { raceId: string }) {
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
  const names = listNames(
    team.members.map((member) => providerShortName(member.harness)),
  );
  const kept = race.state === "kept";
  const over = race.state !== "running";
  const ready = team.status === "ready";
  const needsYou = team.status === "needs-you";
  const suggestion = race.suggestion;
  const suggesting = suggestionRunning(suggestion);
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
      ? `Suggested: ${race.lanes[suggestion.lane].label} — ${suggestion.why}`
      : undefined;
  const status = kept
    ? team.result?.why
      ? `Why: ${team.result.why}`
      : "Your project has the kept changes."
    : over
      ? "Your project is unchanged."
      : needsYou && team.need
        ? team.need.text
        : suggesting
          ? "Suggesting a winner…"
          : suggested
            ? suggested
            : suggestion?.status === "failed" && ready
              ? "Couldn't suggest a winner. Compare their changes to choose."
              : ready
                ? "Every agent is done. Compare their changes and keep one."
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
      members={team.members.map((member, index) => {
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
              workspace ? () => workspace.openChat(member.sessionId) : undefined
            }
          />
        );
      })}
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
                  onClick={() =>
                    void teamWorkspace()?.send(
                      continueWith.sessionId,
                      (blocks) => ({
                        text: raceContinueMessage(
                          race,
                          race.outcome?.files ?? 0,
                          finalReply(blocks),
                        ),
                        shown: "Carry on from the race: your version was kept.",
                      }),
                    )
                  }
                >
                  Continue with {continueWith.label}
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
                {team.members
                  .find((member) => member.sessionId === team.need?.sessionId)
                  ?.label.split(" · ")[0] ?? "chat"}
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
              <TeamCardButton
                data-race-suggest
                disabled={suggesting}
                title="Ask the cheapest model which result to keep, from the agents' last replies and changes"
                onClick={suggest}
              >
                {suggesting ? "Suggesting…" : "Suggest a winner"}
              </TeamCardButton>
            ) : null}
          </>
        )
      }
    />
  );
});
