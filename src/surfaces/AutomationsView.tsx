import "./UtilityViews.css";
import { useEffect, useMemo, useRef } from "react";
import { Clock } from "../chrome/icons";
import { OverlayNav } from "../chrome/TitleBar";
import { WindowControls } from "../chrome/WindowControls";
import { useDragResize } from "../hooks/useDragResize";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { inboxProjectsForRail } from "../lib/githubTasks";
import { projectName } from "../lib/paths";
import { IS_MAC } from "../lib/platform";
import type { RecentProject } from "../lib/recents";
import type { ScheduledAgent } from "../lib/scheduledAgents";
import {
  resolveScheduledSelection,
  ScheduledDetail,
  ScheduledRunList,
  useAutomationSelection,
  useScheduledRuns,
  type ScheduledProject,
} from "./ScheduledInbox";

const MIN_WIDTH = 240;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 280;

let rememberedWidth = DEFAULT_WIDTH;

type Props = {
  cwd: string;
  recents: RecentProject[];
  besideRail?: boolean;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  /** Starts an automation now, through the same path as a due run. */
  onRunAutomation?: (agent: ScheduledAgent) => void;
  onOpenChat?: (sessionId: string) => unknown;
};

/**
 * Agents that run on a schedule: runs and the automation manager on the left,
 * the selected run or the manager and its editor on the right. Laid out like
 * the Inbox, which used to host this as its Scheduled tab.
 */
export function AutomationsView({
  cwd,
  recents,
  besideRail = false,
  onClose,
  onToggleSidebar,
  onRunAutomation,
  onOpenChat,
}: Props) {
  const detailLock = useLockOverscroll<HTMLDivElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const selection = useAutomationSelection();
  const runs = useScheduledRuns();
  const selected = resolveScheduledSelection(selection.selected, runs);

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
        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 text-[13px]">
          <Clock
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <span className="min-w-0 truncate text-content">Automations</span>
          <span className="truncate text-[11px] text-content/45">
            Agents that run on a schedule
          </span>
        </div>
        {IS_MAC ? null : <WindowControls />}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          ref={resize.setPaneRef}
          className="relative flex h-full min-h-0 shrink-0 flex-col border-r border-content/10"
        >
          <ScheduledRunList
            selected={selected}
            onSelect={selection.setSelected}
          />
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
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
        >
          <ScheduledDetail
            selected={selected}
            projects={projects}
            cwd={cwd}
            editor={selection.editor}
            onEditorChange={selection.setEditor}
            onRunNow={onRunAutomation}
            onOpenChat={onOpenChat}
          />
        </div>
      </div>
    </div>
  );
}
