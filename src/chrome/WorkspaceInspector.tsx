import {
  memo,
  Suspense,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import type { GitFileDiffKind, GitHistoryCommit } from "../lib/fs";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { retryableLazy } from "../lib/retryableLazy";
import { setReviewProject, useReviewComments } from "../lib/reviewQueue";
import type { OpenFileFn } from "../lib/search";
import type { HarnessId } from "../lib/session";
import { PanelRight } from "./icons";
import { ProjectScripts } from "./ProjectScripts";
import { SurfaceBoundary } from "./SurfaceBoundary";
import "./WorkspaceInspector.css";

export type WorkspaceInspectorTab = "files" | "changes" | "review" | "checks";

export type WorkspaceInspectorProps = {
  /** False pauses work while retaining the last visible view for instant peeks. */
  active: boolean;
  cwd: string;
  gitCwd?: string;
  tab: WorkspaceInspectorTab;
  onTabChange: (tab: WorkspaceInspectorTab) => void;
  /** Hides the panel; the title bar's button and shortcut call it, not the panel. */
  onClose?: () => void;
  /** A temporary hover panel can become a persistent split. */
  onPin?: () => void;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  /** Shows or hides the project's terminal panel. */
  onToggleTerminal?: () => void;
  /** Starts a new chat in a project with `prompt` in its message box. */
  onStartChat?: (project: string, prompt: string) => void;
  /** Opens Settings on the project's page. */
  onOpenSettings?: (section: "project") => void;
  /** The chat in front, whose turns group the changes. */
  sessionId?: string;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  onOpenDiff: (path: string, kind?: GitFileDiffKind) => void;
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
  /** Opens the branch switcher from the Changes header. */
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  selectedDiffPath?: string;
  selectedDiffKind?: GitFileDiffKind;
  selectedCommitSha?: string;
  textHarness?: HarnessId;
  filesSearchOpen: boolean;
  onFilesSearchOpenChange: (open: boolean) => void;
  onOpenFilesSearch?: () => void;
  searchFocusToken?: number;
};

type FilesProps = Pick<
  WorkspaceInspectorProps,
  "cwd" | "onOpenFile" | "onOpenTerminal" | "onFileMoved" | "onFileDeleted"
> & {
  enabled: boolean;
  onSearch: () => void;
};

// Both the tree and its Git subscription load only when Files is visible.
// Search and Changes each replace it rather than leaving hidden trees mounted.
const InspectorFiles = retryableLazy(async () => {
  const [{ FileTree }, { useGitFileStatuses }] = await Promise.all([
    import("./FileTree"),
    import("../hooks/useGitFileStatuses"),
  ]);
  return function InspectorFilesContent(props: FilesProps) {
    const gitStatuses = useGitFileStatuses(props.cwd, props.enabled);
    const lastStatuses = useRef(gitStatuses);
    if (props.enabled) lastStatuses.current = gitStatuses;
    return <FileTree {...props} gitStatuses={lastStatuses.current} />;
  };
});

const InspectorChanges = retryableLazy(() =>
  import("./SourceControl").then(({ SourceControl }) => SourceControl),
);

const InspectorReview = retryableLazy(() =>
  import("./ReviewPanel").then(({ ReviewPanel }) => ReviewPanel),
);

const InspectorChecks = retryableLazy(() =>
  import("./MergePath").then(({ MergePath }) => MergePath),
);

const InspectorSearch = retryableLazy(() =>
  import("./ProjectSearch").then(({ ProjectSearch }) => ProjectSearch),
);

const TABS = ["files", "changes", "review", "checks"] as const;
const LABELS: Record<WorkspaceInspectorTab, string> = {
  files: "Files",
  changes: "Changes",
  review: "Review",
  checks: "Checks",
};

export const WorkspaceInspector = memo(function WorkspaceInspector(
  props: WorkspaceInspectorProps,
) {
  const id = useId();
  const active = props.active;
  // How many files wait in Changes, shown on its tab while there are any.
  const changedFiles =
    useProjectDiffStats(props.gitCwd || props.cwd, active)?.files ?? 0;
  // A comment left on a diff is filed under the project the panel shows,
  // even while the panel is hidden.
  const shownRoot = props.gitCwd || props.cwd;
  useEffect(() => setReviewProject(shownRoot), [shownRoot]);
  const openComments = useReviewComments(shownRoot).filter(
    (comment) => !comment.sentAt,
  ).length;
  const lastVisible = useRef<WorkspaceInspectorProps | null>(null);
  if (active) lastVisible.current = props;
  // Keep the warmed view and scroll position, as the left sidebar does. Hidden
  // project/tab changes must not mount a new tree or start background work.
  if (!lastVisible.current) return null;
  props = lastVisible.current;

  const root = props.gitCwd || props.cwd;
  const hasProject = !!root && root !== "~";
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.indexOf(props.tab);
    const next =
      event.key === "Home"
        ? TABS[0]
        : event.key === "End"
          ? TABS[TABS.length - 1]
          : event.key === "ArrowRight"
            ? TABS[(current + 1) % TABS.length]
            : event.key === "ArrowLeft"
              ? TABS[(current + TABS.length - 1) % TABS.length]
              : undefined;
    if (!next) return;
    event.preventDefault();
    props.onTabChange(next);
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-inspector-tab="${next}"]`)
      ?.focus();
  };
  const openSearch = () => {
    if (props.onOpenFilesSearch) props.onOpenFilesSearch();
    else props.onFilesSearchOpenChange(true);
  };

  return (
    <section
      className="workspace-inspector"
      aria-label="Side panel"
      data-tour="changes"
      aria-hidden={!active || undefined}
      inert={!active || undefined}
    >
      <header className="workspace-inspector-header">
        <div
          className="workspace-inspector-tabs"
          role="tablist"
          aria-label="Workspace details"
          onKeyDown={onTabKey}
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              id={`${id}-${tab}`}
              type="button"
              role="tab"
              aria-selected={props.tab === tab}
              aria-controls={`${id}-panel`}
              tabIndex={props.tab === tab ? 0 : -1}
              data-inspector-tab={tab}
              className="workspace-inspector-tab"
              onClick={() => props.onTabChange(tab)}
            >
              {LABELS[tab]}
              {tab === "changes" && changedFiles > 0 ? (
                <span className="workspace-inspector-count">
                  {changedFiles}
                </span>
              ) : tab === "review" && openComments > 0 ? (
                <span className="workspace-inspector-count">
                  {openComments}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {props.onPin ? (
          <button
            type="button"
            className="workspace-inspector-close"
            aria-label="Pin side panel"
            title="Keep the side panel open"
            onClick={props.onPin}
          >
            <PanelRight className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </header>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${props.tab}`}
        className="workspace-inspector-content"
      >
        {!hasProject ? (
          <p className="workspace-inspector-placeholder">
            Open a project to browse files and changes.
          </p>
        ) : (
          <SurfaceBoundary
            key={`${root}:${props.tab}:${props.filesSearchOpen && props.tab === "files" ? "search" : "default"}`}
            label={props.tab}
          >
            <Suspense
              fallback={
                <p className="workspace-inspector-placeholder" role="status">
                  Loading {props.tab}…
                </p>
              }
            >
              {props.tab === "changes" ? (
                <InspectorChanges
                  key={root}
                  cwd={root}
                  enabled={active}
                  textHarness={props.textHarness}
                  selectedPath={props.selectedDiffPath}
                  selectedKind={props.selectedDiffKind}
                  selectedSha={props.selectedCommitSha}
                  projectCwd={props.cwd}
                  onOpenFile={props.onOpenDiff}
                  onOpenAllChanges={props.onOpenAllChanges}
                  onOpenCommit={props.onOpenCommit}
                  onOpenBranchPicker={props.onOpenBranchPicker}
                  sessionId={props.sessionId}
                />
              ) : props.tab === "review" ? (
                <InspectorReview
                  key={root}
                  cwd={root}
                  enabled={active}
                  onOpenDiff={props.onOpenDiff}
                  onOpenAllChanges={props.onOpenAllChanges}
                />
              ) : props.tab === "checks" ? (
                <InspectorChecks
                  key={root}
                  cwd={root}
                  enabled={active}
                  textHarness={props.textHarness}
                />
              ) : props.filesSearchOpen ? (
                <InspectorSearch
                  key={root}
                  cwd={root}
                  enabled={active}
                  focusToken={props.searchFocusToken || 1}
                  onOpenFile={props.onOpenFile}
                  onClose={() => props.onFilesSearchOpenChange(false)}
                />
              ) : (
                <InspectorFiles
                  key={root}
                  cwd={root}
                  enabled={active}
                  onOpenFile={props.onOpenFile}
                  onOpenTerminal={props.onOpenTerminal}
                  onFileMoved={props.onFileMoved}
                  onFileDeleted={props.onFileDeleted}
                  onSearch={openSearch}
                />
              )}
            </Suspense>
          </SurfaceBoundary>
        )}
      </div>
      {hasProject ? (
        <ProjectScripts
          project={props.cwd && props.cwd !== "~" ? props.cwd : root}
          cwd={root}
          active={active}
          onOpenTerminal={props.onOpenTerminal}
          onToggleTerminal={props.onToggleTerminal}
          onStartChat={props.onStartChat}
          onOpenSettings={props.onOpenSettings}
        />
      ) : null}
    </section>
  );
});
