import { BrowserTabIcon } from "./BrowserTabIcon";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Globe,
  GripVertical,
  Inbox,
  PanelLeft,
  PanelRight,
  Pin,
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
  type CSSProperties,
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
import { useTabSlotMotion } from "../hooks/useTabSlotMotion";
import { FileTypeIcon } from "./FileTypeIcon";
import { ProviderMarks } from "./ProviderMarks";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getName } from "@tauri-apps/api/app";
import { WindowControls } from "./WindowControls";
import { IS_MAC, MOD, SHIFT } from "../lib/platform";
import type { RecentProject } from "../lib/recents";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { mergePreviewTabOrder, previewTabIds } from "../lib/previewTabs";
import {
  SURFACE_GROUP_COLORS,
  changeSurfaceGroup,
  chipGroupId,
  createSurfaceGroup,
  groupAfterDrop,
  loadSurfaceGroups,
  nextSurfaceGroupColor,
  orderFromDisplay,
  setSurfaceGroupMembership,
  setSurfaceGroupsCollapsed,
  stripDisplayIds,
  stripSegments,
  subscribeSurfaceGroups,
  surfaceGroupColor,
  ungroupSurfaceGroup,
  type SurfaceGroup,
} from "../lib/surfaceGroups";
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
  /** A session in this tab is waiting on an approval or question. */
  needsInput?: boolean;
  /** The tab holds one race's agents; `title` is the race prompt. */
  race?: boolean;
  dirty?: boolean;
  terminal?: boolean;
};

export type TitleBarProps = {
  paneLocal?: boolean;
  paneFocused?: boolean;
  onNewView?: (id: string) => void;
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
  browserTabs?: Array<{
    id: string;
    title: string;
    favicon?: string;
    kept?: boolean;
    url?: string;
  }>;
  onKeepBrowser?: (id: string) => void;
  /** Last selected page in this workspace, used when its header remounts. */
  browserPreviewId?: string | null;
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
  /** Moves a user tab group; its members may be a subset of this pane. */
  onMoveTabsToWindow?: (ids: string[], targetWindowId?: string) => void;
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
  onOpenRaceOverview?: (id: string) => void;
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
  tabStop,
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
  tabStop: boolean;
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
      data-has-meta={Boolean(meta) || undefined}
      data-surface-id={tab.id}
      data-surface-tab-id={tab.id}
      data-draggable={canDrag || undefined}
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
      onMouseDownCapture={(event) => {
        // Keep the middle button from starting autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !closable) return;
        event.preventDefault();
        event.stopPropagation();
        onClose(tab.id);
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
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 left-0 z-20 rounded-full" />
      ) : null}
      {showEnd ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 right-0 z-20 rounded-full" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        <button
          type="button"
          title={tooltip}
          aria-label={tooltip}
          role="tab"
          tabIndex={tabStop ? 0 : -1}
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
            {tab.race ? (
              <Flag
                className="personal-title-tab-race size-3.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
            ) : null}
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
          <span className="personal-title-tab-text flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <span className="flex min-w-0 items-center gap-1">
              {/* Defaults suit detached windows; inside the main window
                  TitleBar.css shows one 13px line, or two small lines on the
                  tab you're on once it is wide enough. */}
              <span className="personal-title-tab-label min-w-0 truncate text-[13px]">
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
              <span className="personal-title-tab-meta hidden min-w-0 truncate text-[10px]">
                {meta}
              </span>
            ) : null}
          </span>
        </button>
        {closable ? (
          <button
            type="button"
            tabIndex={tabStop ? 0 : -1}
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
  tabStop,
  visible,
  legacy,
  canDrag,
  sortable,
  onSelect,
  onClose,
  onContextMenu,
  onMenu,
  menuOpen,
  preview = false,
  onKeep,
  groupStyle,
  groupRun,
  opening = false,
  itemRef,
}: {
  id: string;
  title: string;
  favicon?: string;
  index: number;
  active: boolean;
  tabStop: boolean;
  visible: boolean;
  legacy: boolean;
  canDrag: boolean;
  sortable: SortableApi;
  onSelect: () => void;
  onClose?: () => void;
  onContextMenu: (event: MenuPoint) => void;
  onMenu?: (button: HTMLButtonElement) => void;
  menuOpen: boolean;
  preview?: boolean;
  onKeep?: () => void;
  /** Colour of the user tab group this page belongs to. */
  groupStyle?: CSSProperties;
  /** "run" continues the group underline to the next tab; "end" stops it. */
  groupRun?: "run" | "end";
  opening?: boolean;
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
      data-preview={preview || undefined}
      data-visible={visible}
      data-surface-id={id}
      data-surface-tab-id={id}
      data-draggable={canDrag || undefined}
      data-has-menu={Boolean(onMenu)}
      data-tab-group={groupRun}
      style={groupStyle}
      data-motion-slot={id}
      data-tab-opening={opening || undefined}
      data-tauri-drag-region="false"
      onMouseDownCapture={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || !onClose) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => {
        if (canDrag) sortable.onItemPointerDown(id, event);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        if (!sortable.consumeClick()) onSelect();
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
        onKeep?.();
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
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 left-0 z-20 rounded-full" />
      ) : null}
      {dropAfter ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 right-0 z-20 rounded-full" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        <button
          type="button"
          role="tab"
          tabIndex={tabStop ? 0 : -1}
          aria-selected={active}
          aria-description={
            preview
              ? "Preview tab. Keep open to retain in the tab strip."
              : visible && !active
                ? "Visible in split"
                : undefined
          }
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
            tabIndex={tabStop ? 0 : -1}
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
            tabIndex={tabStop ? 0 : -1}
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

/** A user tab group's label: click folds, double-click renames, drag moves the group. */
function TabGroupLabel({
  id,
  group,
  count,
  index,
  canDrag,
  sortable,
  renaming,
  menuOpen,
  onToggle,
  onRename,
  onStartRename,
  onMenu,
  opening = false,
}: {
  id: string;
  group: SurfaceGroup;
  count: number;
  index: number;
  canDrag: boolean;
  sortable: SortableApi;
  renaming: boolean;
  menuOpen: boolean;
  onToggle: () => void;
  /** Null cancels. */
  onRename: (name: string | null) => void;
  onStartRename: () => void;
  onMenu: (x: number, y: number, anchor?: HTMLElement) => void;
  opening?: boolean;
}) {
  const finished = useRef(false);
  useEffect(() => {
    if (renaming) finished.current = false;
  }, [renaming]);
  const finish = (name: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onRename(name);
  };
  const colorName = SURFACE_GROUP_COLORS[group.color]?.name ?? "Blue";
  const name = group.name || `${colorName} group`;
  const tabs = `${count} ${count === 1 ? "tab" : "tabs"}`;
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
      ref={(element) => sortable.setItemRef(id, element)}
      className="personal-tab-group-slot relative flex h-full shrink-0 touch-none items-center"
      data-motion-slot={id}
      data-tab-opening={opening || undefined}
      style={{ "--tab-group-color": surfaceGroupColor(group) } as CSSProperties}
      data-collapsed={group.collapsed}
      data-tauri-drag-region="false"
      onPointerDown={(event) => {
        if (canDrag && !renaming) sortable.onItemPointerDown(id, event);
      }}
    >
      {dropBefore ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 left-0 z-20 rounded-full" />
      ) : null}
      {dropAfter ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 right-0 z-20 rounded-full" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        {renaming ? (
          <input
            autoFocus
            className="personal-tab-group-rename"
            aria-label="Group name"
            placeholder="Name"
            defaultValue={group.name}
            maxLength={60}
            size={Math.max(6, group.name.length + 1)}
            onPointerDown={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                finish(event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                finish(null);
              }
            }}
            onBlur={(event) => finish(event.currentTarget.value)}
          />
        ) : (
          <button
            type="button"
            className="personal-tab-group-chip"
            data-empty={group.name ? undefined : "true"}
            data-collapsed={group.collapsed}
            aria-expanded={!group.collapsed}
            aria-haspopup="menu"
            data-menu-open={menuOpen || undefined}
            aria-label={`${name}, ${tabs}${group.collapsed ? ", folded" : ""}`}
            title={`${name} · ${tabs}. Click to ${
              group.collapsed ? "unfold" : "fold"
            }, double-click to rename`}
            onClick={() => {
              if (sortable.consumeClick()) return;
              onToggle();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onStartRename();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMenu(event.clientX, event.clientY, event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (event.key === "F2") {
                event.preventDefault();
                onStartRename();
              } else if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                onMenu(rect.left, rect.bottom, event.currentTarget);
              }
            }}
          >
            {group.name ? (
              <span className="personal-tab-group-chip-name">{group.name}</span>
            ) : null}
            {group.collapsed ? (
              <span className="personal-tab-group-chip-count">{count}</span>
            ) : null}
          </button>
        )}
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

function TitleBarComponent({
  paneLocal = false,
  paneFocused = true,
  onNewView,
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
  onKeepBrowser,
  browserPreviewId,
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
  onMoveTabsToWindow,
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
  onOpenRaceOverview,
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
  const browserEntries: NonNullable<TitleBarProps["browserTabs"]> =
    browserTabs ??
    (browserOpen
      ? [{ id: LEGACY_BROWSER_ID, title: browserTitle ?? "Browser" }]
      : []);
  const allOrderedIds = titleSurfaceOrder(
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
  const previousPreview = useRef<string | null>(browserPreviewId ?? null);
  const previewEnabled = Boolean(onKeepBrowser);
  const keptIds = new Set([
    ...tabIds,
    ...browserEntries
      .filter((tab) => tab.kept || (shown.has(tab.id) && tab.id !== focusedId))
      .map((tab) => tab.id),
  ]);
  // Keeping the preview must not bring an older background page back into the
  // strip. Switching to a conversation keeps the last preview in its slot.
  const remembered =
    previousPreview.current && browsers.has(previousPreview.current)
      ? previousPreview.current
      : browserPreviewId && browsers.has(browserPreviewId)
        ? browserPreviewId
        : null;
  const previous =
    remembered && browsers.get(remembered)?.kept ? null : remembered;
  const preview = previewTabIds(allOrderedIds, keptIds, focusedId, previous);
  const orderedIds = previewEnabled ? preview.visibleIds : allOrderedIds;
  useLayoutEffect(() => {
    if (previewEnabled) previousPreview.current = preview.previewId;
  }, [previewEnabled, preview.previewId]);
  const [recentMenu, setRecentMenu] = useState<HTMLElement | null>(null);
  const groupState = useSyncExternalStore(
    subscribeSurfaceGroups,
    loadSurfaceGroups,
    loadSurfaceGroups,
  );
  const segments = stripSegments(orderedIds, groupState, focusedId);
  // Labels sit in the sortable sequence so a group drags like a tab.
  const displayIds = stripDisplayIds(segments);
  const displayedTabIds = displayIds.filter((id) => !chipGroupId(id));
  const tabStopId = displayedTabIds.includes(focusedId)
    ? focusedId
    : displayedTabIds[0];
  const stripGroups = segments.flatMap((segment) =>
    segment.kind === "group" ? [segment] : [],
  );
  const groupMembers = (id: string) =>
    stripGroups.find((segment) => segment.group.id === id)?.members ?? [];
  const sortable = useSortable(
    displayIds,
    (ids, movedId) => {
      let members = groupState.members;
      const joined = movedId ? groupAfterDrop(ids, movedId, members) : undefined;
      if (movedId && joined !== undefined) {
        members = { ...members };
        if (joined) members[movedId] = joined;
        else delete members[movedId];
        setSurfaceGroupMembership({ [movedId]: joined });
      }
      const order = orderFromDisplay(ids, members, orderedIds);
      const moved = movedId && !chipGroupId(movedId) ? movedId : undefined;
      const complete = mergePreviewTabOrder(allOrderedIds, order);
      if (onReorderSurfaces) onReorderSurfaces(complete, moved);
      else
        onReorder(
          complete.filter((id) => sessionTabs.has(id)),
          moved && sessionTabs.has(moved) ? moved : undefined,
        );
    },
    {
      animate: true,
      onDragMove: (id, x, y, pointer) => {
        if (!chipGroupId(id)) onSurfaceDragMove?.(id, x, y, pointer);
      },
      onDragEnd: (id, x, y, cancelled, pointer) => {
        const dragged = chipGroupId(id);
        if (dragged) {
          // Only leaving the window tears a group out; the strip reorders it.
          const outside =
            x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
          if (cancelled || !outside || !onMoveTabsToWindow) return false;
          onMoveTabsToWindow(groupMembers(dragged));
          return true;
        }
        const consumed = onSurfaceDragEnd?.(id, x, y, cancelled, pointer);
        // A tab that left this strip for another pane or window leaves its group.
        if (consumed && !cancelled && groupState.members[id])
          setSurfaceGroupMembership({ [id]: null });
        return consumed ?? false;
      },
    },
  );
  const groupSortable = useSortable(groupId ? [groupId] : [], () => {}, {
    onDragMove: onGroupDragMove,
    onDragEnd: onGroupDragEnd,
  });
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  // Tabs grow in and closed tabs collapse, as in MonoCode.
  const slotMotion = useTabSlotMotion(displayIds, tabStripRef);
  const focusedTabControlRef = useRef<HTMLElement | null>(null);
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
    /** A tab, a group label, or empty strip space. Defaults to a tab. */
    kind?: "tab" | "group" | "bar";
    tabId: string;
    groupId?: string;
    /** Secondary page; the native panel cannot nest submenus. */
    page?: string;
    x: number;
    y: number;
    anchor?: HTMLElement;
  } | null>(null);
  // A page change closes the native panel; that close must not end the menu.
  const menuPageSwitch = useRef(false);
  useLayoutEffect(() => {
    menuPageSwitch.current = false;
  }, [tabMenu?.page, tabMenu?.kind]);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const pendingGroupJoin = useRef<{
    groupId: string;
    known: Set<string>;
    at: number;
  } | null>(null);
  const allOrderedKey = allOrderedIds.join("\n");
  useEffect(() => {
    const pending = pendingGroupJoin.current;
    if (!pending) return;
    if (Date.now() - pending.at > 10_000) {
      pendingGroupJoin.current = null;
      return;
    }
    const fresh = allOrderedIds.find((id) => !pending.known.has(id));
    if (!fresh) return;
    pendingGroupJoin.current = null;
    setSurfaceGroupMembership({ [fresh]: pending.groupId });
    // allOrderedIds is derived each render; its joined key is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOrderedKey]);
  const openBarMenu = (x: number, y: number, anchor?: HTMLElement) => {
    setBrowserMenu(null);
    setTabMenu({ kind: "bar", tabId: focusedId, x, y, anchor });
  };
  const openGroupMenu = (
    group: string,
    x: number,
    y: number,
    anchor?: HTMLElement,
  ) => {
    setBrowserMenu(null);
    setTabMenu({ kind: "group", tabId: focusedId, groupId: group, x, y, anchor });
  };
  const [browserMenu, setBrowserMenu] = useState<{
    x: number;
    y: number;
    anchor?: HTMLElement;
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
  const canDrag = displayIds.length > 1 || Boolean(onSurfaceDragEnd);
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
    const focusedControl = focusedTabControlRef.current;
    if (!focusedControl || focusedControl.isConnected) return;
    focusedTabControlRef.current = null;
    // Closing or folding a tab must not leave keyboard focus on the body.
    // Respect focus moved into an editor, menu or confirmation dialog meanwhile.
    if (document.activeElement !== document.body) return;
    const strip = tabStripRef.current;
    const next = strip?.querySelector<HTMLButtonElement>(
      '[role="tab"][tabindex="0"]',
    );
    (next ?? strip)?.focus();
  });

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

  const menuKind = tabMenu?.kind ?? "tab";
  const contextTab =
    tabMenu && menuKind === "tab" ? sessionTabs.get(tabMenu.tabId) : undefined;
  const contextBrowser =
    tabMenu && menuKind === "tab" ? browsers.get(tabMenu.tabId) : undefined;
  const contextId = contextTab?.id ?? contextBrowser?.id;
  const contextGroupId = contextId ? groupState.members[contextId] : undefined;
  const contextGroup = contextGroupId
    ? stripGroups.find((segment) => segment.group.id === contextGroupId)
    : undefined;
  const menuGroup =
    menuKind === "group" && tabMenu?.groupId
      ? stripGroups.find((segment) => segment.group.id === tabMenu.groupId)
      : undefined;
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
  const groupName = (group: SurfaceGroup) =>
    group.name ||
    `${SURFACE_GROUP_COLORS[group.color]?.name ?? "Unnamed"} group`;
  const availableCombineTargets = (combineTargets ?? []).filter(
    (target) => target.id !== focusedId && shown.has(target.id),
  );
  const hasSurfaceMenu =
    unified || onSplitTab || onUnsplit || onCombineWith || onNewView;

  // Tab menu: everyday actions stay on the first page; the rest sit one page in.
  const splitItems: ExplorerMenuItem[] = [];
  if (
    contextId &&
    onNewView &&
    !(onSplitTab && shown.has(contextId) && shown.size > 1)
  )
    splitItems.push({ kind: "item", id: "new-view", label: "Split right" });
  if (contextId && hasSurfaceMenu) {
    if (onSplitTab && contextId !== focusedId)
      splitItems.push({
        kind: "item",
        id: "beside",
        label: "Split right of current tab",
      });
    if (onSplitTab && shown.has(contextId) && shown.size > 1)
      splitItems.push(
        { kind: "item", id: "move-left", label: "Split left" },
        { kind: "item", id: "move-right", label: "Split right" },
        { kind: "item", id: "move-up", label: "Split above" },
        { kind: "item", id: "move-down", label: "Split below" },
      );
    if (onCombineWith && shown.size > 1)
      for (const target of availableCombineTargets)
        splitItems.push({
          kind: "item",
          id: `combine:${target.id}`,
          label: `Combine with ${target.label}`,
        });
    if (onUnsplit && shown.size > 1)
      splitItems.push({
        kind: "item",
        id: "unsplit",
        label: paneLocal ? "Combine all tabs" : "Return to single view",
      });
  }
  if (contextId && onUndoLayout && splitItems.length)
    splitItems.push(
      { kind: "sep" },
      {
        kind: "item",
        id: "undo-layout",
        label: "Undo layout change",
        disabled: !canUndoLayout,
      },
    );
  const moveItems: ExplorerMenuItem[] = [];
  if (contextId && onMoveTabToWindow) {
    moveItems.push({
      kind: "item",
      id: "move-tab-new-window",
      label: "Move tab to new window",
    });
    for (const target of windowTargets)
      moveItems.push({
        kind: "item",
        id: `move-tab-window:${target.id}`,
        label: `Move tab to ${target.label}`,
      });
  }
  if (contextId && onReturnTabToWindow)
    moveItems.push({
      kind: "item",
      id: "return-tab-window",
      label: "Return tab to original window",
    });
  const joinableGroups = stripGroups.filter(
    (segment) => segment.group.id !== contextGroupId,
  );
  const groupPageItems: ExplorerMenuItem[] = [
    { kind: "item", id: "group-new", label: "New group" },
    ...(joinableGroups.length ? [{ kind: "sep" } as const] : []),
    ...joinableGroups.map(
      (segment): ExplorerMenuItem => ({
        kind: "item",
        id: `group-join:${segment.group.id}`,
        label: groupName(segment.group),
        description: `${segment.members.length} ${
          segment.members.length === 1 ? "tab" : "tabs"
        }`,
      }),
    ),
  ];
  const closeItems: ExplorerMenuItem[] = contextTab
    ? [
        {
          kind: "item",
          id: "others",
          label: unified ? "Close other sessions" : "Close other tabs",
          disabled: contextCloseIds?.others.length === 0,
        },
        {
          kind: "item",
          id: "right",
          label: unified
            ? "Close sessions to the right"
            : "Close tabs to the right",
          disabled: contextCloseIds?.right.length === 0,
        },
        {
          kind: "item",
          id: "left",
          label: unified
            ? "Close sessions to the left"
            : "Close tabs to the left",
          disabled: contextCloseIds?.left.length === 0,
        },
      ]
    : [];
  /** One item stays inline; several collapse behind a page entry. */
  const pageEntry = (
    page: string,
    label: string,
    items: ExplorerMenuItem[],
  ): ExplorerMenuItem[] => {
    const choices = items.filter((item) => item.kind === "item");
    if (choices.length === 0) return [];
    if (choices.length === 1) return choices;
    return [{ kind: "item", id: `page:${page}`, label, shortcut: "›" }];
  };
  const tabRootItems: ExplorerMenuItem[] = [];
  if (contextId) {
    if (contextBrowser && onKeepBrowser && !contextBrowser.kept)
      tabRootItems.push(
        { kind: "item", id: "keep-open", label: "Keep open" },
        { kind: "sep" },
      );
    if (joinableGroups.length)
      tabRootItems.push({
        kind: "item",
        id: "page:group",
        label: contextGroup ? "Move to group" : "Add to group",
        shortcut: "›",
      });
    else if (!contextGroup)
      tabRootItems.push({
        kind: "item",
        id: "group-new",
        label: "Add to new group",
      });
    if (contextGroup)
      tabRootItems.push({
        kind: "item",
        id: "group-leave",
        label: "Remove from group",
      });
    tabRootItems.push(
      ...pageEntry("split", "Split", splitItems),
      ...pageEntry("move", "Move to", moveItems),
      { kind: "sep" },
    );
    if (onReopenClosedTab)
      tabRootItems.push({
        kind: "item",
        id: "reopen-tab",
        label: "Reopen closed tab",
        shortcut: `${MOD}${SHIFT}T`,
        disabled: !canReopenClosedTab,
      });
    if (contextTab?.race && onOpenRaceOverview)
      tabRootItems.push({
        kind: "item",
        id: "race-overview",
        label: "Open race overview",
      });
    tabRootItems.push(
      { kind: "sep" },
      {
        kind: "item",
        id: "close",
        label: contextBrowser ? "Close browser" : "Close tab",
        shortcut: `${MOD}W`,
        disabled: contextTab
          ? !titleTabClosable(contextTab, sessionTabCount)
          : !onCloseBrowser,
      },
      ...pageEntry("close", "Close others", closeItems),
    );
  }

  // Group label menu.
  const groupSessionIds = menuGroup
    ? menuGroup.members.filter((id) => sessionTabs.has(id))
    : [];
  const groupFallback = menuGroup
    ? orderedSessions.find((tab) => !menuGroup.members.includes(tab.id))?.id
    : undefined;
  const groupRootItems: ExplorerMenuItem[] = menuGroup
    ? [
        { kind: "item", id: "group-rename", label: "Rename group…" },
        { kind: "item", id: "page:color", label: "Colour", shortcut: "›" },
        { kind: "sep" },
        { kind: "item", id: "group-new-tab", label: "New tab in group" },
        {
          kind: "item",
          id: "group-fold",
          label: menuGroup.group.collapsed ? "Unfold group" : "Fold group",
        },
        ...(onMoveTabsToWindow
          ? pageEntry("group-move", "Move group to", [
              {
                kind: "item",
                id: "group-move-new",
                label: "Move group to new window",
              },
              ...windowTargets.map(
                (target): ExplorerMenuItem => ({
                  kind: "item",
                  id: `group-move:${target.id}`,
                  label: `Move group to ${target.label}`,
                }),
              ),
            ])
          : []),
        { kind: "sep" },
        { kind: "item", id: "group-ungroup", label: "Ungroup" },
        {
          kind: "item",
          id: "group-close",
          label: "Close group",
          disabled: groupSessionIds.length > 0 && !groupFallback,
        },
      ]
    : [];
  const colorItems: ExplorerMenuItem[] = menuGroup
    ? SURFACE_GROUP_COLORS.map((color, index) => ({
        kind: "item",
        id: `group-color:${index}`,
        label: color.name,
        checked: menuGroup.group.color === index,
      }))
    : [];
  const groupMoveItems: ExplorerMenuItem[] = menuGroup
    ? [
        { kind: "item", id: "group-move-new", label: "New window" },
        ...windowTargets.map(
          (target): ExplorerMenuItem => ({
            kind: "item",
            id: `group-move:${target.id}`,
            label: target.label,
          }),
        ),
      ]
    : [];

  // Empty strip space: actions for the whole strip.
  const barItems: ExplorerMenuItem[] = [];
  barItems.push({ kind: "item", id: "bar-new-session", label: "New session" });
  if (onNewBrowser)
    barItems.push({
      kind: "item",
      id: "bar-new-browser",
      label: "New browser tab",
    });
  if (stripGroups.length) barItems.push({ kind: "sep" });
  if (stripGroups.some((segment) => !segment.group.collapsed))
    barItems.push({ kind: "item", id: "fold-all", label: "Fold all groups" });
  if (stripGroups.some((segment) => segment.group.collapsed))
    barItems.push({
      kind: "item",
      id: "unfold-all",
      label: "Unfold all groups",
    });
  barItems.push({ kind: "sep" });
  if (onReopenClosedTab)
    barItems.push({
      kind: "item",
      id: "reopen-tab",
      label: "Reopen closed tab",
      shortcut: `${MOD}${SHIFT}T`,
      disabled: !canReopenClosedTab,
    });
  if (onUndoLayout)
    barItems.push({
      kind: "item",
      id: "undo-layout",
      label: "Undo layout change",
      disabled: !canUndoLayout,
    });
  if (groupId && (onMoveGroupToWindow || onReturnGroupToWindow)) {
    barItems.push({ kind: "sep" });
    if (onMoveGroupToWindow) {
      barItems.push({
        kind: "item",
        id: "move-group-new-window",
        label: "Move all tabs to new window",
      });
      for (const target of windowTargets)
        barItems.push({
          kind: "item",
          id: `move-group-window:${target.id}`,
          label: `Move all tabs to ${target.label}`,
        });
    }
    if (onReturnGroupToWindow)
      barItems.push({
        kind: "item",
        id: "return-group-window",
        label: "Return all tabs to original window",
      });
  }

  const pages: Record<string, ExplorerMenuItem[]> = {
    group: groupPageItems,
    split: splitItems,
    move: moveItems,
    close: closeItems,
    color: colorItems,
    "group-move": groupMoveItems,
  };
  const page = tabMenu?.page;
  const contextMenuItems: ExplorerMenuItem[] =
    page && pages[page]
      ? [
          { kind: "item", id: "page:", label: "‹ Back" },
          { kind: "sep" },
          ...pages[page],
        ]
      : menuKind === "bar"
        ? barItems
        : menuKind === "group"
          ? groupRootItems
          : tabRootItems;
  while (contextMenuItems[0]?.kind === "sep") contextMenuItems.shift();
  while (contextMenuItems[contextMenuItems.length - 1]?.kind === "sep")
    contextMenuItems.pop();
  for (let index = contextMenuItems.length - 1; index > 0; index--)
    if (
      contextMenuItems[index].kind === "sep" &&
      contextMenuItems[index - 1].kind === "sep"
    )
      contextMenuItems.splice(index, 1);

  const onPickTabMenu = (id: string) => {
    if (id.startsWith("page:")) {
      menuPageSwitch.current = true;
      const next = id.slice("page:".length) || undefined;
      setTabMenu((menu) => (menu ? { ...menu, page: next } : menu));
      return;
    }
    setTabMenu(null);
    if (id === "reopen-tab") {
      if (canReopenClosedTab) onReopenClosedTab?.();
      return;
    }
    if (id === "undo-layout") {
      if (canUndoLayout) onUndoLayout?.();
      return;
    }
    if (id === "bar-new-session") {
      onNew();
      return;
    }
    if (id === "bar-new-browser") {
      onNewBrowser?.();
      return;
    }
    if (id === "fold-all" || id === "unfold-all") {
      setSurfaceGroupsCollapsed(
        stripGroups.map((segment) => segment.group.id),
        id === "fold-all",
      );
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
    if (menuGroup) {
      const group = menuGroup.group;
      if (id === "group-rename") setRenamingGroup(group.id);
      else if (id.startsWith("group-color:"))
        changeSurfaceGroup(group.id, {
          color: Number(id.slice("group-color:".length)),
        });
      else if (id === "group-new-tab") {
        pendingGroupJoin.current = {
          groupId: group.id,
          known: new Set(allOrderedIds),
          at: Date.now(),
        };
        if (group.collapsed) changeSurfaceGroup(group.id, { collapsed: false });
        onNew();
      } else if (id === "group-fold")
        changeSurfaceGroup(group.id, { collapsed: !group.collapsed });
      else if (id === "group-move-new") onMoveTabsToWindow?.(menuGroup.members);
      else if (id.startsWith("group-move:")) {
        const target = id.slice("group-move:".length);
        if (windowTargets.some((item) => item.id === target))
          onMoveTabsToWindow?.(menuGroup.members, target);
      } else if (id === "group-ungroup") ungroupSurfaceGroup(group.id);
      else if (id === "group-close") {
        if (groupSessionIds.length > 0 && !groupFallback) return;
        const browserIds = menuGroup.members.filter((member) =>
          browsers.has(member),
        );
        ungroupSurfaceGroup(group.id);
        if (groupSessionIds.length && groupFallback)
          onCloseMany(groupSessionIds, groupFallback);
        if (onCloseBrowser)
          for (const member of browserIds)
            onCloseBrowser(unified ? member : undefined);
      }
      return;
    }
    if (!contextId) return;
    if (id === "group-new") {
      const created = createSurfaceGroup(
        [contextId],
        nextSurfaceGroupColor(stripGroups.map((segment) => segment.group)),
      );
      setRenamingGroup(created);
    } else if (id.startsWith("group-join:")) {
      const target = id.slice("group-join:".length);
      if (stripGroups.some((segment) => segment.group.id === target))
        setSurfaceGroupMembership({ [contextId]: target });
    } else if (id === "group-leave") {
      setSurfaceGroupMembership({ [contextId]: null });
    } else if (id === "keep-open") {
      if (contextBrowser) onKeepBrowser?.(contextId);
    } else if (id === "move-tab-new-window") {
      onMoveTabToWindow?.(contextId);
    } else if (id === "return-tab-window") {
      onReturnTabToWindow?.(contextId);
    } else if (id.startsWith("move-tab-window:")) {
      const target = id.slice("move-tab-window:".length);
      if (windowTargets.some((item) => item.id === target))
        onMoveTabToWindow?.(contextId, target);
    } else if (id === "race-overview") {
      onOpenRaceOverview?.(contextId);
    } else if (id === "new-view") {
      onNewView?.(contextId);
    } else if (id.startsWith("combine:")) {
      const targetId = id.slice("combine:".length);
      if (availableCombineTargets.some((target) => target.id === targetId))
        onCombineWith?.(targetId);
    } else if (id === "close") {
      if (contextBrowser) onCloseBrowser?.(unified ? contextId : undefined);
      else onClose(contextId);
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
  const closeTabMenu = () => {
    if (menuPageSwitch.current) return;
    setTabMenu(null);
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
  const stripItem = (id: string, index: number) => {
              const labelGroup = chipGroupId(id);
              const labelSegment = labelGroup
                ? stripGroups.find((segment) => segment.group.id === labelGroup)
                : undefined;
              if (labelSegment)
                return (
                  <TabGroupLabel
                    key={id}
                    id={id}
                    group={labelSegment.group}
                    count={labelSegment.members.length}
                    index={index}
                    canDrag={canDrag}
                    sortable={sortable}
                    renaming={renamingGroup === labelSegment.group.id}
                    menuOpen={
                      menuKind === "group" &&
                      tabMenu?.groupId === labelSegment.group.id
                    }
                    onToggle={() =>
                      changeSurfaceGroup(labelSegment.group.id, {
                        collapsed: !labelSegment.group.collapsed,
                      })
                    }
                    onRename={(name) => {
                      setRenamingGroup(null);
                      if (name !== null)
                        changeSurfaceGroup(labelSegment.group.id, { name });
                    }}
                    onStartRename={() => setRenamingGroup(labelSegment.group.id)}
                    opening={slotMotion.opening.has(id)}
                    onMenu={(x, y, anchor) =>
                      openGroupMenu(labelSegment.group.id, x, y, anchor)
                    }
                  />
                );
              const tab = sessionTabs.get(id);
              const browser = browsers.get(id);
              const memberOf = groupState.members[id];
              const memberGroup = stripGroups.find(
                (segment) => segment.group.id === memberOf,
              )?.group;
              // The underline bridges the gap to the next member; the last one stops flush.
              const nextId = displayIds[index + 1];
              const groupRun = memberGroup
                ? nextId && groupState.members[nextId] === memberOf
                  ? "run"
                  : "end"
                : undefined;
              const groupStyle = memberGroup
                ? ({
                    "--tab-group-color": surfaceGroupColor(memberGroup),
                  } as CSSProperties)
                : undefined;
              const itemRef =
                id === focusedId
                  ? (element: HTMLDivElement | null) => {
                      activeTabRef.current = element;
                    }
                  : undefined;
              // Anchor to the tab itself so the menu drops from it, not from
              // wherever the pointer happened to be.
              const openMenu = (x: number, y: number, anchor?: HTMLElement) => {
                const element =
                  anchor ??
                  Array.from(
                    tabStripRef.current?.querySelectorAll<HTMLElement>(
                      "[data-surface-tab-id]",
                    ) ?? [],
                  ).find((node) => node.dataset.surfaceTabId === id);
                setBrowserMenu(null);
                setTabMenu({ tabId: id, x, y, anchor: element });
              };
              if (tab)
                return (
                  <div
                    key={id}
                    className="personal-title-tab-slot relative flex h-full shrink cursor-default items-center"
                    data-motion-slot={id}
                    data-tab-opening={slotMotion.opening.has(id) || undefined}
                    data-tab-group={groupRun}
                    style={groupStyle}
                    data-active={id === focusedId}
                    data-tauri-drag-region="false"
                  >
                    <TitleTabItem
                      tab={tab}
                      projectless={projectlessWorkspace}
                      index={index}
                      active={id === focusedId}
                      tabStop={id === tabStopId}
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
                  tabStop={id === tabStopId}
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
                            else openMenu(rect.left, rect.bottom + 4, button);
                          } else {
                            setTabMenu(null);
                            setBrowserMenu(
                              browserMenu
                                ? null
                                : {
                                    x: rect.left,
                                    y: rect.bottom + 4,
                                    anchor: button,
                                  },
                            );
                          }
                        }
                      : undefined
                  }
                  menuOpen={
                    tabMenu?.tabId === id || (!unified && Boolean(browserMenu))
                  }
                  preview={previewEnabled && preview.previewId === id}
                  onKeep={onKeepBrowser ? () => onKeepBrowser(id) : undefined}
                  groupStyle={groupStyle}
                  groupRun={groupRun}
                  opening={slotMotion.opening.has(id)}
                  itemRef={itemRef}
                />
              );
            };
  const slotGhosts = (after: string | null) =>
    slotMotion.ghosts
      .filter((ghost) =>
        after === null
          ? ghost.after === null || !displayIds.includes(ghost.after)
          : ghost.after === after,
      )
      .map((ghost) => (
        <div
          key={`ghost:${ghost.id}`}
          className="personal-tab-ghost"
          style={{ "--tab-ghost-width": `${ghost.width}px` } as CSSProperties}
          aria-hidden
        />
      ));

  return (
    <header
      className="personal-titlebar flex h-10 shrink-0 select-none items-stretch border-b border-content/10"
      data-pane-local={paneLocal || undefined}
      data-pane-focused={paneFocused}
      data-tauri-drag-region={paneLocal ? "false" : "deep"}
      onContextMenu={(event) => {
        event.preventDefault();
        openBarMenu(event.clientX, event.clientY);
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
        {/* Keep the grip visible whenever these tabs can move together.
            Moving a group to a window stays in the tab menu. */}
        {groupId && orderedIds.length > 1 && onGroupDragEnd ? (
          <button
            type="button"
            ref={(element) => groupSortable.setItemRef(groupId, element)}
            className="personal-tab-group-handle"
            data-tauri-drag-region="false"
            data-dragging={groupSortable.draggingId === groupId || undefined}
            aria-label={
              groupLabel
                ? `Move group: ${groupLabel} (${orderedIds.length} tabs)`
                : `Move group (${orderedIds.length} tabs)`
            }
            title="Drag to move these tabs together"
            onPointerDown={(event) =>
              groupSortable.onItemPointerDown(groupId, event)
            }
            onClick={(event) => {
              if (groupSortable.consumeClick()) return;
              const rect = event.currentTarget.getBoundingClientRect();
              openBarMenu(rect.left, rect.bottom, event.currentTarget);
            }}
          >
            <GripVertical className="size-3" />
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
            tabIndex={displayedTabIds.length ? -1 : 0}
            data-sortable-scroll-container
            data-surface-order={JSON.stringify(allOrderedIds)}
            aria-label="Workspace tabs"
            aria-orientation="horizontal"
            className="personal-tab-strip scrollbar-none flex h-full min-w-0 cursor-default items-center gap-0.5 overflow-x-auto overflow-y-hidden overscroll-none px-1.5"
            onFocusCapture={(event) => {
              const target = event.target as HTMLElement;
              focusedTabControlRef.current = target.closest(
                "[data-surface-tab-id]",
              ) ? target : null;
            }}
            onBlurCapture={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              ) {
                focusedTabControlRef.current = null;
              }
            }}
            onKeyDown={(event) => {
              const target = event.target as HTMLElement;
              if (
                target === event.currentTarget &&
                (event.key === "ContextMenu" ||
                  (event.shiftKey && event.key === "F10"))
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                openBarMenu(rect.left, rect.bottom);
                return;
              }
              if (
                event.defaultPrevented ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                target.getAttribute("role") !== "tab"
              ) {
                return;
              }
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              );
              const index = buttons.indexOf(target as HTMLButtonElement);
              if (index < 0) return;
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
              const nextButton = buttons[next];
              const id = nextButton?.closest<HTMLElement>(
                "[data-surface-tab-id]",
              )?.dataset.surfaceTabId;
              nextButton?.focus();
              if (id && sessionTabs.has(id)) onSelect(id);
              else if (id && browsers.has(id))
                onSelectBrowser?.(unified ? id : undefined);
            }}
          >
            {slotGhosts(null)}
            {displayIds.flatMap((id, index) => [
              stripItem(id, index),
              ...slotGhosts(id),
            ])}
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

        {previewEnabled && browserEntries.length > 0 ? (
          <div
            className="personal-tab-preview-actions"
            data-tauri-drag-region="false"
          >
            {preview.previewId === focusedId ? (
              <button
                type="button"
                className="personal-tab-preview-action"
                aria-label="Keep browser open"
                title="Keep open"
                onClick={() => onKeepBrowser?.(focusedId)}
              >
                <Pin className="size-3" />
                <span>Keep open</span>
              </button>
            ) : null}
            <button
              type="button"
              className="personal-tab-preview-action"
              aria-label="Recent browser tabs"
              aria-haspopup="menu"
              aria-expanded={Boolean(recentMenu)}
              onClick={(event) => {
                setTabMenu(null);
                setBrowserMenu(null);
                setRecentMenu(recentMenu ? null : event.currentTarget);
              }}
            >
              Recent <ChevronDown className="size-3" />
            </button>
          </div>
        ) : null}
        {paneLocal || IS_MAC ? null : (
          <div className="flex min-w-0 flex-1 items-center justify-center px-4">
            <span className="pointer-events-none truncate text-[11.5px] font-medium text-content/40 select-none">
              {systemTitle}
            </span>
          </div>
        )}
        {paneLocal ? null : trailingControls}
      </div>
      {recentMenu && previewEnabled ? (
        <ExplorerMenu
          native
          searchable
          x={0}
          y={0}
          anchor={recentMenu}
          align="end"
          gap={4}
          width={300}
          ariaLabel="Recent browser tabs"
          items={[...browserEntries].reverse().map((tab) => ({
            kind: "item",
            id: tab.id,
            label: tab.title || "Browser",
            description: tab.url,
            checked: tab.id === focusedId,
            shortcut: tab.kept ? "Kept" : undefined,
          }))}
          onPick={(id) => {
            setRecentMenu(null);
            if (browsers.has(id)) onSelectBrowser?.(unified ? id : undefined);
          }}
          onClose={() => setRecentMenu(null)}
        />
      ) : null}
      {tabMenu && contextMenuItems.length ? (
        <ExplorerMenu
          key={`${menuKind}:${tabMenu.page ?? ""}`}
          native
          x={tabMenu.x}
          y={tabMenu.y}
          anchor={tabMenu.anchor}
          align="start"
          gap={tabMenu.anchor ? 4 : 0}
          width={244}
          items={contextMenuItems}
          ariaLabel={
            menuGroup
              ? `Group actions for ${groupName(menuGroup.group)}`
              : contextId
                ? `Tab actions for ${contextTab ? tabCopy(contextTab).headline : contextBrowser?.title || "Browser"}`
                : "Workspace tab actions"
          }
          onPick={onPickTabMenu}
          onClose={closeTabMenu}
        />
      ) : null}
      {browserOpen && browserMenu && onBrowserModeChange ? (
        <ExplorerMenu
          native
          x={browserMenu.x}
          y={browserMenu.y}
          anchor={browserMenu.anchor}
          align="start"
          gap={browserMenu.anchor ? 4 : 0}
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
