import "./ScheduledInbox.css";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  CheckCircle,
  CircleDot,
  Clock,
  Flag,
  ListBullet,
  Sparkles,
  Wrench,
  type IconComponent,
} from "../chrome/icons";
import {
  AUTOMATION_EXAMPLES,
  type AutomationExample,
} from "../lib/automationExamples";
import { NO_PROJECT_NAME } from "../lib/automationFolders";
import { useKeepAwakeSetting } from "../hooks/useScheduledAgents";
import {
  defaultSessionChoice,
  pickerModelsFor,
  resolveModel,
} from "../lib/models";
import { availablePaletteAgents } from "../lib/paletteAgents";
import { projectName } from "../lib/paths";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import { sameProjectPath } from "../lib/recents";
import {
  loadDefaultRuntimeMode,
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/runtimeMode";
import {
  describeSchedule,
  EVERY_DAY,
  formatRunTime,
  listScheduledAgents,
  listScheduledRuns,
  nextRunAt,
  saveKeepAwake,
  SCHEDULE_MAX_HOURS,
  SCHEDULE_MIN_HOURS,
  subscribeScheduledAgents,
  subscribeScheduledRuns,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type ScheduledAgent,
  type ScheduledRun,
  type ScheduleRule,
} from "../lib/scheduledAgents";
import { IS_MAC } from "../lib/platform";
import { HARNESS_TITLE, type HarnessId } from "../lib/session";
import { Segmented, Select, Toggle } from "./SettingsControls";

// Matches the Inbox detail action row.
const ACTION =
  "aven-press inline-flex items-center gap-1.5 rounded-md px-3 text-ui-label";
export const ACTION_FILLED = `${ACTION} h-7 bg-content text-background-base hover:bg-(--aven-inverse-hover) disabled:cursor-default disabled:opacity-40`;
export const ACTION_GHOST = `${ACTION} h-7 text-content/70 hover:bg-(--aven-control-bg) hover:text-content disabled:cursor-default disabled:opacity-40`;
export const ICON_BUTTON =
  "aven-press grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-(--aven-control-bg) hover:text-content";

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
/**
 * The editor: an automation being edited, a new one (in a project, or from
 * an example), or none.
 */
export type ScheduleEditorState =
  | { mode: "edit"; agent: ScheduledAgent }
  | { mode: "new"; project?: string; example?: AutomationExample }
  | null;

export function editorKey(editor: ScheduleEditorState): string {
  if (!editor) return "none";
  if (editor.mode === "edit") return editor.agent.id;
  return `new:${editor.project ?? ""}:${editor.example?.id ?? ""}`;
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

export function agentLabel(harness: HarnessId, model: string): string {
  return `${HARNESS_TITLE[harness]} · ${resolveModel(harness, model).name}`;
}

/** The list's one setting: hold off sleep while automations wait. */
export function KeepAwakeRow() {
  const on = useKeepAwakeSetting();
  const device = IS_MAC ? "Mac" : "computer";
  const why = `While Aven is open, your ${device} won’t go to sleep on its own, so overnight runs still happen. The screen can still turn off.${IS_MAC ? " Closing the lid still puts it to sleep." : ""}`;
  return (
    <div className="automation-keep-awake" title={why}>
      <span className="automation-keep-awake-label">
        Keep this {device} awake
      </span>
      <Toggle
        label={`Keep this ${device} awake for automations`}
        on={on}
        onChange={saveKeepAwake}
      />
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

/**
 * Where a new automation goes: the project asked for, else the project open
 * now, else no project when you are in your chats outside one, else the
 * first project.
 */
function defaultProject(
  projects: readonly ScheduledProject[],
  cwd: string,
  project?: string,
): string {
  if (project !== undefined) return isProjectlessCwd(project) ? "" : project;
  const open = projects.find((item) => sameProjectPath(item.path, cwd));
  if (open) return open.path;
  if (isProjectlessCwd(cwd)) return "";
  return projects[0]?.path ?? "";
}

function draftFrom(
  initial: ScheduledAgent | undefined,
  projects: readonly ScheduledProject[],
  cwd: string,
  example?: AutomationExample,
  project?: string,
): Draft {
  if (initial)
    return {
      name: initial.name,
      prompt: initial.prompt,
      project: isProjectlessCwd(initial.project) ? "" : initial.project,
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
    project: defaultProject(projects, cwd, project),
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
  project,
  projects,
  cwd,
  onCancel,
  onSave,
  now = () => Date.now(),
}: {
  initial?: ScheduledAgent;
  /** Prefills a new automation; ignored when editing `initial`. */
  example?: AutomationExample;
  /** The folder a new automation starts in; "" for no project. */
  project?: string;
  projects: readonly ScheduledProject[];
  cwd: string;
  onCancel: () => void;
  onSave: (agent: ScheduledAgent) => void;
  now?: () => number;
}) {
  const [draft, setDraft] = useState(() =>
    draftFrom(
      initial,
      projects,
      cwd,
      initial ? undefined : example,
      initial ? undefined : project,
    ),
  );
  const [exampleId, setExampleId] = useState(initial ? undefined : example?.id);
  const patch = (next: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...next }));

  // Moving an automation to another project moves it to that folder.
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
    options.push({ value: "", label: NO_PROJECT_NAME });
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
          <Select
            label="Project"
            value={draft.project}
            options={projectOptions}
            onChange={(project) => patch({ project })}
          />
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
          With Ask first, a run pauses whenever the agent asks for approval. If
          nobody is there to answer, the run waits until you open it.
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
