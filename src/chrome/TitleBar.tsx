import { useChromeProps } from "../hooks/useChromeProps";
import { BrowserTabIcon } from "./BrowserTabIcon";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Flag,
  Globe,
  Inbox,
  Kanban,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Pin,
  Plus,
  Search,
  Settings,
  Smartphone,
  StickyNote,
  Terminal,
  X,
} from "./icons";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
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
import { UNTITLED_CHAT_TITLE } from "../lib/untitledChat";
import { getModelSnapshot, subscribeModels } from "../lib/models";
import {
  compactModelNames,
  sessionModelNames,
  type SessionModelIdentity,
} from "../lib/sessionLabels";
import { CwdPicker } from "./CwdPicker";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import {
  SORTABLE_DROP_PART_ATTRIBUTE,
  useSortable,
  type SortableDropAt,
  type SortableLink,
  type SortablePointerPosition,
} from "../hooks/useSortable";
import { useTabSlotMotion } from "../hooks/useTabSlotMotion";
import {
  TAB_TRACK_ID_ATTRIBUTE,
  useTabHighlight,
} from "../hooks/useTabHighlight";
import {
  TAB_TRACK_GAP,
  titleRowCapacity,
  titleRowTabs,
  trackSeparators,
} from "../lib/tabTrack";
import { focusPaneContent, workspacePane } from "../lib/paneFocus";
import { useTurnEndFlash } from "../hooks/useTurnEndFlash";
import { useHostPaneHeader } from "../hooks/usePaneHeader";
import { FileTypeIcon } from "./FileTypeIcon";
import { ProviderMarks } from "./ProviderMarks";
import { createPortal, flushSync } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getName } from "@tauri-apps/api/app";
import { WindowControls } from "./WindowControls";
import { ALT, CTRL, IS_MAC, MOD, SHIFT } from "../lib/platform";
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
import { BotCritter } from "./BotCritter";
import { TAB_CHIP_MAX_WIDTH } from "../lib/motionTokens";
import { setWindowStripZone, windowStripZone } from "../lib/windowStripDrop";
import { isSpaceKey } from "../lib/workspaceSpaces";
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
  /** What holds a working chat in this tab up (see `holdUpHint`). */
  waitingOn?: string;
  /** The tab holds one race's agents; `title` is the race prompt. */
  race?: boolean;
  /** The focused chat is this project's bot: the tab shows its critter. */
  botPath?: string;
  /** The chats in this tab, whose finished turns flash it. */
  sessionIds?: string[];
  /** The tab is a project's board. */
  board?: boolean;
  dirty?: boolean;
  terminal?: boolean;
};

/** A side of a pane with another pane across the seam. */
export type PaneSide = "left" | "right" | "up" | "down";

const MOVE_LABEL: Record<PaneSide, string> = {
  left: "Move left",
  right: "Move right",
  up: "Move up",
  down: "Move down",
};

export type TitleBarProps = {
  paneLocal?: boolean;
  /**
   * "strip" (the default) lays the tabs side by side. "title" is a pane's
   * title row, as in Cydonia: the tab in front on a chip, lit while the pane
   * has focus, the tabs behind it as a deck that lists them, and the pane's
   * tools, shown while the row is pointed at and always on the focused pane.
   */
  variant?: "strip" | "title";
  /**
   * The window's strip: with one single tab it shows none (the pane names
   * it). A split alone still shows, so its panes' tabs can be moved.
   */
  hideLoneTab?: boolean;
  /**
   * The window's strip takes a tab dragged from a pane's header: let go
   * over it, the tab stands there on its own (`onDropOnStrip`).
   */
  acceptsPaneDrops?: boolean;
  /**
   * A title row's tab let go over the window's strip, to stand there before
   * the entry `before` (or at the end).
   */
  onDropOnStrip?: (id: string, before: string | null) => void;
  /**
   * A title row's Expand or Restore tool (Cydonia's zoom); absent while the
   * pane is alone.
   */
  paneZoom?: "expand" | "restore";
  onTogglePaneZoom?: () => void;
  /** Each side with a pane across its seam, for the title row's Move. */
  paneMoves?: readonly PaneSide[];
  onMovePane?: (side: PaneSide) => void;
  /** A title row whose stack is the window's strip draws no deck for it. */
  stackOnStrip?: boolean;
  /**
   * The tab in front is split into panes that each name themselves, so a
   * title row with nothing stacked behind it keeps only its tools rather
   * than naming the tab twice.
   */
  frontNamedBelow?: boolean;
  /**
   * The tab in front draws a header row of its own (a page's toolbar, an
   * iPhone's pickers, a tab's files). A lone title row gives it the row in
   * place of the tab's name; under a row of tabs it draws that row itself,
   * and the title row leaves the line under both to it.
   */
  frontOwnHeader?: boolean;
  /**
   * A tab row above (the window's strip) already names the tab in front,
   * so a toolbar lent this row does not name it again. Defaults to the
   * strip holding this pane's tabs and showing more than one.
   */
  frontNamed?: boolean;
  /** Hiding this pane beside its divider, offered in the pane's "…". */
  paneHides?: readonly { key: string; label: string }[];
  onHidePane?: (key: string) => void;
  /** The window strip leaves Recent and Keep open to the pane's "…". */
  previewActionsInPane?: boolean;
  /** False where another bar names the window (the window's strip). */
  windowTitle?: boolean;
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
    /**
     * The chat whose agent opened this page and reuses it for its next one,
     * by name; absent for the user's own pages.
     */
    agentChatName?: string;
    url?: string;
  }>;
  onKeepBrowser?: (id: string) => void;
  /** Keep an agent's page as it is: its chat opens its own page instead. */
  onKeepAgentPage?: (id: string) => void;
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
  /** Open (or bring forward) the current project's board. */
  onOpenBoard?: () => void;
  /** Open the project's iPhone simulator beside the chat. */
  onOpenIphone?: () => void;
  /** Shown in the strip's menu when the project needs Xcode for its iPhone. */
  iphoneHint?: string;
  /**
   * `taken`: the pointer rests on (or is armed over) a tab elsewhere that
   * the drag would join, so no pane takes it and none shows a drop.
   */
  onSurfaceDragMove?: (
    id: string,
    x: number,
    y: number,
    pointer?: SortablePointerPosition,
    taken?: boolean,
  ) => void;
  groupId?: string;
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
  /**
   * The window strip's splits (Cydonia's window tabs that hold an
   * arrangement of panes), in `surfaceOrder` beside the single tabs.
   */
  splits?: StripSplit[];
  /** Bring a tab in a split forward: the split, its pane and the tab. */
  onSelectSplitTab?: (id: string) => void;
  /**
   * A tab let go on a split's entry joins it as a pane: beside the pane of
   * the segment it was let go on (`beside`, on the side nearer the
   * pointer), or at its right.
   */
  onAddToSplit?: (
    splitId: string,
    id: string,
    beside?: { pane: string; side: "before" | "after" },
  ) => void;
  /**
   * Something let go on the middle of a single tab (`targetId`) joins it: a
   * tab, or a segment pulled out of its split, makes a new split with it in
   * its place, the target on the left; a split (`draggedId` its key) takes
   * it as a pane at its right.
   */
  onCombineTabs?: (targetId: string, draggedId: string) => void;
  /**
   * A tab let go on the middle of one of this bar's tabs (`targetId`) in a
   * pane's row of tabs, from this row or any other bar: the two stand side
   * by side in the window's layout, the dropped one in a pane of its own at
   * the target's pane's right.
   */
  onPairTabs?: (targetId: string, draggedId: string) => void;
  /** A tab pulled out of its split, let go on the strip before `before`. */
  onDetachFromSplit?: (id: string, before: string | null) => void;
  /** The split's tabs stand on the strip as single tabs again. */
  onSeparateSplit?: (splitId: string) => void;
  onCloseSplit?: (splitId: string) => void;
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
  onOpenAutomations?: () => void;
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
  if (tab.sessionCount > 1) return `${tab.sessionCount} chats`;
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
  // The composer's agent pill names the model; an untitled tab does not
  // repeat it. The tooltip still lists every model in the tab.
  const untitled = UNTITLED_CHAT_TITLE;

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
  if (tab.needsInput) tooltipParts.push("Needs you");
  else if (tab.waitingOn) tooltipParts.push(tab.waitingOn);

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

/**
 * A lone title row's kind icon on a tile, after Cydonia's deck. A pane with
 * more than one tab lays them side by side instead (see `paneTabs`).
 */
function TabDeck({ children }: { children: ReactNode }) {
  return (
    <span className="aven-tab-deck">
      <span className="aven-tab-deck-face">{children}</span>
    </span>
  );
}

/** A tab's kind at a glance: a bot's critter, its agents, or its file. */
function TabIdentity({ tab, active }: { tab: Tab; active: boolean }) {
  const fileIcon = tab.files[0];
  return (
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
      {tab.botPath ? (
        <BotCritter
          path={tab.botPath}
          active={tab.busyHarnesses.length > 0}
          className="personal-title-tab-bot"
        />
      ) : tab.harnesses.length > 0 ? (
        <ProviderMarks
          harnesses={tab.harnesses}
          busyHarnesses={tab.busyHarnesses}
          dimmed={!active}
        />
      ) : tab.board ? (
        <Kanban
          className={`personal-title-tab-board size-3.5 shrink-0 ${
            active ? "text-content" : "text-content/55"
          }`}
          strokeWidth={1.75}
          aria-hidden
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
  );
}

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
  deck,
  combineInto = false,
  combineNear = false,
  combine = null,
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
  /** A lone title row draws the tab's icon on a deck. */
  deck?: boolean;
  /** Something held over its middle combines with it into a split. */
  combineInto?: boolean;
  /**
   * Something is over its middle: let go, it combines with it. A light
   * hint until the preview (`combineInto`) arms.
   */
  combineNear?: boolean;
  /** While a tab is dragged that could combine with this one: what joins. */
  combine?: CombineJoin | null;
}) {
  const { headline, tooltip } = tabCopy(tab, projectless);
  const tabRef = useRef<HTMLDivElement | null>(null);
  useTurnEndFlash(tabRef, tab.sessionIds);
  const identity = <TabIdentity tab={tab} active={active} />;
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
        tabRef.current = el;
        sortable.setItemRef(tab.id, el);
        itemRef?.(el);
      }}
      className="personal-title-tab aven-tab group relative flex h-full cursor-default touch-none items-center self-stretch min-w-0 w-full"
      data-active={active}
      data-closable={closable}
      data-visible={visible}
      data-has-models={Boolean(tab.models?.length)}
      data-surface-id={tab.id}
      data-surface-tab-id={tab.id}
      data-draggable={canDrag || undefined}
      data-combine-into={combineInto || undefined}
      data-combine-near={combineNear || undefined}
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
        {deck ? <TabDeck>{identity}</TabDeck> : null}
        {/* A lone title row is a group of controls, not a list of tabs. */}
        <button
          type="button"
          title={tooltip}
          aria-label={tooltip}
          role={deck ? undefined : "tab"}
          tabIndex={tabStop ? 0 : -1}
          aria-selected={deck ? undefined : active}
          aria-description={visible && !active ? "Visible in split" : undefined}
          data-sortable-glass
          data-tauri-drag-region="false"
          data-morph={combineInto ? undefined : `tab:${tab.id}`}
          className="personal-title-tab-button aven-tab-button relative flex min-w-0 flex-1 cursor-default items-center text-left"
        >
          <span className="personal-title-tab-number" aria-hidden>
            {index + 1}
          </span>
          {deck ? null : identity}
          <span className="personal-title-tab-text flex min-w-0 flex-1 items-center">
            <span className="flex min-w-0 items-center gap-1">
              {/* Keep the task name on one line; model details remain in the
                  tooltip and the composer's model picker. */}
              <span className="personal-title-tab-label aven-tab-label min-w-0 truncate">
                {headline}
              </span>
              {visible && !active ? (
                <span className="personal-title-tab-visible" aria-hidden />
              ) : null}
              {tab.needsInput ? (
                <span
                  className="personal-title-tab-needs-you"
                  data-tab-needs-you
                  title="Needs you"
                  aria-hidden
                />
              ) : null}
              {tab.dirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-content/70"
                  title="Unsaved changes"
                  aria-label="Unsaved changes"
                />
              ) : null}
            </span>
          </span>
        </button>
        {/* A lone title's × is its pane's Close tool. */}
        {closable && !deck ? (
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
            className="personal-title-tab-close aven-tab-close"
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
        {combine ? (
          <CombinePreview
            id={tab.id}
            into={combineInto}
            join={combine}
            here={
              <>
                <TabIdentity tab={tab} active={false} />
                <span className="aven-split-label">{headline}</span>
              </>
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The element of a tab or split that keyboard focus can return to: its
 * `role="tab"` button (a split's segment in reach, or the one lit), else its
 * first button, else the box itself.
 */
function focusableIn(
  element: HTMLElement | undefined,
): HTMLElement | undefined {
  if (!element) return element;
  return (
    element.querySelector<HTMLElement>('[role="tab"][tabindex="0"]') ??
    element.querySelector<HTMLElement>('[role="tab"]') ??
    element.querySelector<HTMLElement>("button") ??
    element
  );
}

/** What a dragged tab would bring to an entry it joins. */
export type CombineJoin = {
  /** Its icon and name, as its segment will show them. */
  incoming: ReactNode;
  /** The dragged tab's own id: its segment grows from this preview. */
  id: string | null;
};

/**
 * A single tab previewing the split a held tab would make with it: the
 * split's pill over the tab, the tab's own segment on the left, a divider,
 * and the held tab's segment on the right, as the split will draw them. It
 * is drawn (hidden) while a tab is dragged and shows while one rests on its
 * middle, so it comes and goes on transitions rather than popping.
 */
function CombinePreview({
  id,
  into,
  join,
  here,
}: {
  id: string;
  into: boolean;
  join: CombineJoin;
  here: ReactNode;
}) {
  return (
    <span
      className="aven-combine"
      data-into={into || undefined}
      // It comes and goes on its own transitions.
      data-morph-own
      aria-hidden
    >
      <span
        className="aven-combine-fill"
        data-morph={into ? `fill:${id}` : undefined}
      />
      <span
        className="aven-combine-here"
        data-morph={into ? `tab:${id}` : undefined}
      >
        {here}
      </span>
      <span className="aven-combine-divider" />
      <span
        className="aven-combine-incoming"
        data-combine-incoming={into || undefined}
        data-morph={into && join.id ? `tab:${join.id}` : undefined}
      >
        {join.incoming}
      </span>
    </span>
  );
}

/**
 * The pane a drop would add, drawn at the right of a split it joins, with
 * the held tab's icon.
 */
function CombineIncoming({ join }: { join: CombineJoin | null }) {
  return (
    <span
      className="aven-split-incoming"
      data-combine-incoming
      data-morph={join?.id ? `tab:${join.id}` : undefined}
      aria-hidden
    >
      {join?.incoming ?? <Columns2 className="size-3" strokeWidth={1.75} />}
    </span>
  );
}

/** One pane of a split on the window's strip: the tab in front of it. */
export type StripSplitSegment = {
  /** The pane's tab in front, which the segment names and brings forward. */
  id: string;
  /** A chat, file or terminal tab, drawn as a strip tab draws it. */
  tab?: Tab;
  /** Or a page. */
  page?: { title: string; favicon?: string };
};

/**
 * A split on the window's strip, after Arc's split tabs: one entry divided
 * into a segment per pane, each showing its pane's tab in front, so any of
 * them is one click away.
 */
export type StripSplit = {
  /** The strip entry's key. */
  id: string;
  segments: StripSplitSegment[];
  /** The tab whose pane has focus, lit while the split is in front. */
  focusedId: string;
  /** Closing it would leave a chat to show (its menu's Close split). */
  closable?: boolean;
  /**
   * Every tab it holds, in front of a pane or behind one. A pane's tab let
   * go on its own split's entry goes back to the strip rather than into it.
   */
  members?: readonly string[];
};

export function splitSegmentLabel(
  segment: StripSplitSegment,
  projectless = false,
): string {
  if (segment.tab) return tabCopy(segment.tab, projectless).headline;
  return segment.page?.title.trim() || "Browser";
}

/** The words for a segment of a split that is not in front. */
export function splitSegmentHint(label: string): string {
  return `Go to ${label} in the split`;
}

function SplitSegment({
  segment,
  label,
  lit,
  front,
  tabStop,
  chip = false,
  onHover,
}: {
  segment: StripSplitSegment;
  label: string;
  /** The pane with focus in the split in front. */
  lit: boolean;
  /** The split is in front. */
  front: boolean;
  tabStop: boolean;
  /** Its icon and name stand for the whole split in a dragged split's chip. */
  chip?: boolean;
  /** The pointer came to the segment (its label) or left it (null). */
  onHover: (anchor: HTMLElement | null, label?: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useTurnEndFlash(ref, segment.tab?.sessionIds);
  const hint = front ? undefined : splitSegmentHint(label);
  const tooltip = segment.tab ? tabCopy(segment.tab).tooltip : label;
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      tabIndex={tabStop ? 0 : -1}
      aria-selected={lit}
      aria-label={label}
      aria-description={hint ?? "In the split"}
      // The split in front names each pane as a tab does; elsewhere the
      // segment's own hint says where a click goes (drawn by the strip).
      title={front ? tooltip : undefined}
      className="aven-split-segment"
      data-split-segment={segment.id}
      {...{ [SORTABLE_DROP_PART_ATTRIBUTE]: segment.id }}
      data-morph={`tab:${segment.id}`}
      data-sortable-chip={chip || undefined}
      data-lit={lit || undefined}
      data-tauri-drag-region="false"
      onPointerEnter={(event) => {
        if (hint && event.pointerType !== "touch")
          onHover(event.currentTarget, label);
      }}
      onPointerLeave={() => onHover(null)}
    >
      {segment.tab ? (
        <TabIdentity tab={segment.tab} active={front} />
      ) : (
        <BrowserTabIcon favicon={segment.page?.favicon} />
      )}
      <span className="aven-split-label">{label}</span>
      {segment.tab?.needsInput ? (
        <span
          className="personal-title-tab-needs-you"
          data-tab-needs-you
          title="Needs you"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

/**
 * A split's entry on the window's strip. Pressing a segment and moving
 * along the strip moves the whole split; pulling a segment out of the strip
 * takes that tab out of the split (see `SortablePart`). Clicking a segment
 * brings the split forward with that pane focused.
 */
function SplitEntryItem({
  split,
  projectless,
  index,
  active,
  tabStop,
  canDrag,
  sortable,
  onSelectTab,
  onContextMenu,
  onHover,
  dropInto = false,
  dropNear = false,
  dropAt = null,
  join = null,
  opening = false,
  itemRef,
}: {
  split: StripSplit;
  projectless: boolean;
  index: number;
  active: boolean;
  tabStop: boolean;
  canDrag: boolean;
  sortable: SortableApi;
  onSelectTab: (id: string) => void;
  onContextMenu: (event: MenuPoint, anchor: HTMLElement) => void;
  onHover: (anchor: HTMLElement | null, label?: string) => void;
  /** A tab held over the entry joins the split as a new pane. */
  dropInto?: boolean;
  /** A tab is over its middle: let go, it joins. A light hint until armed. */
  dropNear?: boolean;
  /** Beside which segment's pane, and on which side; at the right if absent. */
  dropAt?: SortableDropAt | null;
  /** What a held tab would bring, while one is dragged. */
  join?: CombineJoin | null;
  opening?: boolean;
  itemRef?: (element: HTMLDivElement | null) => void;
}) {
  // A press captures the pointer on the entry, so its click lands here;
  // remember which segment was pressed.
  const pressed = useRef<string | null>(null);
  const segmentOf = (target: EventTarget | null) =>
    (target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-split-segment]",
    ) ?? null;
  const lit = active ? split.focusedId : null;
  const stop =
    split.segments.find((segment) => segment.id === lit)?.id ??
    split.segments[0]?.id;
  // The segment a held tab would join beside, if any.
  const incomingAt =
    dropInto &&
    dropAt &&
    split.segments.some((segment) => segment.id === dropAt.part)
      ? dropAt.part
      : null;
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
        sortable.setItemRef(split.id, element);
        itemRef?.(element);
      }}
      className="personal-title-tab aven-tab aven-tab-slot aven-split-entry group relative flex h-full min-w-0 touch-none items-center"
      style={{ "--aven-split-panes": split.segments.length } as CSSProperties}
      data-active={active}
      data-split-entry
      data-surface-tab-id={split.id}
      data-draggable={canDrag || undefined}
      data-drop-into={dropInto || undefined}
      data-combine-near={dropNear || undefined}
      data-motion-slot={split.id}
      data-tab-opening={opening || undefined}
      {...{ [TAB_TRACK_ID_ATTRIBUTE]: split.id }}
      data-tauri-drag-region="false"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const segment = segmentOf(event.target);
        pressed.current = segment?.dataset.splitSegment ?? null;
        onHover(null);
        if (!canDrag) return;
        sortable.onItemPointerDown(
          split.id,
          event,
          segment && pressed.current
            ? { id: pressed.current, element: segment }
            : undefined,
        );
      }}
      onClick={(event) => {
        if (sortable.consumeClick()) return;
        const id =
          segmentOf(event.target)?.dataset.splitSegment ?? pressed.current;
        pressed.current = null;
        if (id) onSelectTab(id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onHover(null);
        onContextMenu(event, event.currentTarget);
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
        onContextMenu(
          { clientX: rect.left, clientY: rect.bottom },
          event.currentTarget,
        );
      }}
    >
      {dropBefore ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 left-0 z-20 rounded-full" />
      ) : null}
      {dropAfter ? (
        <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 right-0 z-20 rounded-full" />
      ) : null}
      <div className="aven-tab-motion" data-sortable-motion>
        <div
          className="aven-split"
          data-sortable-glass
          data-panes={split.segments.length}
        >
          {/* The pill's fill, a layer of its own: a morph stretches it
              without stretching the segments' text. */}
          <span
            className="aven-split-fill"
            data-sortable-fill
            data-morph={`fill:${split.id}`}
            aria-hidden
          />
          {split.segments.map((segment, at) => (
            <Fragment key={segment.id}>
              {at > 0 ? (
                <span className="aven-split-divider" aria-hidden />
              ) : null}
              {/* The pane a drop would add stands beside the segment it
                  was held over. */}
              {incomingAt === segment.id && dropAt?.side === "before" ? (
                <CombineIncoming join={join} />
              ) : null}
              <SplitSegment
                segment={segment}
                label={splitSegmentLabel(segment, projectless)}
                lit={segment.id === lit}
                front={active}
                tabStop={tabStop && segment.id === stop}
                chip={segment.id === stop}
                onHover={onHover}
              />
              {incomingAt === segment.id && dropAt?.side === "after" ? (
                <CombineIncoming join={join} />
              ) : null}
            </Fragment>
          ))}
          {dropInto && incomingAt === null ? (
            <CombineIncoming join={join} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The hint under a segment of a split that is not in front, after a short
 * rest, as the pointer comes to it. Drawn over the workspace (and over a
 * page's native view) rather than clipped by the strip.
 */
function SplitSegmentTip({
  tip,
}: {
  tip: { anchor: HTMLElement; label: string } | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    if (!tip || !tip.anchor.isConnected) {
      setPlace(null);
      return;
    }
    const anchor = tip.anchor.getBoundingClientRect();
    const width = ref.current?.offsetWidth ?? 0;
    const margin = 8;
    const centre = anchor.left + anchor.width / 2;
    const left = Math.max(
      margin,
      Math.min(window.innerWidth - margin - width, centre - width / 2),
    );
    setPlace({ left, top: anchor.bottom + 6 });
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="aven-split-tip"
      data-native-browser-occluded="true"
      data-placed={place ? "true" : undefined}
      style={place ? { left: place.left, top: place.top } : undefined}
    >
      Go to <strong>{tip.label}</strong> in the split
    </div>,
    document.body,
  );
}

/** How long the pointer rests on a segment before its hint shows. */
const SPLIT_TIP_DELAY_MS = 450;
/**
 * How long a dragged tab rests on an entry's middle before letting go there
 * joins them. A reorder drag crosses a tab's middle (60–110px of a typical
 * strip tab) in well under this at ordinary speed, so passing over never
 * combines; a deliberate pause arms it before it feels slow.
 */
const STRIP_COMBINE_DELAY_MS = 200;
/**
 * The window's strip and every pane's row of tabs take one another's tabs
 * (`SortableLink`): a tab let go on another bar's tab joins it there.
 */
const WORKSPACE_TAB_LINK = "aven-workspace-tabs";

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
  agentChatName,
  onKeep,
  groupStyle,
  groupRun,
  opening = false,
  itemRef,
  separator = false,
  deck,
  combineInto = false,
  combineNear = false,
  combine = null,
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
  /** The chat that reuses this page for its next one (an agent's page). */
  agentChatName?: string;
  onKeep?: () => void;
  /** Colour of the user tab group this page belongs to. */
  groupStyle?: CSSProperties;
  /** "run" continues the group underline to the next tab; "end" stops it. */
  groupRun?: "run" | "end";
  opening?: boolean;
  itemRef?: (element: HTMLDivElement | null) => void;
  /** A hairline before it, parting it from a resting neighbour. */
  separator?: boolean;
  /** A lone title row draws the page's icon on a deck. */
  deck?: boolean;
  /** Something held over its middle combines with it into a split. */
  combineInto?: boolean;
  /**
   * Something is over its middle: let go, it combines with it. A light
   * hint until the preview (`combineInto`) arms.
   */
  combineNear?: boolean;
  /** While a tab is dragged that could combine with this one: what joins. */
  combine?: CombineJoin | null;
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
      className="personal-title-tab personal-title-browser-tab aven-tab aven-tab-slot group relative flex h-full min-w-0 touch-none items-center"
      data-active={active}
      data-closable={Boolean(onClose)}
      data-preview={preview || undefined}
      data-visible={visible}
      data-surface-id={id}
      data-surface-tab-id={id}
      data-draggable={canDrag || undefined}
      data-combine-into={combineInto || undefined}
      data-combine-near={combineNear || undefined}
      data-has-menu={Boolean(onMenu)}
      data-tab-group={groupRun}
      style={groupStyle}
      data-motion-slot={id}
      data-tab-opening={opening || undefined}
      {...{ [TAB_TRACK_ID_ATTRIBUTE]: id }}
      data-tab-separator={separator || undefined}
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
        {deck ? (
          <TabDeck>
            <BrowserTabIcon favicon={favicon} />
          </TabDeck>
        ) : null}
        <button
          type="button"
          role={deck ? undefined : "tab"}
          tabIndex={tabStop ? 0 : -1}
          aria-selected={deck ? undefined : active}
          aria-description={
            preview
              ? "Preview tab. The next page you open takes its place unless you keep it open."
              : agentChatName
                ? `Opened by ${agentChatName}. The chat reuses this page for its next one unless you keep it.`
                : visible && !active
                  ? "Visible in split"
                  : undefined
          }
          aria-label={label === "Browser" ? "Browser" : `Browser: ${label}`}
          data-sortable-glass
          data-morph={combineInto ? undefined : `tab:${id}`}
          title={
            agentChatName
              ? `${label}\nOpened by ${agentChatName}; the chat reuses this page`
              : label
          }
          className="personal-title-tab-button personal-title-browser-button aven-tab-button flex min-w-0 flex-1 items-center"
        >
          {deck ? null : <BrowserTabIcon favicon={favicon} />}
          <span className="personal-title-tab-label aven-tab-label min-w-0 truncate">
            {label}
          </span>
          {visible && !active ? (
            <span className="personal-title-tab-visible" aria-hidden />
          ) : null}
        </button>
        {onClose && !deck ? (
          <button
            type="button"
            tabIndex={tabStop ? 0 : -1}
            title="Close browser"
            aria-label={legacy ? "Close browser" : `Close browser: ${label}`}
            data-no-drag
            onPointerDown={(event) => event.stopPropagation()}
            className="personal-title-tab-close personal-title-browser-close aven-tab-close"
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
            className="personal-title-browser-menu absolute right-0.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/40 hover:bg-(--aven-control-bg) hover:text-content"
            onClick={(event) => {
              event.stopPropagation();
              onMenu(event.currentTarget);
            }}
          >
            <ChevronDown className="size-3" strokeWidth={1.75} />
          </button>
        ) : null}
        {combine ? (
          <CombinePreview
            id={id}
            into={combineInto}
            join={combine}
            here={
              <>
                <BrowserTabIcon favicon={favicon} />
                <span className="aven-split-label">{label}</span>
              </>
            }
          />
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
      // Pressing captures the pointer on this slot for dragging, so the click
      // lands here rather than on the button inside; handle it here, as tab
      // slots do. Keyboard activation of the button bubbles here too.
      onClick={(event) => {
        if (renaming || (event.target as HTMLElement).closest("input")) return;
        if (sortable.consumeClick()) return;
        onToggle();
      }}
      onDoubleClick={(event) => {
        if (renaming) return;
        event.stopPropagation();
        onStartRename();
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
      className={`absolute top-1/2 z-40 grid size-6.5 -translate-y-1/2 place-items-center rounded-md bg-(--aven-control-bg) backdrop-blur-xl text-content/70 hover:bg-(--aven-control-hover) hover:text-content ${
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
            ? "text-content hover:bg-(--aven-control-bg)"
            : active
              ? "text-content hover:bg-(--aven-control-bg)"
              : "text-content/50 hover:bg-(--aven-control-bg) hover:text-content"
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
      className="mr-1 min-w-0 truncate rounded-md bg-skill/15 px-1.5 py-0.5 text-ui-micro font-medium tracking-wide text-skill"
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

/**
 * Esc on a title row or the window's strip gives the keyboard back to the
 * pane, as in Cydonia: its message box or first control.
 */
export function returnFocusToPane(from: HTMLElement): boolean {
  const owner = from.closest<HTMLElement>("[data-workspace-header]")?.dataset
    .workspaceHeader;
  if (focusPaneContent(workspacePane(owner))) return true;
  (document.activeElement as HTMLElement | null)?.blur?.();
  return false;
}

const NO_IDS: readonly string[] = [];
const NO_SEPARATORS: ReadonlySet<string> = new Set();
/** A lone title row's one slot for the tab motion, whichever tab it names. */
const LONE_TITLE_SLOTS: readonly string[] = ["\u0000lone-title"];

function TitleBarComponent({
  paneLocal = false,
  variant = "strip",
  hideLoneTab = false,
  acceptsPaneDrops = false,
  onDropOnStrip,
  paneZoom,
  onTogglePaneZoom,
  paneMoves,
  onMovePane,
  stackOnStrip = false,
  frontNamedBelow = false,
  frontOwnHeader = false,
  frontNamed,
  paneHides,
  onHidePane,
  previewActionsInPane = false,
  windowTitle = true,
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
  onKeepAgentPage,
  browserPreviewId,
  surfaceOrder,
  splits,
  onSelectSplitTab,
  onAddToSplit,
  onCombineTabs,
  onPairTabs,
  onDetachFromSplit,
  onSeparateSplit,
  onCloseSplit,
  visibleIds,
  onReorderSurfaces,
  onSplitTab,
  onUnsplit,
  onNewBrowser,
  onOpenBoard,
  onOpenIphone,
  iphoneHint,
  onSurfaceDragMove,
  onSurfaceDragEnd,
  groupId,
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
  onOpenAutomations,
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
  const splitEntries = useMemo(
    () => new Map((splits ?? []).map((split) => [split.id, split])),
    [splits],
  );
  const allOrderedIds = titleSurfaceOrder(
    tabIds,
    [...browserEntries.map((tab) => tab.id), ...splitEntries.keys()],
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
    ...splitEntries.keys(),
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
  const segments = stripSegments(orderedIds, groupState);
  const titleRow = variant === "title";
  const frontId = orderedIds.includes(focusedId) ? focusedId : orderedIds[0];
  // A title row whose pane holds two tabs or more lays them side by side on
  // a track, as the window's strip does, so each is one click away. Those
  // that no longer fit fold into a "+N", as do a folded group's (the row
  // draws no group labels); the tab in front always shows. A lone tab keeps
  // the row's single title, and a row whose tabs are on the window's strip
  // names only the tab in front.
  const paneTabs = titleRow && !stackOnStrip && orderedIds.length > 1;
  const [paneRowWidth, setPaneRowWidth] = useState(0);
  const paneFolded = paneTabs
    ? new Set(
        orderedIds.filter(
          (id) =>
            id !== frontId &&
            groupState.groups[groupState.members[id] ?? ""]?.collapsed,
        ),
      )
    : null;
  const paneRow = paneFolded
    ? titleRowTabs(
        orderedIds,
        frontId,
        titleRowCapacity(
          paneRowWidth,
          orderedIds.length - paneFolded.size,
          paneFolded.size > 0,
        ),
        paneFolded,
      )
    : null;
  // Labels sit in the sortable sequence so a group drags like a tab.
  const displayIds = paneRow
    ? paneRow.shown
    : titleRow
      ? frontId && !(frontNamedBelow && orderedIds.length <= 1)
        ? [frontId]
        : []
      : stripDisplayIds(segments);
  const paneHidden = paneRow?.hidden ?? NO_IDS;
  // One header per pane: a lone title row whose tab draws a toolbar of its
  // own gives it the row, and every title row lists the content's secondary
  // actions in the pane's one "…". The toolbar names the tab only when no
  // tab on the window's strip already does.
  const hostsHeader = titleRow && !paneTabs && frontOwnHeader && !!frontId;
  const paneHeader = useHostPaneHeader(titleRow ? frontId : null, {
    host: titleRow,
    offer: hostsHeader,
    names: !(frontNamed ?? (stackOnStrip && orderedIds.length > 1)),
  });
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  const lendSlotRef = paneHeader.slotRef;
  const setSlotRef = useCallback(
    (node: HTMLElement | null) => {
      lendSlotRef(node);
      setSlotElement(node);
    },
    [lendSlotRef],
  );
  const displayedTabIds = displayIds.filter((id) => !chipGroupId(id));
  // On a track (two tabs or more) the tabs share the strip's width and one
  // highlight slides under them. The window's strip shows no lone tab.
  const track = titleRow ? paneTabs : displayedTabIds.length >= 2;
  // A split alone on the strip still shows: its segments are the only way
  // to pull one of its tabs out onto the strip or another pane.
  const loneHidden =
    !titleRow &&
    hideLoneTab &&
    !track &&
    !(displayIds.length === 1 && splitEntries.has(displayIds[0]));
  // A split carries its own fill, so no hairline parts it from a neighbour.
  const separators = track
    ? trackSeparators(
        displayIds.map((id) => ({
          id,
          tab: !chipGroupId(id) && !splitEntries.has(id),
        })),
        focusedId,
      )
    : NO_SEPARATORS;
  const tabStopId = displayedTabIds.includes(focusedId)
    ? focusedId
    : displayedTabIds[0];
  const stripGroups = segments.flatMap((segment) =>
    segment.kind === "group" ? [segment] : [],
  );
  /**
   * Fold or unfold groups as Brave does: a folded group shows only its label.
   * If the tab you are on is folding away, move to the nearest tab that stays
   * visible; with none, the group still folds and its page stays open.
   */
  const foldGroups = (ids: readonly string[], collapsed: boolean) => {
    if (collapsed) {
      const folding = new Set(ids);
      const staysVisible = (id: string) => {
        const group = groupState.groups[groupState.members[id] ?? ""];
        return !group || (!folding.has(group.id) && !group.collapsed);
      };
      if (!staysVisible(focusedId)) {
        const index = orderedIds.indexOf(focusedId);
        const next =
          orderedIds.slice(index + 1).find(staysVisible) ??
          [...orderedIds.slice(0, Math.max(index, 0))]
            .reverse()
            .find(staysVisible);
        if (next) {
          if (browsers.has(next)) onSelectBrowser?.(unified ? next : undefined);
          else onSelect(next);
        }
      }
    }
    setSurfaceGroupsCollapsed(ids, collapsed);
  };
  // Moving to a tab inside a folded group (from the sidebar, a shortcut or an
  // agent) unfolds it, so the tab you are on is always shown in the strip.
  const lastFocused = useRef(focusedId);
  useEffect(() => {
    if (lastFocused.current === focusedId) return;
    lastFocused.current = focusedId;
    const group = groupState.groups[groupState.members[focusedId] ?? ""];
    if (group?.collapsed && orderedIds.includes(focusedId))
      changeSurfaceGroup(group.id, { collapsed: false });
    // Only a change of focus should unfold; the fold click itself does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  // Where a segment pulled out of its split would stand if let go on the
  // strip: before the first entry whose middle is past the pointer, or at
  // the end. `x` places the insertion line along the strip's content.
  const [tearSlot, setTearSlot] = useState<{
    before: string | null;
    x: number;
  } | null>(null);
  const tearSlotAt = (pointerX: number) => {
    const strip = tabStripRef.current;
    if (!strip) return null;
    const origin = strip.getBoundingClientRect().left - strip.scrollLeft;
    const slots = [
      ...strip.querySelectorAll<HTMLElement>(":scope > [data-motion-slot]"),
    ].filter((slot) => !chipGroupId(slot.dataset.motionSlot ?? ""));
    for (const slot of slots) {
      const rect = slot.getBoundingClientRect();
      if (pointerX < rect.left + rect.width / 2)
        return {
          before: slot.dataset.motionSlot ?? null,
          x: rect.left - origin - 1,
        };
    }
    const last = slots[slots.length - 1]?.getBoundingClientRect();
    return { before: null, x: last ? last.right - origin + 1 : 0 };
  };
  /** A single tab of the window's strip: a chat, file, iPhone or page. */
  const stripTab = (id: string) =>
    sessionTabs.has(id) || (unified && browsers.has(id));
  // A lone title row that names nothing (its tab split into panes that name
  // themselves) still moves its tab, by its empty space (see `grabZone`).
  const sortableIds =
    titleRow && !paneTabs && frontId && displayIds.length === 0
      ? [frontId]
      : displayIds;
  // Whether the drag in progress rests on (or is armed over) a tab it would
  // join, here or in another bar (`sortable.joining`, once it exists).
  const joiningRef = useRef<() => boolean>(() => false);
  /**
   * A title row's tab held over the window's strip: where it would stand
   * there, shown on the strip. Null when it is not over the strip, or rests
   * on the middle of a tab there that it would join.
   */
  const stripSlotFor = (x: number, y: number) => {
    const zone = titleRow && onDropOnStrip ? windowStripZone() : null;
    const slot = joiningRef.current() ? null : (zone?.slotAt(x, y) ?? null);
    zone?.show(slot ? x : null);
    return slot;
  };
  /**
   * What a dragged tab (or a segment pulled out of its split, or a whole
   * split) would bring to an entry it joins: its icon and name, as its
   * segment will show them.
   */
  const joinFor = (id: string): CombineJoin => {
    const tab = sessionTabs.get(id);
    if (tab)
      return {
        id,
        incoming: (
          <>
            <TabIdentity tab={tab} active />
            <span className="aven-split-label">
              {tabCopy(tab, projectlessWorkspace).headline}
            </span>
          </>
        ),
      };
    const page = browsers.get(id);
    if (page)
      return {
        id,
        incoming: (
          <>
            <BrowserTabIcon favicon={page.favicon} />
            <span className="aven-split-label">
              {page.title.trim() || "Browser"}
            </span>
          </>
        ),
      };
    return {
      id: null,
      incoming: <Columns2 className="size-3" strokeWidth={1.75} />,
    };
  };
  // A pane's row of tabs (or a detached window's pane strip) pairs two of
  // its tabs into a split of the window's layout.
  const pairs = Boolean(onPairTabs) && (!titleRow || paneTabs);
  /**
   * Something let go on the middle of `target`, from this bar or another:
   * on a split's entry it joins the split as a pane (beside the segment it
   * was let go on); on the window strip's single tab it makes a split with
   * it; on a tab in a pane's row, the two stand side by side.
   */
  const dropOn = (moving: string, target: string, at?: SortableDropAt) => {
    if (splitEntries.has(target)) {
      if (splitEntries.has(moving)) return;
      if (at) onAddToSplit?.(target, moving, { pane: at.part, side: at.side });
      else onAddToSplit?.(target, moving);
    } else if (onCombineTabs) onCombineTabs(target, moving);
    else onPairTabs?.(target, moving);
  };
  /**
   * Bars that lay out tabs (the window's strip, a pane's row of tabs) take
   * tabs dragged from any other: a pane's row, a lone pane's header or the
   * strip. A lone title row only lends its tab to them.
   */
  const link: SortableLink = {
    channel: WORKSPACE_TAB_LINK,
    accepts:
      !titleRow || paneTabs
        ? (moving, target) => {
            if (
              chipGroupId(moving) ||
              chipGroupId(target) ||
              isSpaceKey(moving)
            )
              return false;
            const split = splitEntries.get(target);
            if (split)
              return (
                Boolean(onAddToSplit) &&
                !split.segments.some((segment) => segment.id === moving) &&
                !split.members?.includes(moving)
              );
            return stripTab(target) && (Boolean(onCombineTabs) || pairs);
          }
        : undefined,
    onDrop: dropOn,
    describe: joinFor,
  };
  const sortable = useSortable(
    sortableIds,
    (ids, movedId) => {
      let members = groupState.members;
      // A title row draws no group labels, so moving a tab along it leaves
      // its group alone, and the tabs in its "+N" keep their places.
      const joined =
        movedId && !paneTabs
          ? groupAfterDrop(ids, movedId, members)
          : undefined;
      if (movedId && joined !== undefined) {
        members = { ...members };
        if (joined) members[movedId] = joined;
        else delete members[movedId];
        setSurfaceGroupMembership({ [movedId]: joined });
      }
      const order = paneTabs
        ? mergePreviewTabOrder(orderedIds, ids)
        : orderFromDisplay(ids, members, orderedIds);
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
      // Dropping onto an entry waits for the pointer to rest on its middle,
      // so moving a tab past it never joins them by accident.
      dropOnDelay: STRIP_COMBINE_DELAY_MS,
      // Let go on an entry's middle, a tab (or a segment pulled out of its
      // split) joins a split as a pane, or makes a split with a single tab;
      // a split takes a single tab as a pane. In a pane's row of tabs, two
      // tabs pair into a split of the window's layout.
      isDropTarget: (dragged, target, part) => {
        if (chipGroupId(dragged) || chipGroupId(target)) return false;
        const moving = part ?? dragged;
        if (splitEntries.has(target))
          return Boolean(onAddToSplit) && !splitEntries.has(moving);
        if (!stripTab(target)) return false;
        if (onCombineTabs)
          return (
            part !== undefined || splitEntries.has(dragged) || stripTab(dragged)
          );
        return pairs && stripTab(moving);
      },
      onDropOnItem: (dragged, target, part, at) =>
        dropOn(part ?? dragged, target, at),
      link,
      onDragMove: (id, x, y, pointer, part) => {
        // Resting on (or armed over) a tab it would join, here or in another
        // bar: no pane takes it, and nothing shows where else it would go.
        const joining = joiningRef.current();
        const toStage = (moving: string) =>
          joining
            ? onSurfaceDragMove?.(moving, x, y, pointer, true)
            : onSurfaceDragMove?.(moving, x, y, pointer);
        // A segment pulled out of its split drags as its own tab.
        if (part?.torn) {
          toStage(part.part);
          // Over an entry's middle it joins that entry: no line.
          const slot =
            part.inStrip && !part.target && !joining ? tearSlotAt(x) : null;
          setTearSlot((previous) =>
            previous?.before === slot?.before &&
            Math.abs((previous?.x ?? 0) - (slot?.x ?? 0)) < 0.5
              ? previous
              : slot,
          );
          return;
        }
        if (!chipGroupId(id) && !splitEntries.has(id)) toStage(id);
        stripSlotFor(x, y);
      },
      onDragEnd: (id, x, y, cancelled, pointer, part) => {
        if (part?.torn) {
          setTearSlot(null);
          if (cancelled || !part.inStrip)
            return onSurfaceDragEnd?.(part.part, x, y, cancelled, pointer)
              ? true
              : false;
          // Back on the strip: it stands there alone, or joins the entry it
          // was let go on. The stage only clears its drop hints.
          onSurfaceDragEnd?.(part.part, x, y, true, pointer);
          if (part.target) return false;
          onDetachFromSplit?.(part.part, tearSlotAt(x)?.before ?? null);
          return true;
        }
        const dragged = chipGroupId(id);
        // Group labels and splits reorder within this strip; leaving the
        // window cancels.
        if (dragged || splitEntries.has(id)) return false;
        // A pane's tab let go over the window's strip stands there alone.
        const stripSlot = stripSlotFor(x, y);
        windowStripZone()?.show(null);
        if (stripSlot && !cancelled && onDropOnStrip) {
          // The stage only clears its drop hints.
          onSurfaceDragEnd?.(id, x, y, true, pointer);
          onDropOnStrip(id, stripSlot.before);
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
  joiningRef.current = sortable.joining;
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  // Tabs grow in and closed tabs collapse, as in MonoCode. A lone title
  // changes its one tab in place, and becoming a row of tabs (or one again)
  // replaces the row rather than growing every tab in.
  const slotMotion = useTabSlotMotion(
    titleRow && !paneTabs ? LONE_TITLE_SLOTS : displayIds,
    tabStripRef,
    { morphed: sortable.morphed },
  );
  const highlightRef = useTabHighlight(tabStripRef, track ? focusedId : null, {
    // Off while a tab is dragged, and while the front tab's copy is still
    // flying to its place: it shows its own fill and hands over on landing.
    // Off too while a tab from another bar would join the front tab: its
    // preview draws the split's fill.
    enabled:
      track &&
      !sortable.draggingId &&
      sortable.landingId !== focusedId &&
      sortable.dropTarget?.id !== focusedId,
    layoutKey: displayIds.join("\n"),
    glideFrom: sortable.takeOrigin,
  });
  // What a dragged tab (or a segment pulled out of its split) would bring to
  // an entry it joins; a tab dragged from another bar says so itself.
  const dragContentId = sortable.draggingPartId ?? sortable.draggingId;
  const combineJoin: CombineJoin | null = dragContentId
    ? joinFor(dragContentId)
    : ((sortable.incoming?.content as CombineJoin | null | undefined) ?? null);
  /** The combine preview a strip tab draws while a drag could join it. */
  // Only the tab a held tab rests on draws the preview, and the last one it
  // rested on keeps it (hidden) so leaving it plays the preview back out.
  const joinTarget =
    sortable.dropTarget?.kind === "tab" ? sortable.dropTarget.id : null;
  const lastJoinTarget = useRef<string | null>(null);
  if (!sortable.draggingId && !sortable.incoming) lastJoinTarget.current = null;
  else if (joinTarget) lastJoinTarget.current = joinTarget;
  const combineJoinFor = (id: string): CombineJoin | null =>
    combineJoin &&
    (onCombineTabs || pairs) &&
    id !== sortable.draggingId &&
    (id === joinTarget || id === lastJoinTarget.current)
      ? combineJoin
      : null;
  const [stackMenu, setStackMenu] = useState<HTMLElement | null>(null);
  // A segment of a split not in front says where a click goes, once the
  // pointer rests on it.
  const [segmentTip, setSegmentTip] = useState<{
    anchor: HTMLElement;
    label: string;
  } | null>(null);
  const segmentTipTimer = useRef<number | null>(null);
  const hideSegmentTip = useCallback(() => {
    if (segmentTipTimer.current !== null)
      window.clearTimeout(segmentTipTimer.current);
    segmentTipTimer.current = null;
    setSegmentTip(null);
  }, []);
  const showSegmentTip = useCallback((anchor: HTMLElement, label: string) => {
    if (segmentTipTimer.current !== null)
      window.clearTimeout(segmentTipTimer.current);
    segmentTipTimer.current = window.setTimeout(() => {
      segmentTipTimer.current = null;
      if (anchor.isConnected) setSegmentTip({ anchor, label });
    }, SPLIT_TIP_DELAY_MS);
  }, []);
  useEffect(() => hideSegmentTip, [hideSegmentTip]);
  // A drag, or the split coming to the front, takes the hint away.
  useEffect(() => {
    if (sortable.draggingId) hideSegmentTip();
  }, [sortable.draggingId, hideSegmentTip]);
  useEffect(() => {
    hideSegmentTip();
  }, [focusedId, hideSegmentTip]);
  const focusedTabControlRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  // The strip mounts and unmounts as the pane lends its header, so effects
  // that listen to it follow the element itself.
  const [tabStripElement, setTabStripElement] = useState<HTMLDivElement | null>(
    null,
  );
  const setTabStripRef = useCallback(
    (el: HTMLDivElement | null) => {
      tabStripRef.current = el;
      setTabStripElement(el);
      sortable.setContainerRef(el);
      lockOverscroll(el);
    },
    [lockOverscroll, sortable.setContainerRef],
  );
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [tabMenu, setTabMenu] = useState<{
    /**
     * A tab, a group label, a split's entry, or empty strip space.
     * Defaults to a tab.
     */
    kind?: "tab" | "group" | "split" | "bar";
    tabId: string;
    groupId?: string;
    /** Secondary page for longer action lists. */
    page?: string;
    x: number;
    y: number;
    anchor?: HTMLElement;
  } | null>(null);
  // A page selection must not let the previous menu close its replacement.
  const menuPageSwitch = useRef(false);
  // Pages swap the items of one open menu rather than remounting it, which
  // would measure, animate and focus it all over again. Selecting the page
  // item returned focus to the tab, so bring it back to the new page's first
  // item, at the top of its list, before the page paints.
  const tabMenuClass = `title-tab-menu-${useId().replace(/[^\w-]/g, "")}`;
  useLayoutEffect(() => {
    const switched = menuPageSwitch.current;
    menuPageSwitch.current = false;
    if (!switched) return;
    const items = document.querySelector<HTMLElement>(
      `.${tabMenuClass} [role="menu"]`,
    );
    if (!items) return;
    items.scrollTop = 0;
    const first = items.querySelector<HTMLElement>("button:not(:disabled)");
    (first ?? items).focus({ preventScroll: true });
  }, [tabMenu?.page, tabMenu?.kind, tabMenuClass]);
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
    setTabMenu({
      kind: "group",
      tabId: focusedId,
      groupId: group,
      x,
      y,
      anchor,
    });
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

  // The window's strip takes tabs dragged from panes' headers
  // (windowStripDrop.ts): the line a segment pulled out of its split shows
  // marks where one would stand.
  const tearSlotRef = useRef(tearSlotAt);
  tearSlotRef.current = tearSlotAt;
  useEffect(() => {
    if (titleRow || !acceptsPaneDrops) return;
    return setWindowStripZone({
      slotAt: (x, y) => {
        const rect = tabStripRef.current?.getBoundingClientRect();
        if (
          !rect ||
          rect.width <= 0 ||
          x < rect.left ||
          x > rect.right ||
          y < rect.top ||
          y > rect.bottom
        )
          return null;
        return { before: tearSlotRef.current(x)?.before ?? null };
      },
      show: (x) => {
        const slot = x === null ? null : tearSlotRef.current(x);
        setTearSlot((previous) =>
          previous?.before === slot?.before &&
          Math.abs((previous?.x ?? 0) - (slot?.x ?? 0)) < 0.5
            ? previous
            : slot,
        );
      },
    });
  }, [titleRow, acceptsPaneDrops]);

  // One header per pane. A lone pane whose header row is lent to its tab's
  // own toolbar (a page's address, an iPhone's pickers, a tab of files), or
  // keeps only the pane's tools, has no chip to move the tab by. The row's
  // empty space is the handle instead, and so is what names the tab there
  // (a page's title, a lone file's tab: `data-pane-grab`). A stand-in for
  // the tab's chip, drawn only while held, is what the drag lifts and flies
  // home (`HeaderGrab`); what names the tab hides while it is away.
  const grabZone =
    !titleRow || paneTabs || !frontId || !canDrag
      ? null
      : hostsHeader
        ? slotElement
        : displayIds.length === 0
          ? tabStripElement
          : null;
  const [grab, setGrab] = useState<HeaderGrab | null>(null);
  const grabRef = useRef<HTMLDivElement | null>(null);
  const grabbing = useRef(false);
  const grabLatest = useRef({ frontId, sortable });
  grabLatest.current = { frontId, sortable };
  useEffect(() => {
    const zone = grabZone;
    if (!zone) return;
    const onPointerDown = (event: PointerEvent) => {
      grabbing.current = false;
      const { frontId: id, sortable: api } = grabLatest.current;
      // A Control-click is the Mac's right-click: the tab's menu.
      if (event.button !== 0 || event.ctrlKey || !id) return;
      const target = headerGrabTarget(event.target, zone);
      if (!target) return;
      // A press on the row ends an edit in its toolbar, as a press off a
      // field always has (its default is prevented below): the address goes
      // back to naming the page, ready to lift with the tab.
      const editing = document.activeElement;
      if (
        editing instanceof HTMLElement &&
        zone.contains(editing) &&
        editing.matches(HEADER_EDITABLE)
      ) {
        editing.blur();
        flushSync(() => {});
      }
      const faces = [
        ...zone.querySelectorAll<HTMLElement>('[data-pane-grab="face"]'),
      ];
      const box = headerGrabBox(faces, zone, event.clientX);
      flushSync(() => setGrab({ id, ...box, pressing: true }));
      // Fixed to the viewport, unless an ancestor makes another box its
      // containing block: then place it by what was drawn.
      const drawn = grabRef.current?.getBoundingClientRect();
      if (
        drawn &&
        (Math.abs(drawn.left - box.left) > 0.5 ||
          Math.abs(drawn.top - box.top) > 0.5)
      )
        flushSync(() =>
          setGrab((current) =>
            current
              ? {
                  ...current,
                  left: 2 * box.left - drawn.left,
                  top: 2 * box.top - drawn.top,
                }
              : current,
          ),
        );
      grabbing.current = true;
      api.onItemPointerDown(id, event, undefined, {
        handle: target.handle ?? zone,
        stands: faces,
      });
      // The press is over once let go, or once Escape ends the drag.
      const released = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== "Escape") return;
        window.removeEventListener("pointerup", released);
        window.removeEventListener("pointercancel", released);
        window.removeEventListener("blur", released);
        window.removeEventListener("keydown", released);
        setGrab((current) =>
          current?.pressing ? { ...current, pressing: false } : current,
        );
      };
      window.addEventListener("pointerup", released);
      window.addEventListener("pointercancel", released);
      window.addEventListener("blur", released);
      window.addEventListener("keydown", released);
    };
    // The handle never takes focus: pressing it moves the tab, and a click
    // on a page's title edits its address once let go (BrowserPane). A
    // right-click (or Control-click) on it opens the tab's menu: focused,
    // the address would stop naming the page before the menu is asked for.
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey) {
        if (headerMenuTarget(event.target, zone)) event.preventDefault();
        return;
      }
      if (!grabbing.current) return;
      grabbing.current = false;
      event.preventDefault();
    };
    // Let go after a drag, nothing under the pointer is clicked.
    const onClick = (event: MouseEvent) => {
      if (!grabLatest.current.sortable.consumeClick()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Right-click on the handle: the tab's own menu, as on its chip.
    const onContextMenu = (event: MouseEvent) => {
      const id = grabLatest.current.frontId;
      if (!id || !headerMenuTarget(event.target, zone)) return;
      event.preventDefault();
      event.stopPropagation();
      setBrowserMenu(null);
      setTabMenu({ tabId: id, x: event.clientX, y: event.clientY });
    };
    zone.addEventListener("pointerdown", onPointerDown, true);
    zone.addEventListener("mousedown", onMouseDown, true);
    zone.addEventListener("click", onClick, true);
    zone.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      zone.removeEventListener("pointerdown", onPointerDown, true);
      zone.removeEventListener("mousedown", onMouseDown, true);
      zone.removeEventListener("click", onClick, true);
      zone.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [grabZone]);
  // The stand-in goes once the press is over and the copy has landed.
  useEffect(() => {
    if (!grab || grab.pressing) return;
    if (sortable.draggingId === grab.id || sortable.landingId === grab.id)
      return;
    setGrab(null);
  }, [grab, sortable.draggingId, sortable.landingId]);
  const grabItem = (id: string) => {
    const tab = sessionTabs.get(id);
    if (tab)
      return (
        <TitleTabItem
          tab={tab}
          projectless={projectlessWorkspace}
          index={0}
          active
          tabStop={false}
          visible
          closable={false}
          canDrag
          sortable={sortable}
          onSelect={noop}
          onClose={noop}
          onContextMenu={noop}
        />
      );
    const page = browsers.get(id);
    if (page)
      return (
        <BrowserTitleTabItem
          id={id}
          title={page.title}
          favicon={page.favicon}
          index={0}
          active
          tabStop={false}
          visible
          legacy={!unified}
          canDrag
          sortable={sortable}
          onSelect={noop}
          onContextMenu={noop}
          menuOpen={false}
        />
      );
    return null;
  };
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
    if (strip) {
      const next = strip.querySelector<HTMLButtonElement>(
        '[role="tab"][tabindex="0"]',
      );
      (next ?? strip).focus();
      return;
    }
    // A lent header has no strip: its toolbar, then the pane's "…".
    const header = headerRef.current;
    const slot = header?.querySelector<HTMLElement>("[data-pane-header-slot]");
    const target =
      slot?.querySelector<HTMLElement>(LENT_HEADER_FOCUSABLE) ??
      header?.querySelector<HTMLElement>('[data-pane-tool="more"]');
    target?.focus();
  });

  useLayoutEffect(() => {
    const el = tabStripElement;
    syncTabOverflow();
    if (!el) return;
    el.addEventListener("scroll", syncTabOverflow, { passive: true });
    const ro = new ResizeObserver(syncTabOverflow);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", syncTabOverflow);
      ro.disconnect();
    };
  }, [tabStripElement, syncTabOverflow]);

  // A row of tabs in a title row fits its tabs to the strip's width, less
  // the strip's own buttons after them (the "+N" keeps its room in
  // titleRowCapacity). The strip's width never depends on how many tabs it
  // shows, so this settles in one pass.
  const hasStripTools = Boolean(onOpenIphone);
  useLayoutEffect(() => {
    const el = tabStripElement;
    if (!paneTabs || !el) return;
    const measure = () => {
      let width = el.clientWidth;
      for (const tool of el.querySelectorAll<HTMLElement>(
        ":scope > [data-strip-tool]",
      ))
        width -= tool.offsetWidth + TAB_TRACK_GAP;
      setPaneRowWidth((previous) =>
        Math.abs(previous - width) < 0.5 ? previous : width,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tabStripElement, paneTabs, hasStripTools]);

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
    if (!productName || !windowTitle || (paneLocal && !paneFocused)) return;
    document.title = systemTitle;
    try {
      void getCurrentWindow()
        .setTitle(systemTitle)
        .catch(() => {});
    } catch {}
  }, [systemTitle, paneLocal, paneFocused, productName, windowTitle]);

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
  // A pane's tab can leave for a pane of its own beside it (Cydonia's deck
  // offered this; it is here now that the tabs sit side by side).
  if (contextId && paneTabs && onSplitTab)
    moveItems.push({
      kind: "item",
      id: "own-pane",
      label: "Move to a pane of its own",
    });
  if (contextId && onReturnTabToWindow)
    moveItems.push({
      kind: "item",
      id: "return-tab-window",
      label: "Return tab to original window",
    });
  // The keyboard's way to combine on the window's strip: the tab's menu
  // names the entries it can join, as letting it go on their middle would.
  const combineItems: ExplorerMenuItem[] =
    contextId && menuKind === "tab" && onCombineTabs && stripTab(contextId)
      ? displayIds.flatMap((id): ExplorerMenuItem[] => {
          if (id === contextId || chipGroupId(id)) return [];
          const split = splitEntries.get(id);
          if (split)
            return onAddToSplit
              ? [
                  {
                    kind: "item",
                    id: `strip-join:${id}`,
                    label: split.segments
                      .map((segment) =>
                        splitSegmentLabel(segment, projectlessWorkspace),
                      )
                      .join(" + "),
                  },
                ]
              : [];
          if (!stripTab(id)) return [];
          const tab = sessionTabs.get(id);
          return [
            {
              kind: "item",
              id: `strip-combine:${id}`,
              label: tab
                ? tabCopy(tab, projectlessWorkspace).headline
                : browsers.get(id)?.title.trim() || "Browser",
            },
          ];
        })
      : [];
  // The pane's "…" (its More tool) adds what the pane and its content offer
  // to the tab's own actions: the content's secondary actions, Recent
  // pages, the iPhone, moving and hiding the pane.
  const moves = titleRow && onMovePane ? (paneMoves ?? []) : [];
  const paneMenuOpen =
    titleRow &&
    menuKind === "tab" &&
    tabMenu?.anchor?.dataset.paneTool === "more";
  const contentMenu = paneMenuOpen ? paneHeader.menu : null;
  const contentItem = (item: ExplorerMenuItem): ExplorerMenuItem =>
    item.kind === "item"
      ? {
          ...item,
          id: item.id.startsWith("page:")
            ? `page:content:${item.id.slice("page:".length)}`
            : `content:${item.id}`,
        }
      : item;
  const contentItems = contentMenu ? contentMenu.items().map(contentItem) : [];
  const contentPages: Record<string, ExplorerMenuItem[]> = Object.fromEntries(
    Object.entries(contentMenu?.pages?.() ?? {}).map(([name, items]) => [
      `content:${name}`,
      items.map(contentItem),
    ]),
  );
  const recentItems: ExplorerMenuItem[] =
    paneMenuOpen && previewEnabled
      ? [...browserEntries].reverse().map((tab) => ({
          kind: "item",
          id: `recent:${tab.id}`,
          label: tab.title || "Browser",
          description: tab.url,
          checked: tab.id === focusedId,
          shortcut: tab.kept ? "Kept" : undefined,
        }))
      : [];
  const paneMoveItems: ExplorerMenuItem[] = paneMenuOpen
    ? [
        ...moves.map((side): ExplorerMenuItem => ({
          kind: "item",
          id: `pane-move:${side}`,
          label: MOVE_LABEL[side],
        })),
        ...(moves.length && moveItems.length ? [{ kind: "sep" } as const] : []),
        ...moveItems,
      ]
    : moveItems;
  const paneHideItems: ExplorerMenuItem[] =
    paneMenuOpen && onHidePane
      ? (paneHides ?? []).map((hide) => ({
          kind: "item",
          id: `pane-hide:${hide.key}`,
          label: hide.label,
        }))
      : [];
  const joinableGroups = stripGroups.filter(
    (segment) => segment.group.id !== contextGroupId,
  );
  const groupPageItems: ExplorerMenuItem[] = [
    { kind: "item", id: "group-new", label: "New group" },
    ...(joinableGroups.length ? [{ kind: "sep" } as const] : []),
    ...joinableGroups.map((segment): ExplorerMenuItem => ({
      kind: "item",
      id: `group-join:${segment.group.id}`,
      label: groupName(segment.group),
      description: `${segment.members.length} ${
        segment.members.length === 1 ? "tab" : "tabs"
      }`,
    })),
  ];
  const closeItems: ExplorerMenuItem[] = contextTab
    ? [
        {
          kind: "item",
          id: "others",
          label: unified ? "Close other chats" : "Close other tabs",
          disabled: contextCloseIds?.others.length === 0,
        },
        {
          kind: "item",
          id: "right",
          label: unified
            ? "Close chats to the right"
            : "Close tabs to the right",
          disabled: contextCloseIds?.right.length === 0,
        },
        {
          kind: "item",
          id: "left",
          label: unified ? "Close chats to the left" : "Close tabs to the left",
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
    if (contentItems.length)
      tabRootItems.push(...contentItems, { kind: "sep" });
    if (recentItems.length)
      tabRootItems.push({
        kind: "item",
        id: "page:recent",
        label: "Recent pages",
        shortcut: "›",
      });
    if (paneMenuOpen && onOpenIphone)
      tabRootItems.push({
        kind: "item",
        id: "bar-open-iphone",
        label: "iPhone",
      });
    // An agent's page is kept as a tab but still the agent's to reuse:
    // keeping it makes it the user's, and the chat opens a page of its own.
    if (contextBrowser?.agentChatName && onKeepAgentPage)
      tabRootItems.push(
        {
          kind: "item",
          id: "keep-open",
          label: "Keep this page",
          description: `${contextBrowser.agentChatName} will open its own page instead of reusing this one`,
        },
        { kind: "sep" },
      );
    else if (contextBrowser && onKeepBrowser && !contextBrowser.kept)
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
    const onlyCombine = combineItems.length === 1 ? combineItems[0] : null;
    if (onlyCombine?.kind === "item")
      tabRootItems.push({
        ...onlyCombine,
        label: `Combine with ${onlyCombine.label}`,
      });
    else if (combineItems.length)
      tabRootItems.push({
        kind: "item",
        id: "page:combine",
        label: "Combine with",
        shortcut: "›",
      });
    if (contextGroup)
      tabRootItems.push({
        kind: "item",
        id: "group-leave",
        label: "Remove from group",
      });
    tabRootItems.push(
      ...pageEntry("split", "Split", splitItems),
      ...pageEntry("move", paneMenuOpen ? "Move" : "Move to", paneMoveItems),
      ...paneHideItems,
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
        label: "Compare",
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
  // A split's entry: take it apart, or close every tab in it.
  const menuSplit =
    menuKind === "split" && tabMenu ? splitEntries.get(tabMenu.tabId) : null;
  const splitRootItems: ExplorerMenuItem[] = menuSplit
    ? [
        ...(onSeparateSplit
          ? [
              {
                kind: "item" as const,
                id: "split-separate",
                label: "Separate split",
              },
            ]
          : []),
        { kind: "sep" },
        ...(onCloseSplit
          ? [
              {
                kind: "item" as const,
                id: "split-close",
                label: "Close split",
                disabled: menuSplit.closable === false,
              },
            ]
          : []),
      ]
    : [];
  // Empty strip space: actions for the whole strip.
  const barItems: ExplorerMenuItem[] = [];
  barItems.push({ kind: "item", id: "bar-new-session", label: "New chat" });
  if (onNewBrowser)
    barItems.push({
      kind: "item",
      id: "bar-new-browser",
      label: "New browser tab",
    });
  if (onOpenIphone)
    barItems.push({ kind: "item", id: "bar-open-iphone", label: "iPhone" });
  else if (iphoneHint)
    barItems.push({
      kind: "item",
      id: "bar-iphone-hint",
      label: iphoneHint,
      disabled: true,
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
  if (groupId && onReturnGroupToWindow) {
    barItems.push({ kind: "sep" });
    barItems.push({
      kind: "item",
      id: "return-group-window",
      label: "Return all tabs to original window",
    });
  }

  const pages: Record<string, ExplorerMenuItem[]> = {
    group: groupPageItems,
    combine: combineItems,
    split: splitItems,
    move: paneMoveItems,
    close: closeItems,
    color: colorItems,
    recent: recentItems,
    ...contentPages,
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
          : menuKind === "split"
            ? splitRootItems
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
    if (id.startsWith("content:")) {
      contentMenu?.pick(id.slice("content:".length));
      return;
    }
    if (id.startsWith("recent:")) {
      const page = id.slice("recent:".length);
      if (browsers.has(page)) onSelectBrowser?.(unified ? page : undefined);
      return;
    }
    if (id.startsWith("pane-move:")) {
      const side = id.slice("pane-move:".length) as PaneSide;
      if (moves.includes(side)) onMovePane?.(side);
      return;
    }
    if (id.startsWith("pane-hide:")) {
      onHidePane?.(id.slice("pane-hide:".length));
      return;
    }
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
    if (id === "bar-open-iphone") {
      onOpenIphone?.();
      return;
    }
    if (id === "fold-all" || id === "unfold-all") {
      foldGroups(
        stripGroups.map((segment) => segment.group.id),
        id === "fold-all",
      );
      return;
    }
    if (id === "return-group-window" && groupId) {
      onReturnGroupToWindow?.(groupId);
      return;
    }
    if (menuSplit) {
      if (id === "split-separate") {
        // Its segments glide into the tabs they become.
        sortable.captureStripMorph();
        onSeparateSplit?.(menuSplit.id);
      } else if (id === "split-close" && menuSplit.closable !== false)
        onCloseSplit?.(menuSplit.id);
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
      } else if (id === "group-fold") foldGroups([group.id], !group.collapsed);
      else if (id === "group-ungroup") ungroupSurfaceGroup(group.id);
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
    } else if (id.startsWith("strip-combine:")) {
      // Morphs into the split it makes, as a drop does.
      sortable.captureStripMorph();
      onCombineTabs?.(id.slice("strip-combine:".length), contextId);
    } else if (id.startsWith("strip-join:")) {
      sortable.captureStripMorph();
      onAddToSplit?.(id.slice("strip-join:".length), contextId);
    } else if (id === "keep-open") {
      if (contextBrowser?.agentChatName && onKeepAgentPage)
        onKeepAgentPage(contextId);
      else if (contextBrowser) onKeepBrowser?.(contextId);
    } else if (id === "own-pane") {
      const beside =
        contextId !== frontId
          ? frontId
          : orderedIds.find((other) => other !== contextId);
      if (beside) onSplitTab?.(contextId, "right", beside);
    } else if (id === "return-tab-window") {
      onReturnTabToWindow?.(contextId);
    } else if (id === "race-overview") {
      onOpenRaceOverview?.(contextId);
    } else if (id === "new-view") {
      onNewView?.(contextId);
    } else if (id.startsWith("combine:")) {
      const targetId = id.slice("combine:".length);
      if (availableCombineTargets.some((target) => target.id === targetId)) {
        sortable.captureStripMorph();
        onCombineWith?.(targetId);
      }
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
        {projectless && railClosed && onOpenAutomations ? (
          <IconButton label="Automations" onClick={onOpenAutomations}>
            <Clock className="size-3.5" strokeWidth={1.75} />
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
            <IconButton label={`New chat (${MOD}T)`} onClick={onNew}>
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

  // A lone title row draws its tab's icon on a tile.
  const deck = titleRow && !paneTabs;
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
            menuKind === "group" && tabMenu?.groupId === labelSegment.group.id
          }
          onToggle={() =>
            foldGroups([labelSegment.group.id], !labelSegment.group.collapsed)
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
      // Anchored on the tab's own button, which Escape gives focus back to
      // (WebKit does not focus the tab's box).
      setTabMenu({ tabId: id, x, y, anchor: focusableIn(element) });
    };
    if (tab)
      return (
        <div
          key={id}
          className="personal-title-tab-slot aven-tab-slot relative flex h-full shrink cursor-default items-center"
          data-motion-slot={id}
          data-tab-opening={slotMotion.opening.has(id) || undefined}
          {...{ [TAB_TRACK_ID_ATTRIBUTE]: id }}
          data-tab-separator={separators.has(id) || undefined}
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
            deck={deck}
            combineInto={sortable.dropTarget?.id === id}
            combineNear={sortable.joinHint === id}
            combine={combineJoinFor(id)}
          />
        </div>
      );
    const split = splitEntries.get(id);
    if (split)
      return (
        <SplitEntryItem
          key={id}
          split={split}
          projectless={projectlessWorkspace}
          index={index}
          active={id === focusedId}
          tabStop={id === tabStopId}
          canDrag={canDrag}
          sortable={sortable}
          onSelectTab={(tabId) => {
            hideSegmentTip();
            onSelectSplitTab?.(tabId);
          }}
          onContextMenu={(event, anchor) => {
            setBrowserMenu(null);
            setTabMenu({
              kind: "split",
              tabId: id,
              x: event.clientX,
              y: event.clientY,
              anchor: focusableIn(anchor),
            });
          }}
          onHover={(anchor, label) =>
            anchor && label && !sortable.draggingId
              ? showSegmentTip(anchor, label)
              : hideSegmentTip()
          }
          dropInto={sortable.dropTarget?.id === id}
          dropNear={sortable.joinHint === id}
          dropAt={
            sortable.dropTarget?.id === id ? sortable.dropTarget.at : null
          }
          join={sortable.dropTarget?.id === id ? combineJoin : null}
          opening={slotMotion.opening.has(id)}
          itemRef={itemRef}
        />
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
          (unified || Boolean(onReorderSurfaces) || Boolean(onSurfaceDragEnd))
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
        onContextMenu={(event) => openMenu(event.clientX, event.clientY)}
        // A title row's page opens the same menu from a right-click or the
        // pane's "…", so it draws no layout arrow of its own.
        onMenu={
          !titleRow && (hasSurfaceMenu || onBrowserModeChange)
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
        menuOpen={tabMenu?.tabId === id || (!unified && Boolean(browserMenu))}
        preview={previewEnabled && preview.previewId === id}
        agentChatName={browser.agentChatName}
        // Double-click keeps a page: an agent's, from its chat.
        onKeep={
          browser.agentChatName && onKeepAgentPage
            ? () => onKeepAgentPage(id)
            : onKeepBrowser
              ? () => onKeepBrowser(id)
              : undefined
        }
        groupStyle={groupStyle}
        groupRun={groupRun}
        opening={slotMotion.opening.has(id)}
        itemRef={itemRef}
        separator={separators.has(id)}
        deck={deck}
        combineInto={sortable.dropTarget?.id === id}
        combineNear={sortable.joinHint === id}
        combine={combineJoinFor(id)}
      />
    );
  };
  // The title row's tools act on the tab in front.
  const frontTab = frontId ? sessionTabs.get(frontId) : undefined;
  const frontBrowser = frontId ? browsers.get(frontId) : undefined;
  const frontTool = !titleRow
    ? null
    : frontTab
      ? {
          id: frontTab.id,
          closeLabel: "Close tab",
          close: titleTabClosable(frontTab, sessionTabCount)
            ? () => onClose(frontTab.id)
            : undefined,
        }
      : frontBrowser
        ? {
            id: frontBrowser.id,
            closeLabel: "Close browser",
            close: onCloseBrowser
              ? () => onCloseBrowser(unified ? frontBrowser.id : undefined)
              : undefined,
          }
        : null;
  // The "+N" lists the pane's tabs that are not in its row.
  const stackItems: ExplorerMenuItem[] = paneHidden.map(
    (id): ExplorerMenuItem => {
      const tab = sessionTabs.get(id);
      return {
        kind: "item",
        id: `stack:${id}`,
        label: tab
          ? tabCopy(tab, projectlessWorkspace).headline
          : browsers.get(id)?.title.trim() || "Browser",
      };
    },
  );
  const pickStack = (item: string) => {
    setStackMenu(null);
    const id = item.slice("stack:".length);
    if (sessionTabs.has(id)) onSelect(id);
    else if (browsers.has(id)) onSelectBrowser?.(unified ? id : undefined);
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
      ref={headerRef}
      className="personal-titlebar flex h-10 shrink-0 select-none items-stretch border-b border-content/10"
      data-pane-local={paneLocal || undefined}
      data-variant={variant}
      data-title-layout={titleRow ? (paneTabs ? "tabs" : "lone") : undefined}
      // The line under the pane's whole header is drawn below this row when
      // the tab in front draws its own row under it, or (a tab split into
      // panes) its panes' strips do.
      data-header-continues={
        (titleRow &&
          (paneTabs
            ? frontOwnHeader
            : frontNamedBelow && orderedIds.length <= 1)) ||
        undefined
      }
      data-pane-focused={paneFocused}
      data-tauri-drag-region={paneLocal ? "false" : "deep"}
      onContextMenu={(event) => {
        event.preventDefault();
        openBarMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          // A tab being dragged: Esc cancels the drag, and nothing else.
          document.documentElement.classList.contains("is-reordering") ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          !(event.target as HTMLElement).closest("button, [role='tab']")
        )
          return;
        event.preventDefault();
        returnFocusToPane(event.currentTarget);
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
        {hostsHeader ? (
          // The tab's own toolbar draws here, in place of its name.
          <div
            ref={setSlotRef}
            className="aven-pane-header-slot"
            data-pane-header-slot={frontId}
            // The pane's tabs, as its strip lists them, for a drop's target.
            data-surface-order={JSON.stringify(allOrderedIds)}
          />
        ) : (
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
              role={titleRow && !paneTabs ? "group" : "tablist"}
              tabIndex={displayedTabIds.length ? -1 : 0}
              data-sortable-scroll-container
              data-surface-order={JSON.stringify(allOrderedIds)}
              aria-label={
                titleRow
                  ? paneTabs
                    ? "Tabs in this pane"
                    : "Pane"
                  : "Workspace tabs"
              }
              aria-orientation={
                titleRow && !paneTabs ? undefined : "horizontal"
              }
              data-tab-track={track || undefined}
              className="personal-tab-strip aven-tab-strip scrollbar-none flex h-full min-w-0 cursor-default items-center overflow-x-auto overflow-y-hidden overscroll-none"
              onFocusCapture={(event) => {
                const target = event.target as HTMLElement;
                focusedTabControlRef.current = target.closest(
                  "[data-surface-tab-id]",
                )
                  ? target
                  : null;
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
                // A split's segments are tabs of the strip in their own
                // right: the arrows step through them like any tab.
                const segment = nextButton?.dataset.splitSegment;
                nextButton?.focus();
                if (segment) onSelectSplitTab?.(segment);
                else if (id && sessionTabs.has(id)) onSelect(id);
                else if (id && browsers.has(id))
                  onSelectBrowser?.(unified ? id : undefined);
              }}
            >
              {track ? (
                <span
                  ref={highlightRef}
                  className="aven-tab-highlight"
                  aria-hidden
                />
              ) : null}
              {slotGhosts(null)}
              {tearSlot ? (
                <div
                  className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 z-20 rounded-full"
                  data-tear-insertion
                  style={{ left: tearSlot.x }}
                />
              ) : null}
              {loneHidden
                ? null
                : displayIds.flatMap((id, index) => [
                    stripItem(id, index),
                    ...slotGhosts(id),
                  ])}
              {paneHidden.length ? (
                <button
                  type="button"
                  className="aven-title-more"
                  data-title-overflow
                  data-no-drag
                  data-tauri-drag-region="false"
                  aria-label={`${paneHidden.length} more ${
                    paneHidden.length === 1 ? "tab" : "tabs"
                  } in this pane`}
                  title={`${paneHidden.length} more ${
                    paneHidden.length === 1 ? "tab" : "tabs"
                  } in this pane`}
                  aria-haspopup="menu"
                  aria-expanded={Boolean(stackMenu)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    const button = event.currentTarget;
                    setTabMenu(null);
                    setStackMenu((open) => (open ? null : button));
                  }}
                >
                  +{paneHidden.length}
                </button>
              ) : null}
              {paneLocal && !titleRow ? (
                <button
                  type="button"
                  aria-label="New chat"
                  title="New chat"
                  data-tauri-drag-region="false"
                  className="personal-title-session-new relative grid h-full shrink-0 place-items-center text-content/45 hover:text-content"
                  onClick={onNew}
                >
                  <Plus className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
              {!titleRow &&
              (onNewBrowser ||
                (browserEntries.length === 0 && onSelectBrowser)) ? (
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
                  data-tour="browser-button"
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
              {onOpenBoard && !titleRow ? (
                <button
                  type="button"
                  aria-label="Open board"
                  title="Open this project's board"
                  data-tauri-drag-region="false"
                  data-tour="board"
                  className="personal-title-board-open relative grid h-full shrink-0 place-items-center text-content/45 hover:text-content"
                  onClick={onOpenBoard}
                >
                  <Kanban className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
              {onOpenIphone && !titleRow ? (
                <button
                  type="button"
                  aria-label="iPhone"
                  title="Run this project's app on an iPhone simulator"
                  data-tauri-drag-region="false"
                  data-strip-tool
                  className="personal-title-board-open personal-title-iphone-open relative grid h-full shrink-0 place-items-center text-content/45 hover:text-content"
                  onClick={onOpenIphone}
                >
                  <Smartphone className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {previewEnabled &&
        browserEntries.length > 0 &&
        !titleRow &&
        !previewActionsInPane ? (
          <div
            className="personal-tab-preview-actions"
            data-tauri-drag-region="false"
          >
            {preview.previewId === focusedId ? (
              <button
                type="button"
                className="personal-tab-preview-action"
                aria-label="Keep browser open"
                title="Keep this page as a tab. Otherwise the next page you open takes its place."
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
              title="Pages you opened recently, including ones no longer shown as tabs"
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
        {titleRow ? (
          <div
            className="aven-pane-tools"
            data-pane-tools
            data-open={
              (Boolean(tabMenu) &&
                tabMenu?.anchor?.dataset.paneTool === "more") ||
              undefined
            }
            data-tauri-drag-region="false"
          >
            {frontTool ? (
              <button
                type="button"
                className="aven-pane-tool"
                data-pane-tool="more"
                aria-label="More actions"
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={tabMenu?.anchor?.dataset.paneTool === "more"}
                onClick={(event) => {
                  const button = event.currentTarget;
                  if (tabMenu?.anchor === button) {
                    setTabMenu(null);
                    return;
                  }
                  const rect = button.getBoundingClientRect();
                  setStackMenu(null);
                  setBrowserMenu(null);
                  setTabMenu({
                    tabId: frontTool.id,
                    x: rect.left,
                    y: rect.bottom,
                    anchor: button,
                  });
                }}
              >
                <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
            {paneZoom && onTogglePaneZoom ? (
              <button
                type="button"
                className="aven-pane-tool"
                aria-label={paneZoom === "restore" ? "Restore" : "Expand"}
                title={`${paneZoom === "restore" ? "Restore" : "Expand"} (${CTRL}${ALT}Z)`}
                onClick={onTogglePaneZoom}
              >
                {paneZoom === "restore" ? (
                  <Minimize2 className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <Maximize2 className="size-3.5" strokeWidth={1.75} />
                )}
              </button>
            ) : null}
            {/* A row of tabs closes each from its own ×; a lone tab's is here. */}
            {frontTool?.close && !paneTabs ? (
              <button
                type="button"
                className="aven-pane-tool"
                aria-label={frontTool.closeLabel}
                title={`${frontTool.closeLabel} (${MOD}W)`}
                onClick={frontTool.close}
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
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
      <SplitSegmentTip tip={segmentTip} />
      {grab ? (
        <div
          ref={grabRef}
          className="aven-header-grab"
          data-header-grab={grab.id}
          aria-hidden
          inert
          style={{
            left: grab.left,
            top: grab.top,
            width: grab.width,
            height: grab.height,
          }}
        >
          {grabItem(grab.id)}
        </div>
      ) : null}
      {stackMenu && stackItems.length ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={stackMenu}
          align="start"
          gap={4}
          width={260}
          ariaLabel="More tabs in this pane"
          items={stackItems}
          onPick={pickStack}
          onClose={() => setStackMenu(null)}
        />
      ) : null}
      {tabMenu && contextMenuItems.length ? (
        <ExplorerMenu
          className={tabMenuClass}
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
              : menuSplit
                ? `Split actions for ${menuSplit.segments
                    .map((segment) =>
                      splitSegmentLabel(segment, projectlessWorkspace),
                    )
                    .join(" and ")}`
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
              label: "Show beside chat",
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

const noop = () => {};

/**
 * The stand-in for a lone pane's tab while its header is held, in client
 * pixels; `pressing` until the pointer is let go.
 */
type HeaderGrab = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pressing: boolean;
};

/** Controls in a header: pressing one uses it, never moves the tab. */
const HEADER_CONTROLS = [
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "a[href]",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="link"]',
  "[data-no-drag]",
  "[data-pane-drag]",
  // A tab of the content's own (a file among several) drags on its own.
  ".aven-tab",
].join(", ");

/**
 * What a press at `target` in a lone pane's header (`zone`) takes hold of:
 * something that names the tab there and opted in (`data-pane-grab`,
 * pressed even if it is a control, such as a page's title in its address
 * field), or the row's empty space. Null on a control. `handle` is the
 * opted-in element, which keeps the pointer so its click (if the press
 * never moved) lands on it.
 */
export function headerGrabTarget(
  target: EventTarget | null,
  zone: HTMLElement,
): { handle: HTMLElement | null } | null {
  if (!(target instanceof Element) || !zone.contains(target)) return null;
  // A control within something that opted in (a lone file's ×) is still a
  // control.
  const own = target.closest("[data-no-drag]");
  if (own && zone.contains(own)) return null;
  const opted = target.closest<HTMLElement>("[data-pane-grab]");
  if (opted && zone.contains(opted)) return { handle: opted };
  const control = target.closest(HEADER_CONTROLS);
  if (control && control !== zone && zone.contains(control)) return null;
  return { handle: null };
}

/**
 * Whether a right-click at `target` in a lone pane's header opens the tab's
 * menu: on what moves the tab, unless it has a menu of its own (a file's
 * tab, `data-own-menu`).
 */
export function headerMenuTarget(
  target: EventTarget | null,
  zone: HTMLElement,
): boolean {
  if (!headerGrabTarget(target, zone)) return false;
  const own = (target as Element).closest("[data-own-menu]");
  return !(own && zone.contains(own));
}

/** A field being edited in a header's toolbar. */
const HEADER_EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** How far left of the pointer a stand-in with nothing to cover starts. */
const GRAB_REACH = 24;

/**
 * Where the stand-in for the tab is drawn when its header is pressed: over
 * what names the tab in the row (`faces`), so the chip lifts out of it, or
 * at the pointer.
 */
export function headerGrabBox(
  faces: readonly HTMLElement[],
  zone: HTMLElement,
  pointerX: number,
): { left: number; top: number; width: number; height: number } {
  const row = zone.getBoundingClientRect();
  const boxes = faces
    .map((face) => face.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (boxes.length) {
    const left = Math.min(...boxes.map((rect) => rect.left));
    const right = Math.max(...boxes.map((rect) => rect.right));
    return { left, top: row.top, width: right - left, height: row.height };
  }
  const width = Math.min(TAB_CHIP_MAX_WIDTH, Math.max(0, row.width));
  const left = Math.max(
    row.left,
    Math.min(pointerX - GRAB_REACH, row.right - width),
  );
  return { left, top: row.top, width, height: row.height };
}

/** What focus may land on in a lent header's toolbar. */
const LENT_HEADER_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MemoTitleBar = memo(TitleBarComponent);
const TITLE_DATA: readonly (keyof TitleBarProps)[] = [
  "tabs",
  "browserTabs",
  "surfaceOrder",
  "splits",
  "visibleIds",
  "combineTargets",
  "recents",
  "paneMoves",
  "paneHides",
];
export function TitleBar(props: TitleBarProps) {
  return <MemoTitleBar {...useChromeProps(props, TITLE_DATA)} />;
}
