import { useFloatingSidebarClip } from "../hooks/useFloatingSidebarClip";
import { usePanelDockHandoff } from "../hooks/usePanelDockHandoff";
import { useChromeProps } from "../hooks/useChromeProps";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Folder,
  GitBranch,
  ListFilter,
  Pin,
  PanelLeft,
  Plus,
  Search,
} from "./icons";
import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { WorkspaceProfileMenu } from "./WorkspaceProfileMenu";
import {
  basename,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "../lib/fs";
import { IS_MAC, MOD } from "../lib/platform";
import { resolveModel } from "../lib/models";
import { HARNESS_TITLE, sessionDisplayTitle } from "../lib/session";
import { copyText } from "../lib/clipboard";
import { syncTruncatedTitle } from "../lib/truncatedTitle";
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
import { projectStatusFor, type ProjectStatusMap } from "../lib/projectStatus";
import type { SessionSummary } from "../lib/sessionStore";
import type { SettingsSectionId } from "../lib/settings";
import type { InstalledUpdate } from "../lib/updateNotice";
import { TAB_GROUP_COLORS } from "../lib/tabGroups";
import { useDragResize } from "../hooks/useDragResize";
import { useProfileCarousel } from "../hooks/useProfileCarousel";
import { useSidebarPageState } from "../hooks/useSidebarPageState";
import {
  ProfileCarouselPreview,
  captureProfileSidebar,
  type WorkspaceProfilePreviewData,
} from "./ProfileCarouselPreview";
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
import { PersonalWorkspaceSwitcher } from "./PersonalWorkspaceSwitcher";
import { ProfileSidebarHeader } from "./ProfileSidebarHeader";
import { PersonalProjectRow } from "./PersonalProjectRow";
import { OrchestrationSidebarAgents } from "./OrchestrationSidebarAgents";
import { TeamMiniFaces } from "./TeamCard";
import {
  foldTeamRows,
  teamAgentsText,
  teamsByOrigin,
  type SidebarTeam,
} from "../lib/teamGrouping";
import {
  DEFAULT_WORKSPACE_PROFILES,
  type WorkspaceProfile,
} from "../lib/workspaceProfiles";
import { DevModeSlot, TabVisitNav } from "./TitleBar";
import { SessionFiltersMenu } from "./SessionFiltersMenu";
import { SidebarUpdateFooter } from "./SidebarUpdate";
import {
  DiscussionLinks,
  DiscussionTalkBadge,
  DiscussionTalkMark,
  useDiscussionLinks,
} from "./SidebarDiscussions";
import {
  sidebarTalks,
  type SidebarDiscussion,
  type SidebarTalk,
} from "../lib/discussions";
import { SettingsNav } from "./SettingsRail";
import { WorkConflictMark } from "./WorkConflictMark";
import { MotionList } from "./MotionList";
import { useTurnEndFlash } from "../hooks/useTurnEndFlash";
import type { WorkConflict, WorkConflictMap } from "../lib/workConflicts";
import type { ChatStatusWord } from "../lib/chatStatus";
import { ChatStatusPill } from "./ChatStatusPill";
import { BotCritter, BotStatusPill } from "./BotCritter";
import {
  SidebarCrewRows,
  type SidebarCrew,
  type SidebarCrewAction,
} from "./SidebarCrews";
import {
  botsAvailable,
  DEFAULT_BOT_NAME,
  type BotStatus,
} from "../lib/projectBots";
import { botProjectStates } from "../lib/projectBotCopy";
import {
  BOT_PICKER_WIDTH,
  BotPicker,
  type BotPickerProject,
} from "./BotPicker";
import { projectAppearance } from "../lib/projectAppearance";
import { useAutomationChatIds } from "../hooks/useAutomationChats";
import "./PersonalNavigation.css";

const MIN_WIDTH = 190;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 256;

let rememberedWidth = DEFAULT_WIDTH;

type SidebarTab = SidebarTabId;

export type SidebarProps = {
  cwd: string;
  /** Working copy for Changes / explorer git. Falls back to `cwd`. */
  gitCwd?: string;
  open: boolean;
  floating?: boolean;
  /** Window navigation that moves and compacts with this panel. */
  navigation?: ReactNode;
  hoverHandlers?: HoverRevealHandlers;
  sessions: SessionSummary[];
  busySessionIds: Set<string>;
  approvalSessionIds: Set<string>;
  /**
   * Chats among `approvalSessionIds` that wait on you for their team (a
   * paused discussion, race or run) rather than their own request; they
   * read "Needs you".
   */
  teamNeedIds?: ReadonlySet<string>;
  /**
   * Each chat's one-word status (see `chatStatus`), shown as a pill on its
   * row; chats with none are left out.
   */
  chatStatus?: Readonly<Record<string, ChatStatusWord>>;
  /** What holds each working chat up, for its pill's tooltip (see `chatHoldUpHints`). */
  chatStatusHints?: Readonly<Record<string, string>>;
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
  /** Put the chats on their project's board, each its own card. */
  onAddToBoard?: (sessionIds: string[]) => void;
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
  onOpenAllChanges?: (kind?: GitFileDiffKind) => void;
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
  onDeleteProfile?: (id: string) => void;
  onMoveProject?: (path: string, profileId: string) => void;
  onAddProject?: (anchor?: HTMLButtonElement) => void;
  projectSessions?: Record<string, readonly SessionSummary[]>;
  onExpandProject?: (path: string) => void;
  loadedProjectPaths?: ReadonlySet<string>;
  projectHistoryErrors?: ReadonlySet<string>;
  onSelectProjectSession?: (path: string, sessionId: string) => void;
  onNewProjectTask?: (path: string) => void;
  /** Per-project activity and changed files, keyed by `projectKey(path)`. */
  projectStatus?: ProjectStatusMap;
  liveAgents?: LiveAgent[];
  /** Chats discussing with each other; their rows talk and are linked. */
  discussions?: readonly SidebarDiscussion[];
  /**
   * Open races as one row each: the chat a race was sent from shows its
   * lanes' mascots and status, and the lanes fold into it.
   */
  teams?: readonly SidebarTeam[];
  /** Show a discussion in the team panel; its connector opens it. */
  onOpenDiscussion?: (id: string) => void;
  /**
   * Projects' bots that are on, listed in their own Bots section below the
   * projects; a bot's chat is not listed with its project's chats.
   */
  bots?: readonly SidebarBot[];
  /** Open a project's bot chat. */
  onOpenBot?: (path: string) => void;
  /** Turn a project's bot on, or change its settings. */
  onBotSettings?: (path: string) => void;
  /** Give a project a bot with its defaults and open its chat. */
  onAddBot?: (path: string) => void;
  /**
   * Crews that are on, one row each in the Crews section; each unfolds into
   * its bots. A project whose only bot is its Fixer shows as a bot row.
   */
  crews?: readonly SidebarCrew[];
  /** Open a crew: its project's Board with the crew on it. */
  onOpenCrew?: (path: string) => void;
  /** Open one crew member's chat. */
  onOpenCrewMember?: (path: string, who: string) => void;
  /** A crew's right-click menu. */
  onCrewAction?: (path: string, action: SidebarCrewAction) => void;
  /** Turn a project's crew on (New crew). */
  onAddCrew?: (path: string) => void;
  /** Chats editing another working chat's files or running a second dev server. */
  workConflicts?: WorkConflictMap;
  onSelectAgent?: (sessionId: string) => void;
  onSelectProject?: (path: string) => void;
  /** Open the project's board tab. */
  onOpenBoard?: (path: string) => void;
  onOpenProject?: () => void;
  onRemoveProject?: (path: string, options: { purgeData: boolean }) => void;
  /** The macOS floating sidebar resolves this in its workspace window. */
  onNew?: () => string | void | Promise<string | void>;
  onNewStandalone?: () => void;
  startingStandalone?: boolean;
  standaloneActive?: boolean;
  standaloneSessions?: readonly SessionSummary[];
  onOpenStandalone?: () => void;
  onNewTerminal?: () => void;
  onSearch?: () => void;
  onOpenInbox?: () => void;
  onOpenAutomations?: () => void;
  onOpenNotes?: () => void;
  /** The workspace's row opens its Home. */
  onOpenHome?: () => void;
  onGoToFile?: () => void;
  searchActive?: boolean;
  inboxActive?: boolean;
  automationsActive?: boolean;
  notesActive?: boolean;
  homeActive?: boolean;
  /** Failed automation runs nobody has opened, counted on its tile. */
  automationsUnread?: number;
  /** Cards automations left that the Inbox lists, counted on its tile. */
  inboxCount?: number;
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

/** A project's bot as its sidebar row shows it. */
export type SidebarBot = {
  path: string;
  sessionId?: string;
  name: string;
  /** Its project's name, shown when the row is hovered. */
  project: string;
  status: BotStatus;
  /** Its latest one-line post, for the row's tooltip. */
  headline: string;
};

const NO_BOTS: readonly SidebarBot[] = [];
const NO_CREWS: readonly SidebarCrew[] = [];
const NO_DISCUSSIONS: readonly SidebarDiscussion[] = [];
const NO_TEAM_NEEDS: ReadonlySet<string> = new Set();
const NO_TEAMS: readonly SidebarTeam[] = [];
/** Rows whose amber comes from their team needing you (see `teamNeedIds`). */
const TeamNeeds = createContext<ReadonlySet<string>>(NO_TEAM_NEEDS);
const NO_CHAT_STATUS: Readonly<Record<string, ChatStatusWord>> = {};
/** Each row's one-word status (see `chatStatus`). */
const ChatStatuses =
  createContext<Readonly<Record<string, ChatStatusWord>>>(NO_CHAT_STATUS);
const NO_CHAT_HINTS: Readonly<Record<string, string>> = {};
/** What holds each working row up (see `chatStatusHints`). */
const ChatStatusHints =
  createContext<Readonly<Record<string, string>>>(NO_CHAT_HINTS);
const NO_CONFLICTS: WorkConflictMap = {};

/** Personal is the default home for every project, so it cannot be deleted. */
function workspaceMenuItems(
  profile: WorkspaceProfile,
  activeProfileId: string,
  canSwitch: boolean,
  canDelete: boolean,
): ExplorerMenuItem[] {
  const items: ExplorerMenuItem[] = [];
  if (canSwitch && profile.id !== activeProfileId)
    items.push({
      kind: "item",
      id: "switch",
      label: `Switch to ${profile.name}`,
    });
  if (canDelete) {
    if (items.length) items.push({ kind: "sep" });
    items.push(
      profile.id === "personal"
        ? {
            kind: "item",
            id: "delete",
            label: "Delete workspace…",
            description: "Personal is the default workspace",
            disabled: true,
          }
        : {
            kind: "item",
            id: "delete",
            label: "Delete workspace…",
            danger: true,
          },
    );
  }
  return items;
}

function SidebarComponent({
  cwd,
  open,
  floating = false,
  navigation,
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
  onAddToBoard,
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
  onDeleteProfile,
  onMoveProject,
  onAddProject,
  projectSessions = {},
  onExpandProject,
  loadedProjectPaths,
  projectHistoryErrors,
  onSelectProjectSession,
  onNewProjectTask,
  projectStatus,
  liveAgents = [],
  discussions = NO_DISCUSSIONS,
  onOpenDiscussion,
  bots = NO_BOTS,
  onOpenBot,
  onBotSettings,
  onAddBot,
  crews = NO_CREWS,
  onOpenCrew,
  onOpenCrewMember,
  onCrewAction,
  onAddCrew,
  teams = NO_TEAMS,
  teamNeedIds = NO_TEAM_NEEDS,
  chatStatus = NO_CHAT_STATUS,
  chatStatusHints = NO_CHAT_HINTS,
  workConflicts = NO_CONFLICTS,
  onSelectAgent,
  onSelectProject,
  onOpenBoard,
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
  onOpenAutomations,
  onOpenNotes,
  onOpenHome,
  searchActive = false,
  inboxActive = false,
  automationsActive = false,
  notesActive = false,
  homeActive = false,
  automationsUnread = 0,
  inboxCount = 0,
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
  const [deletingProfile, setDeletingProfile] =
    useState<WorkspaceProfile | null>(null);
  // Right-click actions for any workspace, from the footer, header or menu.
  const [workspaceMenu, setWorkspaceMenu] = useState<{
    profile: WorkspaceProfile;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => setWorkspaceMenu(null), [open]);
  const openWorkspaceMenu =
    onSelectProfile || onDeleteProfile
      ? (profile: WorkspaceProfile, x: number, y: number) =>
          setWorkspaceMenu({ profile, x, y })
      : undefined;
  const [profileMenuAnchor, setProfileMenuAnchor] =
    useState<HTMLButtonElement | null>(null);
  useEffect(() => setProfileMenuAnchor(null), [activeProfileId, open]);
  const [documentVisible, setDocumentVisible] = useState(
    () => !document.hidden,
  );
  const [sessionFilters, setSessionFilters] = useState(
    loadSessionSidebarFilters,
  );
  const sessionFiltersKey = `${sessionFilters.showArchived}\0${sessionFilters.time}\0${sessionFilters.hiddenHarnesses.join(",")}\0${sessionFilters.status.working}\0${sessionFilters.status.needsApproval}\0${sessionFilters.status.done}`;
  const {
    tasksExpanded,
    setTasksExpanded,
    taskSearchOpen,
    setTaskSearchOpen: updateTaskSearchOpen,
    searchQuery,
    setSearchQuery,
    sessionListLimit,
    setSessionListLimit,
    sessionsScrollRef,
    setScroller,
    captureScroll,
  } = useSidebarPageState({
    profileId: activeProfileId,
    cwd,
    filtersKey: sessionFiltersKey,
    profileIds: profiles.map((profile) => profile.id),
  });
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
  const carouselEnabled =
    open && !!onSelectProfile && !settingsOpen && !profileMenuAnchor;
  const selectProfile = (id: string) => {
    captureScroll();
    // Capture before React moves the live body to its destination, including
    // footer/header navigation. Every transition should retain the outgoing
    // page's visible rows and scroll position until it leaves the viewport.
    if (id !== activeProfileId && profileContentRef.current)
      profileSnapshots.current.set(
        activeProfileId,
        captureProfileSidebar(profileContentRef.current),
      );
    onSelectProfile?.(id);
  };
  useProfileCarousel({
    viewport: profileViewportRef,
    enabled: carouselEnabled,
    profiles,
    activeProfileId,
    onSelectProfile: selectProfile,
  });
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
  const [savedSessionFolders, setSavedSessionFolders] = useState(() => ({
    cwd,
    folders: loadSessionFolders(cwd),
  }));
  // Resolve the destination folders before rendering its rows and restoring
  // scroll. An outgoing folder tree must not temporarily shorten this page.
  const sessionFolders = useMemo(
    () =>
      savedSessionFolders.cwd === cwd
        ? savedSessionFolders.folders
        : loadSessionFolders(cwd),
    [cwd, savedSessionFolders],
  );
  // Adopt this already-resolved destination before React commits its children.
  // Doing this in a layout effect repeated the whole sidebar commit mid-swipe.
  if (savedSessionFolders.cwd !== cwd)
    setSavedSessionFolders({ cwd, folders: sessionFolders });
  const setSessionFolders = (
    action: SessionFolder[] | ((folders: SessionFolder[]) => SessionFolder[]),
  ) => {
    setSavedSessionFolders((saved) => {
      const previous =
        saved.cwd === cwd ? saved.folders : loadSessionFolders(cwd);
      const folders = typeof action === "function" ? action(previous) : action;
      return saved.cwd === cwd && folders === saved.folders
        ? saved
        : { cwd, folders };
    });
  };
  const [sessionDrop, setSessionDrop] = useState<SessionListDropTarget | null>(
    null,
  );
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  /** The New bot picker: the projects that can have a bot, or could with Git. */
  const [botPicker, setBotPicker] = useState<{
    x: number;
    y: number;
    projects: BotPickerProject[];
    empty: string;
  } | null>(null);
  const botPickerRequest = useRef(0);
  // A row is setting up Git: scrolling the sidebar leaves the picker open.
  const botPickerBusy = useRef(false);
  const loadMoreRef = useRef<HTMLLIElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestedSearchFocus = useRef<string | null>(null);
  const searchPageKey = JSON.stringify([activeProfileId, cwd]);
  const setTaskSearchOpen = (
    action: boolean | ((shown: boolean) => boolean),
  ) => {
    const next = typeof action === "function" ? action(taskSearchOpen) : action;
    requestedSearchFocus.current = next ? searchPageKey : null;
    updateTaskSearchOpen(next);
  };
  useLayoutEffect(() => {
    if (
      requestedSearchFocus.current === searchPageKey &&
      taskSearchOpen &&
      open &&
      !settingsOpen
    )
      searchInputRef.current?.focus({ preventScroll: true });
    requestedSearchFocus.current = null;
  }, [searchPageKey, taskSearchOpen, open, settingsOpen]);
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
  // An open race is one row: its lanes fold into the chat it came from,
  // wherever that chat's row is listed. Several races can start from one.
  const teamByOrigin = useMemo(() => teamsByOrigin(teams), [teams]);
  // A bot's chat is its pinned row, and an automation run's chat stays in
  // Automations: neither is one of the project's chats.
  const automationChats = useAutomationChatIds();
  const hiddenChats = useMemo(
    () =>
      new Set([
        ...bots.flatMap((bot) => (bot.sessionId ? [bot.sessionId] : [])),
        ...crews.flatMap((crew) =>
          crew.members.flatMap((member) =>
            member.sessionId ? [member.sessionId] : [],
          ),
        ),
        ...automationChats,
      ]),
    [bots, crews, automationChats],
  );
  const listedSessions = mergeFolderSessionSummaries(
    sessions,
    openSessions,
    sessionFolders,
  ).filter(
    (session) => !session.orchestrationLeadId && !hiddenChats.has(session.id),
  );
  const visibleSessions = foldTeamRows(
    filterSessionsByQuery(
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
    teams,
  ).sort(compareSessionSummaries);
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
  const sessionHarnesses = harnessesInSessions(sessions);
  const narrowedByUser = searchNarrowed || filtersActive;
  const visibleFolderIds = sessionListEntries.flatMap((entry) =>
    entry.kind === "folder" ? [entry.folder.id] : [],
  );
  // Rows glide when a chat's order or status changes (see MotionList).
  const sessionListKeys = sessionListEntries.map(sessionListEntryKey);
  const sessionListState = sessionListEntries
    .map((entry) =>
      entry.kind === "session"
        ? `${busySessionIds.has(entry.session.id) ? "b" : ""}${
            approvalSessionIds.has(entry.session.id) ? "a" : ""
          }${unseenFinishedIds.has(entry.session.id) ? "d" : ""}`
        : "",
    )
    .join(",");
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
  useFloatingSidebarClip(asideRef, floating && open);
  usePanelDockHandoff(asideRef, floating);

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

  useLayoutEffect(() => {
    if (renamingFolderId !== null) setRenamingFolderId(null);
    if (folderMenu !== null) setFolderMenu(null);
    if (sessionDrop !== null) setSessionDrop(null);
    if (looksLikeProject(cwd) && !expandedProjects.has(cwd))
      setExpandedProjects((current) =>
        current.has(cwd) ? current : new Set([...current, cwd]),
      );
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
    if (!sessionMenu && !folderMenu && !filterMenu && !botPicker) return;
    const onScroll = () => {
      closeSessionMenu();
      setFolderMenu(null);
      setFilterMenu(null);
      if (!botPickerBusy.current) setBotPicker(null);
    };
    const scrollParent = sessionsScrollRef.current ?? window;
    scrollParent.addEventListener("scroll", onScroll, true);
    return () => scrollParent.removeEventListener("scroll", onScroll, true);
  }, [sessionMenu, folderMenu, filterMenu, botPicker]);

  useEffect(() => {
    if (selectedSessionIds.size === 0) return;
    const clear = () => {
      contextSelectionRef.current = false;
      setSelectedSessionIds(new Set());
      setSessionMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
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
    const created = onNew?.();
    if (created instanceof Promise) void created.then(addNewToFolder);
    else addNewToFolder(created);
    function addNewToFolder(sessionId: string | void) {
      if (sessionId) placeNewInFolder(folderId, sessionId);
    }
  };

  const placeNewInFolder = (folderId: string, sessionId: string) => {
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
    // Copy either identifier for one session (MonoCode 16e9fea6). The
    // provider's own ID only exists once its first turn has bound one.
    ...(!multipleMenuSessions && menuSessions[0]
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "copy-provider-session-id",
            label: `Copy ${HARNESS_TITLE[menuSessions[0].harness] ?? "provider"} session ID`,
            disabled: !menuSessions[0].providerSessionId,
          },
          {
            kind: "item" as const,
            id: "copy-aven-session-id",
            label: "Copy Aven chat ID",
          },
        ]
      : []),
    ...(onAddToBoard
      ? [
          { kind: "sep" as const },
          {
            kind: "item" as const,
            id: "add-to-board",
            label: "Add to board",
            description: multipleMenuSessions
              ? "A card for each on the project's board"
              : "A card for it on the project's board",
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

  // Rows outside the current project's list are plain buttons; they offer
  // only Rename, which works for any saved chat by its ID.
  const [plainRowMenu, setPlainRowMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);
  const talks = useMemo(() => sidebarTalks(discussions), [discussions]);
  const discussionLayer = useRef<HTMLDivElement>(null);
  const discussionLinks = useDiscussionLinks(discussionLayer, discussions);
  /** A plain row's leading mark: talking, working, or a spacer. */
  const plainLead = (session: SessionSummary, runningLabel: string) => {
    const talk = talks.get(session.id);
    // One 16px slot before every title, so titles line up with the
    // workspace rows and the project names above them.
    return (
      <span className="personal-task-lead">
        {talk ? (
          <DiscussionTalkMark harness={session.harness} talk={talk} />
        ) : busySessionIds.has(session.id) ? (
          <span
            className="personal-task-working-dot"
            aria-label={runningLabel}
          />
        ) : (
          <span className="personal-task-indent" />
        )}
      </span>
    );
  };
  /** Names the partner when its row is not on screen to link to. */
  const talkBadge = (sessionId: string) => {
    const talk = talks.get(sessionId);
    return talk && !discussionLinks.linked.has(sessionId) ? (
      <DiscussionTalkBadge talk={talk} />
    ) : null;
  };
  /** A plain row's one-word status, if it has one. */
  const plainStatus = (sessionId: string) => {
    const word = chatStatus[sessionId];
    return word ? (
      <span className="personal-task-status">
        <ChatStatusPill word={word} holdUp={chatStatusHints[sessionId]} />
      </span>
    ) : null;
  };
  /** The races this row stands for: their lanes' mascots and status. */
  const teamBadge = (sessionId: string) =>
    teamByOrigin
      .get(sessionId)
      ?.map((team) => <SidebarTeamBadge key={team.id} team={team} />) ?? null;
  const talkRow = (sessionId: string) =>
    talks.has(sessionId) ? { "data-discussion-row": sessionId } : undefined;
  /** A bot's row: mark, name, its project on hover, and its word. */
  const botRow = (bot: SidebarBot) => {
    return (
      <button
        key={`bot:${bot.path}`}
        type="button"
        className="personal-other-task personal-task-card personal-bot-row"
        data-bot-row={bot.path}
        // Called by its role alone ("Fixer"), it shows its project at rest.
        data-role-name={bot.name === DEFAULT_BOT_NAME || undefined}
        title={`${bot.name} · ${bot.project}'s teammate\n${bot.headline}`}
        aria-current={
          bot.sessionId && bot.sessionId === activeSessionId
            ? "true"
            : undefined
        }
        onClick={() => onOpenBot?.(bot.path)}
        onContextMenu={(event) => {
          if (!onBotSettings) return;
          event.preventDefault();
          event.stopPropagation();
          onBotSettings(bot.path);
        }}
      >
        <BotCritter path={bot.path} active={bot.status === "working"} />
        <span className="personal-task-title">{bot.name}</span>
        <span className="personal-bot-project">{bot.project}</span>
        <span className="personal-task-status">
          <BotStatusPill status={bot.status} />
        </span>
      </button>
    );
  };
  const plainRowProps = (sessionId: string) =>
    onRenameSession
      ? {
          onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setPlainRowMenu({
              x: event.clientX,
              y: event.clientY,
              sessionId,
            });
          },
          onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== "F2") return;
            event.preventDefault();
            setRenamingSessionId(sessionId);
          },
        }
      : {};
  const renderPlainRename = (session: SessionSummary) =>
    renamingSessionId === session.id && onRenameSession ? (
      <SessionRenameRow
        key={session.id}
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
    ) : null;

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
    const providerSessionId = menuSessions[0]?.providerSessionId;
    closeSessionMenu();
    if (id === "copy-provider-session-id" || id === "copy-aven-session-id") {
      const value =
        id === "copy-provider-session-id" ? providerSessionId : sessionId;
      if (value)
        void copyText(value).catch((error) => {
          console.error("Failed to copy session ID:", error);
        });
      return;
    }
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
    if (id === "add-to-board") {
      onAddToBoard?.(sessionIds);
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
        talk={talks.get(session.id)}
        teams={teamByOrigin.get(session.id)}
        talkLinked={discussionLinks.linked.has(session.id)}
        conflict={workConflicts[session.id]}
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

  // Bots need Claude Code's sandbox: where it can't run, none is offered.
  const addBot = botsAvailable() ? onAddBot : undefined;
  // New crew: the section's +. Without crews wired in, it adds a bot as before.
  const addCrew = botsAvailable() ? onAddCrew : undefined;
  const addToSection = addCrew ?? addBot;
  // Crews and bots of this profile's projects, in their own section below
  // the projects. A project with a crew on shows its Fixer inside the crew.
  const profileCrews = crews.filter((crew) =>
    projects.some((project) => sameProjectPath(project.path, crew.path)),
  );
  const profileBots = bots.filter(
    (bot) =>
      projects.some((project) => sameProjectPath(project.path, bot.path)) &&
      !profileCrews.some((crew) => sameProjectPath(crew.path, bot.path)),
  );
  /**
   * New bot: this profile's projects without a bot. Those ready for one come
   * first; below them, the ones that need Git, which the picker sets up.
   */
  const openBotPicker = (target: HTMLElement) => {
    if (botPicker) {
      if (botPickerBusy.current) return;
      botPickerRequest.current += 1;
      setBotPicker(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    const request = ++botPickerRequest.current;
    const candidates = projects
      .map((project) => project.path)
      .filter((path) =>
        addCrew
          ? !crews.some((crew) => sameProjectPath(crew.path, path))
          : !bots.some((bot) => sameProjectPath(bot.path, path)),
      );
    void botProjectStates(candidates).then((states) => {
      if (request !== botPickerRequest.current) return;
      const listed = candidates.flatMap((path, index): BotPickerProject[] => {
        const state = states[index];
        return state && state !== "unavailable"
          ? [{ path, label: projectAppearance(path).label, state }]
          : [];
      });
      const empty = !projects.length
        ? "Add a project first"
        : !candidates.length
          ? addCrew
            ? "Every project has a crew"
            : "Every project has a bot"
          : addCrew
            ? "No project here can have a crew"
            : "No project here can have a bot";
      closeSessionMenu();
      setFolderMenu(null);
      setFilterMenu(null);
      botPickerBusy.current = false;
      setBotPicker({
        x: Math.max(4, rect.right - BOT_PICKER_WIDTH),
        y: rect.bottom + 2,
        projects: [
          ...listed.filter((project) => project.state === "ready"),
          ...listed.filter((project) => project.state !== "ready"),
        ],
        empty,
      });
    });
  };

  const sessionSearchInput = (
    <input
      ref={searchInputRef}
      type="text"
      value={searchQuery}
      placeholder="Filter chats…"
      aria-label="Filter chats"
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
      className="h-full w-full min-w-0 rounded-md bg-transparent py-0 pl-7 pr-2 text-ui-label text-content outline-none placeholder:text-content/35 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--aven-focus-ring)"
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
            <p className="personal-tasks-empty">
              Open a project to see its chats.
            </p>
          ) : (
            <div>
              {/*
              A project's first load stays deliberately blank. The listing is
              served from a covering index and resolves within a frame or two,
              so a placeholder only ever flashed — reading as a glitch rather
              than as progress. This is checked before the empty state so that
              cannot claim "No chats yet" before the rows have landed.
            */}
              {pendingFirstLoad ? null : status === "error" &&
                sessions.length === 0 ? (
                <p className="personal-tasks-empty">Couldn't load chats</p>
              ) : visibleSessions.length === 0 ? (
                // A narrowed-down result is a transient answer to what the user
                // just typed, so it stays a quiet line of text. Only the genuine
                // "this project has nothing in it" case earns the illustration.
                narrowedByUser ? (
                  <p className="personal-tasks-empty">
                    {searchNarrowed
                      ? "No matching chats"
                      : "No chats match these filters"}
                  </p>
                ) : (
                  <p className="personal-tasks-empty">No chats yet.</p>
                )
              ) : (
                <MotionList
                  className="personal-task-list relative flex flex-col gap-0.5 p-1.5"
                  motionKeys={sessionListKeys}
                  motionState={sessionListState}
                >
                  {sessionListEntries.map((entry, index) => {
                    if (entry.kind === "divider") {
                      return (
                        <li
                          key={sessionListKeys[index]}
                          data-motion-key={sessionListKeys[index]}
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
                          data-motion-key={entry.folder.id}
                          data-session-folder={entry.folder.id}
                          className={`relative ${
                            expanded || beforeUngrouped ? "mb-1.5" : ""
                          } ${draggingFolder ? "opacity-40" : ""}`}
                        >
                          {showFolderDropStart ? (
                            <div className="pointer-events-none absolute inset-x-1 top-0 z-20 h-0.5 rounded-full bg-content/60" />
                          ) : null}
                          {showFolderDropEnd ? (
                            <div className="pointer-events-none absolute inset-x-1 bottom-0 z-20 h-0.5 rounded-full bg-content/60" />
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
                                      title="New chat"
                                      aria-label="New chat"
                                      onClick={() =>
                                        onNewInFolder(entry.folder.id)
                                      }
                                      className="relative flex w-full items-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-left text-content/45 hover:bg-content/10 hover:text-content"
                                    >
                                      <Plus
                                        className="size-3 shrink-0"
                                        strokeWidth={1.75}
                                      />
                                      <span className="text-ui-body font-semibold leading-snug">
                                        New chat
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
                      <li
                        key={entry.session.id}
                        data-motion-key={entry.session.id}
                      >
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
                </MotionList>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );

  const profileHeader = (
    <ProfileSidebarHeader
      profile={activeProfile}
      menuOpen={!!profileMenuAnchor}
      onMenuChange={setProfileMenuAnchor}
      onWorkspaceMenu={
        openWorkspaceMenu
          ? (x, y) => openWorkspaceMenu(activeProfile, x, y)
          : undefined
      }
      onOpenHome={
        onOpenHome
          ? () => {
              // Home sits under Settings, so leave Settings for it.
              if (settingsOpen) onCloseSettings?.();
              onOpenHome();
            }
          : undefined
      }
      homeActive={homeActive && !settingsOpen}
      showNewSession={!settingsOpen && !!onNewStandalone}
      startingNewSession={startingStandalone}
      onNewSession={() => {
        setTasksExpanded(true);
        onNewStandalone?.();
      }}
      showSearch={!!onSearch}
      searchActive={searchActive}
      onSearch={onSearch}
      showNotes={!settingsOpen && notesEnabled && !!onOpenNotes}
      notesActive={notesActive}
      onOpenNotes={onOpenNotes}
      showInbox={!settingsOpen && !!onOpenInbox}
      inboxActive={inboxActive}
      onOpenInbox={onOpenInbox}
      inboxCount={inboxCount}
      showAutomations={!settingsOpen && !!onOpenAutomations}
      automationsActive={automationsActive}
      onOpenAutomations={onOpenAutomations}
      automationsUnread={automationsUnread}
    />
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
      data-navigation-header={navigation ? "true" : undefined}
      className="personal-navigation personal-sidebar sidebar-glass relative flex h-full min-h-0 shrink-0 flex-col"
    >
      <div
        className="personal-sidebar-windowbar flex h-10 shrink-0 select-none items-center pr-1.5"
        data-tauri-drag-region="deep"
      >
        {IS_MAC ? <div className="w-[96px] shrink-0" /> : null}
        {navigation ? null : <DevModeSlot />}
        {navigation ?? (
          <>
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
          </>
        )}
      </div>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {activeProfile.name} workspace
      </div>
      {profileMenuAnchor && open ? (
        <WorkspaceProfileMenu
          profiles={profiles}
          activeProfileId={activeProfileId}
          anchor={profileMenuAnchor}
          onSelect={selectProfile}
          onDelete={onDeleteProfile ? setDeletingProfile : undefined}
          onWorkspaceMenu={openWorkspaceMenu}
          onDismiss={() => setProfileMenuAnchor(null)}
        />
      ) : null}
      {workspaceMenu ? (
        <ExplorerMenu
          x={workspaceMenu.x}
          y={workspaceMenu.y}
          items={workspaceMenuItems(
            workspaceMenu.profile,
            activeProfileId,
            !!onSelectProfile,
            !!onDeleteProfile,
          )}
          ariaLabel={`Actions for ${workspaceMenu.profile.name}`}
          onClose={() => setWorkspaceMenu(null)}
          onPick={(id) => {
            const profile = workspaceMenu.profile;
            setWorkspaceMenu(null);
            if (id === "switch") selectProfile(profile.id);
            else if (id === "delete") setDeletingProfile(profile);
          }}
        />
      ) : null}
      {deletingProfile && onDeleteProfile ? (
        <DeleteWorkspaceDialog
          profile={deletingProfile}
          onCancel={() => setDeletingProfile(null)}
          onDelete={onDeleteProfile}
        />
      ) : null}
      {settingsOpen && onSelectSettingsSection && onCloseSettings ? (
        <div className="personal-settings-navigation flex min-h-0 flex-1 flex-col">
          {profileHeader}
          <p className="personal-sidebar-section-label">Settings</p>
          <SettingsNav
            section={settingsSection}
            onSelect={onSelectSettingsSection}
            onClose={onCloseSettings}
          />
        </div>
      ) : (
        <div
          ref={profileViewportRef}
          className="personal-profile-viewport min-h-0 flex-1"
          data-carousel-enabled={carouselEnabled}
          aria-label="Workspace carousel"
          tabIndex={0}
        >
          <div className="personal-profile-track">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="personal-profile-page"
                inert
                aria-hidden="true"
              >
                {profile.id !== activeProfile.id ? (
                  <ProfileCarouselPreview
                    profile={profile}
                    preview={profilePreviews?.[profile.id]}
                    snapshot={profileSnapshots.current.get(profile.id)}
                    showSearch={!!onSearch}
                    showNotes={notesEnabled && !!onOpenNotes}
                    showInbox={!!onOpenInbox}
                    showAutomations={!!onOpenAutomations}
                    showNewSession={!!onNewStandalone}
                  />
                ) : null}
              </div>
            ))}
            <div
              ref={profileContentRef}
              className="personal-profile-content flex min-h-0 min-w-0 flex-col"
              style={{
                left: `${
                  Math.max(
                    0,
                    profiles.findIndex(
                      (profile) => profile.id === activeProfile.id,
                    ),
                  ) * 100
                }%`,
              }}
            >
              {profileHeader}
              <div
                ref={setScroller}
                data-tour="projects"
                className="personal-projects-scroll min-h-0 flex-1 overflow-y-auto"
              >
                {discussions.length ? (
                  <DiscussionLinks
                    layer={discussionLayer}
                    links={discussionLinks.links}
                    onOpen={onOpenDiscussion}
                  />
                ) : null}
                {onOpenStandalone ? (
                  <section
                    className="personal-standalone-group"
                    aria-label="Chats without a project"
                  >
                    <div className="personal-projects-heading">
                      <button
                        type="button"
                        className="personal-sessions-heading"
                        title="Chats that aren't in a project"
                        onClick={() => {
                          setTasksExpanded(true);
                          onOpenStandalone();
                        }}
                      >
                        Chats
                      </button>
                    </div>
                    {standaloneActive ? (
                      currentProjectTasks
                    ) : (
                      <div className="personal-project-tasks">
                        {foldTeamRows(
                          standaloneSessions.filter(
                            (session) =>
                              !session.archived &&
                              !session.orchestrationLeadId &&
                              !hiddenChats.has(session.id),
                          ),
                          teams,
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
                                needsApproval={approvalSessionIds.has(
                                  session.id,
                                )}
                                onSelect={() => onSelectSession(session.id)}
                              />
                            ) : (
                              (renderPlainRename(session) ?? (
                                <button
                                  key={session.id}
                                  type="button"
                                  className="personal-other-task personal-task-card"
                                  onPointerEnter={(event) =>
                                    syncTruncatedTitle(event.currentTarget)
                                  }
                                  onClick={() => onSelectSession(session.id)}
                                  {...plainRowProps(session.id)}
                                  {...talkRow(session.id)}
                                >
                                  {plainLead(session, "Working")}
                                  <span className="personal-task-title">
                                    {sessionDisplayTitle(
                                      session.title,
                                      session.harness,
                                    )}
                                  </span>
                                  {talkBadge(session.id)}
                                  {teamBadge(session.id)}
                                  <WorkConflictMark
                                    conflict={workConflicts[session.id]}
                                  />
                                  {plainStatus(session.id)}
                                </button>
                              ))
                            ),
                          )}
                        {foldTeamRows(
                          standaloneSessions.filter(
                            (session) =>
                              !session.archived &&
                              !session.orchestrationLeadId &&
                              !hiddenChats.has(session.id),
                          ),
                          teams,
                        ).length > SESSION_LIST_PAGE ? (
                          <button
                            type="button"
                            className="personal-view-project-tasks"
                            onClick={onOpenStandalone}
                          >
                            View all chats
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
                        label="Filter chats by title"
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
                        label="Chat filters"
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
                      ? foldTeamRows(
                          (projectSessions[project.path] ?? []).filter(
                            (session) =>
                              !session.archived &&
                              !session.orchestrationLeadId &&
                              !hiddenChats.has(session.id),
                          ),
                          teams,
                        ).sort(compareSessionSummaries)
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
                        status={projectStatusFor(projectStatus, project.path)}
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
                              if (next.has(project.path))
                                next.delete(project.path);
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
                        onOpenBoard={
                          onOpenBoard
                            ? () => onOpenBoard(project.path)
                            : undefined
                        }
                        onMove={onMoveProject}
                        onRemove={onRemoveProject}
                        botOn={bots.some((bot) =>
                          sameProjectPath(bot.path, project.path),
                        )}
                        onBotSettings={
                          onBotSettings && botsAvailable()
                            ? () => onBotSettings(project.path)
                            : undefined
                        }
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
                                onClick={() =>
                                  requestProjectHistory(project.path)
                                }
                              >
                                Could not load chats. Retry
                              </button>
                            ) : requestedProjectPaths.has(project.path) ? (
                              <p className="personal-tasks-empty" role="status">
                                Loading chats…
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
                                Load chats
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
                                  needsApproval={approvalSessionIds.has(
                                    session.id,
                                  )}
                                  onSelect={() =>
                                    onSelectProjectSession?.(
                                      project.path,
                                      session.id,
                                    )
                                  }
                                />
                              ) : (
                                (renderPlainRename(session) ?? (
                                  <button
                                    key={session.id}
                                    type="button"
                                    className="personal-other-task personal-task-card"
                                    onPointerEnter={(event) =>
                                      syncTruncatedTitle(event.currentTarget)
                                    }
                                    onClick={() =>
                                      onSelectProjectSession?.(
                                        project.path,
                                        session.id,
                                      )
                                    }
                                    disabled={!onSelectProjectSession}
                                    {...plainRowProps(session.id)}
                                    {...talkRow(session.id)}
                                    aria-current={
                                      session.id === activeSessionId
                                        ? "true"
                                        : undefined
                                    }
                                  >
                                    {plainLead(session, "Working")}
                                    <span className="personal-task-title">
                                      {sessionDisplayTitle(
                                        session.title,
                                        session.harness,
                                      )}
                                    </span>
                                    {talkBadge(session.id)}
                                    {teamBadge(session.id)}
                                    <WorkConflictMark
                                      conflict={workConflicts[session.id]}
                                    />
                                    {session.pinned ? (
                                      <Pin className="size-2.5 shrink-0 opacity-55" />
                                    ) : null}
                                    {plainStatus(session.id) ?? (
                                      <span className="personal-task-status">
                                        {formatRelative(session.updatedAt, now)}
                                      </span>
                                    )}
                                  </button>
                                ))
                              ),
                            )}
                          {otherSessions.length > SESSION_LIST_PAGE ? (
                            <button
                              type="button"
                              className="personal-view-project-tasks"
                              onClick={() => onSelectProject?.(project.path)}
                            >
                              View all {otherSessions.length} chats
                            </button>
                          ) : null}
                          {historyLoaded && otherSessions.length === 0 ? (
                            <p className="personal-tasks-empty">No chats yet</p>
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
                {profileBots.length ||
                profileCrews.length ||
                (addToSection && projects.length) ? (
                  <section
                    className="personal-bots-group"
                    aria-label={onAddCrew ? "Crews" : "Bots"}
                    data-sidebar-bots=""
                  >
                    <div className="personal-projects-heading">
                      <span>{onAddCrew ? "Crews" : "Bots"}</span>
                      {addToSection ? (
                        <SessionsHeaderButton
                          label={addCrew ? "New crew" : "New bot"}
                          open={!!botPicker}
                          hasPopup
                          onClick={(event) =>
                            openBotPicker(event.currentTarget)
                          }
                        >
                          <Plus className="size-3" />
                        </SessionsHeaderButton>
                      ) : null}
                    </div>
                    <div className="personal-project-tasks">
                      <SidebarCrewRows
                        crews={profileCrews}
                        activeSessionId={activeSessionId}
                        onOpenCrew={onOpenCrew}
                        onOpenMember={onOpenCrewMember}
                        onAction={onCrewAction}
                      />
                      {profileBots.map(botRow)}
                      {!profileBots.length &&
                      !profileCrews.length &&
                      addToSection ? (
                        <button
                          type="button"
                          className="personal-view-project-tasks"
                          onClick={(event) =>
                            openBotPicker(event.currentTarget)
                          }
                        >
                          {addCrew ? "Add a crew" : "Add a bot"}
                        </button>
                      ) : null}
                    </div>
                  </section>
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
            onWorkspaceMenu={openWorkspaceMenu}
          />
        ) : null}
      </div>
      {plainRowMenu && onRenameSession ? (
        <ExplorerMenu
          x={plainRowMenu.x}
          y={plainRowMenu.y}
          items={[
            { kind: "item", id: "rename", label: "Rename", shortcut: "F2" },
          ]}
          ariaLabel="Chat actions"
          onClose={() => setPlainRowMenu(null)}
          onPick={(id) => {
            const sessionId = plainRowMenu.sessionId;
            setPlainRowMenu(null);
            if (id === "rename") setRenamingSessionId(sessionId);
          }}
        />
      ) : null}
      {sessionMenu ? (
        <ExplorerMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          items={sessionMenuItems}
          ariaLabel={
            multipleMenuSessions
              ? `${menuSessionIds.length} selected chat actions`
              : "Chat actions"
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
      {botPicker && addToSection ? (
        <BotPicker
          x={botPicker.x}
          y={botPicker.y}
          label={addCrew ? "Add a crew to" : "Add a bot to"}
          projects={botPicker.projects}
          empty={botPicker.empty}
          onBusyChange={(busy) => {
            botPickerBusy.current = busy;
          }}
          onAdd={(path) => {
            botPickerBusy.current = false;
            setBotPicker(null);
            addToSection(path);
          }}
          onClose={() => {
            botPickerBusy.current = false;
            setBotPicker(null);
          }}
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
        tabIndex={open ? 0 : -1}
        className="personal-panel-resizer personal-sidebar-divider"
        data-native-hit-margin=""
        data-resizing={resize.dragging || undefined}
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          resize.setWidth(
            resize.width + (event.key === "ArrowRight" ? 20 : -20),
          );
        }}
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
      <TeamNeeds.Provider value={teamNeedIds}>
        <ChatStatuses.Provider value={chatStatus}>
          <ChatStatusHints.Provider value={chatStatusHints}>
            {sidebarContent}
          </ChatStatusHints.Provider>
        </ChatStatuses.Provider>
      </TeamNeeds.Provider>
    </div>
  );
}

const MemoSidebar = memo(SidebarComponent);
const SIDEBAR_DATA: readonly (keyof SidebarProps)[] = [
  "sessions",
  "openSessions",
  "profiles",
  "profilePreviews",
  "projectSessions",
  "recents",
  "projectStatus",
  "liveAgents",
  "discussions",
  "bots",
  "teams",
  "workConflicts",
  "standaloneSessions",
  "busySessionIds",
  "approvalSessionIds",
  "teamNeedIds",
  "chatStatus",
  "chatStatusHints",
  "loadedProjectPaths",
  "projectHistoryErrors",
  "unseenFinishedIds",
];
export function Sidebar(props: SidebarProps) {
  return <MemoSidebar {...useChromeProps(props, SIDEBAR_DATA)} />;
}

/** A row of the task list: its folder, chat or divider. */
function sessionListEntryKey(
  entry: ReturnType<typeof buildSessionList>[number],
  index: number,
): string {
  return entry.kind === "folder"
    ? entry.folder.id
    : entry.kind === "session"
      ? entry.session.id
      : `divider-${index}`;
}

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
      className={`aven-press relative z-50 grid size-6 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content ${
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
        <div className="pointer-events-none absolute inset-0 rounded-md bg-content/10" />
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
      <span className="relative min-w-0 flex-1 truncate text-ui-body font-semibold leading-snug text-content">
        {folder.name}
      </span>
      <span className="relative flex shrink-0 items-center gap-1 text-ui-caption tabular-nums text-content/45">
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
        <div className="pointer-events-none absolute inset-0 rounded-md bg-content/10" />
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
        className="aven-field relative min-w-0 flex-1 px-2 py-0.5 text-ui-body font-semibold leading-snug"
      />
      <span className="relative shrink-0 text-ui-caption tabular-nums text-content/45">
        {memberCount}
      </span>
    </div>
  );
}

function SessionCard({
  session,
  talk,
  teams,
  talkLinked = false,
  conflict,
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
  /** Its part in a discussion with another chat, if any. */
  talk?: SidebarTalk;
  /** The races this row stands for, their lanes folded in. */
  teams?: readonly SidebarTeam[];
  /** The partner's row is on screen and linked to this one. */
  talkLinked?: boolean;
  /** Editing another working chat's files, or running a second dev server. */
  conflict?: WorkConflict;
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
  const rowRef = useRef<HTMLDivElement>(null);
  useTurnEndFlash(rowRef, session.id);
  const listDropRef = useRef(onListDrop);
  listDropRef.current = onListDrop;
  useEffect(() => () => cancelDrag.current?.(), [session.id]);
  const [dragging, setDragging] = useState(false);
  const title = sessionDisplayTitle(session.title, session.harness);
  const gitLabel = formatGitLabel(session.repo, session.branch);
  const time = formatRelative(session.updatedAt, now);
  const model = resolveModel(session.harness, session.model).name;
  const teamNeeds = useContext(TeamNeeds);
  const approvalLabel = "Needs you";
  // Its own approval or question says what it waits for; a team's need says
  // why on the team's own card.
  const approvalHint =
    teamNeeds.has(session.id) || session.orchestration
      ? approvalLabel
      : "Needs you: approve an action or answer a question";
  const statusClass = needsApproval
    ? "text-[color:var(--aven-needs-you)]"
    : busy
      ? "text-accent"
      : done
        ? "text-emerald-400"
        : "text-content/45";
  const word = useContext(ChatStatuses)[session.id];
  const holdUp = useContext(ChatStatusHints)[session.id];
  const status = word ? (
    <span className="personal-task-status flex shrink-0 items-center">
      <ChatStatusPill word={word} holdUp={holdUp} />
    </span>
  ) : (
    <span
      className={`personal-task-status flex shrink-0 items-center gap-1 text-ui-caption tabular-nums ${statusClass}`}
      title={
        needsApproval ? approvalHint : busy ? "Working" : done ? "Done" : time
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
      <div ref={rowRef} className="personal-task-row group relative">
        <div
          data-session-card={session.id}
          data-orchestration-card="true"
          data-needs-approval={needsApproval || undefined}
          data-session-selected={isSelected ? "true" : undefined}
          aria-current={isActive ? "true" : undefined}
          className={`personal-task-card relative border rounded-md text-left ${dragging ? "opacity-40" : ""} ${
            isSelected
              ? "bg-content/12 text-content border-transparent"
              : needsApproval
                ? "bg-content/20 text-content border-content/30 border-dashed"
                : isActive
                  ? "bg-(--aven-selected) text-content border-transparent"
                  : "text-content/80 hover:bg-(--aven-hover) border-transparent"
          }`}
        >
          {dropTarget ? (
            <span
              aria-hidden
              data-session-insert={dropEdge}
              className={`pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-content/60 ${dropEdge === "after" ? "bottom-0" : "top-0"}`}
            />
          ) : null}
          <button
            type="button"
            data-session-select
            data-tauri-drag-region="false"
            aria-current={isActive ? "true" : undefined}
            aria-pressed={isSelected}
            title={`${title}\n${model}${gitLabel ? ` · ${gitLabel}` : ""}`}
            className="flex w-full touch-none flex-col gap-1 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-(--aven-focus-ring)"
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
              <span className="min-w-0 flex-1 truncate text-ui-micro text-content/55">
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
            endedAt={session.updatedAt}
            now={now}
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
      ref={rowRef}
      className="personal-task-row group relative"
      data-has-archive={!!onArchive}
      data-compact={compact || undefined}
    >
      <button
        type="button"
        title={`${title}\n${resolveModel(session.harness, session.model).name}${gitLabel ? ` · ${gitLabel}` : ""}`}
        aria-current={isActive ? "true" : undefined}
        aria-pressed={isSelected}
        data-session-card={session.id}
        data-discussion-row={talk ? session.id : undefined}
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
              ? "bg-content/12 text-content border-transparent"
              : needsApproval
                ? "bg-content/20 text-content border-content/30 border-dashed"
                : isActive
                  ? "bg-(--aven-selected) text-content border-transparent"
                  : "text-content/80 hover:bg-(--aven-hover) hover:text-content border-transparent"
        }`}
      >
        {dropTarget ? (
          dropEdge ? (
            <span
              data-session-insert={dropEdge}
              aria-hidden
              className={`pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-content/60 ${
                dropEdge === "before" ? "top-0" : "bottom-0"
              }`}
            />
          ) : (
            <div className="pointer-events-none absolute inset-0 rounded-md bg-content/10" />
          )
        ) : null}
        {compact ? null : (
          <span className="relative flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {talk ? (
                <DiscussionTalkMark
                  harness={session.harness}
                  talk={talk}
                  className="size-3.5"
                />
              ) : (
                <HarnessIcon
                  harness={session.harness}
                  className="size-3.5 shrink-0"
                />
              )}
              <span className="min-w-0 truncate text-ui-caption text-content/50">
                {model}
              </span>
            </span>
            {status}
          </span>
        )}
        <span
          className={`relative flex min-w-0 items-center ${
            compact ? "gap-2" : "mt-1 gap-1.5"
          }`}
        >
          {talk && compact ? (
            <span className="personal-task-lead">
              <DiscussionTalkMark harness={session.harness} talk={talk} />
            </span>
          ) : session.pinned ? (
            <span className="personal-task-lead">
              <Pin
                className="size-3 shrink-0 text-content/45"
                strokeWidth={1.75}
              />
            </span>
          ) : compact ? (
            <span className="personal-task-lead">
              <HarnessIcon
                harness={session.harness}
                className="size-3 shrink-0 opacity-60"
              />
            </span>
          ) : null}
          <span className="personal-task-title min-w-0 flex-1 line-clamp-1 text-ui-body font-semibold leading-snug text-content">
            {title}
          </span>
          {talk && !talkLinked ? <DiscussionTalkBadge talk={talk} /> : null}
          {teams?.map((team) => (
            <SidebarTeamBadge key={team.id} team={team} />
          ))}
          <WorkConflictMark conflict={conflict} />
          {compact ? status : null}
        </span>
        {compact ? null : (
          <span className="personal-task-meta relative mt-1 flex items-center gap-2">
            {gitLabel ? (
              <span className="flex min-w-0 flex-1 items-center gap-1 text-ui-caption text-content/45">
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
        className="aven-field w-full px-2 py-1 text-ui-body font-semibold leading-snug"
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

/** A race as one sidebar row: its lanes' mascots and how far it is. */
function SidebarTeamBadge({ team }: { team: SidebarTeam }) {
  return (
    <span
      className="sidebar-team-badge"
      data-sidebar-team={team.id}
      data-needs-you={team.needsYou || undefined}
      title={`${team.status} · ${teamAgentsText(team)}`}
    >
      <TeamMiniFaces members={team.members} active={team.working > 0} />
      <span className="sidebar-team-badge-text">
        {team.status.replace(/^Racing · /, "")}
      </span>
    </span>
  );
}
