import { memo, useContext, useEffect, useState, type ReactNode } from "react";
import {
  useOrchestrationRun,
  useOrchestrationSelector,
} from "../hooks/useOrchestrationRun";
import { useTeamOf } from "../hooks/useTeamRuns";
import { discussionStore } from "../lib/discussions";
import {
  blockingRunFor,
  busyProjectMessage,
  orchestrator,
  runWaitsOnLead,
  type OrchestrationRun,
} from "../lib/orchestration";
import { raceWorkspace } from "../lib/race";
import {
  TEAM_KIND_LABEL,
  teamIsOpen,
  teamRole,
  type TeamMember,
  type TeamRun,
} from "../lib/teamRuns";
import { HarnessIcon } from "./HarnessIcon";
import { OrchestrationActions } from "./OrchestrationActions";
import {
  Check,
  ExternalLink,
  MessageMultiple,
  MessageSquare,
  Pause,
  Play,
  Race,
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

const BUTTON =
  "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-40";

/** "2 working · 1 waiting", or the lead's part when no agent is busy. */
export function runningSummary(
  run: OrchestrationRun,
  leadIdle: boolean,
): string {
  const working = run.tasks.filter(
    (task) => task.status === "running" || task.status === "cancelling",
  ).length;
  const waiting = run.tasks.filter((task) => task.status === "queued").length;
  const parts = [
    working ? `${working} working` : "",
    waiting ? `${waiting} waiting` : "",
  ].filter(Boolean);
  if (!parts.length && !leadIdle) parts.push("the lead is reviewing");
  return ["Orchestrating", ...parts].join(" · ");
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

/** A member as the bar names it: "Codex · GPT-5", or a chat's own title. */
function memberName(team: TeamRun, sessionId: string): string | undefined {
  return team.members.find((member) => member.sessionId === sessionId)?.label;
}

/** "Discussing · round 2 of 4 · with Codex · GPT-5". */
export function teamBarText(
  team: TeamRun,
  sessionId: string,
  options: { partnerTitle?: string } = {},
): string {
  const kind = `${team.preview ? "Preview · " : ""}${TEAM_KIND_LABEL[team.kind]}`;
  const need = team.need;
  if (team.status === "needs-you" && need) {
    if (need.kind === "paused") return `${kind} · Paused · ${need.text}`;
    if (need.kind === "error") return `${kind} · ${need.text}`;
    return need.sessionId === sessionId
      ? `${kind} · Needs you · ${need.text}`
      : `${kind} · ${memberName(team, need.sessionId) ?? "An agent"} needs you`;
  }
  if (team.kind === "discuss") {
    const partner = team.members.find(
      (member) => member.sessionId !== sessionId,
    );
    const round = team.progress.replace(/^Round/, "round");
    const title = options.partnerTitle ? ` in “${options.partnerTitle}”` : "";
    return partner
      ? `${kind} · ${round} · with ${partner.label}${title}`
      : `${kind} · ${round}`;
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
 * reads "<Discussing | Racing | Orchestrating> · <status>" with Open
 * discussion, Compare or Open agents, Resume while paused, the team's one
 * Stop (see `teamBarStop`), and Go to <chat> when another chat needs you.
 * Another chat in a project an orchestration holds gets the reason and a
 * way to the lead. It renders only `TeamRun` data, so streaming in any of
 * the chats never renders it.
 */
export const TeamBar = memo(function TeamBar(props: Props) {
  const team = useTeamOf(props.sessionId, { previews: true });
  const shown =
    !!team &&
    teamIsOpen(team) &&
    // An orchestration's bar is its lead's; workers have no message box.
    (team.kind !== "orchestrate" || team.origin.sessionId === props.sessionId);
  if (shown) return <OpenTeamBar team={team} {...props} />;
  return <BusyBar {...props} />;
});

function Frame({
  team,
  state,
  children,
}: {
  team: Pick<TeamRun, "id" | "kind" | "key">;
  state: string;
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
        className={`team-bar flex h-7 min-w-0 items-center gap-1.5 rounded-lg border bg-content/3 pl-2 pr-0.5 text-ui-label text-content/60 ${
          // Waiting on you reads amber; a race ready to compare stays calm.
          state === "paused" || state === "needs-you" || state === "stalled"
            ? "border-amber-400/40"
            : "border-content/10"
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
        <MessageMultiple className="size-3.5" strokeWidth={1.75} />
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
  const lead = team.kind === "orchestrate" ? team.key : undefined;
  const run = useOrchestrationRun(lead);
  const stalled = useStalled(run, idle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const perform = async (operation: () => Promise<unknown> | unknown) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
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
      : memberLabel(team.members, elsewhere)
    : undefined;
  const partner =
    team.kind === "discuss"
      ? team.members.find((member) => member.sessionId !== sessionId)
      : undefined;
  const text = error
    ? error
    : stalled
      ? "Orchestrating · The lead stopped without finishing"
      : team.kind === "orchestrate" && run && team.status === "running"
        ? runningSummary(run, idle)
        : teamBarText(team, sessionId, { partnerTitle: partner?.title });
  const state = stalled
    ? "stalled"
    : paused
      ? "paused"
      : team.status === "needs-you"
        ? "needs-you"
        : team.status;
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
  const race = team.kind === "race" ? raceWorkspace() : null;
  return (
    <Frame team={team} state={state}>
      <Mark team={team} sessionId={sessionId} paused={paused} />
      <span
        className={`min-w-0 flex-1 truncate ${error ? "text-red-400" : ""}`}
        title={text}
        role="status"
      >
        {text}
      </span>
      {elsewhere && actions ? (
        <button
          type="button"
          className={BUTTON}
          data-team-goto={elsewhere}
          onClick={() => actions.open(elsewhere)}
        >
          <ExternalLink className="size-3" />
          Go to {elsewhereName ?? "chat"}
        </button>
      ) : null}
      {stalled && run ? (
        <>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            title="End the run as it is. Tasks that never started are cancelled."
            onClick={() =>
              void perform(() => orchestrator.finishRun(run.leadId))
            }
          >
            <Check className="size-3" strokeWidth={2} />
            Finish run
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={pending}
            title={WRAP_UP_REQUEST}
            onClick={() => onSubmit(sessionId, WRAP_UP_REQUEST)}
          >
            <MessageSquare className="size-3" />
            Ask the lead to wrap up
          </button>
        </>
      ) : null}
      {team.kind === "discuss" && onOpenDiscussion ? (
        <button
          type="button"
          className={BUTTON}
          title="Open the discussion as one conversation"
          onClick={() => onOpenDiscussion(team.key)}
        >
          <ExternalLink className="size-3" />
          Open discussion
        </button>
      ) : null}
      {race ? (
        <button
          type="button"
          className={BUTTON}
          data-race-compare
          title="Compare the agents' changes and keep one"
          onClick={() => race.compare(team.key)}
        >
          Compare
        </button>
      ) : null}
      {paused && !elsewhere ? (
        <button
          type="button"
          className={BUTTON}
          disabled={pending || (team.kind === "orchestrate" && !idle)}
          onClick={() =>
            team.kind === "discuss"
              ? discussionStore().resume(team.key)
              : run &&
                void perform(() =>
                  orchestrator.start(
                    run.leadId,
                    run.allowedHarnesses,
                    run.maxWorkers,
                  ),
                )
          }
        >
          <Play className="size-3" />
          Resume
        </button>
      ) : null}
      {openAgents && !stalled ? (
        <button
          type="button"
          className={BUTTON}
          title="Open the agents' chats beside the lead"
          onClick={openAgents}
        >
          <ExternalLink className="size-3" />
          Open agents
        </button>
      ) : null}
      {stop ? (
        <button
          type="button"
          className={BUTTON}
          data-team-stop={stop}
          disabled={pending}
          title={
            stop === "run"
              ? "Stop the lead and every agent in this run"
              : stop === "race"
                ? "Stop every agent still working in this race"
                : "Stop discussion"
          }
          aria-label={
            stop === "run"
              ? "Stop run"
              : stop === "race"
                ? "Stop all agents"
                : "Stop discussion"
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
          {stop === "run" ? "Stop run" : stop === "race" ? "Stop all" : "Stop"}
        </button>
      ) : null}
    </Frame>
  );
}

function memberLabel(
  members: readonly TeamMember[],
  sessionId: string,
): string | undefined {
  const member = members.find((entry) => entry.sessionId === sessionId);
  if (!member) return undefined;
  // "Codex · GPT-5" reads long on a button; the provider is enough, unless
  // another member races a second model of it.
  const shared = members.some(
    (entry) => entry !== member && entry.harness === member.harness,
  );
  return shared ? member.label : member.label.split(" · ")[0];
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
        <MessageMultiple className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1 truncate" title={message} role="status">
        {message}
      </span>
      {actions ? (
        <button
          type="button"
          className={BUTTON}
          onClick={() => actions.open(run.leadId)}
        >
          <ExternalLink className="size-3" />
          Go to lead
        </button>
      ) : null}
    </Frame>
  );
}
