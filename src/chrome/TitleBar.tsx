import { BrowserTabIcon } from "./BrowserTabIcon";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  GripVertical,
  Inbox,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings,
  StickyNote,
  Terminal,
  X,
} from "./icons";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { basename } from "../lib/fs";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { looksLikeProject } from "../lib/recents";
import { isProjectlessCwd } from "../lib/projectlessWorkspace";
import type { HarnessId } from "../lib/session";
import { getModelSnapshot, subscribeModels } from "../lib/models";
import {
  compactModelNames,
  sessionModelNames,
  type SessionModelIdentity,
} from "../lib/sessionLabels";
import { CwdPicker } from "./CwdPicker";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  useSortable,
  type SortablePointerPosition,
} from "../hooks/useSortable";
import { FileTypeIcon } from "./FileTypeIcon";
import { ProviderMarks } from "./ProviderMarks";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getName } from "@tauri-apps/api/app";
import { WindowControls } from "./WindowControls";
import { IS_MAC, MOD, SHIFT } from "../lib/platform";
import type { RecentProject } from "../lib/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import "./TitleBar.css";

export type Tab = {
  id: string;
  /** Project folder name, e.g. `agent-terminal`. */
  project: string;
  /** Original path used to resolve display metadata without changing identity. */
  projectPath?: string;
  /** Focused conversation title; empty for a fresh session. */
  title: string;
  /** Other conversation titles in this tab, focused session omitted. */
  more: string[];
  sessionCount: number;
  harnesses: HarnessId[];
  /** Harnesses with an in-flight turn in this tab. */
  busyHarnesses: HarnessId[];
  /** Actual session models, focused session first; never inferred from a default. */
  models?: SessionModelIdentity[];
  /** Open file basenames, active files first. */
  files: string[];
  /** Split layout with more than one pane in this tab. */
  multiPane?: boolean;
  /** Focus is on a file/terminal pane rather than a conversation pane. */
  fileFocused?: boolean;
  /** The sole pane is a fresh conversation with no user turn or open file. */
  blank?: boolean;
  /** Explicit tab group; absent means ungrouped. */
  groupId?: string;
  dirty?: boolean;
  terminal?: boolean;
};

export type TitleBarProps = {
  paneLocal?: boolean;
  /** This pane-local strip is hosted in the window's unified toolbar. */
  windowToolbar?: boolean;
  paneFocused?: boolean;
  onNewView?: (id: string) => void;
  onPictureInPicture?: (id: string) => void;
  onGroupPictureInPicture?: () => void;
  pictureInPictureIds?: string[];
  combineTargets?: Array<{ id: string; label: string }>;
  onCombineWith?: (targetId: string) => void;
  totalSessionTabs?: number;
  tabs: Tab[];
  activeId: string;
  cwd: string;
  projectRailOpen?: boolean;
  sidebarOpen?: boolean;
  browserOpen?: boolean;
  browserActive?: boolean;
  browserTitle?: string;
  browserMode?: "tab" | "split";
  browserTabs?: Array<{ id: string; title: string; favicon?: string }>;
  surfaceOrder?: string[];
  visibleIds?: string[];
  onReorderSurfaces?: (ids: string[], movedId?: string) => void;
  onSplitTab?: (
    id: string,
    edge: "left" | "right" | "up" | "down",
    targetId?: string,
  ) => void;
  onUnsplit?: () => void;
  onNewBrowser?: () => void;
  onSurfaceDragMove?: (
    id: string,
    x: number,
    y: number,
    pointer?: SortablePointerPosition,
  ) => void;
  groupId?: string;
  groupLabel?: string;
  onGroupDragMove?: (
    groupId: string,
    x: number,
    y: number,
    pointer?: SortablePointerPosition,
  ) => void;
  onGroupDragEnd?: (
    groupId: string,
    x: number,
    y: number,
    cancelled: boolean,
    pointer?: SortablePointerPosition,
  ) => boolean;
  windowTargets?: Array<{ id: string; label: string }>;
  onMoveTabToWindow?: (tabId: string, targetWindowId?: string) => void;
  onMoveGroupToWindow?: (groupId: string, targetWindowId?: string) => void;
  onReturnTabToWindow?: (tabId: string) => void;
  onReturnGroupToWindow?: (groupId: string) => void;
  onReopenClosedTab?: () => void;
  canReopenClosedTab?: boolean;
  onUndoLayout?: () => void;
  canUndoLayout?: boolean;
  onSurfaceDragEnd?: (
    id: string,
    x: number,
    y: number,
    cancelled: boolean,
    pointer?: SortablePointerPosition,
  ) => boolean;
  onSelectBrowser?: (id?: string) => void;
  onCloseBrowser?: (id?: string) => void;
  onBrowserModeChange?: (mode: "tab" | "split") => void;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  onToggleSidebar: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewTerminal?: () => void;
  onShowTerminal?: () => void;
  projectTerminalActive?: boolean;
  onOpenSettings?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onClose: (id: string) => void;
  onCloseMany: (ids: string[], fallbackId: string) => void;
  onReorder: (ids: string[], movedId?: string) => void;
  onGoToFile?: () => void;
  recents?: RecentProject[];
  onSelectProject?: (path: string) => void;
};

function sessionMeta(tab: Tab): string {
  if (tab.more.length === 1) return tab.more[0];
  if (tab.sessionCount > 1) return `${tab.sessionCount} sessions`;
  return "";
}

export function tabCopy(
  tab: Tab,
  projectless = false,
): {
  headline: string;
  meta: string;
  tooltip: string;
} {
  const project = tab.project.trim() || "~";
  const conversation = tab.title.trim();
  const file = tab.files[0] ?? "";
  const sessions = sessionMeta(tab);
  const modelNames = sessionModelNames(tab.models);
  const models = compactModelNames(modelNames);
  const untitled = models || "New session";

  let headline: string;
  const metaParts: string[] = [];

  if (tab.multiPane) {
    // A file has its own inner tab. Keep its parent named for the task even
    // while the editor or terminal owns focus, so the two levels stay distinct.
    if (conversation) {
      headline = conversation;
      if (file) metaParts.push(file);
      else if (sessions) metaParts.push(sessions);
    } else if (file) {
      headline = file;
      if (sessions) metaParts.push(sessions);
    } else {
      headline = untitled;
      if (sessions) metaParts.push(sessions);
    }
  } else {
    headline = conversation || file || untitled;
    if (sessions) metaParts.push(sessions);
  }

  if (models && headline !== models) metaParts.unshift(models);
  const meta = metaParts.join(" · ");

  const tooltipParts = projectless ? [] : [project];
  if (conversation) tooltipParts.push(conversation);
  else if (projectless && !models) tooltipParts.push(headline);
  tooltipParts.push(...tab.more);
  tooltipParts.push(...modelNames);
  if (tab.files.length > 0) tooltipParts.push(tab.files.join(", "));
  if (tab.dirty) tooltipParts.push("Unsaved changes");

  return { headline, meta, tooltip: tooltipParts.join(" · ") };
}

/** Which tab-strip edges still have overflow to scroll toward. */
export function tabStripOverflow(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: boolean; right: boolean } {
  const maxScroll = scrollWidth - clientWidth;
  if (maxScroll <= 1) return { left: false, right: false };
  return {
    left: scrollLeft > 1,
    right: scrollLeft < maxScroll - 1,
  };
}

export function titleTabClosable(tab: Tab, tabCount: number): boolean {
  return tabCount > 1 || !tab.blank;
}

/** Keep saved mixed ordering valid as sessions and browser tabs open or close. */
export function titleSurfaceOrder(
  sessionIds: readonly string[],
  browserIds: readonly string[],
  saved: readonly string[] = [],
): string[] {
  const available = new Set([...sessionIds, ...browserIds]);
  const ordered = new Set(saved.filter((id) => available.has(id)));
  for (const id of available) ordered.add(id);
  return [...ordered];
}

const LEGACY_BROWSER_ID = "__personal_browser_preview__";

export type TitleTabContextAction = "others" | "right" | "left";

/** Tab ids affected by a context-menu action relative to its clicked tab. */
export function titleTabContextCloseIds(
  tabs: readonly Tab[],
  targetId: string,
  action: TitleTabContextAction,
): string[] {
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) return [];
  if (action === "left") {
    return tabs.slice(0, targetIndex).map((tab) => tab.id);
  }
  if (action === "right") {
    return tabs.slice(targetIndex + 1).map((tab) => tab.id);
  }
  return tabs.filter((tab) => tab.id !== targetId).map((tab) => tab.id);
}

type SortableApi = ReturnType<typeof useSortable>;
type MenuPoint = Pick<ReactMouseEvent, "clientX" | "clientY">;

function TitleTabItem({
  tab,
  projectless,
  index,
  active,
  visible,
  closable,
  canDrag,
  sortable,
  onSelect,
  onClose,
  onContextMenu,
  itemRef,
}: {
  tab: Tab;
  projectless: boolean;
  index: number;
  active: boolean;
  visible: boolean;
  closable: boolean;
  canDrag: boolean;
  sortable: SortableApi;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string, event: MenuPoint) => void;
  itemRef?: (el: HTMLDivElement | null) => void;
}) {
  const { headline, meta, tooltip } = tabCopy(tab, projectless);
  const fileIcon = tab.files[0];
  const showStart =
    canDrag &&
    sortable.draggingId &&
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    sortable.toIndex < sortable.fromIndex;
  const showEnd =
    canDrag &&
    sortable.draggingId &&
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    sortable.toIndex > sortable.fromIndex;

  return (
    <div
      ref={(el) => {
        sortable.setItemRef(tab.id, el);
        itemRef?.(el);
      }}
      className="personal-title-tab group @container relative flex h-full cursor-default touch-none items-center self-stretch min-w-0 w-full"
      data-active={active}
      data-visible={visible}
      data-has-models={Boolean(tab.models?.length)}
      data-surface-id={tab.id}
      data-surface-tab-id={tab.id}
      data-tauri-drag-region="false"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(tab.id, event);
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).getAttribute("role") !== "tab")
          return;
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextMenu(tab.id, { clientX: rect.left, clientY: rect.bottom });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement | null)?.closest("[data-no-drag]")) {
          return;
        }
        if (canDrag) sortable.onItemPointerDown(tab.id, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        if (!sortable.consumeClick()) onSelect(tab.id);
      }}
    >
      {showStart ? (
        <div className="pointer-events-none absolute inset-y-1.5 left-0 z-20 w-0.5 rounded-full bg-accent" />
      ) : null}
      {showEnd ? (
        <div className="pointer-events-none absolute inset-y-1.5 right-0 z-20 w-0.5 rounded-full bg-accent" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        <button
          type="button"
          title={tooltip}
          aria-label={tooltip}
          role="tab"
          aria-selected={active}
          aria-description={visible && !active ? "Visible in split" : undefined}
          data-tauri-drag-region="false"
          className={`personal-title-tab-button relative flex h-7.5 min-w-0 flex-1 cursor-default items-center gap-1.5 self-center rounded-md px-2.5 text-left ${
            closable ? "pr-7" : "pr-2.5"
          } ${
            active
              ? "bg-content/10 text-content"
              : "text-content/50 hover:bg-content/5 hover:text-content"
          }`}
        >
          <span className="personal-title-tab-number" aria-hidden>
            {index + 1}
          </span>
          <span
            className="personal-title-tab-identity"
            data-busy={tab.busyHarnesses.length > 0}
          >
            {tab.harnesses.length > 0 ? (
              <ProviderMarks
                harnesses={tab.harnesses}
                busyHarnesses={tab.busyHarnesses}
                dimmed={!active}
              />
            ) : tab.terminal || !fileIcon ? (
              <Terminal
                className={`size-3.5 shrink-0 ${
                  active ? "text-content" : "text-content/55"
                }`}
                strokeWidth={1.75}
              />
            ) : (
              <span className={!active ? "opacity-55" : undefined}>
                <FileTypeIcon name={fileIcon} isDir={false} size={14} />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="flex min-w-0 items-center gap-1">
              <span
                className={`personal-title-tab-label min-w-0 truncate leading-none ${
                  meta
                    ? "text-[13px] @min-[11rem]:text-[10px] @min-[11rem]:font-medium"
                    : "text-[13px]"
                }`}
              >
                {headline}
              </span>
              {visible && !active ? (
                <span className="personal-title-tab-visible" aria-hidden />
              ) : null}
              {tab.dirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-content/70"
                  title="Unsaved changes"
                  aria-label="Unsaved changes"
                />
              ) : null}
            </span>
            {meta ? (
              <span className="personal-title-tab-meta hidden min-w-0 truncate text-[10px] leading-none text-content/45 @min-[11rem]:block">
                {meta}
              </span>
            ) : null}
          </span>
        </button>
        {closable ? (
          <button
            type="button"
            title="Close Tab"
            aria-label={`Close ${headline}`}
            data-no-drag
            data-tauri-drag-region="false"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
            className="personal-title-tab-close absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/50 opacity-0 hover:bg-content/10 hover:text-content group-hover:opacity-100"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BrowserTitleTabItem({
  id,
  title,
  favicon,
  index,
  active,
  visible,
  legacy,
  canDrag,
  sortable,
  onSelect,
  onClose,
  onContextMenu,
  onMenu,
  menuOpen,
  itemRef,
}: {
  id: string;
  title: string;
  favicon?: string;
  index: number;
  active: boolean;
  visible: boolean;
  legacy: boolean;
  canDrag: boolean;
  sortable: SortableApi;
  onSelect: () => void;
  onClose?: () => void;
  onContextMenu: (event: MenuPoint) => void;
  onMenu?: (button: HTMLButtonElement) => void;
  menuOpen: boolean;
  itemRef?: (element: HTMLDivElement | null) => void;
}) {
  const label = title.trim() || "Browser";
  const dropBefore =
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    index < sortable.fromIndex;
  const dropAfter =
    sortable.toIndex === index &&
    sortable.fromIndex !== null &&
    index > sortable.fromIndex;
  return (
    <div
      ref={(element) => {
        sortable.setItemRef(id, element);
        itemRef?.(element);
      }}
      className="personal-title-tab personal-title-browser-tab group relative flex h-full min-w-0 touch-none items-center"
      data-active={active}
      data-visible={visible}
      data-surface-id={id}
      data-surface-tab-id={id}
      data-has-menu={Boolean(onMenu)}
      data-tauri-drag-region="false"
      onPointerDown={(event) => {
        if (canDrag) sortable.onItemPointerDown(id, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        if (!sortable.consumeClick()) onSelect();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event);
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).getAttribute("role") !== "tab")
          return;
        if (
          event.key !== "ContextMenu" &&
          !(event.shiftKey && event.key === "F10")
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onContextMenu({ clientX: rect.left, clientY: rect.bottom });
      }}
    >
      {dropBefore ? (
        <div className="pointer-events-none absolute inset-y-1.5 left-0 z-20 w-0.5 rounded-full bg-accent" />
      ) : null}
      {dropAfter ? (
        <div className="pointer-events-none absolute inset-y-1.5 right-0 z-20 w-0.5 rounded-full bg-accent" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        <button
          type="button"
          role="tab"
          aria-selected={active}
          aria-description={visible && !active ? "Visible in split" : undefined}
          aria-label={label === "Browser" ? "Browser" : `Browser: ${label}`}
          title={label}
          className="personal-title-tab-button personal-title-browser-button flex min-w-0 flex-1 items-center px-2.5"
        >
          <BrowserTabIcon favicon={favicon} />
          <span className="personal-title-tab-label min-w-0 truncate">
            {label}
          </span>
          {visible && !active ? (
            <span className="personal-title-tab-visible" aria-hidden />
          ) : null}
        </button>
        {onClose ? (
          <button
            type="button"
            title="Close browser"
            aria-label={legacy ? "Close browser" : `Close browser: ${label}`}
            data-no-drag
            onPointerDown={(event) => event.stopPropagation()}
            className="personal-title-tab-close personal-title-browser-close absolute top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/50 opacity-0 hover:bg-content/10 hover:text-content group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
        {onMenu ? (
          <button
            type="button"
            title="Browser layout"
            aria-label={legacy ? "Browser layout" : `Browser layout: ${label}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-no-drag
            onPointerDown={(event) => event.stopPropagation()}
            className="personal-title-browser-menu absolute right-0.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
            onClick={(event) => {
              event.stopPropagation();
              onMenu(event.currentTarget);
            }}
          >
            <ChevronDown className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TabStripChevron({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  const label = side === "left" ? "Scroll tabs left" : "Scroll tabs right";
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      data-tauri-drag-region="false"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`absolute top-1/2 z-40 grid size-6.5 -translate-y-1/2 place-items-center rounded-md bg-content/10 backdrop-blur-xl text-content/70 hover:bg-content/15 hover:text-content ${
        side === "left" ? "left-1" : "right-1"
      }`}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

export function IconButton({
  label,
  active,
  accent,
  disabled,
  onClick,
  inspectorToggle,
  children,
}: {
  label: string;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  inspectorToggle?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || accent}
      aria-disabled={disabled}
      data-tauri-drag-region="false"
      data-inspector-toggle={inspectorToggle || undefined}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      className={`personal-titlebar-tool grid size-6.5 place-items-center rounded-md ${
        disabled
          ? "text-content/25"
          : accent
            ? "text-accent hover:bg-content/10"
            : active
              ? "text-content hover:bg-content/10"
              : "text-content/50 hover:bg-content/10 hover:text-content"
      }`}
    >
      {children}
    </button>
  );
}

export function DevModeLabel() {
  if (!import.meta.env.DEV) return null;
  return (
    <span
      title="Development build"
      className="mr-1 min-w-0 truncate rounded-md bg-skill/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-skill"
    >
      Development
    </span>
  );
}

/** Flex spacer that keeps the Development badge next to the visit arrows. */
export function DevModeSlot() {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end">
      <DevModeLabel />
    </div>
  );
}

export function TabVisitNav({
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  onTogglePanel,
  panelActive = false,
  panelLabel = "Toggle Projects",
}: {
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onTogglePanel?: () => void;
  panelActive?: boolean;
  panelLabel?: string;
}) {
  return (
    <div className="flex shrink-0 items-center">
      <IconButton
        label={`Back (${MOD}[)`}
        disabled={!canGoBack}
        onClick={onGoBack}
      >
        <ChevronLeft className="size-3.5" strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label={`Forward (${MOD}])`}
        disabled={!canGoForward}
        onClick={onGoForward}
      >
        <ChevronRight className="size-3.5" strokeWidth={1.75} />
      </IconButton>
      {onTogglePanel ? (
        <IconButton
          label={panelLabel}
          active={panelActive}
          onClick={onTogglePanel}
        >
          <PanelLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

/** Back + rail toggle for overlay surfaces when the project rail is closed. */
export function OverlayNav({
  onBack,
  onToggleSidebar,
}: {
  onBack?: () => void;
  onToggleSidebar?: () => void;
}) {
  if (!onBack && !onToggleSidebar) return null;
  return (
    <div className="flex shrink-0 items-center px-1.5">
      {onBack ? (
        <IconButton label={`Back (${MOD}[)`} onClick={onBack}>
          <ChevronLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {onToggleSidebar ? (
        <IconButton
          label={`Toggle Sidebar (${MOD}B)`}
          onClick={onToggleSidebar}
        >
          <PanelLeft className="size-3.5" strokeWidth={1.75} />
        </IconButton>
      ) : null}
    </div>
  );
}

function dragWindowToolbar(event: ReactMouseEvent<HTMLElement>) {
  if (event.button !== 0 || event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof Element) || !event.currentTarget.contains(target))
    return;
  const control = target.closest(
    'button, input, textarea, select, a, [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [contenteditable]:not([contenteditable="false"]), [data-surface-tab-id], [data-no-drag], [data-tauri-drag-region="false"]',
  );
  // The header itself stays outside Tauri's deep drag region so native and
  // React handling cannot both start a gesture. Its interactive descendants
  // keep their own tab sorting, selection, menus and pointer behavior.
  if (control && control !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  const currentWindow = getCurrentWindow();
  const action =
    event.detail === 2
      ? currentWindow.toggleMaximize()
      : currentWindow.startDragging();
  void action.catch((error) => console.warn("Window gesture failed", error));
}

function TitleBarComponent({
  paneLocal = false,
  windowToolbar = false,
  paneFocused = true,
  onNewView,
  onPictureInPicture,
  onGroupPictureInPicture,
  pictureInPictureIds,
  combineTargets,
  onCombineWith,
  totalSessionTabs,
  tabs: sourceTabs,
  activeId,
  cwd,
  sidebarOpen = true,
  browserOpen = false,
  browserActive = false,
  browserTitle,
  browserMode = "tab",
  browserTabs,
  surfaceOrder,
  visibleIds,
  onReorderSurfaces,
  onSplitTab,
  onUnsplit,
  onNewBrowser,
  onSurfaceDragMove,
  onSurfaceDragEnd,
  groupId,
  groupLabel,
  onGroupDragMove,
  onGroupDragEnd,
  windowTargets = [],
  onMoveTabToWindow,
  onMoveGroupToWindow,
  onReturnTabToWindow,
  onReturnGroupToWindow,
  onReopenClosedTab,
  canReopenClosedTab = true,
  onUndoLayout,
  canUndoLayout = true,
  onSelectBrowser,
  onCloseBrowser,
  onBrowserModeChange,
  inspectorOpen = false,
  onToggleInspector,
  onToggleSidebar,
  onSelect,
  onNew,
  onNewTerminal,
  onShowTerminal,
  projectTerminalActive = false,
  onOpenSettings,
  onOpenInbox,
  onOpenNotes,
  onClose,
  onCloseMany,
  onReorder,
  onGoToFile,
  recents = [],
  onSelectProject,
}: TitleBarProps) {
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const projectLabels = useProjectLabels();
  const tabs = useMemo(
    () =>
      sourceTabs.map((tab) =>
        tab.projectPath
          ? {
              ...tab,
              project: projectDisplayName(
                tab.projectPath,
                projectLabels,
                tab.project,
              ),
            }
          : tab,
      ),
    [sourceTabs, projectLabels],
  );
  const sessionTabCount = totalSessionTabs ?? tabs.length;
  const projectlessWorkspace = isProjectlessCwd(cwd);
  const tabIds = tabs.map((tab) => tab.id);
  const unified = browserTabs !== undefined;
  const browserEntries =
    browserTabs ??
    (browserOpen
      ? [{ id: LEGACY_BROWSER_ID, title: browserTitle ?? "Browser" }]
      : []);
  const orderedIds = titleSurfaceOrder(
    tabIds,
    browserEntries.map((tab) => tab.id),
    surfaceOrder,
  );
  const focusedId = unified
    ? activeId
    : browserActive
      ? LEGACY_BROWSER_ID
      : activeId;
  const shownIds =
    visibleIds ??
    (!unified && browserOpen && browserMode === "split"
      ? [activeId, LEGACY_BROWSER_ID]
      : [focusedId]);
  const shown = new Set(shownIds);
  const sessionTabs = new Map(tabs.map((tab) => [tab.id, tab]));
  const browsers = new Map(browserEntries.map((tab) => [tab.id, tab]));
  const sortable = useSortable(
    orderedIds,
    (ids, movedId) => {
      if (onReorderSurfaces) onReorderSurfaces(ids, movedId);
      else
        onReorder(
          ids.filter((id) => sessionTabs.has(id)),
          movedId && sessionTabs.has(movedId) ? movedId : undefined,
        );
    },
    {
      animate: true,
      onDragMove: onSurfaceDragMove,
      onDragEnd: onSurfaceDragEnd,
    },
  );
  const groupSortable = useSortable(groupId ? [groupId] : [], () => {}, {
    onDragMove: onGroupDragMove,
    onDragEnd: onGroupDragEnd,
  });
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const setTabStripRef = useCallback(
    (el: HTMLDivElement | null) => {
      tabStripRef.current = el;
      sortable.setContainerRef(el);
      lockOverscroll(el);
    },
    [lockOverscroll, sortable.setContainerRef],
  );
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [tabMenu, setTabMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const [browserMenu, setBrowserMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const syncTabOverflow = useCallback(() => {
    const el = tabStripRef.current;
    const next = el
      ? tabStripOverflow(el.scrollLeft, el.clientWidth, el.scrollWidth)
      : { left: false, right: false };
    setTabOverflow((prev) =>
      prev.left === next.left && prev.right === next.right ? prev : next,
    );
  }, []);
  const scrollTabsBy = useCallback((direction: -1 | 1) => {
    const el = tabStripRef.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.6, 112);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }, []);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const canDrag = orderedIds.length > 1 || Boolean(onSurfaceDragEnd);
  const previousSelectedId = useRef<string | null>(null);

  useEffect(() => {
    if (previousSelectedId.current === focusedId) return;
    previousSelectedId.current = focusedId;
    if (sortable.draggingId) return;
    activeTabRef.current?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [focusedId, sortable.draggingId]);

  useLayoutEffect(() => {
    const el = tabStripRef.current;
    if (!el) return;
    syncTabOverflow();
    el.addEventListener("scroll", syncTabOverflow, { passive: true });
    const ro = new ResizeObserver(syncTabOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncTabOverflow);
      ro.disconnect();
    };
  }, [syncTabOverflow]);

  const overflowSignature = JSON.stringify(
    orderedIds.map((id) => {
      const tab = sessionTabs.get(id);
      if (!tab) return [id, browsers.get(id)?.title];
      const { headline, meta } = tabCopy(tab, projectlessWorkspace);
      return [id, headline, meta, Boolean(tab.dirty)];
    }),
  );
  useLayoutEffect(() => {
    syncTabOverflow();
  }, [focusedId, overflowSignature, syncTabOverflow]);

  useEffect(() => {
    if (!browserOpen) setBrowserMenu(null);
  }, [browserOpen]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeId),
    [activeId, tabs],
  );
  const [productName, setProductName] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void getName()
      .catch(() => "Aven")
      .then((name) => {
        if (!disposed) setProductName(name === "Aven Dev" ? name : "Aven");
      });
    return () => {
      disposed = true;
    };
  }, []);
  const systemTitle = useMemo(() => {
    const activeName = activeTab
      ? activeTab.files[0]
        ? basename(activeTab.files[0])
        : activeTab.project
      : "";
    const project = cwd ? projectDisplayName(cwd, projectLabels) : "";
    if (activeName && project && activeName !== project) {
      return `${activeName} — ${project} — ${productName}`;
    }
    if (project) {
      return `${project} — ${productName}`;
    }
    return productName ?? "Aven";
  }, [activeTab, cwd, projectLabels, productName]);

  useEffect(() => {
    // Keep the native startup title until we know which app owns this window.
    if (!productName || (paneLocal && !paneFocused)) return;
    document.title = systemTitle;
    try {
      void getCurrentWindow()
        .setTitle(systemTitle)
        .catch(() => {});
    } catch {}
  }, [systemTitle, paneLocal, paneFocused, productName]);

  const contextTab = tabMenu ? sessionTabs.get(tabMenu.tabId) : undefined;
  const contextBrowser = tabMenu ? browsers.get(tabMenu.tabId) : undefined;
  const contextId = contextTab?.id ?? contextBrowser?.id;
  const orderedSessions = orderedIds.flatMap((id) => {
    const tab = sessionTabs.get(id);
    return tab ? [tab] : [];
  });
  const contextCloseIds = contextTab
    ? {
        others: titleTabContextCloseIds(
          orderedSessions,
          contextTab.id,
          "others",
        ),
        right: titleTabContextCloseIds(orderedSessions, contextTab.id, "right"),
        left: titleTabContextCloseIds(orderedSessions, contextTab.id, "left"),
      }
    : null;
  const selectSurface = (id: string) => {
    if (browsers.has(id)) onSelectBrowser?.(unified ? id : undefined);
    else onSelect(id);
  };
  const contextMenuItems: ExplorerMenuItem[] = [];
  const availableCombineTargets = (combineTargets ?? []).filter(
    (target) => target.id !== focusedId && shown.has(target.id),
  );
  const hasSurfaceMenu =
    unified ||
    onSplitTab ||
    onUnsplit ||
    onCombineWith ||
    onPictureInPicture ||
    onNewView;
  if (
    contextId &&
    onNewView &&
    !(onSplitTab && shown.has(contextId) && shown.size > 1)
  ) {
    contextMenuItems.push({
      kind: "item",
      id: "new-view",
      label: "Split right",
    });
  }
  if (
    contextId &&
    onPictureInPicture &&
    (!pictureInPictureIds || pictureInPictureIds.includes(contextId))
  )
    contextMenuItems.push({
      kind: "item",
      id: "picture-in-picture",
      label: "Picture in Picture",
    });
  if (contextId && onGroupPictureInPicture)
    contextMenuItems.push({
      kind: "item",
      id: "group-picture-in-picture",
      label: "Group Picture in Picture",
    });
  if (contextId && hasSurfaceMenu) {
    if (onSplitTab && contextId !== focusedId) {
      contextMenuItems.push({
        kind: "item",
        id: "beside",
        label: "Split right of current tab",
      });
    }
    if (onSplitTab && shown.has(contextId) && shown.size > 1) {
      contextMenuItems.push(
        { kind: "item", id: "move-left", label: "Split left" },
        { kind: "item", id: "move-right", label: "Split right" },
        { kind: "item", id: "move-up", label: "Split above" },
        { kind: "item", id: "move-down", label: "Split below" },
      );
    }
    contextMenuItems.push({
      kind: "item",
      id: "focus",
      label: "Focus this tab",
      disabled: contextId === focusedId && (!paneLocal || paneFocused),
    });
    if (onCombineWith && shown.size > 1)
      for (const target of availableCombineTargets)
        contextMenuItems.push({
          kind: "item",
          id: `combine:${target.id}`,
          label: `Combine with ${target.label}`,
        });
    if (onUnsplit && shown.size > 1)
      contextMenuItems.push({
        kind: "item",
        id: "unsplit",
        label: paneLocal ? "Combine all tabs" : "Return to single view",
      });
    contextMenuItems.push({ kind: "sep" });
  }
  if (contextId && onMoveTabToWindow) {
    contextMenuItems.push({
      kind: "item",
      id: "move-tab-new-window",
      label: "Move tab to new window",
    });
    for (const target of windowTargets)
      contextMenuItems.push({
        kind: "item",
        id: `move-tab-window:${target.id}`,
        label: `Move tab to ${target.label}`,
      });
  }
  if (groupId && onMoveGroupToWindow) {
    contextMenuItems.push({
      kind: "item",
      id: "move-group-new-window",
      label: "Move group to new window",
    });
    for (const target of windowTargets)
      contextMenuItems.push({
        kind: "item",
        id: `move-group-window:${target.id}`,
        label: `Move group to ${target.label}`,
      });
  }
  if (contextId && onReturnTabToWindow)
    contextMenuItems.push({
      kind: "item",
      id: "return-tab-window",
      label: "Return tab to original window",
    });
  if (groupId && onReturnGroupToWindow)
    contextMenuItems.push({
      kind: "item",
      id: "return-group-window",
      label: "Return group to original window",
    });
  if (onReopenClosedTab || onUndoLayout) {
    contextMenuItems.push({ kind: "sep" });
    if (onReopenClosedTab)
      contextMenuItems.push({
        kind: "item",
        id: "reopen-tab",
        label: "Reopen closed tab",
        shortcut: `${MOD}${SHIFT}T`,
        disabled: !canReopenClosedTab,
      });
    if (onUndoLayout)
      contextMenuItems.push({
        kind: "item",
        id: "undo-layout",
        label: "Undo layout change",
        disabled: !canUndoLayout,
      });
    contextMenuItems.push({ kind: "sep" });
  }
  if (contextId)
    contextMenuItems.push({
      kind: "item",
      id: "close",
      label: contextBrowser ? "Close Browser" : "Close Tab",
      shortcut: `${MOD}W`,
      disabled: contextTab
        ? !titleTabClosable(contextTab, sessionTabCount)
        : !onCloseBrowser,
    });
  if (contextTab)
    contextMenuItems.push(
      { kind: "sep" },
      {
        kind: "item",
        id: "others",
        label: unified ? "Close Other Sessions" : "Close Other Tabs",
        disabled: contextCloseIds?.others.length === 0,
      },
      {
        kind: "item",
        id: "right",
        label: unified
          ? "Close Sessions to the Right"
          : "Close Tabs to the Right",
        disabled: contextCloseIds?.right.length === 0,
      },
      {
        kind: "item",
        id: "left",
        label: unified
          ? "Close Sessions to the Left"
          : "Close Tabs to the Left",
        disabled: contextCloseIds?.left.length === 0,
      },
    );

  while (contextMenuItems[0]?.kind === "sep") contextMenuItems.shift();
  while (contextMenuItems[contextMenuItems.length - 1]?.kind === "sep")
    contextMenuItems.pop();
  const onPickTabMenu = (id: string) => {
    setTabMenu(null);
    if (id === "reopen-tab") {
      if (canReopenClosedTab) onReopenClosedTab?.();
      return;
    }
    if (id === "undo-layout") {
      if (canUndoLayout) onUndoLayout?.();
      return;
    }
    if (id === "move-group-new-window" && groupId) {
      onMoveGroupToWindow?.(groupId);
      return;
    }
    if (id === "return-group-window" && groupId) {
      onReturnGroupToWindow?.(groupId);
      return;
    }
    if (id.startsWith("move-group-window:") && groupId) {
      const target = id.slice("move-group-window:".length);
      if (windowTargets.some((item) => item.id === target))
        onMoveGroupToWindow?.(groupId, target);
      return;
    }
    if (!contextId) return;
    if (id === "move-tab-new-window") {
      onMoveTabToWindow?.(contextId);
    } else if (id === "return-tab-window") {
      onReturnTabToWindow?.(contextId);
    } else if (id.startsWith("move-tab-window:")) {
      const target = id.slice("move-tab-window:".length);
      if (windowTargets.some((item) => item.id === target))
        onMoveTabToWindow?.(contextId, target);
    } else if (id === "new-view") {
      onNewView?.(contextId);
    } else if (id === "picture-in-picture") {
      onPictureInPicture?.(contextId);
    } else if (id === "group-picture-in-picture") {
      onGroupPictureInPicture?.();
    } else if (id.startsWith("combine:")) {
      const targetId = id.slice("combine:".length);
      if (availableCombineTargets.some((target) => target.id === targetId))
        onCombineWith?.(targetId);
    } else if (id === "close") {
      if (contextBrowser) onCloseBrowser?.(unified ? contextId : undefined);
      else onClose(contextId);
    } else if (id === "focus") {
      selectSurface(contextId);
    } else if (id === "beside") {
      onSplitTab?.(contextId, "right", focusedId);
    } else if (id === "unsplit") {
      onUnsplit?.();
    } else if (id.startsWith("move-")) {
      const edge = id.slice(5);
      const target =
        shown.has(focusedId) && focusedId !== contextId
          ? focusedId
          : shownIds.find((other) => other !== contextId);
      if (
        edge === "left" ||
        edge === "right" ||
        edge === "up" ||
        edge === "down"
      )
        onSplitTab?.(contextId, edge, target);
    } else if (
      contextTab &&
      contextCloseIds &&
      (id === "others" || id === "right" || id === "left")
    ) {
      onCloseMany(contextCloseIds[id], contextTab.id);
    }
  };

  const railClosed = !sidebarOpen;
  const showCurrentProject = looksLikeProject(cwd);
  // Until a project is picked, the rail and the sidebar hide, so nothing
  // project-scoped is actionable and the window controls need room.
  const projectless = !showCurrentProject;
  // An open project is labeled in the sidebar, above Sessions / Explorer /
  // Changes. Without a project that sidebar is gone, so the picker stays here.
  const showProjectButton =
    !paneLocal && railClosed && Boolean(onSelectProject) && !showCurrentProject;
  const trailingControls = (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-0.5 px-2">
        {projectless && railClosed && onOpenInbox ? (
          <IconButton label="Inbox" onClick={onOpenInbox}>
            <Inbox className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {projectless && railClosed && onOpenNotes ? (
          <IconButton label="Notes" onClick={onOpenNotes}>
            <StickyNote className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {railClosed && !projectless ? (
          <>
            <IconButton label={`Go to File (${MOD}P)`} onClick={onGoToFile}>
              <Search className="size-3.5" strokeWidth={1.75} />
            </IconButton>
            <IconButton label={`New session (${MOD}T)`} onClick={onNew}>
              <Plus className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          </>
        ) : null}
        {!projectless && (onShowTerminal || onNewTerminal) ? (
          <IconButton
            label={
              projectTerminalActive ? "Terminal" : `New Terminal (${MOD}\`)`
            }
            accent={projectTerminalActive}
            onClick={
              projectTerminalActive
                ? (onShowTerminal ?? onNewTerminal)
                : onNewTerminal
            }
          >
            <Terminal className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {!sidebarOpen && onOpenSettings ? (
          <IconButton label={`Settings (${MOD},)`} onClick={onOpenSettings}>
            <Settings className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onToggleInspector ? (
          <IconButton
            inspectorToggle
            label={`${inspectorOpen ? "Hide" : "Show"} file panel (${MOD}${SHIFT}B)`}
            active={inspectorOpen}
            accent={false}
            onClick={onToggleInspector}
          >
            <PanelRight className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </div>
      {!IS_MAC ? <WindowControls /> : null}
    </div>
  );

  // "deep" drags from anywhere in the subtree. The bare attribute only drags
  // on a direct hit, which left every label and spacer dead. Tauri still
  // exempts buttons, links and inputs on its own.
  return (
    <header
      className="personal-titlebar flex h-10 shrink-0 select-none items-stretch border-b border-content/10"
      data-pane-local={paneLocal || undefined}
      data-pane-focused={paneFocused}
      data-tauri-drag-region={paneLocal ? "false" : "deep"}
      onMouseDown={paneLocal && windowToolbar ? dragWindowToolbar : undefined}
      onContextMenu={(event) => {
        if (!onReopenClosedTab && !onUndoLayout) return;
        event.preventDefault();
        setTabMenu({ tabId: focusedId, x: event.clientX, y: event.clientY });
      }}
    >
      {!paneLocal && !sidebarOpen && IS_MAC ? (
        <div className="w-[78px] shrink-0" />
      ) : null}
      {!paneLocal ? (
        <div className="flex shrink-0 items-center px-1.5">
          <IconButton
            label={`Toggle Sidebar (${MOD}B)`}
            active={sidebarOpen}
            onClick={onToggleSidebar}
          >
            <PanelLeft className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </div>
      ) : null}
      {!sidebarOpen && showProjectButton && onSelectProject ? (
        <CwdPicker
          cwd={cwd}
          recents={recents}
          placement="below"
          onCwdChange={onSelectProject}
          onNewTerminal={onNewTerminal}
          buttonClassName="flex h-full min-w-0 max-w-64 shrink items-center gap-2 px-6 text-left text-sm font-medium leading-tight"
        >
          <span className="min-w-0 truncate text-content/50">No project</span>
        </CwdPicker>
      ) : null}

      <div
        className={`flex min-w-0 flex-1 items-stretch${
          showProjectButton ? " border-l border-content/10" : ""
        }`}
      >
        {groupId &&
        orderedIds.length > 1 &&
        (onGroupDragEnd || onMoveGroupToWindow) ? (
          <button
            type="button"
            ref={(element) => groupSortable.setItemRef(groupId, element)}
            className="personal-tab-group-handle"
            data-tauri-drag-region="false"
            data-dragging={groupSortable.draggingId === groupId || undefined}
            aria-label={`Move group: ${groupLabel ?? "Tab group"} (${orderedIds.length} tabs)`}
            title={`Drag ${groupLabel ?? "group"} · ${orderedIds.length} tabs`}
            onPointerDown={(event) => {
              if (onGroupDragEnd)
                groupSortable.onItemPointerDown(groupId, event);
            }}
            onClick={(event) => {
              if (groupSortable.consumeClick()) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setTabMenu({ tabId: focusedId, x: rect.left, y: rect.bottom });
            }}
          >
            <GripVertical className="size-3" />
            {new Set(tabs.flatMap((tab) => tab.harnesses)).size > 1 ? (
              <ProviderMarks
                harnesses={tabs.flatMap((tab) => tab.harnesses)}
                busyHarnesses={tabs.flatMap((tab) => tab.busyHarnesses)}
              />
            ) : null}
            <span className="personal-tab-group-label">
              {groupLabel ?? "Group"}
            </span>
          </button>
        ) : null}
        <div
          className="relative h-full min-w-0 flex-1 overflow-hidden"
          onWheel={(event) => {
            const el = tabStripRef.current;
            if (!el || el.scrollWidth <= el.clientWidth) return;
            if (event.deltaX === 0 && event.deltaY !== 0) {
              el.scrollLeft += event.deltaY;
            }
          }}
        >
          {tabOverflow.left ? (
            <TabStripChevron side="left" onClick={() => scrollTabsBy(-1)} />
          ) : null}
          {tabOverflow.right ? (
            <TabStripChevron side="right" onClick={() => scrollTabsBy(1)} />
          ) : null}
          <div
            ref={setTabStripRef}
            role="tablist"
            tabIndex={orderedIds.length ? -1 : 0}
            data-sortable-scroll-container
            aria-label="Workspace tabs"
            className="personal-tab-strip scrollbar-none flex h-full min-w-0 cursor-default items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-none px-1.5"
            onKeyDown={(event) => {
              const target = event.target as HTMLElement;
              if (
                target === event.currentTarget &&
                (onReopenClosedTab || onUndoLayout) &&
                (event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10"))
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setTabMenu({ tabId: focusedId, x: rect.left, y: rect.bottom });
                return;
              }
              if (target.getAttribute("role") !== "tab") return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              );
              const index = buttons.indexOf(target as HTMLButtonElement);
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % buttons.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + buttons.length) % buttons.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              buttons[next]?.focus();
              buttons[next]?.click();
            }}
          >
            {orderedIds.map((id, index) => {
              const tab = sessionTabs.get(id);
              const browser = browsers.get(id);
              const itemRef =
                id === focusedId
                  ? (element: HTMLDivElement | null) => {
                      activeTabRef.current = element;
                    }
                  : undefined;
              const openMenu = (x: number, y: number) => {
                setBrowserMenu(null);
                setTabMenu({ tabId: id, x, y });
              };
              if (tab)
                return (
                  <div
                    key={id}
                    className="personal-title-tab-slot relative flex h-full w-56 min-w-28 shrink cursor-default items-center"
                    data-tauri-drag-region="false"
                  >
                    <TitleTabItem
                      tab={tab}
                      projectless={projectlessWorkspace}
                      index={index}
                      active={id === focusedId}
                      visible={shown.has(id)}
                      closable={titleTabClosable(tab, sessionTabCount)}
                      canDrag={canDrag}
                      sortable={sortable}
                      onSelect={onSelect}
                      onClose={onClose}
                      onContextMenu={(_id, event) =>
                        openMenu(event.clientX, event.clientY)
                      }
                      itemRef={itemRef}
                    />
                  </div>
                );
              if (!browser) return null;
              return (
                <BrowserTitleTabItem
                  key={id}
                  id={id}
                  title={browser.title}
                  favicon={browser.favicon}
                  index={index}
                  active={id === focusedId}
                  visible={shown.has(id)}
                  legacy={!unified}
                  canDrag={
                    canDrag &&
                    (unified ||
                      Boolean(onReorderSurfaces) ||
                      Boolean(onSurfaceDragEnd))
                  }
                  sortable={sortable}
                  onSelect={() => onSelectBrowser?.(unified ? id : undefined)}
                  onClose={
                    onCloseBrowser
                      ? () => {
                          setBrowserMenu(null);
                          setTabMenu(null);
                          onCloseBrowser(unified ? id : undefined);
                        }
                      : undefined
                  }
                  onContextMenu={(event) =>
                    openMenu(event.clientX, event.clientY)
                  }
                  onMenu={
                    hasSurfaceMenu || onBrowserModeChange
                      ? (button) => {
                          const rect = button.getBoundingClientRect();
                          if (hasSurfaceMenu) {
                            if (tabMenu?.tabId === id) setTabMenu(null);
                            else openMenu(rect.left, rect.bottom + 4);
                          } else {
                            setTabMenu(null);
                            setBrowserMenu(
                              browserMenu
                                ? null
                                : { x: rect.left, y: rect.bottom + 4 },
                            );
                          }
                        }
                      : undefined
                  }
                  menuOpen={
                    tabMenu?.tabId === id || (!unified && Boolean(browserMenu))
                  }
                  itemRef={itemRef}
                />
              );
            })}
            {paneLocal ? (
              <button
                type="button"
                aria-label="New session"
                title="New session"
                data-tauri-drag-region="false"
                className="personal-title-session-new relative grid h-full shrink-0 place-items-center text-content/45 hover:text-content"
                onClick={onNew}
              >
                <Plus className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
            {onNewBrowser ||
            (browserEntries.length === 0 && onSelectBrowser) ? (
              <button
                type="button"
                aria-label={
                  paneLocal
                    ? "New browser"
                    : unified
                      ? "New browser tab"
                      : "Open browser"
                }
                title={
                  paneLocal
                    ? "New browser"
                    : unified
                      ? "New browser tab"
                      : "Open browser"
                }
                data-tauri-drag-region="false"
                className="personal-title-browser-new relative grid h-full shrink-0 place-items-center text-content/45 hover:text-content"
                onClick={() =>
                  onNewBrowser ? onNewBrowser() : onSelectBrowser?.()
                }
              >
                <Globe className="size-3.5" strokeWidth={1.75} />
                <Plus
                  className="personal-title-browser-plus absolute size-2"
                  strokeWidth={1.75}
                />
              </button>
            ) : null}
          </div>
        </div>

        {paneLocal || IS_MAC ? null : (
          <div className="flex min-w-0 flex-1 items-center justify-center px-4">
            <span className="pointer-events-none truncate text-[11.5px] font-medium text-content/40 select-none">
              {systemTitle}
            </span>
          </div>
        )}
        {paneLocal ? null : trailingControls}
      </div>
      {tabMenu && (contextId || onReopenClosedTab || onUndoLayout) ? (
        <ExplorerMenu
          native
          x={tabMenu.x}
          y={tabMenu.y}
          width={244}
          items={contextMenuItems}
          ariaLabel={
            contextId
              ? `Tab actions for ${contextTab ? tabCopy(contextTab).headline : contextBrowser?.title || "Browser"}`
              : "Workspace tab actions"
          }
          onPick={onPickTabMenu}
          onClose={() => setTabMenu(null)}
        />
      ) : null}
      {browserOpen && browserMenu && onBrowserModeChange ? (
        <ExplorerMenu
          native
          x={browserMenu.x}
          y={browserMenu.y}
          width={192}
          ariaLabel="Browser layout"
          items={[
            {
              kind: "item",
              id: "split",
              label: "Show beside session",
              checked: browserMode === "split",
            },
            {
              kind: "item",
              id: "tab",
              label: "Show as tab",
              checked: browserMode === "tab",
            },
          ]}
          onPick={(id) => {
            setBrowserMenu(null);
            if (id === "tab" || id === "split") onBrowserModeChange(id);
          }}
          onClose={() => setBrowserMenu(null)}
        />
      ) : null}
    </header>
  );
}

export const TitleBar = memo(TitleBarComponent);
