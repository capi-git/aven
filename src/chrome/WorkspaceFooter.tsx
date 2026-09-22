import { memo } from "react";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import {
  ChevronDown,
  ExternalLink,
  Folder,
  GitBranch,
  GitCompare,
  GitPullRequest,
  Terminal,
} from "./icons";
import "./WorkspaceFooter.css";

export type WorkspaceFooterProps = {
  active: boolean;
  /** The active working copy, including a session worktree when applicable. */
  cwd: string;
  branch?: string | null;
  detached?: boolean;
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  branchDisabledReason?: string;
  onOpenChanges?: () => void;
  changesOpen?: boolean;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
  onCreatePR?: () => void;
  createPRDisabledReason?: string;
  onOpenPRMenu?: (anchor: HTMLButtonElement) => void;
  prMenuOpen?: boolean;
};

export const WorkspaceFooter = memo(function WorkspaceFooter({
  active,
  cwd,
  branch,
  detached = false,
  onOpenBranchPicker,
  branchDisabledReason,
  onOpenChanges,
  changesOpen = false,
  onToggleTerminal,
  terminalOpen = false,
  onCreatePR,
  createPRDisabledReason,
  onOpenPRMenu,
  prMenuOpen = false,
}: WorkspaceFooterProps) {
  const projectless = isProjectlessCwd(cwd);
  const hasCwd = !!cwd && cwd !== "~";
  const hasProject = hasCwd && !projectless;
  // This shared, event-driven store deduplicates reads with other Git surfaces.
  // It owns no interval and unsubscribes when this footer is not visible.
  const stats = useProjectDiffStats(cwd, active && hasProject);
  if (!active) return null;

  const branchName = detached ? "Detached HEAD" : branch?.trim() || "—";
  const branchReason = !hasProject
    ? "Open a project to choose a branch"
    : branchDisabledReason ||
      (!onOpenBranchPicker ? "Branch switching is unavailable" : undefined);
  const prReason = !hasProject
    ? "Open a project to create a pull request"
    : createPRDisabledReason ||
      (!onCreatePR ? "Pull request creation is unavailable" : undefined);
  const changesEnabled = hasProject && !!onOpenChanges;
  const terminalEnabled = hasCwd && !!onToggleTerminal;
  const prMenuEnabled = hasProject && !!onOpenPRMenu;

  return (
    <footer className="workspace-footer" aria-label="Workspace status">
      <div className="workspace-footer-project">
        {projectless ? (
          <span className="workspace-footer-no-project">
            <Folder
              className="size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>No project</span>
          </span>
        ) : (
          <button
            type="button"
            className="workspace-footer-branch"
            disabled={!!branchReason}
            title={branchReason || `Switch branch: ${branchName}`}
            aria-label={branchReason || `Switch branch: ${branchName}`}
            aria-haspopup="dialog"
            onClick={(event) => onOpenBranchPicker?.(event.currentTarget)}
          >
            <GitBranch
              className="size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>{branchName}</span>
          </button>
        )}
        {!projectless ? (
          <button
            type="button"
            className="workspace-footer-changes"
            disabled={!changesEnabled}
            title={changesEnabled ? "Open changes" : "Changes unavailable"}
            aria-label="Open changes"
            aria-description={stats ? `${stats.additions} added lines, ${stats.deletions} deleted lines` : undefined}
            aria-pressed={changesOpen}
            onClick={onOpenChanges}
          >
            <GitCompare className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>Changes</span>
            {stats ? (
              <span className="workspace-footer-diff-counts" aria-hidden>
                <span className="workspace-footer-additions">+{stats.additions}</span>
                <span className="workspace-footer-deletions">-{stats.deletions}</span>
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {!projectless ? (
        <div className="workspace-footer-pr">
          <button
            type="button"
            className="workspace-footer-pr-action"
            disabled={!!prReason}
            title={prReason || "Create pull request"}
            aria-label={prReason || "Create pull request"}
            onClick={onCreatePR}
          >
            <GitPullRequest
              className="size-3.5"
              strokeWidth={1.75}
              aria-hidden
            />
            <span>Create PR</span>
            <ExternalLink className="size-2.5" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className="workspace-footer-pr-menu"
            disabled={!prMenuEnabled}
            title={
              prMenuEnabled
                ? "Pull request options"
                : "Pull request options unavailable"
            }
            aria-label="Pull request options"
            aria-haspopup="dialog"
            aria-expanded={prMenuOpen}
            onClick={(event) => onOpenPRMenu?.(event.currentTarget)}
          >
            <ChevronDown className="size-3" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="workspace-footer-tools">
        <button
          type="button"
          className="workspace-footer-icon"
          disabled={!terminalEnabled}
          title={
            terminalEnabled
              ? `${terminalOpen ? "Hide" : "Show"} terminal`
              : "Open a project to use the terminal"
          }
          aria-label={`${terminalOpen ? "Hide" : "Show"} terminal`}
          aria-pressed={terminalOpen}
          onClick={onToggleTerminal}
        >
          <Terminal className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </footer>
  );
});
