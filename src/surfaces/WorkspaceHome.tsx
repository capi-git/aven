import { memo, useEffect, useId, useState, type CSSProperties } from "react";
import { GitBranch, Globe, MessageSquare, Plus, Search } from "../chrome/icons";
import { ProjectMark } from "../chrome/ProjectMark";
import { useChromeProps } from "../hooks/useChromeProps";
import { useMinuteClock } from "../hooks/useMinuteClock";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { basename } from "../lib/fs";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import {
  describeProjectStatus,
  projectStatusFor,
  type ProjectStatus,
  type ProjectStatusMap,
} from "../lib/projectStatus";
import { HARNESS_TITLE } from "../lib/session";
import {
  homeElapsed,
  homeSummary,
  homeTimeAgo,
  isWaitingAttention,
  type HomeAttention,
  type HomeProject,
  type HomeRunning,
  type HomeSession,
} from "../lib/workspaceHome";
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
  /** The sidebar's per-project status, so both always agree. */
  projectStatus?: ProjectStatusMap;
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
  onAddProject: () => void;
  /** Asks for the projects' saved sessions, for Resume and last activity. */
  onLoadProjects?: (paths: readonly string[]) => void;
};

/** Rows of Needs you shown before "Show more". */
const NEEDS_YOU_ROWS = 6;
const RECENT_ROWS = 8;

const HOME_DATA: readonly (keyof WorkspaceHomeProps)[] = [
  "needsYou",
  "running",
  "projects",
  "recent",
  "projectStatus",
  "windows",
];

const ATTENTION_LABEL: Record<HomeAttention["kind"], string> = {
  approval: "Needs approval",
  question: "Has a question",
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

/**
 * The workspace's home: what needs the user, what is running, their projects
 * and where they left off. Callbacks are proxied and the lists compared by
 * value, so App's streaming re-renders skip it unless something shown changes.
 */
export function WorkspaceHome(props: WorkspaceHomeProps) {
  return (
    <MemoWorkspaceHome
      {...useChromeProps<WorkspaceHomeProps>(props, HOME_DATA)}
    />
  );
}

// Lists keep `role="list"`: WebKit drops list semantics for VoiceOver once
// `list-style: none` hides the markers.
const MemoWorkspaceHome = memo(function WorkspaceHomeView({
  profile,
  needsYou,
  running,
  projects,
  recent,
  projectStatus,
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
  onAddProject,
  onLoadProjects,
}: WorkspaceHomeProps) {
  const labels = useProjectLabels();
  const ids = useId();
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
  const summary = homeSummary({
    running: running.length,
    waiting,
    unread: needsYou.length - waiting,
  });
  const listed = new Set([
    ...needsYou.map((item) => item.id),
    ...running.map((item) => item.id),
  ]);
  const recentRows = recent
    .filter((row) => !listed.has(row.id))
    .slice(0, RECENT_ROWS);
  const needsRows = showAllNeeds ? needsYou : needsYou.slice(0, NEEDS_YOU_ROWS);
  const hiddenNeeds = needsYou.length - needsRows.length;

  return (
    <section
      className="aven-opening workspace-home"
      aria-label={`${profile} workspace home`}
    >
      <div className="workspace-home-content">
        <header className="workspace-home-header">
          <div className="workspace-home-title">
            <h1>{profile}</h1>
            <p
              className="workspace-home-summary"
              data-quiet={!summary || undefined}
            >
              {summary ||
                (projects.length || recent.length
                  ? "All quiet — pick up where you left off."
                  : "Start a task, or add a project to work in.")}
            </p>
          </div>
          <div className="workspace-home-actions">
            <button
              type="button"
              className="workspace-home-new"
              onClick={onNew}
              disabled={starting}
            >
              <Plus size={14} />
              {starting ? "Starting…" : "New task"}
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

        {needsYou.length ? (
          <section
            className="workspace-home-section"
            aria-labelledby={`${ids}-needs`}
          >
            <h2 id={`${ids}-needs`}>Needs you</h2>
            <ul
              className="workspace-home-panel workspace-home-list"
              role="list"
            >
              {needsRows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="workspace-home-row"
                    data-attention={item.kind}
                    onClick={() => onSession(item.id)}
                  >
                    <HomeMark cwd={item.cwd} />
                    <span className="workspace-home-row-text">
                      <strong>{item.title}</strong>
                      <small>
                        <span className="workspace-home-kind">
                          {ATTENTION_LABEL[item.kind]}
                        </span>
                        {item.detail ? ` · ${item.detail}` : ""}
                      </small>
                    </span>
                    <span className="workspace-home-row-aside">
                      <span className="workspace-home-row-project">
                        {nameFor(item.cwd)}
                      </span>
                      <TimeAgo at={item.at} />
                    </span>
                  </button>
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
                <li key={item.id}>
                  <button
                    type="button"
                    className="workspace-home-row"
                    onClick={() => onSession(item.id)}
                  >
                    <HomeMark cwd={item.cwd} active />
                    <span className="workspace-home-row-text">
                      <strong>{item.title}</strong>
                      <small>{nameFor(item.cwd)}</small>
                    </span>
                    <span className="workspace-home-row-aside">
                      {item.startedAt !== undefined ? (
                        <Elapsed since={item.startedAt} />
                      ) : (
                        <span className="workspace-home-time">Working</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className="workspace-home-section"
          aria-labelledby={`${ids}-projects`}
        >
          <h2 id={`${ids}-projects`}>Projects</h2>
          <ul className="workspace-home-projects" role="list">
            {projects.map((project) => (
              <ProjectCard
                key={project.path}
                project={project}
                name={projectDisplayName(project.path, labels, project.name)}
                status={projectStatusFor(projectStatus, project.path)}
                onResume={() =>
                  project.resumeId
                    ? onSession(project.resumeId)
                    : onProject(project.path)
                }
                onNewTask={
                  onNewProjectTask
                    ? () => onNewProjectTask(project.path)
                    : undefined
                }
              />
            ))}
            <li className="workspace-home-project-add">
              <button type="button" onClick={onAddProject}>
                <Plus size={15} />
                {projects.length ? "Add project" : "Add your first project"}
              </button>
            </li>
          </ul>
        </section>

        <section
          className="workspace-home-section"
          aria-labelledby={`${ids}-recent`}
        >
          <h2 id={`${ids}-recent`}>Recent sessions</h2>
          {recentRows.length ? (
            <ul
              className="workspace-home-panel workspace-home-list"
              role="list"
            >
              {recentRows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="workspace-home-row"
                    onClick={() => onSession(row.id)}
                  >
                    <HomeMark cwd={row.cwd} active={row.running} />
                    <span className="workspace-home-row-text">
                      <strong>{row.title}</strong>
                      <small>
                        {nameFor(row.cwd)} · {HARNESS_TITLE[row.harness]}
                      </small>
                    </span>
                    <span className="workspace-home-row-aside">
                      <TimeAgo at={row.updatedAt} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="workspace-home-empty">
              {recent.length
                ? "Everything recent is listed above."
                : "Your sessions will appear here. Start one with or without a project."}
            </p>
          )}
        </section>

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

function ProjectCard({
  project,
  name,
  status,
  onResume,
  onNewTask,
}: {
  project: HomeProject;
  name: string;
  status?: ProjectStatus;
  onResume: () => void;
  onNewTask?: () => void;
}) {
  const appearance = useProjectAppearance(project.path);
  const described = describeProjectStatus(status);
  return (
    <li
      className="workspace-home-project"
      style={
        appearance
          ? ({ "--project-color": appearance.color } as CSSProperties)
          : undefined
      }
    >
      <div className="workspace-home-project-head">
        <span className="workspace-home-project-chip">
          <ProjectMark
            appearance={appearance}
            active={(status?.running ?? 0) > 0}
            className="project-mark-large"
          />
        </span>
        <div className="workspace-home-project-name">
          <h3 title={project.path}>{name}</h3>
          <p>
            {project.branch ? (
              <span className="workspace-home-project-branch">
                <GitBranch size={11} />
                <span>{project.branch}</span>
              </span>
            ) : null}
            {project.lastActivity ? (
              <TimeAgo at={project.lastActivity} prefix="Active " />
            ) : (
              <span>No sessions yet</span>
            )}
          </p>
        </div>
      </div>
      {project.resumeTitle ? (
        <p className="workspace-home-project-last" title={project.resumeTitle}>
          {project.resumeTitle}
        </p>
      ) : null}
      {described ? (
        <p className="workspace-home-project-status" title={described}>
          {status?.running ? (
            <span data-status="running">{status.running} running</span>
          ) : null}
          {status?.waiting ? (
            <span data-status="waiting">{status.waiting} waiting</span>
          ) : null}
          {status?.unread ? (
            <span data-status="unread">{status.unread} unread</span>
          ) : null}
          {status?.files ? (
            <span data-status="files">
              +{status.files} {status.files === 1 ? "file" : "files"}
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="workspace-home-project-actions">
        <button
          type="button"
          onClick={onResume}
          aria-label={
            project.resumeTitle
              ? `Resume ${project.resumeTitle} in ${name}`
              : `Open ${name}`
          }
        >
          {project.resumeId ? "Resume" : "Open"}
        </button>
        {onNewTask ? (
          <button
            type="button"
            onClick={onNewTask}
            aria-label={`New task in ${name}`}
          >
            <Plus size={13} />
            New task
          </button>
        ) : null}
      </div>
    </li>
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
