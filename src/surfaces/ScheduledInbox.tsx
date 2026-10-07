import "./ScheduledInbox.css";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  CheckCheck,
  Check,
  CheckCircle,
  CircleAlert,
  CircleDot,
  CircleX,
  Clock,
  Flag,
  ListBullet,
  LoaderCircle,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  type IconComponent,
} from "../chrome/icons";
import {
  AUTOMATION_EXAMPLES,
  type AutomationExample,
} from "../lib/automationExamples";
import { formatRelativeTime } from "../lib/githubTasks";
import {
  isInboxEntryUnread,
  markInboxItemSeen,
  markInboxItemsSeen,
  useInboxSeenTick,
} from "../lib/inboxSeen";
import {
  defaultSessionChoice,
  pickerModelsFor,
  resolveModel,
} from "../lib/models";
import { availablePaletteAgents } from "../lib/paletteAgents";
import { projectName } from "../lib/paths";
import { sameProjectPath } from "../lib/recents";
import {
  loadDefaultRuntimeMode,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/runtimeMode";
import {
  deleteScheduledAgent,
  describeSchedule,
  EVERY_DAY,
  formatRunTime,
  listScheduledAgents,
  listScheduledRuns,
  nextRunAt,
  saveScheduledAgent,
  scheduledRunSeenEntry,
  SCHEDULE_MAX_HOURS,
  SCHEDULE_MIN_HOURS,
  setScheduledAgentEnabled,
  subscribeScheduleEditorRequest,
  subscribeScheduledAgents,
  subscribeScheduledRuns,
  takeScheduleEditorRequest,
  updateScheduledAgent,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type ScheduledAgent,
  type ScheduledRun,
  type ScheduledRunStatus,
  type ScheduleRule,
} from "../lib/scheduledAgents";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { AgentMarkdown } from "./AgentMarkdown";
import { Segmented, Select, Toggle } from "./SettingsControls";

/** List selection that shows the automation manager instead of a run. */
export const SCHEDULES = "schedules";

// Matches the Inbox detail action row.
const ACTION = "inline-flex items-center gap-1.5 rounded-md px-3 text-[12px]";
const ACTION_FILLED = `${ACTION} h-6.5 bg-content text-background-base hover:bg-content/80 disabled:cursor-default disabled:opacity-40`;
const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-40`;
const ICON_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content";

const DAY_FULL_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
/** Monday first, as most calendars show it. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type ScheduledProject = { path: string; name: string };
/** Editing an automation, a blank one, one started from an example, or none. */
export type ScheduleEditorState =
  ScheduledAgent | "new" | { example: AutomationExample } | null;

function editorExample(editor: ScheduleEditorState): AutomationExample | null {
  return editor && typeof editor === "object" && "example" in editor
    ? editor.example
    : null;
}

function editorAgent(editor: ScheduleEditorState): ScheduledAgent | null {
  return editor && editor !== "new" && !("example" in editor) ? editor : null;
}

function editorKey(editor: ScheduleEditorState): string {
  const agent = editorAgent(editor);
  if (agent) return agent.id;
  const example = editorExample(editor);
  return example ? `example:${example.id}` : "new";
}

const EXAMPLE_ICONS: Record<string, IconComponent> = {
  "morning-briefing": Sparkles,
  "nightly-tests": CheckCircle,
  "dependency-check": Wrench,
  "issue-triage": CircleDot,
  "weekly-changelog": ListBullet,
  "stale-todos-docs": Flag,
};

export function useScheduledAgentList(): ScheduledAgent[] {
  return useSyncExternalStore(subscribeScheduledAgents, listScheduledAgents);
}

export function useScheduledRuns(): ScheduledRun[] {
  return useSyncExternalStore(subscribeScheduledRuns, listScheduledRuns);
}

/**
 * Selection and editor state for the Automations view. A "New automation"
 * request from the command palette opens the manager with a blank form.
 */
export function useAutomationSelection() {
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<ScheduleEditorState>(null);
  useEffect(() => {
    const take = () => {
      if (!takeScheduleEditorRequest()) return;
      setSelected(SCHEDULES);
      setEditor("new");
    };
    take();
    return subscribeScheduleEditorRequest(take);
  }, []);
  return { selected, setSelected, editor, setEditor };
}

/** The selected run, else the newest one, else the schedule manager. */
export function resolveScheduledSelection(
  selected: string | null,
  runs: readonly ScheduledRun[],
): string {
  if (selected === SCHEDULES) return SCHEDULES;
  return (
    runs.find((run) => run.id === selected)?.id ?? runs[0]?.id ?? SCHEDULES
  );
}

type StatusMark = {
  Icon: IconComponent;
  className: string;
  label: string;
  spin?: boolean;
};

function runStatusMark(status: ScheduledRunStatus): StatusMark {
  if (status === "running")
    return {
      Icon: LoaderCircle,
      className: "text-content/50",
      label: "Running",
      spin: true,
    };
  if (status === "completed")
    return {
      Icon: Check,
      className: "text-emerald-400/90",
      label: "Completed",
    };
  if (status === "failed")
    return {
      Icon: CircleAlert,
      className: "text-rose-400/90",
      label: "Failed",
    };
  return { Icon: CircleX, className: "text-content/50", label: "Cancelled" };
}

function agentLabel(harness: HarnessId, model: string): string {
  return `${HARNESS_TITLE[harness]} · ${resolveModel(harness, model).name}`;
}

function nextRunLabel(agent: ScheduledAgent): string {
  if (!agent.enabled) return "Off";
  return agent.nextRunAt == null
    ? "Never runs"
    : `Next ${formatRunTime(agent.nextRunAt)}`;
}

// ---------------------------------------------------------------------------
// List column

export function ScheduledRunList({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (key: string) => void;
}) {
  const runs = useScheduledRuns();
  const agents = useScheduledAgentList();
  useInboxSeenTick();
  const entries = runs
    .filter((run) => run.status !== "running")
    .map(scheduledRunSeenEntry);
  const anyUnread = entries.some(isInboxEntryUnread);
  const enabled = agents.filter((agent) => agent.enabled);
  const upcoming = enabled
    .map((agent) => agent.nextRunAt)
    .filter((at): at is number => at != null)
    .sort((a, b) => a - b)[0];
  const managerActive = selected === SCHEDULES;

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-[12px] text-content/50">
          Recent runs
        </span>
        <button
          type="button"
          title="Mark all as read"
          aria-label="Mark all as read"
          disabled={!anyUnread}
          onClick={() => markInboxItemsSeen(entries)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content/45"
        >
          <CheckCheck className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
        <ul className="flex flex-col gap-0.5 p-1.5">
          <li>
            <button
              type="button"
              data-utility-card
              aria-current={managerActive ? "true" : undefined}
              onClick={() => onSelect(SCHEDULES)}
              className={`flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left ${
                managerActive
                  ? "bg-content/10 text-content"
                  : "text-content/80 hover:bg-content/5 hover:text-content"
              }`}
            >
              <Clock
                className="size-3.5 shrink-0 text-content/50"
                strokeWidth={1.75}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold leading-snug text-content">
                  All automations
                </span>
                <span className="truncate text-[11px] text-content/45">
                  {agents.length === 0
                    ? "Start from an example or your own prompt"
                    : upcoming != null
                      ? `${enabled.length} active · next ${formatRunTime(upcoming)}`
                      : `${enabled.length} of ${agents.length} active`}
                </span>
              </span>
            </button>
          </li>
          {runs.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-content/50">
              No runs yet
            </li>
          ) : (
            runs.map((run) => (
              <li key={run.id}>
                <ScheduledRunCard
                  run={run}
                  active={selected === run.id}
                  onSelect={() => {
                    if (run.status !== "running")
                      markInboxItemSeen(scheduledRunSeenEntry(run));
                    onSelect(run.id);
                  }}
                />
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}

function ScheduledRunCard({
  run,
  active,
  onSelect,
}: {
  run: ScheduledRun;
  active: boolean;
  onSelect: () => void;
}) {
  const status = runStatusMark(run.status);
  const unread =
    run.status !== "running" && isInboxEntryUnread(scheduledRunSeenEntry(run));
  const time = formatRelativeTime(
    new Date(run.finishedAt ?? run.startedAt).toISOString(),
  );
  const detail = (run.error || run.summary).split("\n")[0]?.trim();
  return (
    <button
      type="button"
      title={run.name}
      data-utility-card
      data-unread={unread || undefined}
      aria-current={active ? "true" : undefined}
      aria-label={`${run.name}: ${status.label.toLowerCase()}${unread ? ", new" : ""}`}
      onClick={onSelect}
      className={`flex w-full flex-col rounded-md border border-transparent px-2.5 py-2 text-left ${
        active
          ? "bg-content/10 text-content"
          : "text-content/80 hover:bg-content/5 hover:text-content"
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <status.Icon
            className={`size-3 shrink-0 ${status.className} ${status.spin ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-[11px] text-content/50">
            {status.label} · {projectName(run.project)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {time ? (
            <span className="text-[11px] tabular-nums text-content/45">
              {time}
            </span>
          ) : null}
          {unread ? (
            <span aria-hidden className="size-1.5 rounded-full bg-accent" />
          ) : null}
        </span>
      </span>
      <span className="mt-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
        {run.name}
      </span>
      {detail ? (
        <span className="mt-1 line-clamp-1 text-[11px] text-content/45">
          {detail}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail pane

export function ScheduledDetail({
  selected,
  projects,
  cwd,
  editor,
  onEditorChange,
  onRunNow,
  onOpenChat,
}: {
  selected: string;
  projects: readonly ScheduledProject[];
  cwd: string;
  editor: ScheduleEditorState;
  onEditorChange: (editor: ScheduleEditorState) => void;
  onRunNow?: (agent: ScheduledAgent) => void;
  onOpenChat?: (sessionId: string) => void;
}) {
  const runs = useScheduledRuns();
  const run =
    selected === SCHEDULES
      ? undefined
      : runs.find((item) => item.id === selected);
  if (run) return <ScheduledRunDetail run={run} onOpenChat={onOpenChat} />;
  return (
    <ScheduleManager
      projects={projects}
      cwd={cwd}
      editor={editor}
      onEditorChange={onEditorChange}
      onRunNow={onRunNow}
    />
  );
}

function ScheduledRunDetail({
  run,
  onOpenChat,
}: {
  run: ScheduledRun;
  onOpenChat?: (sessionId: string) => void;
}) {
  const status = runStatusMark(run.status);
  const [opening, setOpening] = useState(false);
  const minutes =
    run.finishedAt != null
      ? Math.max(1, Math.round((run.finishedAt - run.startedAt) / 60_000))
      : null;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[12px] text-content/50">
          <Clock className="size-3.5" strokeWidth={1.75} />
          <span>Automation</span>
          <span className={`flex items-center gap-1 ${status.className}`}>
            <status.Icon
              className={`size-3.5 ${status.spin ? "animate-spin" : ""}`}
              strokeWidth={1.75}
            />
            {status.label}
          </span>
        </div>
        <h1 className="text-[20px] font-semibold leading-tight text-content">
          {run.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-content/50">
          <span>{projectName(run.project)}</span>
          <span aria-hidden>·</span>
          <span>Started {formatRunTime(run.startedAt)}</span>
          {minutes != null && run.sessionId ? (
            <>
              <span aria-hidden>·</span>
              <span>{minutes === 1 ? "1 minute" : `${minutes} minutes`}</span>
            </>
          ) : null}
        </div>
        {run.sessionId && onOpenChat ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={opening}
              onClick={() => {
                setOpening(true);
                void Promise.resolve(onOpenChat(run.sessionId!)).finally(() =>
                  setOpening(false),
                );
              }}
              className={ACTION_FILLED}
            >
              <MessageSquare className="size-3.5" strokeWidth={1.75} /> Open
              chat
            </button>
          </div>
        ) : null}
      </header>
      <div className="border-t border-content/10" />
      {run.error ? (
        <p className="text-[13px] text-rose-400/90">{run.error}</p>
      ) : null}
      {run.summary ? (
        <AgentMarkdown text={run.summary} cwd={run.project} />
      ) : run.error ? null : (
        <p className="text-[13px] text-content/45">
          {run.status === "running"
            ? "The agent is still working."
            : "The agent did not reply."}
        </p>
      )}
    </div>
  );
}

function ScheduleManager({
  projects,
  cwd,
  editor,
  onEditorChange,
  onRunNow,
}: {
  projects: readonly ScheduledProject[];
  cwd: string;
  editor: ScheduleEditorState;
  onEditorChange: (editor: ScheduleEditorState) => void;
  onRunNow?: (agent: ScheduledAgent) => void;
}) {
  const agents = useScheduledAgentList();
  const [started, setStarted] = useState<string | null>(null);

  const remove = async (agent: ScheduledAgent) => {
    const ok = await ask(
      `Delete the automation “${agent.name}”? Its past runs stay in the list.`,
      { title: "Aven", kind: "warning", okLabel: "Delete" },
    );
    if (!ok) return;
    deleteScheduledAgent(agent.id);
    if (editorAgent(editor)?.id === agent.id) onEditorChange(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-8 py-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-[20px] font-semibold leading-tight text-content">
            Automations
          </h1>
          <p className="text-[12px] text-content/50">
            While Aven is open, it starts these agents in the background on
            their schedule. Each result appears under Recent runs.
          </p>
        </div>
        <button
          type="button"
          disabled={editor === "new"}
          onClick={() => onEditorChange("new")}
          className={`${ACTION_FILLED} shrink-0`}
        >
          <Plus className="size-3.5" strokeWidth={1.75} /> New automation
        </button>
      </header>
      {editor ? (
        <ScheduleEditor
          key={editorKey(editor)}
          initial={editorAgent(editor) ?? undefined}
          example={editorExample(editor) ?? undefined}
          projects={projects}
          cwd={cwd}
          onCancel={() => onEditorChange(null)}
          onSave={(agent) => {
            saveScheduledAgent(agent);
            onEditorChange(null);
          }}
        />
      ) : null}
      {agents.length === 0 ? (
        editor ? null : (
          <AutomationExamples
            onChoose={(example) => onEditorChange({ example })}
          />
        )
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Automations">
          {agents.map((agent) => (
            <li
              key={agent.id}
              aria-label={agent.name}
              className="aven-inset-card flex items-center gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13px] font-medium text-content">
                  {agent.name}
                </span>
                <span className="truncate text-[11px] text-content/50">
                  {describeSchedule(agent.schedule)} ·{" "}
                  {agentLabel(agent.harness, agent.model)} ·{" "}
                  {projectName(agent.project)}
                </span>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-content/50">
                {started === agent.id ? "Started" : nextRunLabel(agent)}
              </span>
              <Toggle
                label={`Run ${agent.name} on schedule`}
                on={agent.enabled}
                onChange={(on) => setScheduledAgentEnabled(agent.id, on)}
              />
              <button
                type="button"
                disabled={!onRunNow}
                onClick={() => {
                  updateScheduledAgent(agent.id, { lastRunAt: Date.now() });
                  onRunNow?.(agent);
                  setStarted(agent.id);
                }}
                className={ACTION_GHOST}
                aria-label={`Run ${agent.name} now`}
              >
                <Play className="size-3.5" strokeWidth={1.75} /> Run now
              </button>
              <button
                type="button"
                title="Edit"
                aria-label={`Edit ${agent.name}`}
                onClick={() => onEditorChange(agent)}
                className={ICON_BUTTON}
              >
                <Pencil className="size-3.5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                title="Delete"
                aria-label={`Delete ${agent.name}`}
                onClick={() => void remove(agent)}
                className={ICON_BUTTON}
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The empty state: ready-made automations that fill in the editor. */
export function AutomationExamples({
  onChoose,
}: {
  onChoose: (example: AutomationExample) => void;
}) {
  return (
    <section
      className="automation-examples"
      aria-labelledby="automation-examples-title"
    >
      <div className="automation-examples-intro">
        <h2 id="automation-examples-title">Start from an example</h2>
        <p>
          No automations yet. Pick one to fill in the form, then choose the
          project, agent and access before you save. Every example only reads
          and suggests; nothing is pushed, merged or posted for you.
        </p>
      </div>
      <ul className="automation-example-grid">
        {AUTOMATION_EXAMPLES.map((example) => {
          const Icon = EXAMPLE_ICONS[example.id] ?? Clock;
          return (
            <li key={example.id}>
              <button
                type="button"
                className="automation-example-card"
                data-example={example.id}
                onClick={() => onChoose(example)}
              >
                <span className="automation-example-icon" aria-hidden>
                  <Icon className="size-3.5" strokeWidth={1.75} />
                </span>
                <span className="automation-example-name">{example.name}</span>
                <span className="automation-example-summary">
                  {example.summary}
                </span>
                <span className="automation-example-when">
                  <Clock className="size-3" strokeWidth={1.75} aria-hidden />
                  {describeSchedule(example.schedule)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Editor

type Draft = {
  name: string;
  prompt: string;
  project: string;
  harness: HarnessId;
  model: string;
  runtimeMode: RuntimeMode;
  kind: ScheduleRule["kind"];
  days: number[];
  time: string;
  hours: number;
};

/** Name, prompt and timing from an example; the rest stays as it was. */
function exampleDraft(example: AutomationExample): Partial<Draft> {
  const { schedule } = example;
  return {
    name: example.name,
    prompt: example.prompt,
    kind: schedule.kind,
    ...(schedule.kind === "weekly"
      ? { days: [...schedule.days], time: schedule.time }
      : { hours: schedule.hours }),
  };
}

function draftFrom(
  initial: ScheduledAgent | undefined,
  projects: readonly ScheduledProject[],
  cwd: string,
  example?: AutomationExample,
): Draft {
  if (initial)
    return {
      name: initial.name,
      prompt: initial.prompt,
      project: initial.project,
      harness: initial.harness,
      model: initial.model,
      runtimeMode: initial.runtimeMode,
      kind: initial.schedule.kind,
      days:
        initial.schedule.kind === "weekly" ? initial.schedule.days : WEEKDAYS,
      time:
        initial.schedule.kind === "weekly" ? initial.schedule.time : "09:00",
      hours: initial.schedule.kind === "interval" ? initial.schedule.hours : 4,
    };
  const agent = availablePaletteAgents()[0] ?? defaultSessionChoice();
  const blank: Draft = {
    name: "",
    prompt: "",
    project:
      projects.find((project) => sameProjectPath(project.path, cwd))?.path ??
      projects[0]?.path ??
      "",
    harness: agent.harness,
    model: agent.model,
    runtimeMode: loadDefaultRuntimeMode(),
    kind: "weekly",
    days: WEEKDAYS,
    time: "09:00",
    hours: 4,
  };
  return example ? { ...blank, ...exampleDraft(example) } : blank;
}

function ruleFrom(draft: Draft): ScheduleRule {
  return draft.kind === "interval"
    ? { kind: "interval", hours: draft.hours }
    : {
        kind: "weekly",
        days: [...draft.days].sort((a, b) => a - b),
        time: draft.time,
      };
}

function sameRule(a: ScheduleRule, b: ScheduleRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && b.every((day) => a.includes(day));
}

export function ScheduleEditor({
  initial,
  example,
  projects,
  cwd,
  onCancel,
  onSave,
  now = () => Date.now(),
}: {
  initial?: ScheduledAgent;
  /** Prefills a new automation; ignored when editing `initial`. */
  example?: AutomationExample;
  projects: readonly ScheduledProject[];
  cwd: string;
  onCancel: () => void;
  onSave: (agent: ScheduledAgent) => void;
  now?: () => number;
}) {
  const [draft, setDraft] = useState(() =>
    draftFrom(initial, projects, cwd, initial ? undefined : example),
  );
  const [exampleId, setExampleId] = useState(initial ? undefined : example?.id);
  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  const projectOptions = useMemo(() => {
    const options = projects.map((project) => ({
      value: project.path,
      label: project.name,
    }));
    if (
      draft.project &&
      !projects.some((project) => sameProjectPath(project.path, draft.project))
    )
      options.unshift({
        value: draft.project,
        label: projectName(draft.project),
      });
    return options;
  }, [draft.project, projects]);

  const providerOptions = useMemo(() => {
    const agents = availablePaletteAgents();
    if (!agents.some((agent) => agent.harness === draft.harness))
      agents.unshift({
        harness: draft.harness,
        model: draft.model,
        label: HARNESS_TITLE[draft.harness],
      });
    return agents;
  }, [draft.harness, draft.model]);

  const modelOptions = useMemo(() => {
    const models = pickerModelsFor(draft.harness).map((model) => ({
      value: model.id,
      label: model.name,
    }));
    if (!models.some((model) => model.value === draft.model))
      models.unshift({
        value: draft.model,
        label: resolveModel(draft.harness, draft.model).name,
      });
    return models;
  }, [draft.harness, draft.model]);

  const rule = ruleFrom(draft);
  const next =
    rule.kind === "weekly" && !/^\d{2}:\d{2}$/.test(rule.time)
      ? null
      : nextRunAt(rule, new Date(now()));
  const valid =
    draft.name.trim().length > 0 &&
    draft.prompt.trim().length > 0 &&
    draft.project.length > 0 &&
    next != null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    const at = now();
    const keepNext =
      initial && initial.enabled && sameRule(initial.schedule, rule);
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      project: draft.project,
      harness: draft.harness,
      model: draft.model,
      runtimeMode: draft.runtimeMode,
      schedule: rule,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? at,
      ...(initial?.lastRunAt != null ? { lastRunAt: initial.lastRunAt } : {}),
      nextRunAt: keepNext ? initial.nextRunAt : nextRunAt(rule, new Date(at)),
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onCancel();
  };

  const toggleDay = (day: number) =>
    patch({
      days: draft.days.includes(day)
        ? draft.days.filter((item) => item !== day)
        : [...draft.days, day],
    });

  return (
    <form
      data-scheduled-editor
      aria-label={initial ? "Edit automation" : "New automation"}
      className="scheduled-editor"
      onSubmit={submit}
      onKeyDown={onKeyDown}
    >
      <h2>{initial ? "Edit automation" : "New automation"}</h2>
      {initial ? null : (
        <div className="scheduled-field">
          <span>Example</span>
          <div
            className="scheduled-controls scheduled-examples"
            role="group"
            aria-label="Start from an example"
          >
            {AUTOMATION_EXAMPLES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="scheduled-preset"
                aria-pressed={exampleId === item.id}
                title={item.summary}
                onClick={() => {
                  setExampleId(item.id);
                  patch(exampleDraft(item));
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="scheduled-field">
        <span>Name</span>
        <input
          aria-label="Name"
          value={draft.name}
          placeholder="Morning review"
          autoFocus
          spellCheck={false}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </label>
      <label className="scheduled-field">
        <span>Prompt</span>
        <textarea
          aria-label="Prompt"
          value={draft.prompt}
          rows={4}
          placeholder="Summarise yesterday's commits and flag anything risky."
          onChange={(event) => patch({ prompt: event.target.value })}
        />
      </label>
      <div className="scheduled-field">
        <span>Project</span>
        <div className="scheduled-controls">
          {projectOptions.length ? (
            <Select
              label="Project"
              value={draft.project}
              options={projectOptions}
              onChange={(project) => patch({ project })}
            />
          ) : (
            <span className="scheduled-hint">Open a project first.</span>
          )}
        </div>
      </div>
      <div className="scheduled-field">
        <span>Agent</span>
        <div className="scheduled-controls">
          <Select
            label="Provider"
            value={draft.harness}
            options={providerOptions.map((agent) => ({
              value: agent.harness,
              label: HARNESS_TITLE[agent.harness],
            }))}
            onChange={(value) => {
              const agent = providerOptions.find(
                (item) => item.harness === value,
              );
              if (agent) patch({ harness: agent.harness, model: agent.model });
            }}
          />
          <Select
            label="Model"
            value={draft.model}
            options={modelOptions}
            onChange={(model) => patch({ model })}
          />
        </div>
      </div>
      <div className="scheduled-field">
        <span>Access</span>
        <div className="scheduled-controls">
          <Select
            label="Access"
            value={draft.runtimeMode}
            options={RUNTIME_MODES.map((mode) => ({
              value: mode,
              label: RUNTIME_MODE_LABEL[mode],
              description: RUNTIME_MODE_HINT[mode],
            }))}
            onChange={(mode) => patch({ runtimeMode: mode as RuntimeMode })}
          />
        </div>
      </div>
      {draft.runtimeMode === "supervised" ? (
        <p className="scheduled-warning" role="note">
          Supervised runs pause whenever the agent asks for approval. If nobody
          is there to answer, the run waits until you open its chat.
        </p>
      ) : null}
      <div className="scheduled-field">
        <span>Repeat</span>
        <div className="scheduled-controls">
          <Segmented
            label="Repeat"
            value={draft.kind}
            options={[
              { value: "weekly", label: "On days" },
              { value: "interval", label: "Every few hours" },
            ]}
            onChange={(kind) => patch({ kind })}
          />
        </div>
      </div>
      {draft.kind === "weekly" ? (
        <>
          <div className="scheduled-field">
            <span>Days</span>
            <div className="scheduled-controls">
              <div className="scheduled-days" role="group" aria-label="Days">
                {DAY_ORDER.map((day) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={draft.days.includes(day)}
                    aria-label={DAY_FULL_NAMES[day]}
                    onClick={() => toggleDay(day)}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="scheduled-preset"
                aria-pressed={sameDays(draft.days, EVERY_DAY)}
                onClick={() => patch({ days: EVERY_DAY })}
              >
                Every day
              </button>
              <button
                type="button"
                className="scheduled-preset"
                aria-pressed={sameDays(draft.days, WEEKDAYS)}
                onClick={() => patch({ days: WEEKDAYS })}
              >
                Weekdays
              </button>
            </div>
          </div>
          <label className="scheduled-field">
            <span>Time</span>
            <input
              type="time"
              aria-label="Time"
              value={draft.time}
              onChange={(event) => patch({ time: event.target.value })}
            />
          </label>
        </>
      ) : (
        <div className="scheduled-field">
          <span>Every</span>
          <div className="scheduled-controls">
            <Select
              label="Interval"
              value={String(draft.hours)}
              options={Array.from(
                { length: SCHEDULE_MAX_HOURS - SCHEDULE_MIN_HOURS + 1 },
                (_, index) => {
                  const hours = SCHEDULE_MIN_HOURS + index;
                  return {
                    value: String(hours),
                    label: hours === 1 ? "1 hour" : `${hours} hours`,
                  };
                },
              )}
              onChange={(value) => patch({ hours: Number(value) })}
            />
          </div>
        </div>
      )}
      <div className="scheduled-footer">
        <span className="scheduled-hint">
          {next != null
            ? `Next run ${formatRunTime(next, now())}`
            : rule.kind === "weekly" && rule.days.length === 0
              ? "Choose at least one day."
              : "Choose a time."}
        </span>
        <button type="button" onClick={onCancel} className={ACTION_GHOST}>
          Cancel
        </button>
        <button type="submit" disabled={!valid} className={ACTION_FILLED}>
          {initial ? "Save" : "Create automation"}
        </button>
      </div>
    </form>
  );
}
