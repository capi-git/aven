import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProviderMarks } from "./ProviderMarks";
import { WindowControls } from "./WindowControls";
import { DevModeSlot } from "./TitleBar";
import { IS_MAC } from "../lib/platform";
import { settingsSectionLabel, type SettingsSectionId } from "../lib/settings";
import { Popover } from "./Popover";
import { useUsagePanelTheme } from "../lib/usagePanel";
import { ActivityPanel } from "./ActivityPanel";
import { useActivity } from "../lib/activity";
import { sessionModelIdentity, sessionModelName } from "../lib/sessionLabels";
import {
  Check,
  ListBullet,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Globe,
  Home,
  PanelLeft,
  PanelRight,
  Search,
  X,
} from "./icons";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionNeedsInput,
  type Session,
} from "../lib/session";
import "./WorkspaceStatusBar.css";

export type WorkspaceStatusBarProps = {
  sessions: readonly Session[];
  session?: Session;
  onSelectSession: (id: string) => boolean | Promise<boolean>;
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
  /** The visible sidebar owns the navigation controls in its window bar. */
  navigationInSidebar?: boolean;
  onSearch?: () => void;
  onNewBrowser?: () => void;
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onHome?: () => void;
  homeOpen?: boolean;
  onToggleInspector?: () => void;
  inspectorOpen?: boolean;
  /** Settings shares the window header instead of stacking a second toolbar. */
  settingsView?: { section: SettingsSectionId; onClose: () => void };
};

type QueueRow = {
  id: string;
  title: string;
  queued: number;
  busy: boolean;
  approvals: number;
  question: boolean;
  paused: boolean;
};
const approvalCounts = new WeakMap<Session["blocks"], number>();

export function workspaceQueueSummary(sessions: readonly Session[]) {
  let queued = 0,
    running = 0,
    approvals = 0,
    questions = 0;
  const rows: QueueRow[] = [];
  for (const session of sessions) {
    // Immutable block arrays from inactive sessions reuse their approval count;
    // streaming one task does not rescan every other task's transcript.
    let count = approvalCounts.get(session.blocks);
    if (count === undefined) {
      count = session.blocks.reduce(
        (sum, block) =>
          sum + Number(!!block.approval && !block.approval.decided),
        0,
      );
      approvalCounts.set(session.blocks, count);
    }
    const messages = session.queuedMessages?.length ?? 0;
    const question = !!session.pendingQuestion;
    queued += messages;
    running += Number(!!session.busy);
    approvals += count;
    questions += Number(question);
    if (messages || session.busy || count || question)
      rows.push({
        id: session.id,
        title:
          sessionDisplayTitle(session.title, session.harness) ||
          HARNESS_TITLE[session.harness],
        queued: messages,
        busy: !!session.busy,
        approvals: count,
        question,
        paused: session.queueStatus === "paused",
      });
  }
  const parts = [
    queued ? `${queued} queued` : "",
    running ? `${running} running` : "",
    approvals ? `${approvals} approval${approvals === 1 ? "" : "s"}` : "",
    questions ? `${questions} need${questions === 1 ? "s" : ""} input` : "",
  ].filter(Boolean);
  return {
    queued,
    running,
    approvals,
    questions,
    rows,
    label: parts.length ? parts.join(" · ") : "Queue is clear",
  };
}

function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  ];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : index < 0
          ? event.key === "ArrowDown"
            ? 0
            : buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
  buttons[next]?.focus();
}


function dragStatusBar(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0 || event.target !== event.currentTarget) return;
  event.preventDefault();
  const currentWindow = getCurrentWindow();
  const action =
    event.detail === 2
      ? currentWindow.toggleMaximize()
      : currentWindow.startDragging();
  void action.catch((error) => console.warn("Window gesture failed", error));
}

export type WorkspaceNavigationProps = Pick<
  WorkspaceStatusBarProps,
  | "onToggleSidebar"
  | "sidebarOpen"
  | "onSearch"
  | "onNewBrowser"
  | "onGoBack"
  | "onGoForward"
  | "canGoBack"
  | "canGoForward"
  | "onHome"
  | "homeOpen"
> & { compact?: boolean };

/** Stays in the sidebar's layout; small widths move actions into a menu. */
export function WorkspaceNavigation({
  onToggleSidebar,
  sidebarOpen,
  onSearch,
  onNewBrowser,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  onHome,
  homeOpen,
  compact = false,
}: WorkspaceNavigationProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const overflowActions = [
    {
      id: "search",
      label: "Search workspace",
      icon: Search,
      onSelect: onSearch,
    },
    {
      id: "browser",
      label: "New browser tab",
      icon: Globe,
      onSelect: onNewBrowser,
    },
    { id: "home", label: "Workspace Home", icon: Home, onSelect: onHome },
    {
      id: "back",
      label: "Back",
      icon: ChevronLeft,
      onSelect: onGoBack,
      disabled: !canGoBack,
    },
    {
      id: "forward",
      label: "Forward",
      icon: ChevronRight,
      onSelect: onGoForward,
      disabled: !canGoForward,
    },
  ].filter((action) => !!action.onSelect);
  const closeMenu = (restore: boolean) => {
    setMenuOpen(false);
    if (restore) moreAnchor.current?.focus({ preventScroll: true });
  };

  return (
    <div
      className="workspace-navigation"
      data-compact={compact || undefined}
      data-tauri-drag-region="false"
    >
      <div
        className="workspace-status-nav-group"
        role="group"
        aria-label="Workspace navigation"
      >
        <div className="workspace-status-navigation">
          {onToggleSidebar ? (
            <button
              type="button"
              aria-label="Toggle workspace sidebar"
              title="Toggle workspace sidebar"
              aria-pressed={!!sidebarOpen}
              onClick={onToggleSidebar}
            >
              <PanelLeft size={14} />
            </button>
          ) : null}
          {onSearch ? (
            <button
              type="button"
              className="workspace-navigation-secondary"
              aria-label="Search workspace"
              title="Search workspace"
              onClick={onSearch}
            >
              <Search size={14} />
            </button>
          ) : null}
          {onNewBrowser ? (
            <button
              type="button"
              className="workspace-navigation-secondary"
              aria-label="New browser tab"
              title="New browser tab"
              onClick={onNewBrowser}
            >
              <Globe size={14} />
            </button>
          ) : null}
        </div>
        <div className="workspace-status-history">
          {onHome ? (
            <button
              type="button"
              aria-label="Workspace Home"
              title="Workspace Home"
              aria-pressed={!!homeOpen}
              onClick={onHome}
            >
              <Home size={13} />
            </button>
          ) : null}
          {onGoBack ? (
            <button
              type="button"
              aria-label="Back"
              title="Back (⌘[)"
              disabled={!canGoBack}
              onClick={onGoBack}
            >
              <ChevronLeft size={13} />
            </button>
          ) : null}
          {onGoForward ? (
            <button
              type="button"
              aria-label="Forward"
              title="Forward (⌘])"
              disabled={!canGoForward}
              onClick={onGoForward}
            >
              <ChevronRight size={13} />
            </button>
          ) : null}
        </div>
        {compact && overflowActions.length > 0 ? (
          <button
            ref={moreAnchor}
            type="button"
            className="workspace-navigation-more"
            aria-label="More navigation"
            title="More navigation"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        ) : null}
      </div>
      {menuOpen ? (
        <Popover
          anchor={moreAnchor}
          side="bottom"
          align="start"
          width={208}
          role="menu"
          aria-label="More navigation"
          className="workspace-navigation-menu"
          tabIndex={-1}
          autoFocus
          onDismiss={(reason) => closeMenu(reason === "escape")}
          onKeyDown={(event) => {
            menuKeys(event);
            if (event.key === "Tab") closeMenu(true);
          }}
        >
          {overflowActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                closeMenu(true);
                action.onSelect?.();
              }}
            >
              <action.icon size={14} aria-hidden />
              <span>{action.label}</span>
            </button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}

export const WorkspaceStatusBar = memo(function WorkspaceStatusBar({
  sessions,
  session,
  onSelectSession,
  onToggleSidebar,
  sidebarOpen,
  navigationInSidebar = false,
  onSearch,
  onNewBrowser,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  onHome,
  homeOpen,
  onToggleInspector,
  inspectorOpen,
  settingsView,
}: WorkspaceStatusBarProps) {
  const summary = useMemo(() => workspaceQueueSummary(sessions), [sessions]);
  const activity = useActivity();
  const unreadActivity = activity.filter(
    (entry) => entry.readAt === null,
  ).length;
  const [menu, setMenu] = useState<"queue" | null>(null);
  const showingSettings = !!settingsView;
  useEffect(() => {
    // The Activity anchor becomes compact when the header changes context.
    setMenu(null);
  }, [showingSettings]);
  const queueAnchor = useRef<HTMLButtonElement>(null);
  const panelTheme = useUsagePanelTheme(menu !== null);
  const dismiss = (
    anchor: { current: HTMLButtonElement | null },
    restore = false,
  ) => {
    setMenu(null);
    if (restore) anchor.current?.focus({ preventScroll: true });
  };
  const QueueIcon =
    showingSettings || summary.rows.length
      ? ListBullet
      : Check;

  return (
    <div
      className="workspace-status-bar"
      data-settings={showingSettings}
      aria-label="Workspace status"
      data-tauri-drag-region="false"
      onMouseDown={dragStatusBar}
    >
      {!navigationInSidebar ? (
        <WorkspaceNavigation
          onToggleSidebar={onToggleSidebar}
          sidebarOpen={sidebarOpen}
          onSearch={onSearch}
          onNewBrowser={onNewBrowser}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onHome={onHome}
          homeOpen={homeOpen}
        />
      ) : null}
      {/* Activity sits with navigation on the left in every layout. */}
      <button
        ref={queueAnchor}
        type="button"
        className="workspace-status-queue workspace-status-task"
        data-tauri-drag-region="false"
        aria-label={`Activity: ${summary.label}${unreadActivity ? ` · ${unreadActivity} unread` : ""}`}
        title={`Activity · ${summary.label}`}
        aria-haspopup="dialog"
        aria-expanded={menu === "queue"}
        onClick={() => setMenu(menu === "queue" ? null : "queue")}
      >
        {!showingSettings ? (
          <span className="workspace-status-context">
            <ProviderMarks
              harnesses={session ? [sessionModelIdentity(session).harness] : []}
              busyHarnesses={
                session?.busy && !sessionNeedsInput(session)
                  ? [sessionModelIdentity(session).harness]
                  : []
              }
            />
            <span>
              {session
                ? sessionModelName(sessionModelIdentity(session))
                : "Aven"}
            </span>
          </span>
        ) : null}
        <QueueIcon size={12} aria-hidden />
        <span className="sr-only">{summary.label}</span>
        {unreadActivity > 0 ? (
          <span className="workspace-status-unread">
            {unreadActivity > 99 ? "99+" : unreadActivity}
          </span>
        ) : null}
      </button>
      {!navigationInSidebar && import.meta.env.DEV ? (
        <div className="workspace-status-development">
          <DevModeSlot />
        </div>
      ) : null}
      {settingsView ? (
        <div className="workspace-status-settings">
          <button
            type="button"
            className="workspace-status-pill workspace-status-settings-back"
            aria-label="Back to workspace"
            title="Back to workspace"
            data-tauri-drag-region="false"
            onClick={settingsView.onClose}
          >
            <ChevronLeft size={14} aria-hidden />
          </button>
          <div className="workspace-status-settings-path">
            <span>Settings</span>
            <ChevronRight size={11} aria-hidden />
            <strong>{settingsSectionLabel(settingsView.section)}</strong>
          </div>
        </div>
      ) : null}
      <div
        className="workspace-status-controls"
        role="group"
        aria-label="Workspace tools"
        data-tauri-drag-region="false"
      >
        <div className="workspace-status-layout">
          {settingsView ? (
            <button
              type="button"
              aria-label="Close settings"
              title="Close settings"
              onClick={settingsView.onClose}
              data-tauri-drag-region="false"
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
          {onToggleInspector ? (
            <button
              type="button"
              aria-label="Toggle file sidebar"
              title={inspectorOpen ? "Hide file sidebar" : "Show file sidebar"}
              data-inspector-toggle
              aria-pressed={!!inspectorOpen}
              onClick={onToggleInspector}
            >
              <PanelRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
      {!IS_MAC ? <WindowControls /> : null}

      {menu === "queue" ? (
        <Popover
          anchor={queueAnchor}
          side="bottom"
          width={360}
          align="end"
          panel
          autoFocus
          tabIndex={-1}
          role="dialog"
          aria-label="Activity"
          className="workspace-status-panel"
          onDismiss={(reason) => dismiss(queueAnchor, reason === "escape")}
        >
          <ActivityPanel
            theme={panelTheme}
            onClose={() => dismiss(queueAnchor, true)}
            sessions={sessions}
            onOpen={async (entry) => {
              const opened = await onSelectSession(entry.sessionId);
              if (opened) setMenu(null);
              return opened;
            }}
            onOpenSession={async (id) => {
              const opened = await onSelectSession(id);
              if (opened) setMenu(null);
              return opened;
            }}
          />
        </Popover>
      ) : null}

    </div>
  );
});
