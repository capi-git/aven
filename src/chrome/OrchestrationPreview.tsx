import "./Menu.css";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { agentFullName, appName } from "../lib/agentNames";
import { logError } from "../lib/errors";
import { HARNESS_TITLE, type Block } from "../lib/session";
import { modelDisplayName } from "../lib/sessionLabels";
import {
  planProblemText,
  withoutProposedTask,
  type OrchestrationChoice,
  type OrchestrationProposal,
  type ProposedTask,
} from "../lib/orchestrationPlan";
import {
  orchestrator,
  type OrchestrationRun,
  type OrchestrationTask,
} from "../lib/orchestration";
import { orchestrationStatusWord } from "../lib/orchestrationSummary";
import { useOrchestrationRun } from "../hooks/useOrchestrationRun";
import { resizeComposer } from "../lib/composerResize";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { OrchestrationActions } from "./OrchestrationActions";
import { RoleBadge, RolePicker } from "./AgentRoles";
import { HarnessIcon } from "./HarnessIcon";
import { OrchestrationTeamCard } from "./OrchestrationTeamCard";
import { Popover } from "./Popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Share,
  Play,
  Search,
} from "./icons";

function AssignmentModel({
  task,
  choices,
  onChange,
}: {
  task: ProposedTask;
  choices: OrchestrationChoice[];
  onChange(choice: OrchestrationChoice): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const listOverscroll = useLockOverscroll<HTMLDivElement>();
  const selected = choices.find(
    (choice) => choice.harness === task.harness && choice.model === task.model,
  );
  const matches = choices.filter((choice) =>
    `${choice.name} ${choice.model} ${HARNESS_TITLE[choice.harness]}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  // Two things fought this field for focus. The composer takes focus back
  // unless a picker surface is in the DOM, which `data-model-picker` below
  // now declares; and the popover measures itself with `visibility: hidden`
  // on its first pass, where nothing can be focused. Placement flushes in a
  // layout effect ahead of this one, so focus now for the pass that is
  // already on screen and again next frame, once placement has landed.
  // Re-focusing a focused field is a no-op.
  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() =>
      search.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const pick = (choice: OrchestrationChoice) => {
    onChange(choice);
    setOpen(false);
    anchor.current?.focus();
  };
  // Arrows walk the list from the search field, the way the app's other
  // pickers work. The keys stop here so the transcript underneath does not
  // scroll along with the highlight.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        Math.min(matches.length - 1, Math.max(0, index + step)),
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const choice = matches[active];
      if (choice) pick(choice);
    }
  };
  return (
    <div className="relative min-w-0">
      <button
        type="button"
        ref={anchor}
        aria-label={`Model for ${task.title}`}
        aria-expanded={open}
        onClick={() => {
          setQuery("");
          setActive(selected ? choices.indexOf(selected) : 0);
          setOpen(!open);
        }}
        className="flex h-7 max-w-full items-center gap-1.5 rounded-md bg-content/5 px-2 text-ui-caption text-content/60 hover:bg-content/10 hover:text-content"
      >
        <HarnessIcon harness={task.harness} className="size-3.5 shrink-0" />
        <span className="truncate">
          {agentFullName({
            harness: task.harness,
            model: selected?.name ?? task.model,
          })}
        </span>
        <ChevronDown className="size-3 shrink-0" />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={260}
          maxHeight={320}
          onDismiss={() => setOpen(false)}
          data-model-picker
          className="aven-menu-picker"
        >
          <div className="aven-menu aven-menu-search-bar">
            <label className="aven-menu-search">
              <Search aria-hidden="true" strokeWidth={1.75} />
              <input
                ref={search}
                type="text"
                aria-label="Search assignment models"
                placeholder="Search models or agents…"
                spellCheck={false}
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
              />
            </label>
          </div>
          <div
            ref={listOverscroll}
            role="listbox"
            aria-label="Assignment models"
            className="aven-menu min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            {matches.map((choice, index) => (
              <button
                key={`${choice.harness}:${choice.model}`}
                ref={index === active ? activeRef : undefined}
                type="button"
                role="option"
                aria-selected={choice === selected}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(choice)}
                data-active={index === active}
                className="aven-menu-item aven-menu-item-rich"
              >
                <span aria-hidden="true" className="aven-menu-icon">
                  <HarnessIcon harness={choice.harness} className="size-4" />
                </span>
                <span className="aven-menu-text">
                  <span className="aven-menu-label">{choice.name}</span>
                  <span className="aven-menu-description truncate">
                    {appName(choice.harness)}
                  </span>
                </span>
                {choice === selected && (
                  <Check aria-hidden="true" className="aven-menu-check" />
                )}
              </button>
            ))}
            {!matches.length && (
              <p className="aven-menu-note">No matching models</p>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

function WorkerHelp() {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        type="button"
        ref={anchor}
        aria-label="What agents at once means"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="grid size-4 shrink-0 place-items-center rounded-full text-content/35 hover:text-content/70"
      >
        <CircleHelp className="size-3.5" strokeWidth={1.75} />
      </button>
      {(hovered || open) && (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={250}
          onDismiss={() => setOpen(false)}
          className={`px-2.5 py-2 ${open ? "" : "pointer-events-none"}`}
        >
          <div className="text-ui-label leading-4 text-content">
            How many agents work at once
          </div>
          <div className="mt-1 text-ui-caption leading-4 text-content/50">
            The rest of the tasks wait their turn, and a task that depends on
            another waits for it either way. Every agent edits this same project
            folder, so a lower number means fewer changes landing in it at the
            same time.
          </div>
        </Popover>
      )}
    </>
  );
}

function InstructionsField({
  label,
  value,
  className,
  onChange,
}: {
  label: string;
  value: string;
  className: string;
  onChange(value: string): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLTextAreaElement>();
  // The same growth the composer uses: fit the text, stop at `max-h-40` and
  // scroll from there. The value is controlled, so one layout effect covers
  // typing and edits that arrive from the lead alike.
  useLayoutEffect(() => {
    if (ref.current) resizeComposer(ref.current);
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        lockOverscroll(el);
      }}
      rows={1}
      aria-label={label}
      className={`${className} max-h-40 resize-none overscroll-none`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A task's write scope as a person reads it: "." is the whole project. */
export function scopeLabel(path: string): string {
  return path === "." || path === "./" ? "Whole project" : path;
}

/** The card's footer: the run's state, or where the plan stands. */
export function proposalStatusText(
  proposal: OrchestrationProposal,
  run: OrchestrationRun | undefined,
  superseded: boolean,
): string {
  if (run) return orchestrationStatusWord(run.status);
  if (superseded && ["ready", "invalid", "starting"].includes(proposal.status))
    return "Replaced by a newer plan";
  // It ran, and this chat has started another run since: its result is
  // that run's history, which the chat keeps only for its latest run.
  if (proposal.status === "approved" && superseded)
    return "Ran earlier · replaced by a newer run";
  return {
    planning: "",
    ready: "Needs you · Confirm to start",
    invalid: "",
    starting: "Starting…",
    approved: "Started",
    discarded: "Discarded",
  }[proposal.status];
}

const TASK_STATUS: Record<OrchestrationTask["status"], string> = {
  queued: "Queued",
  running: "Working",
  cancelling: "Stopping",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function OrchestrationPreview({
  block,
  busy,
  superseded = false,
}: {
  block: Block;
  busy?: boolean;
  /** A newer proposal exists in this chat, so this one can no longer start. */
  superseded?: boolean;
}) {
  const actions = useContext(OrchestrationActions);
  const proposal = block.orchestration!;
  // Only this lead's run: other runs' saves do not re-render the card.
  const leadRun = useOrchestrationRun(proposal.leadId);
  const run = leadRun?.proposalId === block.id ? leadRun : undefined;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  // Once confirmed, the run's card stands for the plan; it can show it.
  const [planShown, setPlanShown] = useState(false);
  useEffect(() => {
    if (actions)
      void orchestrator.hydrate(proposal.leadId).catch((reason: unknown) => {
        logError("Run plan", reason);
        setError("Couldn't load this run's progress.");
      });
  }, [actions, proposal.leadId]);
  const editable =
    proposal.status === "ready" &&
    !superseded &&
    !run &&
    !pending &&
    !busy &&
    !!actions;
  const planning = proposal.status === "planning";
  const starting = pending || proposal.status === "starting";
  const visible = showAll ? proposal.tasks : proposal.tasks.slice(0, 3);
  const perform = async (fn: () => Promise<void>) => {
    setPending(true);
    setError(undefined);
    try {
      await fn();
    } catch (reason) {
      logError("Run plan", reason);
      setError("Couldn't start the run. Try again.");
    } finally {
      setPending(false);
    }
  };
  const change = (id: string, patch: Partial<ProposedTask>) => {
    setError(undefined);
    actions?.update(proposal.leadId, block.id, {
      ...proposal,
      tasks: proposal.tasks.map((task) =>
        task.id === id ? { ...task, ...patch } : task,
      ),
    });
  };
  const remove = (id: string) => {
    setError(undefined);
    try {
      const tasks = withoutProposedTask(proposal, id);
      setExpanded((prev) => prev.filter((entry) => entry !== id));
      actions?.update(proposal.leadId, block.id, { ...proposal, tasks });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const statusOf = (task: ProposedTask) => {
    const live = run?.tasks.find((entry) => entry.assignmentId === task.id);
    return live ? TASK_STATUS[live.status] : undefined;
  };
  const secondary =
    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-ui-caption text-content/50 hover:bg-content/8 hover:text-content disabled:opacity-35";
  const field =
    "w-full rounded-md border border-content/12 bg-background-base/40 px-2 py-1.5 text-ui-label leading-5 text-content outline-none placeholder:text-content/35 focus:border-content/30";
  const fieldLabel = "mb-1 block text-ui-caption leading-tight text-content/45";
  const planCard = (
    <div
      className="aven-inset-card mb-2 overflow-hidden font-sans"
      aria-label="Run plan"
      {...(run
        ? { "data-orchestration-plan": "" }
        : { "data-orchestration-review": "" })}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/8 text-content/55">
          {planning || proposal.status === "starting" ? (
            <CircleDashed className="size-4 animate-spin" />
          ) : (
            <Share className="size-4" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-body font-medium leading-tight text-content/90">
            {planning ? "Planning assignments…" : proposal.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-ui-caption leading-tight text-content/45">
            <HarnessIcon
              harness={proposal.author.harness}
              className="size-3 shrink-0"
            />
            <span
              className="truncate"
              title={agentFullName({
                harness: proposal.author.harness,
                model: proposal.author.name,
              })}
            >
              Lead · {proposal.author.name}
            </span>
            {!!proposal.tasks.length && (
              <span className="shrink-0">
                · {proposal.tasks.length}{" "}
                {proposal.tasks.length === 1 ? "task" : "tasks"}
              </span>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {!run && !superseded && proposal.status === "invalid" && (
            <button
              className={secondary}
              disabled={busy || !actions}
              title={
                busy
                  ? "Wait for this chat to finish its turn, then start."
                  : "Ask the lead for a new plan"
              }
              onClick={() => actions?.retry(proposal.leadId, block.id)}
            >
              Try again
            </button>
          )}
          {editable && actions?.discard && (
            <button
              className={secondary}
              title="Drop this plan without starting it"
              onClick={() => actions.discard?.(proposal.leadId, block.id)}
            >
              Discard plan
            </button>
          )}
          {!run &&
            !superseded &&
            ["ready", "starting"].includes(proposal.status) && (
              <button
                className="flex h-7 items-center gap-1.5 rounded-md bg-content px-2.5 text-ui-caption font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
                disabled={!editable}
                title={
                  busy && !starting
                    ? "Wait for this chat to finish its turn, then start."
                    : undefined
                }
                onClick={() =>
                  void perform(() =>
                    actions!.confirm(proposal.leadId, block.id),
                  )
                }
              >
                <Play className="size-3" strokeWidth={1.75} />
                {starting ? "Starting…" : "Confirm and start"}
              </button>
            )}
        </div>
      </div>
      {planning && (
        <p className="px-3 pb-2.5 text-ui-label leading-5 text-content/50">
          {proposal.settings.choices.length
            ? "The lead is choosing tasks and models for its agents. Check the plan here before starting."
            : "Checking which agents and models you have…"}
        </p>
      )}
      {!!proposal.tasks.length && (
        <ul className="border-t border-content/10 py-1">
          {visible.map((task) => {
            const index = proposal.tasks.indexOf(task);
            const open = expanded.includes(task.id);
            return (
              <li key={task.id}>
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 hover:bg-content/5">
                  <button
                    type="button"
                    aria-label={`Details for ${task.title}`}
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) =>
                        open
                          ? prev.filter((id) => id !== task.id)
                          : [...prev, task.id],
                      )
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-content/65 hover:text-content"
                  >
                    {open ? (
                      <ChevronDown className="size-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" />
                    )}
                    <span className="truncate text-ui-label" title={task.title}>
                      {task.title}
                    </span>
                    {task.role ? <RoleBadge role={task.role} /> : null}
                  </button>
                  {statusOf(task) && (
                    <span
                      className="shrink-0 text-ui-caption text-content/50"
                      data-orchestration-task-status
                    >
                      {statusOf(task)}
                    </span>
                  )}
                  <div className="max-w-[60%] min-w-0">
                    {editable ? (
                      <AssignmentModel
                        task={task}
                        choices={proposal.settings.choices}
                        onChange={(choice) =>
                          change(task.id, {
                            harness: choice.harness,
                            model: choice.model,
                          })
                        }
                      />
                    ) : (
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-ui-caption text-content/50"
                        title={agentFullName({
                          harness: task.harness,
                          model:
                            proposal.settings.choices.find(
                              (choice) =>
                                choice.harness === task.harness &&
                                choice.model === task.model,
                            )?.name ?? task.model,
                        })}
                      >
                        <HarnessIcon
                          harness={task.harness}
                          className="size-3 shrink-0"
                        />
                        <span className="truncate">
                          {proposal.settings.choices.find(
                            (choice) =>
                              choice.harness === task.harness &&
                              choice.model === task.model,
                          )?.name ?? task.model}
                        </span>
                      </span>
                    )}
                  </div>
                  {!!task.files.length && (
                    <ul
                      aria-label={`Files for ${task.title}`}
                      className="flex w-full min-w-0 flex-wrap gap-1 pb-0.5 pl-5.5"
                    >
                      {task.files.map((path) => (
                        <li
                          key={path}
                          title={path}
                          data-orchestration-scope
                          className="max-w-full truncate rounded bg-content/6 px-1.5 py-px font-mono text-ui-micro leading-4 text-content/55"
                        >
                          {scopeLabel(path)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {open && (
                  <div className="space-y-2.5 px-3 pb-3 pl-8 text-ui-caption leading-4 text-content/45">
                    {editable ? (
                      <>
                        <label className="block">
                          <span className={fieldLabel}>Task</span>
                          <input
                            aria-label={`Title for task ${index + 1}`}
                            className={field}
                            value={task.title}
                            onChange={(event) =>
                              change(task.id, { title: event.target.value })
                            }
                          />
                        </label>
                        <label className="block">
                          <span className={fieldLabel}>Instructions</span>
                          <InstructionsField
                            label={`Instructions for task ${index + 1}`}
                            value={task.prompt}
                            className={field}
                            onChange={(prompt) => change(task.id, { prompt })}
                          />
                        </label>
                        <div>
                          <span className={fieldLabel}>
                            Role · added to this agent's task, for this run only
                          </span>
                          <RolePicker
                            label={`Role for task ${index + 1}`}
                            value={task.role}
                            onChange={(role) => change(task.id, { role })}
                            className="-ml-1.5"
                          />
                        </div>
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-ui-label leading-5 text-content/60">
                        {task.prompt}
                      </p>
                    )}
                    {!!task.dependsOn.length && (
                      <p>
                        After ·{" "}
                        {task.dependsOn
                          .map(
                            (id) =>
                              proposal.tasks.find((entry) => entry.id === id)
                                ?.title ?? id,
                          )
                          .join(", ")}
                      </p>
                    )}
                    {editable && (
                      <button
                        type="button"
                        className={`${secondary} -ml-2.5`}
                        disabled={proposal.tasks.length < 2}
                        title={
                          proposal.tasks.length < 2
                            ? "A plan needs at least one task. Discard the plan instead."
                            : "Leave this task out. Tasks that waited for it no longer do."
                        }
                        onClick={() => remove(task.id)}
                      >
                        Remove task
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {proposal.tasks.length > 3 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="flex h-8 w-full items-center gap-1.5 border-t border-content/10 px-3 text-left text-ui-caption text-content/45 hover:bg-content/5 hover:text-content/70"
        >
          {showAll ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {showAll
            ? "Show fewer tasks"
            : `Show ${proposal.tasks.length - 3} more ${proposal.tasks.length === 4 ? "task" : "tasks"}`}
        </button>
      )}
      {(error || proposal.error) && (
        <p
          role="alert"
          className="px-3 py-2 text-ui-label text-red-600 dark:text-red-400"
          title={error ? undefined : proposal.error}
        >
          {error ?? planProblemText(proposal.error!)}
        </p>
      )}
      {!planning && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-content/10 px-3 py-2 text-ui-caption text-content/45">
          <div className="flex items-center gap-1.5">
            {editable ? (
              <>
                <span>Agents at once</span>
                <div
                  role="radiogroup"
                  aria-label="Agents at once"
                  className="flex items-center gap-0.5 rounded-md bg-content/5 p-0.5"
                >
                  {[1, 2, 3, 4].map((number) => (
                    <button
                      key={number}
                      type="button"
                      role="radio"
                      aria-checked={proposal.settings.maxWorkers === number}
                      onClick={() =>
                        actions?.update(proposal.leadId, block.id, {
                          ...proposal,
                          settings: {
                            ...proposal.settings,
                            maxWorkers: number,
                          },
                        })
                      }
                      className={`grid size-5 place-items-center rounded-[5px] text-ui-caption leading-none tabular-nums ${
                        proposal.settings.maxWorkers === number
                          ? "bg-content/15 font-medium text-content"
                          : "text-content/45 hover:bg-content/8 hover:text-content"
                      }`}
                    >
                      {number}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span>{proposal.settings.maxWorkers} at once</span>
            )}
            <WorkerHelp />
          </div>
          <span data-orchestration-status>
            {proposalStatusText(proposal, run, superseded)}
          </span>
        </div>
      )}
    </div>
  );
  if (!run) return planCard;
  return (
    <>
      <OrchestrationTeamCard
        run={run}
        modelName={(harness, model) =>
          modelDisplayName(harness, model, proposal.settings.choices)
        }
        planShown={planShown}
        onTogglePlan={() => setPlanShown((shown) => !shown)}
      />
      {planShown ? <div className="mt-2">{planCard}</div> : null}
    </>
  );
}
