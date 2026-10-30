import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Toggle } from "../surfaces/SettingsControls";
import {
  addCrewMember,
  addCrewPreset,
  crewAgentAllowed,
  crewModelFor,
  crewModelsHere,
  presetInCrew,
  removeCrewMember,
  setCrewLimit,
  setCrewPaused,
  setCrewQuietHours,
  setCrewRoutes,
  setDefaultBuilder,
  turnOffCrew,
  updateCrewMember,
  type CrewMemberChange,
  type CrewTemplate,
} from "../lib/crewActions";
import { quietText } from "../lib/crewLimits";
import { crewEffortSetting } from "../lib/crewModels";
import {
  CREW_AGENTS,
  CREW_ALL_RUNS_RANGE,
  CREW_INSTRUCTIONS_MAX,
  CREW_ROLE_INFO,
  crewAgentsFor,
  crewMemberApp,
  crewMemberById,
  crewMemberName,
  crewMembers,
  defaultBuilder,
  memberCritter,
  memberJob,
  memberLabel,
  setCrewsAllRunsPerDay,
  useCrew,
  useCrewsAllRunsPerDay,
  type Crew,
  type CrewLimitName,
  type CrewMember,
  type CrewRole,
  type CrewScoutSchedule,
} from "../lib/crews";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { findModel, preferredModelId } from "../lib/models";
import { projectName } from "../lib/paths";
import { saveBotSettings } from "../lib/projectBotActions";
import { ALWAYS_ASKS_LINE } from "../lib/projectBotPermissions";
import {
  BOT_WAKE_KINDS,
  formatClockMinutes,
  useProjectBot,
} from "../lib/projectBots";
import { PROJECT_MASCOTS } from "../lib/projectMascots";
import { CREW_PRESETS } from "../lib/crewPresets";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";
import { BotCritter } from "./BotCritter";
import { CrewCritter, CrewCritters } from "./CrewCritter";
import { ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "./icons";
import { Modal } from "./Modal";
import { ModelPicker } from "./ModelPicker";
import { ProjectMascot } from "./ProjectMascot";
import "./TeamCard.css";
import "./BotSettingsSheet.css";
import "./CrewCritter.css";

/** Whole hours a quiet time can start or end at, as the pickers list them. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour * 60);

/** The values each limit's picker offers (yours is added when it isn't one). */
const LIMIT_CHOICES: Readonly<Record<CrewLimitName, readonly number[]>> = {
  roundsPerCard: [1, 2, 3, 4, 5],
  runsPerDay: [5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200],
  autoStartsPerDay: [0, 1, 2, 3, 5, 8, 10, 15, 20],
  ideasPerDay: [0, 1, 2, 3, 4, 5, 6, 8, 10],
  turnMinutes: [5, 10, 15, 20, 30, 45, 60, 90, 120],
  pauseAtPercent: [50, 60, 70, 80, 90, 100],
};
const ALL_RUNS_CHOICES = [20, 30, 40, 60, 80, 100, 150, 200, 300, 500].filter(
  (value) => value >= CREW_ALL_RUNS_RANGE[0] && value <= CREW_ALL_RUNS_RANGE[1],
);

type Page =
  | { kind: "crew" }
  | { kind: "member"; id: string }
  | { kind: "add"; custom?: boolean };

/**
 * A crew's settings: who is in it and how each works, who builds what,
 * its limits and quiet hours, Pause and Turn off. A member's own page sets
 * its name and critter, the app and model it runs on, your instructions,
 * the paths it works in, and when it works. None of these change what a
 * member may do: that comes from its role (see `crewChatPermissions`).
 */
export function CrewSettingsSheet({
  path,
  fixerName,
  initialPage,
  onTurnOn,
  onAddFixer,
  onFixerSettings,
  onClose,
}: {
  path: string;
  fixerName?: string;
  /** Open on a member's page (its id), or on Add ("add"). */
  initialPage?: string;
  /** Turn the crew on (it is off). Resolves with why it couldn't, or null. */
  onTurnOn: (path: string) => Promise<string | null>;
  /** Add the project's bot as the crew's Fixer. */
  onAddFixer?: (path: string) => void;
  /** Open the Fixer's own settings (the project bot's). */
  onFixerSettings?: (path: string) => void;
  onClose: () => void;
}) {
  const crew = useCrew(path);
  const appearance = useProjectAppearance(path);
  const project = appearance?.label || projectName(path);
  const nameId = useId();
  const [page, setPage] = useState<Page>(() =>
    initialPage === "add"
      ? { kind: "add" }
      : initialPage
        ? { kind: "member", id: initialPage }
        : { kind: "crew" },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  useEffect(() => {
    // The agent lists say which apps are installed.
    void probeHarnessAvailability();
  }, []);
  const member =
    crew && page.kind === "member" ? crewMemberById(crew, page.id) : undefined;
  const gone = !!crew && page.kind === "member" && !member;
  useEffect(() => {
    // Removed (here or in another window): back to the crew.
    if (gone) setPage({ kind: "crew" });
  }, [gone]);
  if (!crew || gone) return null;
  const toCrew = () => setPage({ kind: "crew" });
  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const error = await onTurnOn(path);
    setBusy(false);
    if (error) setProblem(error);
  };
  // One sheet whose header and body follow the page, so moving between
  // pages never closes and opens it again.
  let header: {
    title: ReactNode;
    description: string;
    leading?: ReactNode;
    trailing?: ReactNode;
  };
  let body: ReactNode;
  if (member?.role === "fixer") {
    header = {
      title: crewMemberName(crew, member.id, fixerName),
      description: `Fixer in ${project}'s crew`,
      leading: (
        <span className="bot-sheet-critter">
          <BotCritter path={path} className="bot-sheet-critter-sprite" />
        </span>
      ),
    };
    body = (
      <FixerBody
        path={path}
        project={project}
        onFixerSettings={onFixerSettings}
        onBack={toCrew}
        onClose={onClose}
      />
    );
  } else if (member) {
    const name = crewMemberName(crew, member.id);
    const defaultName = crewMemberName(
      { members: [{ ...member, name: undefined }] },
      member.id,
    );
    header = {
      title: (
        <input
          id={nameId}
          key={member.id}
          aria-label="Name"
          className="bot-sheet-title-field"
          defaultValue={member.name ?? ""}
          placeholder={defaultName}
          maxLength={40}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value.trim();
            updateCrewMember(path, member.id, {
              name: next && next !== defaultName ? next : null,
            });
          }}
        />
      ),
      description: `${memberLabel(member)} in ${project}'s crew`,
      leading: (
        <span className="bot-sheet-critter">
          <CrewCritter
            path={path}
            role={member.role}
            {...(member.critter ? { critter: memberCritter(member) } : {})}
            className="bot-sheet-critter-sprite"
          />
        </span>
      ),
      trailing: (
        <Toggle
          label={`${name} on`}
          tone="neutral"
          on={!member.paused}
          onChange={(on) => updateCrewMember(path, member.id, { paused: !on })}
        />
      ),
    };
    body = (
      <MemberBody
        key={member.id}
        crew={crew}
        member={member}
        name={name}
        project={project}
        onBack={toCrew}
        onClose={onClose}
      />
    );
  } else if (page.kind === "add") {
    header = {
      title: page.custom ? "Your own member" : "Add to the crew",
      description: page.custom
        ? "It builds or checks, with your title and instructions"
        : "Several Builders and Checkers; one Scout and one Fixer",
    };
    body = (
      <AddBody
        crew={crew}
        custom={!!page.custom}
        hasFixer={!!fixerName}
        onAddFixer={onAddFixer}
        onCustom={(custom) => setPage({ kind: "add", custom })}
        onAdded={(id) => setPage({ kind: "member", id })}
        onBack={toCrew}
      />
    );
  } else {
    const members = crewMembers(crew).filter(
      (entry) => entry.role !== "fixer" || !!fixerName,
    );
    header = {
      title: `${project} crew`,
      description: "Works only while Aven is open and your Mac is awake",
      leading: (
        <span className="bot-sheet-critter">
          <CrewCritters
            path={path}
            roles={members.map((entry) => ({
              id: entry.id,
              role: entry.role,
              ...(entry.critter ? { critter: memberCritter(entry) } : {}),
            }))}
          />
        </span>
      ),
      trailing: (
        <Toggle
          label="Crew on"
          tone="neutral"
          on={crew.on}
          disabled={busy}
          onChange={(on) => {
            if (on) void turnOn();
            else setConfirmingOff(true);
          }}
        />
      ),
    };
    body = confirmingOff ? (
      <div className="bot-sheet-body">
        <p className="bot-sheet-question">Turn the crew off?</p>
        <p className="bot-sheet-note">
          What it is doing stops and nothing new starts. Its cards and its copy
          stay, so Ready work is still there when you turn it on.
        </p>
        <div className="bot-sheet-actions">
          <button
            type="button"
            className="team-card-button"
            onClick={() => setConfirmingOff(false)}
          >
            Keep it on
          </button>
          <button
            type="button"
            className="team-card-button"
            data-variant="primary"
            onClick={() => {
              void turnOffCrew(path);
              setConfirmingOff(false);
            }}
          >
            Turn off
          </button>
        </div>
      </div>
    ) : (
      <CrewBody
        crew={crew}
        members={members}
        fixerName={fixerName}
        problem={problem}
        onOpenMember={(id) => setPage({ kind: "member", id })}
        onAdd={() => setPage({ kind: "add" })}
        onClose={onClose}
      />
    );
  }
  return (
    <Modal
      onClose={onClose}
      title={header.title}
      description={header.description}
      size="md"
      className="bot-sheet crew-settings"
      leading={header.leading}
      trailing={header.trailing}
    >
      {body}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pieces

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="crew-settings-section" aria-label={title}>
      <h3 className="crew-settings-heading">{title}</h3>
      {children}
    </section>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button type="button" className="crew-settings-back" onClick={onBack}>
      <ChevronLeft className="size-3.5" />
      {label}
    </button>
  );
}

/** A labelled picker of numbers, yours kept when it isn't one of the choices. */
function NumberPick({
  label,
  value,
  choices,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  choices: readonly number[];
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const values = choices.includes(value)
    ? choices
    : [...choices, value].sort((a, b) => a - b);
  return (
    <select
      className="aven-field crew-settings-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {values.map((item) => (
        <option key={item} value={item}>
          {format(item)}
        </option>
      ))}
    </select>
  );
}

function LimitRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="bot-sheet-row crew-settings-limit">
      <span>
        {title}
        <small>{detail}</small>
      </span>
      {children}
    </div>
  );
}

function memberApp(member: CrewMember): { harness: HarnessId; model: string } {
  const app = crewMemberApp(member);
  return {
    harness: app.harness,
    model: app.model ?? preferredModelId(app.harness),
  };
}

function modelName(id: string): string {
  return findModel(id)?.name ?? id;
}

/** "Codex · GPT-5 · high · in src/ui": how a member runs, one line. */
function memberSummary(crew: Crew, member: CrewMember): string {
  if (member.role === "fixer") return memberJob(member);
  const { harness, model } = memberApp(member);
  const scout =
    member.role === "scout"
      ? member.schedule === "off"
        ? "doesn't look"
        : member.schedule === "weekly"
          ? "looks once a week"
          : "looks once a day"
      : "";
  return [
    HARNESS_TITLE[harness],
    modelName(model),
    member.effort ?? "",
    member.scope?.length ? `in ${member.scope.join(", ")}` : "",
    scout,
    member.role === "security" && member.sweep === "weekly"
      ? "sweeps weekly"
      : "",
    member.role === "builder" &&
    crew.members.filter((entry) => entry.role === "builder").length > 1 &&
    defaultBuilder(crew)?.id === member.id
      ? "default"
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// The crew

function CrewBody({
  crew,
  members,
  fixerName,
  problem,
  onOpenMember,
  onAdd,
  onClose,
}: {
  crew: Crew;
  members: readonly CrewMember[];
  fixerName?: string;
  /** Why the crew couldn't turn on. */
  problem: string | null;
  onOpenMember: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const path = crew.path;
  const allRuns = useCrewsAllRunsPerDay();
  const quiet = crew.limits.quiet;
  const limit = (name: CrewLimitName) => (value: number) =>
    setCrewLimit(path, name, value);
  return (
    <div className="bot-sheet-body" data-crew-settings={path}>
      <Section title="Members">
        {members.map((member) => (
          <button
            key={member.id}
            type="button"
            className="bot-sheet-row crew-settings-member"
            data-crew-member-row={member.id}
            onClick={() => onOpenMember(member.id)}
          >
            <CrewCritter
              path={path}
              role={member.role}
              {...(member.critter ? { critter: memberCritter(member) } : {})}
            />
            <span>
              <strong>
                {crewMemberName(crew, member.id, fixerName)}{" "}
                <small className="crew-settings-role">
                  {memberLabel(member)}
                </small>
              </strong>
              <small>{memberSummary(crew, member)}</small>
            </span>
            {member.paused ? (
              <span className="crew-settings-off">Off</span>
            ) : null}
            <ChevronRight className="crew-settings-chevron size-3.5" />
          </button>
        ))}
        <button
          type="button"
          className="crew-settings-add"
          data-crew-add-member
          onClick={onAdd}
        >
          <Plus className="size-3.5" />
          Add member
        </button>
      </Section>
      <RoutingSection crew={crew} />
      <Section title="Limits">
        <LimitRow title="Rounds a card" detail="Then it stops and asks you">
          <NumberPick
            label="Rounds a card"
            value={crew.limits.roundsPerCard}
            choices={LIMIT_CHOICES.roundsPerCard}
            onChange={limit("roundsPerCard")}
          />
        </LimitRow>
        <LimitRow
          title="Runs a day"
          detail="One run is one bot turn, the Fixer's included"
        >
          <NumberPick
            label="Runs a day"
            value={crew.limits.runsPerDay}
            choices={LIMIT_CHOICES.runsPerDay}
            onChange={limit("runsPerDay")}
          />
        </LimitRow>
        <LimitRow
          title="Runs a day, all crews"
          detail="A ceiling for every crew together"
        >
          <NumberPick
            label="Runs a day, all crews"
            value={allRuns}
            choices={ALL_RUNS_CHOICES}
            onChange={setCrewsAllRunsPerDay}
          />
        </LimitRow>
        <LimitRow
          title="Ideas that start by themselves"
          detail="A day, only small ones from the project. 0 for none"
        >
          <NumberPick
            label="Ideas that start by themselves a day"
            value={crew.limits.autoStartsPerDay}
            choices={LIMIT_CHOICES.autoStartsPerDay}
            onChange={limit("autoStartsPerDay")}
          />
        </LimitRow>
        <LimitRow
          title="Stop a turn after"
          detail="The card waits for you with why"
        >
          <NumberPick
            label="Stop a turn after"
            value={crew.limits.turnMinutes}
            choices={LIMIT_CHOICES.turnMinutes}
            format={(value) => `${value} min`}
            onChange={limit("turnMinutes")}
          />
        </LimitRow>
        <LimitRow
          title="Pause at"
          detail="Of your Claude week, so your own chats keep working"
        >
          <NumberPick
            label="Pause at percent of your Claude week"
            value={crew.limits.pauseAtPercent}
            choices={LIMIT_CHOICES.pauseAtPercent}
            format={(value) => `${value}%`}
            onChange={limit("pauseAtPercent")}
          />
        </LimitRow>
        <div className="bot-sheet-row">
          <span>
            Quiet hours
            <small>
              {quiet.on
                ? `Nothing new starts ${quietText(quiet)}`
                : "The crew may start work at any hour"}
            </small>
          </span>
          <Toggle
            label="Quiet hours"
            tone="neutral"
            on={quiet.on}
            onChange={(on) => setCrewQuietHours(path, { ...quiet, on })}
          />
        </div>
        {quiet.on ? (
          <div className="bot-sheet-row crew-settings-hours">
            <label>
              From
              <select
                className="aven-field crew-settings-select"
                value={quiet.start - (quiet.start % 60)}
                onChange={(event) => {
                  const start = Number(event.target.value);
                  // The same start and end would never be quiet.
                  if (start !== quiet.end)
                    setCrewQuietHours(path, { ...quiet, start });
                }}
              >
                {HOURS.map((minutes) => (
                  <option
                    key={minutes}
                    value={minutes}
                    disabled={minutes === quiet.end}
                  >
                    {formatClockMinutes(minutes)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              to
              <select
                className="aven-field crew-settings-select"
                value={quiet.end - (quiet.end % 60)}
                onChange={(event) => {
                  const end = Number(event.target.value);
                  if (end !== quiet.start)
                    setCrewQuietHours(path, { ...quiet, end });
                }}
              >
                {HOURS.map((minutes) => (
                  <option
                    key={minutes}
                    value={minutes}
                    disabled={minutes === quiet.start}
                  >
                    {formatClockMinutes(minutes)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
      </Section>
      <p className="bot-sheet-note" data-crew-never>
        {ALWAYS_ASKS_LINE}
      </p>
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="bot-sheet-actions">
        {crew.on ? (
          <button
            type="button"
            className="team-card-button"
            data-variant="ghost"
            onClick={() => setCrewPaused(path, !crew.paused)}
          >
            {crew.paused ? "Resume crew" : "Pause crew"}
          </button>
        ) : null}
        <button
          type="button"
          className="team-card-button"
          data-variant="primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

type DraftRule = { id: string; words: string; to: string };

function storedRules(crew: Crew): DraftRule[] {
  return (crew.routes ?? []).map((route) => ({
    id: route.id,
    words: route.words.join(", "),
    to: route.to,
  }));
}

/**
 * Who builds what: your rules in order ("If a card mentions ui, css, give
 * it to Mole"), and the Builder for everything else. A rule is kept as you
 * leave its field.
 */
function RoutingSection({ crew }: { crew: Crew }) {
  const builders = crew.members.filter((member) => member.role === "builder");
  const [drafts, setDrafts] = useState<DraftRule[]>(() => storedRules(crew));
  const storedKey = JSON.stringify(crew.routes ?? []);
  const [seen, setSeen] = useState(storedKey);
  if (seen !== storedKey) {
    // Saved elsewhere (another window, or a Builder removed): show what is
    // stored, plus any rule still being written here.
    setSeen(storedKey);
    const stored = storedRules(crew);
    setDrafts([
      ...stored,
      ...drafts.filter(
        (draft) =>
          !draft.words.trim() && !stored.some((rule) => rule.id === draft.id),
      ),
    ]);
  }
  const save = (next: DraftRule[]) => {
    setDrafts(next);
    setCrewRoutes(crew.path, next);
  };
  if (builders.length < 2)
    return (
      <Section title="Who builds what">
        <p className="bot-sheet-small crew-settings-hint">
          With two or more Builders, rules send each card to one of them by what
          it mentions.
        </p>
      </Section>
    );
  const name = (id: string) => crewMemberName(crew, id);
  const fallback = defaultBuilder(crew);
  return (
    <Section title="Who builds what">
      {drafts.length ? (
        <ol className="crew-rules">
          {drafts.map((rule, index) => (
            <li key={rule.id} className="crew-rule" data-crew-rule={rule.id}>
              <span>If a card mentions</span>
              <input
                className="aven-field crew-rule-words"
                aria-label="Words the card mentions"
                placeholder="ui, css, design"
                value={rule.words}
                maxLength={300}
                onChange={(event) =>
                  setDrafts(
                    drafts.map((item) =>
                      item.id === rule.id
                        ? { ...item, words: event.target.value }
                        : item,
                    ),
                  )
                }
                onBlur={() => save(drafts)}
              />
              <span>give it to</span>
              <select
                className="aven-field crew-settings-select"
                aria-label="Builder"
                value={rule.to}
                onChange={(event) =>
                  save(
                    drafts.map((item) =>
                      item.id === rule.id
                        ? { ...item, to: event.target.value }
                        : item,
                    ),
                  )
                }
              >
                {builders.map((builder) => (
                  <option key={builder.id} value={builder.id}>
                    {name(builder.id)}
                  </option>
                ))}
              </select>
              <span className="crew-rule-tools">
                <button
                  type="button"
                  className="crew-icon-button"
                  aria-label="Check this rule earlier"
                  title="Check this rule earlier"
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...drafts];
                    [next[index - 1], next[index]] = [
                      next[index]!,
                      next[index - 1]!,
                    ];
                    save(next);
                  }}
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  className="crew-icon-button"
                  aria-label="Remove this rule"
                  title="Remove this rule"
                  onClick={() =>
                    save(drafts.filter((item) => item.id !== rule.id))
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="crew-rule crew-rule-fallback">
        <span>
          {drafts.length ? "Anything else goes to" : "Every card goes to"}
        </span>
        <select
          className="aven-field crew-settings-select"
          aria-label="Default Builder"
          value={fallback?.id ?? ""}
          onChange={(event) => setDefaultBuilder(crew.path, event.target.value)}
        >
          {builders.map((builder) => (
            <option key={builder.id} value={builder.id}>
              {name(builder.id)}
              {builder.paused ? " (off)" : ""}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="crew-settings-add"
        data-crew-add-rule
        disabled={drafts.length >= 12}
        onClick={() =>
          setDrafts([
            ...drafts,
            {
              id: `rule-${Date.now().toString(36)}`,
              words: "",
              to:
                builders.find((builder) => builder.id !== fallback?.id)?.id ??
                builders[0]!.id,
            },
          ])
        }
      >
        <Plus className="size-3.5" />
        Add rule
      </button>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// A member

/** Why an app can't be picked for this member, or null when it can. */
function agentProblem(id: HarnessId, role: CrewRole): string | null {
  if (!crewAgentAllowed(id))
    return role === "builder"
      ? "Can't be held to the crew's rules yet"
      : "Can't be locked to read-only";
  if (!crewAgentsFor(role).includes(id))
    return "Can't keep a Builder out of the copy's settings yet";
  if (id !== "claude" && !isHarnessAvailable(id)) return "Not installed";
  return null;
}

function useInstalledAgents(): readonly HarnessId[] {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  // Claude Code and Codex always; any other app only once it's installed.
  return HARNESSES.filter(
    (id) =>
      (CREW_AGENTS as readonly string[]).includes(id) || isHarnessAvailable(id),
  );
}

function MemberBody({
  crew,
  member,
  name,
  project,
  onBack,
  onClose,
}: {
  crew: Crew;
  member: CrewMember;
  name: string;
  project: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="bot-sheet-body" data-crew-member-page={member.id}>
      <BackButton onBack={onBack} label={`${project} crew`} />
      <MemberFields crew={crew} member={member} />
      <RemoveMember
        crew={crew}
        member={member}
        name={name}
        onRemoved={onBack}
      />
      <p className="bot-sheet-note">
        Whatever you set here, {name} keeps the{" "}
        {CREW_ROLE_INFO[member.role].label} role{"'s"} rules:{" "}
        {CREW_ROLE_INFO[member.role].edits
          ? "it changes files only in the crew's copy"
          : "it only reads"}
        , never pushes or publishes, and runs in its sandbox.
      </p>
      <div className="bot-sheet-actions">
        <button
          type="button"
          className="team-card-button"
          data-variant="primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function MemberFields({ crew, member }: { crew: Crew; member: CrewMember }) {
  const path = crew.path;
  const agents = useInstalledAgents();
  const { harness, model } = memberApp(member);
  const [problem, setProblem] = useState<string | null>(null);
  const [instructions, setInstructions] = useState(member.instructions ?? "");
  const [scope, setScope] = useState((member.scope ?? []).join("\n"));
  const effort = crewEffortSetting(harness, model);
  const set = (change: CrewMemberChange) =>
    setProblem(updateCrewMember(path, member.id, change));
  const critter = memberCritter(member);
  return (
    <>
      <Section title="Critter">
        <div
          className="crew-critter-grid"
          role="radiogroup"
          aria-label="Critter"
        >
          {PROJECT_MASCOTS.map((item) => (
            <button
              key={item.name}
              type="button"
              role="radio"
              aria-checked={item.name === critter}
              aria-label={item.label}
              title={item.label}
              className="crew-critter-cell"
              data-critter-choice={item.name}
              onClick={() =>
                set({
                  critter:
                    item.name === CREW_ROLE_INFO[member.role].critter
                      ? null
                      : item.name,
                })
              }
            >
              <ProjectMascot
                project={`crew:${member.role}`}
                name={item.name}
                color={CREW_ROLE_INFO[member.role].color}
                className="crew-critter-cell-art"
              />
            </button>
          ))}
        </div>
      </Section>
      {member.label ? (
        <Section title="Title and job">
          <div className="crew-settings-pair">
            <input
              className="aven-field crew-settings-input"
              aria-label="Title"
              defaultValue={member.label}
              maxLength={40}
              onBlur={(event) => {
                if (event.target.value.trim())
                  set({ label: event.target.value });
              }}
            />
            <input
              className="aven-field crew-settings-input"
              aria-label="Job"
              placeholder={CREW_ROLE_INFO[member.role].job}
              defaultValue={member.job ?? ""}
              maxLength={120}
              onBlur={(event) => set({ job: event.target.value })}
            />
          </div>
        </Section>
      ) : null}
      <Section title="Agent">
        <div className="crew-agent-list" role="radiogroup" aria-label="Agent">
          {agents.map((id) => {
            const why = agentProblem(id, member.role);
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === harness}
                aria-disabled={!!why || undefined}
                className="crew-agent"
                data-agent={id}
                title={why ?? undefined}
                onClick={() => {
                  if (why || id === harness) return;
                  set({ harness: id });
                }}
              >
                <span>{HARNESS_TITLE[id]}</span>
                {why ? <small>{why}</small> : null}
              </button>
            );
          })}
        </div>
        {member.fallback ? (
          <p className="bot-sheet-small">
            Checking with Claude for now: Codex couldn't be locked down here.
          </p>
        ) : null}
        <div className="bot-sheet-row crew-settings-limit">
          <span>
            Model
            <small>Its usual model; a card can pick another</small>
          </span>
          <ModelPicker
            harness={harness}
            model={model}
            onChange={(nextHarness, nextModel) => {
              if (nextHarness === harness) return set({ model: nextModel });
              const why = agentProblem(nextHarness, member.role);
              if (why)
                return setProblem(`${HARNESS_TITLE[nextHarness]}: ${why}.`);
              setProblem(
                updateCrewMember(path, member.id, { harness: nextHarness }) ??
                  updateCrewMember(path, member.id, { model: nextModel }),
              );
            }}
          />
        </div>
        {effort ? (
          <div className="bot-sheet-row crew-settings-limit">
            <span>
              Effort
              <small>How hard it thinks</small>
            </span>
            <select
              className="aven-field crew-settings-select"
              aria-label="Effort"
              value={
                effort.options.some((option) => option.value === member.effort)
                  ? member.effort
                  : ""
              }
              onChange={(event) => set({ effort: event.target.value || null })}
            >
              <option value="">Model's default</option>
              {effort.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </Section>
      <Section title="Instructions">
        <textarea
          className="aven-field crew-settings-text"
          aria-label="Instructions"
          rows={3}
          maxLength={CREW_INSTRUCTIONS_MAX}
          placeholder={
            member.role === "checker"
              ? "Always run the end-to-end tests. Be strict about accessibility."
              : member.role === "scout"
                ? "Look for small fixes in the docs and the settings screens."
                : "Prefer small components. Match the existing styles."
          }
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() => set({ instructions })}
        />
        <p className="bot-sheet-small">
          Your words for this member, read at every turn. They add to the crew's
          rules and never replace them.
        </p>
      </Section>
      {member.role === "builder" ? (
        <Section title="Works only in">
          <textarea
            className="aven-field crew-settings-text"
            aria-label="Works only in"
            rows={2}
            placeholder={"src/ui\nsrc/styles/*.css"}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            onBlur={() => set({ scope })}
          />
          <p className="bot-sheet-small">
            One path or pattern a line; empty for the whole project. A change
            outside these goes back as a must-fix.
          </p>
        </Section>
      ) : null}
      <WhenItWorks crew={crew} member={member} onProblem={setProblem} />
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}

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
  if (member.role === "scout")
    return (
      <Section title="When it works">
        <div className="bot-sheet-row crew-settings-limit">
          <span>
            Looks for ideas
            <small>Only while the crew has nothing else to do</small>
          </span>
          <select
            className="aven-field crew-settings-select"
            aria-label="Looks for ideas"
            value={member.schedule ?? "daily"}
            onChange={(event) =>
              onProblem(
                updateCrewMember(path, member.id, {
                  schedule: event.target.value as CrewScoutSchedule,
                }),
              )
            }
          >
            <option value="daily">Once a day</option>
            <option value="weekly">Once a week</option>
            <option value="off">Never</option>
          </select>
        </div>
        <div className="bot-sheet-row crew-settings-limit">
          <span>
            Ideas a day
            <small>At most, added to Ideas</small>
          </span>
          <NumberPick
            label="Ideas a day"
            value={crew.limits.ideasPerDay}
            choices={LIMIT_CHOICES.ideasPerDay}
            onChange={(value) => setCrewLimit(path, "ideasPerDay", value)}
          />
        </div>
        <div className="bot-sheet-row crew-settings-limit">
          <span>
            Start by themselves
            <small>Small ones, a day. 0 for none: you give each one</small>
          </span>
          <NumberPick
            label="Ideas that start by themselves a day"
            value={crew.limits.autoStartsPerDay}
            choices={LIMIT_CHOICES.autoStartsPerDay}
            onChange={(value) => setCrewLimit(path, "autoStartsPerDay", value)}
          />
        </div>
      </Section>
    );
  if (member.role === "security")
    return (
      <Section title="When it works">
        <p className="bot-sheet-small crew-settings-hint">
          Reviews each build once the Checker passes it: the same change, before
          you see it. A must-fix sends the card back to its Builder and counts
          as a round.
        </p>
        <div className="bot-sheet-row crew-settings-limit">
          <span>
            Security sweep
            <small>
              Reads the whole project and adds security cards to Ideas. They
              wait for you
            </small>
          </span>
          <select
            className="aven-field crew-settings-select"
            aria-label="Security sweep"
            value={member.sweep ?? "off"}
            onChange={(event) =>
              onProblem(
                updateCrewMember(path, member.id, {
                  sweep: event.target.value === "weekly" ? "weekly" : "off",
                }),
              )
            }
          >
            <option value="off">Off</option>
            <option value="weekly">Once a week</option>
          </select>
        </div>
      </Section>
    );
  if (member.role === "checker")
    return (
      <Section title="When it works">
        <p className="bot-sheet-small crew-settings-hint">
          Checks each build of the cards it's given, and of cards no one chose a
          Checker for.
        </p>
      </Section>
    );
  const builders = crew.members.filter((entry) => entry.role === "builder");
  const isDefault = defaultBuilder(crew)?.id === member.id;
  const words = (crew.routes ?? [])
    .filter((route) => route.to === member.id)
    .flatMap((route) => route.words);
  return (
    <Section title="When it works">
      <p className="bot-sheet-small crew-settings-hint">
        Builds the cards you give it
        {words.length
          ? `, and cards that mention ${words.slice(0, 6).join(", ")}`
          : ""}
        .
      </p>
      {builders.length > 1 ? (
        <div className="bot-sheet-row">
          <span>
            Takes cards no rule picks
            <small>One Builder is the default</small>
          </span>
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
      ) : null}
    </Section>
  );
}

function RemoveMember({
  crew,
  member,
  name,
  onRemoved,
}: {
  crew: Crew;
  member: CrewMember;
  name: string;
  onRemoved: () => void;
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
          Its cards go by the crew's rules. Its chat stays in your history and
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
              const why = removeCrewMember(crew.path, member.id);
              if (why) setProblem(why);
              else onRemoved();
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  return (
    <div className="crew-settings-remove">
      <button
        type="button"
        className="team-card-button"
        data-variant="ghost"
        disabled={last}
        onClick={() => setConfirming(true)}
      >
        Remove from crew
      </button>
      {last ? (
        <small className="bot-sheet-small">
          A crew needs a {CREW_ROLE_INFO[member.role].label}.
        </small>
      ) : null}
    </div>
  );
}

/** The Fixer is the project's bot: its switches here, the rest in its own settings. */
function FixerBody({
  path,
  project,
  onFixerSettings,
  onBack,
  onClose,
}: {
  path: string;
  project: string;
  onFixerSettings?: (path: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const bot = useProjectBot(path);
  return (
    <div className="bot-sheet-body" data-crew-member-page="fixer">
      <BackButton onBack={onBack} label={`${project} crew`} />
      <Section title="Agent">
        <p className="bot-sheet-small crew-settings-hint">
          Claude Code. The Fixer is this project's bot, which runs on Claude.
        </p>
      </Section>
      {bot ? (
        <Section title="When it works">
          {BOT_WAKE_KINDS.map((info) => (
            <div key={info.kind} className="bot-sheet-row">
              <span>{info.label}</span>
              <Toggle
                label={info.label}
                tone="neutral"
                on={bot.wakes[info.kind]}
                onChange={(on) =>
                  saveBotSettings(path, {
                    wakes: { ...bot.wakes, [info.kind]: on },
                  })
                }
              />
            </div>
          ))}
          <div className="bot-sheet-row">
            <span>
              Start fixes on its own
              <small>
                {bot.can.fix
                  ? "In its own copy. Your files change only when you apply a fix."
                  : "It only tells you what it found."}
              </small>
            </span>
            <Toggle
              label="Start fixes on its own"
              tone="neutral"
              on={bot.can.fix}
              onChange={(fix) => saveBotSettings(path, { can: { fix } })}
            />
          </div>
        </Section>
      ) : null}
      <div className="bot-sheet-actions">
        {onFixerSettings ? (
          <button
            type="button"
            className="team-card-button"
            data-variant="ghost"
            onClick={() => onFixerSettings(path)}
          >
            More Fixer settings…
          </button>
        ) : null}
        <button
          type="button"
          className="team-card-button"
          data-variant="primary"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding a member

const TEMPLATES: readonly {
  template: CrewTemplate | "fixer";
  role: CrewRole;
  title: string;
  job: string;
}[] = [
  {
    template: "builder",
    role: "builder",
    title: "Builder",
    job: "Builds the cards it's given. Add more to split the work",
  },
  {
    template: "checker",
    role: "checker",
    title: "Checker",
    job: "Checks each build before you see it",
  },
  {
    template: "scout",
    role: "scout",
    title: "Scout",
    job: CREW_ROLE_INFO.scout.job,
  },
  {
    template: "fixer",
    role: "fixer",
    title: "Fixer",
    job: "This project's bot: checks chats and the dev server",
  },
  {
    template: "custom",
    role: "builder",
    title: "Your own",
    job: "A title, a job line and your instructions",
  },
];

/**
 * Ready-made members: one click adds one, on its role's usual app and
 * model; its name, instructions and paths stay editable. One already in
 * the crew is greyed.
 */
function Gallery({
  crew,
  onAdded,
  onProblem,
}: {
  crew: Crew;
  onAdded: (id: string) => void;
  onProblem: (problem: string | null) => void;
}) {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const models = crewModelsHere();
  return (
    <>
      <h3 className="crew-settings-heading">Ready-made</h3>
      <div role="list" className="crew-gallery" data-crew-gallery>
        {CREW_PRESETS.map((preset) => {
          const inCrew = presetInCrew(crew, preset);
          const app = crewModelFor(models, preset.role);
          const name =
            preset.critter[0]!.toUpperCase() + preset.critter.slice(1);
          return (
            <button
              key={preset.key}
              type="button"
              role="listitem"
              className="crew-gallery-item"
              data-crew-preset={preset.key}
              aria-disabled={inCrew || undefined}
              title={inCrew ? `${name} is in the crew` : `Add ${name}`}
              onClick={() => {
                if (inCrew) return;
                const added = addCrewPreset(crew.path, preset.key, app);
                if ("error" in added) onProblem(added.error);
                else onAdded(added.id);
              }}
            >
              <CrewCritter
                path={crew.path}
                role={preset.role}
                critter={preset.critter}
              />
              <span className="crew-gallery-text">
                <strong>
                  {name}{" "}
                  <small className="crew-settings-role">
                    {preset.label ?? CREW_ROLE_INFO[preset.role].label}
                  </small>
                </strong>
                <small>{inCrew ? "In the crew" : preset.job}</small>
                <small className="crew-gallery-app">
                  {HARNESS_TITLE[app.harness]} · {modelName(app.model)}
                  {preset.scope?.length ? " · its own paths" : ""}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function AddBody({
  crew,
  custom,
  hasFixer,
  onAddFixer,
  onCustom,
  onAdded,
  onBack,
}: {
  crew: Crew;
  custom: boolean;
  hasFixer: boolean;
  onAddFixer?: (path: string) => void;
  onCustom: (custom: boolean) => void;
  onAdded: (id: string) => void;
  onBack: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const hasScout = crew.members.some((member) => member.role === "scout");
  const blockedBy = (template: CrewTemplate | "fixer"): string | null => {
    if (template === "scout" && hasScout) return "This crew has its Scout";
    if (template === "fixer")
      return hasFixer
        ? "This crew has its Fixer"
        : onAddFixer
          ? null
          : "Add a bot to the project first";
    return null;
  };
  return (
    <div className="bot-sheet-body" data-crew-add>
      <BackButton
        onBack={custom ? () => onCustom(false) : onBack}
        label="Back"
      />
      {custom ? (
        <CustomMember
          crew={crew}
          onAdded={onAdded}
          onCancel={() => onCustom(false)}
        />
      ) : (
        <>
          <Gallery crew={crew} onAdded={onAdded} onProblem={setProblem} />
          <h3 className="crew-settings-heading crew-blank-heading">
            Start from blank
          </h3>
          <div role="list" className="crew-templates">
            {TEMPLATES.map((item) => {
              const blocked = blockedBy(item.template);
              return (
                <button
                  key={item.template}
                  type="button"
                  role="listitem"
                  className="bot-sheet-row crew-settings-member"
                  data-crew-template={item.template}
                  aria-disabled={!!blocked || undefined}
                  onClick={() => {
                    if (blocked) return;
                    if (item.template === "fixer") {
                      onAddFixer?.(crew.path);
                      return;
                    }
                    if (item.template === "custom") {
                      onCustom(true);
                      return;
                    }
                    const added = addCrewMember(crew.path, item.template);
                    if ("error" in added) setProblem(added.error);
                    else onAdded(added.id);
                  }}
                >
                  {item.template === "custom" ? (
                    <span className="crew-template-plus" aria-hidden="true">
                      <Plus className="size-4" />
                    </span>
                  ) : (
                    <CrewCritter path={crew.path} role={item.role} />
                  )}
                  <span>
                    <strong>{item.title}</strong>
                    <small>{blocked ?? item.job}</small>
                  </span>
                  <ChevronRight className="crew-settings-chevron size-3.5" />
                </button>
              );
            })}
          </div>
        </>
      )}
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function CustomMember({
  crew,
  onAdded,
  onCancel,
}: {
  crew: Crew;
  onAdded: (id: string) => void;
  onCancel: () => void;
}) {
  const agents = useInstalledAgents();
  const [label, setLabel] = useState("");
  const [job, setJob] = useState("");
  const [role, setRole] = useState<"builder" | "checker">("builder");
  const [harness, setHarness] = useState<HarnessId>("claude");
  const [instructions, setInstructions] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const added = addCrewMember(crew.path, "custom", {
      role,
      label,
      job,
      harness,
      instructions,
    });
    if ("error" in added) setProblem(added.error);
    else onAdded(added.id);
  };
  return (
    <form
      className="crew-custom"
      data-crew-custom
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <label className="crew-settings-field">
        <span>Title</span>
        <input
          className="aven-field crew-settings-input"
          placeholder="Designer"
          maxLength={40}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="crew-settings-field">
        <span>Job</span>
        <input
          className="aven-field crew-settings-input"
          placeholder="Makes it look right"
          maxLength={120}
          value={job}
          onChange={(event) => setJob(event.target.value)}
        />
      </label>
      <label className="crew-settings-field">
        <span>Works as</span>
        <select
          className="aven-field crew-settings-select"
          value={role}
          onChange={(event) =>
            setRole(event.target.value as "builder" | "checker")
          }
        >
          <option value="builder">A Builder: changes files in the copy</option>
          <option value="checker">A Checker: only reads and checks</option>
        </select>
      </label>
      <label className="crew-settings-field">
        <span>Agent</span>
        <select
          className="aven-field crew-settings-select"
          value={harness}
          onChange={(event) => setHarness(event.target.value as HarnessId)}
        >
          {agents.map((id) => {
            const why = agentProblem(id, role);
            return (
              <option key={id} value={id} disabled={!!why}>
                {HARNESS_TITLE[id]}
                {why ? ` (${why.toLowerCase()})` : ""}
              </option>
            );
          })}
        </select>
      </label>
      <label className="crew-settings-field">
        <span>Instructions</span>
        <textarea
          className="aven-field crew-settings-text"
          rows={3}
          maxLength={CREW_INSTRUCTIONS_MAX}
          placeholder="Keep to the design tokens. Check contrast in both themes."
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="bot-sheet-actions">
        <button type="button" className="team-card-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="team-card-button"
          data-variant="primary"
          disabled={!label.trim()}
        >
          Add
        </button>
      </div>
    </form>
  );
}
