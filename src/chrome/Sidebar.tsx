import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Folder,
  GitBranch,
  Inbox,
  StickyNote,
  ListFilter,
  Pin,
  PanelLeft,
  Plus,
  Search,
} from "./icons";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { SidebarTabId } from "../lib/appearance";
import type { HoverRevealHandlers } from "../hooks/useHoverRevealPanel";
import { WorkspaceProfileMenu } from "./WorkspaceProfileMenu";
import {
  basename,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../lib/fs";
import { IS_MAC, MOD } from "../lib/platform";
import { resolveModel } from "../lib/models";
import { sessionDisplayTitle } from "../lib/session";
import { nextUnseenFinishedSessions } from "../lib/sessionDone";
import {
  orderedSessionActionIds,
  pruneSessionSelection,
  toggleSessionSelection,
} from "../lib/sessionSelection";
import { paneDropFromPoint, setExternalPaneDrop } from "../lib/paneDrop";
import type { PaneEdge } from "../lib/layout";
import { suppressTextSelection } from "../lib/drag";
import {
  compareSessionSummaries,
  filterSessionsByArchive,
  filterSessionsByQuery,
} from "../lib/sessionHistory";
import {
  addSessionToFolder,
  applySessionListDrop,
  buildSessionList,
  createFolderWithSessions,
  dissolveFolder,
  folderAccent,
  folderContaining,
  folderShellFill,
  loadSessionFolders,
  mergeFolderSessionSummaries,
  pruneSessionFolders,
  removeSessionFromFolder,
  renameFolder,
  reorderSessionFolders,
  saveSessionFolders,
  sessionListNavigationIds,
  setFolderCollapsed,
  setFolderColor,
  setFolderCustomColor,
  ungroupedSessions,
  type SessionFolder,
  type SessionListDropTarget,
} from "../lib/sessionFolders";
import { SESSION_LIST_PAGE, sessionListWindow } from "../lib/sessionListWindow";
import {
  filterSessionsByHarness,
  filterSessionsByStatus,
  filterSessionsByTime,
  harnessesInSessions,
  hasActiveSessionFilters,
  loadSessionSidebarFilters,
  saveSessionSidebarFilters,
  type SessionSidebarFilters,
} from "../lib/sessionFilters";
import type { HarnessId } from "../lib/session";
import type { LiveAgent } from "../lib/liveAgents";
import type { SessionSummary } from "../lib/sessionStore";
import type { SettingsSectionId } from "../lib/settings";
import type { InstalledUpdate } from "../lib/updateNotice";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import { useDragResize } from "../hooks/useDragResize";
import { useProfileCarousel } from "../hooks/useProfileCarousel";
import { ProfileCarouselPreview, captureProfileSidebar, type WorkspaceProfilePreviewData } from "./ProfileCarouselPreview";
import { useSortable } from "../hooks/useSortable";
import { normalizeHex } from "../lib/colorUtils";
import {
  looksLikeProject,
  projectRailItems,
  sameProjectPath,
  type RecentProject,
} from "../lib/recents";
import { ColorPickerPopover, ColorSwatchRow } from "./ColorPickerPopover";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { HarnessIcon } from "./HarnessIcon";
import {
  PersonalWorkspaceSwitcher,
  WorkspaceProfileIcon,
} from "./PersonalWorkspaceSwitcher";
import { PersonalProjectRow } from "./PersonalProjectRow";
import { OrchestrationSidebarAgents } from "./OrchestrationSidebarAgents";
import {
  DEFAULT_WORKSPACE_PROFILES,
  type WorkspaceProfile,
} from "../lib/workspaceProfiles";
import { DevModeSlot, TabVisitNav } from "./TitleBar";
import { SessionFiltersMenu } from "./SessionFiltersMenu";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import { SettingsNav } from "./SettingsRail";
import "./PersonalNavigation.css";

const MIN_WIDTH = 190;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 256;

let rememberedWidth = DEFAULT_WIDTH;

type SidebarTab = SidebarTabId;

function projectPathBusy(
  paths: Iterable<string> | undefined,
  cwd: string,
): boolean {
  if (!paths) return false;
  for (const path of paths) {
    if (sameProjectPath(path, cwd)) return true;
  }
  return false;
}

export type SidebarProps = {
  cwd: string;
  /** Working copy for Changes / explorer git. Falls back to `cwd`. */
  gitCwd?: string;
  open: boolean;
  floating?: boolean;
  hoverHandlers?: HoverRevealHandlers;
  sessions: SessionSummary[];
  busySessionIds: Set<string>;
  approvalSessionIds: Set<string>;
  activeSessionId?: string;
  /** Open tabs, including blank ones not yet in history. */
  openSessions?: readonly SessionSummary[];
  status: "idle" | "error";
  /** First listing for this project has not arrived yet. */
  pending: boolean;
  onSelectSession: (sessionId: string) => void;
  onSessionNavigationOrder?: (ids: readonly string[]) => void;
  onPrefetchSession?: (sessionId: string) => void;
  onPlaceSessionOnPane?: (
    sessionId: string,
    targetId: string,
    edge: PaneEdge,
  ) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onArchiveSessions?: (
    sessionIds: readonly string[],
    archived: boolean,
  ) => void;
  onPinSession?: (sessionId: string, pinned: boolean) => void;
  onPinSessions?: (sessionIds: readonly string[], pinned: boolean) => void;
  onDeleteSession?: (sessionId: string) => void;
  onDeleteSessions?: (sessionIds: readonly string[]) => void;
  onOpenFile: (path: string) => void;
  onOpenTerminal?: (cwd: string) => void;
  onFileMoved?: (from: string, to: string) => void;
  onFileDeleted?: (path: string) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  filesSearchOpen: boolean;
  onFilesSearchOpenChange: (open: boolean) => void;
  onOpenFilesSearch?: () => void;
  searchFocusToken?: number;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  onOpenDiff?: (path: string, kind?: GitFileDiffKind) => void;
  onOpenAllChanges?: () => void;
  onOpenCommit?: (commit: GitHistoryCommit) => void;
  selectedDiffPath?: string;
  selectedDiffKind?: GitFileDiffKind;
  selectedCommitSha?: string;
  textHarness?: HarnessId;
  onShowSourceControl?: () => void;
  recents?: RecentProject[];
  profiles?: readonly WorkspaceProfile[];
  profilePreviews?: Readonly<Record<string, WorkspaceProfilePreviewData>>;
  activeProfileId?: string;
  onSelectProfile?: (id: string) => void;
  onCreateProfile?: (name: string) => void;
  onMoveProject?: (path: string, profileId: string) => void;
  onAddProject?: (anchor?: HTMLButtonElement) => void;
  projectSessions?: Record<string, readonly SessionSummary[]>;
  onExpandProject?: (path: string) => void;
  loadedProjectPaths?: ReadonlySet<string>;
  projectHistoryErrors?: ReadonlySet<string>;
  onSelectProjectSession?: (path: string, sessionId: string) => void;
  onNewProjectTask?: (path: string) => void;
  busyProjectPaths?: Iterable<string>;
  liveAgents?: LiveAgent[];
  onSelectAgent?: (sessionId: string) => void;
  onSelectProject?: (path: string) => void;
  onOpenProject?: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  onNew?: () => string | void;
  onNewStandalone?: () => void;
  startingStandalone?: boolean;
  standaloneActive?: boolean;
  standaloneSessions?: readonly SessionSummary[];
  onOpenStandalone?: () => void;
  onNewTerminal?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenNotes?: () => void;
  onGoToFile?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  notesActive?: boolean;
  notesEnabled?: boolean;
  onToggleProjectRail?: () => void;
  projectRailOpen?: boolean;
  unseenFinishedIds?: Set<string>;
  settingsOpen?: boolean;
  settingsSection?: SettingsSectionId;
  onOpenSettings?: () => void;
  onSelectSettingsSection?: (section: SettingsSectionId) => void;
  onCloseSettings?: () => void;
  updateNotice?: InstalledUpdate | null;
  onOpenWhatsNew?: (version: string) => void;
  onDismissUpdate?: () => void;
};

function SidebarComponent({
  cwd,
  open,
  floating = false,
  hoverHandlers,
  sessions,
  busySessionIds,
  approvalSessionIds,
  activeSessionId,
  openSessions = [],
  status,
  pending,
  onSelectSession,
  onSessionNavigationOrder,
  onPrefetchSession,
  onPlaceSessionOnPane,
  onRenameSession,
  onArchiveSession,
  onArchiveSessions,
  onPinSession,
  onPinSessions,
  onDeleteSession,
  onDeleteSessions,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  recents = [],
  profiles = DEFAULT_WORKSPACE_PROFILES,
  profilePreviews,
  activeProfileId = "personal",
  onSelectProfile,
  onCreateProfile,
  onMoveProject,
  onAddProject,
  projectSessions = {},
  onExpandProject,
  loadedProjectPaths,
  projectHistoryErrors,
  onSelectProjectSession,
  onNewProjectTask,
  busyProjectPaths,
  liveAgents = [],
  onSelectAgent,
  onSelectProject,
  onOpenProject,
  onRemoveProject,
  onNew,
  onNewStandalone,
  startingStandalone = false,
  standaloneActive = false,
  standaloneSessions = [],
  onOpenStandalone,
  onSearch,
  onToggleProjectRail,
  onOpenInbox,
  onOpenNotes,
  searchActive = false,
  inboxActive = false,
  notesActive = false,

  notesEnabled = true,
  unseenFinishedIds: unseenFinishedIdsProp,
  settingsOpen = false,
  settingsSection = "general",
  onOpenSettings,
  onSelectSettingsSection,
  onCloseSettings,
  updateNotice = null,
  onOpenWhatsNew,
  onDismissUpdate,
}: SidebarProps) {
  const [profileMenuAnchor, setProfileMenuAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  useEffect(() => setProfileMenuAnchor(null), [activeProfileId, open]);
  const [documentVisible, setDocumentVisible] = useState(
    () => !document.hidden,
  );
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [, refreshProjects] = useState(0);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set([cwd]),
  );
  const [requestedProjectPaths, setRequestedProjectPaths] = useState<
    Set<string>
  >(() => new Set());
  const requestProjectHistory = (path: string) => {
    setRequestedProjectPaths((current) => new Set([...current, path]));
    onExpandProject?.(path);
  };
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ??
    profiles[0] ??
    DEFAULT_WORKSPACE_PROFILES[0];
  const projects = projectRailItems(recents, onSelectProfile ? "~" : cwd);
  const asideRef = useRef<HTMLElement | null>(null);
  const profileViewportRef = useRef<HTMLDivElement | null>(null);
  const profileContentRef = useRef<HTMLDivElement | null>(null);
  const profileSnapshots = useRef(new Map<string, HTMLElement>());
  const carouselEnabled = open && !!onSelectProfile && !settingsOpen && !profileMenuAnchor;
  const selectProfile = (id: string) => {
    // Capture before React moves the live body to its destination, including
    // footer/header navigation. Every transition should retain the outgoing
    // page's visible rows and scroll position until it leaves the viewport.
    if (id !== activeProfileId && profileContentRef.current)
      profileSnapshots.current.set(activeProfileId, captureProfileSidebar(profileContentRef.current));
    onSelectProfile?.(id);
  };
  useProfileCarousel({
    viewport: profileViewportRef,
    enabled: carouselEnabled,
    profiles, activeProfileId,
    onSelectProfile: selectProfile,
  });
  const [taskSearchOpen, setTaskSearchOpen] = useState(false);
  const resize = useDragResize({
    enabled: open,
    min: MIN_WIDTH,
    max: () =>
      Math.max(
        MIN_WIDTH,
        Math.min(
          MAX_WIDTH,
          Math.floor(window.innerWidth * 0.5),
          window.innerWidth - 540,
        ),
      ),
    defaultWidth: DEFAULT_WIDTH,
    initial: rememberedWidth,
    onCommit: (next) => {
      rememberedWidth = next;
    },
  });
  const [now, setNow] = useState(() => Date.now());
  const sessionsScrollRef = useRef<HTMLDivElement>(null);
  const [sessionMenu, setSessionMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const contextSelectionRef = useRef(false);
  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
    folderId: string;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [sessionFolders, setSessionFolders] = useState<SessionFolder[]>(() =>
    loadSessionFolders(cwd),
  );
  const [sessionDrop, setSessionDrop] = useState<SessionListDropTarget | null>(
    null,
  );
  const [sessionFilters, setSessionFilters] = useState(
    loadSessionSidebarFilters,
  );
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sessionListLimit, setSessionListLimit] = useState(SESSION_LIST_PAGE);
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingFolderSessionIds = useRef(new Set<string>());
  const busyIdsRef = useRef(busySessionIds);
  const focusedSessionIdRef = useRef(activeSessionId);
  const unseenFinishedLocalRef = useRef<Set<string>>(new Set());
  if (
    busyIdsRef.current !== busySessionIds ||
    focusedSessionIdRef.current !== activeSessionId
  ) {
    unseenFinishedLocalRef.current = nextUnseenFinishedSessions({
      previousBusyIds: busyIdsRef.current,
      busyIds: busySessionIds,
      previousUnseenIds: unseenFinishedLocalRef.current,
      focusedSessionId: activeSessionId,
    });
    busyIdsRef.current = busySessionIds;
    focusedSessionIdRef.current = activeSessionId;
  }
  const unseenFinishedIds =
    unseenFinishedIdsProp ?? unseenFinishedLocalRef.current;
  // Revisits render straight from cache, so this is only ever true the first
  // time a project is opened.
  const pendingFirstLoad = pending && sessions.length === 0;
  const listedSessions = mergeFolderSessionSummaries(
    sessions,
    openSessions,
    sessionFolders,
  ).filter((session) => !session.orchestrationLeadId);
  const visibleSessions = [
    ...filterSessionsByQuery(
      filterSessionsByStatus(
        filterSessionsByTime(
          filterSessionsByHarness(
            filterSessionsByArchive(
              listedSessions,
              sessionFilters.showArchived,
            ),
            sessionFilters.hiddenHarnesses,
          ),
          sessionFilters.time,
          now,
        ),
        sessionFilters.status,
        busySessionIds,
        approvalSessionIds,
        unseenFinishedIds,
      ),
      searchQuery,
    ),
  ].sort(compareSessionSummaries);
  const filtersActive = hasActiveSessionFilters(sessionFilters);
  const searchNarrowed = Boolean(searchQuery.trim());
  // Summaries for the whole project stay in `sessions` so filters still work.
  // Folders sit above the ungrouped list. Only a page of ungrouped cards
  // mounts; the sentinel below asks for the next page.
  const ungroupedVisible = ungroupedSessions(visibleSessions, sessionFolders);
  const activeUngroupedIndex = ungroupedVisible.findIndex(
    (session) => session.id === activeSessionId,
  );
  const shownUngroupedCount = sessionListWindow(
    ungroupedVisible.length,
    sessionListLimit,
    activeUngroupedIndex,
  );
  const shownUngrouped = ungroupedVisible.slice(0, shownUngroupedCount);
  const fullSessionListEntries = buildSessionList(
    visibleSessions,
    sessionFolders,
    ungroupedVisible,
  );
  const sessionListEntries = buildSessionList(
    visibleSessions,
    sessionFolders,
    shownUngrouped,
  );
  const sessionNavigationIds = sessionListNavigationIds(
    fullSessionListEntries,
    searchNarrowed,
  );
  const sessionNavigationKey = sessionNavigationIds.join("\0");
  useEffect(() => {
    onSessionNavigationOrder?.(sessionNavigationIds);
  }, [onSessionNavigationOrder, sessionNavigationKey]);
  useEffect(() => {
    const available = new Set(sessionNavigationIds);
    setSelectedSessionIds((current) =>
      pruneSessionSelection(current, available),
    );
  }, [cwd, sessionNavigationKey]);
  const hasMoreSessions = shownUngroupedCount < ungroupedVisible.length;
  const sessionListKey = `${cwd}\0${sessionFilters.showArchived}\0${sessionFilters.time}\0${sessionFilters.hiddenHarnesses.join(",")}\0${sessionFilters.status.working}\0${sessionFilters.status.needsApproval}\0${sessionFilters.status.done}\0${searchQuery}`;
  const sessionHarnesses = harnessesInSessions(sessions);
  const narrowedByUser = searchNarrowed || filtersActive;
  const visibleFolderIds = sessionListEntries.flatMap((entry) =>
    entry.kind === "folder" ? [entry.folder.id] : [],
  );
  const folderSortable = useSortable(
    visibleFolderIds,
    (ids) => {
      setSessionFolders((current) => {
        const next = reorderSessionFolders(current, ids);
        if (next === current) return current;
        saveSessionFolders(cwd, next);
        return next;
      });
    },
    { axis: "y" },
  );
  const inProject = looksLikeProject(cwd);
  // Keep the workspace in place while a search, inbox or blank task is open.
  // Settings use this same column instead of mounting a second project rail.
  const sidebarVisible = open;

  useEffect(() => {
    setSessionListLimit(SESSION_LIST_PAGE);
    const scroller = sessionsScrollRef.current;
    if (scroller) scroller.scrollTop = 0;
  }, [sessionListKey]);

  useEffect(() => {
    if (
      !open ||
      !documentVisible ||
      settingsOpen ||
      !tasksExpanded ||
      !hasMoreSessions
    )
      return;
    const sentinel = loadMoreRef.current;
    const root = sessionsScrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSessionListLimit((current) => current + SESSION_LIST_PAGE);
      },
      { root, rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    open,
    documentVisible,
    settingsOpen,
    tasksExpanded,
    hasMoreSessions,
    shownUngroupedCount,
    cwd,
    activeProfileId,
  ]);

  useEffect(() => {
    setSessionFolders(loadSessionFolders(cwd));
    setRenamingFolderId(null);
    setFolderMenu(null);
    setSessionDrop(null);
    setTasksExpanded(true);
    if (looksLikeProject(cwd))
      setExpandedProjects((current) => new Set([...current, cwd]));
    setSearchQuery("");
    setTaskSearchOpen(false);
    pendingFolderSessionIds.current.clear();
  }, [cwd]);

  useEffect(() => {
    if (pending || status === "error") return;
    const known = new Set(sessions.map((session) => session.id));
    for (const session of openSessions) known.add(session.id);
    if (activeSessionId) known.add(activeSessionId);
    for (const id of pendingFolderSessionIds.current) {
      known.add(id);
      if (
        sessions.some((session) => session.id === id) ||
        openSessions.some((session) => session.id === id)
      ) {
        pendingFolderSessionIds.current.delete(id);
      }
    }
    setSessionFolders((current) => {
      const next = pruneSessionFolders(current, known);
      if (next === current) return current;
      saveSessionFolders(cwd, next);
      return next;
    });
  }, [activeSessionId, cwd, openSessions, pending, sessions, status]);

  useEffect(() => {
    const onVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (
      !open ||
      !documentVisible ||
      settingsOpen ||
      !tasksExpanded ||
      sessions.length === 0
    )
      return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [open, documentVisible, settingsOpen, tasksExpanded, sessions.length]);

  useEffect(() => {
    if (open && documentVisible) return;
    setSessionMenu(null);
    setFolderMenu(null);
    setFilterMenu(null);
    setSelectedSessionIds(new Set());
  }, [open, documentVisible]);

  useEffect(() => {
    if (!sessionMenu && !folderMenu && !filterMenu) return;
    const onScroll = () => {
      closeSessionMenu();
      setFolderMenu(null);
      setFilterMenu(null);
    };
    const scrollParent = sessionsScrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [sessionMenu, folderMenu, filterMenu]);

  useEffect(() => {
    if (selectedSessionIds.size === 0) return;
    const clear = () => {
      contextSelectionRef.current = false;
      setSelectedSessionIds(new Set());
      setSessionMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      clear();
    };
    // A pointer landing off the cards drops the selection; a menu acting on
    // it stays open, and the cards handle their own clicks.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      const el = target instanceof Element ? target : null;
      if (el?.closest("[data-session-card],[data-popover-side]")) return;
      clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [selectedSessionIds.size]);

  const commitSessionFolders = (next: SessionFolder[]) => {
    setSessionFolders(next);
    saveSessionFolders(cwd, next);
  };

  const onNewInFolder = (folderId: string) => {
    const sessionId = onNew?.();
    if (!sessionId) return;
    pendingFolderSessionIds.current.add(sessionId);
    setSearchQuery("");
    setSessionFolders((current) => {
      const next = setFolderCollapsed(
        addSessionToFolder(current, folderId, sessionId),
        folderId,
        false,
      );
      saveSessionFolders(cwd, next);
      return next;
    });
  };

  const menuSessionIds = sessionMenu
    ? orderedSessionActionIds(
        sessionMenu.sessionId,
        selectedSessionIds,
        sessionNavigationIds,
      )
    : [];
  const menuSessions = menuSessionIds.flatMap((sessionId) => {
    const session = listedSessions.find((entry) => entry.id === sessionId);
    return session ? [session] : [];
  });
  const multipleMenuSessions = menuSessionIds.length > 1;
  const allMenuSessionsPinned =
    menuSessions.length > 0 && menuSessions.every((session) => session.pinned);
  const allMenuSessionsArchived =
    menuSessions.length > 0 &&
    menuSessions.every((session) => session.archived);
  const menuSessionFolder =
    menuSessionIds.length === 1
      ? folderContaining(sessionFolders, menuSessionIds[0])
      : undefined;
  const anyMenuSessionFoldered = menuSessionIds.some((sessionId) =>
    sessionFolders.some((folder) => folder.sessionIds.includes(sessionId)),
  );
  const canRemoveMenuSessionsFromFolders = multipleMenuSessions
    ? anyMenuSessionFoldered
    : !!menuSessionFolder;
  const menuFolder = folderMenu
    ? sessionFolders.find((folder) => folder.id === folderMenu.folderId)
    : undefined;
  const folderMenuItems: ExplorerMenuItem[] = [
    { kind: "item", id: "rename", label: "Rename", shortcut: "F2" },
    { kind: "sep" },
    { kind: "item", id: "ungroup", label: "Ungroup" },
  ];
  const sessionMenuItems: ExplorerMenuItem[] = [
    ...(onPinSession || onPinSessions
      ? [
          {
            kind: "item" as const,
            id: "pin",
            label: allMenuSessionsPinned ? "Unpin" : "Pin",
          },
        ]
      : []),
    ...(!multipleMenuSessions && onRenameSession
      ? [
          {
            kind: "item" as const,
            id: "rename",
            label: "Rename",
            shortcut: "F2",
          },
        ]
      : []),
    { kind: "sep" as const },
    { kind: "item" as const, id: "folder-new", label: "New folder" },
    ...(sessionFolders.length > 0 ? [{ kind: "sep" as const }] : []),
    ...sessionFolders.map((folder) => ({
      kind: "item" as const,
      id: `folder-add:${folder.id}`,
      label: `Add to ${folder.name}`,
      checked:
        menuSessionIds.length > 0 &&
        menuSessionIds.every((sessionId) =>
          folder.sessionIds.includes(sessionId),
        ),
    })),
    ...(canRemoveMenuSessionsFromFolders
      ? [
          {
            kind: "item" as const,
            id: "folder-remove",
            label: multipleMenuSessions
              ? "Remove from folders"
              : "Remove from folder",
          },
        ]
      : []),
    ...(onArchiveSession ||
    onArchiveSessions ||
    onDeleteSession ||
    onDeleteSessions
      ? [
          { kind: "sep" as const },
          ...(onArchiveSession || onArchiveSessions
            ? [
                {
                  kind: "item" as const,
                  id: "archive",
                  label: allMenuSessionsArchived ? "Unarchive" : "Archive",
                },
              ]
            : []),
          ...(onDeleteSession || onDeleteSessions
            ? [
                {
                  kind: "item" as const,
                  id: "delete",
                  label: "Delete",
                  shortcut: "⌫",
                  danger: true,
                },
              ]
            : []),
        ]
      : []),
  ];

  const onSessionContextMenu = (
    sessionId: string,
    e: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    contextSelectionRef.current = !selectedSessionIds.has(sessionId);
    if (contextSelectionRef.current) {
      setSelectedSessionIds(new Set([sessionId]));
    }
    setFilterMenu(null);
    setFolderMenu(null);
    setSessionMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  const closeSessionMenu = () => {
    setSessionMenu(null);
    if (!contextSelectionRef.current) return;
    contextSelectionRef.current = false;
    setSelectedSessionIds(new Set());
  };

  const onFolderContextMenu = (
    folderId: string,
    e: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setFilterMenu(null);
    setSessionMenu(null);
    setFolderMenu({ x: e.clientX, y: e.clientY, folderId });
  };

  const onSessionMenuPick = (id: string) => {
    if (!sessionMenu) return;
    const sessionId = sessionMenu.sessionId;
    const sessionIds = menuSessionIds;
    const archived = allMenuSessionsArchived;
    const pinned = allMenuSessionsPinned;
    closeSessionMenu();
    if (id === "pin") {
      if (sessionIds.length > 1 && onPinSessions) {
        onPinSessions(sessionIds, !pinned);
      } else {
        for (const id of sessionIds) onPinSession?.(id, !pinned);
      }
      return;
    }
    if (id === "rename") {
      setRenamingSessionId(sessionId);
      return;
    }
    if (id === "folder-new") {
      const { folders, id: createdId } = createFolderWithSessions(
        sessionFolders,
        sessionIds,
      );
      if (!createdId) return;
      commitSessionFolders(folders);
      setRenamingFolderId(createdId);
      return;
    }
    if (id.startsWith("folder-add:")) {
      const folderId = id.slice("folder-add:".length);
      const folders = sessionIds.reduce(
        (current, id) => addSessionToFolder(current, folderId, id),
        sessionFolders,
      );
      commitSessionFolders(setFolderCollapsed(folders, folderId, false));
      return;
    }
    if (id === "folder-remove") {
      commitSessionFolders(
        sessionIds.reduce(
          (current, id) => removeSessionFromFolder(current, id),
          sessionFolders,
        ),
      );
      return;
    }
    if (id === "archive") {
      if (sessionIds.length > 1 && onArchiveSessions) {
        onArchiveSessions(sessionIds, !archived);
      } else {
        for (const id of sessionIds) onArchiveSession?.(id, !archived);
      }
      return;
    }
    if (id === "delete") {
      if (sessionIds.length > 1 && onDeleteSessions) {
        onDeleteSessions(sessionIds);
      } else {
        for (const id of sessionIds) onDeleteSession?.(id);
      }
    }
  };

  const onFolderMenuPick = (id: string) => {
    if (!folderMenu) return;
    const folderId = folderMenu.folderId;
    setFolderMenu(null);
    if (id === "rename") {
      setRenamingFolderId(folderId);
      return;
    }
    if (id === "ungroup") {
      commitSessionFolders(dissolveFolder(sessionFolders, folderId));
    }
  };

  const onFolderColorChange = (colorIndex: number | null) => {
    if (!folderMenu) return;
    commitSessionFolders(
      setFolderColor(sessionFolders, folderMenu.folderId, colorIndex),
    );
  };

  const onFolderCustomColorChange = (color: string) => {
    if (!folderMenu) return;
    commitSessionFolders(
      setFolderCustomColor(sessionFolders, folderMenu.folderId, color),
    );
  };

  const onSessionListDrop = (
    draggedId: string,
    target: SessionListDropTarget,
  ) => {
    const { folders, createdId } = applySessionListDrop(
      sessionFolders,
      draggedId,
      target,
      listedSessions,
    );
    if (folders === sessionFolders) return;
    commitSessionFolders(folders);
    if (createdId) setRenamingFolderId(createdId);
  };

  const isSessionDrop = (kind: "folder" | "session", id: string) =>
    sessionDrop?.kind === kind && sessionDrop.id === id;

  const onSessionCardSelect = (
    sessionId: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (event.shiftKey) {
      contextSelectionRef.current = false;
      setSessionMenu(null);
      setSelectedSessionIds((current) =>
        toggleSessionSelection(current, sessionId),
      );
      return;
    }
    setSelectedSessionIds(new Set());
    onSelectSession(sessionId);
  };

  const renderSessionCard = (session: SessionSummary, compact = true) =>
    renamingSessionId === session.id && onRenameSession ? (
      <SessionRenameRow
        session={session}
        isActive={session.id === activeSessionId}
        busy={busySessionIds.has(session.id)}
        needsApproval={approvalSessionIds.has(session.id)}
        onCommit={(title) => {
          onRenameSession(session.id, title);
          setRenamingSessionId(null);
        }}
        onCancel={() => setRenamingSessionId(null)}
      />
    ) : (
      <SessionCard
        session={session}
        isActive={session.id === activeSessionId}
        isSelected={selectedSessionIds.has(session.id)}
        busy={busySessionIds.has(session.id)}
        done={unseenFinishedIds.has(session.id)}
        needsApproval={approvalSessionIds.has(session.id)}
        dropTarget={isSessionDrop("session", session.id)}
        dropEdge={
          sessionDrop?.kind === "session" && sessionDrop.id === session.id
            ? sessionDrop.edge
            : undefined
        }
        compact={compact}
        now={now}
        onSelect={onSessionCardSelect}
        onPrefetch={onPrefetchSession}
        onPlaceOnPane={onPlaceSessionOnPane}
        onListDrop={onSessionListDrop}
        onListDropTargetChange={setSessionDrop}
        onContextMenu={(e) => onSessionContextMenu(session.id, e)}
        onArchive={
          onArchiveSession
            ? () => onArchiveSession(session.id, !session.archived)
            : undefined
        }
        onRename={
          onRenameSession ? () => setRenamingSessionId(session.id) : undefined
        }
        onDelete={
          onDeleteSession ? () => onDeleteSession(session.id) : undefined
        }
      />
    );

  const onSessionFiltersChange = (next: SessionSidebarFilters) => {
    setSessionFilters(next);
    saveSessionSidebarFilters(next);
  };

  const onFilterButtonClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSessionMenu(null);
    setFolderMenu(null);
    setFilterMenu({
      x: rect.right - 228,
      y: rect.bottom + 2,
    });
  };

  const sessionSearchInput = (
    <input
      ref={searchInputRef}
      autoFocus
      type="text"
      value={searchQuery}
      placeholder="Filter tasks..."
      aria-label="Filter tasks"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(event) => setSearchQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        if (searchQuery) {
          setSearchQuery("");
        } else {
          setTaskSearchOpen(false);
        }
      }}
      className="h-full w-full min-w-0 rounded-md bg-transparent py-0 pl-7 pr-2 text-[12px] text-content outline-none placeholder:text-content/35 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
    />
  );

  const currentProjectTasks = (
    <div id="personal-project-tasks" className="personal-project-tasks">
      {inProject && tasksExpanded && taskSearchOpen ? (
        <div className="personal-task-filter">
          <div className="relative flex h-6 min-w-0 items-center">
            <Search className="pointer-events-none absolute left-2 size-3 opacity-50" />
            {sessionSearchInput}
          </div>
        </div>
      ) : null}
      {tasksExpanded ? (
        <>
          {!cwd || cwd === "~" ? (
            <p className="px-4 py-4 text-[12px] leading-relaxed text-content/60">
              Open a project to see its tasks.
            </p>
          ) : (
            <div>
              {/*
              A project's first load stays deliberately blank. The listing is
              served from a covering index and resolves within a frame or two,
              so a placeholder only ever flashed — reading as a glitch rather
              than as progress. This is checked before the empty state so that
              cannot claim "No sessions yet" before the rows have landed.
            */}
              {pendingFirstLoad ? null : status === "error" &&
                sessions.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-content/50">
                  Couldn’t load sessions
                </p>
              ) : visibleSessions.length === 0 ? (
                // A narrowed-down result is a transient answer to what the user
                // just typed, so it stays a quiet line of text. Only the genuine
                // "this project has nothing in it" case earns the illustration.
                narrowedByUser ? (
                  <p className="px-3 py-2 text-[12px] text-content/50">
                    {searchNarrowed
                      ? "No matching sessions"
                      : "No sessions match these filters"}
                  </p>
                ) : (
                  <p className="personal-tasks-empty">No tasks yet.</p>
                )
              ) : (
                <ul className="personal-task-list flex flex-col gap-0.5 p-1.5">
                  {sessionListEntries.map((entry, index) => {
                    if (entry.kind === "divider") {
                      return (
                        <li
                          key={`divider-${index}`}
                          className="personal-sidebar-section-label list-none"
                        >
                          Recent
                        </li>
                      );
                    }
                    if (entry.kind === "folder") {
                      const expanded =
                        searchNarrowed || !entry.folder.collapsed;
                      const shellFill = folderShellFill(
                        entry.folder.colorIndex,
                        entry.folder.customColor,
                      );
                      const folderIndex = visibleFolderIds.indexOf(
                        entry.folder.id,
                      );
                      const beforeUngrouped =
                        sessionListEntries[index + 1]?.kind === "session";
                      const draggingFolder =
                        folderSortable.draggingId === entry.folder.id;
                      const showFolderDropStart =
                        folderSortable.draggingId &&
                        folderSortable.toIndex === folderIndex &&
                        folderSortable.fromIndex !== null &&
                        folderSortable.toIndex < folderSortable.fromIndex;
                      const showFolderDropEnd =
                        folderSortable.draggingId &&
                        folderSortable.toIndex === folderIndex &&
                        folderSortable.fromIndex !== null &&
                        folderSortable.toIndex > folderSortable.fromIndex;
                      return (
                        <li
                          key={entry.folder.id}
                          ref={(el) =>
                            folderSortable.setItemRef(entry.folder.id, el)
                          }
                          data-session-folder={entry.folder.id}
                          className={`relative ${
                            expanded || beforeUngrouped ? "mb-1.5" : ""
                          } ${draggingFolder ? "opacity-40" : ""}`}
                        >
                          {showFolderDropStart ? (
                            <div className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 rounded-full bg-accent" />
                          ) : null}
                          {showFolderDropEnd ? (
                            <div className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 rounded-full bg-accent" />
                          ) : null}
                          <div
                            className={`overflow-hidden rounded-md ${
                              shellFill ? "" : "bg-content/5"
                            }`}
                            style={
                              shellFill ? { background: shellFill } : undefined
                            }
                          >
                            {renamingFolderId === entry.folder.id ? (
                              <FolderRenameRow
                                folder={entry.folder}
                                memberCount={entry.sessions.length}
                                dropTarget={isSessionDrop(
                                  "folder",
                                  entry.folder.id,
                                )}
                                onCommit={(name) => {
                                  commitSessionFolders(
                                    renameFolder(
                                      sessionFolders,
                                      entry.folder.id,
                                      name,
                                    ),
                                  );
                                  setRenamingFolderId(null);
                                }}
                                onCancel={() => setRenamingFolderId(null)}
                              />
                            ) : (
                              <FolderRow
                                folder={entry.folder}
                                sessions={entry.sessions}
                                expanded={expanded}
                                dropTarget={isSessionDrop(
                                  "folder",
                                  entry.folder.id,
                                )}
                                canReorder={visibleFolderIds.length > 1}
                                busy={entry.sessions.some((session) =>
                                  busySessionIds.has(session.id),
                                )}
                                done={entry.sessions.some((session) =>
                                  unseenFinishedIds.has(session.id),
                                )}
                                needsApproval={entry.sessions.some((session) =>
                                  approvalSessionIds.has(session.id),
                                )}
                                onPointerDown={(event) =>
                                  folderSortable.onItemPointerDown(
                                    entry.folder.id,
                                    event,
                                  )
                                }
                                onToggle={() => {
                                  if (folderSortable.consumeClick()) return;
                                  if (searchNarrowed) return;
                                  commitSessionFolders(
                                    setFolderCollapsed(
                                      sessionFolders,
                                      entry.folder.id,
                                      !entry.folder.collapsed,
                                    ),
                                  );
                                }}
                                onContextMenu={(event) =>
                                  onFolderContextMenu(entry.folder.id, event)
                                }
                                onRename={() =>
                                  setRenamingFolderId(entry.folder.id)
                                }
                              />
                            )}
                            {expanded ? (
                              <>
                                <ul className="flex flex-col gap-px p-1">
                                  {entry.sessions.map((session) => (
                                    <li key={session.id}>
                                      {renderSessionCard(session, true)}
                                    </li>
                                  ))}
                                </ul>
                                {onNew ? (
                                  <div className="border-t border-content/10 p-1">
                                    <button
                                      type="button"
                                      data-no-drag
                                      data-tauri-drag-region="false"
                                      title="New session"
                                      aria-label="New session"
                                      onClick={() =>
                                        onNewInFolder(entry.folder.id)
                                      }
                                      className="relative flex w-full items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-left text-content/45 hover:bg-content/10 hover:text-content"
                                    >
                                      <Plus
                                        className="size-3 shrink-0"
                                        strokeWidth={1.75}
                                      />
                                      <span className="text-[13px] font-semibold leading-snug">
                                        New session
                                      </span>
                                    </button>
                                  </div>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={entry.session.id}>
                        {sessionListEntries[index - 1]?.kind !== "session" &&
                        sessionListEntries[index - 1]?.kind !== "divider" ? (
                          <p className="personal-sidebar-section-label">
                            {entry.session.pinned ? "Pinned" : "Recent"}
                          </p>
                        ) : null}
                        {renderSessionCard(entry.session)}
                      </li>
                    );
                  })}
                  {hasMoreSessions ? (
                    <li
                      ref={loadMoreRef}
                      aria-hidden
                      className="h-px list-none"
                    />
                  ) : null}
                </ul>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  const sidebarContent = (
    <aside
      ref={(element) => {
        asideRef.current = element;
        resize.setPaneRef(element);
      }}
      aria-label={`${activeProfile.name} workspace sidebar`}
      data-native-browser-occluded={floating && open ? "true" : undefined}
      data-native-browser-edge={floating && open ? "left" : undefined}
      className="personal-navigation personal-sidebar sidebar-glass relative flex h-full min-h-0 shrink-0 flex-col"
    >
      <div
        className="personal-sidebar-windowbar flex h-10 shrink-0 select-none items-center pr-1.5"
        data-tauri-drag-region="deep"
      >
        {IS_MAC ? <div className="w-[78px] shrink-0" /> : null}
        <DevModeSlot />
        <TabVisitNav
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onGoBack={onGoBack}
          onGoForward={onGoForward}
        />
        <button
          type="button"
          className="personal-sidebar-pin personal-workspace-tool"
          aria-label={
            floating ? "Pin workspace sidebar" : "Hide workspace sidebar"
          }
          title={
            floating
              ? "Pin workspace sidebar"
              : `Hide workspace sidebar (${MOD}B)`
          }
          aria-pressed={!floating}
          onClick={onToggleProjectRail}
        >
          <PanelLeft className="size-3.5" />
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{activeProfile.name} workspace</div>
      <div className="personal-profile-header">
        <button
          className="personal-profile-picker"
          type="button"
          aria-label={`Switch workspace, ${activeProfile.name}`}
          aria-haspopup="menu"
          aria-expanded={!!profileMenuAnchor}
          onClick={(event) =>
            setProfileMenuAnchor(profileMenuAnchor ? null : event.currentTarget)
          }
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setProfileMenuAnchor(event.currentTarget);
            }
          }}
        >
          <WorkspaceProfileIcon profile={activeProfile} />
          <span>{activeProfile.name}</span>
          <ChevronDown className="size-3" />
        </button>
        {onSearch ? (
          <button
            type="button"
            className="personal-workspace-tool"
            aria-label={`Search (${MOD}K)`}
            title={`Search (${MOD}K)`}
            aria-pressed={searchActive}
            onClick={onSearch}
          >
            <Search className="size-3.5" />
          </button>
        ) : null}
      </div>
      {profileMenuAnchor && open ? (
        <WorkspaceProfileMenu
          profiles={profiles}
          activeProfileId={activeProfileId}
          anchor={profileMenuAnchor}
          onSelect={selectProfile}
          onDismiss={() => setProfileMenuAnchor(null)}
        />
      ) : null}
      {!settingsOpen && (onOpenInbox || (notesEnabled && onOpenNotes)) ? (
        <nav className="personal-library-nav" aria-label="Library">
          {notesEnabled && onOpenNotes ? (
            <button
              type="button"
              onClick={onOpenNotes}
              aria-current={notesActive ? "page" : undefined}
              title="Saved notes and reusable context"
            >
              <StickyNote className="size-3.5" aria-hidden />
              <span>Notes</span>
            </button>
          ) : null}
          {onOpenInbox ? (
            <button
              type="button"
              onClick={onOpenInbox}
              aria-current={inboxActive ? "page" : undefined}
              title="GitHub issues, pull requests, and Linear tasks"
            >
              <Inbox className="size-3.5" aria-hidden />
              <span>Inbox</span>
            </button>
          ) : null}
        </nav>
      ) : null}
      {settingsOpen && onSelectSettingsSection && onCloseSettings ? (
        <div className="personal-settings-navigation flex min-h-0 flex-1 flex-col">
          <p className="personal-sidebar-section-label">Settings</p>
          <SettingsNav
            section={settingsSection}
            onSelect={onSelectSettingsSection}
            onClose={onCloseSettings}
          />
        </div>
      ) : (
        <div ref={profileViewportRef} className="personal-profile-viewport min-h-0 flex-1" data-carousel-enabled={carouselEnabled} aria-label="Workspace carousel" tabIndex={0}>
        <div className="personal-profile-track">
          {profiles.map((profile) => (
            <div key={profile.id} className="personal-profile-page" inert aria-hidden="true">
              {profile.id !== activeProfile.id ? <ProfileCarouselPreview profile={profile} preview={profilePreviews?.[profile.id]} snapshot={profileSnapshots.current.get(profile.id)} /> : null}
            </div>
          ))}
        <div
          ref={profileContentRef}
          className="personal-profile-content flex min-h-0 min-w-0 flex-col"
          style={{ left: `${Math.max(0, profiles.findIndex((profile) => profile.id === activeProfile.id)) * 100}%` }}
        >
          {onNewStandalone ? (
            <button
              type="button"
              className="personal-new-session"
              aria-label="New session without a project"
              disabled={startingStandalone}
              onClick={() => {
                setTasksExpanded(true);
                onNewStandalone();
              }}
            >
              <Plus className="size-3.5" />
              <span>{startingStandalone ? "Starting…" : "New session"}</span>
            </button>
          ) : null}
          <div
            ref={(element) => {
              sessionsScrollRef.current = element;
            }}
            className="personal-projects-scroll min-h-0 flex-1 overflow-y-auto"
          >
            {onOpenStandalone ? (
              <section
                className="personal-standalone-group"
                aria-label="Sessions without a project"
              >
                <div className="personal-projects-heading">
                  <button
                    type="button"
                    className="personal-sessions-heading"
                    onClick={() => {
                      setTasksExpanded(true);
                      onOpenStandalone();
                    }}
                  >
                    Sessions
                  </button>
                </div>
                {standaloneActive ? (
                  currentProjectTasks
                ) : (
                  <div className="personal-project-tasks">
                    {standaloneSessions
                      .filter(
                        (session) =>
                          !session.archived && !session.orchestrationLeadId,
                      )
                      .slice(0, SESSION_LIST_PAGE)
                      .map((session) =>
                        session.orchestration ? (
                          <SessionCard
                            key={session.id}
                            session={session}
                            compact
                            now={now}
                            isActive={session.id === activeSessionId}
                            isSelected={false}
                            busy={busySessionIds.has(session.id)}
                            done={false}
                            needsApproval={approvalSessionIds.has(session.id)}
                            onSelect={() => onSelectSession(session.id)}
                          />
                        ) : (
                          <button
                            key={session.id}
                            type="button"
                            className="personal-other-task personal-task-card"
                            onClick={() => onSelectSession(session.id)}
                          >
                            {busySessionIds.has(session.id) ? (
                              <span
                                className="personal-task-working-dot"
                                aria-label="Session running"
                              />
                            ) : (
                              <span className="personal-task-indent" />
                            )}
                            <span className="personal-task-title">
                              {sessionDisplayTitle(
                                session.title,
                                session.harness,
                              )}
                            </span>
                          </button>
                        ),
                      )}
                    {standaloneSessions.filter(
                      (session) =>
                        !session.archived && !session.orchestrationLeadId,
                    ).length > SESSION_LIST_PAGE ? (
                      <button
                        type="button"
                        className="personal-view-project-tasks"
                        onClick={onOpenStandalone}
                      >
                        View all sessions
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
            <div className="personal-projects-heading">
              <span>Projects</span>
              {inProject ? (
                <>
                  <SessionsHeaderButton
                    label="Filter tasks by title"
                    active={taskSearchOpen || searchNarrowed}
                    onClick={() => {
                      setTasksExpanded(true);
                      setTaskSearchOpen((shown) => !shown);
                      if (taskSearchOpen) setSearchQuery("");
                    }}
                  >
                    <Search className="size-3" />
                  </SessionsHeaderButton>
                  <SessionsHeaderButton
                    label="Task filters"
                    active={filtersActive}
                    open={!!filterMenu}
                    hasPopup
                    onClick={onFilterButtonClick}
                  >
                    <ListFilter className="size-3" />
                  </SessionsHeaderButton>
                </>
              ) : null}
              {onAddProject || onOpenProject ? (
                <SessionsHeaderButton
                  label="Add project"
                  onClick={(event) =>
                    onAddProject
                      ? onAddProject(event.currentTarget)
                      : onOpenProject?.()
                  }
                >
                  <Plus className="size-3" />
                </SessionsHeaderButton>
              ) : null}
            </div>
            {projects.map((project) => {
              const active = sameProjectPath(project.path, cwd);
              const expanded = active
                ? tasksExpanded
                : expandedProjects.has(project.path);
              const otherSessions =
                !active && expanded
                  ? (projectSessions[project.path] ?? [])
                      .filter(
                        (session) =>
                          !session.archived && !session.orchestrationLeadId,
                      )
                      .sort(compareSessionSummaries)
                  : [];
              const historyLoaded = loadedProjectPaths
                ? loadedProjectPaths.has(project.path)
                : projectSessions[project.path] !== undefined;
              const historyError = projectHistoryErrors?.has(project.path);
              return (
                <section
                  key={project.path}
                  className="personal-project-group"
                  aria-label={basename(project.path)}
                >
                  <PersonalProjectRow
                    path={project.path}
                    active={active}
                    expanded={expanded}
                    busy={projectPathBusy(busyProjectPaths, project.path)}
                    profiles={profiles}
                    activeProfileId={activeProfileId}
                    onSelect={() => {
                      setExpandedProjects(
                        (current) => new Set([...current, project.path]),
                      );
                      onSelectProject?.(project.path);
                    }}
                    onToggle={() => {
                      if (active) setTasksExpanded((shown) => !shown);
                      else {
                        const opening = !expandedProjects.has(project.path);
                        setExpandedProjects((current) => {
                          const next = new Set(current);
                          if (next.has(project.path)) next.delete(project.path);
                          else next.add(project.path);
                          return next;
                        });
                        if (opening && !historyLoaded && onExpandProject)
                          requestProjectHistory(project.path);
                      }
                    }}
                    onNew={
                      onNewProjectTask
                        ? () => onNewProjectTask(project.path)
                        : active && onNew
                          ? () => {
                              setTasksExpanded(true);
                              onNew();
                            }
                          : undefined
                    }
                    onMove={onMoveProject}
                    onRemove={onRemoveProject}
                    onPinnedChange={() =>
                      refreshProjects((revision) => revision + 1)
                    }
                    visible={open && documentVisible}
                  />
                  {active ? (
                    currentProjectTasks
                  ) : expanded ? (
                    <div className="personal-project-tasks">
                      {!historyLoaded ? (
                        historyError ? (
                          <button
                            type="button"
                            className="personal-view-project-tasks"
                            onClick={() => requestProjectHistory(project.path)}
                          >
                            Could not load tasks. Retry
                          </button>
                        ) : requestedProjectPaths.has(project.path) ? (
                          <p className="personal-tasks-empty" role="status">
                            Loading tasks…
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="personal-view-project-tasks"
                            onClick={() =>
                              onExpandProject
                                ? requestProjectHistory(project.path)
                                : onSelectProject?.(project.path)
                            }
                          >
                            Load tasks
                          </button>
                        )
                      ) : null}
                      {otherSessions
                        .slice(0, SESSION_LIST_PAGE)
                        .map((session) =>
                          session.orchestration ? (
                            <SessionCard
                              key={session.id}
                              session={session}
                              compact
                              now={now}
                              isActive={session.id === activeSessionId}
                              isSelected={false}
                              busy={busySessionIds.has(session.id)}
                              done={false}
                              needsApproval={approvalSessionIds.has(session.id)}
                              onSelect={() =>
                                onSelectProjectSession?.(
                                  project.path,
                                  session.id,
                                )
                              }
                            />
                          ) : (
                            <button
                              key={session.id}
                              type="button"
                              className="personal-other-task personal-task-card"
                              onClick={() =>
                                onSelectProjectSession?.(
                                  project.path,
                                  session.id,
                                )
                              }
                              disabled={!onSelectProjectSession}
                              aria-current={
                                session.id === activeSessionId
                                  ? "true"
                                  : undefined
                              }
                            >
                              {busySessionIds.has(session.id) ? (
                                <span
                                  className="personal-task-working-dot"
                                  aria-label="Task running"
                                />
                              ) : (
                                <span className="personal-task-indent" />
                              )}
                              <span className="personal-task-title">
                                {sessionDisplayTitle(
                                  session.title,
                                  session.harness,
                                )}
                              </span>
                              {session.pinned ? (
                                <Pin className="size-2.5 shrink-0 opacity-55" />
                              ) : null}
                              <span className="personal-task-status">
                                {formatRelative(session.updatedAt, now)}
                              </span>
                            </button>
                          ),
                        )}
                      {otherSessions.length > SESSION_LIST_PAGE ? (
                        <button
                          type="button"
                          className="personal-view-project-tasks"
                          onClick={() => onSelectProject?.(project.path)}
                        >
                          View all {otherSessions.length} tasks
                        </button>
                      ) : null}
                      {historyLoaded && otherSessions.length === 0 ? (
                        <p className="personal-tasks-empty">No tasks yet</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
            {projects.length === 0 ? (
              <p className="personal-tasks-empty">
                Add a project to {activeProfile.name}.
              </p>
            ) : null}
          </div>
        </div>
        </div>
        </div>
      )}
      <SidebarUpdateFooter
        update={updateNotice}
        onOpenWhatsNew={onOpenWhatsNew}
        onDismissUpdate={onDismissUpdate}
      />
      <div className="personal-sidebar-footer">
        {open ? (
          <PersonalWorkspaceSwitcher
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSelectProfile={onSelectProfile ? selectProfile : undefined}
            onCreateProfile={onCreateProfile}
            onAddProject={onAddProject ?? onOpenProject}
            onOpenSettings={onOpenSettings}
            settingsOpen={settingsOpen}
            liveAgents={liveAgents}
            onSelectAgent={onSelectAgent}
          />
        ) : null}
      </div>
      {sessionMenu ? (
        <ExplorerMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          ariaLabel={
            multipleMenuSessions
              ? `${menuSessionIds.length} selected session actions`
              : "Session actions"
          }
          onPick={onSessionMenuPick}
          onClose={closeSessionMenu}
        />
      ) : null}
      {folderMenu ? (
        <ExplorerMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={folderMenuItems}
          ariaLabel="Folder actions"
          width={260}
          header={
            <FolderColorSwatches
              colorIndex={menuFolder?.colorIndex}
              customColor={menuFolder?.customColor}
              onChange={onFolderColorChange}
              onCustomChange={onFolderCustomColorChange}
            />
          }
          onPick={onFolderMenuPick}
          onClose={() => setFolderMenu(null)}
        />
      ) : null}
      {filterMenu ? (
        <SessionFiltersMenu
          x={filterMenu.x}
          y={filterMenu.y}
          harnesses={sessionHarnesses}
          filters={sessionFilters}
          onChange={onSessionFiltersChange}
          onClose={() => setFilterMenu(null)}
        />
      ) : null}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={resize.width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        className={`absolute inset-y-0 -right-px z-10 w-1.5 cursor-col-resize touch-none ${
          resize.dragging ? "bg-content/15" : "hover:bg-content/10"
        }`}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
      />
    </aside>
  );

  return (
    <div
      className="personal-sidebar-slot flex h-full shrink-0"
      {...hoverHandlers}
      data-open={sidebarVisible}
      data-floating={floating}
      data-resizing={resize.dragging || undefined}
      aria-hidden={!sidebarVisible}
      inert={!sidebarVisible || undefined}
      style={{ "--nav-width": `${resize.width}px` } as CSSProperties}
    >
      {sidebarContent}
    </div>
  );
}

export const Sidebar = memo(SidebarComponent);

function SessionsHeaderButton({
  label,
  active = false,
  open = false,
  hasPopup = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  open?: boolean;
  hasPopup?: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup={hasPopup ? "menu" : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`relative z-50 grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content ${
        open || active ? "bg-content/10 text-content" : ""
      }`}
    >
      {children}
    </button>
  );
}

function sessionListDropFromPoint(
  x: number,
  y: number,
  draggedId: string,
  sourceFolderId?: string,
): SessionListDropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const card = el.closest("[data-session-card]") as HTMLElement | null;
  const cardId = card?.dataset.sessionCard;
  if (cardId === draggedId) return null;
  const folder = el.closest("[data-session-folder]") as HTMLElement | null;
  const folderId = folder?.dataset.sessionFolder;
  if (folderId && cardId && card && folder.contains(card)) {
    if (folderId === sourceFolderId) {
      const rect = card.getBoundingClientRect();
      return {
        kind: "session",
        id: cardId,
        edge: y < rect.top + rect.height / 2 ? "before" : "after",
      };
    }
    return { kind: "folder", id: folderId };
  }
  if (cardId) return { kind: "session", id: cardId };
  if (folderId) return { kind: "folder", id: folderId };
  return null;
}

function FolderColorSwatches({
  colorIndex,
  customColor,
  onChange,
  onCustomChange,
}: {
  colorIndex: number | undefined;
  customColor: string | undefined;
  onChange: (index: number | null) => void;
  onCustomChange: (color: string) => void;
}) {
  const paletteColor =
    colorIndex != null ? TAB_GROUP_COLORS[colorIndex] : TAB_GROUP_COLORS[0];
  const pickerValue =
    customColor ?? normalizeHex(paletteColor ?? TAB_GROUP_COLORS[0]);
  return (
    <div className="px-1 py-1">
      <ColorSwatchRow
        colors={TAB_GROUP_COLORS}
        colorIndex={colorIndex}
        customColor={customColor}
        customPickerOpen
        customHighlighted={customColor != null}
        onPickIndex={(index) => onChange(index === 0 ? null : index)}
      />
      <ColorPickerPopover value={pickerValue} onChange={onCustomChange} />
    </div>
  );
}

function FolderRow({
  folder,
  sessions,
  expanded,
  dropTarget,
  canReorder = false,
  busy,
  done,
  needsApproval,
  onPointerDown,
  onToggle,
  onContextMenu,
  onRename,
}: {
  folder: SessionFolder;
  sessions: SessionSummary[];
  expanded: boolean;
  dropTarget: boolean;
  canReorder?: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRename: () => void;
}) {
  const count = sessions.length;
  const accent = folderAccent(folder.colorIndex, folder.customColor);
  return (
    <button
      type="button"
      title={folder.name}
      aria-expanded={expanded}
      data-tauri-drag-region="false"
      onPointerDown={onPointerDown}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === "F2") {
          event.preventDefault();
          onRename();
        }
      }}
      className={`group relative flex w-full touch-none items-center gap-1.5 px-2 h-8 text-left ${
        expanded ? "rounded-md" : ""
      } ${canReorder ? "cursor-grab active:cursor-grabbing" : ""} ${
        dropTarget
          ? "text-content"
          : expanded
            ? "text-content hover:bg-content/10"
            : "text-content/80 hover:bg-content/10 hover:text-content"
      }`}
    >
      {dropTarget ? (
        <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/20" />
      ) : null}
      <span
        className={`relative grid size-4 shrink-0 place-items-center ${
          accent ? "" : "text-content/50"
        }`}
        style={accent ? { color: accent } : undefined}
      >
        {expanded ? (
          <ChevronDown className="size-3.5 text-content" strokeWidth={1.75} />
        ) : (
          <>
            <Folder
              className={`size-3.5 group-hover:hidden group-focus-visible:hidden text-content`}
              strokeWidth={1.75}
            />
            <ChevronRight
              className="hidden size-3.5 group-hover:block group-focus-visible:block text-content"
              strokeWidth={1.75}
            />
          </>
        )}
      </span>
      <span className="relative min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug text-content">
        {folder.name}
      </span>
      <span className="relative flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-content/45">
        {!expanded && needsApproval ? (
          <CircleAlert className="size-3 text-amber-400" strokeWidth={1.75} />
        ) : !expanded && busy ? (
          <span className="personal-task-working-dot" aria-label="Working" />
        ) : !expanded && done ? (
          <Check className="size-3 text-emerald-400" strokeWidth={2.25} />
        ) : null}
        <span>{count}</span>
      </span>
    </button>
  );
}

function FolderRenameRow({
  folder,
  memberCount,
  dropTarget,
  onCommit,
  onCancel,
}: {
  folder: SessionFolder;
  memberCount: number;
  dropTarget: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(folder.name);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  return (
    <div
      className={`relative flex w-full items-center gap-1.5 px-2 py-1.5 ${
        dropTarget ? "" : "text-content"
      }`}
    >
      {dropTarget ? (
        <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/20" />
      ) : null}
      <span className="relative grid size-4 shrink-0 place-items-center text-content/50">
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        }}
        className="relative min-w-0 flex-1 rounded bg-content/10 px-2 py-0.5 text-[13px] font-semibold leading-snug text-content outline-none ring-1 ring-accent/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
      />
      <span className="relative shrink-0 text-[11px] tabular-nums text-content/45">
        {memberCount}
      </span>
    </div>
  );
}

function SessionCard({
  session,
  isActive,
  isSelected,
  busy,
  done,
  needsApproval,
  dropTarget,
  dropEdge,
  compact = false,
  now,
  onSelect,
  onPrefetch,
  onPlaceOnPane,
  onListDrop,
  onListDropTargetChange,
  onContextMenu,
  onArchive,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  isActive: boolean;
  isSelected: boolean;
  busy: boolean;
  done: boolean;
  needsApproval: boolean;
  dropTarget?: boolean;
  dropEdge?: "before" | "after";
  compact?: boolean;
  now: number;
  onSelect: (
    sessionId: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onPrefetch?: (sessionId: string) => void;
  onPlaceOnPane?: (sessionId: string, targetId: string, edge: PaneEdge) => void;
  onListDrop?: (draggedId: string, target: SessionListDropTarget) => void;
  onListDropTargetChange?: (target: SessionListDropTarget | null) => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onArchive?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const skipClickUntil = useRef(0);
  const cancelDrag = useRef<(() => void) | null>(null);
  const listDropRef = useRef(onListDrop);
  listDropRef.current = onListDrop;
  useEffect(() => () => cancelDrag.current?.(), [session.id]);
  const [dragging, setDragging] = useState(false);
  const title = sessionDisplayTitle(session.title, session.harness);
  const gitLabel = formatGitLabel(session.repo, session.branch);
  const time = formatRelative(session.updatedAt, now);
  const model = resolveModel(session.harness, session.model).name;
  const approvalLabel = session.orchestration
    ? "Needs input"
    : "Needs approval";
  const statusClass = needsApproval
    ? "text-amber-400"
    : busy
      ? "text-accent"
      : done
        ? "text-emerald-400"
        : "text-content/45";
  const status = (
    <span
      className={`personal-task-status flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${statusClass}`}
      title={
        needsApproval ? approvalLabel : busy ? "Working" : done ? "Done" : time
      }
    >
      {needsApproval ? (
        <>
          <CircleAlert className="size-3" strokeWidth={1.75} />
          <span
            className={
              compact && !session.orchestration ? "sr-only" : undefined
            }
          >
            {approvalLabel}
          </span>
        </>
      ) : busy ? (
        <>
          <span className="personal-task-working-dot" aria-hidden />
          <span className={compact ? "sr-only" : undefined}>Working</span>
        </>
      ) : done ? (
        <>
          <Check className="size-3" strokeWidth={2.25} />
          <span className={compact ? "sr-only" : undefined}>Done</span>
        </>
      ) : (
        <span>{time}</span>
      )}
    </span>
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "F2" && onRename) {
      e.preventDefault();
      onRename();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      onDelete();
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // Warm the transcript during the press. Opening stays on click so a
    // drag-to-pane gesture does not switch conversations.
    onPrefetch?.(session.id);
    if (!onPlaceOnPane && !onListDrop) return;
    cancelDrag.current?.();
    const handle = event.currentTarget;
    const sourceFolderId = handle.closest<HTMLElement>("[data-session-folder]")
      ?.dataset.sessionFolder;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let finished = false;
    let lastX = startX;
    let lastY = startY;
    let lastList: SessionListDropTarget | null = null;
    handle.setPointerCapture(pointerId);
    const restoreSelection = suppressTextSelection();

    const setListTarget = (next: SessionListDropTarget | null) => {
      if (
        lastList?.kind === next?.kind &&
        lastList?.id === next?.id &&
        (lastList?.kind === "session" ? lastList.edge : undefined) ===
          (next?.kind === "session" ? next.edge : undefined)
      )
        return;
      lastList = next;
      onListDropTargetChange?.(next);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        active = true;
        setDragging(true);
        if (onPlaceOnPane) {
          setExternalPaneDrop({
            fromId: session.id,
            overId: null,
            edge: "left",
          });
        }
      }
      setListTarget(
        sessionListDropFromPoint(
          ev.clientX,
          ev.clientY,
          session.id,
          sourceFolderId,
        ),
      );
      if (!onPlaceOnPane) return;
      const over = paneDropFromPoint(ev.clientX, ev.clientY);
      if (!over || over.id === session.id) {
        setExternalPaneDrop({
          fromId: session.id,
          overId: over?.id === session.id ? session.id : null,
          edge: over?.edge ?? "left",
        });
        return;
      }
      setExternalPaneDrop({
        fromId: session.id,
        overId: over.id,
        edge: over.edge,
      });
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onBlur = () => finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      finish(false);
    };

    function finish(commit: boolean) {
      if (finished) return;
      finished = true;
      cancelDrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      handle.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("keydown", onKey);
      restoreSelection();
      setDragging(false);
      setExternalPaneDrop(null);
      setListTarget(null);
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (!active) return;
      skipClickUntil.current = performance.now() + 400;
      if (!commit) return;
      const listOver = sessionListDropFromPoint(
        lastX,
        lastY,
        session.id,
        sourceFolderId,
      );
      if (listOver) {
        listDropRef.current?.(session.id, listOver);
        return;
      }
      const over = paneDropFromPoint(lastX, lastY);
      if (over && over.id !== session.id) {
        onPlaceOnPane?.(session.id, over.id, over.edge);
      }
    }

    cancelDrag.current = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    handle.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey);
  };

  const archiveLabel = session.archived ? "Unarchive" : "Archive";

  // The lead opens from its header. Worker controls remain sibling buttons,
  // so expanding or stopping a worker cannot accidentally open the lead.
  if (session.orchestration)
    return (
      <div className="personal-task-row group relative">
        <div
          data-session-card={session.id}
          data-orchestration-card="true"
          data-needs-approval={needsApproval || undefined}
          data-session-selected={isSelected ? "true" : undefined}
          aria-current={isActive ? "true" : undefined}
          className={`personal-task-card relative border rounded-md text-left ${dragging ? "opacity-40" : ""} ${
            isSelected
              ? "bg-accent/15 text-content border-transparent"
              : needsApproval
                ? "bg-content/20 text-content border-content/30 border-dashed"
                : isActive
                  ? "bg-content/10 text-content border-transparent"
                  : "text-content/80 hover:bg-content/5 border-transparent"
          }`}
        >
          {dropTarget ? (
            <span
              aria-hidden
              data-session-insert={dropEdge}
              className={`pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-accent ${dropEdge === "after" ? "bottom-0" : "top-0"}`}
            />
          ) : null}
          <button
            type="button"
            data-session-select
            data-tauri-drag-region="false"
            aria-current={isActive ? "true" : undefined}
            aria-pressed={isSelected}
            title={`${title}\n${model}${gitLabel ? ` · ${gitLabel}` : ""}`}
            className="flex w-full touch-none flex-col gap-1 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-accent"
            onPointerDown={onPointerDown}
            onPointerEnter={() => onPrefetch?.(session.id)}
            onContextMenu={onContextMenu}
            onKeyDown={(event) => {
              onKeyDown(event);
              if (event.key === "Enter" && !event.defaultPrevented) {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
            onClick={(event) => {
              if (performance.now() < skipClickUntil.current) return;
              onSelect(session.id, event);
            }}
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <HarnessIcon
                harness={session.harness}
                className="size-3 shrink-0"
              />
              <span className="min-w-0 flex-1 truncate text-[10px] text-content/55">
                {model}
              </span>
              {status}
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              {session.pinned ? (
                <Pin className="size-3 shrink-0 text-content/45" />
              ) : null}
              <span className="personal-task-title">{title}</span>
            </span>
          </button>
          <OrchestrationSidebarAgents
            leadId={session.id}
            summary={session.orchestration}
          />
          {onArchive ? (
            <div className="flex justify-end">
              <button
                type="button"
                data-no-drag
                title={archiveLabel}
                aria-label={`${archiveLabel} ${title}`}
                className="grid size-5 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive();
                }}
              >
                <Archive className="size-3.5" strokeWidth={1.75} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );

  return (
    <div
      className="personal-task-row group relative"
      data-has-archive={!!onArchive}
    >
      <button
        type="button"
        title={`${title}\n${resolveModel(session.harness, session.model).name}${gitLabel ? ` · ${gitLabel}` : ""}`}
        aria-current={isActive ? "true" : undefined}
        aria-pressed={isSelected}
        data-session-card={session.id}
        data-session-selected={isSelected ? "true" : undefined}
        data-needs-approval={needsApproval || undefined}
        data-tauri-drag-region="false"
        onPointerDown={onPointerDown}
        onPointerEnter={() => onPrefetch?.(session.id)}
        onClick={(event) => {
          if (performance.now() < skipClickUntil.current) return;
          onSelect(session.id, event);
        }}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        className={`personal-task-card relative border flex w-full touch-none flex-col rounded-md px-2.5 text-left ${
          compact ? "py-1.5" : "py-2"
        } ${dragging ? "opacity-40" : ""} ${
          dropTarget
            ? "text-content border-transparent"
            : isSelected
              ? "bg-accent/15 text-content border-transparent"
              : needsApproval
                ? "bg-content/20 text-content border-content/30 border-dashed"
                : isActive
                  ? "bg-content/10 text-content border-transparent"
                  : "text-content/80 hover:bg-content/5 hover:text-content border-transparent"
        }`}
      >
        {dropTarget ? (
          dropEdge ? (
            <span
              data-session-insert={dropEdge}
              aria-hidden
              className={`pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-accent ${
                dropEdge === "before" ? "top-0" : "bottom-0"
              }`}
            />
          ) : (
            <div className="pointer-events-none absolute inset-0 rounded-md bg-accent/20" />
          )
        ) : null}
        {compact ? null : (
          <span className="relative flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <HarnessIcon
                harness={session.harness}
                className="size-3.5 shrink-0"
              />
              <span className="min-w-0 truncate text-[11px] text-content/50">
                {model}
              </span>
            </span>
            {status}
          </span>
        )}
        <span
          className={`relative flex min-w-0 items-center gap-1.5 ${
            compact ? "" : "mt-1"
          }`}
        >
          {session.pinned ? (
            <Pin
              className="size-3 shrink-0 text-content/45"
              strokeWidth={1.75}
            />
          ) : compact ? (
            <HarnessIcon
              harness={session.harness}
              className="size-3 shrink-0 opacity-60"
            />
          ) : null}
          <span className="personal-task-title min-w-0 flex-1 line-clamp-1 text-[13px] font-semibold leading-snug text-content">
            {title}
          </span>
          {compact ? status : null}
        </span>
        {compact ? null : (
          <span className="personal-task-meta relative mt-1 flex items-center gap-2">
            {gitLabel ? (
              <span className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-content/45">
                <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 truncate">{gitLabel}</span>
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <span
              className={`flex shrink-0 items-center gap-1.5 ${
                onArchive
                  ? "transition-[padding] group-focus-within:pl-5 group-hover:pl-5"
                  : ""
              }`}
            >
              <HarnessIcon
                harness={session.harness}
                className="size-3.5 shrink-0"
              />
            </span>
          </span>
        )}
      </button>
      {onArchive ? (
        <button
          type="button"
          data-no-drag
          data-tauri-drag-region="false"
          title={archiveLabel}
          aria-label={`${archiveLabel} ${title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onArchive();
          }}
          className={`personal-task-archive pointer-events-none absolute right-7 grid size-5 place-items-center rounded text-content/50 opacity-0 transition-opacity hover:bg-content/10 hover:text-content group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 ${
            compact ? "bottom-[5px]" : "bottom-[7px]"
          }`}
        >
          <Archive className="size-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

function SessionRenameRow({
  session,
  isActive,
  busy,
  needsApproval,
  onCommit,
  onCancel,
}: {
  session: SessionSummary;
  isActive: boolean;
  busy: boolean;
  needsApproval: boolean;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const [value, setValue] = useState(() =>
    sessionDisplayTitle(session.title, session.harness),
  );

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const finish = (success: boolean) => {
    if (finished.current) return;
    if (success) {
      const trimmed = value.trim();
      if (!trimmed) {
        onCancel();
        return;
      }
      finished.current = true;
      onCommit(trimmed);
      return;
    }
    finished.current = true;
    onCancel();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  };

  return (
    <div
      className={`flex w-full flex-col rounded-md px-2.5 py-2 ${
        needsApproval
          ? "bg-amber-400/10 text-content"
          : isActive
            ? "bg-content/10 text-content"
            : "text-content/80"
      }`}
    >
      <input
        ref={inputRef}
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded bg-content/10 px-2 py-1 text-[13px] font-semibold leading-snug text-content outline-none ring-1 ring-accent/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
      />
    </div>
  );
}

function formatGitLabel(repo?: string, branch?: string): string {
  if (repo && branch) return `${repo}/${branch}`;
  return branch || repo || "";
}

function formatRelative(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const seconds = Math.max(0, Math.round((now - value) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return "";
  }
}
