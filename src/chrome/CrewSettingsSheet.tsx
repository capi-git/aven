import { useEffect, useId, useState, type ReactNode } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Segmented, Select, Toggle } from "../surfaces/SettingsControls";
import {
  crewEffortSetting,
  HELPER_MODEL_DEFAULT,
  helperRunsOn,
} from "../lib/crewModels";
import { findModel, pickerModelsFor } from "../lib/models";
import {
  firstCardChatText,
  setAvosReadAccess,
  setCrewAccess,
  setCrewAskBeforeBuilding,
  setCrewLimit,
  setCrewQuietHours,
  setMemberMemory,
  tellCrew,
  setCrewHelperModel,
  setCrewRoutes,
  setDefaultBuilder,
  teammateChatReady,
  turnOffCrew,
  updateCrewMember,
  useCrewWorkspace,
} from "../lib/crewActions";
import { quietText } from "../lib/crewLimits";
import { memoryFacts, withoutMemoryFact } from "../lib/avosProfile";
import { plural } from "../lib/words";
import {
  crewMemberById,
  crewMemberName,
  crewMembers,
  defaultBuilder,
  CREW_ACCESS_LEVELS,
  CREW_INSTRUCTIONS_MAX,
  CREW_MEMORY_MAX,
  CREW_NOTE_MAX,
  updateCrew,
  withoutNote,
  CREW_HELPERS,
  avosMayRead,
  crewAccess,
  crewAccessLevel,
  type CrewAccessLevel,
  memberCritter,
  memberLabel,
  setCrewsAllRunsPerDay,
  useCrew,
  useCrewsAllRunsPerDay,
  CREW_ALL_RUNS_RANGE,
  type Crew,
  type CrewLimitName,
  type CrewMember,
} from "../lib/crews";
import { probeHarnessAvailability } from "../lib/harness/availability";
import { projectName } from "../lib/paths";
import { saveBotSettings } from "../lib/projectBotActions";
import {
  TEAM_ACCESS_ROLE_LINES,
  TEAM_ACCESS_SCOPE_LINE,
  TEAM_ALWAYS_LINE,
} from "../lib/projectBotPermissions";
import {
  BOT_WAKE_KINDS,
  formatClockMinutes,
  useProjectBot,
  type BotQuietHours,
} from "../lib/projectBots";
import { BotCritter } from "./BotCritter";
import { CrewCritter, CrewCritters } from "./CrewCritter";
import {
  LIMIT_CHOICES,
  LimitRow,
  MemberTitle,
  NumberPick,
  memberAppLine,
} from "./crewSettingsParts";
import { Check, ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "./icons";
import { Modal } from "./Modal";
import { ProjectMark } from "./ProjectMark";
import { TeamBuilder } from "./TeamBuilder";
import { MemberMark, TeammateBody, teammateSubtitle } from "./TeammatePage";
import "./TeamCard.css";
import "./BotSettingsSheet.css";
import "./CrewCritter.css";

/** Whole hours a quiet time can start or end at, as the pickers list them. */
const HOURS = Array.from({ length: 24 }, (_, hour) => hour * 60);

const ALL_RUNS_CHOICES = [20, 30, 40, 60, 80, 100, 150, 200, 300, 500].filter(
  (value) => value >= CREW_ALL_RUNS_RANGE[0] && value <= CREW_ALL_RUNS_RANGE[1],
);

type Page =
  | { kind: "crew" }
  /** A teammate's page, and the page it was opened from (its way back). */
  | { kind: "member"; id: string; from: "crew" | "add" | "helpers" }
  | { kind: "add" }
  /** One of Avos's rows' own pages. */
  | { kind: "instructions" }
  | { kind: "memory" }
  | { kind: "helpers" }
  | { kind: "access" }
  | { kind: "limits" };

/** The pages `initialPage` may name besides a helper's id. */
const NAMED_PAGES = [
  "add",
  "instructions",
  "memory",
  "helpers",
  "access",
  "limits",
] as const;

/** The way back's page, by where a page was opened from. */
const BACK_LABEL = { crew: "", add: "Add a helper", helpers: "Helpers" };

/**
 * Avos's settings: four rows, each opening its own page: Avos's model (its
 * own page), its helpers (who builds what and its quick helpers with
 * them), Access, and Limits with quiet hours. The switch turns Avos on and
 * off; Pause is in Avos's ⋯. Add a helper adds helpers or starts from a
 * suggested set; a helper's own page sets its name and
 * mark, its job, your instructions, where it works, what it runs on and
 * when it works. None of these change what a teammate may do: that comes
 * from its role (see `crewChatPermissions`).
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
  /** Open on a helper's page (its id), or on Add a helper ("add"). */
  initialPage?: string;
  /** Turn the team on (it is off). Resolves with why it couldn't, or null. */
  onTurnOn: (path: string) => Promise<string | null>;
  /** Add the project's bot as the team's Fixer. */
  onAddFixer?: (path: string) => void;
  /** Open the Fixer's own settings (the project bot's). */
  onFixerSettings?: (path: string) => void;
  onClose: () => void;
}) {
  const crew = useCrew(path);
  const appearance = useProjectAppearance(path);
  const workspace = useCrewWorkspace();
  const project = appearance?.label || projectName(path);
  const nameId = useId();
  const [page, setPage] = useState<Page>(() =>
    (NAMED_PAGES as readonly string[]).includes(initialPage ?? "")
      ? { kind: initialPage as (typeof NAMED_PAGES)[number] }
      : initialPage
        ? { kind: "member", id: initialPage, from: "helpers" }
        : { kind: "crew" },
  );
  // Why its chat didn't open, said on the teammate's page.
  const [chatProblem, setChatProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingOff, setConfirmingOff] = useState(false);
  const allRuns = useCrewsAllRunsPerDay();
  useEffect(() => {
    // The agent lists say which apps are installed.
    void probeHarnessAvailability();
  }, []);
  const member =
    crew && page.kind === "member" ? crewMemberById(crew, page.id) : undefined;
  const gone = !!crew && page.kind === "member" && !member;
  const from = page.kind === "member" ? page.from : "crew";
  useEffect(() => {
    // Removed (here or in another window): back where it was opened from.
    if (gone) setPage({ kind: from });
  }, [gone, from]);
  if (!crew || gone) return null;
  const toPage = (next: Page) => {
    setChatProblem(null);
    setPage(next);
  };
  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const error = await onTurnOn(path);
    setBusy(false);
    if (error) setProblem(error);
  };
  // The way back, above a page's title: to Avos's four rows, or to the page
  // a helper was opened from.
  const backTo = (to: "crew" | "add" | "helpers") => (
    <button
      type="button"
      className="crew-settings-back"
      onClick={() => toPage({ kind: to })}
    >
      <ChevronLeft className="size-3.5" />
      {to === "crew" ? `${project}'s Avos` : BACK_LABEL[to]}
    </button>
  );
  const back = backTo("crew");
  // One sheet whose header and body follow the page, so moving between
  // pages never closes and opens it again.
  let header: {
    title: ReactNode;
    description?: string;
    leading?: ReactNode;
    trailing?: ReactNode;
    above?: ReactNode;
    size?: "md" | "lg";
    className?: string;
  };
  let body: ReactNode;
  if (member?.role === "fixer") {
    header = {
      title: crewMemberName(crew, member.id, fixerName),
      description: `Fixer for ${project}'s Avos`,
      leading: (
        <span className="bot-sheet-critter">
          <BotCritter path={path} className="bot-sheet-critter-sprite" />
        </span>
      ),
      above: back,
    };
    body = (
      <FixerBody
        path={path}
        onFixerSettings={onFixerSettings}
        onClose={onClose}
      />
    );
  } else if (member) {
    const name = crewMemberName(crew, member.id);
    const chatReady = teammateChatReady(crew, member.id);
    // What it is called without a name of its own, numbered among the rest.
    const defaultName = crewMemberName(
      {
        members: crew.members.map((entry) =>
          entry.id === member.id ? { ...entry, name: undefined } : entry,
        ),
      },
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
      description: teammateSubtitle(member, project),
      leading: <MemberMark path={path} member={member} />,
      above: backTo(from),
      trailing: (
        <span className="teammate-head-actions">
          <button
            type="button"
            className="team-card-button"
            data-crew-open-chat
            disabled={!crew.on || !workspace || !chatReady}
            title={
              !crew.on
                ? "Wake Avos to open its chat"
                : !chatReady
                  ? firstCardChatText(name)
                  : undefined
            }
            onClick={() => {
              setChatProblem(null);
              void Promise.resolve(workspace?.openChat(path, member.id)).then(
                // The sheet closes once the chat is on screen, not before.
                (why) => (why ? setChatProblem(why) : onClose()),
              );
            }}
          >
            Open chat
          </button>
          <span className="teammate-on">
            On
            <Toggle
              label={`${name} on`}
              tone="neutral"
              on={!member.paused}
              onChange={(on) =>
                updateCrewMember(path, member.id, { paused: !on })
              }
            />
          </span>
        </span>
      ),
      size: "lg",
      className: "teammate-sheet",
    };
    body = (
      <TeammateBody
        key={member.id}
        crew={crew}
        member={member}
        name={name}
        notice={crew.on && !chatReady ? firstCardChatText(name) : null}
        alert={chatProblem}
      />
    );
  } else if (page.kind === "add") {
    header = {
      title: "Add a helper",
      description:
        "Avos brings in helpers when work needs them. You can add one yourself, and change anyone later.",
      leading: <ProjectMark path={path} className="team-build-head-mark" />,
      above: backTo("helpers"),
      size: "lg",
      className: "team-build-sheet",
    };
    body = (
      <TeamBuilder
        crew={crew}
        project={project}
        {...(fixerName ? { fixerName } : {})}
        {...(onAddFixer ? { onAddFixer } : {})}
        onOpenMember={(id) => toPage({ kind: "member", id, from: "add" })}
        onClose={onClose}
      />
    );
  } else if (page.kind === "instructions") {
    header = {
      title: "Instructions",
      description: "What Avos reads at every turn, in your words.",
      above: back,
    };
    body = <InstructionsBody crew={crew} />;
  } else if (page.kind === "memory") {
    header = {
      title: "Memory",
      description: "What Avos has learned about this project.",
      above: back,
    };
    body = (
      <MemoryBody
        crew={crew}
        onOpenMember={(id) => toPage({ kind: "member", id, from: "crew" })}
      />
    );
  } else if (page.kind === "helpers") {
    header = {
      title: "Helpers",
      description: "Avos hands them work and tells you when it's ready.",
      above: back,
    };
    body = (
      <HelpersBody
        crew={crew}
        fixerName={fixerName}
        onOpenMember={(id) => toPage({ kind: "member", id, from: "helpers" })}
        onAdd={() => toPage({ kind: "add" })}
      />
    );
  } else if (page.kind === "access") {
    header = {
      title: "Access",
      description: "What Avos's helpers may do without asking you.",
      above: back,
    };
    body = (
      <div className="bot-sheet-body" data-crew-settings-page="access">
        <AccessSection crew={crew} />
      </div>
    );
  } else if (page.kind === "limits") {
    header = {
      title: "Limits",
      description: "How much Avos does, and when.",
      above: back,
    };
    body = (
      <div className="bot-sheet-body" data-crew-settings-page="limits">
        <LimitsSection crew={crew} allRuns={allRuns} />
      </div>
    );
  } else {
    header = {
      title: `${project}'s Avos`,
      description: crew.on
        ? "On while Aven is open and your Mac is awake"
        : "Off. Nothing new starts until you turn it on",
      leading: (
        <span className="bot-sheet-critter">
          <CrewCritter
            path={path}
            role="lead"
            className="crew-settings-head-mark"
          />
        </span>
      ),
      trailing: (
        <span title="Works only while Aven is open and your Mac is awake">
          <Toggle
            label="Avos on"
            tone="neutral"
            on={crew.on}
            disabled={busy}
            onChange={(on) => {
              if (on) void turnOn();
              else setConfirmingOff(true);
            }}
          />
        </span>
      ),
    };
    body = confirmingOff ? (
      <div className="bot-sheet-body">
        <p className="bot-sheet-question">Turn Avos off?</p>
        <p className="bot-sheet-note">
          What it is doing stops and nothing new starts. Its work and its copy
          stay, so what's ready is still there when you turn it on.
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
        fixerName={fixerName}
        allRuns={allRuns}
        problem={problem}
        onOpenMember={(id) => toPage({ kind: "member", id, from: "crew" })}
        onPage={(kind) => toPage({ kind })}
      />
    );
  }
  return (
    <Modal
      onClose={onClose}
      title={header.title}
      {...(header.description ? { description: header.description } : {})}
      size={header.size ?? "md"}
      className={`bot-sheet crew-settings ${header.className ?? ""}`}
      leading={header.leading}
      trailing={header.trailing}
      above={header.above}
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

/**
 * A teammate's one detail in the team's list: what it runs on ("Claude ·
 * Opus 5.5"), and a word when it isn't as usual ("off").
 */
function memberDetail(member: CrewMember): string {
  if (member.role === "fixer") return "Fixes what breaks";
  return [memberAppLine(member), member.paused ? "off" : ""]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// The crew

/** Access in a word, as its row says it. */
const ACCESS_WORD: Readonly<Record<CrewAccessLevel, string>> = {
  ask: "Ask first",
  auto: "Auto",
  full: "Full access",
};

/** The helpers Avos's settings list: everyone but Avos (and a Fixer the project lacks). */
function settingsHelpers(crew: Crew, fixerName: string | undefined) {
  return crewMembers(crew).filter(
    (entry) => entry.role !== "lead" && (entry.role !== "fixer" || !!fixerName),
  );
}

/** One of Avos's four rows: its name, one line, and the way to its page. */
function SummaryRow({
  id,
  title,
  detail,
  extra,
  onOpen,
}: {
  id: string;
  title: string;
  detail: string;
  extra?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="bot-sheet-row crew-settings-member crew-settings-summary"
      data-crew-summary={id}
      onClick={onOpen}
    >
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {extra}
      <ChevronRight className="crew-settings-chevron size-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Avos's four rows

function CrewBody({
  crew,
  fixerName,
  allRuns,
  problem,
  onOpenMember,
  onPage,
}: {
  crew: Crew;
  fixerName?: string;
  allRuns: number;
  /** Why Avos couldn't turn on. */
  problem: string | null;
  onOpenMember: (id: string) => void;
  onPage: (
    kind: "instructions" | "memory" | "helpers" | "access" | "limits",
  ) => void;
}) {
  const path = crew.path;
  const lead = crewMembers(crew).find((member) => member.role === "lead");
  const helpers = settingsHelpers(crew, fixerName);
  const level = crewAccessLevel(crewAccess(crew));
  const quiet = crew.limits.quiet;
  return (
    <div className="bot-sheet-body" data-crew-settings={path}>
      <div className="crew-settings-card">
        {lead ? (
          <SummaryRow
            id="model"
            title="Model"
            detail={memberAppLine(lead)}
            onOpen={() => onOpenMember(lead.id)}
          />
        ) : null}
        {lead ? (
          <SummaryRow
            id="instructions"
            title="Instructions"
            detail={
              firstLine(lead.instructions) ??
              (crew.notes.length
                ? plural(crew.notes.length, "rule")
                : "Your standing words to Avos")
            }
            onOpen={() => onPage("instructions")}
          />
        ) : null}
        {lead ? (
          <SummaryRow
            id="memory"
            title="Memory"
            detail={
              memoryFacts(lead.memory).length
                ? plural(memoryFacts(lead.memory).length, "thing") +
                  " it learned"
                : "Nothing yet. It notes what it learns as it works"
            }
            onOpen={() => onPage("memory")}
          />
        ) : null}
        <SummaryRow
          id="helpers"
          title="Helpers"
          detail={
            helpers.length
              ? helpers
                  .map((member) => crewMemberName(crew, member.id, fixerName))
                  .join(", ")
              : "Avos brings them in when work needs them"
          }
          extra={
            helpers.length ? (
              <CrewCritters
                path={path}
                className="crew-settings-summary-marks"
                roles={helpers.map((entry) => ({
                  id: entry.id,
                  role: entry.role,
                  ...(entry.critter ? { critter: memberCritter(entry) } : {}),
                }))}
              />
            ) : null
          }
          onOpen={() => onPage("helpers")}
        />
        <SummaryRow
          id="access"
          title="Access"
          detail={
            avosMayRead(crew)
              ? `${ACCESS_WORD[level]} · nothing reaches your folder until you Apply`
              : "Can't read this project yet"
          }
          onOpen={() => onPage("access")}
        />
        <SummaryRow
          id="limits"
          title="Limits"
          detail={[
            `${crew.limits.runsPerDay} runs a day`,
            quiet.on ? `quiet ${quietText(quiet)}` : "",
            allRuns < crew.limits.runsPerDay ? `${allRuns} for every Avos` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          onOpen={() => onPage("limits")}
        />
      </div>
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** A text's first line worth showing, or undefined when it has none. */
function firstLine(text: string | undefined): string | undefined {
  const line = text
    ?.split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line || undefined;
}

// ---------------------------------------------------------------------------
// Instructions and memory, as a Mono's Soul and Memory

/**
 * What Avos reads at every turn: your standing words to it, and the rules
 * you gave for every job (each with Forget, and a field to add one).
 */
function InstructionsBody({ crew }: { crew: Crew }) {
  const lead = crewMembers(crew).find((member) => member.role === "lead");
  const [text, setText] = useState(lead?.instructions ?? "");
  const [rule, setRule] = useState("");
  const addRule = () => {
    const words = rule.trim();
    if (!words) return;
    tellCrew(crew.path, words);
    setRule("");
  };
  return (
    <div className="bot-sheet-body" data-crew-settings-page="instructions">
      {lead ? (
        <textarea
          className="aven-field crew-settings-instructions"
          aria-label="Instructions"
          rows={8}
          maxLength={CREW_INSTRUCTIONS_MAX}
          placeholder="Like “Keep changes small, and say what you changed in a line”"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() =>
            updateCrewMember(crew.path, lead.id, { instructions: text })
          }
        />
      ) : null}
      <Section title="For every job">
        <div className="crew-settings-card">
          {crew.notes.map((note) => (
            <div
              key={note.id}
              className="bot-sheet-row crew-settings-fact"
              data-avos-rule={note.id}
            >
              <span>{note.text}</span>
              <button
                type="button"
                className="crew-settings-remove-link"
                onClick={() =>
                  updateCrew(crew.path, (current) =>
                    withoutNote(current, note.id),
                  )
                }
              >
                Forget
              </button>
            </div>
          ))}
          <form
            className="bot-sheet-row crew-settings-fact"
            onSubmit={(event) => {
              event.preventDefault();
              addRule();
            }}
          >
            <input
              className="aven-field crew-settings-fact-input"
              aria-label="Add a rule for every job"
              placeholder="Add a rule for every job"
              maxLength={CREW_NOTE_MAX}
              value={rule}
              onChange={(event) => setRule(event.target.value)}
            />
            <button
              type="submit"
              className="crew-settings-remove-link"
              disabled={!rule.trim()}
            >
              Add
            </button>
          </form>
        </div>
      </Section>
    </div>
  );
}

/**
 * What Avos has learned, one fact a row with Forget, all of it editable as
 * text; then what each helper learned, which opens its page.
 */
function MemoryBody({
  crew,
  onOpenMember,
}: {
  crew: Crew;
  onOpenMember: (id: string) => void;
}) {
  const lead = crewMembers(crew).find((member) => member.role === "lead");
  const memory = lead?.memory ?? "";
  const facts = memoryFacts(memory);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory);
  const [problem, setProblem] = useState<string | null>(null);
  const helpers = crewMembers(crew).filter(
    (member) =>
      member.role !== "lead" && member.role !== "fixer" && member.memory,
  );
  return (
    <div className="bot-sheet-body" data-crew-settings-page="memory">
      {lead && editing ? (
        <textarea
          className="aven-field crew-settings-instructions"
          aria-label="Memory"
          rows={10}
          maxLength={CREW_MEMORY_MAX}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            setProblem(
              setMemberMemory(crew.path, lead.id, text.trim() || null),
            );
            setEditing(false);
          }}
          autoFocus
        />
      ) : facts.length && lead ? (
        <div className="crew-settings-card" data-avos-memory>
          {facts.map((fact) => (
            <div
              key={`${fact.line}:${fact.text}`}
              className="bot-sheet-row crew-settings-fact"
              data-avos-fact
            >
              <span>{fact.text}</span>
              <button
                type="button"
                className="crew-settings-remove-link"
                onClick={() =>
                  setProblem(
                    setMemberMemory(
                      crew.path,
                      lead.id,
                      withoutMemoryFact(memory, fact.line),
                    ),
                  )
                }
              >
                Forget
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="bot-sheet-note">
          Nothing yet. Avos notes what it learns about this project as it works,
          and reads it back at every turn.
        </p>
      )}
      {lead && !editing ? (
        <div className="crew-settings-memory-foot">
          <button
            type="button"
            className="crew-settings-disclosure"
            data-avos-memory-edit
            onClick={() => {
              setText(memory);
              setEditing(true);
            }}
          >
            Edit as text
          </button>
          {facts.length ? (
            <span className="bot-sheet-note">
              {plural(facts.length, "line")}
            </span>
          ) : null}
        </div>
      ) : null}
      {problem ? (
        <p className="bot-sheet-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {helpers.length ? (
        <Section title="What its helpers learned">
          <div className="crew-settings-card">
            {helpers.map((member) => (
              <SummaryRow
                key={member.id}
                id={`memory:${member.id}`}
                title={crewMemberName(crew, member.id)}
                detail={firstLine(member.memory) ?? ""}
                onOpen={() => onOpenMember(member.id)}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers

function HelpersBody({
  crew,
  fixerName,
  onOpenMember,
  onAdd,
}: {
  crew: Crew;
  fixerName?: string;
  onOpenMember: (id: string) => void;
  onAdd: () => void;
}) {
  const path = crew.path;
  const helpers = settingsHelpers(crew, fixerName);
  const builders = crew.members.filter((member) => member.role === "builder");
  const perDay = crew.limits.helpersPerDay;
  return (
    <div className="bot-sheet-body" data-crew-settings-page="helpers">
      <div className="crew-settings-card">
        {helpers.map((member) => (
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
                <MemberTitle
                  name={crewMemberName(crew, member.id, fixerName)}
                  title={memberLabel(member)}
                />
              </strong>
              <small>{memberDetail(member)}</small>
            </span>
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
          Add a helper
        </button>
      </div>
      {builders.length > 1 ? <RoutingSection crew={crew} /> : null}
      <HelperModelSection crew={crew} />
      <Section title="Quick helpers">
        <div className="crew-settings-card">
          <LimitRow
            title="Let Avos start quick helpers"
            detail="Helpers for one question, started by Avos"
          >
            <Toggle
              label="Let Avos start quick helpers"
              tone="neutral"
              on={perDay > 0}
              onChange={(on) =>
                setCrewLimit(path, "helpersPerDay", on ? CREW_HELPERS.day : 0)
              }
            />
          </LimitRow>
          {perDay > 0 ? (
            <LimitRow
              title="At most a day"
              detail="Across Avos and its helpers"
            >
              <NumberPick
                label="Quick helpers a day"
                value={perDay}
                choices={LIMIT_CHOICES.helpersPerDay.filter(
                  (value) => value > 0,
                )}
                onChange={(value) => setCrewLimit(path, "helpersPerDay", value)}
              />
            </LimitRow>
          ) : null}
        </div>
        <p className="bot-sheet-note">
          Avos starts them to look things up. They only read, and leave when
          done.
        </p>
      </Section>
    </div>
  );
}

/**
 * What the helpers Avos sets to work run on: one model and effort for new
 * helpers and the Builders you haven't set yourself, or Avos's pick.
 */
function HelperModelSection({ crew }: { crew: Crew }) {
  const path = crew.path;
  const runs = helperRunsOn(crew);
  const models = pickerModelsFor("claude");
  const value = runs ? runs.model : "avos";
  const known = runs ? findModel(runs.model) : undefined;
  const effort = known ? crewEffortSetting(known.harness, known.id) : undefined;
  const pickModel = (id: string) => {
    if (id === "avos") return setCrewHelperModel(path, "avos");
    const setting = crewEffortSetting("claude", id);
    // Keep the effort when the new model takes it, else its own default.
    const keep =
      runs?.effort &&
      setting?.options.some((option) => option.value === runs.effort)
        ? runs.effort
        : undefined;
    const next = { model: id, ...(keep ? { effort: keep } : {}) };
    setCrewHelperModel(
      path,
      next.model === HELPER_MODEL_DEFAULT.model &&
        next.effort === HELPER_MODEL_DEFAULT.effort
        ? null
        : next,
    );
  };
  return (
    <Section title="Model">
      <div className="crew-settings-card" data-crew-helper-model>
        <LimitRow
          title="Helpers run on"
          detail="New helpers, and Builders you haven't set yourself"
        >
          <Select
            label="Helpers run on"
            value={value}
            options={[
              ...models.map((model) => ({
                value: model.id,
                label: model.name.replace(/^Claude /, ""),
              })),
              {
                value: "avos",
                label: "Let Avos choose",
                description: "It picks a model and effort for each job",
              },
            ]}
            onChange={pickModel}
          />
        </LimitRow>
        {runs && effort ? (
          <LimitRow title="Effort" detail="How hard they think">
            <Select
              label="Effort"
              value={runs.effort ?? ""}
              options={[
                { value: "", label: "Default" },
                ...effort.options.map((option) => ({
                  value: option.value,
                  label: option.label,
                })),
              ]}
              onChange={(value) => {
                const next = {
                  model: runs.model,
                  ...(value ? { effort: value } : {}),
                };
                setCrewHelperModel(
                  path,
                  next.model === HELPER_MODEL_DEFAULT.model &&
                    value === HELPER_MODEL_DEFAULT.effort
                    ? null
                    : next,
                );
              }}
            />
          </LimitRow>
        ) : null}
      </div>
      <p className="bot-sheet-note">
        A Builder you set yourself keeps its own model.
      </p>
    </Section>
  );
}

/**
 * What teammates may do without stopping to ask you. Each works in the
 * team's own copy, in a sandbox, so this never reaches your files: only
 * Apply does.
 */
/** Access, in the message box's words: one choice for the whole team. */
const ACCESS_CHOICES: readonly {
  level: CrewAccessLevel;
  label: string;
  hint: string;
}[] = [
  {
    level: "ask",
    label: "Ask first",
    hint: "Stops and waits for you on anything risky.",
  },
  {
    level: "auto",
    label: "Auto",
    hint: "Keeps working. Risky requests get a no and it carries on.",
  },
  {
    level: "full",
    label: "Full access",
    hint: "Never asks. Commands, deleting and the web are all open.",
  },
];

function AccessSection({ crew }: { crew: Crew }) {
  const path = crew.path;
  const access = crewAccess(crew);
  const level = crewAccessLevel(access);
  const [customising, setCustomising] = useState(false);
  const mayRead = avosMayRead(crew);
  return (
    <section className="crew-settings-section" aria-label="Access">
      <div className="crew-settings-card" data-crew-read-access>
        <LimitRow
          title="Read this project"
          detail={
            mayRead
              ? "Avos and its helpers read your files to answer you and plan work"
              : "Off: Avos stays off and reads nothing"
          }
        >
          <Toggle
            label="Read this project"
            tone="neutral"
            on={mayRead}
            onChange={(on) => void setAvosReadAccess(path, on)}
          />
        </LimitRow>
        <LimitRow
          title="Ask before building"
          detail={
            crew.askBeforeBuilding
              ? "What Avos plans waits for you to say Build it"
              : "What Avos plans starts at once in its copy; you review it before it reaches your folder"
          }
        >
          <Toggle
            label="Ask before building"
            tone="neutral"
            on={!!crew.askBeforeBuilding}
            onChange={(on) => setCrewAskBeforeBuilding(path, on)}
          />
        </LimitRow>
      </div>
      <div data-crew-access role="radiogroup" aria-label="Access">
        {ACCESS_CHOICES.map((choice) => (
          <button
            key={choice.level}
            type="button"
            role="radio"
            aria-checked={level === choice.level}
            className="crew-access-choice"
            data-crew-access-level={choice.level}
            onClick={() => {
              if (level === choice.level) return;
              // Web you customised stays, unless Full access comes or goes.
              const next = CREW_ACCESS_LEVELS[choice.level];
              setCrewAccess(
                path,
                level === "full" || choice.level === "full"
                  ? next
                  : { ...next, web: access.web },
              );
            }}
          >
            <span>
              <b>{choice.label}</b>
              <small>{choice.hint}</small>
            </span>
            {level === choice.level ? <Check size={14} aria-hidden /> : null}
          </button>
        ))}
      </div>
      <p className="bot-sheet-note" data-crew-never>
        {TEAM_ALWAYS_LINE}
      </p>
      <Disclosure
        label="Customise web and deleting"
        open={customising}
        onToggle={() => setCustomising(!customising)}
      />
      {customising ? (
        <div data-crew-access-custom>
          <LimitRow
            title="Delete files in its copy"
            detail="Builders, in Avos's copy and temp folders, without asking"
          >
            <Toggle
              label="Delete files in its copy"
              tone="neutral"
              on={access.deletes}
              onChange={(deletes) => setCrewAccess(path, { deletes })}
            />
          </LimitRow>
          <LimitRow
            title="Use the web"
            detail={
              access.web === "everyone"
                ? "Everyone searches and reads pages, and uses Aven's browser. The Scout's ideas then wait for you, as the Researcher's always do"
                : access.web === "builders"
                  ? "Builders and the Researcher search and read pages. All but the Scout use Aven's browser, to try the work"
                  : "No helper searches, reads pages or uses Aven's browser"
            }
          >
            <Segmented
              label="Who uses the web"
              className="crew-settings-access-choice"
              value={access.web}
              options={[
                { value: "none", label: "No one" },
                { value: "builders", label: "Builders" },
                { value: "everyone", label: "Everyone" },
              ]}
              onChange={(web) => setCrewAccess(path, { web })}
            />
          </LimitRow>
          <p className="bot-sheet-note" data-crew-access-scope>
            {TEAM_ACCESS_SCOPE_LINE}
          </p>
          <ul className="bot-sheet-notes" data-crew-access-roles>
            {TEAM_ACCESS_ROLE_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** "Rules ›", "Edit limits ›", "More ›": what sits one level deeper. */
function Disclosure({
  label,
  open,
  onToggle,
  ...rest
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <button
      type="button"
      className="crew-settings-disclosure"
      aria-expanded={open}
      onClick={onToggle}
      {...rest}
    >
      {label}
      <ChevronRight className="crew-settings-disclosure-chevron size-3" />
    </button>
  );
}

/**
 * Avos's limits, on their own page: the common ones (each one's why is its
 * tooltip), quiet hours, and the rest under More.
 */
function LimitsSection({ crew, allRuns }: { crew: Crew; allRuns: number }) {
  const path = crew.path;
  const quiet = crew.limits.quiet;
  const [more, setMore] = useState(false);
  const limit = (name: CrewLimitName) => (value: number) =>
    setCrewLimit(path, name, value);
  return (
    <section className="crew-settings-section" aria-label="Limits">
      <div className="crew-settings-card" data-crew-limits-open>
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
          title="Quiet hours"
          detail={
            quiet.on
              ? `Nothing new starts ${quietText(quiet)}`
              : "Avos may start work at any hour"
          }
        >
          <Toggle
            label="Quiet hours"
            tone="neutral"
            on={quiet.on}
            onChange={(on) => setCrewQuietHours(path, { ...quiet, on })}
          />
        </LimitRow>
        {quiet.on ? <QuietHours path={path} quiet={quiet} /> : null}
        <LimitRow
          title="Pause near your usage limit"
          detail="At this much of your Claude week, so your own chats keep working"
        >
          <NumberPick
            label="Pause at percent of your Claude week"
            value={crew.limits.pauseAtPercent}
            choices={LIMIT_CHOICES.pauseAtPercent}
            format={(value) => `${value}%`}
            onChange={limit("pauseAtPercent")}
          />
        </LimitRow>
        <Disclosure
          label="More"
          open={more}
          onToggle={() => setMore(!more)}
          data-crew-limits-more
        />
        {more ? (
          <>
            <LimitRow title="Rounds a card" detail="Then it stops and asks you">
              <NumberPick
                label="Rounds a card"
                value={crew.limits.roundsPerCard}
                choices={LIMIT_CHOICES.roundsPerCard}
                onChange={limit("roundsPerCard")}
              />
            </LimitRow>
            <LimitRow
              title="Runs a day, every Avos"
              detail="A ceiling for every project's Avos together"
            >
              <NumberPick
                label="Runs a day, every Avos"
                value={allRuns}
                choices={ALL_RUNS_CHOICES}
                onChange={setCrewsAllRunsPerDay}
              />
            </LimitRow>
            <LimitRow
              title="Scout ideas that build by themselves"
              detail="A day, not large ones or from outside. 0 for none. Yours always build"
            >
              <NumberPick
                label="Scout ideas that build by themselves a day"
                value={crew.limits.autoStartsPerDay}
                choices={LIMIT_CHOICES.autoStartsPerDay}
                onChange={limit("autoStartsPerDay")}
              />
            </LimitRow>
            <LimitRow
              title="Cards waiting for you"
              detail="Passed cards on Avos's branch before it starts no new one"
            >
              <NumberPick
                label="Cards waiting for you"
                value={crew.limits.readyCap}
                choices={LIMIT_CHOICES.readyCap}
                onChange={limit("readyCap")}
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
          </>
        ) : null}
      </div>
    </section>
  );
}

/** From and to: whole hours, never the same one (that would never be quiet). */
function QuietHours({ path, quiet }: { path: string; quiet: BotQuietHours }) {
  return (
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
            if (end !== quiet.start) setCrewQuietHours(path, { ...quiet, end });
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
  const [open, setOpen] = useState(false);
  const save = (next: DraftRule[]) => {
    setDrafts(next);
    setCrewRoutes(crew.path, next);
  };
  const name = (id: string) => crewMemberName(crew, id);
  const fallback = defaultBuilder(crew);
  const rules = crew.routes?.length ?? 0;
  // One line; the rules one level deeper, once there are Builders to pick.
  const line = (
    <div className="crew-settings-line">
      <span data-crew-routing-summary>
        Cards go to {fallback ? name(fallback.id) : "the Builder"}
        {rules ? ` · ${rules} ${rules === 1 ? "rule" : "rules"}` : ""}
      </span>
      {builders.length > 1 ? (
        <Disclosure
          label="Rules"
          open={open}
          onToggle={() => setOpen(!open)}
          data-crew-rules
        />
      ) : null}
    </div>
  );
  if (builders.length < 2 || !open)
    return <Section title="Who builds what">{line}</Section>;
  return (
    <Section title="Who builds what">
      {line}
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

/** The Fixer is the project's bot: its switches here, the rest in its own settings. */
function FixerBody({
  path,
  onFixerSettings,
  onClose,
}: {
  path: string;
  onFixerSettings?: (path: string) => void;
  onClose: () => void;
}) {
  const bot = useProjectBot(path);
  return (
    <div className="bot-sheet-body" data-crew-member-page="fixer">
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
