import { useState } from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { memberAppLine } from "../chrome/crewSettingsParts";
import { ExplorerMenu } from "../chrome/ExplorerMenu";
import { ChevronRight, MoreHorizontal } from "../chrome/icons";
import { helperWord, type AvosGlance, type AvosWeekRow } from "../lib/avos";
import { avosMenuItems, runAvosMenu } from "../lib/avosMenu";
import { avosFinishedToday } from "../lib/avosProfile";
import {
  clearCrewGoal,
  resumeCrewGoal,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { PipelineBatch, PipelineGoal } from "../lib/crewPipeline";
import { GOAL_NEEDS, crewMemberById, type Crew } from "../lib/crews";
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

/** Where the goal stands, in a word. */
const GOAL_WORD: Readonly<Record<PipelineGoal["state"], string>> = {
  on: "Working",
  waits: "Waiting",
  met: "Met",
  stopped: "Stopped",
};

/**
 * The goal Avos keeps building towards, said once, here. A quiet first row
 * says where it stands and holds the one thing you can do about it; the
 * goal's own words sit under it, two lines at most until pressed. Why it
 * stopped shows only once it's open: the row stays light.
 */
export function AvosGoal({
  project,
  goal,
}: {
  project: string;
  goal: PipelineGoal | undefined;
}) {
  const workspace = useCrewWorkspace();
  const [open, setOpen] = useState(false);
  if (!goal) return null;
  // A folder that can't build yet isn't a failure: the goal says what it
  // needs. A goal that waits says on what ("Waits for your review").
  const waitsOn = goal.state === "waits" && goal.why ? goal.why : "";
  const word = goal.needs
    ? GOAL_NEEDS[goal.needs].replace(/\.$/, "")
    : waitsOn && waitsOn !== "waits"
      ? waitsOn.charAt(0).toUpperCase() + waitsOn.slice(1)
      : GOAL_WORD[goal.state];
  const setUpGit = goal.needs === "no-git" ? workspace?.setUpGit : undefined;
  const why = goal.state === "stopped" && !goal.needs ? goal.why : "";
  return (
    <div
      className="avos-profile-goal"
      data-crew-goal={goal.state}
      data-open={open || undefined}
    >
      <div className="avos-profile-goal-head">
        <span className="avos-profile-goal-word">Goal</span>
        <span className="avos-profile-goal-state">{word}</span>
        {setUpGit ? (
          <button
            type="button"
            className="crew-pipe-link"
            data-avos-goal-set-up-git
            onClick={() => setUpGit(project)}
          >
            Set up Git
          </button>
        ) : goal.state === "stopped" ? (
          <button
            type="button"
            className="crew-pipe-link"
            onClick={() => resumeCrewGoal(project)}
          >
            Keep going
          </button>
        ) : goal.state === "on" || goal.state === "waits" ? (
          <button
            type="button"
            className="crew-pipe-link"
            data-avos-clear-goal
            onClick={() => clearCrewGoal(project)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className="avos-profile-goal-text"
        aria-expanded={open}
        title={open ? undefined : goal.text}
        onClick={() => setOpen(!open)}
      >
        <span>{goal.text}</span>
      </button>
      {open && why ? (
        <p className="avos-profile-goal-why" data-crew-goal-why>
          {why}
        </p>
      ) : null}
    </div>
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
  const items = avosMenuItems({
    paused: !!crew.paused,
    working: glance.note === "working",
    dailyCap,
  });
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
            runAvosMenu(id, crew.path, workspace);
          }}
        />
      ) : null}
    </>
  );
}
