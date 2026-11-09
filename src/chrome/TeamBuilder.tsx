import { useState, useSyncExternalStore } from "react";
import {
  addCrewMember,
  addCrewPreset,
  crewModelFor,
  crewModelsHere,
  presetInCrew,
} from "../lib/crewActions";
import { CREW_PRESETS, type CrewPreset } from "../lib/crewPresets";
import {
  CREW_INSTRUCTIONS_MAX,
  CREW_ROLE_INFO,
  crewMemberName,
  crewMembers,
  memberCritter,
  memberJob,
  memberLabel,
  type Crew,
} from "../lib/crews";
import {
  getHarnessAvailabilitySnapshot,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import type { HarnessId } from "../lib/session";
import {
  MemberTitle,
  agentProblem,
  agentWord,
  memberAppLine,
  useInstalledAgents,
} from "./crewSettingsParts";
import { CrewCritter } from "./CrewCritter";
import { AgentMark } from "./AgentMark";
import { Check, ChevronLeft, ChevronRight, Plus } from "./icons";
import "./TeamBuilder.css";

/**
 * Add a helper: Avos brings in helpers when work needs them, and here you
 * add one yourself, each a role with one job; on the right, who helps,
 * each opening its own page. Every role's rules stay: one Scout, one
 * Researcher and one Security, the Fixer joins from the project's bot, at
 * most eight.
 */

/** The roles to add, in the order they're offered. */
const ROLE_ORDER = [
  "builder",
  "checker",
  "security",
  "scout",
  "researcher",
  "designer",
  "tester",
  "scribe",
];

function presetName(preset: CrewPreset): string {
  return preset.label ?? CREW_ROLE_INFO[preset.role].label;
}

export function TeamBuilder({
  crew,
  project,
  fixerName,
  onAddFixer,
  onOpenMember,
  onClose,
}: {
  crew: Crew;
  project: string;
  fixerName?: string;
  /** Add the project's bot as the team's Fixer. */
  onAddFixer?: (path: string) => void;
  onOpenMember: (id: string) => void;
  onClose: () => void;
}) {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const path = crew.path;
  const members = crewMembers(crew).filter(
    (member) => member.role !== "fixer" || !!fixerName,
  );
  const presets = ROLE_ORDER.map((key) =>
    CREW_PRESETS.find((preset) => preset.key === key),
  ).filter((preset): preset is CrewPreset => !!preset);
  const addPreset = (preset: CrewPreset) => {
    const added = addCrewPreset(
      path,
      preset.key,
      crewModelFor(crewModelsHere(), preset.role),
    );
    setProblem("error" in added ? added.error : null);
  };
  const addAnother = (preset: CrewPreset) => {
    const added = addCrewMember(path, preset.role as "builder" | "checker");
    setProblem("error" in added ? added.error : null);
  };
  return (
    <div className="team-build" data-crew-add>
      <div className="team-build-main">
        <section className="team-build-section" aria-label="Add a helper">
          <h3 className="team-build-label">
            {custom ? (
              <button
                type="button"
                className="team-build-back"
                onClick={() => setCustom(false)}
              >
                <ChevronLeft className="size-3" />
                Your own
              </button>
            ) : (
              "Add a helper"
            )}
          </h3>
          {custom ? (
            <CustomMember
              crew={crew}
              onAdded={() => {
                setCustom(false);
                setProblem(null);
              }}
              onCancel={() => setCustom(false)}
            />
          ) : (
            <ul className="team-build-roles" role="list">
              {presets.map((preset) => {
                const inTeam = presetInCrew(crew, preset);
                const name = presetName(preset);
                // A second Builder or Checker is fine; one Scout, one Security.
                const another =
                  inTeam &&
                  !preset.label &&
                  (preset.role === "builder" || preset.role === "checker");
                return (
                  <li
                    key={preset.key}
                    className="team-build-role"
                    data-crew-preset={preset.key}
                    data-in-team={inTeam || undefined}
                  >
                    <CrewCritter
                      path={path}
                      role={preset.role}
                      critter={preset.mark}
                      className="team-build-role-mark"
                    />
                    <span className="team-build-role-text">
                      <span className="team-build-role-name">{name}</span>
                      <span className="team-build-role-job">{preset.job}</span>
                    </span>
                    {inTeam ? (
                      <span className="team-build-in">
                        <Check className="size-3" />
                        In team
                      </span>
                    ) : null}
                    {!inTeam || another ? (
                      <button
                        type="button"
                        className="team-build-add"
                        aria-label={
                          another ? `Add another ${name}` : `Add ${name}`
                        }
                        title={another ? `Add another ${name}` : `Add ${name}`}
                        onClick={() =>
                          another ? addAnother(preset) : addPreset(preset)
                        }
                      >
                        <Plus className="size-3.5" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
              <li className="team-build-role" data-crew-template="custom">
                <AgentMark vacant className="team-build-role-mark" />
                <span className="team-build-role-text">
                  <span className="team-build-role-name">Your own</span>
                  <span className="team-build-role-job">
                    Give it a name and one job
                  </span>
                </span>
                <button
                  type="button"
                  className="team-build-add"
                  aria-label="Add your own helper"
                  title="Add your own helper"
                  onClick={() => setCustom(true)}
                >
                  <Plus className="size-3.5" />
                </button>
              </li>
            </ul>
          )}
          {!custom && !fixerName ? (
            <p className="team-build-fixer">
              The Fixer joins from the project's bot.{" "}
              {onAddFixer ? (
                <button
                  type="button"
                  className="crew-pipe-link"
                  data-crew-template="fixer"
                  onClick={() => onAddFixer(path)}
                >
                  Add a bot
                </button>
              ) : null}
            </p>
          ) : null}
        </section>
      </div>
      <aside className="team-build-team" aria-label={`${project}'s team`}>
        <h3 className="team-build-team-title">
          {project}'s team <span>{members.length}</span>
        </h3>
        <ul className="team-build-mates" role="list">
          {members.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                className="team-build-mate"
                data-crew-member-row={member.id}
                onClick={() => onOpenMember(member.id)}
              >
                <CrewCritter
                  path={path}
                  role={member.role}
                  {...(member.critter
                    ? { critter: memberCritter(member) }
                    : {})}
                  className="team-build-mate-mark"
                />
                <span className="team-build-mate-text">
                  <span className="team-build-mate-name">
                    <MemberTitle
                      name={crewMemberName(crew, member.id, fixerName)}
                      title={memberLabel(member)}
                    />
                  </span>
                  <span className="team-build-mate-job">
                    {memberJob(member)}
                  </span>
                  <span className="team-build-mate-app">
                    {memberAppLine(member, crew)}
                    {member.paused ? " · off" : ""}
                  </span>
                </span>
                <ChevronRight className="team-build-chevron size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <p className="team-build-note">
          They change files only in Avos's copy and never push or publish. Your
          files change only when you apply their work.
        </p>
        {problem ? (
          <p className="bot-sheet-problem" role="alert">
            {problem}
          </p>
        ) : null}
        <button
          type="button"
          className="team-card-button team-build-done"
          data-variant="primary"
          data-crew-start-team
          onClick={onClose}
        >
          Done
        </button>
      </aside>
    </div>
  );
}

/** Your own teammate: a title, one job, whether it builds or checks, and its agent. */
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
  return (
    <form
      className="crew-custom team-build-custom"
      data-crew-custom
      onSubmit={(event) => {
        event.preventDefault();
        const added = addCrewMember(crew.path, "custom", {
          role,
          label,
          job,
          harness,
          instructions,
        });
        if ("error" in added) setProblem(added.error);
        else onAdded(added.id);
      }}
    >
      <div className="crew-settings-pair">
        <label className="crew-settings-field">
          <span>Name</span>
          <input
            className="aven-field crew-settings-input"
            placeholder="Designer"
            maxLength={40}
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="crew-settings-field">
          <span>One job</span>
          <input
            className="aven-field crew-settings-input"
            placeholder="Makes it look right"
            maxLength={120}
            value={job}
            onChange={(event) => setJob(event.target.value)}
          />
        </label>
      </div>
      <div className="crew-settings-pair">
        <label className="crew-settings-field">
          <span>Works as</span>
          <select
            className="aven-field crew-settings-select"
            value={role}
            onChange={(event) => {
              const next = event.target.value as "builder" | "checker";
              setRole(next);
              // A Builder's agent has to be one that can hold it to its rules.
              if (agentProblem(harness, next)) setHarness("claude");
            }}
          >
            <option value="builder">
              A Builder: changes files in the copy
            </option>
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
                <option key={id} value={id} disabled={!!why} title={why ?? ""}>
                  {agentWord(id)}
                  {why ? ` (${why.toLowerCase()})` : ""}
                </option>
              );
            })}
          </select>
        </label>
      </div>
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
