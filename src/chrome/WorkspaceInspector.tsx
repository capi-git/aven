import { lazy, memo, Suspense, useId, useRef, type KeyboardEvent } from "react";
import type { GitFileDiffKind, GitHistoryCommit } from "../lib/fs";
import type { OpenFileFn } from "../lib/search";
import type { HarnessId } from "../lib/session";
import { PanelRight, X } from "./icons";
import "./WorkspaceInspector.css";

export type WorkspaceInspectorTab = "files" | "changes";

export type WorkspaceInspectorProps = {
  /** False pauses work while retaining the last visible view for instant peeks. */
  active: boolean;
  cwd: string;
  gitCwd?: string;
  tab: WorkspaceInspectorTab;
  onTabChange: (tab: WorkspaceInspectorTab) => void;
  onClose: () => void;
  /** A temporary hover panel can become a persistent split. */
  onPin?: () => void;
  onOpenFile: OpenFileFn;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  onOpenDiff: (path: string, kind?: GitFileDiffKind) => void;
  onOpenAllChanges: () => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
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
  onShowSourceControl: () => void;
};

// Both the tree and its Git subscription load only when Files is visible.
// Search and Changes each replace it rather than leaving hidden trees mounted.
const InspectorFiles = lazy(async () => {
  const [{ FileTree }, { useGitFileStatuses }] = await Promise.all([
    import("./FileTree"),
    import("../hooks/useGitFileStatuses"),
  ]);
  return {
    default: function InspectorFilesContent(props: FilesProps) {
      const gitStatuses = useGitFileStatuses(props.cwd, props.enabled);
      const lastStatuses = useRef(gitStatuses);
      if (props.enabled) lastStatuses.current = gitStatuses;
      return <FileTree {...props} gitStatuses={lastStatuses.current} />;
    },
  };
});

const InspectorChanges = lazy(() =>
  import("./SourceControl").then(({ SourceControl }) => ({
    default: SourceControl,
  })),
);

const InspectorSearch = lazy(() =>
  import("./ProjectSearch").then(({ ProjectSearch }) => ({
    default: ProjectSearch,
  })),
);

const TABS = ["files", "changes"] as const;
const LABELS: Record<WorkspaceInspectorTab, string> = {
  files: "Files",
  changes: "Changes",
};

export const WorkspaceInspector = memo(function WorkspaceInspector(
  props: WorkspaceInspectorProps,
) {
  const id = useId();
  const active = props.active;
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
          : event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? TABS[(current + 1) % TABS.length]
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
      aria-label="Workspace inspector"
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
            </button>
          ))}
        </div>
        {props.onPin ? (
          <button
            type="button"
            className="workspace-inspector-close"
            aria-label="Pin inspector"
            title="Keep inspector open"
            onClick={props.onPin}
          >
            <PanelRight className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="workspace-inspector-close"
          aria-label="Hide inspector"
          title="Hide inspector"
          onClick={props.onClose}
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </button>
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
          <Suspense
            key={`${root}:${props.tab}:${props.filesSearchOpen && props.tab === "files" ? "search" : "default"}`}
            fallback={
              <p className="workspace-inspector-placeholder" role="status">
                Loading {props.tab === "changes" ? "changes" : "files"}…
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
                onOpenFile={props.onOpenDiff}
                onOpenAllChanges={props.onOpenAllChanges}
                onOpenCommit={props.onOpenCommit}
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
                onShowSourceControl={() => props.onTabChange("changes")}
              />
            )}
          </Suspense>
        )}
      </div>
    </section>
  );
});
