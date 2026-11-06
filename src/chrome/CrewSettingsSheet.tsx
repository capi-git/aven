import { useEffect, useId, useState, type ReactNode } from "react";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { Segmented, Toggle } from "../surfaces/SettingsControls";
import {
  firstCardChatText,
  setCrewAccess,
  setCrewLimit,
  setCrewPaused,
  setCrewQuietHours,
  setCrewRoutes,
  setDefaultBuilder,
  teammateChatReady,
  turnOffCrew,
  updateCrewMember,
  useCrewWorkspace,
} from "../lib/crewActions";
import { quietText } from "../lib/crewLimits";
import {
  crewMemberById,
  crewMemberName,
  crewMembers,
  defaultBuilder,
  CREW_ACCESS_LEVELS,
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
  | { kind: "member"; id: string; from: "crew" | "add" }
  | { kind: "add" };

/**
 * Avos's settings: its helpers, who builds what, its limits and quiet
 * hours, Pause and Turn off. Add a helper adds helpers or starts from a
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
    initialPage === "add"
      ? { kind: "add" }
      : initialPage
        ? { kind: "member", id: initialPage, from: "crew" }
        : { kind: "crew" },
  );
  // Why its chat didn't open, said on the teammate's page.
  const [chatProblem, setChatProblem] = useState<string | null>(null);
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
  const from = page.kind === "member" ? page.from : "crew";
  useEffect(() => {
    // Removed (here or in another window): back where it was opened from.
    if (gone) setPage(from === "add" ? { kind: "add" } : { kind: "crew" });
  }, [gone, from]);
  if (!crew || gone) return null;
  const toPage = (next: Page) => {
    setChatProblem(null);
    setPage(next);
  };
  const toCrew = () => toPage({ kind: "crew" });
  const turnOn = async () => {
    setBusy(true);
    setProblem(null);
    const error = await onTurnOn(path);
    setBusy(false);
    if (error) setProblem(error);
  };
  const back = (
    <button type="button" className="crew-settings-back" onClick={toCrew}>
      <ChevronLeft className="size-3.5" />
      {project}'s Avos
    </button>
  );
  // A helper opened from Add a helper goes back there.
  const backToBuild = (
    <button
      type="button"
      className="crew-settings-back"
      onClick={() => toPage({ kind: "add" })}
    >
      <ChevronLeft className="size-3.5" />
      Add a helper
    </button>
  );
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
      above: from === "add" ? backToBuild : back,
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
      above: back,
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
  } else {
    const members = crewMembers(crew).filter(
      (entry) => entry.role !== "fixer" || !!fixerName,
    );
    header = {
      title: `${project}'s Avos`,
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
        <p className="bot-sheet-question">Turn the team off?</p>
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
        onOpenMember={(id) => toPage({ kind: "member", id, from: "crew" })}
        onAdd={() => toPage({ kind: "add" })}
        onClose={onClose}
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
  /** Why the team couldn't turn on. */
  problem: string | null;
  onOpenMember: (id: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const path = crew.path;
  const allRuns = useCrewsAllRunsPerDay();
  return (
    <div className="bot-sheet-body" data-crew-settings={path}>
      <Section title="Helpers">
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
      </Section>
      <AccessSection crew={crew} />
      <RoutingSection crew={crew} />
      <LimitsSection crew={crew} allRuns={allRuns} />
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
            {crew.paused ? "Resume Avos" : "Pause Avos"}
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
  return (
    <Section title="Access">
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
    </Section>
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
 * The crew's limits: one line saying them all, and Edit limits › for the
 * common ones (each one's why is its tooltip), with the rest under More.
 */
function LimitsSection({ crew, allRuns }: { crew: Crew; allRuns: number }) {
  const path = crew.path;
  const quiet = crew.limits.quiet;
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const limit = (name: CrewLimitName) => (value: number) =>
    setCrewLimit(path, name, value);
  const summary = [
    `${crew.limits.runsPerDay} runs a day`,
    `${crew.limits.roundsPerCard} ${crew.limits.roundsPerCard === 1 ? "round" : "rounds"} a card`,
    `pauses at ${crew.limits.pauseAtPercent}% of your week`,
    // "8 am" stays together on one line.
    quiet.on
      ? `quiet ${quietText(quiet).replace(/ (am|pm)/g, "\u00a0$1")}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section title="Limits">
      <div className="crew-settings-line">
        <span data-crew-limits-summary>{summary}</span>
        <Disclosure
          label="Edit limits"
          open={open}
          onToggle={() => setOpen(!open)}
          data-crew-edit-limits
        />
      </div>
      {open ? (
        <div className="crew-settings-deeper" data-crew-limits-open>
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
          <Disclosure
            label="More"
            open={more}
            onToggle={() => setMore(!more)}
            data-crew-limits-more
          />
          {more ? (
            <>
              <LimitRow
                title="Runs a day, all teams"
                detail="A ceiling for every Avos together"
              >
                <NumberPick
                  label="Runs a day, all teams"
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
      ) : null}
    </Section>
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
