import { createContext, memo, useContext, useRef, useState } from "react";
import { useActivity } from "../lib/activity";
import type { Session, SessionAgent } from "../lib/session";
import { sessionAgentSummary } from "../lib/sessionAgents";
import {
  runStatusNeedsOwnRow,
  sessionRunStatus,
} from "../lib/sessionRunStatus";
import type { TeamRun } from "../lib/teamRuns";
import { Bot, ChevronDown } from "./icons";
import { Popover } from "./Popover";
import { SessionAgentList } from "./SessionAgentList";
import { MemberClock, TeamCardButton } from "./TeamCard";

/** The chat whose team bar this is, as its pane last drew it. */
export type TeamRunStatusValue = {
  /** With the agents Aven manages for it (see `sessionWithManagedAgents`). */
  session: Session;
  /** A parked pane neither ticks nor reads the activity ledger. */
  visible: boolean;
};

/**
 * Provided around the message box by the chat's pane. The bar inside it
 * reads the chat from here, so streamed text re-renders this leaf alone,
 * never the message box or the bar.
 */
export const TeamRunStatusContext = createContext<TeamRunStatusValue | null>(
  null,
);

/**
 * The chat's own run, inside its team's bar, where the separate status row
 * used to repeat it: what this chat is doing while it works, the run's
 * elapsed time, and its agents behind one button. Draws nothing outside a
 * pane that provides the chat.
 */
export const TeamRunDetails = memo(function TeamRunDetails({
  team,
}: {
  team: Pick<TeamRun, "startedAt" | "status">;
}) {
  const value = useContext(TeamRunStatusContext);
  if (!value?.visible) return null;
  return <VisibleTeamRunDetails team={team} session={value.session} />;
});

function VisibleTeamRunDetails({
  team,
  session,
}: {
  team: Pick<TeamRun, "startedAt" | "status">;
  session: Session;
}) {
  const entries = useActivity();
  const status = sessionRunStatus(session, entries);
  // A failure, signing in or a queue keeps its own row above the box.
  const doing =
    status?.kind === "working" && !runStatusNeedsOwnRow(status)
      ? status.doing
      : undefined;
  const ticking = team.status === "running" || team.status === "needs-you";
  const agents = session.liveAgents ?? [];
  return (
    <>
      {doing ? (
        <span
          className="team-bar-doing min-w-0 flex-[1_1_0] truncate text-content/40"
          title={doing}
          data-team-bar-doing
        >
          {doing}
        </span>
      ) : null}
      {ticking ? (
        <span
          className="team-bar-clock"
          title="How long this run has been going"
          data-team-bar-clock
        >
          <MemberClock startedAt={team.startedAt} running />
        </span>
      ) : null}
      {agents.length ? <TeamBarAgents agents={agents} /> : null}
    </>
  );
}

/** "Agents 2": the chat's agents, listed in a small panel above the bar. */
function TeamBarAgents({ agents }: { agents: readonly SessionAgent[] }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const summary = sessionAgentSummary(agents);
  return (
    <>
      <TeamCardButton
        ref={anchor}
        size="compact"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summary ? `Agents: ${summary}` : "Agents"}
        data-team-bar-agents
        onClick={() => setOpen((shown) => !shown)}
      >
        <Bot className="size-3" />
        Agents
        <span className="text-content/45">{agents.length}</span>
        <ChevronDown className="size-3" />
      </TeamCardButton>
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          gap={6}
          width={300}
          role="dialog"
          aria-label="Agents"
          ignore="[data-team-bar-agents]"
          onDismiss={() => setOpen(false)}
          className="px-3 py-2 text-ui-label"
        >
          <p className="text-ui-caption text-content/50">{summary}</p>
          <SessionAgentList agents={agents} />
        </Popover>
      ) : null}
    </>
  );
}
