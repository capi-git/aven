import {
  Activity,
  memo,
  Suspense,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import type { GitFileDiffKind, GitHistoryCommit } from "../lib/fs";
import { useProjectDiffStats } from "../hooks/useProjectDiffStats";
import { whenIdle } from "../lib/idle";
import { retryableLazy } from "../lib/retryableLazy";
import { setReviewProject, useReviewComments } from "../lib/reviewQueue";
import type { OpenFileFn } from "../lib/search";
import type { HarnessId } from "../lib/session";
import { PanelRight } from "./icons";
import { ProjectScripts } from "./ProjectScripts";
import { useHoverCard } from "./HoverCard";
import { ChangesPeekCard } from "./HoverPeeks";
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

// Both the tree and its Git subscription load only once Files is first shown.
// A tab shown before stays mounted but hidden (React's Activity), so going
// back to it draws the last view at once; hidden, its effects are paused.
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

const TAB_VIEWS = {
  files: InspectorFiles,
  changes: InspectorChanges,
  review: InspectorReview,
  checks: InspectorChecks,
} as const;

/**
 * Load a tab's view before the panel shows it, so opening the panel draws
 * the tab at once instead of "Loading files…" first.
 */
export function preloadInspectorTab(tab: WorkspaceInspectorTab) {
  return TAB_VIEWS[tab].preload();
}

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
  // A closed panel's tab loads once startup settles, as the other views do
  // (preloadLazyViews): not with startup, so the first chat opens as fast.
  const tabRef = useRef(props.tab);
  tabRef.current = props.tab;
  // The other tabs' code loads after it, so a first click on one never waits
  // for a download.
  useEffect(
    () =>
      whenIdle(() => {
        void preloadInspectorTab(tabRef.current).then(() =>
          Promise.all(TABS.map((tab) => preloadInspectorTab(tab))),
        );
      }),
    [],
  );
  // How many files wait in Changes, shown on its tab while there are any.
  const diffStats = useProjectDiffStats(props.gitCwd || props.cwd, active);
  const changedFiles = diffStats?.files ?? 0;
  const changesTab = useRef<HTMLButtonElement>(null);
  // Pointing at Changes lists its files; only while there are some.
  const changesPeek = useHoverCard({ disabled: !active || changedFiles === 0 });
  // A comment left on a diff is filed under the project the panel shows,
  // even while the panel is hidden.
  const shownRoot = props.gitCwd || props.cwd;
  useEffect(() => setReviewProject(shownRoot), [shownRoot]);
  const openComments = useReviewComments(shownRoot).filter(
    (comment) => !comment.sentAt,
  ).length;
  const lastVisible = useRef<WorkspaceInspectorProps | null>(null);
  const visited = useRef<{ root: string; tabs: Set<WorkspaceInspectorTab> }>({
    root: "",
    tabs: new Set(),
  });
  if (active) lastVisible.current = props;
  // Keep the warmed view and scroll position, as the left sidebar does. Hidden
  // project/tab changes must not mount a new tree or start background work.
  if (!lastVisible.current) return null;
  props = lastVisible.current;

  const root = props.gitCwd || props.cwd;
  // Tabs shown in this project, kept mounted (hidden) for a quick return.
  if (visited.current.root !== root) {
    visited.current = { root, tabs: new Set() };
  }
  visited.current.tabs.add(props.tab);
  const hasProject = !!root && root !== "~";
  const scriptsProject = props.cwd && props.cwd !== "~" ? props.cwd : root;
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

  const renderTab = (tab: WorkspaceInspectorTab, enabled: boolean) =>
    tab === "changes" ? (
      <InspectorChanges
        cwd={root}
        enabled={enabled}
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
    ) : tab === "review" ? (
      <InspectorReview
        cwd={root}
        enabled={enabled}
        onOpenDiff={props.onOpenDiff}
        onOpenAllChanges={props.onOpenAllChanges}
      />
    ) : tab === "checks" ? (
      <InspectorChecks
        cwd={root}
        enabled={enabled}
        textHarness={props.textHarness}
      />
    ) : props.filesSearchOpen ? (
      <InspectorSearch
        cwd={root}
        enabled={enabled}
        focusToken={props.searchFocusToken || 1}
        onOpenFile={props.onOpenFile}
        onClose={() => props.onFilesSearchOpenChange(false)}
      />
    ) : (
      <InspectorFiles
        cwd={root}
        enabled={enabled}
        onOpenFile={props.onOpenFile}
        onOpenTerminal={props.onOpenTerminal}
        onFileMoved={props.onFileMoved}
        onFileDeleted={props.onFileDeleted}
        onSearch={openSearch}
      />
    );

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
              {...(tab === "changes"
                ? { ref: changesTab, ...changesPeek.triggerProps }
                : {})}
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
        <ChangesPeekCard
          state={changesPeek}
          anchor={changesTab}
          cwd={props.gitCwd || props.cwd}
          stats={diffStats}
        />
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
          TABS.filter((tab) => visited.current.tabs.has(tab)).map((tab) => (
            <Activity
              key={`${root}:${tab}`}
              mode={tab === props.tab ? "visible" : "hidden"}
            >
              <SurfaceBoundary
                key={
                  tab === "files" && props.filesSearchOpen
                    ? "search"
                    : "default"
                }
                label={tab}
              >
                <Suspense
                  fallback={
                    <p
                      className="workspace-inspector-placeholder"
                      role="status"
                    >
                      Loading {tab}…
                    </p>
                  }
                >
                  {renderTab(tab, active && tab === props.tab)}
                </Suspense>
              </SurfaceBoundary>
            </Activity>
          ))
        )}
      </div>
      {hasProject ? (
        <ProjectScripts
          // One mount per project: its scripts are read as it mounts, so a
          // new copy of another project never sees the last one's setup.
          key={scriptsProject}
          project={scriptsProject}
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
