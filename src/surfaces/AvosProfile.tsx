import { useState } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { memberAppLine } from "../chrome/crewSettingsParts";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ChevronRight, MoreHorizontal } from "../chrome/icons";
import { helperWord, type AvosGlance, type AvosWeekRow } from "../lib/avos";
import { avosFinishedToday } from "../lib/avosProfile";
import {
  allowMoreRunsToday,
  clearCrewGoal,
  resumeCrewGoal,
  setCrewPaused,
  stopCrewNow,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { PipelineBatch, PipelineGoal } from "../lib/crewPipeline";
import { crewMemberById, type Crew } from "../lib/crews";
import type { CrewMemberView } from "../lib/crewView";
import "./AvosProfile.css";

/**
 * The pieces of Avos's side panel (AvosPanel.tsx): its goal, its helpers
 * with what each is doing and on what, the quick helpers it started,
 * what's ready for you to review, what it keeps an eye on, what finished
 * earlier today (which opens the activity in a sheet), and its ⋯.
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
  /** Work that passed its checks and waits for your review. */
  batch: PipelineBatch | null;
  /** Today's runs are used up: "Allow 10 more today" applies. */
  dailyCap: boolean;
  /** For what finished today. */
  now: number;
  onOpen: (row: AvosWeekRow) => void;
  /** A helper's posts, in the chat. */
  onHelper: (id: string) => void;
  /** What the helpers did, in a sheet. */
  onActivity: () => void;
  /** Review what's ready, beside the chat. */
  onReview: () => void;
  /** A member's name, by its id or role, for what the helpers did. */
  name: (who: string) => string;
};

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

type HelperState = "needs" | "working" | "resting";

/** A helper's screen state from its word: needs you, working or at rest. */
function helperState(member: CrewMemberView): HelperState {
  const word = helperWord(member);
  return word === "Needs you"
    ? "needs"
    : word === "Working"
      ? "working"
      : "resting";
}

const STATE_ORDER: Readonly<Record<HelperState, number>> = {
  needs: 0,
  working: 1,
  resting: 2,
};

/**
 * Ready work, as one line: the first change's name, and how many more
 * come with it.
 */
export function readyTitle(batch: Pick<PipelineBatch, "cards">): string {
  const [first, ...rest] = batch.cards;
  if (!first) return "";
  return rest.length ? `${first.title} and ${rest.length} more` : first.title;
}

/**
 * Who's working (or, while nobody is, who's helping), what's ready for
 * you, what Avos keeps an eye on, and what finished earlier today, each
 * only when it has something.
 */
export type AvosSectionPart = "helpers" | "ready" | "watching" | "activity";

export function AvosSections({
  project,
  crew,
  watching,
  members,
  batch,
  now,
  onOpen,
  onHelper,
  onActivity,
  onReview,
  name,
  parts = ["helpers", "ready", "watching", "activity"],
}: {
  /** Which sections to show (always in this order). */
  parts?: readonly AvosSectionPart[];
} & Pick<
  AvosProfileProps,
  | "project"
  | "crew"
  | "watching"
  | "members"
  | "batch"
  | "now"
  | "onOpen"
  | "onHelper"
  | "onActivity"
  | "onReview"
  | "name"
>) {
  const finished = avosFinishedToday(crew, now);
  // What the helpers did, in one line that opens it in a sheet: what
  // finished today, else all of it.
  const activity = finished
    ? `Earlier today · ${finished} done`
    : crew.feed.length
      ? "All activity"
      : "";
  // Those at work first: needing you, then working, then the rest.
  const helpers = members
    .filter((member) => member.role !== "lead")
    .map((member) => ({ member, state: helperState(member) }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
  const subAgents = crew.helpers ?? [];
  // "Working now" only while someone works; one only waiting on you is
  // still listed first, under Helpers.
  const working =
    subAgents.length > 0 || helpers.some((item) => item.state === "working");
  return (
    <>
      {parts.includes("helpers") && (helpers.length || subAgents.length) ? (
        <section className="avos-profile-section" data-avos-profile="helpers">
          <h2>{working ? "Working now" : "Helpers"}</h2>
          <div className="avos-profile-card">
            {helpers.map(({ member, state }) => {
              const busy = state !== "resting";
              const stored = busy ? crewMemberById(crew, member.id) : undefined;
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
                    {busy && member.line ? (
                      <span className="avos-profile-helper-line">
                        {member.line}
                      </span>
                    ) : null}
                    {stored ? (
                      <span className="avos-profile-helper-meta">
                        {memberAppLine(stored, crew)}
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
            {/* A quick helper Avos or a helper started for one question. */}
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
                    {helper.name ?? "Quick helper"}
                  </span>
                  {helper.doing?.text ? (
                    <span className="avos-profile-helper-line">
                      {helper.doing.text}
                    </span>
                  ) : null}
                  <span className="avos-profile-helper-meta">
                    {helper.helperOf
                      ? `Started by ${name(helper.helperOf)} · reads only`
                      : "Reads only"}
                  </span>
                </span>
              </p>
            ))}
          </div>
        </section>
      ) : null}
      {parts.includes("ready") && batch?.cards.length ? (
        <section className="avos-profile-section" data-avos-profile="ready">
          <h2>Ready for you</h2>
          <div className="avos-profile-card avos-profile-ready">
            <CrewCritter
              path={project}
              role="builder"
              state="ready"
              className="avos-profile-helper-mark"
            />
            <span className="avos-profile-helper-text">
              <span className="avos-profile-helper-name" title={batch.status}>
                {readyTitle(batch)}
              </span>
              {batch.conflict ? (
                <span className="avos-profile-helper-meta">
                  Your files changed since
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="team-card-button avos-profile-review"
              data-variant="primary"
              data-size="compact"
              data-avos-profile-review
              onClick={onReview}
            >
              Review
            </button>
          </div>
        </section>
      ) : null}
      {parts.includes("watching") && watching.length ? (
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
      {parts.includes("activity") && activity ? (
        <button
          type="button"
          className="avos-profile-more avos-profile-finished"
          data-avos-finished
          aria-haspopup="dialog"
          onClick={onActivity}
        >
          {activity}
          <ChevronRight className="avos-profile-finished-chevron" aria-hidden />
        </button>
      ) : null}
    </>
  );
}

/**
 * ⋯ beside Avos's name: what it remembers, Pause and Settings, with Stop
 * now and more runs only while they apply. Schedules, helpers and the rest
 * are things you ask Avos for in its chat, or find in Settings.
 */
export function AvosMore({
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
    { kind: "item", id: "notes", label: "What Avos remembers" },
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
            // What it remembers: its Memory page in Settings.
            else if (id === "notes")
              workspace?.openSettings(crew.path, "memory");
            else if (id === "pause" || id === "resume")
              setCrewPaused(crew.path, id === "pause");
            else if (id === "settings") workspace?.openSettings(crew.path);
          }}
        />
      ) : null}
    </>
  );
}
