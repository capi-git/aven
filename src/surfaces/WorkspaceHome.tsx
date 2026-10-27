import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Bot,
  CheckCircle,
  CircleAlert,
  CircleX,
  Clock,
  GitBranch,
  GitPullRequest,
  Globe,
  Kanban,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Square,
  X,
} from "../chrome/icons";
import { TeamMiniFaces } from "../chrome/TeamCard";
import type { PopoverAnchor } from "../chrome/Popover";
import { ProjectCustomizePopover } from "../chrome/ProjectCustomizePopover";
import { ProjectMark } from "../chrome/ProjectMark";
import { BotCritter } from "../chrome/BotCritter";
import { botsAvailable } from "../lib/projectBots";
import type { SidebarBot } from "../chrome/Sidebar";
import { equalChromeData, useChromeProps } from "../hooks/useChromeProps";
import { useHomeBriefing } from "../hooks/useHomeBriefing";
import { useMinuteClock } from "../hooks/useMinuteClock";
import { useDiscussingSessionIds } from "../hooks/useDiscussions";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { activityStreak } from "../lib/activityStreak";
import type {
  GettingStartedCard as GettingStartedCardData,
  GettingStartedStepId,
} from "../lib/gettingStarted";
import { basename } from "../lib/fs";
import {
  briefingHasNews,
  briefingSince,
  homeBriefing,
  type HomeBriefingWindow,
} from "../lib/homeBriefing";
import { openInAppUrl } from "../lib/inAppLinks";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import { sameProjectPath } from "../lib/recents";
import {
  describeProjectStatus,
  projectStatusFor,
  type ProjectStatus,
  type ProjectStatusMap,
} from "../lib/projectStatus";
import {
  formatResetDuration,
  formatUsagePercent,
  loadSavedRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
  type RateLimitWindow,
} from "../lib/rateLimits";
import {
  RESTING_ZZZ_GRID,
  RESTING_ZZZ_PATHS,
  STREAK_FLAME_PATHS,
} from "../lib/projectMascots";
import {
  loadReviewRequests,
  peekReviewRequests,
  type ReviewRequest,
} from "../lib/reviewRequests";
import {
  listScheduledRuns,
  subscribeScheduledRuns,
} from "../lib/scheduledAgents";
import { HARNESS_TITLE } from "../lib/session";
import { teamAgentsText } from "../lib/teamGrouping";
import { useUsageForecasts } from "../hooks/useUsageForecasts";
import { UsageForecastNote } from "../chrome/UsageForecastNote";
import type { ProviderUsageForecast } from "../lib/usageHistory";
import {
  homeElapsed,
  homeGreeting,
  homeTimeAgo,
  homeTodayRecap,
  isWaitingAttention,
  type HomeAttention,
  type HomeFinished,
  type HomeProject,
  type HomeRunning,
  type HomeSession,
} from "../lib/workspaceHome";
import { plural } from "../lib/words";
import { GettingStartedCard } from "./GettingStarted";
import "./EmptySession.css";
import "./WorkspaceHome.css";

export type WorkspaceHomeProps = {
  /** Workspace name. */
  profile: string;
  /** Approvals, questions and unread replies, in the order shown. */
  needsYou: readonly HomeAttention[];
  running: readonly HomeRunning[];
  /** The workspace's projects, in sidebar order. */
  projects: readonly HomeProject[];
  /** Most recent sessions first. */
  recent: readonly HomeSession[];
  /** Finished turns, newest first. */
  finished?: readonly HomeFinished[];
  /** Days with a completed task, oldest first, for the streak. */
  activeDays?: readonly string[];
  /** The sidebar's per-project status, so both always agree. */
  projectStatus?: ProjectStatusMap;
  /** Accounts whose last saved usage is shown; nothing is fetched here. */
  usageProviders?: readonly RateLimitProvider[];
  starting?: boolean;
  windows?: readonly { id: string; label: string }[];
  onShowWindow?: (id: string) => void;
  onReturnWindow?: (id: string) => void;
  onNew: () => void;
  onBrowser: () => void;
  onSearch: () => void;
  onProject: (path: string) => void;
  onSession: (id: string) => void;
  onNewProjectTask?: (path: string) => void;
  /** Open a project's board. */
  onOpenBoard?: (path: string) => void;
  /** Projects' bots that are on, as the sidebar shows them. */
  bots?: readonly SidebarBot[];
  /** Open a project's bot chat. */
  onOpenBot?: (path: string) => void;
  /** Turn a project's bot on, or change its settings. */
  onBotSettings?: (path: string) => void;
  onAddProject: () => void;
  /** Asks for the projects' saved sessions, for Resume and last activity. */
  onLoadProjects?: (paths: readonly string[]) => void;
  /** First steps after the walkthrough, on a fresh install only. */
  gettingStarted?: GettingStartedCardData | null;
  onGettingStartedStart?: (step: GettingStartedStepId) => void;
  onGettingStartedHide?: () => void;
};

/** Rows of Needs you shown before "Show more". */
const NEEDS_YOU_ROWS = 5;
const RECENT_ROWS = 5;
const ACTIVITY_ROWS = 8;
/** A project untouched this long rests: its mascot dims. */
const RESTING_MS = 3 * 24 * 60 * 60 * 1000;

const HOME_DATA: readonly (keyof WorkspaceHomeProps)[] = [
  "needsYou",
  "running",
  "projects",
  "recent",
  "finished",
  "activeDays",
  "projectStatus",
  "usageProviders",
  "windows",
  "gettingStarted",
  "bots",
];

const NO_FINISHED: readonly HomeFinished[] = [];
const NO_BOTS: readonly SidebarBot[] = [];
const NO_DAYS: readonly string[] = [];
/** Rows each part of the briefing lists before summing up the rest. */
const BRIEFING_ROWS = 3;
const NO_PROVIDERS: readonly RateLimitProvider[] = [];

const ATTENTION_LABEL: Record<HomeAttention["kind"], string> = {
  approval: "Needs approval",
  question: "Has a question",
  paused: "Needs you",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * The workspace dashboard: how things stand, each project's agent, what needs
 * the user and what happened. Callbacks are proxied and the lists compared by
 * value, so App's streaming re-renders skip it unless something shown changes.
 */
export function WorkspaceHome(props: WorkspaceHomeProps) {
  return (
    <MemoWorkspaceHome
      {...useChromeProps<WorkspaceHomeProps>(props, HOME_DATA)}
    />
  );
}

/** Scroll a dashboard section into view and move focus to its heading. */
function reveal(ref: RefObject<HTMLElement | null>) {
  const target = ref.current;
  if (!target) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView?.({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
  target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

// Lists keep `role="list"`: WebKit drops list semantics for VoiceOver once
// `list-style: none` hides the markers.
const MemoWorkspaceHome = memo(function WorkspaceHomeView({
  profile,
  needsYou,
  running,
  projects,
  recent,
  finished = NO_FINISHED,
  activeDays = NO_DAYS,
  projectStatus,
  usageProviders = NO_PROVIDERS,
  starting,
  windows = [],
  onShowWindow,
  onReturnWindow,
  onNew,
  onBrowser,
  onSearch,
  onProject,
  onSession,
  onNewProjectTask,
  onOpenBoard,
  bots = NO_BOTS,
  onOpenBot,
  onBotSettings,
  onAddProject,
  onLoadProjects,
  gettingStarted,
  onGettingStartedStart,
  onGettingStartedHide,
}: WorkspaceHomeProps) {
  const labels = useProjectLabels();
  const discussing = useDiscussingSessionIds();
  const ids = useId();
  const agentsRef = useRef<HTMLElement>(null);
  const needsRef = useRef<HTMLElement>(null);
  const activityRef = useRef<HTMLElement>(null);
  const [showAllNeeds, setShowAllNeeds] = useState(false);
  const projectPaths = projects.map((project) => project.path).join("\n");
  useEffect(() => {
    if (projectPaths) onLoadProjects?.(projectPaths.split("\n"));
  }, [projectPaths, onLoadProjects]);

  const nameFor = (cwd: string) =>
    isProjectlessCwd(cwd)
      ? "No project"
      : projectDisplayName(cwd, labels, basename(cwd));
  const waiting = needsYou.filter(isWaitingAttention).length;
  const unread = needsYou.length - waiting;
  let files = 0;
  let changedProjects = 0;
  for (const project of projects) {
    const count = projectStatusFor(projectStatus, project.path)?.files ?? 0;
    files += count;
    if (count) changedProjects += 1;
  }
  const busyProjects = new Set(running.map((row) => row.cwd)).size;
  // A team's row stands for each of its agents at work.
  const agentsWorking = running.reduce(
    (count, row) => count + (row.team ? Math.max(1, row.team.working) : 1),
    0,
  );
  const listed = new Set([
    ...needsYou.map((item) => item.id),
    ...running.flatMap((item) => [
      item.id,
      ...(item.team?.members.map((member) => member.sessionId) ?? []),
    ]),
  ]);
  const recentRows = recent
    .filter((row) => !listed.has(row.id))
    .slice(0, RECENT_ROWS);
  const needsRows = showAllNeeds ? needsYou : needsYou.slice(0, NEEDS_YOU_ROWS);
  const hiddenNeeds = needsYou.length - needsRows.length;
  const activityRows = finished.slice(0, ACTIVITY_ROWS);

  return (
    <section
      className="aven-opening workspace-home"
      aria-label={`${profile} workspace home`}
    >
      <div className="workspace-home-content">
        <header className="workspace-home-header">
          <div className="workspace-home-title">
            <h1>{profile}</h1>
            <p className="workspace-home-summary">
              <Greeting />.
              {running.length + waiting + unread === 0
                ? " All quiet — pick up where you left off."
                : null}
            </p>
            <HomeRecap
              finished={finished}
              activeDays={activeDays}
              onActivity={() => reveal(activityRef)}
            />
            <HomePulse
              running={agentsWorking}
              busyProjects={busyProjects}
              waiting={waiting}
              unread={unread}
              files={files}
              changedProjects={changedProjects}
              onAgents={() => reveal(agentsRef)}
              onNeeds={() => reveal(needsRef)}
            />
          </div>
          <div className="workspace-home-actions">
            <button
              type="button"
              className="workspace-home-new"
              onClick={onNew}
              disabled={starting}
            >
              <Plus size={14} />
              {starting ? "Starting…" : "New chat"}
            </button>
            <button type="button" onClick={onBrowser} disabled={starting}>
              <Globe size={14} />
              Open browser
            </button>
            <button type="button" onClick={onSearch}>
              <Search size={14} />
              Search
            </button>
          </div>
        </header>

        {gettingStarted ? (
          <GettingStartedCard
            card={gettingStarted}
            onStart={(step) => onGettingStartedStart?.(step)}
            onHide={() => onGettingStartedHide?.()}
          />
        ) : null}

        <AwayBriefing
          finished={finished}
          needsYou={needsYou}
          projects={projects}
          onSession={onSession}
          onNeeds={() => reveal(needsRef)}
        />

        <section
          ref={agentsRef}
          className="workspace-home-section"
          aria-labelledby={`${ids}-agents`}
        >
          <h2 id={`${ids}-agents`} tabIndex={-1}>
            Your agents
          </h2>
          <ul className="workspace-home-agents" role="list">
            {projects.map((project) => (
              <AgentTile
                key={project.path}
                project={project}
                name={projectDisplayName(project.path, labels, project.name)}
                status={projectStatusFor(projectStatus, project.path)}
                onSession={onSession}
                onProject={onProject}
                onNewProjectTask={onNewProjectTask}
                onOpenBoard={onOpenBoard}
                bot={bots.find((bot) =>
                  sameProjectPath(bot.path, project.path),
                )}
                onOpenBot={onOpenBot}
                onBotSettings={onBotSettings}
              />
            ))}
            <li className="workspace-home-agent-add">
              <button type="button" onClick={onAddProject}>
                <Plus size={16} />
                {projects.length ? "Add project" : "Add your first project"}
              </button>
            </li>
          </ul>
        </section>

        <div className="workspace-home-panels">
          <div className="workspace-home-column">
            {needsYou.length ? (
              <section
                ref={needsRef}
                className="workspace-home-section"
                aria-labelledby={`${ids}-needs`}
              >
                <h2 id={`${ids}-needs`} tabIndex={-1}>
                  Needs you
                </h2>
                <ul
                  className="workspace-home-panel workspace-home-list"
                  role="list"
                >
                  {needsRows.map((item) => (
                    <li key={item.id}>
                      <SessionRow
                        cwd={item.cwd}
                        title={item.title}
                        attention={item.kind}
                        line={
                          <>
                            <span className="workspace-home-kind">
                              {ATTENTION_LABEL[item.kind]}
                            </span>
                            {item.detail ? ` · ${item.detail}` : ""}
                          </>
                        }
                        aside={
                          <>
                            <span className="workspace-home-row-project">
                              {nameFor(item.cwd)}
                            </span>
                            <TimeAgo at={item.at} />
                          </>
                        }
                        onClick={() => onSession(item.id)}
                      />
                    </li>
                  ))}
                </ul>
                {hiddenNeeds > 0 ? (
                  <button
                    type="button"
                    className="workspace-home-more"
                    onClick={() => setShowAllNeeds(true)}
                  >
                    Show {hiddenNeeds} more
                  </button>
                ) : null}
              </section>
            ) : null}

            {running.length ? (
              <section
                className="workspace-home-section"
                aria-labelledby={`${ids}-running`}
              >
                <h2 id={`${ids}-running`}>Running now</h2>
                <ul
                  className="workspace-home-panel workspace-home-list"
                  role="list"
                >
                  {running.map((item) => (
                    <li
                      key={item.team?.id ?? item.id}
                      data-home-team={item.team?.id}
                    >
                      <SessionRow
                        cwd={item.cwd}
                        title={item.title}
                        active
                        // A team is one row: its mascots, its status and
                        // how many agents; it opens the chat it began in.
                        mark={
                          item.team ? (
                            <TeamMiniFaces members={item.team.members} active />
                          ) : undefined
                        }
                        line={[
                          nameFor(item.cwd),
                          !item.team && discussing.has(item.id)
                            ? "Discussing"
                            : "",
                          item.doing ?? "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        aside={
                          <>
                            {item.team ? (
                              <span className="workspace-home-row-project">
                                {teamAgentsText(item.team)}
                              </span>
                            ) : null}
                            {item.startedAt !== undefined ? (
                              <Elapsed since={item.startedAt} />
                            ) : (
                              <span className="workspace-home-time">
                                Working
                              </span>
                            )}
                          </>
                        }
                        onClick={() => onSession(item.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section
              className="workspace-home-section"
              aria-labelledby={`${ids}-recent`}
            >
              <h2 id={`${ids}-recent`}>Recent chats</h2>
              {recentRows.length ? (
                <ul
                  className="workspace-home-panel workspace-home-list"
                  role="list"
                >
                  {recentRows.map((row) => (
                    <li key={row.id}>
                      <SessionRow
                        cwd={row.cwd}
                        title={row.title}
                        active={row.running}
                        line={`${nameFor(row.cwd)} · ${HARNESS_TITLE[row.harness]}`}
                        aside={<TimeAgo at={row.updatedAt} />}
                        onClick={() => onSession(row.id)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workspace-home-empty">
                  {recent.length
                    ? "Everything recent is listed above."
                    : "Your chats will appear here. Start one with or without a project."}
                </p>
              )}
            </section>
          </div>

          <div className="workspace-home-column">
            <section
              ref={activityRef}
              className="workspace-home-section"
              aria-labelledby={`${ids}-activity`}
            >
              <h2 id={`${ids}-activity`} tabIndex={-1}>
                Activity
              </h2>
              {activityRows.length ? (
                <ul
                  className="workspace-home-panel workspace-home-list"
                  role="list"
                >
                  {activityRows.map((row) => (
                    <li key={row.id}>
                      <SessionRow
                        cwd={row.cwd}
                        title={row.title}
                        outcome={row.kind}
                        line={row.detail || ATTENTION_LABEL[row.kind]}
                        aside={
                          <>
                            {row.unread ? (
                              <span className="workspace-home-unread">
                                <span className="sr-only">Unread</span>
                              </span>
                            ) : null}
                            <TimeAgo at={row.at} />
                          </>
                        }
                        onClick={() => onSession(row.sessionId)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="workspace-home-empty">
                  Finished turns will show up here.
                </p>
              )}
            </section>
            <UsagePanel providers={usageProviders} headingId={`${ids}-usage`} />
          </div>
        </div>

        {windows.length > 0 ? (
          <section
            className="workspace-home-section workspace-home-windows"
            aria-labelledby={`${ids}-windows`}
          >
            <h2 id={`${ids}-windows`}>Open windows</h2>
            {windows.map((item) => (
              <div className="workspace-home-window" key={item.id}>
                <button type="button" onClick={() => onShowWindow?.(item.id)}>
                  {item.label}
                </button>
                <button
                  type="button"
                  onClick={() => onReturnWindow?.(item.id)}
                  aria-label={`Return ${item.label} here`}
                >
                  Return here
                </button>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </section>
  );
});

function Greeting() {
  return <>{homeGreeting(useMinuteClock())}</>;
}

/**
 * What is happening right now, as a few small chips under the greeting. Only
 * counts above zero appear, so a quiet workspace shows none; each chip leads
 * to the section behind it.
 */
function HomePulse({
  running,
  busyProjects,
  waiting,
  unread,
  files,
  changedProjects,
  onAgents,
  onNeeds,
}: {
  running: number;
  busyProjects: number;
  waiting: number;
  unread: number;
  files: number;
  changedProjects: number;
  onAgents: () => void;
  onNeeds: () => void;
}) {
  const chips: {
    key: string;
    text: string;
    tone?: "running" | "amber" | "accent" | "danger";
    onClick?: () => void;
  }[] = [];
  if (running)
    chips.push({
      key: "running",
      text: `${running} ${running === 1 ? "agent" : "agents"} working${
        busyProjects > 1 ? ` in ${busyProjects} projects` : ""
      }`,
      tone: "running",
      onClick: onAgents,
    });
  if (waiting)
    chips.push({
      key: "waiting",
      text: `${waiting} ${waiting === 1 ? "needs" : "need"} you`,
      tone: "amber",
      onClick: onNeeds,
    });
  if (unread)
    chips.push({
      key: "unread",
      text: `${unread} unread`,
      tone: "accent",
      onClick: onNeeds,
    });
  if (files)
    chips.push({
      key: "files",
      text: `${files} ${files === 1 ? "file" : "files"} changed${
        changedProjects > 1 ? ` in ${changedProjects} projects` : ""
      }`,
    });
  if (!chips.length) return null;
  return (
    <ul className="workspace-home-pulse" role="list" aria-label="Right now">
      {chips.map((chip) => (
        <li key={chip.key} data-pulse={chip.key} data-tone={chip.tone}>
          {chip.onClick ? (
            <button type="button" onClick={chip.onClick}>
              <span className="workspace-home-pulse-dot" aria-hidden />
              {chip.text}
            </button>
          ) : (
            <span>
              <span className="workspace-home-pulse-dot" aria-hidden />
              {chip.text}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Today at a glance, under the greeting: the streak of days with a completed
 * task (from two days on), and what finished today. Updates once a minute, so
 * the day turns over on its own.
 */
function HomeRecap({
  finished,
  activeDays,
  onActivity,
}: {
  finished: readonly HomeFinished[];
  activeDays: readonly string[];
  onActivity: () => void;
}) {
  const now = useMinuteClock();
  const today = homeTodayRecap(finished, now);
  const streak = activityStreak(activeDays, now);
  const parts = [
    today.done
      ? `${plural(today.done, "task")} done${
          today.projects > 1 ? ` in ${today.projects} projects` : ""
        }`
      : "",
    today.failed ? `${today.failed} failed` : "",
    today.stopped ? `${today.stopped} stopped` : "",
  ].filter(Boolean);
  const showStreak = streak.days >= 2;
  if (!parts.length && !showStreak) return null;
  return (
    <p className="workspace-home-recap">
      {showStreak ? (
        <span
          className="workspace-home-streak"
          data-pending={!streak.today || undefined}
          title={
            streak.today
              ? `A task done every day for ${plural(streak.days, "day")}`
              : "Finish a task today to keep your streak going"
          }
        >
          <StreakFlame />
          {streak.days}-day streak
        </span>
      ) : null}
      {parts.length ? (
        <button
          type="button"
          className="workspace-home-today"
          data-failed={today.failed > 0 || undefined}
          onClick={onActivity}
        >
          Today: {parts.join(" · ")}
        </button>
      ) : null}
    </p>
  );
}

function StreakFlame() {
  return (
    <svg
      className="workspace-home-streak-flame"
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      aria-hidden
    >
      <path
        className="workspace-home-streak-body"
        d={STREAK_FLAME_PATHS.body}
      />
      <path
        className="workspace-home-streak-core"
        d={STREAK_FLAME_PATHS.core}
      />
    </svg>
  );
}

/**
 * "While you were away": after six hours or a night away, what finished,
 * what waits for the user, which automations ran and which pull requests ask
 * for their review. Shown until dismissed, and only when there is news.
 */
function AwayBriefing(props: {
  finished: readonly HomeFinished[];
  needsYou: readonly HomeAttention[];
  projects: readonly HomeProject[];
  onSession: (id: string) => void;
  onNeeds: () => void;
}) {
  const { briefing, dismiss } = useHomeBriefing();
  if (!briefing) return null;
  return <BriefingCard span={briefing} onDismiss={dismiss} {...props} />;
}

function BriefingCard({
  span,
  finished,
  needsYou,
  projects,
  onSession,
  onNeeds,
  onDismiss,
}: {
  span: HomeBriefingWindow;
  finished: readonly HomeFinished[];
  needsYou: readonly HomeAttention[];
  projects: readonly HomeProject[];
  onSession: (id: string) => void;
  onNeeds: () => void;
  onDismiss: () => void;
}) {
  const headingId = useId();
  const runs = useSyncExternalStore(subscribeScheduledRuns, listScheduledRuns);
  const reviews = useReviewRequests(projects);
  const content = useMemo(
    () => homeBriefing({ window: span, finished, needsYou, runs, projects }),
    [span, finished, needsYou, runs, projects],
  );
  if (!briefingHasNews(content, reviews.length)) return null;
  const runNames = [...new Set(content.runs.map((run) => run.name))];
  return (
    <section className="workspace-home-briefing" aria-labelledby={headingId}>
      <header className="workspace-home-briefing-head">
        <h2 id={headingId}>While you were away</h2>
        <span className="workspace-home-briefing-since">
          {briefingSince(content.since, span.at)}
        </span>
        <button
          type="button"
          className="workspace-home-briefing-dismiss"
          aria-label="Dismiss While you were away"
          title="Dismiss"
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      </header>
      <ul className="workspace-home-briefing-list" role="list">
        {content.finished.length ? (
          <li data-kind="finished">
            <span className="workspace-home-briefing-icon" aria-hidden>
              {content.done ? <CheckCircle size={13} /> : <CircleX size={13} />}
            </span>
            <div className="workspace-home-briefing-body">
              <p>
                {[
                  content.done
                    ? `${plural(content.done, "task")} finished`
                    : "",
                  content.failed ? `${content.failed} failed` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <ul className="workspace-home-briefing-rows" role="list">
                {content.finished.slice(0, BRIEFING_ROWS).map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-outcome={row.kind}
                      onClick={() => onSession(row.sessionId)}
                    >
                      <HomeMark cwd={row.cwd} />
                      <span className="workspace-home-briefing-title">
                        {row.title}
                      </span>
                      {row.kind === "failed" ? (
                        <small className="workspace-home-briefing-failed">
                          Failed
                        </small>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ) : null}
        {content.waiting ? (
          <li data-kind="waiting">
            <span className="workspace-home-briefing-icon" aria-hidden>
              <CircleAlert size={13} />
            </span>
            <div className="workspace-home-briefing-body">
              <button
                type="button"
                className="workspace-home-briefing-link"
                onClick={onNeeds}
              >
                {content.waiting} {content.waiting === 1 ? "needs" : "need"} you
              </button>
            </div>
          </li>
        ) : null}
        {content.runs.length ? (
          <li data-kind="automations">
            <span className="workspace-home-briefing-icon" aria-hidden>
              <Clock size={13} />
            </span>
            <div className="workspace-home-briefing-body">
              <p>
                {[
                  plural(content.runs.length, "automation run"),
                  content.runsFailed ? `${content.runsFailed} failed` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                <span className="workspace-home-briefing-quiet">
                  {" — "}
                  {runNames.slice(0, BRIEFING_ROWS).join(", ")}
                  {runNames.length > BRIEFING_ROWS
                    ? ` and ${runNames.length - BRIEFING_ROWS} more`
                    : ""}
                </span>
              </p>
            </div>
          </li>
        ) : null}
        {reviews.length ? (
          <li data-kind="reviews">
            <span className="workspace-home-briefing-icon" aria-hidden>
              <GitPullRequest size={13} />
            </span>
            <div className="workspace-home-briefing-body">
              <p>
                {plural(reviews.length, "pull request")}{" "}
                {reviews.length === 1 ? "wants" : "want"} your review
              </p>
              <ul className="workspace-home-briefing-rows" role="list">
                {reviews.slice(0, BRIEFING_ROWS).map((review) => (
                  <li key={review.url}>
                    <button
                      type="button"
                      onClick={() =>
                        void openInAppUrl(review.url).catch(() => {})
                      }
                    >
                      <small className="workspace-home-briefing-ref">
                        {review.repo ? `${review.repo}#` : "#"}
                        {review.number}
                      </small>
                      <span className="workspace-home-briefing-title">
                        {review.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/**
 * Pull requests asking for the user's review, fetched once when the briefing
 * appears (cached ten minutes); empty when GitHub is not available.
 */
function useReviewRequests(
  projects: readonly HomeProject[],
): readonly ReviewRequest[] {
  const paths = projects.map((project) => project.path).join("\n");
  const [state, setState] = useState(() => ({
    paths,
    items: peekReviewRequests(paths ? paths.split("\n") : []) ?? [],
  }));
  useEffect(() => {
    if (!paths) return;
    let live = true;
    void loadReviewRequests(paths.split("\n")).then((items) => {
      if (live) setState({ paths, items });
    });
    return () => {
      live = false;
    };
  }, [paths]);
  return state.paths === paths ? state.items : [];
}

type AgentTileProps = {
  project: HomeProject;
  name: string;
  status?: ProjectStatus;
  onSession: (id: string) => void;
  onProject: (path: string) => void;
  onNewProjectTask?: (path: string) => void;
  onOpenBoard?: (path: string) => void;
  /** The project's bot, when it is on. */
  bot?: SidebarBot;
  onOpenBot?: (path: string) => void;
  onBotSettings?: (path: string) => void;
};

/**
 * A project's agent: its mascot (or logo) large, stepping while an agent
 * works, with what it is doing in a speech bubble, an amber "!" while it
 * waits on the user, and an unread count. The whole tile opens the project.
 */
const AgentTile = memo(
  function AgentTile({
    project,
    name,
    status,
    onSession,
    onProject,
    onNewProjectTask,
    onOpenBoard,
    bot,
    onOpenBot,
    onBotSettings,
  }: AgentTileProps) {
    const appearance = useProjectAppearance(project.path);
    const now = useMinuteClock();
    const metaId = useId();
    const moreRef = useRef<HTMLButtonElement>(null);
    const [customize, setCustomize] = useState<PopoverAnchor>(null);
    const running = status?.running ?? 0;
    const waiting = status?.waiting ?? 0;
    const unread = status?.unread ?? 0;
    const files = status?.files ?? 0;
    const state = waiting
      ? "waiting"
      : running
        ? "running"
        : unread
          ? "unread"
          : !project.lastActivity || now - project.lastActivity > RESTING_MS
            ? "resting"
            : "idle";
    // A mascot left alone for days dozes; a new project only rests.
    const dozing = state === "resting" && !!project.lastActivity;
    const described = describeProjectStatus(status);
    const saying = waiting
      ? `Needs you${project.asking ? `: ${project.asking}` : ""}`
      : running
        ? (project.doing ?? "Working")
        : "";
    return (
      <li
        className="workspace-home-agent"
        data-project-path={project.path}
        data-state={state}
        onContextMenu={(event) => {
          event.preventDefault();
          setCustomize({ x: event.clientX, y: event.clientY });
        }}
      >
        <div className="workspace-home-agent-stage" aria-hidden>
          {waiting ? (
            <span
              className="workspace-home-agent-bubble"
              data-kind="asking"
              title={saying}
            >
              !
            </span>
          ) : running ? (
            <span
              className="workspace-home-agent-bubble"
              data-kind="doing"
              title={saying}
            >
              <span className="workspace-home-agent-bubble-text">{saying}</span>
            </span>
          ) : null}
          <span className="workspace-home-agent-figure">
            <ProjectMark
              appearance={appearance}
              active={running > 0}
              reacts
              className="workspace-home-agent-mark"
            />
            {dozing ? <RestingZzz /> : null}
            {unread ? (
              <span className="workspace-home-agent-badge">{unread}</span>
            ) : null}
          </span>
        </div>
        <button
          type="button"
          className="workspace-home-agent-open"
          aria-label={
            project.resumeTitle
              ? `Open ${project.resumeTitle} in ${name}`
              : `Open ${name}`
          }
          aria-describedby={metaId}
          onClick={() =>
            project.resumeId
              ? onSession(project.resumeId)
              : onProject(project.path)
          }
        >
          {name}
        </button>
        <p className="workspace-home-agent-meta" id={metaId}>
          {saying ? <span className="sr-only">{saying}. </span> : null}
          {dozing ? <span className="sr-only">Resting. </span> : null}
          {project.branch ? (
            <span className="workspace-home-agent-branch">
              <GitBranch size={11} aria-hidden />
              <span>{project.branch}</span>
            </span>
          ) : null}
          {files ? (
            <span className="workspace-home-agent-files">
              +{files}
              <span className="sr-only">
                {files === 1 ? " changed file" : " changed files"}
              </span>
            </span>
          ) : null}
          {project.lastActivity ? (
            <TimeAgo at={project.lastActivity} />
          ) : (
            <span>No chats yet</span>
          )}
          {described ? <span className="sr-only">. {described}</span> : null}
        </p>
        {bot && onOpenBot ? (
          <button
            type="button"
            className="workspace-home-agent-bot"
            data-bot-status={bot.status}
            title={`${bot.name}, ${name}'s bot`}
            onClick={() => onOpenBot(project.path)}
          >
            <BotCritter path={project.path} active={bot.status === "working"} />
            <span className="workspace-home-agent-bot-name">{bot.name}</span>
            <span className="workspace-home-agent-bot-post">
              {bot.headline}
            </span>
          </button>
        ) : null}
        <div className="workspace-home-agent-tools">
          {onNewProjectTask ? (
            <button
              type="button"
              aria-label={`New chat in ${name}`}
              title={`New chat in ${name}`}
              onClick={() => onNewProjectTask(project.path)}
            >
              <Plus size={13} />
            </button>
          ) : null}
          {onBotSettings && !bot && botsAvailable() ? (
            <button
              type="button"
              aria-label={`Add a bot for ${name}`}
              title={`Add a bot for ${name}`}
              onClick={() => onBotSettings(project.path)}
            >
              <Bot size={13} />
            </button>
          ) : null}
          {onOpenBoard ? (
            <button
              type="button"
              className="workspace-home-agent-board"
              aria-label={`Open ${name} board`}
              title={`Open ${name} board`}
              onClick={() => onOpenBoard(project.path)}
            >
              <Kanban size={13} />
            </button>
          ) : null}
          <button
            ref={moreRef}
            type="button"
            aria-label={`Customize ${name}`}
            title={`Customize ${name}`}
            aria-haspopup="dialog"
            aria-expanded={customize != null}
            onClick={() =>
              setCustomize((open) => (open ? null : moreRef.current))
            }
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
        {customize ? (
          <ProjectCustomizePopover
            path={project.path}
            anchor={customize}
            onClose={() => setCustomize(null)}
          />
        ) : null}
      </li>
    );
  },
  (a, b) =>
    a.name === b.name &&
    a.onSession === b.onSession &&
    a.onProject === b.onProject &&
    a.onNewProjectTask === b.onNewProjectTask &&
    a.onOpenBoard === b.onOpenBoard &&
    a.onOpenBot === b.onOpenBot &&
    a.onBotSettings === b.onBotSettings &&
    equalChromeData(a.bot, b.bot) &&
    equalChromeData(a.project, b.project) &&
    equalChromeData(a.status, b.status),
);

/** A tiny pixel "zzz" over a mascot whose project has been idle for days. */
function RestingZzz() {
  return (
    <svg
      className="workspace-home-agent-zzz"
      viewBox={`0 0 ${RESTING_ZZZ_GRID.width} ${RESTING_ZZZ_GRID.height}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden
    >
      {RESTING_ZZZ_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** One session in a dashboard list: mark, title over a quiet line, aside. */
function SessionRow({
  cwd,
  title,
  line,
  aside,
  active = false,
  attention,
  outcome,
  mark,
  onClick,
}: {
  cwd: string;
  title: string;
  line: ReactNode;
  aside: ReactNode;
  active?: boolean;
  /** In place of the project's mascot, such as a team's. */
  mark?: ReactNode;
  attention?: HomeAttention["kind"];
  outcome?: HomeFinished["kind"];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="workspace-home-row"
      data-attention={attention}
      data-outcome={outcome}
      // Title and line are cut off when long; the tooltip has them whole.
      title={typeof line === "string" ? `${title} · ${line}` : title}
      onClick={onClick}
    >
      <span className="workspace-home-row-mark">
        {mark ?? <HomeMark cwd={cwd} active={active} />}
        {outcome ? <OutcomeIcon kind={outcome} /> : null}
      </span>
      <span className="workspace-home-row-text">
        <strong>{title}</strong>
        <small>{line}</small>
      </span>
      <span className="workspace-home-row-aside">{aside}</span>
    </button>
  );
}

function OutcomeIcon({ kind }: { kind: HomeFinished["kind"] }) {
  const Icon =
    kind === "completed" ? CheckCircle : kind === "failed" ? CircleX : Square;
  return (
    <span className="workspace-home-outcome" data-outcome={kind}>
      <Icon size={10} aria-hidden />
      <span className="sr-only">{ATTENTION_LABEL[kind]}</span>
    </span>
  );
}

/** A session's project mark, or a quiet chat glyph for tasks without a project. */
function HomeMark({ cwd, active = false }: { cwd: string; active?: boolean }) {
  const appearance = useProjectAppearance(cwd);
  return appearance ? (
    <ProjectMark
      appearance={appearance}
      active={active}
      className="workspace-home-mark"
    />
  ) : (
    <span className="workspace-home-mark workspace-home-mark-none" aria-hidden>
      <MessageSquare size={13} />
    </span>
  );
}

const USAGE_WINDOWS = [
  ["session", "5-hour"],
  ["weekly", "Weekly"],
  ["monthly", "30-day"],
] as const;

/**
 * The last usage the footer saved for each account, with how long each
 * window lasts at the current pace. Home never asks a provider itself; each
 * footer check updates the forecasts, and the saved numbers are read again
 * with them.
 */
function UsagePanel({
  providers,
  headingId,
}: {
  providers: readonly RateLimitProvider[];
  headingId: string;
}) {
  const forecasts = useUsageForecasts();
  const saved = loadSavedRateLimits();
  const accounts = providers.flatMap((provider) => {
    const limits = saved[provider];
    return limits ? [limits] : [];
  });
  if (!accounts.length) return null;
  const asOf = Math.min(...accounts.map((account) => account.updatedAt));
  return (
    <section className="workspace-home-section" aria-labelledby={headingId}>
      <h2 id={headingId}>Usage</h2>
      <div className="workspace-home-panel workspace-home-usage">
        {accounts.map((account) => (
          <UsageAccount
            key={account.provider}
            account={account}
            forecast={forecasts.providers[account.provider]}
          />
        ))}
        <p className="workspace-home-usage-note">
          <TimeAgo at={asOf} prefix="Last checked " />
        </p>
      </div>
    </section>
  );
}

function UsageAccount({
  account,
  forecast,
}: {
  account: ProviderRateLimits;
  forecast: ProviderUsageForecast | undefined;
}) {
  const now = useMinuteClock();
  const windows = USAGE_WINDOWS.flatMap(([key, label]) => {
    const window = account[key] as RateLimitWindow | null | undefined;
    return window ? [{ key, label, window }] : [];
  });
  return (
    <div className="workspace-home-usage-account">
      <h3>{HARNESS_TITLE[account.provider]}</h3>
      {windows.map(({ key, label, window }) => {
        const used = Math.round(Math.min(100, Math.max(0, window.usedPercent)));
        const resets =
          window.resetsAt != null && Number.isFinite(window.resetsAt)
            ? formatResetDuration(window.resetsAt - now)
            : null;
        return (
          <div className="workspace-home-usage-window" key={key}>
            <span className="workspace-home-usage-label">{label}</span>
            <span
              className="workspace-home-usage-meter"
              role="meter"
              aria-label={`${HARNESS_TITLE[account.provider]} ${label.toLowerCase()} usage`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={used}
              data-high={used >= 80 || undefined}
            >
              <span style={{ width: `${Math.max(used, 2)}%` }} />
            </span>
            <span className="workspace-home-usage-value">
              {formatUsagePercent(window.usedPercent)}
              {resets ? (
                <span className="workspace-home-usage-reset">
                  {resets === "now"
                    ? " · resets now"
                    : ` · resets in ${resets}`}
                </span>
              ) : null}
              <UsageForecastNote pace={forecast?.paces[key]} now={now} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Relative time that updates itself once a minute, alone. */
function TimeAgo({ at, prefix = "" }: { at: number; prefix?: string }) {
  const now = useMinuteClock();
  const text = homeTimeAgo(at, now);
  if (!text) return null;
  return (
    <time className="workspace-home-time" dateTime={new Date(at).toISOString()}>
      {prefix}
      {text}
    </time>
  );
}

/** Time since an agent started, updated once a minute. */
function Elapsed({ since }: { since: number }) {
  const now = useMinuteClock();
  return (
    <span className="workspace-home-time">
      <span className="sr-only">Running for </span>
      {homeElapsed(since, now)}
    </span>
  );
}
