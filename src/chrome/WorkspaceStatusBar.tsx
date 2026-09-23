import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ProviderMarks } from "./ProviderMarks";
import { AccessPicker } from "./AccessPicker";
import { WindowControls } from "./WindowControls";
import { DevModeSlot } from "./TitleBar";
import { IS_MAC } from "../lib/platform";
import { settingsSectionLabel, type SettingsSectionId } from "../lib/settings";
import { Popover } from "./Popover";
import { supportsWorkspaceNativeMenu } from "../lib/workspaceNativeMenu";
import { useWorkspaceMenuPanel } from "../hooks/useWorkspaceMenuPanel";
import { WorkspaceMenuPanelContent } from "./WorkspaceMenuPanel";
import {
  nativeUsagePanel,
  useUsagePanelTheme,
  type UsagePanelSnapshot,
} from "../lib/usagePanel";
import { UsagePanelContent } from "./UsagePanel";
import { ActivityPanel } from "./ActivityPanel";
import { useActivity } from "../lib/activity";
import { sessionModelIdentity, sessionModelName } from "../lib/sessionLabels";
import {
  Check,
  ChevronDown,
  ExternalLink,
  ListBullet,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Globe,
  Home,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  X,
  Zap,
} from "./icons";
import {
  HARNESS_TITLE,
  sessionDisplayTitle,
  sessionNeedsInput,
  type RuntimeMode,
  type Session,
} from "../lib/session";
import {
  contextPercent,
  contextTooltip,
  formatTokens,
} from "../lib/contextUsage";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  shouldFetchProvider,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../lib/rateLimits";
import "./WorkspaceStatusBar.css";

/** Actions are provided by the app. The status strip never infers or runs commands. */
export type WorkspaceStatusAction = {
  id: string;
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  description?: string;
};

export type WorkspaceStatusBarProps = {
  sessions: readonly Session[];
  session?: Session;
  accessMode: RuntimeMode;
  onAccessModeChange: (mode: RuntimeMode) => void;
  onSelectSession: (id: string) => boolean | Promise<boolean>;
  usageProviders?: readonly RateLimitProvider[];
  /** Only supply a measured provider-reported USD cost; absent means unknown. */
  costUsd?: number | null;
  openActions?: readonly WorkspaceStatusAction[];
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
  onOpenSettings?: () => void;
  /** Settings shares the window header instead of stacking a second toolbar. */
  settingsView?: { section: SettingsSectionId; onClose: () => void };
  /** The workspace's existing task/browser tabs can share this window header. */
  workspaceTabs?: ReactNode;
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

export function reportedCostLabel(cost: number | null | undefined) {
  if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
  if (cost > 0 && cost < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cost);
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

const NO_ACTIONS: readonly WorkspaceStatusAction[] = [];
const NO_PROVIDERS: readonly RateLimitProvider[] = [];
const documentVisible = () => document.visibilityState !== "hidden";

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
              <PanelLeft size={15} />
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
              <Search size={15} />
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
              <Globe size={15} />
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
              <Home size={14} />
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
              <ChevronLeft size={14} />
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
              <ChevronRight size={14} />
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
            <MoreHorizontal size={15} />
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
              <action.icon size={15} aria-hidden />
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
  accessMode,
  onAccessModeChange,
  onSelectSession,
  usageProviders = NO_PROVIDERS,
  costUsd,
  openActions = NO_ACTIONS,
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
  onOpenSettings,
  settingsView,
  workspaceTabs,
}: WorkspaceStatusBarProps) {
  const summary = useMemo(() => workspaceQueueSummary(sessions), [sessions]);
  const activity = useActivity();
  const unreadActivity = activity.filter(
    (entry) => entry.readAt === null,
  ).length;
  const nativeMenus = supportsWorkspaceNativeMenu();
  const [nativeMenuError, setNativeMenuError] = useState<string | null>(null);
  const [menu, setMenu] = useState<"queue" | "usage" | "open" | null>(null);
  const showingSettings = !!settingsView;
  const hasWorkspaceTabs = workspaceTabs != null && workspaceTabs !== false;
  useEffect(() => {
    // The Activity anchor becomes compact when the header changes context.
    setMenu((current) => (current === "queue" ? null : current));
  }, [showingSettings]);
  const [usageMetric, setUsageMetric] = useState<"cost" | "context">("context");
  const queueAnchor = useRef<HTMLButtonElement>(null);
  const usageAnchor = useRef<HTMLButtonElement>(null);
  const openAnchor = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const usageApi = useRef<Promise<
    typeof import("../lib/rateLimitsFetch")
  > | null>(null);
  const inflight = useRef(new Map<RateLimitProvider, Promise<void>>());
  const [limits, setLimits] = useState<
    Partial<Record<RateLimitProvider, ProviderRateLimits>>
  >({});
  const limitsRef = useRef(limits);
  const providerKey = [...new Set(usageProviders)].sort().join(",");
  const providers = useMemo(
    () => (providerKey ? (providerKey.split(",") as RateLimitProvider[]) : []),
    [providerKey],
  );
  const context = session?.context;
  const validContext =
    context && Number.isFinite(context.used) && context.used >= 0
      ? {
          used: context.used,
          window:
            context.window != null &&
            Number.isFinite(context.window) &&
            context.window > 0
              ? context.window
              : undefined,
        }
      : undefined;
  const percent = contextPercent(validContext);
  const contextCopy = validContext ? contextTooltip(validContext) : null;
  const costLabel = reportedCostLabel(costUsd);
  const costTitle = costLabel ? `Reported task cost: ${costLabel} USD` : null;
  const showContextUsage = !!validContext || providers.length > 0;
  const contextLabel =
    percent != null
      ? `${percent}%`
      : validContext
        ? formatTokens(validContext.used)
        : "Usage";
  const contextTitle = contextCopy
    ? `${contextCopy.headline} · ${contextCopy.detail}`
    : `View ${providers.map((provider) => HARNESS_TITLE[provider]).join(" and ")} account usage`;

  useEffect(() => {
    if (
      menu === "usage" &&
      (usageMetric === "cost" ? !costLabel : !showContextUsage)
    )
      setMenu(null);
  }, [menu, usageMetric, costLabel, showContextUsage]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const requestUsage = useCallback(
    (
      provider: RateLimitProvider,
      force = false,
      allowHidden = false,
    ): Promise<void> => {
      const pending = inflight.current.get(provider);
      if (pending) return pending;
      if (!allowHidden && !documentVisible()) return Promise.resolve();
      const current = limitsRef.current[provider] ?? idleRateLimits(provider);
      if (!shouldFetchProvider(current, { force, visible: true }))
        return Promise.resolve();
      const publish = (value: ProviderRateLimits) => {
        if (!alive.current) return;
        limitsRef.current = { ...limitsRef.current, [provider]: value };
        setLimits(limitsRef.current);
      };
      const work = async () => {
        publish(fetchingRateLimits(provider, current));
        try {
          usageApi.current ??= import("../lib/rateLimitsFetch").catch(
            (error) => {
              usageApi.current = null;
              throw error;
            },
          );
          const api = await usageApi.current;
          if (!alive.current) return;
          if (!allowHidden && !documentVisible()) {
            publish(current);
            return;
          }
          const value = await (provider === "claude"
            ? api.fetchClaudeRateLimits()
            : api.fetchCodexRateLimits());
          publish(value);
        } catch (error) {
          publish(
            errorRateLimits(
              provider,
              error instanceof Error ? error.message : "Usage unavailable",
              current,
            ),
          );
        } finally {
          inflight.current.delete(provider);
        }
      };
      const promise = work();
      inflight.current.set(provider, promise);
      return promise;
    },
    [],
  );

  const panelTheme = useUsagePanelTheme(menu !== null);
  const panelSnapshot = useMemo<UsagePanelSnapshot>(
    () => ({
      context: validContext ?? null,
      costUsd: costLabel ? (costUsd ?? null) : null,
      providers: providers.map(
        (provider) => limits[provider] ?? idleRateLimits(provider),
      ),
      theme: panelTheme,
      // Only measured usage changes matter, not transcript renders.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [
      context?.used,
      context?.window,
      costUsd,
      costLabel,
      limits,
      providers,
      panelTheme,
    ],
  );
  const panelSnapshotRef = useRef(panelSnapshot);
  panelSnapshotRef.current = panelSnapshot;
  const panelOpen = useRef<string | null>(null);
  const panelOperations = useRef(Promise.resolve());
  const refreshUsage = useCallback(() => {
    for (const provider of providers)
      void requestUsage(provider, true, nativeMenus);
  }, [providers, requestUsage, nativeMenus]);
  const refreshUsageRef = useRef(refreshUsage);
  refreshUsageRef.current = refreshUsage;

  useEffect(() => {
    if (menu !== "usage") return;
    // Opening the owned panel is an explicit request, even if it takes focus
    // from its parent. There is no background polling.
    for (const provider of providers)
      void requestUsage(provider, false, nativeMenus);
  }, [menu, providers, requestUsage, nativeMenus]);

  useEffect(() => {
    if (!nativeMenus || menu !== "usage") return;
    const anchor = usageAnchor.current;
    if (!anchor) return;
    let cancelled = false;
    const stops: (() => void)[] = [];
    setNativeMenuError(null);
    const report = () => {
      if (!cancelled && alive.current) {
        setNativeMenuError("Could not open usage. Try again.");
        setMenu(null);
      }
    };
    let openId: string | null = null;
    let finished = false;
    type PanelEvent = { label: string; action?: string };
    const pending: PanelEvent[] = [];
    const receive = (event: PanelEvent) => {
      if (cancelled || finished) return;
      if (!openId) {
        pending.push(event);
        return;
      }
      if (event.label !== openId) return;
      if (event.action === "refresh") {
        refreshUsageRef.current();
      } else if (event.action === undefined) {
        finished = true;
        panelOpen.current = null;
        setMenu(null);
      }
    };
    const subscribe = async (name: string) => {
      const stop = await nativeUsagePanel.listen<PanelEvent>(name, receive);
      if (cancelled) stop();
      else stops.push(stop);
    };
    const open = async () => {
      if (cancelled) return;
      await subscribe("usage-panel-action");
      if (cancelled) return;
      await subscribe("usage-panel-closed");
      if (cancelled) return;
      openId = await nativeUsagePanel.open(anchor, panelSnapshotRef.current);
      if (cancelled) return;
      panelOpen.current = openId;
      pending.splice(0).forEach(receive);
      if (!finished)
        await nativeUsagePanel.update(panelSnapshotRef.current, openId);
    };
    panelOperations.current = panelOperations.current
      .catch(() => {})
      .then(open)
      .catch(report);
    return () => {
      cancelled = true;
      stops.splice(0).forEach((stop) => stop());
      // Serialize open/close so a late opening cannot close its replacement.
      panelOperations.current = panelOperations.current
        .catch(() => {})
        .then(async () => {
          if (panelOpen.current === openId) panelOpen.current = null;
          if (openId) await nativeUsagePanel.close(openId);
        })
        .catch(() => {});
    };
  }, [menu, usageMetric, nativeMenus]);

  useEffect(() => {
    if (!nativeMenus || menu !== "usage" || !panelOpen.current) return;
    void nativeUsagePanel
      .update(panelSnapshot, panelOpen.current)
      .catch(() => {});
  }, [panelSnapshot, menu, nativeMenus]);

  const openSnapshot = useMemo(
    () => ({
      title: "Open workspace",
      items: openActions.map(
        ({ id, label, description, disabled, onSelect }) => ({
          id,
          label,
          description,
          disabled: !!disabled || !onSelect,
        }),
      ),
      theme: panelTheme,
    }),
    [openActions, panelTheme],
  );
  const selectOpenAction = (id: string) => {
    const action = openActions.find((item) => item.id === id);
    if (!action?.onSelect || action.disabled) return;
    setMenu(null);
    action.onSelect();
  };
  useWorkspaceMenuPanel({
    open: nativeMenus && menu === "open",
    anchor: openAnchor,
    snapshot: openSnapshot,
    onSelect: selectOpenAction,
    onClose: () => setMenu(null),
    onError: () => {
      setNativeMenuError("Could not open menu. Try again.");
      setMenu(null);
    },
  });

  const toggleUsage = (
    event: MouseEvent<HTMLButtonElement>,
    metric: "cost" | "context",
  ) => {
    const sameAnchor = usageAnchor.current === event.currentTarget;
    usageAnchor.current = event.currentTarget;
    setUsageMetric(metric);
    setMenu(menu === "usage" && sameAnchor ? null : "usage");
  };
  const dismiss = (
    anchor: { current: HTMLButtonElement | null },
    restore = false,
  ) => {
    setMenu(null);
    if (restore) anchor.current?.focus({ preventScroll: true });
  };
  const canOpenMenu = openActions.some(
    (action) => !!action.onSelect && !action.disabled,
  );
  const QueueIcon =
    showingSettings || hasWorkspaceTabs || summary.rows.length
      ? ListBullet
      : Check;

  return (
    <div
      className="workspace-status-bar"
      data-settings={showingSettings}
      data-has-workspace-tabs={hasWorkspaceTabs}
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
      {hasWorkspaceTabs ? (
        <div className="workspace-status-tabs" data-tauri-drag-region="false">
          {workspaceTabs}
        </div>
      ) : null}
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
        {!showingSettings && !hasWorkspaceTabs ? (
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
      <div
        className="workspace-status-controls"
        role="group"
        aria-label="Workspace tools"
        data-tauri-drag-region="false"
      >
        {costLabel ? (
          <button
            type="button"
            className="workspace-status-pill workspace-status-metric"
            aria-label="Task cost and usage"
            title={costTitle ?? undefined}
            onClick={(event) => toggleUsage(event, "cost")}
            aria-haspopup="dialog"
            aria-expanded={menu === "usage" && usageMetric === "cost"}
          >
            {costLabel}
          </button>
        ) : null}
        {showContextUsage ? (
          <button
            type="button"
            className="workspace-status-pill workspace-status-metric"
            aria-label="Context and provider usage"
            title={contextTitle}
            onClick={(event) => toggleUsage(event, "context")}
            aria-haspopup="dialog"
            aria-expanded={menu === "usage" && usageMetric === "context"}
          >
            {contextLabel}
          </button>
        ) : null}
        <div className="workspace-status-access">
          <AccessPicker
            native
            value={accessMode}
            onChange={onAccessModeChange}
            busy={!!session?.busy}
            triggerIcon={Zap}
            compact
            side="bottom"
          />
        </div>
        <button
          ref={openAnchor}
          type="button"
          className="workspace-status-pill workspace-status-open"
          aria-label="Open workspace externally"
          title={
            canOpenMenu
              ? "Open workspace externally"
              : "No external actions available"
          }
          disabled={!canOpenMenu}
          aria-haspopup="menu"
          aria-expanded={menu === "open"}
          onClick={() => {
            setNativeMenuError(null);
            setMenu(menu === "open" ? null : "open");
          }}
        >
          <ExternalLink size={12} aria-hidden />
          <span className="sr-only">Open</span>
          <ChevronDown size={10} aria-hidden />
        </button>
        <div className="workspace-status-layout">
          {settingsView ? (
            <button
              type="button"
              aria-label="Close settings"
              title="Close settings"
              onClick={settingsView.onClose}
              data-tauri-drag-region="false"
            >
              <X size={15} aria-hidden />
            </button>
          ) : onOpenSettings ? (
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              onClick={onOpenSettings}
            >
              <Settings size={15} />
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
              <PanelRight size={15} />
            </button>
          ) : null}
        </div>
      </div>
      {settingsView && !IS_MAC ? <WindowControls /> : null}

      {nativeMenuError ? (
        <span role="status" className="workspace-status-menu-error">
          {nativeMenuError}
        </span>
      ) : null}

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

      {menu === "open" && !nativeMenus ? (
        <Popover
          anchor={openAnchor}
          side="bottom"
          align="end"
          width={360}
          panel
          className="workspace-status-panel"
          onDismiss={(reason) => dismiss(openAnchor, reason === "escape")}
        >
          <WorkspaceMenuPanelContent
            snapshot={openSnapshot}
            onSelect={selectOpenAction}
            onClose={() => dismiss(openAnchor, true)}
          />
        </Popover>
      ) : null}

      {menu === "usage" && !nativeMenus ? (
        <Popover
          key={usageMetric}
          anchor={usageAnchor}
          side="bottom"
          align="end"
          width={360}
          autoFocus
          tabIndex={-1}
          role="dialog"
          aria-label="Task and provider usage"
          panel
          className="workspace-status-panel"
          onDismiss={(reason) => dismiss(usageAnchor, reason === "escape")}
        >
          <UsagePanelContent
            snapshot={panelSnapshot}
            onRefresh={refreshUsage}
            onClose={() => dismiss(usageAnchor, true)}
          />
        </Popover>
      ) : null}
    </div>
  );
});
