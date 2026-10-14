import type {
  WorkspaceProfilePreviewData,
  WorkspaceProfilePreviewTask,
} from "../chrome/ProfileCarouselPreview";
import type { OrchestrationRun } from "./orchestration";
import { projectRailItems, type RecentProject } from "./recents";
import { sessionDisplayTitle, type Session } from "./session";
import { historyWithLiveSessions } from "./sessionHistory";
import { SESSION_LIST_PAGE } from "./sessionListWindow";
import type { SessionSummary } from "./sessionStore";
import {
  standaloneWorkspacePaths,
  type WorkspaceProfile,
} from "./workspaceProfiles";

/** Each of the active workspace's projects with its task rows. */
export function projectSessionSummaries(
  projects: readonly RecentProject[],
  history: SessionSummary[],
  sessions: Session[],
  runs: readonly OrchestrationRun[],
): Record<string, SessionSummary[]> {
  return Object.fromEntries(
    projects.map((project) => [
      project.path,
      historyWithLiveSessions(history, sessions, project.path, undefined, runs),
    ]),
  );
}

/**
 * The workspace switcher's preview of every workspace: each project's newest
 * tasks and the workspace's tasks without a project.
 */
export function workspaceProfilePreviews({
  profiles,
  projectsByProfile,
  history,
  sessions,
  runs,
  busySessionIds,
  nameFor,
}: {
  profiles: WorkspaceProfile[];
  projectsByProfile: Readonly<Record<string, RecentProject[]>>;
  history: SessionSummary[];
  sessions: Session[];
  runs: readonly OrchestrationRun[];
  busySessionIds: ReadonlySet<string>;
  /** A project's display name. */
  nameFor: (path: string) => string;
}): Record<string, WorkspaceProfilePreviewData> {
  const tasksFor = (cwds: readonly string[]): WorkspaceProfilePreviewTask[] =>
    cwds
      .flatMap((cwd) =>
        historyWithLiveSessions(history, sessions, cwd, undefined, runs),
      )
      .filter((session) => !session.archived && !session.orchestrationLeadId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SESSION_LIST_PAGE)
      .map((session) => ({
        id: session.id,
        title: sessionDisplayTitle(session.title, session.harness),
        busy: busySessionIds.has(session.id),
      }));
  return Object.fromEntries(
    profiles.map((profile) => {
      const standalone = standaloneWorkspacePaths(
        { profiles, projectProfiles: {} },
        profile.id,
      );
      return [
        profile.id,
        {
          id: profile.id,
          name: profile.name,
          projects: projectRailItems(
            projectsByProfile[profile.id] ?? [],
            "~",
          ).map((project) => ({
            path: project.path,
            name: nameFor(project.path),
            tasks: tasksFor([project.path]),
          })),
          standaloneTasks: tasksFor(standalone),
        },
      ];
    }),
  );
}
