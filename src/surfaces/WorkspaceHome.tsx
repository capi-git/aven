import { Folder, Plus, Globe, Search } from "../chrome/icons";
import { ProviderMarks } from "../chrome/ProviderMarks";
import type { HarnessId } from "../lib/session";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import "./EmptySession.css";
import "./WorkspaceHome.css";

export type WorkspaceHomeSession = {
  id: string;
  title: string;
  project: string;
  cwd?: string;
  harness: HarnessId;
  busy?: boolean;
};
export function WorkspaceHome({
  profile,
  projects,
  sessions,
  starting,
  windows = [],
  onShowWindow,
  onReturnWindow,
  onNew,
  onBrowser,
  onProject,
  onSession,
  onAddProject,
  onSearch,
}: {
  profile: string;
  projects: readonly { path: string; name: string }[];
  sessions: readonly WorkspaceHomeSession[];
  starting?: boolean;
  windows?: readonly { id: string; label: string }[];
  onShowWindow?: (id: string) => void;
  onReturnWindow?: (id: string) => void;
  onNew: () => void;
  onBrowser: () => void;
  onProject: (path: string) => void;
  onSession: (id: string) => void;
  onAddProject: () => void;
  onSearch: () => void;
}) {
  const projectLabels = useProjectLabels();
  return (
    <section
      className="aven-opening workspace-home"
      aria-label={`${profile} workspace home`}
    >
      <div className="workspace-home-content">
        <header className="aven-opening-heading">
          <h1>Make room for your next idea.</h1>
          <p>Start a task or return to a project.</p>
        </header>
        <div className="workspace-home-actions">
          <button
            className="workspace-home-new"
            onClick={onNew}
            disabled={starting}
          >
            <Plus size={15} />
            {starting ? "Starting…" : "New task"}
          </button>
          <button onClick={onBrowser} disabled={starting}>
            <Globe size={15} />
            Open browser
          </button>
          <button onClick={onSearch}>
            <Search size={15} />
            Search
          </button>
        </div>
        {windows.length > 0 ? (
          <section
            className="workspace-home-windows"
            aria-label="Detached windows"
          >
            <h2>Open windows</h2>
            {windows.map((item) => (
              <div className="workspace-home-window" key={item.id}>
                <button onClick={() => onShowWindow?.(item.id)}>
                  {item.label}
                </button>
                <button onClick={() => onReturnWindow?.(item.id)}>
                  Return here
                </button>
              </div>
            ))}
          </section>
        ) : null}
        <div className="workspace-home-columns">
          <div>
            <h2>Recent sessions</h2>
            {sessions.length ? (
              sessions.slice(0, 8).map((row) => (
                <button
                  key={row.id}
                  className="workspace-home-row"
                  onClick={() => onSession(row.id)}
                >
                  <ProviderMarks
                    harnesses={[row.harness]}
                    busyHarnesses={row.busy ? [row.harness] : []}
                  />
                  <span>
                    <strong>{row.title}</strong>
                    <small>
                      {row.cwd
                        ? projectDisplayName(
                            row.cwd,
                            projectLabels,
                            row.project,
                          )
                        : row.project}
                      {row.busy ? " · Running" : ""}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="workspace-home-empty">
                Your sessions will appear here. Start one with or without a
                project.
              </p>
            )}
          </div>
          <div>
            <div className="workspace-home-section-heading">
              <h2>Projects</h2>
              <button onClick={onAddProject} aria-label="Add project">
                <Plus size={15} />
              </button>
            </div>
            {projects.length ? (
              projects.map((project) => (
                <button
                  key={project.path}
                  className="workspace-home-row"
                  onClick={() => onProject(project.path)}
                >
                  <Folder size={16} />
                  <span>
                    <strong>
                      {projectDisplayName(
                        project.path,
                        projectLabels,
                        project.name,
                      )}
                    </strong>
                  </span>
                </button>
              ))
            ) : (
              <button className="workspace-home-row" onClick={onAddProject}>
                <Plus size={16} />
                Add your first project
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
