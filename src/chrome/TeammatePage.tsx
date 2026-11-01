import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Segmented, Toggle } from "../surfaces/SettingsControls";
import {
  removeCrewMember,
  setCrewLimit,
  setDefaultBuilder,
  updateCrewMember,
  type CrewMemberChange,
} from "../lib/crewActions";
import { crewEffortSetting } from "../lib/crewModels";
import {
  CREW_INSTRUCTIONS_MAX,
  CREW_ROLE_INFO,
  defaultBuilder,
  memberCritter,
  memberJob,
  type Crew,
  type CrewMember,
  type CrewScoutSchedule,
} from "../lib/crews";
import { MEMBER_SIGIL_CHOICES } from "../lib/dotSigils";
import { LAYER } from "../lib/layers";
import {
  getModelSnapshot,
  pickerModelsFor,
  subscribeModels,
} from "../lib/models";
import type { HarnessId } from "../lib/session";
import {
  LIMIT_CHOICES,
  NumberPick,
  agentProblem,
  agentWord,
  memberApp,
  modelName,
  useInstalledAgents,
} from "./crewSettingsParts";
import { CrewCritter } from "./CrewCritter";
import { DotMark } from "./DotMark";
import { ChevronDown } from "./icons";
import { Popover } from "./Popover";
import "./TeammatePage.css";

/**
 * A teammate's page: its job, your instructions and where it works on the
 * left; what it runs on (agent, model, effort) and when it works on the
 * right, all in view at once; Remove from team, quietly, at the bottom.
 * Every change saves as you make it. None of these change what it may do:
 * that comes from its role alone (see `crewChatPermissions`).
 */

/** Models shown before Older models. */
const RECENT_MODELS = 4;

/** "A Builder on Pom's team · changes files only in the team's copy". */
export function teammateSubtitle(member: CrewMember, project: string): string {
  const role = CREW_ROLE_INFO[member.role].label;
  const article = /^[AEIOU]/.test(role) ? "An" : "A";
  return `${article} ${role} on ${project}'s team · ${
    CREW_ROLE_INFO[member.role].edits
      ? "changes files only in the team's copy"
      : "only reads"
  }`;
}

export function TeammateBody({
  crew,
  member,
  name,
}: {
  crew: Crew;
  member: CrewMember;
  name: string;
}) {
  const path = crew.path;
  const [problem, setProblem] = useState<string | null>(null);
  const set = (change: CrewMemberChange) =>
    setProblem(updateCrewMember(path, member.id, change));
  return (
    <div className="teammate" data-crew-member-page={member.id}>
      <div className="teammate-cols">
        <div className="teammate-main">
          <JobField member={member} onChange={set} />
          <InstructionsField member={member} onChange={set} />
          {member.role === "builder" ? (
            <ScopeField member={member} onChange={set} />
          ) : null}
        </div>
        <section className="teammate-runs" aria-label="Runs on">
          <h3 className="teammate-runs-title">Runs on</h3>
          <RunsOn member={member} onChange={set} onProblem={setProblem} />
          <WhenItWorks crew={crew} member={member} onProblem={setProblem} />
        </section>
      </div>
      {problem ? (
        <p className="bot-sheet-problem teammate-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <footer className="teammate-foot">
        <RemoveMember crew={crew} member={member} name={name} />
        <span className="teammate-foot-note" data-crew-member-rules>
          {CREW_ROLE_INFO[member.role].edits
            ? "Never pushes or publishes, and runs in its sandbox."
            : "Only reads, never pushes, and runs in its sandbox."}{" "}
          Changes save as you make them.
        </span>
      </footer>
    </div>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="teammate-field">
      <div className="teammate-field-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <b>{label}</b>}
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** Its job: a titled teammate's own, editable; a role's, as its role has it. */
function JobField({
  member,
  onChange,
}: {
  member: CrewMember;
  onChange: (change: CrewMemberChange) => void;
}) {
  const id = useId();
  if (!member.label)
    return (
      <Field label="Job" hint="What its role is for">
        <p className="teammate-job" data-crew-member-job>
          {memberJob(member)}
        </p>
      </Field>
    );
  return (
    <Field
      label="Job"
      hint="Its title, and one line on what it's for"
      htmlFor={id}
    >
      <div className="teammate-pair">
        <input
          key={`title:${member.id}`}
          className="aven-field teammate-input"
          aria-label="Title"
          title="Its title"
          defaultValue={member.label}
          maxLength={40}
          onBlur={(event) => {
            if (event.target.value.trim())
              onChange({ label: event.target.value });
          }}
        />
        <input
          id={id}
          key={`job:${member.id}`}
          className="aven-field teammate-input"
          aria-label="Job"
          placeholder={CREW_ROLE_INFO[member.role].job}
          defaultValue={member.job ?? ""}
          maxLength={120}
          onBlur={(event) => onChange({ job: event.target.value })}
        />
      </div>
    </Field>
  );
}

function InstructionsField({
  member,
  onChange,
}: {
  member: CrewMember;
  onChange: (change: CrewMemberChange) => void;
}) {
  const id = useId();
  const [text, setText] = useState(member.instructions ?? "");
  return (
    <Field
      label="Instructions"
      hint="Standing rules, in your words"
      htmlFor={id}
    >
      <textarea
        id={id}
        className="aven-field teammate-input teammate-text"
        aria-label="Instructions"
        title="Your words for this teammate, read at every turn. They add to the team's rules and never replace them."
        rows={4}
        maxLength={CREW_INSTRUCTIONS_MAX}
        placeholder={
          member.role === "checker"
            ? "Like “Always run the end-to-end tests”"
            : member.role === "scout"
              ? "Like “Look for small fixes in the docs”"
              : "Like “Match the existing styles”"
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange({ instructions: text })}
      />
    </Field>
  );
}

/** Chips shown before "+N more · Edit". */
const SCOPE_SHOWN = 5;

/** Where a Builder works: its paths as chips, and Edit for the list. */
function ScopeField({
  member,
  onChange,
}: {
  member: CrewMember;
  onChange: (change: CrewMemberChange) => void;
}) {
  const id = useId();
  const scope = member.scope ?? [];
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(scope.join("\n"));
  const field = useRef<HTMLTextAreaElement>(null);
  const more = scope.length - SCOPE_SHOWN;
  return (
    <Field
      label="Works only in"
      hint="A change outside these is a must-fix for its Checker"
      htmlFor={editing ? id : undefined}
    >
      {editing ? (
        <div className="teammate-scope-edit">
          <textarea
            id={id}
            ref={field}
            className="aven-field teammate-input teammate-text"
            aria-label="Works only in"
            title="One path or pattern a line; empty for the whole project. A change outside these goes back as a must-fix."
            rows={4}
            autoFocus
            placeholder="The whole project"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => onChange({ scope: text })}
          />
          <button
            type="button"
            className="teammate-chip teammate-chip-action"
            onClick={() => {
              onChange({ scope: text });
              setEditing(false);
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="teammate-chips" data-crew-scope>
          {scope.length ? (
            scope.slice(0, SCOPE_SHOWN).map((entry) => (
              <code key={entry} className="teammate-chip">
                {entry}
              </code>
            ))
          ) : (
            <span className="teammate-chip teammate-chip-plain">
              The whole project
            </span>
          )}
          <button
            type="button"
            className="teammate-chip teammate-chip-action"
            data-crew-scope-edit
            onClick={() => {
              setText(scope.join("\n"));
              setEditing(true);
            }}
          >
            {more > 0 ? `+${more} more · Edit` : "Edit"}
          </button>
        </div>
      )}
    </Field>
  );
}

/** Agent, model and effort, side by side with the job: no floating menu. */
function RunsOn({
  member,
  onChange,
  onProblem,
}: {
  member: CrewMember;
  onChange: (change: CrewMemberChange) => void;
  onProblem: (problem: string | null) => void;
}) {
  const agents = useInstalledAgents();
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const { harness, model } = memberApp(member);
  const effort = crewEffortSetting(harness, model);
  const [older, setOlder] = useState(false);
  const models = pickerModelsFor(harness);
  // Its model is always listed: first among the recent ones when it's older.
  const recent = models.slice(0, RECENT_MODELS);
  const known = models.some((item) => item.id === model);
  const rest = models.slice(RECENT_MODELS);
  const shown = [
    ...(known ? [] : [{ id: model, name: modelName(model) }]),
    ...recent,
    ...rest.filter((item) => item.id === model),
  ];
  const tucked = rest.filter((item) => item.id !== model);
  const pickModel = (id: string) => onChange({ model: id });
  return (
    <>
      <div className="teammate-field">
        <div className="teammate-field-label">
          <b>Agent</b>
        </div>
        <Segmented
          label="Agent"
          className="teammate-segmented"
          value={harness}
          options={agents.map((id) => {
            const why = agentProblem(id, member.role);
            return {
              value: id,
              label: agentWord(id),
              ...(why && id !== harness ? { disabled: true, title: why } : {}),
            };
          })}
          onChange={(id: HarnessId) => {
            const why = agentProblem(id, member.role);
            if (why) return onProblem(`${agentWord(id)}: ${why}.`);
            onChange({ harness: id });
          }}
        />
        {member.fallback ? (
          <p className="teammate-small">
            Checking with Claude for now: Codex couldn't be locked down here.
          </p>
        ) : null}
      </div>
      <div className="teammate-field">
        <div className="teammate-field-label">
          <b>Model</b>
          <span>Its usual model; a card can pick another</span>
        </div>
        <ModelList
          label="Model"
          models={shown}
          value={model}
          onChange={pickModel}
        />
        {tucked.length ? (
          <>
            <button
              type="button"
              className="teammate-older"
              aria-expanded={older}
              data-crew-older-models
              onClick={() => setOlder(!older)}
            >
              Older models
              <ChevronDown className="teammate-older-chevron size-3" />
            </button>
            {older ? (
              <ModelList
                label="Older models"
                models={tucked}
                value={model}
                onChange={pickModel}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {effort ? (
        <div className="teammate-field">
          <div className="teammate-field-label">
            <b>Effort</b>
            <span>How hard it thinks</span>
          </div>
          <Segmented
            label="Effort"
            className="teammate-segmented teammate-segmented-small"
            // Many efforts (Opus has eight) wrap into rows of four.
            {...(effort.options.length >= 5 ? { columns: 4 } : {})}
            value={
              effort.options.some((option) => option.value === member.effort)
                ? member.effort!
                : ""
            }
            options={[
              { value: "", label: "Default" },
              ...effort.options.map((option) => ({
                value: option.value,
                label: option.label,
              })),
            ]}
            onChange={(value) => onChange({ effort: value || null })}
          />
        </div>
      ) : null}
    </>
  );
}

/** Models as a list of choices, one picked: arrow keys move between them. */
function ModelList({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: readonly { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const picked = models.findIndex((item) => item.id === value);
  const focusable = picked >= 0 ? picked : 0;
  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight")
      next = (index + 1) % models.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
      next = (index - 1 + models.length) % models.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = models.length - 1;
    else return;
    event.preventDefault();
    onChange(models[next]!.id);
    rows.current[next]?.focus();
  };
  return (
    <div
      className="teammate-models"
      role="radiogroup"
      aria-label={label}
      data-crew-models={label}
    >
      {models.map((item, index) => (
        <button
          key={item.id}
          ref={(node) => {
            rows.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={item.id === value}
          tabIndex={index === focusable ? 0 : -1}
          className="teammate-model"
          data-model={item.id}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <span className="teammate-model-dot" aria-hidden="true" />
          <span className="teammate-model-name">{item.name}</span>
          {item.id === value ? (
            <span className="teammate-model-tag">Usual</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * When it works, under Runs on: the Scout's looks and its ideas a day,
 * Security's weekly sweep, and which Builder takes cards no rule picks.
 */
function WhenItWorks({
  crew,
  member,
  onProblem,
}: {
  crew: Crew;
  member: CrewMember;
  onProblem: (problem: string | null) => void;
}) {
  const path = crew.path;
  let body: ReactNode = null;
  if (member.role === "scout")
    body = (
      <>
        <Segmented
          label="Looks for ideas"
          className="teammate-segmented teammate-segmented-small"
          value={member.schedule ?? "daily"}
          options={[
            { value: "daily", label: "Once a day" },
            { value: "weekly", label: "Once a week" },
            { value: "off", label: "Never" },
          ]}
          onChange={(schedule: CrewScoutSchedule) =>
            onProblem(updateCrewMember(path, member.id, { schedule }))
          }
        />
        <div
          className="teammate-row"
          title="Only while the team has nothing else to do"
        >
          <span>Ideas a day</span>
          <NumberPick
            label="Ideas a day"
            value={crew.limits.ideasPerDay}
            choices={LIMIT_CHOICES.ideasPerDay}
            onChange={(value) => setCrewLimit(path, "ideasPerDay", value)}
          />
        </div>
        <div
          className="teammate-row"
          title="Small ones, a day. 0 for none: you give each one"
        >
          <span>Start by themselves</span>
          <NumberPick
            label="Ideas that start by themselves a day"
            value={crew.limits.autoStartsPerDay}
            choices={LIMIT_CHOICES.autoStartsPerDay}
            onChange={(value) => setCrewLimit(path, "autoStartsPerDay", value)}
          />
        </div>
      </>
    );
  else if (member.role === "security")
    body = (
      <div
        className="teammate-row"
        title="Reads the whole project and adds security cards to Ideas. They wait for you"
      >
        <span>Security sweep</span>
        <Segmented
          label="Security sweep"
          className="teammate-segmented teammate-segmented-small"
          value={member.sweep ?? "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "weekly", label: "Once a week" },
          ]}
          onChange={(sweep) =>
            onProblem(
              updateCrewMember(path, member.id, {
                sweep: sweep === "weekly" ? "weekly" : "off",
              }),
            )
          }
        />
      </div>
    );
  else if (
    member.role === "builder" &&
    crew.members.filter((entry) => entry.role === "builder").length > 1
  ) {
    const isDefault = defaultBuilder(crew)?.id === member.id;
    body = (
      <div className="teammate-row" title="One Builder is the default">
        <span>Takes cards no rule picks</span>
        <Toggle
          label="Takes cards no rule picks"
          tone="neutral"
          on={isDefault}
          disabled={isDefault}
          onChange={(on) => {
            if (on) setDefaultBuilder(path, member.id);
          }}
        />
      </div>
    );
  }
  if (!body) return null;
  return (
    <div className="teammate-field teammate-when" data-crew-when>
      <div className="teammate-field-label">
        <b>When it works</b>
        {member.role === "scout" ? (
          <span>Only while the team has nothing else to do</span>
        ) : null}
      </div>
      {body}
    </div>
  );
}

/** The teammate's mark: pressing it opens the marks to pick from. */
export function MarkButton({
  path,
  member,
}: {
  path: string;
  member: CrewMember;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const mark = memberCritter(member);
  return (
    <>
      <button
        type="button"
        className="bot-sheet-critter crew-mark-button"
        aria-label="Change its mark"
        title="Change its mark"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        data-crew-mark-button
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <CrewCritter
          path={path}
          role={member.role}
          {...(member.critter ? { critter: mark } : {})}
          className="bot-sheet-critter-sprite"
        />
      </button>
      {anchor ? (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={268}
          // Above the sheet it opens from.
          layer={LAYER.dialog + 1}
          autoFocus
          onDismiss={() => setAnchor(null)}
          role="dialog"
          aria-label="Its mark"
          className="crew-mark-popover"
          data-crew-mark-popover
        >
          <div
            className="crew-critter-grid"
            role="radiogroup"
            aria-label="Mark"
          >
            {MEMBER_SIGIL_CHOICES.map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={item.key === mark}
                aria-label={item.label}
                title={item.label}
                className="crew-critter-cell"
                data-mark-choice={item.key}
                onClick={() => {
                  const why = updateCrewMember(path, member.id, {
                    critter: item.key,
                  });
                  setProblem(why);
                  if (!why) setAnchor(null);
                }}
              >
                <DotMark sigil={item} className="crew-critter-cell-art" />
              </button>
            ))}
          </div>
          {problem ? (
            <p className="bot-sheet-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </Popover>
      ) : null}
    </>
  );
}

/**
 * Remove from team: a quiet word. The last Builder or Checker stays (its
 * why is the tooltip), and you're asked first.
 */
function RemoveMember({
  crew,
  member,
  name,
}: {
  crew: Crew;
  member: CrewMember;
  name: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const last =
    (member.role === "builder" || member.role === "checker") &&
    crew.members.filter((entry) => entry.role === member.role).length <= 1;
  if (confirming)
    return (
      <div className="crew-settings-remove" data-confirming>
        <p className="bot-sheet-question">Remove {name}?</p>
        <p className="bot-sheet-note">
          Its cards go by the team's rules. Its chat stays in your history and
          doesn't run again.
        </p>
        {problem ? (
          <p className="bot-sheet-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="bot-sheet-actions">
          <button
            type="button"
            className="team-card-button"
            onClick={() => setConfirming(false)}
          >
            Keep it
          </button>
          <button
            type="button"
            className="team-card-button"
            data-variant="primary"
            onClick={() => {
              // Removed: the sheet goes back to the team by itself.
              const why = removeCrewMember(crew.path, member.id);
              if (why) setProblem(why);
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  return (
    <button
      type="button"
      className="crew-settings-remove-link"
      disabled={last}
      title={
        last
          ? `A team needs a ${CREW_ROLE_INFO[member.role].label}.`
          : undefined
      }
      onClick={() => setConfirming(true)}
    >
      Remove from team
    </button>
  );
}
