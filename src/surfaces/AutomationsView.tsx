import "./UtilityViews.css";
import "../chrome/Menu.css";
import "./AutomationsView.css";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CheckCheck, ChevronRight, Clock, Folder, Plus } from "../chrome/icons";
import { ProjectMark } from "../chrome/ProjectMark";
import { OverlayNav } from "../chrome/TitleBar";
import { WindowControls } from "../chrome/WindowControls";
import { useDragResize } from "../hooks/useDragResize";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  automationFolderKey,
  automationTiming,
  automationTone,
  groupAutomationsByProject,
  lastRunLabel,
  loadCollapsedFolders,
  setFolderCollapsed,
  shortAgo,
  subscribeCollapsedFolders,
  type AutomationFolder,
  type AutomationItem,
} from "../lib/automationFolders";
import { inboxProjectsForRail } from "../lib/githubTasks";
import type { ApprovalDecision } from "../lib/harness";
import {
  isInboxEntryUnread,
  markInboxItemsSeen,
  useInboxSeenTick,
} from "../lib/inboxSeen";
import { projectName } from "../lib/paths";
import { IS_MAC } from "../lib/platform";
import { projectAppearance } from "../lib/projectAppearance";
import type { RecentProject } from "../lib/recents";
import {
  getScheduledAgent,
  getScheduledRun,
  saveScheduledAgent,
  scheduledRunSeenEntry,
  subscribeAutomationsRequest,
  takeAutomationsRequest,
  type ScheduledAgent,
  type ScheduledRun,
} from "../lib/scheduledAgents";
import {
  AutomationDetail,
  AutomationDot,
  AutomationRunView,
} from "./AutomationDetail";
import {
  AutomationExamples,
  editorKey,
  KeepAwakeRow,
  ScheduleEditor,
  useScheduledAgentList,
  useScheduledRuns,
  type ScheduledProject,
  type ScheduleEditorState,
} from "./ScheduledInbox";

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

let rememberedWidth = DEFAULT_WIDTH;

type Selection = { automation: string | null; run: string | null };

type Props = {
  cwd: string;
  recents: RecentProject[];
  besideRail?: boolean;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  /** Starts an automation now, through the same path as a due run. */
  onRunAutomation?: (agent: ScheduledAgent) => void;
  /** Makes a run's chat an ordinary chat and opens it. */
  onOpenRunAsChat?: (run: ScheduledRun) => unknown;
  onApproval?: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  onStopRun?: (sessionId: string) => void;
  /** The card's button: sends its message to the run's conversation. */
  onReviewAction?: (run: ScheduledRun) => unknown;
};

/**
 * Selection and editor state. Requests from elsewhere (the palette's New
 * automation, a folder's +, an Activity entry or Inbox card for a run) are
 * taken when the view opens, or at once while it is open.
 */
export function useAutomationSelection() {
  const [selection, setSelection] = useState<Selection>({
    automation: null,
    run: null,
  });
  const [editor, setEditor] = useState<ScheduleEditorState>(null);
  useEffect(() => {
    const take = () => {
      const request = takeAutomationsRequest();
      if (!request) return;
      if (request.kind === "new") {
        setEditor({ mode: "new", project: request.project });
        return;
      }
      const run = getScheduledRun(request.runId);
      if (!run) return;
      setEditor(null);
      setSelection({ automation: run.scheduleId, run: run.id });
      // Its folder opens, so the row it is under shows.
      const agent = getScheduledAgent(run.scheduleId);
      setFolderCollapsed(
        automationFolderKey(agent?.project ?? run.project),
        false,
      );
    };
    take();
    return subscribeAutomationsRequest(take);
  }, []);
  return { selection, setSelection, editor, setEditor };
}

/**
 * Automations: a folder per project on the left, each listing its
 * automations; on the right, the selected automation and its runs, or one
 * run's conversation. Runs stay here; a run you want to continue is opened
 * as a chat on purpose.
 */
export function AutomationsView({
  cwd,
  recents,
  besideRail = false,
  onClose,
  onToggleSidebar,
  onRunAutomation,
  onOpenRunAsChat,
  onApproval,
  onStopRun,
  onReviewAction,
}: Props) {
  const detailLock = useLockOverscroll<HTMLDivElement>();
  const listLock = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { selection, setSelection, editor, setEditor } =
    useAutomationSelection();
  const agents = useScheduledAgentList();
  const runs = useScheduledRuns();
  const collapsed = useSyncExternalStore(
    subscribeCollapsedFolders,
    loadCollapsedFolders,
  );
  useInboxSeenTick();

  const folders = useMemo(
    () =>
      groupAutomationsByProject(agents, runs, {
        nameOf: (path) => projectAppearance(path).label || projectName(path),
      }),
    [agents, runs],
  );
  const items = useMemo(
    () => folders.flatMap((folder) => folder.items),
    [folders],
  );

  // The automation shown: the one chosen, else the one that ran last.
  const chosen = items.find((item) => item.id === selection.automation);
  const fallback = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          (b.runs[0]?.startedAt ?? b.agent?.createdAt ?? 0) -
          (a.runs[0]?.startedAt ?? a.agent?.createdAt ?? 0),
      )[0],
    [items],
  );
  const current = chosen ?? (selection.automation ? undefined : fallback);
  const run = current?.runs.find((entry) => entry.id === selection.run);

  const projects = useMemo<ScheduledProject[]>(
    () =>
      inboxProjectsForRail(recents, cwd)
        .map((project) => ({
          path: project.path,
          name: projectName(project.path),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [cwd, recents],
  );

  const finished = runs.filter((entry) => entry.status !== "running");
  const anyUnread = finished.some((entry) =>
    isInboxEntryUnread(scheduledRunSeenEntry(entry)),
  );

  const resize = useDragResize({
    min: MIN_WIDTH,
    max: () => Math.min(MAX_WIDTH, Math.round(window.innerWidth * 0.5)),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Open selects and the editor take Escape for themselves.
      if (
        document.querySelector('.settings-select[aria-expanded="true"]') ||
        document.activeElement?.closest("[data-scheduled-editor]")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const selectAutomation = (id: string) => {
    setEditor(null);
    setSelection({ automation: id, run: null });
  };

  const detail = editor ? (
    <div className="automation-detail">
      <ScheduleEditor
        key={editorKey(editor)}
        initial={editor.mode === "edit" ? editor.agent : undefined}
        example={editor.mode === "new" ? editor.example : undefined}
        project={editor.mode === "new" ? editor.project : undefined}
        projects={projects}
        cwd={cwd}
        onCancel={() => setEditor(null)}
        onSave={(agent) => {
          saveScheduledAgent(agent);
          setEditor(null);
          setSelection({ automation: agent.id, run: null });
          // Saved into a folder, or moved to one: show it there.
          setFolderCollapsed(automationFolderKey(agent.project), false);
        }}
      />
    </div>
  ) : run && current ? (
    <AutomationRunView
      key={run.id}
      run={run}
      item={current}
      onBack={() => setSelection({ automation: current.id, run: null })}
      onOpenAsChat={onOpenRunAsChat}
      onApproval={onApproval}
      onStop={onStopRun}
      onReviewAction={onReviewAction}
    />
  ) : current ? (
    <AutomationDetail
      key={current.id}
      item={current}
      onSelectRun={(entry) =>
        setSelection({ automation: current.id, run: entry.id })
      }
      onEdit={(agent) => setEditor({ mode: "edit", agent })}
      onDeleted={() => setSelection({ automation: null, run: null })}
      onRunNow={onRunAutomation}
    />
  ) : (
    <div className="automation-detail">
      <p className="automation-intro">
        Automations run an agent on a schedule while your{" "}
        {IS_MAC ? "Mac" : "computer"} is awake and Aven is open. If a run is
        missed, it runs once when you’re back. Runs stay here; you hear about
        one only when it needs you or has something to review.
      </p>
      <AutomationExamples
        onChoose={(example) => setEditor({ mode: "new", example })}
      />
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Automations"
      data-app-automations
      className="flex min-h-0 min-w-0 flex-1 flex-col text-content"
    >
      <div
        className="flex h-10 shrink-0 select-none items-center border-b border-content/10"
        data-tauri-drag-region="deep"
      >
        {IS_MAC && !besideRail ? <div className="w-[78px] shrink-0" /> : null}
        <OverlayNav onBack={onClose} onToggleSidebar={onToggleSidebar} />
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-ui-body">
          <Clock
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-content">Automations</span>
          <span className="truncate text-ui-caption text-content/45">
            Agents that run on a schedule
          </span>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          ref={resize.setPaneRef}
          className="automation-list relative flex h-full min-h-0 shrink-0 flex-col border-r border-content/10"
        >
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-content/10 px-2">
            <button
              type="button"
              className="automation-new"
              disabled={editor?.mode === "new"}
              onClick={() => setEditor({ mode: "new" })}
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              New automation
            </button>
            <button
              type="button"
              title="Mark all runs as read"
              aria-label="Mark all runs as read"
              disabled={!anyUnread}
              onClick={() =>
                markInboxItemsSeen(finished.map(scheduledRunSeenEntry))
              }
              className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-content/45"
            >
              <CheckCheck className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
          <div
            ref={listLock}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none"
          >
            {folders.length === 0 ? (
              <p className="automation-empty-note automation-list-note">
                No automations yet
              </p>
            ) : (
              <div className="aven-menu automation-folders">
                {folders.map((folder) => (
                  <FolderGroup
                    key={folder.key}
                    folder={folder}
                    open={!collapsed.has(folder.key)}
                    selected={editor ? null : (current?.id ?? null)}
                    onToggle={(open) => setFolderCollapsed(folder.key, !open)}
                    onSelect={selectAutomation}
                    onNew={() =>
                      setEditor({ mode: "new", project: folder.project ?? "" })
                    }
                  />
                ))}
              </div>
            )}
          </div>
          {agents.length ? <KeepAwakeRow /> : null}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize automations list"
            className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
              resize.dragging ? "bg-content/15" : "hover:bg-content/10"
            }`}
            onPointerDown={resize.onPointerDown}
            onDoubleClick={resize.onDoubleClick}
          />
        </div>
        <div
          ref={detailLock}
          className={`min-h-0 min-w-0 flex-1 overscroll-none ${
            run && current && !editor
              ? "flex flex-col overflow-hidden"
              : "overflow-y-auto"
          }`}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function FolderName({ folder }: { folder: AutomationFolder }) {
  const appearance = useProjectAppearance(folder.project);
  return <>{appearance?.label || folder.name}</>;
}

function FolderGroup({
  folder,
  open,
  selected,
  onToggle,
  onSelect,
  onNew,
}: {
  folder: AutomationFolder;
  open: boolean;
  selected: string | null;
  onToggle: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const count = folder.items.length;
  return (
    <section
      className="automation-folder"
      data-automation-folder={folder.key}
      aria-label={folder.name}
    >
      <div className="automation-folder-head">
        <button
          type="button"
          className="aven-menu-item automation-folder-toggle"
          aria-expanded={open}
          onClick={() => onToggle(!open)}
        >
          <ChevronRight
            className="automation-folder-chevron"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="aven-menu-icon automation-folder-mark" aria-hidden>
            {folder.project ? (
              <ProjectMark path={folder.project} />
            ) : (
              <Folder strokeWidth={1.75} />
            )}
          </span>
          <span className="aven-menu-label">
            <FolderName folder={folder} />
          </span>
          <span
            className="aven-menu-detail automation-folder-count"
            aria-label={`${count} ${count === 1 ? "automation" : "automations"}`}
          >
            {count}
          </span>
        </button>
        <button
          type="button"
          className="automation-folder-add"
          title={`New automation in ${folder.name}`}
          aria-label={`New automation in ${folder.name}`}
          onClick={onNew}
        >
          <Plus className="size-3" strokeWidth={1.75} />
        </button>
      </div>
      {open ? (
        <ul className="automation-folder-items">
          {folder.items.map((item) => (
            <li key={item.id}>
              <AutomationRow
                item={item}
                active={item.id === selected}
                onSelect={() => onSelect(item.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function AutomationRow({
  item,
  active,
  onSelect,
}: {
  item: AutomationItem;
  active: boolean;
  onSelect: () => void;
}) {
  const last = item.runs[0];
  const tone = automationTone(item);
  const status = lastRunLabel(item);
  const off = !!item.agent && !item.agent.enabled;
  return (
    <button
      type="button"
      data-automation-row={item.id}
      data-off={off || !item.agent || undefined}
      aria-current={active ? "true" : undefined}
      aria-label={`${item.name}: ${status}`}
      title={item.name}
      className="aven-menu-item aven-menu-item-rich automation-row"
      onClick={onSelect}
    >
      <AutomationDot tone={tone} label={status} />
      <span className="aven-menu-text">
        <span className="automation-row-name">{item.name}</span>
        <span className="aven-menu-description">{automationTiming(item)}</span>
      </span>
      {last && last.status !== "running" ? (
        <span className="aven-menu-detail automation-row-ago">
          {shortAgo(last.finishedAt ?? last.startedAt)}
        </span>
      ) : null}
    </button>
  );
}
