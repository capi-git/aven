import { ask } from "@tauri-apps/plugin-dialog";
import {
  changedImageGroup,
  imageViewerAvailable,
  openImageViewer,
} from "../lib/imageViewer";
import { openInAppUrl } from "../lib/inAppLinks";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  ExternalLink,
  FileDiff,
  FolderTree,
  GitMerge,
  GitPullRequest,
  ListBullet,
  Loader,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Ungroup,
} from "./icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FileTypeIcon } from "./FileTypeIcon";
import {
  GitHistoryGraph,
  GraphResizeSash,
  GRAPH_PANEL_DEFAULT,
  GRAPH_PANEL_MIN,
  loadGraphPanelHeight,
  saveGraphPanelHeight,
} from "./GitHistoryGraph";
import {
  basename,
  gitDiffIndex,
  gitDiffFiles,
  gitDiscardAll,
  gitDiscardFile,
  gitPrCreate,
  gitPrStatus,
  gitPush,
  gitStageAll,
  gitStageFile,
  gitSync,
  gitUnstageAll,
  gitUnstageFile,
  notifyGitChanged,
  subscribeGitChanged,
  type GitChangedFile,
  type GitDiffIndex,
  type GitFileDiffKind,
  type GitHistoryCommit,
  type GitPr,
} from "../lib/fs";
import type { HarnessId } from "../lib/session";
import {
  loadChangesView,
  saveChangesView,
  type ChangesView,
} from "../lib/appearance";
import { generatePrContent } from "../lib/harness";
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { applyProjectDiffStats } from "../hooks/useProjectDiffStats";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { currentCopyLabel, GitCopies } from "./GitCopies";
import { GitHousekeeping } from "./GitHousekeeping";
import { gitPrSquashMerge } from "../lib/gitHousekeeping";
import {
  isWindowActive,
  isWindowVisible,
  mayRefresh,
  subscribeWindowActivity,
  type RefreshReason,
} from "../lib/windowActivity";
import { errorText, logError } from "../lib/errors";
import { headCommit, useGitHistory } from "../hooks/useGitHistory";
import {
  changeKindFor,
  churnBar,
  discardPrompt,
  filesLabel,
  largestChurn,
  lineTotals,
  loadShowStaging,
  saveShowStaging,
} from "../lib/gitChangesView";
import { subscribeShipRequests, takeShipRequest } from "../lib/shipRequest";
import { ChangesHeader, CleanState } from "./GitChangesHeader";
import { ShipFlow } from "./ShipFlow";
import "./GitChangesPanel.css";

const GIT_POLL_MS = 2000;
/**
 * Each check runs several git commands. While nothing changes the panel
 * checks less often, up to this interval; a change, focus or the end of an
 * agent's turn brings it straight back to GIT_POLL_MS.
 */
const GIT_POLL_MAX_MS = 6000;
const GIT_SYNC_POLL_MS = 30_000;

function confirmNative(message: string, okLabel?: string): Promise<boolean> {
  return ask(message, {
    title: "Aven",
    kind: "warning",
    ...(okLabel ? { okLabel } : {}),
  });
}

/** An open Ship flow, and the conversation it describes when one was named. */
type ShipState = {
  sessionId?: string;
  /** When Ship it was pressed: each press starts the flow afresh. */
  opened?: number;
};

let stagedOpen = true;
let changesOpen = true;
let graphOpen = true;
let changesView: ChangesView = loadChangesView();
/** Folders the user collapsed in tree view, keyed `<kind>:<dir>`. */
const collapsedDirs = new Set<string>();
const indexByCwd = new Map<string, GitDiffIndex>();
const prByCwd = new Map<string, GitPr | null>();

type Props = {
  cwd: string;
  enabled: boolean;
  textHarness?: HarnessId;
  selectedPath?: string;
  selectedKind?: GitFileDiffKind;
  selectedSha?: string;
  /** The project folder, for its name and mark when `cwd` is another copy. */
  projectCwd?: string;
  onOpenFile: (path: string, kind: GitFileDiffKind) => void;
  /** Stacks the changes in one review: one side of them, or all without a kind. */
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
  /** Opens the branch switcher anchored to the header's branch button. */
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
};

export function GitChangesPanel({
  cwd,
  enabled,
  textHarness,
  selectedPath,
  selectedKind,
  selectedSha,
  projectCwd,
  onOpenFile,
  onOpenAllChanges,
  onOpenCommit,
  onOpenBranchPicker,
}: Props) {
  const { index, reload } = useDiffIndex(cwd, enabled);
  // Shared with the graph below, so the header's last commit adds no read.
  const history = useGitHistory(cwd, enabled);
  const lastCommit = headCommit(history);
  // Ages are worked out when the panel renders; nothing ticks on a clock.
  const now = Date.now();
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const onWorktrees = useCallback(
    (worktrees: Parameters<typeof currentCopyLabel>[0]) =>
      setCopyLabel(currentCopyLabel(worktrees)),
    [],
  );
  const files = useMemo(() => index?.files ?? [], [index]);
  // A changed picture opens in the image viewer, beside the others changed
  // with it (in its section, or every one from the single list); everything
  // else opens its diff.
  const openChange = useCallback(
    (path: string, kind: GitFileDiffKind, everyFile?: boolean) => {
      const group = imageViewerAvailable()
        ? changedImageGroup(files, path, everyFile ? undefined : kind)
        : null;
      if (!group || !openImageViewer(group)) onOpenFile(path, kind);
    },
    [files, onOpenFile],
  );
  // Nothing to commit: the history takes the space the file list would use.
  const clean = index !== null && files.length === 0;
  // No branch and no commits: not a Git repository, so there is no history.
  const noGit =
    clean && index?.branch === null && history.loaded && !history.head;
  const paneRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const [graphHeight, setGraphHeight] = useState(loadGraphPanelHeight);
  const [graphExpanded, setGraphExpanded] = useState(graphOpen);
  // Ship it: open from the button here, or from a request elsewhere (a
  // finished turn's changes in the chat) for this folder.
  const [ship, setShipState] = useState<ShipState | null>(null);
  // The Ship card takes the history's room when it opens, until the history
  // is opened again; the history's own setting is left as it was.
  const [historyYields, setHistoryYields] = useState(false);
  const setShip = useCallback((next: ShipState | null) => {
    setShipState(next);
    setHistoryYields(next !== null);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    const pick = () => {
      const request = takeShipRequest(cwd);
      if (!request) return;
      setShip({ sessionId: request.sessionId, opened: request.at });
      // Ship it reads the folder afresh, even with the window out of focus.
      reload();
    };
    pick();
    return subscribeShipRequests(pick);
  }, [cwd, enabled, setShip, reload]);
  const historyShown = graphExpanded && !(ship && historyYields);
  const showHistory = useCallback(() => {
    graphOpen = true;
    setGraphExpanded(true);
    setHistoryYields(false);
    window.requestAnimationFrame(() => {
      const graph = graphRef.current;
      graph?.scrollIntoView({ block: "nearest" });
      graph?.querySelector<HTMLButtonElement>(".git-history-item")?.focus();
    });
  }, []);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane || pane.clientHeight < GRAPH_PANEL_MIN + 160) return;
    const max = pane.clientHeight - 160;
    if (graphHeight > max) {
      setGraphHeight(max);
      saveGraphPanelHeight(max);
    }
  }, [graphHeight]);

  if (!cwd || cwd === "~") {
    return (
      <p className="px-3 py-2 text-ui-label text-content/50">
        No project folder
      </p>
    );
  }

  return (
    <div
      ref={paneRef}
      className="git-changes flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <ChangesHeader
        cwd={cwd}
        projectCwd={projectCwd}
        index={index}
        lastCommit={lastCommit}
        copyLabel={copyLabel}
        now={now}
        onOpenBranchPicker={onOpenBranchPicker}
        onOpenCommit={onOpenCommit}
      />
      <ChangedFiles
        cwd={cwd}
        projectCwd={projectCwd}
        textHarness={textHarness}
        index={index}
        files={files}
        selected={selectedPath}
        selectedKind={selectedKind}
        enabled={enabled}
        fill={!clean}
        lastCommit={lastCommit}
        now={now}
        noGit={noGit}
        ship={ship}
        onShipChange={setShip}
        onShowHistory={showHistory}
        onOpenBranchPicker={onOpenBranchPicker}
        onWorktrees={onWorktrees}
        onOpenFile={openChange}
        onOpenAllChanges={onOpenAllChanges}
        onMutated={(paths) => {
          reload();
          notifyGitChanged(cwd);
          invalidateWatchedFiles(paths);
          window.setTimeout(() => invalidateWatchedFiles(paths), 150);
        }}
      />
      {historyShown && !clean ? (
        <GraphResizeSash
          height={graphHeight}
          onHeightPaint={setGraphHeight}
          onHeightCommit={(next) => {
            setGraphHeight(next);
            saveGraphPanelHeight(next);
          }}
          maxHeight={() => {
            const pane = paneRef.current;
            if (!pane) return GRAPH_PANEL_DEFAULT * 2;
            return Math.max(GRAPH_PANEL_MIN, pane.clientHeight - 160);
          }}
        />
      ) : null}
      <div
        ref={graphRef}
        hidden={noGit}
        className={`overflow-hidden border-t border-content/10 ${
          !historyShown
            ? "h-7 shrink-0"
            : clean
              ? "min-h-40 flex-1"
              : "min-h-0 shrink-0"
        }`}
        style={historyShown && !clean ? { height: graphHeight } : undefined}
      >
        <GitHistoryGraph
          cwd={cwd}
          enabled={enabled}
          expanded={historyShown}
          selectedSha={selectedSha}
          branch={index ? index.branch : undefined}
          onToggleExpanded={() => {
            graphOpen = !historyShown;
            setGraphExpanded(graphOpen);
            setHistoryYields(false);
          }}
          onOpenCommit={onOpenCommit}
        />
      </div>
    </div>
  );
}

function ChangedFiles({
  cwd,
  projectCwd,
  textHarness,
  index,
  files,
  selected,
  selectedKind,
  enabled,
  fill,
  lastCommit,
  now,
  noGit,
  ship,
  onShipChange,
  onShowHistory,
  onOpenBranchPicker,
  onWorktrees,
  onOpenFile,
  onOpenAllChanges,
  onMutated,
}: {
  cwd: string;
  projectCwd?: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  files: GitChangedFile[];
  selected?: string;
  selectedKind?: GitFileDiffKind;
  enabled: boolean;
  fill: boolean;
  lastCommit: GitHistoryCommit | null;
  now: number;
  noGit: boolean;
  ship: ShipState | null;
  onShipChange: (ship: ShipState | null) => void;
  onShowHistory: () => void;
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  onWorktrees: (worktrees: Parameters<typeof currentCopyLabel>[0]) => void;
  onOpenFile: OpenChange;
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
  onMutated: (paths?: string[]) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const [busy, setBusy] = useState<string | null>(null);
  // Ship it's commit message. It is kept here, so a draft is still there when
  // Ship it is closed and opened again.
  const [message, setMessage] = useState("");
  const [stagedExpanded, setStagedExpanded] = useState(stagedOpen);
  const [changesExpanded, setChangesExpanded] = useState(changesOpen);
  const [view, setView] = useState<ChangesView>(changesView);
  // Off: one list of every changed file. On: Staged and Changes sections,
  // with buttons to stage and unstage.
  const [showStaging, setShowStaging] = useState(loadShowStaging);
  const { pr, reload: reloadPr } = usePrStatus(cwd, index?.branch, enabled);
  const staged = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstaged = useMemo(
    () => files.filter((file) => file.unstaged),
    [files],
  );
  const largest = useMemo(() => largestChurn(files), [files]);
  const totals = useMemo(() => lineTotals(files), [files]);
  // A new Ship it starts a fresh flow, replacing a finished one's "Shipped"
  // card, but never interrupts a ship that is still running.
  const shipKey = useRef(0);
  if (ship && busy !== "ship") shipKey.current = ship.opened ?? 0;
  const onShipBusy = useCallback((shipping: boolean) => {
    setBusy((current) =>
      shipping ? (current ?? "ship") : current === "ship" ? null : current,
    );
  }, []);
  const hasRemote = Boolean(index?.remote);
  const hasOpenPr = pr?.state === "open";
  const diverged = (index?.ahead ?? 0) > 0 && (index?.behind ?? 0) > 0;
  const onDefault =
    !!index?.branch &&
    !!index.defaultBranch &&
    index.branch === index.defaultBranch;
  const canCreatePr =
    hasRemote &&
    !hasOpenPr &&
    !onDefault &&
    !diverged &&
    files.length === 0 &&
    (index?.aheadOfDefault ?? 0) > 0 &&
    (index?.behind ?? 0) === 0;
  const canViewPr = hasOpenPr && !!pr?.url;
  const canPublish = hasRemote && !index?.upstream;
  const canSync =
    hasRemote &&
    Boolean(index?.upstream) &&
    ((index?.ahead ?? 0) > 0 || (index?.behind ?? 0) > 0);

  const toggleView = () => {
    changesView = view === "tree" ? "list" : "tree";
    saveChangesView(changesView);
    setView(changesView);
  };

  const toggleStaging = () => {
    saveShowStaging(!showStaging);
    setShowStaging(!showStaging);
  };

  const fail = (error: unknown) => {
    logError("source control", error);
    window.alert(errorText(error));
  };

  const confirmDefault = async (kind: "push" | "pr") => {
    if (!onDefault || !index?.branch) return true;
    const branch = index.branch;
    return confirmNative(
      kind === "pr"
        ? `Create a pull request from default branch "${branch}"?`
        : `Push to default branch "${branch}"?`,
    );
  };

  /**
   * Stage, unstage or discard one file. `whole` is the single list's discard:
   * the file goes back to its last commit, staged changes included. The
   * Changes section's discard leaves staged changes alone.
   */
  const run = async (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
    whole = false,
  ) => {
    if (busy) return;
    if (action === "discard") {
      const prompt = discardPrompt([file], whole);
      if (!prompt || !(await confirmNative(prompt.message, prompt.okLabel)))
        return;
    }
    setBusy(file.relative);
    try {
      if (action === "stage") await gitStageFile(cwd, file.relative);
      else if (action === "unstage") await gitUnstageFile(cwd, file.relative);
      else {
        // Unstaged first, even when the list shows nothing staged: something
        // may have been staged since it last refreshed. If the discard then
        // fails, the file is still there.
        if (whole) await gitUnstageFile(cwd, file.relative);
        await gitDiscardFile(cwd, file.relative);
      }
      onMutated([file.path]);
    } catch (error) {
      fail(error);
      onMutated([file.path]);
    } finally {
      setBusy(null);
    }
  };

  const runAll = async (
    action: "stage" | "unstage" | "discard",
    whole = false,
  ) => {
    if (busy) return;
    // The single list discards every file; the Changes section only what
    // is unstaged.
    const discarded = whole ? files : unstaged;
    if (action === "discard") {
      const prompt = discardPrompt(discarded, whole);
      if (!prompt || !(await confirmNative(prompt.message, prompt.okLabel)))
        return;
    }
    const paths =
      action === "discard" ? discarded.map((file) => file.path) : undefined;
    setBusy(action);
    try {
      if (action === "stage") await gitStageAll(cwd);
      else if (action === "unstage") await gitUnstageAll(cwd);
      else {
        if (whole) await gitUnstageAll(cwd);
        await gitDiscardAll(cwd);
      }
      onMutated(paths);
    } catch (error) {
      fail(error);
      onMutated(paths);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!index || !(canSync || canPublish)) return;
    setBusy("sync");
    try {
      await gitSync(cwd);
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const openCreatedPr = async () => {
    const content = await generatePrContent(cwd, textHarness);
    if (!content) throw new Error("Could not prepare pull request content");
    const url = await gitPrCreate(
      cwd,
      content.title,
      content.body,
      content.base,
      content.head,
    );
    await openInAppUrl(url.trim());
  };

  const mergePr = async () => {
    if (!hasOpenPr || !pr || busy) return;
    const base = index?.defaultBranch ?? "the default branch";
    const ok = await confirmNative(
      `Squash and merge PR #${pr.number} into ${base}? Its commits become one commit, and GitHub deletes the branch afterwards.`,
      "Squash and merge",
    );
    if (!ok) return;
    setBusy("merge");
    try {
      await gitPrSquashMerge(cwd, pr.number);
      onMutated();
      notifyGitChanged(cwd);
      reloadPr();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const createPr = async () => {
    if (!canCreatePr) return;
    if (!(await confirmDefault("pr"))) return;
    setBusy("pr");
    try {
      if ((index?.ahead ?? 0) > 0) await gitPush(cwd);
      await openCreatedPr();
      onMutated();
      reloadPr();
    } catch (error) {
      fail(error);
      onMutated();
    } finally {
      setBusy(null);
    }
  };

  const stagingToggle: SectionAction = {
    title: showStaging ? "Hide staging" : "Show staging",
    icon: <Ungroup className="size-3.5" strokeWidth={1.75} />,
    pressed: showStaging,
    onClick: toggleStaging,
  };
  const rowProps = {
    view,
    largest,
    selected,
    selectedKind,
    busy,
    onOpenFile,
  };

  return (
    <aside
      className={`flex min-h-0 min-w-0 flex-col ${fill ? "flex-1" : "shrink"}`}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-content/10 p-2">
        {ship && index ? (
          <ShipFlow
            key={shipKey.current}
            cwd={cwd}
            index={index}
            files={files}
            pr={pr}
            enabled={enabled}
            textHarness={textHarness}
            sessionId={ship.sessionId}
            stagingShown={showStaging}
            message={message}
            onMessageChange={setMessage}
            onBusyChange={onShipBusy}
            onMutated={onMutated}
            onPrChanged={reloadPr}
            onClose={() => onShipChange(null)}
          />
        ) : files.length === 0 && index ? (
          <CleanState
            cwd={cwd}
            projectCwd={projectCwd}
            {...gitStatusSummary(index)}
            noGit={noGit}
            lastCommit={lastCommit}
            now={now}
            onShowHistory={onShowHistory}
            onOpenBranchPicker={onOpenBranchPicker}
          />
        ) : files.length > 0 ? (
          <ShipBar
            files={files.length}
            additions={totals.additions}
            deletions={totals.deletions}
            disabled={!!busy}
            onShip={() => onShipChange({ opened: Date.now() })}
          />
        ) : null}
        {index && !ship ? (
          <GitSyncActions
            index={index}
            dirty={files.length > 0}
            pr={pr}
            busy={busy}
            hasRemote={hasRemote}
            hasOpenPr={hasOpenPr}
            onDefault={onDefault}
            canSync={canSync}
            canPublish={canPublish}
            canCreatePr={canCreatePr}
            canViewPr={canViewPr}
            onSync={() => void sync()}
            onCreatePr={() => void createPr()}
            onMergePr={() => void mergePr()}
            onViewPr={() => {
              if (pr?.url) void openInAppUrl(pr.url);
            }}
          />
        ) : null}
      </div>
      <div
        ref={lockOverscroll}
        className={`min-h-0 overflow-y-auto overscroll-none py-1 ${
          fill ? "flex-1" : "shrink"
        }`}
      >
        {files.length === 0 ? (
          index ? null : (
            <p className="px-3 py-2 text-ui-label text-content/45">
              Loading changes…
            </p>
          )
        ) : showStaging ? (
          <>
            {staged.length > 0 ? (
              <FileSection
                title="Staged"
                count={staged.length}
                totals={lineTotals(staged)}
                open={stagedExpanded}
                onToggle={() => {
                  stagedOpen = !stagedExpanded;
                  setStagedExpanded(stagedOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  stagingToggle,
                  {
                    title: "Open All Changes",
                    icon: <FileDiff className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => onOpenAllChanges("staged"),
                  },
                  {
                    title: "Unstage All Changes",
                    icon: <Minus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("unstage"),
                  },
                ]}
              >
                <ChangeList
                  files={staged}
                  kind="staged"
                  {...rowProps}
                  onAction={(file, action) => void run(file, action)}
                />
              </FileSection>
            ) : null}
            {unstaged.length > 0 ? (
              <FileSection
                title="Changes"
                count={unstaged.length}
                totals={lineTotals(unstaged)}
                open={changesExpanded}
                onToggle={() => {
                  changesOpen = !changesExpanded;
                  setChangesExpanded(changesOpen);
                }}
                view={view}
                onToggleView={toggleView}
                headerActions={[
                  // The toggle sits in the first section's header.
                  ...(staged.length > 0 ? [] : [stagingToggle]),
                  {
                    title: "Open All Changes",
                    icon: <FileDiff className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => onOpenAllChanges("unstaged"),
                  },
                  {
                    title: "Discard All Changes",
                    icon: <Undo2 className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("discard"),
                  },
                  {
                    title: "Stage All Changes",
                    icon: <Plus className="size-3.5" strokeWidth={1.75} />,
                    onClick: () => void runAll("stage"),
                  },
                ]}
              >
                <ChangeList
                  files={unstaged}
                  kind="unstaged"
                  {...rowProps}
                  onAction={(file, action) => void run(file, action)}
                />
              </FileSection>
            ) : null}
          </>
        ) : (
          <FileSection
            title="Changes"
            count={files.length}
            totals={totals}
            open={changesExpanded}
            onToggle={() => {
              changesOpen = !changesExpanded;
              setChangesExpanded(changesOpen);
            }}
            view={view}
            onToggleView={toggleView}
            headerActions={[
              stagingToggle,
              {
                title: "Open All Changes",
                icon: <FileDiff className="size-3.5" strokeWidth={1.75} />,
                onClick: () => onOpenAllChanges(),
              },
              {
                title: "Discard All Changes",
                icon: <Undo2 className="size-3.5" strokeWidth={1.75} />,
                onClick: () => void runAll("discard", true),
              },
            ]}
          >
            <ChangeList
              files={files}
              kind="all"
              {...rowProps}
              onAction={(file, action) => void run(file, action, true)}
            />
          </FileSection>
        )}
        <GitCopies
          cwd={cwd}
          enabled={enabled}
          projectCwd={projectCwd}
          base={index?.defaultBranch ?? undefined}
          textHarness={textHarness}
          onWorktrees={onWorktrees}
        />
        <GitHousekeeping cwd={cwd} enabled={enabled} />
      </div>
    </aside>
  );
}

function usePrStatus(
  cwd: string,
  branch: string | null | undefined,
  enabled: boolean,
): { pr: GitPr | null; reload: () => void } {
  const [pr, setPr] = useState<GitPr | null>(() => cachedPr(cwd, branch));
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    if (!cwd || cwd === "~" || !branch) {
      setPr(null);
      return;
    }
    setPr(cachedPr(cwd, branch));
    let cancelled = false;
    let request = 0;
    // Opening the panel and a reload (after Ship it) read while the window is
    // on screen; coming back to the window reads again (see `mayRefresh`).
    const load = (reason: RefreshReason) => {
      if (cancelled || !mayRefresh(reason)) return;
      const current = ++request;
      const stale = () =>
        cancelled || current !== request || !isWindowVisible();
      void gitPrStatus(cwd)
        .then((next) => {
          if (stale()) return;
          prByCwd.set(cwd, next);
          setPr(next);
        })
        .catch(() => {
          if (stale()) return;
          prByCwd.set(cwd, null);
          setPr(null);
        });
    };
    const unsubscribe = subscribeWindowActivity(() => load("poll"));
    load("event");
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [branch, cwd, enabled, nonce]);

  return { pr, reload };
}

function cachedPr(
  cwd: string,
  branch: string | null | undefined,
): GitPr | null {
  if (!cwd || cwd === "~" || !branch) return null;
  return prByCwd.get(cwd) ?? null;
}

/** One-line state of a folder with nothing to commit. */
export function gitStatusSummary(index: GitDiffIndex): {
  tone: "ok" | "info" | "neutral";
  title: string;
  detail: string;
} {
  const branch = index.branch ?? "This copy";
  if (!index.remote)
    return { tone: "neutral", title: "Nothing to commit", detail: branch };
  if (!index.upstream)
    return {
      tone: "info",
      title: `${branch} isn't on ${index.remote} yet`,
      detail: "Nothing to commit. Publish it to share it.",
    };
  if (index.ahead > 0 || index.behind > 0)
    return {
      tone: "info",
      title: syncStatusLabel(index),
      detail: `${branch} · nothing to commit`,
    };
  return {
    tone: "ok",
    title: `${branch} is clean and up to date`,
    detail: `Matches ${index.upstream}`,
  };
}

function syncStatusLabel(index: GitDiffIndex): string {
  if (index.ahead > 0 && index.behind > 0) {
    return `Diverged from ${index.upstream ?? "upstream"}`;
  }
  if (index.ahead > 0) {
    const n = index.ahead;
    return `${n} unpushed commit${n === 1 ? "" : "s"}`;
  }
  if (index.behind > 0) {
    const n = index.behind;
    return `${n} incoming commit${n === 1 ? "" : "s"}`;
  }
  return "No files";
}

function GitSyncActions({
  index,
  dirty,
  pr,
  busy,
  hasRemote,
  hasOpenPr,
  onDefault,
  canSync,
  canPublish,
  canCreatePr,
  canViewPr,
  onSync,
  onCreatePr,
  onMergePr,
  onViewPr,
}: {
  index: GitDiffIndex;
  /**
   * Uncommitted files. Ship it then commits and opens the pull request, so
   * Create PR waits for them. Publishing and syncing stay offered: commits
   * already made can be pushed without committing the files first.
   */
  dirty: boolean;
  pr: GitPr | null;
  busy: string | null;
  hasRemote: boolean;
  hasOpenPr: boolean;
  onDefault: boolean;
  canSync: boolean;
  canPublish: boolean;
  canCreatePr: boolean;
  canViewPr: boolean;
  onSync: () => void;
  onCreatePr: () => void;
  onMergePr: () => void;
  onViewPr: () => void;
}) {
  if (!hasRemote) return null;
  const ahead = index.ahead;
  const behind = index.behind;
  const dest =
    index.upstream ?? `${index.remote ?? "origin"}/${index.branch ?? "HEAD"}`;
  const syncing = busy === "sync";
  const syncTitle = syncing
    ? "Synchronizing changes…"
    : canPublish
      ? index.branch
        ? `Publish Branch "${index.branch}"`
        : "Publish Branch"
      : behind > 0 && ahead > 0
        ? `Pull ${behind} and push ${ahead} commits between ${dest}`
        : behind > 0
          ? `Pull ${behind} commit${behind === 1 ? "" : "s"} from ${dest}`
          : `Push ${ahead} commit${ahead === 1 ? "" : "s"} to ${dest}`;
  const createTitle = index.defaultBranch
    ? `Create a pull request into ${index.defaultBranch}`
    : "Create pull request";
  const viewTitle = pr?.title
    ? `View PR #${pr.number}: ${pr.title}`
    : "View pull request";
  const btn =
    "flex h-7 w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-ui-label font-medium disabled:opacity-40";
  const secondary = `${btn} bg-(--aven-control-bg) text-content hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)`;
  const showPublish = canPublish;
  const showSync = canSync;
  const showCreatePr = !hasOpenPr && !onDefault && !dirty;
  const showViewPr = hasOpenPr;
  if (!showPublish && !showSync && !showCreatePr && !showViewPr) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {showPublish ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          {syncing ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <CloudUpload className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate">Publish Branch</span>
        </button>
      ) : showSync ? (
        <button
          type="button"
          title={syncTitle}
          disabled={!!busy}
          onClick={onSync}
          className={secondary}
        >
          <RefreshCw
            className={`size-3.5 shrink-0 ${syncing ? "animate-spin" : ""}`}
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate">Sync Changes</span>
          {behind > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↓{behind}
            </span>
          ) : null}
          {ahead > 0 ? (
            <span className="shrink-0 tabular-nums text-content/55">
              ↑{ahead}
            </span>
          ) : null}
        </button>
      ) : null}
      {showCreatePr ? (
        <button
          type="button"
          title={createTitle}
          disabled={!canCreatePr || !!busy}
          onClick={onCreatePr}
          className={secondary}
        >
          {busy === "pr" ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <GitPullRequest className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          Create PR
        </button>
      ) : null}
      {showViewPr ? (
        <button
          type="button"
          title={viewTitle}
          disabled={!canViewPr || !!busy}
          onClick={onViewPr}
          className={secondary}
        >
          <ExternalLink className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 truncate">
            {pr?.number ? `View PR #${pr.number}` : "View PR"}
          </span>
        </button>
      ) : null}
      {showViewPr ? (
        <button
          type="button"
          title={
            index.defaultBranch
              ? `Squash this pull request into one commit on ${index.defaultBranch}`
              : "Squash and merge this pull request"
          }
          disabled={!!busy}
          onClick={onMergePr}
          className={secondary}
        >
          {busy === "merge" ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <GitMerge className="size-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <span className="min-w-0 truncate">Squash and merge</span>
        </button>
      ) : null}
    </div>
  );
}

/** What changed in this copy, and the way to ship it. */
function ShipBar({
  files,
  additions,
  deletions,
  disabled,
  onShip,
}: {
  files: number;
  additions: number;
  deletions: number;
  disabled: boolean;
  onShip: () => void;
}) {
  const lines = additions + deletions;
  return (
    <div className="git-ship-bar">
      <div className="git-ship-stats">
        <span
          className="git-ship-stats-line"
          aria-label={`${filesLabel(files)} changed, ${additions} added lines, ${deletions} deleted lines`}
        >
          <span>{filesLabel(files)}</span>
          <span className="git-add">+{additions}</span>
          <span className="git-del">−{deletions}</span>
        </span>
        {lines > 0 ? (
          <span className="git-ship-meter" aria-hidden>
            <span style={{ flexGrow: additions }} />
            <span style={{ flexGrow: deletions }} />
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="git-ship-button"
        disabled={disabled}
        title="Commit these changes, and choose whether to push them or open a pull request"
        onClick={onShip}
      >
        <ArrowUp className="size-3.5" strokeWidth={2} />
        Ship it
      </button>
    </div>
  );
}

/** A button in a file section's header; `pressed` marks a toggle that is on. */
type SectionAction = {
  title: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick: () => void;
};

function FileSection({
  title,
  count,
  totals,
  open,
  onToggle,
  view,
  onToggleView,
  headerActions,
  children,
}: {
  title: string;
  count: number;
  totals: { additions: number; deletions: number };
  open: boolean;
  onToggle: () => void;
  view: ChangesView;
  onToggleView: () => void;
  headerActions: SectionAction[];
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex h-7 items-center gap-1 px-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          ) : (
            <ChevronRight
              className="size-3.5 shrink-0 text-content/50"
              strokeWidth={1.75}
            />
          )}
          <span className="min-w-0 truncate text-ui-micro font-semibold tracking-[0.04em] text-content/55 uppercase">
            {title}
          </span>
          <span className="ml-1 grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-content/12 px-1 text-ui-micro tabular-nums text-content/75">
            {count}
          </span>
          {totals.additions > 0 || totals.deletions > 0 ? (
            <span className="git-section-total shrink-0">
              <span className="git-add">+{totals.additions}</span>{" "}
              <span className="git-del">−{totals.deletions}</span>
            </span>
          ) : null}
        </button>
        <IconAction
          title={view === "tree" ? "View as List" : "View as Tree"}
          onClick={onToggleView}
        >
          {view === "tree" ? (
            <ListBullet className="size-3.5" strokeWidth={1.75} />
          ) : (
            <FolderTree className="size-3.5" strokeWidth={1.75} />
          )}
        </IconAction>
        {headerActions.map((action) => (
          <IconAction
            key={action.title}
            title={action.title}
            pressed={action.pressed}
            onClick={action.onClick}
          >
            {action.icon}
          </IconAction>
        ))}
      </div>
      {open ? <ul>{children}</ul> : null}
    </div>
  );
}

type ChangeDir = {
  name: string;
  /** Path relative to the repo root; "" for the implicit root. */
  path: string;
  dirs: ChangeDir[];
  files: GitChangedFile[];
  /** Status shared by every descendant, or null when they differ. */
  status: string | null;
};

/**
 * Opens a changed file's diff. `everyFile` comes from the single list, where a
 * picture opens beside every changed picture rather than one section's.
 */
type OpenChange = (
  path: string,
  kind: GitFileDiffKind,
  everyFile?: boolean,
) => void;

/** One side of staging, or "all": every changed file once, in a single list. */
type ListKind = GitFileDiffKind | "all";

type ChangeRowProps = {
  files: GitChangedFile[];
  view: ChangesView;
  kind: ListKind;
  /** Most changed lines in any file shown, which sizes each row's bar. */
  largest: number;
  selected?: string;
  selectedKind?: GitFileDiffKind;
  busy: string | null;
  onOpenFile: OpenChange;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
};

function ChangeList({ files, view, ...rest }: ChangeRowProps) {
  const tree = useMemo(() => buildChangeTree(files), [files]);
  if (view === "tree") {
    return <ChangeDirChildren dir={tree} depth={0} {...rest} />;
  }
  return (
    <>
      {files.map((file) => (
        <ChangeRow
          key={`${rest.kind}:${file.relative}`}
          file={file}
          active={isActive(file, rest.selected, rest.selectedKind, rest.kind)}
          busy={rest.busy === file.relative}
          kind={rest.kind}
          largest={rest.largest}
          onOpenFile={rest.onOpenFile}
          onAction={rest.onAction}
        />
      ))}
    </>
  );
}

function ChangeDirChildren({
  dir,
  depth,
  kind,
  largest,
  selected,
  selectedKind,
  busy,
  onOpenFile,
  onAction,
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  return (
    <>
      {dir.dirs.map((child) => (
        <ChangeDirRow
          key={child.path}
          dir={child}
          depth={depth}
          kind={kind}
          largest={largest}
          selected={selected}
          selectedKind={selectedKind}
          busy={busy}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
      {dir.files.map((file) => (
        <ChangeRow
          key={`${kind}:${file.relative}`}
          file={file}
          active={isActive(file, selected, selectedKind, kind)}
          busy={busy === file.relative}
          kind={kind}
          largest={largest}
          depth={depth}
          onOpenFile={onOpenFile}
          onAction={onAction}
        />
      ))}
    </>
  );
}

function ChangeDirRow({
  dir,
  depth,
  kind,
  ...rest
}: Omit<ChangeRowProps, "files" | "view"> & {
  dir: ChangeDir;
  depth: number;
}) {
  const key = `${kind}:${dir.path}`;
  const [open, setOpen] = useState(() => !collapsedDirs.has(key));
  const toggle = () => {
    if (open) collapsedDirs.add(key);
    else collapsedDirs.delete(key);
    setOpen(!open);
  };
  return (
    <li>
      <button
        type="button"
        title={dir.path}
        aria-expanded={open}
        onClick={toggle}
        style={{ paddingLeft: 8 + depth * 12 }}
        className="flex h-6.5 w-full items-center gap-1.5 pr-2 text-left leading-none text-content hover:bg-(--aven-hover)"
      >
        <span className="grid size-4 shrink-0 place-items-center text-content/50">
          {open ? (
            <ChevronDown className="size-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          )}
        </span>
        <FileTypeIcon name={dir.name} isDir isOpen={open} size={16} />
        <span className="min-w-0 flex-1 truncate text-ui-body font-medium">
          {dir.name}
        </span>
        <span
          className={`grid w-3.5 shrink-0 place-items-center ${
            dir.status ? statusColor(dir.status) : "text-content/40"
          }`}
          aria-hidden
        >
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      </button>
      {open ? (
        <ul>
          <ChangeDirChildren
            dir={dir}
            depth={depth + 1}
            kind={kind}
            {...rest}
          />
        </ul>
      ) : null}
    </li>
  );
}

function isActive(
  file: GitChangedFile,
  selected: string | undefined,
  selectedKind: GitFileDiffKind | undefined,
  kind: ListKind,
): boolean {
  if (selected !== file.relative) return false;
  return kind === "all" || !selectedKind || selectedKind === kind;
}

/** Nests changed files under their directories, VS Code's tree view. */
function buildChangeTree(files: GitChangedFile[]): ChangeDir {
  const root: ChangeDir = {
    name: "",
    path: "",
    dirs: [],
    files: [],
    status: null,
  };
  for (const file of files) {
    const segments = file.relative.split("/");
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      const path = node.path ? `${node.path}/${segment}` : segment;
      let next = node.dirs.find((dir) => dir.path === path);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [], status: null };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  sortChangeDir(root);
  return root;
}

/** Sorts each level (folders first) and rolls descendant status upward. */
function sortChangeDir(dir: ChangeDir): string | null {
  dir.dirs.sort((a, b) => a.name.localeCompare(b.name));
  dir.files.sort((a, b) =>
    basename(a.relative).localeCompare(basename(b.relative)),
  );
  let status: string | null = null;
  let mixed = false;
  const merge = (next: string | null) => {
    if (next === null) mixed = true;
    else if (status === null) status = next;
    else if (status !== next) mixed = true;
  };
  for (const child of dir.dirs) merge(sortChangeDir(child));
  for (const file of dir.files) merge(file.status);
  dir.status = mixed ? null : status;
  return dir.status;
}

function ChangeRow({
  file,
  active,
  busy,
  kind,
  largest,
  depth,
  onOpenFile,
  onAction,
}: {
  file: GitChangedFile;
  active: boolean;
  busy: boolean;
  kind: ListKind;
  largest: number;
  /** Set in tree view: nesting level, and the folder path moves to the tree. */
  depth?: number;
  onOpenFile: OpenChange;
  onAction: (
    file: GitChangedFile,
    action: "stage" | "unstage" | "discard",
  ) => void;
}) {
  const name = basename(file.relative);
  const tree = depth !== undefined;
  const dir = tree ? "" : dirname(file.relative);
  const canOpen = file.status !== "deleted";
  const bar = churnBar(file, largest);
  const single = kind === "all";
  // The single list keeps a quiet mark on staged files, so nothing staged is
  // out of sight while staging is hidden.
  const stagedNote =
    !single || !file.staged ? "" : file.unstaged ? "partly staged" : "staged";
  return (
    <li>
      <div
        style={tree ? { paddingLeft: 8 + depth * 12 } : undefined}
        className={`group flex h-6.5 w-full items-center gap-1 pr-2 leading-none ${
          tree ? "" : "pl-2"
        } ${
          active
            ? "bg-(--aven-selected) text-content"
            : "text-content hover:bg-(--aven-hover)"
        }`}
      >
        <button
          type="button"
          title={
            stagedNote ? `${file.relative} (${stagedNote})` : file.relative
          }
          onClick={() => {
            if (canOpen)
              onOpenFile(
                file.path,
                single ? changeKindFor(file) : kind,
                single,
              );
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {tree ? <span className="size-4 shrink-0" /> : null}
          <FileTypeIcon name={name} isDir={false} size={16} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-ui-body font-medium">{name}</span>
            {dir ? (
              <span className="ml-1.5 text-ui-caption text-content/40">
                {dir}
              </span>
            ) : null}
            {stagedNote ? (
              <span className="sr-only">, {stagedNote}</span>
            ) : null}
          </span>
        </button>
        {file.additions > 0 || file.deletions > 0 ? (
          <span
            className="git-file-stats"
            data-active={active || undefined}
            aria-label={`${file.additions} added, ${file.deletions} deleted`}
          >
            {file.additions > 0 ? (
              <span className="git-add">+{file.additions}</span>
            ) : null}
            {file.deletions > 0 ? (
              <span className="git-del">−{file.deletions}</span>
            ) : null}
            {bar ? (
              <span className="git-file-bar" aria-hidden>
                <span style={{ width: `${Math.round(bar.size * 100)}%` }}>
                  <span style={{ flexGrow: bar.added }} />
                  <span style={{ flexGrow: 1 - bar.added }} />
                </span>
              </span>
            ) : null}
          </span>
        ) : null}
        <div
          className={` shrink-0 items-center ${
            active ? "flex" : "hidden group-focus-within:flex group-hover:flex"
          }`}
        >
          {kind !== "staged" ? (
            <IconAction
              title="Discard Changes"
              disabled={busy}
              onClick={() => onAction(file, "discard")}
            >
              <Undo2 className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : null}
          {kind === "staged" ? (
            <IconAction
              title="Unstage Changes"
              disabled={busy}
              onClick={() => onAction(file, "unstage")}
            >
              <Minus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : kind === "unstaged" ? (
            <IconAction
              title="Stage Changes"
              disabled={busy}
              onClick={() => onAction(file, "stage")}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </IconAction>
          ) : null}
        </div>
        <span
          className={`relative w-3.5 shrink-0 text-right font-mono text-ui-caption font-semibold ${statusColor(file.status)}`}
        >
          {stagedNote ? (
            <span
              data-staged-mark
              className="absolute top-1/2 left-0 size-1 -translate-y-1/2 rounded-full bg-current"
              aria-hidden
            />
          ) : null}
          {statusLetter(file.status)}
        </span>
      </div>
    </li>
  );
}

function IconAction({
  title,
  disabled,
  pressed,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  /** A toggle's state; leave out for a plain button. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-content/55 hover:bg-content/10 hover:text-content disabled:opacity-40 aria-pressed:bg-content/10 aria-pressed:text-content"
    >
      {children}
    </button>
  );
}

function dirname(relative: string): string {
  const i = relative.lastIndexOf("/");
  return i > 0 ? relative.slice(0, i) : "";
}

function statusLetter(status: string): string {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  return "M";
}

function statusColor(status: string): string {
  if (status === "untracked") return "text-sky-400";
  if (status === "added") return "text-emerald-400";
  if (status === "deleted") return "text-red-400";
  return "text-amber-400";
}

function useDiffIndex(
  cwd: string,
  enabled: boolean,
): {
  index: GitDiffIndex | null;
  reload: () => void;
} {
  const [index, setIndex] = useState<GitDiffIndex | null>(() =>
    cachedIndex(cwd),
  );
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      return;
    }
    const cached = cachedIndex(cwd);
    if (cached && !sameIndex(indexRef.current, cached)) {
      indexRef.current = cached;
      setIndex(cached);
    }
    let cancelled = false;
    let inFlight = false;
    let pending = false;
    let pendingSync = false;
    // A queued read keeps the strongest reason it was asked for.
    let pendingReason: RefreshReason = "poll";
    let publishing = false;
    let lastSync = 0;
    // Checks in a row that found nothing new; spaces the next check out.
    let quietPolls = 0;
    let visible = isWindowVisible();
    const dropPending = () => {
      pending = false;
      pendingSync = false;
      pendingReason = "poll";
    };

    // An event (Git changed, a turn ended, Ship it, opening the panel) reads
    // whenever the window is on screen; the periodic check only while it has
    // focus (see `mayRefresh`).
    const load = async (forceSync = false, reason: RefreshReason = "poll") => {
      if (cancelled || !mayRefresh(reason)) {
        if (!isWindowVisible()) dropPending();
        return;
      }
      if (inFlight) {
        pending = true;
        pendingSync ||= forceSync;
        if (reason === "event") pendingReason = "event";
        return;
      }
      inFlight = true;
      try {
        const prev = indexRef.current;
        const sync =
          forceSync || !prev || Date.now() - lastSync >= GIT_SYNC_POLL_MS;
        let next = await (sync ? gitDiffIndex(cwd) : gitDiffFiles(cwd));
        if (cancelled || !mayRefresh(reason)) return;
        if (sync) lastSync = Date.now();
        else if (prev && next.branch === prev.branch) {
          // The cheap status command omits remote and divergence metadata.
          next = {
            ...prev,
            files: next.files,
            additions: next.additions,
            deletions: next.deletions,
          };
        } else {
          // An external checkout must not show the previous branch's sync state.
          next = await gitDiffIndex(cwd);
          if (cancelled || !mayRefresh(reason)) return;
          lastSync = Date.now();
        }
        if (sameIndex(prev, next)) {
          quietPolls += 1;
          return;
        }
        quietPolls = 0;
        indexByCwd.set(cwd, next);
        indexRef.current = next;
        setIndex(next);
        applyProjectDiffStats(cwd, {
          files: next.files.length,
          additions: next.additions,
          deletions: next.deletions,
        });
        if (prev) {
          const paths = changedFilePaths(prev, next);
          invalidateWatchedFiles(paths);
          publishing = true;
          try {
            notifyGitChanged(cwd);
          } finally {
            publishing = false;
          }
        }
      } catch {
        if (!cancelled && mayRefresh(reason)) {
          indexByCwd.delete(cwd);
          indexRef.current = null;
          setIndex(null);
        }
      } finally {
        inFlight = false;
        if (pending) {
          const sync = pendingSync;
          const next = pendingReason;
          dropPending();
          if (!cancelled && mayRefresh(next)) void load(sync, next);
        }
      }
    };

    let timer: number | null = null;
    const stopPolling = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      if (cancelled || timer !== null || !mayRefresh("poll")) return;
      // The first quiet check keeps the usual pace; later ones slow down.
      const delay = Math.min(
        GIT_POLL_MS * 1.5 ** Math.max(0, quietPolls - 1),
        GIT_POLL_MAX_MS,
      );
      timer = window.setTimeout(() => {
        timer = null;
        void load().finally(schedule);
      }, delay);
    };
    /** Read in full now; polling resumes after it only while focused. */
    const checkNow = () => {
      quietPolls = 0;
      stopPolling();
      void load(true, "event").finally(schedule);
    };
    const onActivity = () => {
      if (cancelled) return;
      const wasVisible = visible;
      visible = isWindowVisible();
      if (!visible) {
        dropPending();
        stopPolling();
        return;
      }
      if (isWindowActive()) {
        checkNow();
        return;
      }
      // On screen without focus: polling rests, but a window that comes
      // back on screen reads once what changed while it was hidden.
      stopPolling();
      if (!wasVisible) checkNow();
    };
    const unsubActivity = subscribeWindowActivity(onActivity);
    const unsubGit = subscribeGitChanged(() => {
      // Notify sibling panels without feeding our own poll back into a full refresh.
      if (!publishing) checkNow();
    });
    // Opening (or reloading) the panel reads once if the window is on screen.
    if (visible) checkNow();
    return () => {
      cancelled = true;
      pending = false;
      pendingSync = false;
      stopPolling();
      unsubActivity();
      unsubGit();
    };
  }, [cwd, enabled, nonce]);

  return { index, reload };
}

function cachedIndex(cwd: string | undefined): GitDiffIndex | null {
  if (!cwd || cwd === "~") return null;
  return indexByCwd.get(cwd) ?? null;
}

function changedFilePaths(prev: GitDiffIndex, next: GitDiffIndex): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const previous = new Map(prev.files.map((file) => [file.relative, file]));
  const current = new Set(next.files.map((file) => file.relative));
  for (const file of next.files) {
    const before = previous.get(file.relative);
    if (
      !before ||
      before.status !== file.status ||
      before.additions !== file.additions ||
      before.deletions !== file.deletions ||
      before.staged !== file.staged ||
      before.unstaged !== file.unstaged
    ) {
      paths.push(file.path);
      seen.add(file.path);
    }
  }
  for (const file of prev.files) {
    if (!current.has(file.relative) && !seen.has(file.path)) {
      paths.push(file.path);
    }
  }
  return paths;
}

function sameIndex(prev: GitDiffIndex | null, next: GitDiffIndex): boolean {
  if (!prev) return false;
  if (
    prev.branch !== next.branch ||
    prev.additions !== next.additions ||
    prev.deletions !== next.deletions ||
    prev.files.length !== next.files.length ||
    prev.remote !== next.remote ||
    prev.upstream !== next.upstream ||
    prev.defaultBranch !== next.defaultBranch ||
    prev.ahead !== next.ahead ||
    prev.behind !== next.behind ||
    prev.aheadOfDefault !== next.aheadOfDefault
  ) {
    return false;
  }
  return prev.files.every((file, i) => {
    const other = next.files[i];
    return (
      other &&
      file.relative === other.relative &&
      file.status === other.status &&
      file.additions === other.additions &&
      file.deletions === other.deletions &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged
    );
  });
}
