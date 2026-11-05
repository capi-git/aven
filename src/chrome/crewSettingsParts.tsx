import { useSyncExternalStore, type ReactNode } from "react";
import { crewAgentAllowed } from "../lib/crewActions";
import {
  CREW_AGENTS,
  crewAgentsFor,
  crewMemberApp,
  type CrewLimitName,
  type CrewMember,
  type CrewRole,
} from "../lib/crews";
import { titleBeside } from "../lib/crewView";
import {
  getHarnessAvailabilitySnapshot,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import { findModel, preferredModelId } from "../lib/models";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";

/**
 * Pieces the team's settings share: the team page, a teammate's page and
 * Build a team. None of them change what a teammate may do: that comes
 * from its role (see `crewChatPermissions`).
 */

/** The values each limit's picker offers (yours is added when it isn't one). */
export const LIMIT_CHOICES: Readonly<Record<CrewLimitName, readonly number[]>> =
  {
    roundsPerCard: [1, 2, 3, 4, 5],
    runsPerDay: [5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200],
    autoStartsPerDay: [0, 1, 2, 3, 5, 8, 10, 15, 20],
    ideasPerDay: [0, 1, 2, 3, 4, 5, 6, 8, 10],
    turnMinutes: [5, 10, 15, 20, 30, 45, 60, 90, 120],
    pauseAtPercent: [50, 60, 70, 80, 90, 100],
    readyCap: [1, 2, 3, 5, 8, 10, 15, 20],
  };

/** A labelled picker of numbers, yours kept when it isn't one of the choices. */
export function NumberPick({
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

export function LimitRow({
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
      <span title={detail}>{title}</span>
      {children}
    </div>
  );
}

/** The app and model a member runs on now, its app's usual model if it has none. */
export function memberApp(member: CrewMember): {
  harness: HarnessId;
  model: string;
} {
  const app = crewMemberApp(member);
  return {
    harness: app.harness,
    model: app.model ?? preferredModelId(app.harness),
  };
}

/** A model's name; one the catalog doesn't know yet still reads as a name. */
export function modelName(id: string): string {
  const known = findModel(id)?.name;
  if (known) return known;
  const bare = id.slice(id.indexOf(":") + 1);
  if (/^gpt-/i.test(bare)) return `GPT-${bare.slice(4)}`;
  return bare
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** A model's short name beside its agent: "Opus 5.5" after "Claude". */
export function shortModelName(id: string): string {
  return modelName(id).replace(/^Claude /, "");
}

/** An agent in a word: "Claude", "Codex". */
export function agentWord(id: HarnessId): string {
  return id === "claude" ? "Claude" : HARNESS_TITLE[id];
}

/** "Claude · Opus 5.5": what a teammate runs on, in a few words. */
export function memberAppLine(member: CrewMember): string {
  if (member.role === "fixer") return "This project's bot";
  const { harness, model } = memberApp(member);
  return `${agentWord(harness)} · ${shortModelName(model)}`;
}

/** Why an app can't be picked for this member, or null when it can. */
export function agentProblem(id: HarnessId, role: CrewRole): string | null {
  if (!crewAgentAllowed(id))
    return role === "builder"
      ? "Can't be held to Avos's rules yet"
      : "Can't be locked to read-only";
  if (!crewAgentsFor(role).includes(id))
    return "Can't keep a Builder out of the copy's settings yet";
  if (id !== "claude" && !isHarnessAvailable(id)) return "Not installed";
  return null;
}

/** Claude Code and Codex always; any other app only once it's installed. */
export function useInstalledAgents(): readonly HarnessId[] {
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  return HARNESSES.filter(
    (id) =>
      (CREW_AGENTS as readonly string[]).includes(id) || isHarnessAvailable(id),
  );
}

/** A member's name, then its title when the name doesn't already say it. */
export function MemberTitle({ name, title }: { name: string; title: string }) {
  const beside = titleBeside(name, title);
  return (
    <>
      {name}
      {beside ? (
        <>
          {" "}
          <small className="crew-settings-role">{beside}</small>
        </>
      ) : null}
    </>
  );
}
