import { ask } from "@tauri-apps/plugin-dialog";
import {
  changedImageGroup,
  imageViewerAvailable,
  openImageViewer,
} from "../lib/imageViewer";
import {
  ChevronDown,
  ChevronRight,
  FileDiff,
  FolderTree,
  ListBullet,
  Minus,
  Plus,
  Undo2,
  Ungroup,
} from "./icons";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { FadeText, MiddleText } from "./FadeText";
import { FileTypeIcon } from "./FileTypeIcon";
import { GitHistoryGraph } from "./GitHistoryGraph";
import {
  basename,
  gitDiffIndex,
  gitDiffFiles,
  gitDiscardAll,
  gitDiscardFile,
  gitPrStatus,
  gitStageAll,
  gitStageFile,
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
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { applyProjectDiffStats } from "../hooks/useProjectDiffStats";
import { GitCopies } from "./GitCopies";
import { GitHousekeeping } from "./GitHousekeeping";
import {
  isWindowActive,
  isWindowVisible,
  mayRefresh,
  subscribeWindowActivity,
  type RefreshReason,
} from "../lib/windowActivity";
import { errorText, logError } from "../lib/errors";
import { useGitHistory } from "../hooks/useGitHistory";
import {
  changeKindFor,
  churnBar,
  discardPrompt,
  largestChurn,
  lineTotals,
  loadShowStaging,
  saveShowStaging,
} from "../lib/gitChangesView";
import { subscribeShipRequests, takeShipRequest } from "../lib/shipRequest";
import { LiveSessionsContext } from "../lib/liveSessions";
import { sessionWorkCwd } from "../lib/session";
import { chatForChanges, groupChangesByTurn } from "../lib/changeTurns";
import {
  isViewed,
  markViewed,
  pruneViewed,
  toggleViewed,
  useViewedChanges,
} from "../lib/viewedChanges";
import { setUpProjectGit, gitSetupError } from "../lib/projectGitSetup";
import { CommitBox } from "./CommitBox";
import { ShipFlow } from "./ShipFlow";
import { afterSidePanelOpens } from "../lib/sidePanel";
import { noteSidePanelRead, sidePanelReadFresh } from "../lib/sidePanelReads";
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

/** An open Ship card, and the conversation it describes when one was named. */
type ShipState = {
  sessionId?: string;
  /** When it was opened: each opening starts the flow afresh. */
  opened?: number;
};

/** Every changed file, the files under the turn that changed them, or the history. */
export type ChangesMode = "all" | "turns" | "commits";
const CHANGES_MODES: readonly ChangesMode[] = ["all", "turns", "commits"];
const MODE_LABEL: Record<ChangesMode, string> = {
  all: "All",
  turns: "Turns",
  commits: "Commits",
};

let stagedOpen = true;
let changesOpen = true;
let changesView: ChangesView = loadChangesView();
/** The Changes tab's view and filter, kept while Aven runs. */
let changesMode: ChangesMode = "all";
let unviewedOnly = false;
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
  /** The project folder when `cwd` is another copy of it. */
  projectCwd?: string;
  onOpenFile: (path: string, kind: GitFileDiffKind) => void;
  /** Stacks the changes in one review: one side of them, or all without a kind. */
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
  /** Opens the branch switcher anchored to the commit box's branch. */
  onOpenBranchPicker?: (anchor: HTMLButtonElement) => void;
  /** The chat in front, whose turns group the changes. */
  sessionId?: string;
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
  sessionId,
}: Props) {
  const { index, reload } = useDiffIndex(cwd, enabled);
  // Tells a folder without Git from an empty one; shared with Commits.
  const history = useGitHistory(cwd, enabled);
  const files = useMemo(() => index?.files ?? [], [index]);
  const viewed = useViewedChanges(cwd);
  // Marks on files that are no longer changed are forgotten.
  useEffect(() => {
    if (index) pruneViewed(cwd, files);
  }, [cwd, files, index]);
  // A changed picture opens in the image viewer, beside the others changed
  // with it (in its section, or every one from the single list); everything
  // else opens its diff. Opening a file marks it viewed.
  const openChange = useCallback(
    (path: string, kind: GitFileDiffKind, everyFile?: boolean) => {
      const file = files.find((candidate) => candidate.path === path);
      if (file) markViewed(cwd, file);
      const group = imageViewerAvailable()
        ? changedImageGroup(files, path, everyFile ? undefined : kind)
        : null;
      if (!group || !openImageViewer(group)) onOpenFile(path, kind);
    },
    [cwd, files, onOpenFile],
  );
  // No branch and no commits: not a Git repository, so there is no history.
  const noGit =
    index !== null &&
    files.length === 0 &&
    index.branch === null &&
    history.loaded &&
    !history.head;
  const [mode, setModeState] = useState<ChangesMode>(changesMode);
  const setMode = (next: ChangesMode) => {
    changesMode = next;
    setModeState(next);
  };
  const [unviewed, setUnviewedState] = useState(unviewedOnly);
  const setUnviewed = (next: boolean) => {
    unviewedOnly = next;
    setUnviewedState(next);
  };
  const { pr, reload: reloadPr } = usePrStatus(cwd, index?.branch, enabled);
  // The commit message, kept while the Ship card opens and closes.
  const [message, setMessage] = useState("");
  // Off: one list of every changed file. On: Staged and Changes sections,
  // with buttons to stage and unstage.
  const [showStaging, setShowStaging] = useState(loadShowStaging);
  const [shipping, setShipping] = useState(false);
  const [rowBusy, setRowBusy] = useState(false);
  // The Ship card: from More ways to ship, or a request elsewhere (a
  // finished turn's changes in the chat) for this folder.
  const [ship, setShip] = useState<ShipState | null>(null);
  const shipKey = useRef(0);
  if (ship && !shipping) shipKey.current = ship.opened ?? 0;
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
  }, [cwd, enabled, reload]);
  const onMutated = useCallback(
    (paths?: string[]) => {
      reload();
      notifyGitChanged(cwd);
      invalidateWatchedFiles(paths);
      window.setTimeout(() => invalidateWatchedFiles(paths), 150);
    },
    [cwd, reload],
  );
  const onShipBusy = useCallback((busy: boolean) => setShipping(busy), []);

  if (!cwd || cwd === "~") {
    return (
      <p className="px-3 py-2 text-ui-label text-content/50">
        No project folder
      </p>
    );
  }

  if (noGit) return <NoGitState cwd={cwd} onReady={() => onMutated()} />;

  return (
    <div className="git-changes flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="inspector-switch" role="tablist" aria-label="Show">
        {CHANGES_MODES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className="inspector-pill"
            onClick={() => setMode(value)}
          >
            {MODE_LABEL[value]}
          </button>
        ))}
        {mode !== "commits" ? (
          <button
            type="button"
            className="inspector-pill git-unviewed-toggle"
            aria-pressed={unviewed}
            title={
              unviewed
                ? "Show every changed file"
                : "Hide the files you have opened"
            }
            onClick={() => setUnviewed(!unviewed)}
          >
            Unviewed
          </button>
        ) : null}
      </div>
      {mode === "commits" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <GitHistoryGraph
            cwd={cwd}
            enabled={enabled}
            selectedSha={selectedSha}
            branch={index ? index.branch : undefined}
            onOpenCommit={onOpenCommit}
          />
        </div>
      ) : (
        <ChangedFiles
          cwd={cwd}
          projectCwd={projectCwd}
          textHarness={textHarness}
          index={index}
          files={files}
          viewed={viewed}
          unviewedOnly={unviewed}
          turns={mode === "turns"}
          sessionId={sessionId}
          selected={selectedPath}
          selectedKind={selectedKind}
          enabled={enabled}
          locked={shipping}
          showStaging={showStaging}
          onShowStagingChange={(next) => {
            saveShowStaging(next);
            setShowStaging(next);
          }}
          onBusyChange={setRowBusy}
          onOpenFile={openChange}
          onOpenAllChanges={onOpenAllChanges}
          onMutated={onMutated}
        />
      )}
      {index ? (
        ship ? (
          <div className="git-ship-foot">
            <ShipFlow
              key={shipKey.current}
              cwd={cwd}
              index={index}
              files={files}
              pr={pr}
              enabled={enabled}
              textHarness={textHarness}
              sessionId={ship.sessionId ?? sessionId}
              stagingShown={showStaging}
              message={message}
              onMessageChange={setMessage}
              onBusyChange={onShipBusy}
              onMutated={onMutated}
              onPrChanged={reloadPr}
              onClose={() => setShip(null)}
            />
          </div>
        ) : (
          <CommitBox
            cwd={cwd}
            index={index}
            files={files}
            pr={pr}
            textHarness={textHarness}
            sessionId={sessionId}
            stagingShown={showStaging}
            message={message}
            onMessageChange={setMessage}
            locked={rowBusy}
            onBusyChange={onShipBusy}
            onMutated={onMutated}
            onPrChanged={reloadPr}
            onOpenBranchPicker={onOpenBranchPicker}
            onMore={() => setShip({ opened: Date.now() })}
          />
        )
      ) : null}
    </div>
  );
}

/** A folder without Git: one way to start, as bots offer it. */
function NoGitState({ cwd, onReady }: { cwd: string; onReady: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await setUpProjectGit(cwd);
      onReady();
    } catch (error) {
      logError("Set up Git", error);
      setProblem(gitSetupError(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inspector-empty" role="status">
      <p className="inspector-empty-title">No Git here yet</p>
      <p className="inspector-empty-detail">
        Set up Git to see changes and commits here.
      </p>
      <button
        type="button"
        className="inspector-empty-action"
        disabled={busy}
        title="Turns on Git for this folder and saves its files in a first commit, on this computer. Nothing is uploaded."
        onClick={() => void start()}
      >
        {busy ? "Setting up Git…" : "Set up Git"}
      </button>
      {problem ? (
        <p className="inspector-empty-hint" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function ChangedFiles({
  cwd,
  projectCwd,
  textHarness,
  index,
  files,
  viewed,
  unviewedOnly,
  turns,
  sessionId,
  selected,
  selectedKind,
  enabled,
  locked,
  showStaging,
  onShowStagingChange,
  onBusyChange,
  onOpenFile,
  onOpenAllChanges,
  onMutated,
}: {
  cwd: string;
  projectCwd?: string;
  textHarness?: HarnessId;
  index: GitDiffIndex | null;
  files: GitChangedFile[];
  viewed: Record<string, string> | undefined;
  unviewedOnly: boolean;
  /** Group the files under the turn of the chat that changed them. */
  turns: boolean;
  sessionId?: string;
  selected?: string;
  selectedKind?: GitFileDiffKind;
  enabled: boolean;
  /** A commit or push is running: rows wait. */
  locked: boolean;
  showStaging: boolean;
  onShowStagingChange: (show: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenFile: OpenChange;
  onOpenAllChanges: (kind?: GitFileDiffKind) => void;
  onMutated: (paths?: string[]) => void;
}) {
  const live = useContext(LiveSessionsContext);
  const [busyState, setBusyState] = useState<string | null>(null);
  const busy = busyState ?? (locked ? "ship" : null);
  const setBusy = (next: string | null) => {
    setBusyState(next);
    onBusyChange(next !== null);
  };
  const [stagedExpanded, setStagedExpanded] = useState(stagedOpen);
  const [changesExpanded, setChangesExpanded] = useState(changesOpen);
  const [view, setView] = useState<ChangesView>(changesView);
  const listRef = useRef<HTMLDivElement>(null);
  // Unviewed hides the files you have opened since they last changed.
  const shown = useMemo(
    () =>
      unviewedOnly ? files.filter((file) => !isViewed(viewed, file)) : files,
    [files, unviewedOnly, viewed],
  );
  const staged = useMemo(() => shown.filter((file) => file.staged), [shown]);
  const unstaged = useMemo(
    () => shown.filter((file) => file.unstaged),
    [shown],
  );
  const largest = useMemo(() => largestChurn(files), [files]);
  const totals = useMemo(() => lineTotals(shown), [shown]);
  // Read from the chat when the files change, not on every streamed token.
  const groups = useMemo(() => {
    if (!turns) return null;
    const session = chatForChanges(live?.list() ?? [], cwd, sessionId);
    return groupChangesByTurn(
      session?.blocks ?? [],
      session ? sessionWorkCwd(session) : cwd,
      shown,
    );
  }, [turns, live, cwd, sessionId, shown]);

  const toggleView = () => {
    changesView = view === "tree" ? "list" : "tree";
    saveChangesView(changesView);
    setView(changesView);
  };

  const fail = (error: unknown) => {
    logError("source control", error);
    window.alert(errorText(error));
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
    const discarded = whole ? files : files.filter((file) => file.unstaged);
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

  // The list's keys, as in Super: ↓/J and ↑/K move, Space marks viewed,
  // N goes to the next unviewed file, Return opens.
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const list = listRef.current;
    const target = event.target as HTMLElement;
    if (!list) return;
    const onRow = target.hasAttribute("data-change-open");
    if (!onRow && target !== list) return;
    const rows = [
      ...list.querySelectorAll<HTMLButtonElement>("[data-change-open]"),
    ];
    if (rows.length === 0) return;
    const at = onRow ? rows.indexOf(target as HTMLButtonElement) : -1;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    let next: HTMLButtonElement | undefined;
    if (key === "ArrowDown" || key === "j")
      next = rows[Math.min(at + 1, rows.length - 1)];
    else if (key === "ArrowUp" || key === "k") next = rows[Math.max(at - 1, 0)];
    else if (key === "n") {
      const order = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
      next = order.find(
        (row) => !row.closest("[data-change-row]")?.hasAttribute("data-viewed"),
      );
      if (!next) return;
    } else if (key === " ") {
      event.preventDefault();
      const relative = rows[at]?.dataset.changeOpen;
      const file = files.find((candidate) => candidate.relative === relative);
      if (file) toggleViewed(cwd, file);
      return;
    } else if (key === "Enter" && at < 0) next = rows[0];
    else return;
    event.preventDefault();
    next?.focus();
    next?.scrollIntoView({ block: "nearest" });
  };

  const stagingToggle: SectionAction = {
    title: showStaging ? "Hide staging" : "Show staging",
    icon: <Ungroup className="size-3.5" strokeWidth={1.75} />,
    pressed: showStaging,
    onClick: () => onShowStagingChange(!showStaging),
  };
  const rowProps = {
    view,
    largest,
    selected,
    selectedKind,
    busy,
    viewed,
    onOpenFile,
  };
  const allList = (list: GitChangedFile[]) => (
    <ChangeList
      files={list}
      kind="all"
      {...rowProps}
      onAction={(file, action) => void run(file, action, true)}
    />
  );

  return (
    <div
      ref={listRef}
      tabIndex={files.length > 0 ? 0 : -1}
      aria-label="Changed files"
      onKeyDown={onListKey}
      onKeyUp={(event) => {
        // Space marks the row viewed; it must not also press the row.
        if (
          event.key === " " &&
          (event.target as HTMLElement).hasAttribute("data-change-open")
        )
          event.preventDefault();
      }}
      className="git-changes-list flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-none py-1 outline-none"
    >
      {!index ? (
        <p className="px-3 py-2 text-ui-label text-content/45">
          Loading changes…
        </p>
      ) : files.length === 0 ? (
        <div className="inspector-empty" role="status">
          <p className="inspector-empty-title">No changes</p>
          <p className="inspector-empty-detail">
            Edits you or your agents make show up here.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="inspector-empty" role="status">
          <p className="inspector-empty-title">All viewed</p>
          <p className="inspector-empty-detail">
            You’ve opened every changed file.
          </p>
        </div>
      ) : groups ? (
        <>
          {groups.turns.map((turn) => (
            <FileSection
              key={turn.id}
              title={turn.label}
              plain
              count={turn.files.length}
              totals={lineTotals(turn.files)}
              open
              view={view}
              onToggleView={toggleView}
              headerActions={[]}
            >
              {allList(turn.files)}
            </FileSection>
          ))}
          {groups.other.length > 0 ? (
            <FileSection
              title="Other changes"
              plain
              count={groups.other.length}
              totals={lineTotals(groups.other)}
              open
              view={view}
              onToggleView={toggleView}
              headerActions={[]}
            >
              {allList(groups.other)}
            </FileSection>
          ) : null}
        </>
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
          count={shown.length}
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
          {allList(shown)}
        </FileSection>
      )}
      <GitCopies
        cwd={cwd}
        enabled={enabled}
        projectCwd={projectCwd}
        base={index?.defaultBranch ?? undefined}
        textHarness={textHarness}
      />
      <GitHousekeeping cwd={cwd} enabled={enabled} />
    </div>
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
  // The reload last asked for; a newer one reads even when fresh.
  const readNonce = useRef(nonce);

  useEffect(() => {
    if (!enabled) return;
    if (!cwd || cwd === "~" || !branch) {
      setPr(null);
      return;
    }
    setPr(cachedPr(cwd, branch));
    const reloaded = readNonce.current !== nonce;
    readNonce.current = nonce;
    const key = `pull-request:${cwd}:${branch}`;
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
          noteSidePanelRead(key);
          setPr(next);
        })
        .catch(() => {
          if (stale()) return;
          prByCwd.set(cwd, null);
          setPr(null);
        });
    };
    const unsubscribe = subscribeWindowActivity(() => load("poll"));
    // Showing the panel asks GitHub only when the last answer is old or Git
    // changed since, and only once the panel has slid in.
    const cancelFirstRead =
      !reloaded && prByCwd.has(cwd) && sidePanelReadFresh(key)
        ? () => undefined
        : afterSidePanelOpens(() => load("event"));
    return () => {
      cancelled = true;
      cancelFirstRead();
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

/** A button in a file section's header; `pressed` marks a toggle that is on. */
type SectionAction = {
  title: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick: () => void;
};

function FileSection({
  title,
  plain,
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
  /** A turn's message: its own words, in sentence case. */
  plain?: boolean;
  count: number;
  totals: { additions: number; deletions: number };
  open: boolean;
  onToggle?: () => void;
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
          disabled={!onToggle}
          title={plain ? title : undefined}
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
        >
          {!onToggle ? null : open ? (
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
          <span
            className={
              plain
                ? "min-w-0 truncate pl-1 text-ui-label font-medium text-content/60"
                : "min-w-0 truncate text-ui-micro font-semibold tracking-[0.04em] text-content/55 uppercase"
            }
          >
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
  /** Files opened since they last changed, by path. */
  viewed?: Record<string, string>;
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
          viewed={isViewed(rest.viewed, file)}
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
  viewed,
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
          viewed={viewed}
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
          viewed={isViewed(viewed, file)}
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
  viewed,
  kind,
  largest,
  depth,
  onOpenFile,
  onAction,
}: {
  file: GitChangedFile;
  active: boolean;
  busy: boolean;
  /** Opened since it last changed: the row is dimmed. */
  viewed: boolean;
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
    <li data-change-row="" data-viewed={viewed || undefined}>
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
          data-change-open={file.relative}
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
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <FadeText className="flex-[0_1_auto] text-ui-body font-medium">
              {name}
            </FadeText>
            {/* The folder keeps both ends; the name keeps its room. */}
            {dir ? (
              <MiddleText
                text={dir}
                className="flex-[1_1_0] text-ui-caption text-content/40"
              />
            ) : null}
            {stagedNote ? (
              <span className="sr-only">, {stagedNote}</span>
            ) : null}
            {viewed ? <span className="sr-only">, viewed</span> : null}
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
  // The reload last asked for; a newer one reads even when fresh.
  const readNonce = useRef(nonce);

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      return;
    }
    const reloaded = readNonce.current !== nonce;
    readNonce.current = nonce;
    const key = `changes:${cwd}`;
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
        noteSidePanelRead(key);
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
    // Opening the panel reads once if the window is on screen, after the
    // panel has slid in; not when the list was read moments ago with no Git
    // change since. A reload always reads.
    let cancelFirstRead = () => {};
    if (visible) {
      if (!reloaded && indexRef.current && sidePanelReadFresh(key)) schedule();
      else cancelFirstRead = afterSidePanelOpens(checkNow);
    }
    return () => {
      cancelled = true;
      cancelFirstRead();
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
