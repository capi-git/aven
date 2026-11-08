import { useState } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ChevronDown, ChevronRight, MoreHorizontal } from "../chrome/icons";
import { CrewFeed } from "./CrewBoard";
import { helperWord, type AvosGlance, type AvosWeekRow } from "../lib/avos";
import { avosFinishedToday, avosRemembers } from "../lib/avosProfile";
import {
  allowMoreRunsToday,
  clearCrewGoal,
  resumeCrewGoal,
  setCrewPaused,
  stopCrewNow,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { PipelineGoal } from "../lib/crewPipeline";
import type { Crew } from "../lib/crews";
import type { CrewMemberView } from "../lib/crewView";
import "./AvosProfile.css";

/**
 * Avos's profile beside its chat (13B of the Avos mocks), like the details
 * pane beside a messenger's thread: its Bot, its name and ⋯, one line on
 * what it's up to (amber when it needs you), its goal, then what it keeps an
 * eye on, what it remembers and who's helping. On a narrow pane it folds
 * into one header over the chat, and its name opens the rest in a sheet.
 */

export type AvosProfileProps = {
  project: string;
  crew: Crew;
  glance: AvosGlance;
  /** What it's up to, in one line. */
  line: string;
  goal: PipelineGoal | undefined;
  /** Its jobs: what it keeps an eye on. */
  watching: readonly AvosWeekRow[];
  members: readonly CrewMemberView[];
  /** Today's runs are used up: "Allow 10 more today" applies. */
  dailyCap: boolean;
  /** For what finished today. */
  now: number;
  onOpen: (row: AvosWeekRow) => void;
  /** A helper's posts, in the chat. */
  onHelper: (id: string) => void;
  /** Everything it remembers, in a sheet. */
  onNotes: () => void;
  /** A member's name, by its id or role, for what the helpers did. */
  name: (who: string) => string;
  /** The day's limits, over what the helpers did. */
  limits: string;
};

export function AvosProfile(props: AvosProfileProps) {
  const { project, crew, glance, line } = props;
  return (
    <aside
      className="avos-profile"
      aria-label="Avos"
      data-crew-header={crew.path}
    >
      <div className="avos-profile-id">
        <div className="avos-profile-top">
          <CrewCritter
            path={project}
            role="lead"
            state={glance.state}
            className="avos-profile-mark"
          />
          <AvosMore {...props} />
        </div>
        <h1 className="avos-profile-name">Avos</h1>
        <p
          className="avos-profile-line"
          data-crew-sentence
          data-avos-note={glance.note ?? undefined}
        >
          {line}
        </p>
        <AvosGoal project={project} goal={props.goal} />
      </div>
      <AvosSections {...props} />
    </aside>
  );
}

/** On a narrow pane: one header over the chat; Avos's name opens the rest. */
export function AvosBar(props: AvosProfileProps & { onProfile: () => void }) {
  const { project, glance, line, onProfile } = props;
  return (
    <header className="avos-bar" data-avos-bar>
      <button
        type="button"
        className="avos-bar-who"
        aria-label="Avos's profile"
        aria-haspopup="dialog"
        onClick={onProfile}
      >
        <CrewCritter
          path={project}
          role="lead"
          state={glance.state}
          className="avos-bar-mark"
        />
        <span className="avos-bar-name">Avos</span>
        <ChevronDown className="avos-bar-chevron" aria-hidden />
      </button>
      <p
        className="avos-bar-line"
        data-avos-note={glance.note ?? undefined}
        title={line}
      >
        {line}
      </p>
      <AvosMore {...props} />
    </header>
  );
}

/** The goal Avos keeps building towards, where it stands, and its link. */
export function AvosGoal({
  project,
  goal,
}: {
  project: string;
  goal: PipelineGoal | undefined;
}) {
  if (!goal) return null;
  return (
    <p className="avos-profile-goal" data-crew-goal={goal.state}>
      <span className="avos-profile-goal-word">Goal</span> {goal.text}
      <span className="avos-profile-goal-state">
        {goal.state === "met"
          ? " · met"
          : goal.state === "stopped"
            ? ` · stopped: ${goal.why ?? ""}`
            : goal.state === "waits"
              ? ` · ${goal.why ?? "waits"}`
              : " · Avos keeps going"}
      </span>
      {goal.state === "stopped" ? (
        <button
          type="button"
          className="crew-pipe-link"
          onClick={() => resumeCrewGoal(project)}
        >
          Keep going
        </button>
      ) : null}
      {goal.state === "on" || goal.state === "waits" ? (
        <button
          type="button"
          className="crew-pipe-link"
          data-avos-clear-goal
          onClick={() => clearCrewGoal(project)}
        >
          Clear
        </button>
      ) : null}
    </p>
  );
}

/**
 * What Avos keeps an eye on, what it remembers and who's helping, each
 * only when it has something.
 */
export function AvosSections({
  project,
  crew,
  watching,
  members,
  now,
  onOpen,
  onHelper,
  onNotes,
  name,
  limits,
}: Pick<
  AvosProfileProps,
  | "project"
  | "crew"
  | "watching"
  | "members"
  | "now"
  | "onOpen"
  | "onHelper"
  | "onNotes"
  | "name"
  | "limits"
>) {
  const remembers = avosRemembers(crew);
  const finished = avosFinishedToday(crew, now);
  // What the helpers did opens under its line, not in a window of its own.
  const [activityOpen, setActivityOpen] = useState(false);
  // What the helpers did, folded into one line: what finished today, else
  // all of it.
  const activity = finished
    ? `${finished} finished today`
    : crew.feed.length
      ? "All activity"
      : "";
  const helpers = members.filter((member) => member.role !== "lead");
  const subAgents = crew.helpers ?? [];
  return (
    <>
      {watching.length ? (
        <section className="avos-profile-section" data-avos-profile="watching">
          <h2>Keeping an eye on</h2>
          {watching.map((row) => (
            <button
              key={row.id}
              type="button"
              className="avos-profile-row"
              title={row.text}
              onClick={() => onOpen(row)}
            >
              {row.text}
            </button>
          ))}
        </section>
      ) : null}
      {helpers.length || subAgents.length || activity ? (
        <section className="avos-profile-section" data-avos-profile="helpers">
          <h2>Helpers</h2>
          {helpers.map((member) => {
            const word = helperWord(member);
            const state =
              word === "Needs you"
                ? "needs"
                : word === "Working"
                  ? "working"
                  : "resting";
            return (
              <button
                key={member.id}
                type="button"
                className="avos-profile-helper"
                data-avos-helper={member.id}
                data-state={state}
                title={member.line ?? member.roleLabel}
                onClick={() => onHelper(member.id)}
              >
                <CrewCritter
                  path={project}
                  role={member.role}
                  {...(member.critter ? { critter: member.critter } : {})}
                  state={state}
                  className="avos-profile-helper-mark"
                />
                <span className="avos-profile-helper-text">
                  <span className="avos-profile-helper-name">
                    {member.name}
                  </span>
                  {state !== "resting" && member.line ? (
                    <span className="avos-profile-helper-line">
                      {member.line}
                    </span>
                  ) : null}
                </span>
                {/* Only that it needs you: its screen says it's working. */}
                {state === "needs" ? (
                  <span className="avos-profile-helper-word" data-needs-you>
                    Needs you
                  </span>
                ) : null}
              </button>
            );
          })}
          {/* A helper's own one-job helper, while it works. */}
          {subAgents.map((helper) => (
            <p
              key={helper.id}
              className="avos-profile-helper"
              data-avos-sub-agent={helper.id}
              data-state="working"
              title={helper.doing?.text}
            >
              <CrewCritter
                path={project}
                role="helper"
                state="working"
                className="avos-profile-helper-mark"
              />
              <span className="avos-profile-helper-text">
                <span className="avos-profile-helper-name">
                  {helper.name ?? "Helper"}
                </span>
                {helper.doing?.text ? (
                  <span className="avos-profile-helper-line">
                    {helper.doing.text}
                  </span>
                ) : null}
              </span>
            </p>
          ))}
          {activity ? (
            <button
              type="button"
              className="avos-profile-more avos-profile-finished"
              data-avos-finished
              aria-expanded={activityOpen}
              onClick={() => setActivityOpen((open) => !open)}
            >
              {activity}
              <ChevronRight
                className="avos-profile-finished-chevron"
                aria-hidden
              />
            </button>
          ) : null}
          {activity && activityOpen ? (
            <div
              className="crew-activity avos-profile-activity"
              data-avos-activity
            >
              {limits ? (
                <p className="avos-profile-activity-note">{limits}</p>
              ) : null}
              <CrewFeed crew={crew} name={name} />
            </div>
          ) : null}
        </section>
      ) : null}
      {remembers.total ? (
        <section className="avos-profile-section" data-avos-profile="remembers">
          <h2>Remembers</h2>
          {remembers.lines.map((text, index) => (
            <p key={index} className="avos-profile-row" title={text}>
              {text}
            </p>
          ))}
          <button
            type="button"
            className="avos-profile-more"
            data-avos-all-notes
            onClick={onNotes}
          >
            {remembers.total > remembers.lines.length
              ? `All ${remembers.total} notes`
              : "All notes"}
          </button>
        </section>
      ) : null}
    </>
  );
}

/**
 * ⋯ beside Avos's name: Pause and Settings, with Stop now and more runs
 * only while they apply. Schedules, helpers and the rest are things you ask
 * Avos for in its chat, or find in Settings.
 */
function AvosMore({
  crew,
  glance,
  dailyCap,
}: Pick<AvosProfileProps, "crew" | "glance" | "dailyCap">) {
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const items: ExplorerMenuItem[] = [
    ...(glance.note === "working"
      ? [{ kind: "item" as const, id: "stop", label: "Stop now" }]
      : []),
    ...(dailyCap
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    ...(glance.note === "working" || dailyCap
      ? [{ kind: "sep" as const }]
      : []),
    crew.paused
      ? { kind: "item", id: "resume", label: "Resume Avos" }
      : { kind: "item", id: "pause", label: "Pause Avos" },
    { kind: "item", id: "settings", label: "Settings…" },
  ];
  return (
    <>
      <button
        type="button"
        className="avos-profile-more-button"
        aria-label="More for Avos"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(event) => setMenu(menu ? null : event.currentTarget)}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="Avos actions"
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "stop") void stopCrewNow(crew.path);
            else if (id === "more") allowMoreRunsToday(crew.path);
            else if (id === "pause" || id === "resume")
              setCrewPaused(crew.path, id === "pause");
            else if (id === "settings") workspace?.openSettings(crew.path);
          }}
        />
      ) : null}
    </>
  );
}
