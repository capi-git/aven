import { useContext, useEffect, useRef, useState } from "react";
import { useOrchestrationRun } from "../hooks/useOrchestrationRun";
import { agentFullName } from "../lib/agentNames";
import { logError } from "../lib/errors";
import { modelDisplayName } from "../lib/sessionLabels";
import { orchestrator } from "../lib/orchestration";
import {
  orchestrationEnded,
  orchestrationFoldedLine,
  orchestrationProgress,
  orchestrationTaskLabel,
  type OrchestrationSummary,
} from "../lib/orchestrationSummary";
import { HarnessIcon } from "./HarnessIcon";
import { OrchestrationWorkers } from "./OrchestrationActions";
import { Check, ChevronDown, ChevronRight, CircleAlert } from "./icons";
import { TerminalSpinner } from "./TerminalSpinner";

export function OrchestrationSidebarAgents({
  leadId,
  summary,
  endedAt,
  now = Date.now(),
}: {
  leadId: string;
  summary: OrchestrationSummary;
  /**
   * When the lead last did anything: the folded line's date for a run saved
   * before runs kept when they ended.
   */
  endedAt?: number;
  now?: number;
}) {
  const workers = useContext(OrchestrationWorkers);
  // Only this lead's run: another run's save does not re-render this card.
  const run = useOrchestrationRun(leadId);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // Rows expand independently, so several agents can be watched side by side.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // A run that is over folds to one line until it is opened.
  const ended = orchestrationEnded(summary);
  const [unfolded, setUnfolded] = useState(false);
  // Revealing a worker from its toast opens that row without closing others.
  const revealed = workers.selectedId;
  const tasks = useRef(summary.tasks);
  tasks.current = summary.tasks;
  useEffect(() => {
    if (!revealed) return;
    if (tasks.current.some((task) => task.sessionId === revealed))
      setUnfolded(true);
    setExpanded((current) =>
      current.has(revealed) ? current : new Set(current).add(revealed),
    );
  }, [revealed]);
  const toggle = (sessionId: string, isOpen: boolean) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
    if (isOpen && revealed === sessionId) workers.inspect(null);
  };
  /** Runs a button's action; a failure shows `failed` and logs the cause. */
  const perform = async (operation: () => Promise<void>, failed: string) => {
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (reason) {
      logError("Run agents", reason);
      setError(failed);
    } finally {
      setPending(false);
    }
  };
  const action =
    "rounded px-1.5 py-0.5 text-ui-caption text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-35";
  // Sits inside an already-lit row, so it needs its own surface to read as a
  // button rather than as another line of text.
  const solidAction =
    "rounded bg-content/15 px-1.5 py-0.5 text-ui-caption text-content/75 hover:bg-content/25 hover:text-content disabled:opacity-35";
  if (ended && !unfolded)
    return (
      <div
        className="relative mt-1.5"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          data-orchestration-folded
          aria-expanded={false}
          // Its line is its name; the hint repeats it, since a long line is
          // cut off, and says what the button does.
          title={`${orchestrationFoldedLine(summary, run?.endedAt ?? endedAt, now)}. Show this run's agents.`}
          onClick={() => setUnfolded(true)}
          className="-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-ui-caption text-content/45 hover:bg-content/10 hover:text-content/70"
        >
          <ChevronRight className="size-3 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">
            {orchestrationFoldedLine(summary, run?.endedAt ?? endedAt, now)}
          </span>
        </button>
      </div>
    );
  return (
    <div className="relative mt-1.5">
      <div className="mb-0.5 px-0.5 flex items-center justify-between gap-2 text-ui-caption text-content/45">
        {ended ? (
          <button
            type="button"
            aria-expanded
            data-orchestration-fold
            title="Fold this run to one line"
            className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1 hover:bg-content/10 hover:text-content/70"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setUnfolded(false);
            }}
          >
            <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">
              {summary.tasks.length}{" "}
              {summary.tasks.length === 1 ? "agent" : "agents"}
            </span>
          </button>
        ) : (
          <span>
            {summary.tasks.length}{" "}
            {summary.tasks.length === 1 ? "agent" : "agents"}
          </span>
        )}
        <span className="truncate tabular-nums" data-orchestration-progress>
          {orchestrationProgress(summary)}
        </span>
      </div>
      {/*
        Offset by the rows' own padding so a chevron lands on the card's
        content edge, under the harness icon of the header above.

        No height cap and no scroller: the card grows with whatever the user
        expanded, and the sidebar it sits in does the only scrolling. Nesting
        a second scroll region here made rows clip mid-line.
      */}
      <div
        aria-label="Orchestrated agents"
        className="-mx-2 flex touch-pan-y flex-col gap-px"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {summary.tasks.map((task) => {
          const open = expanded.has(task.sessionId);
          const live = run?.tasks.find(
            (entry) => entry.sessionId === task.sessionId,
          );
          const label = orchestrationTaskLabel(task, summary);
          // The lead answers an agent's approvals and questions. That is
          // its work, not a call for you, so it reads in a neutral colour.
          const deciding = label === "Lead deciding";
          const working =
            summary.live && task.status === "running" && !task.needsInput;
          // A saved provider model may not be in this window's catalog yet:
          // the plan's name for it, else its own identity, never the
          // harness default's name.
          const model = modelDisplayName(
            task.harness,
            task.model,
            run?.allowedModels,
          );
          const fullName = agentFullName({ harness: task.harness, model });
          return (
            <div
              key={task.sessionId}
              data-orchestration-agent={task.sessionId}
              data-lead-deciding={deciding || undefined}
              // Expanding lights the whole row, header and detail together.
              className={`rounded-md ${open ? "bg-content/10" : ""}`}
            >
              <button
                type="button"
                title={`${task.title} · ${fullName} · ${label}`}
                aria-label={`Agent details: ${task.title}`}
                aria-expanded={open}
                onClick={() => toggle(task.sessionId, open)}
                // Named, because the whole session card is already a `group`.
                className={`group/agent flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left ${
                  open ? "" : "hover:bg-content/10"
                }`}
              >
                {/* One slot: the chevron stands in for the harness mark
                    whenever this row is open or under the pointer. */}
                <span className="grid size-3.5 shrink-0 place-items-center text-content/45">
                  {open ? (
                    <ChevronDown className="size-3" strokeWidth={1.75} />
                  ) : (
                    <>
                      <HarnessIcon
                        harness={task.harness}
                        className="size-3.5 opacity-75 group-focus-visible/agent:hidden group-hover/agent:hidden"
                      />
                      <ChevronRight
                        className="hidden size-3 group-focus-visible/agent:block group-hover/agent:block"
                        strokeWidth={1.75}
                      />
                    </>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui-label leading-snug text-content/80">
                  {task.title}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 text-ui-caption ${
                    task.status === "failed"
                      ? "text-(--aven-danger-text)"
                      : deciding
                        ? "text-content/55"
                        : working
                          ? "text-accent"
                          : task.status === "completed"
                            ? "text-emerald-400"
                            : "text-content/45"
                  }`}
                >
                  {task.status === "failed" ? (
                    <CircleAlert className="size-3" strokeWidth={1.75} />
                  ) : working ? (
                    <TerminalSpinner className="inline-block w-3 select-none text-center text-ui-caption leading-none text-accent" />
                  ) : task.status === "completed" ? (
                    <Check className="size-3" strokeWidth={2.25} />
                  ) : null}
                  <span>{label}</span>
                </span>
              </button>
              {/* Indented to the title's column: the icon slot and its gap. */}
              {open && (
                <div className="space-y-2 pb-3 pl-6.5 pr-2">
                  <p
                    className="flex min-w-0 items-center gap-1.5 text-ui-caption text-content/45"
                    title={fullName}
                  >
                    <HarnessIcon
                      harness={task.harness}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 truncate">{model}</span>
                  </p>
                  {deciding && (
                    <p className="text-ui-caption text-content/45">
                      It asked for an approval or an answer; the lead is
                      deciding.
                    </p>
                  )}
                  {live?.error && (
                    <p
                      className="text-ui-caption text-(--aven-danger-text)"
                      title={live.error}
                    >
                      This agent ran into a problem. Open its chat to see what
                      happened.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-1">
                    {workers.openDetails && (
                      <button
                        type="button"
                        title="Open this agent's chat beside the lead"
                        className={solidAction}
                        onClick={() =>
                          workers.openDetails?.({
                            sessionId: task.sessionId,
                            leadId,
                            title: task.title,
                            harness: task.harness,
                          })
                        }
                      >
                        Open chat
                      </button>
                    )}
                    {live && ["queued", "running"].includes(live.status) && (
                      <button
                        type="button"
                        className={solidAction}
                        disabled={pending}
                        onClick={() =>
                          void perform(
                            () => orchestrator.cancelTask(leadId, live.id),
                            "Couldn't cancel the task. Try again.",
                          )
                        }
                      >
                        Cancel task
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(error || run?.error) && (
        <p
          role="alert"
          className="py-1 text-ui-caption text-(--aven-danger-text)"
        >
          {error ?? run?.error}
        </p>
      )}
      {/* A run that is open can always be stopped here, even while nothing
          is running; Resume brings a paused run back. */}
      {(run?.status === "active" || run?.status === "paused") && (
        <div className="-mr-1.5 mt-0.5 flex items-center justify-end gap-0.5">
          {run.status === "paused" && (
            <button
              type="button"
              className={action}
              disabled={pending}
              title="Resume the run"
              onClick={() =>
                void perform(
                  () =>
                    orchestrator.start(
                      leadId,
                      run.allowedHarnesses,
                      run.maxWorkers,
                    ),
                  "Couldn't resume the run. Try again from the lead's chat.",
                )
              }
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className={action}
            disabled={pending}
            title="Stop the lead and every agent in this run"
            onClick={() =>
              void perform(
                () => orchestrator.stopRun(leadId),
                "Couldn't stop the run. Try again.",
              )
            }
          >
            Stop run
          </button>
        </div>
      )}
    </div>
  );
}
