import {
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useOrchestrationRun,
  useOrchestrationSelector,
} from "../hooks/useOrchestrationRun";
import { useMotionOnChange } from "../hooks/useMotionOnChange";
import { useTeamOf } from "../hooks/useTeamRuns";
import { discussionStore } from "../lib/discussions";
import { logError } from "../lib/errors";
import {
  blockingRunFor,
  busyProjectMessage,
  orchestrator,
  runWaitsOnLead,
  type OrchestrationRun,
} from "../lib/orchestration";
import { useRaceWorkspace } from "../lib/race";
import { useTeamWorkspace } from "../lib/teamWorkspace";
import {
  runActivityText,
  TEAM_KIND_LABEL,
  teamIsOpen,
  teamRole,
  type TeamRun,
} from "../lib/teamRuns";
import { TEAM_NOUN } from "../lib/teamWatch";
import { RoleBadge } from "./AgentRoles";
import { HarnessIcon } from "./HarnessIcon";
import { OrchestrationActions } from "./OrchestrationActions";
import { TeamCardButton } from "./TeamCard";
import { TeamRunDetails } from "./TeamRunDetails";
import {
  ArrowRight,
  Check,
  Eye,
  GitCompare,
  MessageSquare,
  Pause,
  Play,
  Race,
  Share,
  Square,
} from "./icons";
import "./ProviderMarks.css";
import "./SidebarDiscussions.css";

/** What "Ask the lead to wrap up" sends, as your own message to the lead. */
export const WRAP_UP_REQUEST =
  "Please wrap up this run: review each finished task, cancel anything that is no longer needed, then call finish. If something still needs my decision, ask me here.";

/**
 * How long a run must have nothing to do before the bar says the lead
 * stopped. Results reach the lead a moment after a worker finishes, so a
 * shorter wait would flash the message between turns.
 */
export const STALLED_AFTER_MS = 1_500;

/** "Orchestrating · 2 working", worded as the team's pill and panel word it. */
export function runningSummary(
  run: OrchestrationRun,
  leadIdle: boolean,
): string {
  return `Orchestrating · ${runActivityText(run, !leadIdle)}`;
}

/**
 * The one Stop a team's bar offers in this chat, or null. It is there only
 * where nothing else in the chat stops the same thing twice:
 *
 * - `discussion`: either chat of a discussion; stopping either chat's turn
 *   would end it too, so the chat's own Stop gives way to this one.
 * - `run`: an orchestration's lead; stopping the lead stops the run.
 * - `race`: the chat a race was sent from, while a lane still works. A lane
 *   chat keeps its own Stop, which stops that lane alone.
 */
export type TeamBarStop = "discussion" | "run" | "race";

export function teamBarStop(
  team: TeamRun,
  sessionId: string,
): TeamBarStop | null {
  if (!teamIsOpen(team) || team.status === "ready") return null;
  const role = teamRole(team, sessionId);
  if (team.kind === "discuss") return role ? "discussion" : null;
  if (team.kind === "orchestrate")
    return team.origin.sessionId === sessionId ? "run" : null;
  const lane = team.members.some((member) => member.sessionId === sessionId);
  const working = team.members.some(
    (member) => member.state === "working" || member.state === "needs-you",
  );
  return role === "origin" && !lane && working ? "race" : null;
}

/**
 * Whether this chat's own Stop (the one by its run status) would stop what
 * the bar's Stop already does, so only the bar's is shown.
 */
export function teamBarOwnsStop(
  team: TeamRun | null | undefined,
  sessionId: string,
): boolean {
  if (!team) return false;
  const stop = teamBarStop(team, sessionId);
  return stop === "discussion" || stop === "run";
}

/**
 * Whether the message box gives its Stop to the bar: only for a lead, whose
 * own Stop would stop the run as Stop run does. A discussion chat keeps the
 * box's Stop, which interrupts its agent at once, beside the bar's Stop
 * discussion, which lets a reply in progress finish.
 */
export function teamBarTakesBoxStop(
  team: TeamRun | null | undefined,
  sessionId: string,
): boolean {
  return !!team && teamBarStop(team, sessionId) === "run";
}

/** A member as the bar names it: "Codex", or a worker's task title. */
function memberName(team: TeamRun, sessionId: string): string | undefined {
  return team.members.find((member) => member.sessionId === sessionId)?.label;
}

/**
 * The bar's words in two parts: a short label ("Discussing · Paused",
 * "Racing · Needs you") and, when the team waits on you, what it needs in
 * plain words ("Codex wants to run npm test"), which may take a second line
 * rather than be cut off.
 */
export function teamBarParts(
  team: TeamRun,
  sessionId: string,
  options: { partnerTitle?: string } = {},
): { label: string; reason?: string } {
  const kind = `${team.preview ? "Preview · " : ""}${TEAM_KIND_LABEL[team.kind]}`;
  const need = team.need;
  if (team.status === "needs-you" && need) {
    if (need.kind === "paused")
      return { label: `${kind} · Paused`, reason: need.text };
    return { label: `${kind} · Needs you`, reason: need.text };
  }
  return { label: teamBarText(team, sessionId, options) };
}

/** "Discussing · Round 2 of 4 · with Codex in “Login fix”". */
export function teamBarText(
  team: TeamRun,
  sessionId: string,
  options: { partnerTitle?: string } = {},
): string {
  const kind = `${team.preview ? "Preview · " : ""}${TEAM_KIND_LABEL[team.kind]}`;
  const need = team.need;
  if (team.status === "needs-you" && need) {
    const { label, reason } = teamBarParts(team, sessionId, options);
    return reason ? `${label} · ${reason}` : label;
  }
  if (team.kind === "discuss") {
    const partner = team.members.find(
      (member) => member.sessionId !== sessionId,
    );
    const title = options.partnerTitle ? ` in “${options.partnerTitle}”` : "";
    return partner
      ? `${kind} · ${team.progress} · with ${partner.label}${title}`
      : `${kind} · ${team.progress}`;
  }
  return `${kind} · ${team.progress}`;
}

type Props = {
  sessionId: string;
  /** The folder this chat works in, to tell when another chat's run holds it. */
  cwd: string;
  /** The chat is not working, has nothing queued and is not asking you. */
  idle: boolean;
  /** Sends your own message to this chat. */
  onSubmit: (sessionId: string, text: string) => void;
  /** Stops this chat's turn; for a lead, the whole run. */
  onStop: (sessionId: string) => void;
  /** Shows a discussion's floating panel; absent where it cannot open. */
  onOpenDiscussion?: (id: string) => void;
};

/**
 * The one slim bar inside the message box of a team's chats: the chat a
 * discussion, race or orchestration started from, and its member chats. It
 * reads "<Discussing | Racing | Orchestrating> · <status>" with Watch,
 * Compare or Open agents, Resume while paused, Stop discussion, Stop race
 * or Stop run (see `teamBarStop`), and Go to <agent> when another chat
 * needs you. It also stands in for the chat's own status row while the
 * team runs: what the chat is doing, the run's elapsed time and its agents
 * (`TeamRunDetails`), so "2 working" is said once.
 * Another chat in a project an orchestration holds gets the reason and a
 * way to the lead. It renders only `TeamRun` data, so streaming in any of
 * the chats never renders it; the chat's own details are a leaf that reads
 * the chat from its pane.
 */
export const TeamBar = memo(function TeamBar(props: Props) {
  const team = useTeamOf(props.sessionId, { previews: true });
  if (teamBarShows(team, props.sessionId))
    return <OpenTeamBar team={team} {...props} />;
  return <BusyBar {...props} />;
});

/**
 * Whether this chat draws its team's bar: the team is still open and, for
 * an orchestration, this is its lead (workers have no message box).
 */
export function teamBarShows(
  team: TeamRun | null | undefined,
  sessionId: string,
): team is TeamRun {
  return (
    !!team &&
    teamIsOpen(team) &&
    (team.kind !== "orchestrate" || team.origin.sessionId === sessionId)
  );
}

function Frame({
  team,
  state,
  tall = false,
  children,
}: {
  team: Pick<TeamRun, "id" | "kind" | "key">;
  state: string;
  /** Its words may take two lines (a reason the team waits on you). */
  tall?: boolean;
  children: ReactNode;
}) {
  // Each kind keeps its own data attribute, for checks written against it.
  const legacy =
    team.kind === "discuss"
      ? { "data-discussion-bar": team.key }
      : team.kind === "race"
        ? { "data-race-bar": team.key }
        : { "data-orchestration-bar": team.key };
  return (
    <div
      className="px-2 pb-1"
      data-team-bar={team.id}
      data-team-kind={team.kind}
      {...legacy}
    >
      <div
        // Waiting on you reads amber (TeamCard.css); a race ready to
        // compare stays calm.
        className={`team-bar flex min-w-0 items-center gap-1.5 rounded-lg border border-content/10 bg-content/3 pl-2 pr-[3px] text-ui-label text-content/60 ${
          tall ? "min-h-7 py-1" : "h-7"
        }`}
        data-state={state}
      >
        {children}
      </div>
    </div>
  );
}

/** The bar's mark: the other side's provider while discussing, else the kind. */
function Mark({
  team,
  sessionId,
  paused,
}: {
  team: TeamRun;
  sessionId: string;
  paused: boolean;
}) {
  if (team.kind === "discuss") {
    const partner = team.members.find(
      (member) => member.sessionId !== sessionId,
    );
    if (partner)
      return (
        <span
          className="discussion-talk-mark"
          data-provider={partner.harness}
          data-talking={(!paused && partner.state === "working") || undefined}
          aria-hidden
        >
          <HarnessIcon harness={partner.harness} className="size-3.5" />
        </span>
      );
  }
  return (
    <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
      {paused ? (
        <Pause className="size-3.5" />
      ) : team.kind === "race" ? (
        <Race className="size-3.5" strokeWidth={1.75} />
      ) : (
        <Share className="size-3.5" strokeWidth={1.75} />
      )}
    </span>
  );
}

/** How long the lead has had nothing to do; the bar waits a moment first. */
function useStalled(run: OrchestrationRun | undefined, idle: boolean) {
  const waitsOnLead = !!run && idle && runWaitsOnLead(run);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!waitsOnLead) {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waitsOnLead]);
  return stalled && waitsOnLead;
}

function OpenTeamBar({
  team,
  sessionId,
  idle,
  onSubmit,
  onStop,
  onOpenDiscussion,
}: Props & { team: TeamRun }) {
  const actions = useContext(OrchestrationActions);
  const teamActions = useTeamWorkspace();
  const raceActions = useRaceWorkspace();
  const lead = team.kind === "orchestrate" ? team.key : undefined;
  const run = useOrchestrationRun(lead);
  const stalled = useStalled(run, idle);
  const [pending, setPending] = useState(false);
  // A failure is shown until the team moves on, here or elsewhere.
  const moment = `${team.status}:${team.need?.kind ?? ""}`;
  const [failure, setFailure] = useState<{ text: string; moment: string }>();
  const error = failure?.moment === moment ? failure.text : undefined;
  /** Runs a button's action; a failure shows `failed` and logs the cause. */
  const perform = async (
    operation: () => Promise<unknown> | unknown,
    failed: string,
  ) => {
    setPending(true);
    setFailure(undefined);
    try {
      await operation();
    } catch (reason) {
      logError("Team bar", reason);
      setFailure({ text: failed, moment });
    } finally {
      setPending(false);
    }
  };
  const need = team.status === "needs-you" ? team.need : undefined;
  const paused = need?.kind === "paused";
  const stop = teamBarStop(team, sessionId);
  // Another chat needs you: the way there. A paused discussion's chat that
  // is free again shows as this chat's own pause, with Resume.
  const elsewhere =
    need?.blocking && need.sessionId !== sessionId ? need.sessionId : undefined;
  const elsewhereName = elsewhere
    ? team.kind === "orchestrate"
      ? actions?.title?.(elsewhere)
      : memberName(team, elsewhere)
    : undefined;
  const partner =
    team.kind === "discuss"
      ? team.members.find((member) => member.sessionId !== sessionId)
      : undefined;
  const parts = error
    ? { label: error }
    : stalled
      ? {
          label: "Orchestrating · Needs you",
          reason: "The lead stopped without finishing.",
        }
      : team.kind === "orchestrate" && run && team.status === "running"
        ? { label: runningSummary(run, idle) }
        : teamBarParts(team, sessionId, { partnerTitle: partner?.title });
  const text = parts.reason ? `${parts.label} · ${parts.reason}` : parts.label;
  // "round 2 of 4" to "round 3 of 4", or a new status, rolls into place.
  const textRef = useRef<HTMLSpanElement>(null);
  useMotionOnChange(textRef, text);
  const watch =
    team.kind === "discuss"
      ? onOpenDiscussion && (() => onOpenDiscussion(team.key))
      : teamActions?.watch && (() => teamActions.watch?.(team.id));
  const state = stalled
    ? "stalled"
    : paused
      ? "paused"
      : team.status === "needs-you"
        ? "needs-you"
        : team.status;
  // Said aloud only when it changes what you should do: the team needs you,
  // paused, stalled or is ready to compare, not on every tick of progress.
  const announce =
    state === "needs-you" ||
    state === "paused" ||
    state === "stalled" ||
    state === "ready"
      ? text
      : "";
  const noun = TEAM_NOUN[team.kind];
  const openAgents =
    team.kind === "orchestrate" && run?.tasks.length && actions?.openAgents
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
  const race = team.kind === "race" ? raceActions : null;
  return (
    <Frame team={team} state={state} tall={!!parts.reason}>
      <Mark team={team} sessionId={sessionId} paused={paused} />
      {partner?.agentRole ? <RoleBadge role={partner.agentRole} /> : null}
      <span
        ref={textRef}
        className={`min-w-0 flex-1 ${
          parts.reason
            ? "line-clamp-2 leading-4 [overflow-wrap:anywhere]"
            : "truncate"
        } ${error ? "text-(--aven-danger-text)" : ""}`}
        title={text}
        data-team-bar-text
      >
        {parts.reason ? (
          <>
            {parts.label} ·{" "}
            <span className="text-content/75" data-team-bar-reason>
              {parts.reason}
            </span>
          </>
        ) : (
          text
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      {/* Waiting on you, the row keeps to what the team needs. */}
      {parts.reason ? null : <TeamRunDetails team={team} />}
      {elsewhere && actions ? (
        <TeamCardButton
          size="compact"
          data-team-goto={elsewhere}
          onClick={() => actions.open(elsewhere)}
        >
          <ArrowRight className="size-3" />
          Go to {elsewhereName ?? "chat"}
        </TeamCardButton>
      ) : null}
      {stalled && run ? (
        <>
          <TeamCardButton
            size="compact"
            disabled={pending}
            title="End the run as it is. Tasks that never started are cancelled."
            onClick={() =>
              void perform(
                () => orchestrator.finishRun(run.leadId),
                "Couldn't finish the run. Try again, or stop it.",
              )
            }
          >
            <Check className="size-3" strokeWidth={2} />
            Finish run
          </TeamCardButton>
          <TeamCardButton
            size="compact"
            disabled={pending}
            title="Ask the lead to review what's done and finish the run"
            onClick={() => onSubmit(sessionId, WRAP_UP_REQUEST)}
          >
            <MessageSquare className="size-3" />
            Ask the lead to wrap up
          </TeamCardButton>
        </>
      ) : null}
      {watch ? (
        <TeamCardButton
          size="compact"
          data-team-watch={team.id}
          title={`Watch the ${noun} in a floating panel`}
          onClick={watch}
        >
          <Eye className="size-3" />
          Watch
        </TeamCardButton>
      ) : null}
      {race ? (
        <TeamCardButton
          size="compact"
          data-race-compare
          title="Compare the agents' changes and keep one"
          onClick={() => race.compare(team.key)}
        >
          <GitCompare className="size-3" strokeWidth={1.75} />
          Compare
        </TeamCardButton>
      ) : null}
      {paused && !elsewhere ? (
        <TeamCardButton
          size="compact"
          disabled={pending || (team.kind === "orchestrate" && !idle)}
          title={
            team.kind === "orchestrate" && !idle
              ? "Wait for the lead to finish its turn, then resume."
              : `Resume the ${noun}`
          }
          onClick={() =>
            team.kind === "discuss"
              ? discussionStore().resume(team.key)
              : run &&
                void perform(
                  () =>
                    orchestrator.start(
                      run.leadId,
                      run.allowedHarnesses,
                      run.maxWorkers,
                    ),
                  "Couldn't resume the run. Try again from the lead's chat.",
                )
          }
        >
          <Play className="size-3" />
          Resume
        </TeamCardButton>
      ) : null}
      {openAgents && !stalled ? (
        <TeamCardButton
          size="compact"
          title="Open the agents' chats beside the lead"
          onClick={openAgents}
        >
          <ArrowRight className="size-3" />
          Open agents
        </TeamCardButton>
      ) : null}
      {stop ? (
        <TeamCardButton
          size="compact"
          data-team-stop={stop}
          disabled={pending}
          title={
            stop === "run"
              ? "Stop the lead and every agent in this run"
              : stop === "race"
                ? "Stop every agent still working. You can still compare what they wrote."
                : "Stop the discussion. A reply being written finishes, but the other chat won't get it."
          }
          onClick={() =>
            stop === "discussion"
              ? discussionStore().stop(team.key)
              : stop === "run"
                ? onStop(sessionId)
                : race?.stop(
                    team.members
                      .filter(
                        (member) =>
                          member.state === "working" ||
                          member.state === "needs-you",
                      )
                      .map((member) => member.sessionId),
                  )
          }
        >
          <Square className="size-2.5" />
          {stop === "run"
            ? "Stop run"
            : stop === "race"
              ? "Stop race"
              : "Stop discussion"}
        </TeamCardButton>
      ) : null}
    </Frame>
  );
}

/** Another chat's run holds this project: say so, and offer the way there. */
function BusyBar({ sessionId, cwd }: Props) {
  const actions = useContext(OrchestrationActions);
  const run = useOrchestrationSelector((runs) =>
    blockingRunFor(runs, sessionId, cwd),
  );
  if (!run) return null;
  const message = busyProjectMessage(run, actions?.title?.(run.leadId));
  return (
    <Frame
      team={{
        id: `orchestrate:${run.leadId}`,
        kind: "orchestrate",
        key: run.leadId,
      }}
      state="busy"
    >
      <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
        <Share className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={message} role="status">
        {message}
      </span>
      {actions ? (
        <TeamCardButton size="compact" onClick={() => actions.open(run.leadId)}>
          <ArrowRight className="size-3" />
          Go to lead
        </TeamCardButton>
      ) : null}
    </Frame>
  );
}
