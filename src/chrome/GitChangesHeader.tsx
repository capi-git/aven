import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { basename, type GitDiffIndex, type GitHistoryCommit } from "../lib/fs";
import { shortTimeAgo, upstreamLabel } from "../lib/gitChangesView";
import { projectSigil } from "../lib/dotSigils";
import { displayAppData } from "../lib/paths";
import { ChevronDown, GitBranch, GitCompare, Plus } from "./icons";
import { ProjectMark } from "./ProjectMark";
import { DotMark } from "./DotMark";

/** The copy being shown: project, branch, where it stands, and its last commit. */
export function ChangesHeader({
  cwd,
  projectCwd,
  index,
  lastCommit,
  copyLabel,
  now,
  onOpenBranchPicker,
  onOpenCommit,
}: {
  cwd: string;
  /** The project folder, for its name and mark; `cwd` may be another copy. */
  projectCwd?: string;
  index: GitDiffIndex | null;
  lastCommit: GitHistoryCommit | null;
  copyLabel: string | null;
  now: number;
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  onOpenCommit?: (commit: GitHistoryCommit) => void;
}) {
  const appearance = useProjectAppearance(projectCwd || cwd);
  const name = appearance?.label ?? basename(projectCwd || cwd);
  const branch = index?.branch ?? null;
  const ahead = index?.ahead ?? 0;
  const behind = index?.behind ?? 0;
  const synced =
    !!index?.upstream && ahead === 0 && behind === 0 && !!index.branch;
  return (
    <header aria-label="Change summary" className="git-hero">
      <div className="git-hero-top">
        <ProjectMark
          path={projectCwd || cwd}
          appearance={appearance}
          className="project-mark-large"
        />
        <span
          className="git-hero-project"
          title={displayAppData(projectCwd || cwd)}
        >
          {name}
        </span>
        {copyLabel ? (
          <span className="git-hero-copy" title={displayAppData(cwd)}>
            {copyLabel}
          </span>
        ) : null}
      </div>
      {branch ? (
        <div className="git-hero-branch-row">
          <button
            type="button"
            className="git-hero-branch"
            disabled={!onOpenBranchPicker}
            title={onOpenBranchPicker ? `Switch branch: ${branch}` : branch}
            aria-label={
              onOpenBranchPicker
                ? `Switch branch: ${branch}`
                : `Branch: ${branch}`
            }
            aria-haspopup="dialog"
            onClick={(event) => onOpenBranchPicker?.(event.currentTarget)}
          >
            <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{branch}</span>
            {onOpenBranchPicker ? (
              <ChevronDown className="size-3 shrink-0" strokeWidth={1.75} />
            ) : null}
          </button>
          <span
            className="git-hero-sync"
            data-tone={synced ? "ok" : ahead || behind ? "info" : undefined}
            title={index ? upstreamLabel(index) : undefined}
          >
            {ahead > 0 || behind > 0 ? (
              <>
                {ahead > 0 ? (
                  <span aria-label={`${ahead} to push`}>↑{ahead}</span>
                ) : null}
                {behind > 0 ? (
                  <span aria-label={`${behind} to pull`}>↓{behind}</span>
                ) : null}
              </>
            ) : index ? (
              <span className="truncate">
                {synced ? "Up to date" : upstreamLabel(index)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
      {lastCommit ? (
        <button
          type="button"
          className="git-hero-commit"
          title={`${lastCommit.shortSha} ${lastCommit.subject}${lastCommit.author ? ` — ${lastCommit.author}` : ""}`}
          disabled={!onOpenCommit}
          onClick={() => onOpenCommit?.(lastCommit)}
        >
          <span className="git-hero-commit-dot" aria-hidden />
          <span className="git-hero-commit-subject">
            {lastCommit.subject || lastCommit.shortSha}
          </span>
          <span className="git-hero-commit-age">
            {shortTimeAgo(lastCommit.timestamp * 1000, now)}
          </span>
        </button>
      ) : null}
    </header>
  );
}

/** Nothing to commit: the project's mascot, where the branch stands, and what to do next. */
export function CleanState({
  cwd,
  projectCwd,
  title,
  detail,
  noGit,
  lastCommit,
  now,
  onShowHistory,
  onOpenBranchPicker,
}: {
  cwd: string;
  projectCwd?: string;
  title: string;
  detail: string;
  /** The folder is not a Git repository. */
  noGit: boolean;
  lastCommit: GitHistoryCommit | null;
  now: number;
  onShowHistory?: () => void;
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
}) {
  const appearance = useProjectAppearance(projectCwd || cwd);
  return (
    <section
      className="git-clean"
      data-no-git={noGit || undefined}
      aria-label={noGit ? "Not a Git repository" : "All clean"}
    >
      {appearance ? (
        <DotMark
          sigil={projectSigil(appearance.mascot, appearance.key)}
          className="git-clean-mascot"
        />
      ) : (
        <span className="git-clean-mark" aria-hidden>
          ✓
        </span>
      )}
      <p className="git-clean-title">
        {noGit ? "No Git here yet" : "All clean"}
      </p>
      <div role="status">
        <p className="git-clean-status">
          {noGit ? "This folder isn't a Git repository." : title}
        </p>
        <p className="git-clean-detail">
          {noGit ? "Changes and history show here once it is." : detail}
        </p>
      </div>
      {lastCommit ? (
        <p className="git-clean-last" title={lastCommit.subject}>
          <span>Last commit</span>
          <span className="git-clean-last-subject">
            {lastCommit.subject || lastCommit.shortSha}
          </span>
          <span className="git-clean-last-age">
            {shortTimeAgo(lastCommit.timestamp * 1000, now)}
          </span>
        </p>
      ) : null}
      {noGit ? null : (
        <div className="git-clean-actions">
          {onShowHistory ? (
            <button
              type="button"
              className="git-clean-action"
              onClick={onShowHistory}
            >
              <GitCompare className="size-3 shrink-0" strokeWidth={1.75} />
              History
            </button>
          ) : null}
          {onOpenBranchPicker ? (
            <>
              <button
                type="button"
                className="git-clean-action"
                aria-haspopup="dialog"
                onClick={(event) => onOpenBranchPicker(event.currentTarget)}
              >
                <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
                Switch branch
              </button>
              <button
                type="button"
                className="git-clean-action"
                aria-haspopup="dialog"
                title="Type a new name in the branch switcher to create it"
                onClick={(event) => onOpenBranchPicker(event.currentTarget)}
              >
                <Plus className="size-3 shrink-0" strokeWidth={1.75} />
                New branch
              </button>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
