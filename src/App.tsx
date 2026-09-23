import { discardEditorDrafts } from "./lib/workspaceTransfers";
import { useFixedDeadline } from "./hooks/useFixedDeadline";
import { useReturnFocus } from "./hooks/useReturnFocus";
import { indentFocusedEditor } from "./surfaces/editorShortcuts";
import { useAccountUsageProviders } from "./hooks/useAccountUsageProviders";
import { useAutomaticModelCatalogs } from "./hooks/useAutomaticModelCatalogs";
import {
  installAgentBrowserHost,
  prepareAgentBrowserPrompt,
  refreshAgentBrowserScopes,
} from "./lib/agentBrowser";
import { invoke } from "@tauri-apps/api/core";
import { openAgentFileInTabs } from "./lib/agentFiles";
import { orchestrator, type ControlOutcome } from "./lib/orchestration";
import { submitManagedTurn } from "./lib/managedSubmission";
import { steerManagedTurn } from "./lib/managedSteering";
import {
  orchestrationMoveError,
  orchestrationOwnsTurn,
} from "./lib/workspaceOrchestration";
import {
  completeOrchestrationProposal,
  orchestrationPlanningPrompt,
  proposalBlock,
  validateOrchestrationSettings,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "./lib/orchestrationPlan";
import {
  discoverOrchestrationSettings,
  orchestrationWorkerChoices,
} from "./lib/orchestrationCatalog";
import {
  attachOrchestrationWorkers,
  consolidateOrchestrationTabs,
  prepareOrchestrationWorkerDetails,
  releaseOrchestrationWorker,
} from "./lib/orchestrationWorkspace";
import {
  OrchestrationActions,
  OrchestrationWorkers,
  type OrchestrationWorkerDetail,
} from "./chrome/OrchestrationActions";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { PersonalInspectorDock } from "./chrome/PersonalInspectorDock";
import { WorkspaceHome } from "./surfaces/WorkspaceHome";
import { useHoverRevealPanel } from "./hooks/useHoverRevealPanel";
import { useWorkspaceSnapshotPersistence } from "./hooks/useWorkspaceSnapshotPersistence";
import { Sidebar } from "./chrome/Sidebar";
import type { WorkspaceProfilePreviewData } from "./chrome/ProfileCarouselPreview";
import { projectDisplayName } from "./hooks/useProjectLabels";
import { loadTabGroupLabels } from "./lib/tabGroups";
import { SESSION_LIST_PAGE } from "./lib/sessionListWindow";
import {
  WorkspaceBrowserSurface,
  type BrowserSurfaceActions,
} from "./surfaces/WorkspaceBrowserSurface";
import {
  WorkspaceStage,
  workspaceSurfaceDropAt,
  type WorkspaceSurfaceDropTarget,
} from "./surfaces/WorkspaceStage";
import {
  useWorkspaceViews,
  selectWorkspaceView,
  splitWorkspaceView,
  closeWorkspaceViews,
  moveWorkspaceTab,
  reorderWorkspaceGroup,
  collapseWorkspaceView,
  combineWorkspaceGroups,
  toggleWorkspaceExpansion,
  resolveWorkspaceView,
  type WorkspaceView,
} from "./lib/workspaceViews";
import {
  nativeSessionPip,
  useSessionPictureInPicture,
} from "./lib/sessionPictureInPicture";
import {
  useBrowserPipRequests,
  createWorkspacePipReturns,
} from "./lib/workspacePictureInPicture";
import {
  selectWorkspaceArrangement,
  captureWorkspaceReturnPlacement,
  restoreWorkspaceArrangement,
  moveWorkspaceGroup,
} from "./lib/workspaceArrangement";
import {
  loadWorkspaceRecovery,
  saveWorkspaceRecovery,
  pushClosedWorkspaceEntry,
  peekClosedWorkspaceEntry,
  popClosedWorkspaceEntry,
  pushWorkspaceLayoutUndo,
  popWorkspaceLayoutUndo,
  prepareRecoveredWorkspaceTab,
  type ClosedWorkspaceEntry,
} from "./lib/workspaceRecovery";
import { flushSync } from "react-dom";
import {
  useDetachedWorkspaces,
  nativeWorkspaceWindow,
  type DetachedWorkspaceState,
  type WorkspaceDropPoint,
} from "./lib/detachedWorkspaces";
import { flushWorkspaceDrafts } from "./lib/workspaceDraftFlush";
import { useWorkspaceHeaderKeys } from "./hooks/useWorkspaceHeaderKeys";
import { requestAddToChat } from "./lib/quoteDraft";
import {
  ensureProjectlessWorkspace,
  isProjectlessCwd,
  projectlessCwdForProfile,
  projectlessProfileForCwd,
} from "./lib/projectlessWorkspace";
import {
  EMPTY_BROWSER,
  loadPersonalInspector,
  savePersonalInspector,
  loadPersonalSidebar,
  savePersonalSidebar,
  loadBrowserWorkspaces,
  saveBrowserWorkspaces,
  normalizeBrowserWorkspace,
  addBrowserTab,
  selectBrowserTab,
  closeBrowserTab,
  updateBrowserTab,
  browserIdForTab,
  patchBrowserWorkspace,
} from "./lib/personalWorkspace";
import {
  loadDefaultRuntimeMode,
  saveDefaultRuntimeMode,
} from "./lib/runtimeMode";
import { ApprovalToasts } from "./chrome/ApprovalToasts";
import { WhatsNewDialog } from "./chrome/WhatsNewDialog";
import { TitleBar, type Tab as TitleTab } from "./chrome/TitleBar";
import { MenuBar } from "./chrome/MenuBar";
import { FilePicker } from "./chrome/FilePicker";
import {
  hasWorkspaceOverlay,
  workspaceShortcutDisposition,
} from "./lib/workspaceKeyboard";
import {
  WorkspaceStatusBar,
  type WorkspaceStatusAction,
} from "./chrome/WorkspaceStatusBar";
import { WorkspaceFooter } from "./chrome/WorkspaceFooter";
import {
  WorkspaceActionDialog,
  type WorkspaceActionKind,
} from "./chrome/WorkspaceActionDialog";
import { BranchPicker } from "./chrome/BranchPicker";
import { Popover } from "./chrome/Popover";
import { FolderPlus, ArrowDownCircle, Folder } from "./chrome/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { installInAppLinks } from "./lib/inAppLinks";
import { normalizeBrowserUrl } from "./lib/browser";
import {
  useWorkspaceProfiles,
  loadWorkspaceProfiles,
  projectWorkspaceProfile,
  restoreProfileWorkspace,
} from "./lib/workspaceProfiles";
import { loadRunScripts, saveRunScripts } from "./lib/workspaceActions";
import { useProjectBranches } from "./hooks/useProjectBranches";
import { type SidebarTabId } from "./lib/appearance";
import { IS_MAC } from "./lib/platform";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  uiScaleCommand,
  zoomInUiScale,
  zoomOutUiScale,
} from "./lib/uiScale";
import { runUpdateFlow } from "./lib/updater";
import { displayAttachments, prepareAttachments } from "./lib/attachments";
import {
  basename,
  revealPath,
  notifyGitChanged,
  pickFolder,
  restoreSessionCheckout,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "./lib/fs";
import {
  invalidateProjectFiles,
  rememberOpenedFile,
  resolveOpenablePath,
} from "./lib/fileIndex";
import {
  closeLeaf,
  findSurfacePane,
  firstLeafId,
  focusedFileTab,
  isolateTerminalPanes,
  isFilesystemTab,
  isCommitTab,
  isTerminalTab,
  leaf,
  leafIds,
  movePane,
  neighborLeafId,
  newFileTab,
  newPlanTab,
  newTab,
  newTerminalFile,
  newTerminalWorkspaceTab,
  nextTerminalTitle,
  openChangesTab,
  openCommitTab,
  newAgentTab,
  openEditorTab,
  openSessionChangesTab,
  openTerminalTab,
  removePane,
  replaceLeafId,
  setSplitRatio,
  siblingLeafId,
  splitPane,
  surfacePanes,
  updateTerminalTab,
  withSurfacePanes,
  type EditorPane,
  type FilePaneTab,
  type FocusDir,
  type PaneEdge,
  type SplitDir,
  type WorkspaceTab,
} from "./lib/layout";
import { releaseNotesForVersion, releaseNotesTitle } from "./lib/releaseNotes";
import { mergeOrderedSubset, orderByIds } from "./lib/reorder";
import {
  addTerminalToDock,
  applyDockGridStyle,
  closeTerminalInDock,
  createProjectTerminal,
  findProjectTerminal,
  mapProjectTerminal,
  nextDockTerminalTitle,
  patchProjectTerminals,
  reorderDockTerminals,
  selectDockTerminal,
  withDockOpen,
  withDockSide,
  withDockSize,
  type DockSide,
  type ProjectTerminalDock as ProjectTerminal,
} from "./lib/projectTerminal";
import {
  applyGroupedReorder,
  insertTabBesideActive,
  removeTabFromGroup,
  tabGroupProject,
} from "./lib/tabGroups";
import { type WindowTransferPayload } from "./lib/windowTransfer";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "./lib/terminalClose";
import { terminalTabLabel, type TerminalMetaPatch } from "./lib/terminalTab";
import {
  applyHarnessEvent,
  appendUser,
  appendSteerUser,
  bindHarnessSession,
  cancelHarnessTurn,
  canCompactHarnessContext,
  compactHarnessContext,
  forgetHarnessSession,
  canSteerHarness,
  stopHarnessSession,
  generateHarnessTitle,
  isLiveHarness,
  probeHarnessAvailability,
  refreshHarnessCatalogs,
  registerBuiltinHarnesses,
  promoteLastAssistantToPlan,
  respondHarnessApproval,
  respondHarnessQuestion,
  sendHarnessTurn,
  steerHarnessTurn,
  startHarnessBridge,
  stopStreaming,
  pickTextHarness,
  type ApprovalDecision,
  type HarnessEvent,
  type UserQuestionReply,
} from "./lib/harness";
import {
  appendPreparingHandoff,
  buildDeterministicHandoff,
  buildHandoffComposerCard,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  HANDOFF_TITLE,
  handoffTurnCard,
  isPreparingHandoff,
  pendingHandoff,
  planComposerSwitch,
  sessionChildHarnesses,
  sessionThroughTurn,
  shouldAskOutgoingAgent,
  type HandoffComposerCard,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "./lib/handoff";
import { requestOutgoingHandoff } from "./lib/handoffTurn";
import { appendSteerFailure } from "./lib/sessionSteerFailure";
import { isEditTool } from "./lib/harness/preview";
import {
  beginSessionTurn,
  captureSessionCheckpoint,
  flushSessionCheckpoint,
  keepSessionChanges,
  notifyReviewChanged,
  prepareSessionCheckpoint,
} from "./lib/checkpoint";
import { notifyDirsChanged } from "./lib/fileTree";
import { invalidateWatchedFiles, nudgeWatchedFiles } from "./lib/fileWatch";
import {
  type EditorNavigation,
  type EditorNavigationTarget,
  type OpenFileFn,
} from "./lib/search";
import {
  mergeModelSettings,
  preferredModelSettings,
  resolveModel,
  saveLastModelSettings,
} from "./lib/models";
import {
  buildPlanPrompt,
  isProviderFailureText,
  planTitle,
  planTurnPrompt,
} from "./lib/plan";
import {
  displayPath,
  isEqualOrInside,
  projectName,
  rebasePath,
  resolveWorkspacePath,
} from "./lib/paths";
import { removeProjectData } from "./lib/projectData";
import {
  archiveProject,
  forgetProject,
  lastProjectPath,
  loadRecents,
  looksLikeProject,
  normalizeProjectPath,
  projectRailItems,
  rememberProject,
  sameProjectPath,
} from "./lib/recents";
import {
  applyPlaceSessionOnPane,
  filterTabsForProject,
  findTabForProject,
  loadProjectFocusedTabs,
  saveProjectFocusedTabs,
  planWorkspaceTabClose,
  workspaceTabCwd,
} from "./lib/workspaceTabGroups";
import { runSessionRemoval } from "./lib/sessionRemoval";
import { resolvePaneCloseTab } from "./lib/sessionPaneClose";
import { sessionModelIdentity } from "./lib/sessionLabels";
import {
  HARNESS_LABEL,
  HARNESS_TITLE,
  canReplaceSessionTitle,
  formatSessionTitle,
  sessionNeedsInput,
  newDefaultSession,
  newSession,
  newSplitSession,
  sessionDisplayTitle,
  sessionWorkCwd,
  titleFromPrompt,
  type Attachment,
  type Block,
  type HarnessId,
  type PlanBuildTarget,
  type RuntimeMode,
  type PlanStatus,
  type SecondOpinionMeta,
  type Session,
  type TurnIntent,
} from "./lib/session";

import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  shouldEnqueueSubmission,
} from "./lib/messageQueue";
import { dropContextWindow } from "./lib/contextUsage";
import {
  deleteSession,
  getSession,
  listSessionsByProject,
  persistFingerprint,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  setSessionArchived,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "./lib/sessionStore";
import { syncDockBadge } from "./lib/dockBadge";
import { liveAgentsFromSessions } from "./lib/liveAgents";
import { hiddenApprovalNotices } from "./lib/approvalToast";
import {
  useActivity,
  markSessionActivityRead,
  reconcileSessionActivityInputs,
  isPendingActivity,
} from "./lib/activity";
import { visibleActivitySessionIds } from "./lib/activityVisibility";
import {
  loadNotificationsEnabled,
  NOTIFICATION_CLICK_EVENT,
  publishSessionActivity,
  pendingSessionActivityEvents,
  sessionTurnActivityId,
  type SessionActivityEvent,
  probeNotificationPermission,
  setWindowFocused,
} from "./lib/notifications";
import { playCue } from "./lib/sounds";
import { archiveFocusedSession } from "./lib/archiveShortcut";
import {
  adjacentItemId,
  deferUnhandledEscape,
  focusedBusyAgentSessionId,
  shouldHandleListNavigation,
  shouldStopFocusedTurnOnEscape,
  tabCommand,
} from "./lib/tabKeys";
import {
  createWorkspaceNavigation,
  locationKey,
  recordWorkspaceLocation,
  visitWorkspaceLocation,
  type WorkspaceLocation,
  type WorkspaceNavigation,
} from "./lib/workspaceNavigation";
import { preparePrompt } from "./lib/promptPreparation";
import { warmNativeSkills, isNativeCommandPrompt } from "./lib/skills";
import { nativeSkillContextForSession } from "./lib/sessionSkills";
import {
  ADD_NOTE_TO_CHAT_EVENT,
  composeNoteMessage,
  noteCardMeta,
  type NoteComposerCard,
} from "./lib/notes";
import {
  SECOND_OPINION_TITLE,
  buildSecondOpinionCard,
  buildSecondOpinionPrompt,
  harnessForTurn,
  turnEditedFiles,
  turnReport,
  turnUserRequest,
} from "./lib/secondOpinion";
import { PaneTree } from "./surfaces/PaneTree";
import { SessionPane } from "./surfaces/SessionPane";
import { SessionSurface } from "./surfaces/SessionSurface";
import { ProjectTerminalDock } from "./surfaces/ProjectTerminalDock";
import { SearchView } from "./surfaces/SearchView";
import { SettingsView } from "./surfaces/SettingsView";
import { InboxView } from "./surfaces/InboxView";
import type { InboxSessionPortal } from "./surfaces/InboxDiscussionPanel";
import { inboxAskKey, inboxAskPrompt } from "./lib/inboxAsk";
import { NotesView } from "./surfaces/NotesView";
import { inboxComposerCard, type InboxItem } from "./lib/githubTasks";
import { linearIssueDetails, peekLinearIssueDetails } from "./lib/linear";
import {
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadDiffViewer,
  loadFollowUpBehavior,
  loadSettingsSection,
  saveSettingsSection,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
  type SettingsSectionId,
  type FollowUpBehavior,
} from "./lib/settings";
import {
  handleEditorFindKey,
  openFindInActiveEditor,
} from "./surfaces/editorSearch";

import {
  mergeHistorySummary,
  mergeProjectHistorySummary,
  replaceProjectHistory,
  historyWithLiveSessions,
  summaryFromSession,
} from "./lib/sessionHistory";
import {
  CONTINUE_PROMPT,
  canAutoContinue,
  inFlightRefs,
  inFlightSnapshotKey,
  shouldWriteInFlightSnapshot,
} from "./lib/inFlight";
import { collectWorkspaceSnapshot } from "./lib/workspaceSnapshot";
import { subscribeComposerDrafts } from "./lib/composerDrafts";
import type { InstalledUpdate } from "./lib/updateNotice";
import {
  bindResumedSessions,
  closeBusyWindow,
  hasInFlightSessions,
  hideCurrentWindow,
  closeCurrentWindow,
  isAppQuitting,
  persistLiveTranscripts,
  persistQuitState,
  reapWindowRuntime,
  setQuitWorkspace,
  type ResumedWorkspace,
} from "./lib/appLifecycle";

function withPlanStatus(
  session: Session,
  blockId: string,
  status: PlanStatus,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === blockId && block.role === "plan"
        ? {
            ...block,
            plan: { ...(block.plan ?? { status: "ready" }), status },
          }
        : block,
    ),
  };
}

function lastAssistantTextInTurn(session: Session): string {
  for (let index = session.blocks.length - 1; index >= 0; index -= 1) {
    const block = session.blocks[index];
    if (block.role === "user") return "";
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

type ScheduledFlush = { kind: "raf" | "timeout"; id: number };

function cancelScheduledFlush(handle: ScheduledFlush | null) {
  if (!handle) return;
  if (handle.kind === "raf") cancelAnimationFrame(handle.id);
  else clearTimeout(handle.id);
}

function scheduleHarnessFlush(run: () => void): ScheduledFlush {
  if (document.hidden) {
    return { kind: "timeout", id: window.setTimeout(run, 32) };
  }
  return { kind: "raf", id: requestAnimationFrame(run) };
}

function userTurnCards(
  noteCard: NoteComposerCard | undefined,
  secondOpinion?: SecondOpinionMeta,
) {
  if (!noteCard && !secondOpinion) return undefined;
  return {
    ...(secondOpinion ? { secondOpinion } : {}),
    ...(noteCard ? { noteCard: noteCardMeta(noteCard) } : {}),
  };
}

function withHarnessChoice(
  session: Session,
  harness: HarnessId,
  model: string,
  modelSettings: Record<string, string>,
): Session {
  return {
    ...session,
    harness,
    model,
    modelSettings,
    title:
      session.blocks.length === 0
        ? HARNESS_LABEL[harness]
        : formatSessionTitle(
            harness,
            sessionDisplayTitle(session.title, session.harness),
          ),
    ...(session.model === model
      ? {}
      : { context: dropContextWindow(session.context) }),
    ...(session.harness === harness ? {} : { providerSessionId: undefined }),
  };
}

function withPlanBuildTarget(
  session: Session,
  target: PlanBuildTarget,
): Session {
  const resolved = resolveModel(target.harness, target.model);
  const modelSettings = preferredModelSettings(resolved, session.modelSettings);
  const plan = planComposerSwitch(session, target.harness);
  const next = withHarnessChoice(
    session,
    target.harness,
    resolved.id,
    modelSettings,
  );

  if (plan.kind === "arm") {
    return { ...next, pendingSwitch: plan.pending };
  }
  if (plan.kind === "revert") {
    return {
      ...next,
      pendingSwitch: undefined,
      ...(plan.restoreProviderSessionId
        ? { providerSessionId: plan.restoreProviderSessionId }
        : { providerSessionId: undefined }),
    };
  }
  if (plan.kind === "empty") {
    return { ...next, pendingSwitch: undefined };
  }
  return next;
}

function openSessionIds(tabs: WorkspaceTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) {
    for (const id of leafIds(tab.layout)) ids.add(id);
  }
  return ids;
}

function filesInWorkspaceTabs(tabs: readonly WorkspaceTab[]): FilePaneTab[] {
  return tabs.flatMap((tab) => [
    ...tab.editorPanes.flatMap((pane) => pane.files),
    ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
  ]);
}

/** Native sheet. `window.confirm` is swallowed when a macOS menu accelerator fires. */
function confirmDiscardUnsaved(message: string): Promise<boolean> {
  return ask(message, { title: "Aven", kind: "warning" });
}

function titleTabsEqual(a: TitleTab[], b: TitleTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tab, index) => {
    const other = b[index];
    return (
      other != null &&
      tab.id === other.id &&
      tab.project === other.project &&
      tab.projectPath === other.projectPath &&
      tab.title === other.title &&
      tab.sessionCount === other.sessionCount &&
      (tab.models?.length ?? 0) === (other.models?.length ?? 0) &&
      (tab.models ?? []).every(
        (model, index) =>
          model.harness === other.models?.[index]?.harness &&
          model.model === other.models?.[index]?.model &&
          model.selected === other.models?.[index]?.selected,
      ) &&
      tab.dirty === other.dirty &&
      tab.more.join("\u0000") === other.more.join("\u0000") &&
      tab.harnesses.join("\u0000") === other.harnesses.join("\u0000") &&
      tab.busyHarnesses.join("\u0000") === other.busyHarnesses.join("\u0000") &&
      tab.files.join("\u0000") === other.files.join("\u0000") &&
      tab.multiPane === other.multiPane &&
      tab.fileFocused === other.fileFocused &&
      tab.blank === other.blank &&
      tab.terminal === other.terminal &&
      tab.groupId === other.groupId
    );
  });
}

// Register capabilities before composer hooks choose their discovery strategy.
registerBuiltinHarnesses();

export default function App({
  windowTransfer = null,
  resumed = null,
  installedUpdate = null,
  history: bootHistory = [],
  historyCwd: bootHistoryCwd = null,
}: {
  windowTransfer?: WindowTransferPayload | null;
  resumed?: ResumedWorkspace | null;
  installedUpdate?: InstalledUpdate | null;
  history?: SessionSummary[];
  historyCwd?: string | null;
}) {
  const [projectCwd, setProjectCwd] = useState(
    () =>
      windowTransfer?.projectCwd ??
      resumed?.projectCwd ??
      lastProjectPath() ??
      "~",
  );
  const [recents, setRecents] = useState(() =>
    resumed?.projectCwd && looksLikeProject(resumed.projectCwd)
      ? rememberProject(resumed.projectCwd)
      : loadRecents(),
  );
  const [seed] = useState(() => {
    const cwd = lastProjectPath() ?? "~";
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  const [sessions, setSessions] = useState<Session[]>(
    () => windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session],
  );
  const [tabs, setTabs] = useState<WorkspaceTab[]>(
    () => windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab],
  );
  const [projectTerminals, setProjectTerminals] = useState<ProjectTerminal[]>(
    () => windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
  );
  const [projectTerminalFocused, setProjectTerminalFocused] = useState(false);
  const [activeTabId, setActiveTabId] = useState(
    () => windowTransfer?.activeTabId ?? resumed?.activeTabId ?? seed.tab.id,
  );
  const [restoredProjectTabs] = useState(loadProjectFocusedTabs);
  const lastTabByProjectRef = useRef(restoredProjectTabs);
  const [composerFocused, setComposerFocused] = useState(() => {
    if (windowTransfer) return true;
    if (!resumed) return false;
    const tab =
      resumed.tabs.find((entry) => entry.id === resumed.activeTabId) ??
      resumed.tabs[0];
    return (
      !!tab && resumed.sessions.some((session) => session.id === tab.focusedId)
    );
  });
  /** Tab id -> project name, kept in sync with the rendered title tabs. */
  const tabProjectsRef = useRef(new Map<string, string>());
  const projectOfTab = useCallback(
    (id: string) => tabProjectsRef.current.get(id),
    [],
  );
  const profiles = useWorkspaceProfiles(recents, projectCwd);
  const [homeViewOpen, setHomeViewOpen] = useState(false);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const standaloneActive =
    projectlessProfileForCwd(projectCwd) === profiles.activeProfileId;
  const standaloneCwd = projectlessCwdForProfile(profiles.activeProfileId);
  const profileHome =
    !standaloneActive &&
    !profiles.profileProjects.some((project) =>
      sameProjectPath(project.path, projectCwd),
    );
  const [startingStandalone, setStartingStandalone] = useState(false);
  const startingStandaloneRef = useRef(false);
  const [workspaceAction, setWorkspaceAction] = useState<{
    kind: WorkspaceActionKind;
    cwd: string;
    profileId: string;
    profileName: string;
  } | null>(null);
  const [addProjectAnchor, setAddProjectAnchor] =
    useState<HTMLButtonElement | null>(null);
  const [branchAnchor, setBranchAnchor] = useState<HTMLButtonElement | null>(
    null,
  );
  const [prAnchor, setPrAnchor] = useState<HTMLButtonElement | null>(null);
  const [defaultAccess, setDefaultAccess] = useState(loadDefaultRuntimeMode);
  const openWorkspaceAction = useCallback((kind: WorkspaceActionKind) => {
    const current = profilesRef.current;
    setAddProjectAnchor(null);
    setPrAnchor(null);
    setWorkspaceAction({
      kind,
      cwd: projectCwdRef.current,
      profileId: current.activeProfileId,
      profileName: current.activeProfile.name,
    });
  }, []);
  const projectRailOpen = false;
  const [sidebarOpen, setSidebarOpen] = useState(loadPersonalSidebar);
  const [browserWorkspaces, setBrowserWorkspaces] = useState(
    loadBrowserWorkspaces,
  );
  const browserWorkspacesRef = useRef(browserWorkspaces);
  browserWorkspacesRef.current = browserWorkspaces;
  const [agentBrowserSurfaces, setAgentBrowserSurfaces] = useState<Set<string>>(
    () => new Set(),
  );
  const detachedBrowserBridge = useRef<
    (sessionId: string, url: string) => Promise<string | null>
  >(async () => null);
  const agentFileBridge = useRef<
    (
      sessionId: string,
      cwd: string,
      path: string,
      navigation?: EditorNavigation,
    ) => Promise<void>
  >(async () => {
    throw new Error("The file editor is still opening. Try again.");
  });
  const detachedFileBridge = useRef<
    (
      sessionId: string,
      path: string,
      navigation?: EditorNavigation,
    ) => Promise<boolean>
  >(async () => false);
  const detachedShowSurface = useRef<(surfaceId: string) => Promise<boolean>>(
    async () => false,
  );
  useEffect(
    () =>
      installAgentBrowserHost({
        openFile({ sessionId, cwd }, path, navigation) {
          return agentFileBridge.current(sessionId, cwd, path, navigation);
        },
        surfaces({ sessionId, cwd }) {
          const session = sessionsRef.current.find(
            (item) => item.id === sessionId,
          );
          if (!session || !sameProjectPath(sessionWorkCwd(session), cwd))
            return null;
          const workspace = normalizeBrowserWorkspace(
            browserWorkspacesRef.current[session.cwd] ?? EMPTY_BROWSER,
          );
          return workspace.open
            ? workspace.tabs.map((tab) => browserIdForTab(session.cwd, tab.id))
            : [];
        },
        async open({ sessionId, cwd }, url) {
          const session = sessionsRef.current.find(
            (item) => item.id === sessionId,
          );
          if (!session || !sameProjectPath(sessionWorkCwd(session), cwd))
            throw new Error("The task is no longer available.");
          const detachedSurface = await detachedBrowserBridge.current(
            sessionId,
            url,
          );
          if (detachedSurface) return detachedSurface;
          const project = session.cwd;
          const id = crypto.randomUUID();
          const surfaceId = browserIdForTab(project, id);
          setAgentBrowserSurfaces(
            (current) => new Set([...current, surfaceId]),
          );
          setBrowserWorkspaces((all) => ({
            ...all,
            [project]: addBrowserTab(
              { ...(all[project] ?? EMPTY_BROWSER), mode: "tab" },
              { id, url },
            ),
          }));
          // Show a requested page in the active project without switching profiles.
          if (sameProjectPath(projectCwdRef.current, project))
            viewRef.current.focus(project, surfaceId);
          return surfaceId;
        },
      }),
    [],
  );
  const agentBrowserSessionKeys = sessions
    .map((session) => `${session.id}:${session.cwd}:${sessionWorkCwd(session)}`)
    .join("\n");
  useEffect(() => {
    void refreshAgentBrowserScopes();
  }, [browserWorkspaces, agentBrowserSessionKeys]);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set());
  const detachedIdsRef = useRef(detachedIds);
  detachedIdsRef.current = detachedIds;
  const moveWindowRef = useRef<
    (
      ids: string[],
      target?: string,
      point?: WorkspaceDropPoint,
    ) => Promise<string | undefined>
  >(async () => undefined);
  const deckProjectTabs = useMemo(() => {
    // A projectless session belongs to no project, so it stands on its own
    // rather than trailing the last project's tabs.
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (
      active &&
      !workspaceTabCwd(active, sessions) &&
      !detachedIds.has(active.id)
    )
      return [active];
    return filterTabsForProject(tabs, sessions, projectCwd).filter(
      (tab) => !detachedIds.has(tab.id),
    );
  }, [activeTabId, tabs, sessions, projectCwd, detachedIds]);
  const browserState = normalizeBrowserWorkspace(
    browserWorkspaces[projectCwd] ?? EMPTY_BROWSER,
  );
  const browserSurfaces = browserState.open
    ? browserState.tabs
        .map((tab) => ({
          ...tab,
          surfaceId: browserIdForTab(projectCwd, tab.id),
        }))
        .filter((tab) => !detachedIds.has(tab.surfaceId))
    : [];
  const requestedBrowserFocus =
    browserState.open && browserState.expanded && browserState.activeTabId
      ? browserIdForTab(projectCwd, browserState.activeTabId)
      : "";
  const fallbackSurface = requestedBrowserFocus || activeTabId;
  const initialBrowserSplit =
    browserState.open && browserState.mode === "split" && browserSurfaces[0]
      ? {
          type: "split" as const,
          id: "initial-browser-split",
          dir: "right" as const,
          children: [
            leaf(activeTabId),
            leaf(
              browserIdForTab(
                projectCwd,
                browserState.activeTabId ?? browserSurfaces[0].id,
              ),
            ),
          ],
          sizes: [1 - browserState.ratio, browserState.ratio],
        }
      : undefined;
  const workspaceViews = useWorkspaceViews(
    projectCwd,
    [
      ...deckProjectTabs.map((tab) => tab.id),
      ...browserSurfaces.map((tab) => tab.surfaceId),
    ],
    fallbackSurface,
    initialBrowserSplit,
  );
  const view = workspaceViews.view;
  const workspaceHeaderKeys = useWorkspaceHeaderKeys(projectCwd, view.groups);
  const viewRef = useRef(workspaceViews);
  viewRef.current = workspaceViews;
  const [recovery, setRecovery] = useState(loadWorkspaceRecovery);
  const recoveryRef = useRef(recovery);
  recoveryRef.current = recovery;
  const rememberClosed = useCallback((entry: ClosedWorkspaceEntry) => {
    const next = pushClosedWorkspaceEntry(recoveryRef.current, entry);
    recoveryRef.current = next;
    setRecovery(next);
  }, []);
  useEffect(() => {
    saveWorkspaceRecovery(recovery);
  }, [recovery]);
  const changeLayout = useCallback(
    (update: (value: WorkspaceView) => WorkspaceView) => {
      const before = viewRef.current.view;
      const after = update(before);
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      const next = pushWorkspaceLayoutUndo(
        recoveryRef.current,
        projectCwdRef.current,
        before,
      );
      recoveryRef.current = next;
      setRecovery(next);
      viewRef.current.change(() => after);
    },
    [],
  );
  const onUndoLayout = useCallback(() => {
    const current = viewRef.current.view;
    const result = popWorkspaceLayoutUndo(
      recoveryRef.current,
      projectCwdRef.current,
      current.order,
      current.focusedId,
    );
    if (!result.view) return;
    recoveryRef.current = result.state;
    setRecovery(result.state);
    const restored = result.view;
    viewRef.current.change(() => restored);
  }, []);
  const visibleSurfaceIds = view.layout ? leafIds(view.layout) : [];
  const browserFocused = browserSurfaces.some(
    (tab) => tab.surfaceId === view.focusedId,
  );
  useLayoutEffect(() => {
    const page = browserSurfaces.find(
      (tab) => tab.surfaceId === view.focusedId,
    );
    if (page) {
      setComposerFocused(false);
      setBrowserWorkspaces((all) => {
        const current = all[projectCwd];
        if (!current || (current.activeTabId === page.id && current.expanded))
          return all;
        return {
          ...all,
          [projectCwd]: {
            ...selectBrowserTab(current, page.id),
            expanded: true,
          },
        };
      });
    } else if (deckProjectTabs.some((tab) => tab.id === view.focusedId)) {
      setActiveTabId(view.focusedId);
      setBrowserWorkspaces((all) => {
        const current = all[projectCwd];
        return current?.expanded
          ? { ...all, [projectCwd]: { ...current, expanded: false } }
          : all;
      });
    }
    // Focus is the authority here. Browser navigation and session updates must
    // not pull focus away from a sibling surface that the user is reading.
  }, [view.focusedId, projectCwd]);
  const browserPip = useBrowserPipRequests();
  const browserPipRequests = browserPip.requests;
  const groupPipReturns = useMemo(createWorkspacePipReturns, []);
  useEffect(() => {
    let disposed = false;
    const listener = nativeSessionPip
      .listen<{
        selectedLabel: string;
        labels: string[];
      }>("pip-group-returned", ({ selectedLabel, labels }) => {
        if (!disposed) groupPipReturns.complete(selectedLabel, labels);
      })
      .catch(() => () => {});
    const errors = nativeSessionPip
      .listen<{ message: string }>("pip-group-error", (event) => {
        if (!disposed && typeof event.message === "string")
          void message(event.message, {
            title: "Picture in Picture",
            kind: "error",
          });
      })
      .catch(() => () => {});
    return () => {
      disposed = true;
      void Promise.all([listener, errors]).then((stops) =>
        stops.forEach((stop) => stop()),
      );
    };
  }, [groupPipReturns]);
  const [surfaceDragging, setSurfaceDragging] = useState(false);
  const [surfaceDrop, setSurfaceDrop] =
    useState<WorkspaceSurfaceDropTarget | null>(null);
  const surfaceDropRef = useRef<WorkspaceSurfaceDropTarget | null>(null);
  const [dragKind, setDragKind] = useState<"tab" | "group">("tab");
  const onDragMove = useCallback(
    (id: string, x: number, y: number, group = false) => {
      const stage = document.querySelector<HTMLElement>(
        "[data-workspace-stage]",
      );
      const members = group ? (viewRef.current.view.groups[id] ?? [id]) : [id];
      const target = stage
        ? workspaceSurfaceDropAt(
            stage,
            x,
            y,
            id,
            surfaceDropRef.current,
            members,
          )
        : null;
      surfaceDropRef.current = target;
      setSurfaceDragging(true);
      setDragKind(group ? "group" : "tab");
      setSurfaceDrop((previous) =>
        JSON.stringify(previous) === JSON.stringify(target) ? previous : target,
      );
    },
    [],
  );
  const onDragEnd = useCallback(
    (
      id: string,
      x: number,
      y: number,
      cancelled: boolean,
      point?: WorkspaceDropPoint,
      group = false,
    ) => {
      const stage = document.querySelector<HTMLElement>(
        "[data-workspace-stage]",
      );
      const members = group ? (viewRef.current.view.groups[id] ?? [id]) : [id];
      const target =
        !cancelled && stage
          ? workspaceSurfaceDropAt(
              stage,
              x,
              y,
              id,
              surfaceDropRef.current,
              members,
            )
          : null;
      surfaceDropRef.current = null;
      setSurfaceDragging(false);
      setSurfaceDrop(null);
      if (cancelled) return false;
      if (!target) {
        // Only leaving the window tears out. Empty space inside cancels safely.
        if (
          point &&
          (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
        ) {
          void moveWindowRef.current(members, undefined, point);
          return true;
        }
        return false;
      }
      changeLayout((value) =>
        group
          ? moveWorkspaceGroup(
              value,
              id,
              target.id,
              target.edge,
              target.edge === "tab" ? target.index : undefined,
            )
          : target.edge === "tab"
            ? moveWorkspaceTab(value, id, target.id, target.index)
            : splitWorkspaceView(value, id, target.edge, target.id),
      );
      return true;
    },
    [changeLayout],
  );
  const onSurfaceDragMove = useCallback(
    (id: string, x: number, y: number) => onDragMove(id, x, y),
    [onDragMove],
  );
  const onSurfaceDragEnd = useCallback(
    (
      id: string,
      x: number,
      y: number,
      cancelled: boolean,
      point?: WorkspaceDropPoint,
    ) => onDragEnd(id, x, y, cancelled, point),
    [onDragEnd],
  );
  const onGroupDragMove = useCallback(
    (id: string, x: number, y: number) => onDragMove(id, x, y, true),
    [onDragMove],
  );
  const onGroupDragEnd = useCallback(
    (
      id: string,
      x: number,
      y: number,
      cancelled: boolean,
      point?: WorkspaceDropPoint,
    ) => onDragEnd(id, x, y, cancelled, point, true),
    [onDragEnd],
  );
  const onNewBrowserTab = useCallback(() => {
    setHomeViewOpen(false);
    const id = crypto.randomUUID();
    setBrowserWorkspaces((all) => ({
      ...all,
      [projectCwd]: addBrowserTab(
        { ...(all[projectCwd] ?? EMPTY_BROWSER), mode: "tab" },
        { id, url: "" },
      ),
    }));
  }, [projectCwd]);
  const onSelectBrowserTab = useCallback(
    (surfaceId?: string) => {
      if (surfaceId && detachedIdsRef.current.has(surfaceId)) {
        void detachedShowSurface.current(surfaceId);
        return;
      }
      setHomeViewOpen(false);
      const current = browserState;
      const target =
        current.tabs.find(
          (tab) => browserIdForTab(projectCwd, tab.id) === surfaceId,
        ) ?? current.tabs.find((tab) => tab.id === current.activeTabId);
      if (!target) {
        onNewBrowserTab();
        return;
      }
      setBrowserWorkspaces((all) => {
        const current = all[projectCwd];
        if (current?.activeTabId === target.id && current.expanded) return all;
        return {
          ...all,
          [projectCwd]: {
            ...selectBrowserTab(current ?? EMPTY_BROWSER, target.id),
            expanded: true,
          },
        };
      });
      viewRef.current.change((view) =>
        selectWorkspaceView(view, browserIdForTab(projectCwd, target.id)),
      );
      setComposerFocused(false);
    },
    [browserState, projectCwd, onNewBrowserTab],
  );
  const onCloseBrowserTab = useCallback(
    (surfaceId?: string) => {
      const current = browserState;
      const target =
        current.tabs.find(
          (tab) => browserIdForTab(projectCwd, tab.id) === surfaceId,
        ) ?? current.tabs.find((tab) => tab.id === current.activeTabId);
      if (!target) return;
      rememberClosed({
        kind: "browser",
        cwd: projectCwd,
        closedAt: Date.now(),
        browser: target,
      });
      const nextView = closeWorkspaceViews(
        viewRef.current.view,
        [browserIdForTab(projectCwd, target.id)],
        activeTabIdRef.current,
      );
      viewRef.current.change(() => nextView);
      const focusedPage = current.tabs.find(
        (tab) => browserIdForTab(projectCwd, tab.id) === nextView.focusedId,
      );
      if (
        !focusedPage &&
        tabsRef.current.some((tab) => tab.id === nextView.focusedId)
      )
        setActiveTabId(nextView.focusedId);
      setBrowserWorkspaces((all) => {
        let next = closeBrowserTab(all[projectCwd] ?? EMPTY_BROWSER, target.id);
        if (focusedPage) next = selectBrowserTab(next, focusedPage.id);
        return { ...all, [projectCwd]: { ...next, expanded: !!focusedPage } };
      });
    },
    [projectCwd, browserState],
  );
  useEffect(() => {
    saveBrowserWorkspaces(browserWorkspaces);
  }, [browserWorkspaces]);
  const revealProjectTask = useCallback((cwd: string) => {
    setBrowserWorkspaces((all) => {
      const current = all[cwd];
      return current?.expanded
        ? { ...all, [cwd]: { ...current, expanded: false } }
        : all;
    });
  }, []);
  const tabCloseScope = "project" as const;
  const currentProjectDock = findProjectTerminal(projectTerminals, projectCwd);
  const dockVisible = !!currentProjectDock?.open;
  const [inspector, setInspector] = useState(loadPersonalInspector);
  const [sidebarTab, setSidebarTabValue] = useState<SidebarTabId>("sessions");
  // Existing file/search actions route into the independent right panel.
  const setSidebarTab = useCallback((tab: SidebarTabId) => {
    if (tab === "files" || tab === "changes") {
      setInspector((previous) => ({ ...previous, open: true, tab }));
    } else setSidebarTabValue(tab);
  }, []);
  const onInspectorTab = useCallback((tab: "files" | "changes") => {
    setInspector((previous) => ({ ...previous, tab }));
  }, []);
  const onInspectorWidth = useCallback((width: number) => {
    setInspector((previous) => ({ ...previous, width }));
  }, []);
  useEffect(() => {
    savePersonalInspector(inspector);
  }, [inspector]);
  const [filesSearchOpen, setFilesSearchOpen] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [searchViewOpen, setSearchViewOpen] = useState(false);
  const [searchViewFocusToken, setSearchViewFocusToken] = useState(0);
  const [inboxViewOpen, setInboxViewOpen] = useState(false);
  const [inboxAskPortal, setInboxAskPortal] =
    useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
  const [notesViewOpen, setNotesViewOpen] = useState(false);
  const [inspectedWorkerId, setInspectedWorkerId] = useState<string | null>(
    null,
  );
  // Set while the lead's tab is still opening; the agent tab lands on the
  // commit that brings it in.
  const [workerDetailRequest, setWorkerDetailRequest] = useState<{
    leadId: string;
    workers: OrchestrationWorkerDetail[];
  } | null>(null);
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspaceVisible =
    !profileHome &&
    !homeViewOpen &&
    view.order.length > 0 &&
    !settingsOpen &&
    !searchViewOpen &&
    !inboxViewOpen &&
    !notesViewOpen;
  const [workspaceToolbarHost, setWorkspaceToolbarHost] =
    useState<HTMLDivElement | null>(null);
  const unifiedWorkspaceTabs =
    workspaceVisible && visibleSurfaceIds.length === 1;
  const sidebarHover = useHoverRevealPanel({
    pinned: sidebarOpen,
    enterDelay: 45,
    leaveDelay: 0,
  });
  const inspectorVisible = workspaceVisible && inspector.open;
  useLayoutEffect(() => {
    // Publish the committed panel geometry before paint. Native browser children
    // can throttle WK animation frames, so ResizeObserver alone trails toggles.
    window.dispatchEvent(new Event("supermono:workspace-layout"));
  }, [sidebarOpen, sidebarHover.visible, inspector.open, inspectorVisible]);
  const onToggleInspector = useCallback(() => {
    setInspector((previous) => ({ ...previous, open: !previous.open }));
  }, []);
  const onCloseInspector = useCallback(() => {
    setInspector((previous) => ({ ...previous, open: false }));
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-inspector-toggle]")
        ?.focus(),
    );
  }, []);
  const browserExpanded = browserFocused;
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>(loadSettingsSection);
  const [editorNavigation, setEditorNavigation] =
    useState<EditorNavigationTarget | null>(null);
  const editorNavigationToken = useRef(0);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const { captureReturnFocus, restoreReturnFocus, clearReturnFocus } =
    useReturnFocus();
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(
    () => new Set(windowTransfer?.dirtyFileIds ?? []),
  );
  // Not carried across a window transfer the way dirty state is: the editor
  // re-lints whatever it mounts, so the counts rebuild themselves.
  const [fileErrorCounts, setFileErrorCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [history, setHistory] = useState<SessionSummary[]>(() => bootHistory);
  /**
   * Projects whose rows are already in `history`. This has to be state, not a
   * ref: `sidebarCwd` is derived during render, so the frame that first shows
   * a new project must already know the listing has not arrived yet.
   */
  const [loadedProjects, setLoadedProjects] = useState<ReadonlySet<string>>(
    () =>
      bootHistoryCwd
        ? new Set([normalizeProjectPath(bootHistoryCwd)])
        : new Set(),
  );
  const loadedProjectsRef = useRef(loadedProjects);
  loadedProjectsRef.current = loadedProjects;
  /** Project whose listing failed, so the error cannot leak to another one. */
  const [historyErrorCwd, setHistoryErrorCwd] = useState<string | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const queueDispatchingRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  const projectTerminalsRef = useRef(projectTerminals);
  projectTerminalsRef.current = projectTerminals;
  const projectTerminalFocusedRef = useRef(projectTerminalFocused);
  projectTerminalFocusedRef.current = projectTerminalFocused;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const projectCwdRef = useRef(projectCwd);
  projectCwdRef.current = projectCwd;
  useEffect(() => {
    const tab = tabsRef.current.find((entry) => entry.id === activeTabId);
    const cwd = tab ? workspaceTabCwd(tab, sessionsRef.current) : null;
    if (!cwd || !looksLikeProject(cwd)) return;
    const key = normalizeProjectPath(cwd);
    if (lastTabByProjectRef.current[key] === activeTabId) return;
    const next = { ...lastTabByProjectRef.current, [key]: activeTabId };
    lastTabByProjectRef.current = next;
    saveProjectFocusedTabs(next);
  }, [activeTabId, projectCwd]);
  const leaveExpandedPreview = useCallback(() => {
    setHomeViewOpen(false);
    setBrowserWorkspaces((all) => {
      const path = projectCwdRef.current;
      const current = all[path];
      return current?.expanded
        ? { ...all, [path]: { ...current, expanded: false } }
        : all;
    });
  }, []);
  const searchViewOpenRef = useRef(searchViewOpen);
  searchViewOpenRef.current = searchViewOpen;
  const inboxViewOpenRef = useRef(inboxViewOpen);
  inboxViewOpenRef.current = inboxViewOpen;
  const notesViewOpenRef = useRef(notesViewOpen);
  notesViewOpenRef.current = notesViewOpen;
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const filePickerOpenRef = useRef(filePickerOpen);
  filePickerOpenRef.current = filePickerOpen;
  const workspaceVisibleRef = useRef(workspaceVisible);
  workspaceVisibleRef.current = workspaceVisible;
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;

  useEffect(() => {
    if (!notesEnabled) setNotesViewOpen(false);
  }, [notesEnabled]);

  const navigationHistory = useRef<WorkspaceNavigation | null>(null);
  const [tabVisitNav, setTabVisitNav] = useState({
    canBack: false,
    canForward: false,
  });
  const turnGen = useRef(new Map<string, number>());
  const activityTurnIds = useRef(new Map<string, string>());
  const failedActivityTurns = useRef(new Map<string, string>());
  const lastPersisted = useRef(new Map<string, string>());
  const lastBoundProvider = useRef(new Map<string, string>());
  const lastPersistedUserBlock = useRef(new Map<string, string>());
  const inFlightSyncKey = useRef<string | null>(null);
  const sawInFlight = useRef(false);
  const scheduleWorkspaceSnapshot = useWorkspaceSnapshotPersistence(
    !windowTransfer,
    saveWorkspaceSnapshot,
  );
  const observedSessions = useRef(new Map<string, Session>());
  const pendingPersist = useRef(new Map<string, Session>());
  const removingSessionIds = useRef(new Set<string>());
  // Tokens arrive many times per frame; apply them once so React/markdown aren't
  // recomputed for every delta.
  const harnessQueued = useRef(new Map<string, HarnessEvent[]>());
  const harnessFlush = useRef<ScheduledFlush | null>(null);
  const skipForgetSessionIds = useRef(new Set<string>());
  const importedSessionsApplied = useRef(false);

  useEffect(() => {
    if (importedSessionsApplied.current) return;
    const imported = windowTransfer?.sessions ?? resumed?.sessions;
    if (!imported?.length) return;
    importedSessionsApplied.current = true;
    for (const session of imported) {
      observedSessions.current.set(session.id, session);
      lastPersisted.current.set(session.id, persistFingerprint(session));
      const userId = lastUserBlockId(session);
      if (userId) lastPersistedUserBlock.current.set(session.id, userId);
      if (session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
    }
  }, [windowTransfer, resumed]);

  const flushHarnessEvents = useCallback(() => {
    cancelScheduledFlush(harnessFlush.current);
    harnessFlush.current = null;
    const batches = harnessQueued.current;
    if (batches.size === 0) return;
    harnessQueued.current = new Map();
    const prev = sessionsRef.current;
    const next = prev.map((session) => {
      const events = batches.get(session.id);
      return events ? events.reduce(applyHarnessEvent, session) : session;
    });
    if (!next.some((session, index) => session !== prev[index])) return;
    sessionsRef.current = next;
    syncDockBadge(next);
    setSessions(next);
  }, []);

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      await orchestrator.stopForSession(sessionId);
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map((harness) =>
          cancelHarnessTurn(harness, sessionId).catch(() => undefined),
        ),
      );
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  const applyApprovalEvent = useCallback(
    (sessionId: string, event: HarnessEvent) => {
      const queued = harnessQueued.current.get(sessionId) ?? [];
      harnessQueued.current.delete(sessionId);
      const events = [...queued, event];
      const prev = sessionsRef.current;
      const next = prev.map((session) =>
        session.id === sessionId
          ? events.reduce(applyHarnessEvent, session)
          : session,
      );
      if (!next.some((session, index) => session !== prev[index])) return;
      sessionsRef.current = next;
      syncDockBadge(next);
      setSessions(next);
    },
    [],
  );

  const enqueueHarnessEvent = useCallback(
    (sessionId: string, event: HarnessEvent) => {
      if (
        event.type === "approval.requested" ||
        event.type === "approval.resolved" ||
        event.type === "question.asked" ||
        event.type === "question.resolved"
      ) {
        applyApprovalEvent(sessionId, event);
        return;
      }
      const queued = harnessQueued.current;
      const events = queued.get(sessionId);
      if (events) events.push(event);
      else queued.set(sessionId, [event]);
      if (!harnessFlush.current) {
        harnessFlush.current = scheduleHarnessFlush(flushHarnessEvents);
      }
    },
    [applyApprovalEvent, flushHarnessEvents],
  );

  useEffect(() => {
    if (resumed?.sessions.length) bindResumedSessions(resumed.sessions);
    const stopBridge = startHarnessBridge();
    const reap = () => {
      if (isAppQuitting()) return;
      void persistQuitState(
        sessionsRef.current,
        tabsRef.current,
        activeTabIdRef.current,
        projectCwdRef.current,
        "unload",
        projectTerminalsRef.current,
      ).finally(() => {
        void reapWindowRuntime(
          sessionsRef.current,
          tabsRef.current,
          projectTerminalsRef.current,
        );
      });
    };
    window.addEventListener("pagehide", reap);
    window.addEventListener("beforeunload", reap);
    return () => {
      window.removeEventListener("pagehide", reap);
      window.removeEventListener("beforeunload", reap);
      stopBridge();
      cancelScheduledFlush(harnessFlush.current);
      harnessFlush.current = null;
    };
  }, [resumed]);

  useEffect(() => {
    void probeHarnessAvailability();
    // Only the harnesses already in this window. Probing every installed CLI
    // at boot left unused agents (especially Pi) running in the background.
    const harnesses = [
      ...new Set(sessionsRef.current.map((session) => session.harness)),
    ];
    void refreshHarnessCatalogs(harnesses).then(() => {
      setSessions((prev) =>
        prev.map((session) => {
          if (!isLiveHarness(session.harness)) return session;
          const resolved = resolveModel(session.harness, session.model);
          const modelSettings = mergeModelSettings(
            resolved,
            session.modelSettings,
          );
          if (
            resolved.id === session.model &&
            sameSettings(modelSettings, session.modelSettings)
          ) {
            return session;
          }
          return { ...session, model: resolved.id, modelSettings };
        }),
      );
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const active =
    sessions.find((session) => session.id === activeTab?.focusedId) ??
    sessions.find(
      (session) => activeTab && leafIds(activeTab.layout).includes(session.id),
    );
  const navigationLocation: WorkspaceLocation = {
    kind: settingsOpen
      ? "settings"
      : searchViewOpen
        ? "search"
        : inboxViewOpen
          ? "inbox"
          : notesViewOpen
            ? "notes"
            : homeViewOpen || profileHome
              ? "home"
              : "workspace",
    cwd: projectCwd,
    profileId: profiles.activeProfileId,
    surfaceId: view.focusedId,
    tabId: activeTab?.id,
    paneId: browserFocused ? undefined : activeTab?.focusedId,
    fileId:
      browserFocused || !activeTab ? undefined : focusedFileTab(activeTab)?.id,
    settingsSection,
  };
  const navigationLocationRef = useRef(navigationLocation);
  navigationLocationRef.current = navigationLocation;
  const navigationLocationKey = locationKey(navigationLocation);
  if (!navigationHistory.current)
    navigationHistory.current = createWorkspaceNavigation(navigationLocation);
  const sessionDefaults = active ?? sessions[0];
  const activeSkillContext = active
    ? nativeSkillContextForSession(active)
    : null;
  const activeSkillCwd = activeSkillContext?.cwd;

  useEffect(() => {
    if (!activeSkillContext || !activeSkillCwd) return;
    warmNativeSkills(activeSkillContext);
  }, [activeSkillCwd, active?.id, active?.harness]);

  const sidebarCwd =
    active?.cwd ??
    (activeTab ? focusedFileTab(activeTab)?.cwd : undefined) ??
    projectCwd;
  const sidebarCwdRef = useRef(sidebarCwd);
  sidebarCwdRef.current = sidebarCwd;
  const sidebarCwdKey =
    sidebarCwd && sidebarCwd !== "~" ? normalizeProjectPath(sidebarCwd) : null;
  const historyFailed =
    sidebarCwdKey != null && historyErrorCwd === sidebarCwdKey;
  // True from the very first frame that shows a project we have never listed,
  // so the sidebar can stay blank instead of flashing "No sessions yet".
  const historyPending =
    sidebarCwdKey != null &&
    !loadedProjects.has(sidebarCwdKey) &&
    !historyFailed;
  const gitCwd = active ? sessionWorkCwd(active) : sidebarCwd;
  const gitCwdRef = useRef(gitCwd);
  gitCwdRef.current = gitCwd;
  const projectBranches = useProjectBranches(
    gitCwd,
    workspaceVisible &&
      Boolean(gitCwd) &&
      gitCwd !== "~" &&
      !isProjectlessCwd(gitCwd),
  );

  const nextBusySessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (session.busy) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const busySessionIdsRef = useRef(nextBusySessionIds);
  if (!setsEqual(busySessionIdsRef.current, nextBusySessionIds)) {
    busySessionIdsRef.current = nextBusySessionIds;
  }
  const busySessionIds = busySessionIdsRef.current;

  // Restored and newly selected providers may arrive after the boot refresh.
  // Catalog loaders deduplicate already loaded catalogs and in-flight probes.
  const activeHarness = active?.harness;
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);

  const nextApprovalSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of sessions) {
      if (sessionNeedsInput(session)) {
        ids.add(session.id);
        if (session.orchestrationLeadId) ids.add(session.orchestrationLeadId);
      }
    }
    return ids;
  }, [sessions]);
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  const approvalSessionIds = approvalSessionIdsRef.current;

  const activityEntries = useActivity();
  const [notificationWindowFocused, setNotificationWindowFocused] = useState(
    () => document.hasFocus(),
  );
  const notificationWindowFocusedRef = useRef(notificationWindowFocused);
  notificationWindowFocusedRef.current = notificationWindowFocused;
  // Later-created PiP and detached controllers update these bridges before effects run.
  const activityWindowBridgeRef = useRef<{
    floatingSessionIds: readonly string[];
    focusedSessionIds: ReadonlySet<string>;
    showSession?: (id: string) => boolean | Promise<boolean>;
  }>({ floatingSessionIds: [], focusedSessionIds: new Set() });
  const activityPipIdsRef = useRef<readonly string[]>([]);
  const activityMainViewRef = useRef({ workspaceVisible, visibleSurfaceIds });
  activityMainViewRef.current = { workspaceVisible, visibleSurfaceIds };
  const activityPresentation = useCallback((sessionId: string) => {
    const otherFocused =
      activityWindowBridgeRef.current.focusedSessionIds.has(sessionId);
    const mainVisible = visibleActivitySessionIds({
      ...activityMainViewRef.current,
      tabs: tabsRef.current,
      sessionIds: new Set(sessionsRef.current.map((session) => session.id)),
      floatingSessionIds: [
        ...activityPipIdsRef.current,
        ...activityWindowBridgeRef.current.floatingSessionIds,
      ],
    }).has(sessionId);
    return {
      visible: otherFocused || mainVisible,
      focused: otherFocused || notificationWindowFocusedRef.current,
    };
  }, []);
  const announceActivity = useCallback(
    (session: Session, event: SessionActivityEvent) => {
      const presentation = activityPresentation(session.id);
      void publishSessionActivity(
        session,
        event,
        presentation.visible,
        presentation.focused,
      ).then((result) => {
        if (result.playSound) playCue("turnFinished");
      });
    },
    [activityPresentation],
  );

  const unresolvedActivitySessions = useMemo(
    () =>
      new Set(
        activityEntries
          .filter(isPendingActivity)
          .map((entry) => entry.sessionId),
      ),
    [activityEntries],
  );
  const observedActivityInputs = useRef(new Map<string, string>());
  useEffect(() => {
    for (const session of sessions) {
      if (
        !approvalSessionIds.has(session.id) &&
        !observedActivityInputs.current.has(session.id) &&
        !unresolvedActivitySessions.has(session.id)
      )
        continue;
      const events = pendingSessionActivityEvents(session);
      const ids = events.map((event) => event.id);
      const signature = JSON.stringify(ids);
      if (observedActivityInputs.current.get(session.id) === signature)
        continue;
      if (ids.length) observedActivityInputs.current.set(session.id, signature);
      else observedActivityInputs.current.delete(session.id);
      reconcileSessionActivityInputs(session.id, ids);
      for (const event of events) announceActivity(session, event);
    }
  }, [
    sessions,
    approvalSessionIds,
    announceActivity,
    unresolvedActivitySessions,
  ]);

  // Read requires an actually displayed transcript, including split siblings or
  // a focused detached window. An active ID behind Settings/browser is insufficient.
  useEffect(() => {
    const unreadSessions = new Set(
      activityEntries
        .filter((entry) => entry.readAt === null)
        .map((entry) => entry.sessionId),
    );
    for (const id of unreadSessions) {
      const presentation = activityPresentation(id);
      if (presentation.visible && presentation.focused)
        markSessionActivityRead(id);
    }
  });

  useEffect(() => {
    if (loadNotificationsEnabled()) void probeNotificationPermission();
  }, []);
  const unseenFinishedIds = useMemo(
    () =>
      new Set(
        activityEntries
          .filter(
            (entry) =>
              entry.readAt === null &&
              (entry.outcome === "completed" ||
                entry.outcome === "failed" ||
                entry.outcome === "stopped"),
          )
          .map((entry) => entry.sessionId),
      ),
    [activityEntries],
  );
  const unseenFinishedRef = useRef(unseenFinishedIds);
  unseenFinishedRef.current = unseenFinishedIds;

  const liveAgents = useMemo(
    () =>
      liveAgentsEnabled
        ? liveAgentsFromSessions(sessions, unseenFinishedIds)
        : [],
    [liveAgentsEnabled, sessions, unseenFinishedIds],
  );

  const hiddenApprovalToasts = useMemo(
    () => hiddenApprovalNotices(sessions, activeTabId, tabs, composerFocused),
    [sessions, activeTabId, tabs, composerFocused],
  );

  useEffect(() => {
    syncDockBadge(sessions);
  }, [sessions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const acceptFocus = (focused: boolean) => {
      if (disposed) return;
      setWindowFocused(focused);
      notificationWindowFocusedRef.current = focused;
      setNotificationWindowFocused(focused);
    };
    void getCurrentWindow()
      .isFocused()
      .then(acceptFocus)
      .catch(() => {});
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (disposed) return;
        acceptFocus(focused);
        if (focused) {
          flushHarnessEvents();
          syncDockBadge(sessionsRef.current);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flushHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);

  useEffect(() => {
    let unlistenClose: (() => void) | undefined;
    const releaseQuit = setQuitWorkspace(
      () => sessionsRef.current,
      () => tabsRef.current,
      () => activeTabIdRef.current,
      () => projectCwdRef.current,
      () => projectTerminalsRef.current,
      flushHarnessEvents,
    );
    void getCurrentWindow()
      .onCloseRequested((event) => {
        // Listening here makes close our job. Letting the default path run
        // calls JS `window.destroy`, which Tauri denies without a permission.
        event.preventDefault();
        if (hasInFlightSessions(sessionsRef.current)) {
          flushHarnessEvents();
          if (!IS_MAC) {
            void closeBusyWindow();
            return;
          }
          void persistLiveTranscripts(sessionsRef.current);
          void hideCurrentWindow();
          return;
        }
        void flushWorkspaceDrafts()
          .then(() =>
            persistQuitState(
              sessionsRef.current,
              tabsRef.current,
              activeTabIdRef.current,
              projectCwdRef.current,
              "unload",
              projectTerminalsRef.current,
            ),
          )
          .finally(() => {
            void closeCurrentWindow();
          });
      })
      .then((fn) => {
        unlistenClose = fn;
      });
    return () => {
      releaseQuit();
      unlistenClose?.();
    };
  }, [flushHarnessEvents]);

  const [profileHistoryErrors, setProfileHistoryErrors] = useState<
    ReadonlySet<string>
  >(new Set());
  const profileHistoryRequests = useRef(new Set<string>());
  const refreshProfileHistory = useCallback(async (cwd: string) => {
    const key = normalizeProjectPath(cwd);
    if (
      loadedProjectsRef.current.has(key) ||
      profileHistoryRequests.current.has(key)
    )
      return;
    profileHistoryRequests.current.add(key);
    setProfileHistoryErrors((previous) => {
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
    try {
      const rows = await listSessionsByProject(cwd);
      setHistory((current) => replaceProjectHistory(current, cwd, rows));
      setLoadedProjects((previous) => new Set(previous).add(key));
    } catch {
      setProfileHistoryErrors((previous) => new Set(previous).add(key));
    } finally {
      profileHistoryRequests.current.delete(key);
    }
  }, []);

  const refreshHistory = useCallback(async (cwd: string) => {
    if (!cwd || cwd === "~") return;
    // `history` holds every visited project's rows and the sidebar filters it
    // by cwd, so a project loaded once paints from cache on the way back and
    // revalidates quietly underneath the cards already on screen. Whether the
    // first load is still pending is derived from `loadedProjects`, not
    // tracked here — a status set from this effect lands a render too late to
    // suppress the empty state.
    const key = normalizeProjectPath(cwd);
    setHistoryErrorCwd((prev) => (prev === key ? null : prev));
    try {
      const rows = await listSessionsByProject(cwd);
      if (cwd !== sidebarCwdRef.current) return;
      setHistory((current) => replaceProjectHistory(current, cwd, rows));
      setLoadedProjects((prev) =>
        prev.has(key) ? prev : new Set(prev).add(key),
      );
    } catch {
      if (cwd !== sidebarCwdRef.current) return;
      // A failed revalidate keeps the cached cards rather than replacing a
      // good list with an error.
      if (!loadedProjectsRef.current.has(key)) setHistoryErrorCwd(key);
    }
  }, []);

  useEffect(() => {
    void refreshHistory(sidebarCwd);
  }, [sidebarCwd, refreshHistory]);

  useEffect(() => {
    if (standaloneCwd && sidebarHover.visible) {
      void refreshProfileHistory(standaloneCwd);
    }
  }, [standaloneCwd, sidebarHover.visible, refreshProfileHistory]);

  const persistSession = useCallback((session: Session | undefined) => {
    if (
      !session ||
      !shouldPersistSession(session) ||
      removingSessionIds.current.has(session.id)
    )
      return;
    const fingerprint = persistFingerprint(session);
    void upsertSession(session)
      .then((summary) => {
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (summary.cwd === sidebarCwdRef.current) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      })
      .catch(() => undefined);
  }, []);

  const scheduleTranscriptDrain = useFixedDeadline(() => {
    const dirty = [...pendingPersist.current.values()];
    pendingPersist.current.clear();
    void Promise.all(
      dirty.map(async (session) => {
        if (removingSessionIds.current.has(session.id)) return;
        const fingerprint = persistFingerprint(session);
        if (lastPersisted.current.get(session.id) === fingerprint) return;
        const summary = await upsertSession(session).catch(() => null);
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (summary.cwd === sidebarCwdRef.current) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      }),
    );
  }, 650);

  useEffect(() => {
    const liveIds = new Set(sessions.map((session) => session.id));
    const visibleIds = openSessionIds(tabsRef.current);
    for (const session of sessions) {
      if (removingSessionIds.current.has(session.id)) continue;
      if (observedSessions.current.get(session.id) === session) continue;
      observedSessions.current.set(session.id, session);
      const parked = !visibleIds.has(session.id);
      const newlyBound =
        !!session.providerSessionId &&
        lastBoundProvider.current.get(session.id) !== session.providerSessionId;
      const lastUserId = lastUserBlockId(session);
      const newUserTurn =
        !!lastUserId &&
        lastPersistedUserBlock.current.get(session.id) !== lastUserId;
      if (newlyBound && session.providerSessionId) {
        lastBoundProvider.current.set(session.id, session.providerSessionId);
      }
      if (newUserTurn && lastUserId) {
        lastPersistedUserBlock.current.set(session.id, lastUserId);
      }
      if ((newlyBound || newUserTurn) && shouldPersistSession(session)) {
        persistSession(session);
      }
      if (
        shouldPersistSession(session) &&
        (!session.busy ||
          parked ||
          newlyBound ||
          newUserTurn ||
          !lastPersisted.current.has(session.id))
      ) {
        pendingPersist.current.set(session.id, session);
      }
    }
    for (const sessionId of observedSessions.current.keys()) {
      if (liveIds.has(sessionId)) continue;
      observedSessions.current.delete(sessionId);
      pendingPersist.current.delete(sessionId);
    }
    if (pendingPersist.current.size === 0) return;

    scheduleTranscriptDrain();
  }, [persistSession, sessions, scheduleTranscriptDrain]);

  useEffect(() => {
    const refs = inFlightRefs(sessions, tabs);
    if (refs.length > 0) sawInFlight.current = true;
    const key = inFlightSnapshotKey(refs);
    if (
      !shouldWriteInFlightSnapshot(
        key,
        refs,
        inFlightSyncKey.current,
        sawInFlight.current,
      )
    ) {
      return;
    }
    inFlightSyncKey.current = key;
    void replaceInFlightSessions(refs).catch(() => undefined);
  }, [sessions, tabs]);

  useEffect(() => {
    if (windowTransfer) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      sessions,
      activeTabId,
      projectCwd,
      projectTerminals,
    );
    scheduleWorkspaceSnapshot(snapshot);
  }, [
    tabs,
    sessions,
    activeTabId,
    projectCwd,
    projectTerminals,
    windowTransfer,
    scheduleWorkspaceSnapshot,
  ]);

  useEffect(() => {
    if (windowTransfer) return;
    let timer: number | undefined;
    const unsubscribe = subscribeComposerDrafts(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const snapshot = collectWorkspaceSnapshot(
          tabsRef.current,
          sessionsRef.current,
          activeTabIdRef.current,
          projectCwdRef.current,
          projectTerminalsRef.current,
        );
        scheduleWorkspaceSnapshot(snapshot, 0);
      }, 400);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, [windowTransfer, scheduleWorkspaceSnapshot]);

  useEffect(() => {
    if (lastProjectPath() || resumed || windowTransfer) return;
    const startingCwd = projectCwdRef.current;
    const startingProfile = profilesRef.current.activeProfileId;
    void invoke<string>("default_cwd")
      .then((cwd) => {
        if (
          startingStandaloneRef.current ||
          projectCwdRef.current !== startingCwd ||
          profilesRef.current.activeProfileId !== startingProfile
        )
          return;
        if (!looksLikeProject(cwd)) return;
        setProjectCwd(cwd);
        setRecents((prev) => (prev.length > 0 ? prev : rememberProject(cwd)));
        setSessions((prev) =>
          prev.map((s) => (s.cwd === "~" ? { ...s, cwd } : s)),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const isolated = isolateTerminalPanes(tab);
        if (isolated !== tab) changed = true;
        return isolated;
      });
      return changed ? next : prev;
    });
  }, [tabs]);

  // Tabs are views. Hidden idle sessions drop their child. A visible session
  // keeps its child for a few minutes after a turn so follow-ups stay instant,
  // then parks it and resumes on the next prompt.
  useEffect(() => {
    const visibleIds = openSessionIds(tabs);
    // Inbox owns these panes independently of project tabs. Keep their drafts
    // and attachments mounted when the panel closes or switches items.
    for (const session of sessions) {
      if (session.inboxAsk) visibleIds.add(session.id);
    }
    // Internal workers stay attached to the lead, even while idle between
    // turns. They must not be discarded merely because they have no tab.
    for (const session of sessions) {
      if (
        session.orchestrationLeadId &&
        (visibleIds.has(session.orchestrationLeadId) ||
          orchestrationRuns.some(
            (run) =>
              run.leadId === session.orchestrationLeadId &&
              ["active", "paused"].includes(run.status),
          ))
      )
        visibleIds.add(session.id);
    }
    const keepUnseen = liveAgentsEnabled;
    const idleDetached = sessions.filter(
      (session) =>
        !visibleIds.has(session.id) &&
        !session.busy &&
        !(keepUnseen && unseenFinishedRef.current.has(session.id)),
    );
    if (idleDetached.length === 0) return;
    for (const session of idleDetached) {
      if (skipForgetSessionIds.current.has(session.id)) continue;
      persistSession(session);
      for (const harness of sessionChildHarnesses(session)) {
        void forgetHarnessSession(harness, session.id);
      }
    }
    setSessions((prev) =>
      prev.filter(
        (session) =>
          visibleIds.has(session.id) ||
          session.busy ||
          (keepUnseen && unseenFinishedRef.current.has(session.id)) ||
          skipForgetSessionIds.current.has(session.id),
      ),
    );
  }, [sessions, tabs, persistSession, liveAgentsEnabled, orchestrationRuns]);

  const activateTab = useCallback((id: string, restoreWorkspace = false) => {
    if (detachedIdsRef.current.has(id)) {
      void detachedShowSurface.current(id);
      return;
    }
    setHomeViewOpen(false);
    if (!restoreWorkspace) leaveExpandedPreview();
    setActiveTabId(id);
    const tab = tabsRef.current.find((entry) => entry.id === id);
    const targetCwd = tab ? workspaceTabCwd(tab, sessionsRef.current) : "";
    if (!restoreWorkspace)
      viewRef.current.focus(
        targetCwd ? normalizeProjectPath(targetCwd) : projectCwdRef.current,
        id,
      );
    if (tab) {
      const cwd = workspaceTabCwd(tab, sessionsRef.current);
      if (cwd && looksLikeProject(cwd)) {
        const normalized = normalizeProjectPath(cwd);
        profilesRef.current.selectProfile(
          projectWorkspaceProfile(loadWorkspaceProfiles(), normalized),
        );
        if (!sameProjectPath(normalized, projectCwdRef.current)) {
          setProjectCwd(normalized);
          setRecents(rememberProject(normalized));
        }
      }
    }
    setComposerFocused(
      !!tab &&
        sessionsRef.current.some((session) => session.id === tab.focusedId),
    );
  }, []);

  const isLocationAvailable = useCallback((place: WorkspaceLocation) => {
    if (
      place.kind === "workspace" &&
      place.surfaceId &&
      detachedIdsRef.current.has(place.surfaceId)
    )
      return false;
    if (
      !profilesRef.current.profiles.some(
        (profile) => profile.id === place.profileId,
      )
    )
      return false;
    if (place.kind !== "workspace")
      return place.kind !== "notes" || loadNotesEnabled();
    const browser = normalizeBrowserWorkspace(
      browserWorkspacesRef.current[place.cwd] ?? EMPTY_BROWSER,
    );
    if (
      browser.tabs.some(
        (tab) => browserIdForTab(place.cwd, tab.id) === place.surfaceId,
      )
    )
      return true;
    const tab = tabsRef.current.find((tab) => tab.id === place.surfaceId);
    return (
      !!tab &&
      (!place.fileId ||
        [...tab.editorPanes, ...(tab.terminalPanes ?? [])].some((pane) =>
          pane.files.some((file) => file.id === place.fileId),
        ))
    );
  }, []);

  const commitNavigation = useCallback(
    (history: WorkspaceNavigation) => {
      navigationHistory.current = history;
      const canBack = history.back.some(isLocationAvailable);
      const canForward = history.forward.some(isLocationAvailable);
      setTabVisitNav((prev) =>
        prev.canBack === canBack && prev.canForward === canForward
          ? prev
          : { canBack, canForward },
      );
    },
    [isLocationAvailable],
  );

  useEffect(() => {
    // Project/group focus can settle over more than one render. Record the
    // destination once after that commit, not each intermediate focus hint.
    const frame = requestAnimationFrame(() => {
      const place = navigationLocationRef.current;
      commitNavigation(
        recordWorkspaceLocation(
          navigationHistory.current ?? createWorkspaceNavigation(place),
          place,
        ),
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationLocationKey, commitNavigation, tabs, browserState.tabs.length]);

  /** `cwd` scopes group inheritance: a tab from another project starts alone. */
  const appendTab = useCallback(
    (tab: WorkspaceTab, cwd?: string) => {
      setTabs((prev) =>
        insertTabBesideActive(prev, tab, activeTabIdRef.current, (id) =>
          id === tab.id
            ? cwd
              ? projectName(cwd)
              : undefined
            : projectOfTab(id),
        ),
      );
    },
    [projectOfTab],
  );

  const onOpenWhatsNew = useCallback((version: string) => {
    const document = releaseNotesForVersion(version);
    if (!document) {
      void message(
        "Release notes for this version are not available in this build.",
        { title: "Aven" },
      );
      return;
    }
    setWhatsNewVersion(document.source.version);
  }, []);

  const onNewStandalone = useCallback(
    async (openBrowser = false, browserUrl?: string) => {
      if (startingStandaloneRef.current) return;
      const profileId = profilesRef.current.activeProfileId;
      startingStandaloneRef.current = true;
      setStartingStandalone(true);
      try {
        const { cwd } = await ensureProjectlessWorkspace(profileId);
        // A profile switch while the folder is prepared must not pull the user back.
        if (profilesRef.current.activeProfileId !== profileId) return;
        const session = newDefaultSession(cwd);
        const tab = newTab(session.id);
        setHomeViewOpen(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setProjectCwd(cwd);
        setSessions((previous) => [...previous, session]);
        appendTab(tab, cwd);
        if (!openBrowser) viewRef.current.focus(cwd, tab.id);
        setActiveTabId(tab.id);
        setComposerFocused(!openBrowser);
        const pageId = browserUrl ? crypto.randomUUID() : undefined;
        if (pageId) viewRef.current.focus(cwd, browserIdForTab(cwd, pageId));
        setBrowserWorkspaces((all) => {
          const current = all[cwd] ?? EMPTY_BROWSER;
          return {
            ...all,
            [cwd]: pageId
              ? addBrowserTab(
                  { ...current, mode: "tab" },
                  { id: pageId, url: browserUrl! },
                )
              : patchBrowserWorkspace(
                  current,
                  openBrowser
                    ? { mode: "tab", open: true, expanded: true }
                    : { expanded: false },
                ),
          };
        });
      } catch (error) {
        void message(String(error), {
          title: "Could not start session",
          kind: "error",
        });
      } finally {
        startingStandaloneRef.current = false;
        setStartingStandalone(false);
      }
    },
    [appendTab],
  );

  const onGlobalNewBrowser = useCallback(() => {
    if (profileHome) {
      void onNewStandalone(true);
      return;
    }
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setComposerFocused(false);
    onNewBrowserTab();
  }, [profileHome, onNewStandalone, onNewBrowserTab]);

  const onNew = useCallback(() => {
    setHomeViewOpen(false);
    if (profileHome) {
      void onNewStandalone();
      return;
    }
    leaveExpandedPreview();
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    const cwd = active?.cwd ?? sessionDefaults?.cwd ?? projectCwd;
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    setSessions((prev) => [...prev, session]);
    appendTab(tab, cwd);
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return session.id;
  }, [
    profileHome,
    onNewStandalone,
    active?.cwd,
    appendTab,
    sessionDefaults?.cwd,
    sessionDefaults?.runtimeMode,
    projectCwd,
  ]);

  const onStartInboxItem = useCallback(
    async (item: InboxItem, body?: string) => {
      const start = (description?: string) => {
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        setSidebarTab("sessions");
        const cwd =
          item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
        const ref =
          item.provider === "linear"
            ? item.identifier?.trim() || `#${item.number}`
            : `#${item.number}`;
        const session = {
          ...newDefaultSession(cwd),
          title: `${ref} ${item.title}`,
          inboxCard: inboxComposerCard(item, description),
        };
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, cwd);
        setActiveTabId(tab.id);
        setComposerFocused(true);
      };

      if (item.provider !== "linear") {
        start();
        return;
      }
      if (!item.id) {
        throw new Error("Missing Linear issue");
      }
      if (body !== undefined) {
        start(body);
        return;
      }
      const cached = peekLinearIssueDetails(item.id);
      if (cached) {
        start(cached.body);
        return;
      }
      const details = await linearIssueDetails(item.id);
      start(details.body);
    },
    [
      active?.cwd,
      appendTab,
      sessionDefaults?.cwd,
      sessionDefaults?.runtimeMode,
      projectCwd,
    ],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSidebarTab("sessions");
      const cwd =
        (card.sourceCwd && looksLikeProject(card.sourceCwd)
          ? card.sourceCwd
          : undefined) ||
        active?.cwd ||
        sessionDefaults?.cwd ||
        projectCwd;
      const title = card.title.trim();
      const session = {
        ...newDefaultSession(cwd),
        ...(title ? { title } : {}),
        noteCard: card,
      };
      const tab = newTab(session.id);
      setSessions((prev) => [...prev, session]);
      appendTab(tab, cwd);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [
      active?.cwd,
      appendTab,
      sessionDefaults?.cwd,
      sessionDefaults?.runtimeMode,
      projectCwd,
    ],
  );

  useEffect(() => {
    const onAdd = (event: Event) => {
      const card = (event as CustomEvent<NoteComposerCard>).detail;
      if (!card?.id) return;
      onAddNoteToChat(card);
    };
    window.addEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_NOTE_TO_CHAT_EVENT, onAdd);
  }, [onAddNoteToChat]);

  const onInboxCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.inboxCard
          ? { ...session, inboxCard: undefined }
          : session,
      ),
    );
  }, []);

  const onNoteCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.noteCard
          ? { ...session, noteCard: undefined }
          : session,
      ),
    );
  }, []);

  const onHandoffCardDismiss = useCallback((sessionId: string) => {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId && session.handoffCard
          ? { ...session, handoffCard: undefined }
          : session,
      ),
    );
  }, []);

  const onSplit = useCallback(
    (dir: SplitDir) => {
      leaveExpandedPreview();
      if (!activeTab) return;
      const session = newSplitSession(sessionDefaults, projectCwd);
      setSessions((prev) => [...prev, session]);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeTab.id) return t;
          return {
            ...t,
            layout: splitPane(t.layout, t.focusedId, dir, session.id),
            focusedId: session.id,
          };
        }),
      );
      setComposerFocused(true);
    },
    [activeTab, projectCwd, sessionDefaults?.cwd],
  );

  const focusProjectTerminal = useCallback(() => {
    setProjectTerminalFocused(true);
    setComposerFocused(false);
  }, []);

  const openProjectTerminal = useCallback(
    (cwd: string) => {
      const workdir = cwd || projectCwdRef.current;
      const projectPath = projectCwdRef.current;
      if (!looksLikeProject(projectPath)) return false;
      setProjectTerminals((prev) => {
        const existing = findProjectTerminal(prev, projectPath);
        const file = newTerminalFile(
          workdir,
          existing ? nextDockTerminalTitle(existing, workdir) : undefined,
        );
        if (!existing) {
          return [...prev, createProjectTerminal(projectPath, file)];
        }
        return mapProjectTerminal(prev, projectPath, (dock) =>
          addTerminalToDock(dock, file),
        );
      });
      focusProjectTerminal();
      return true;
    },
    [focusProjectTerminal],
  );

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string) => {
      leaveExpandedPreview();
      const workdir = cwd || active?.cwd || projectCwd;
      if (openProjectTerminal(workdir)) return;

      if (asWorkspaceTab || !activeTab) {
        const file = newTerminalFile(workdir);
        const tab = newTerminalWorkspaceTab(file);
        appendTab(tab, workdir);
        setActiveTabId(tab.id);
        setComposerFocused(false);
        return;
      }

      const occupying = sessionsRef.current.find(
        (session) => session.id === (occupySessionId ?? activeTab.focusedId),
      );
      const occupyPaneId =
        occupying && isBlankSession(occupying) ? occupying.id : undefined;
      if (occupyPaneId && occupying) {
        lastPersisted.current.delete(occupyPaneId);
        void forgetHarnessSession(occupying.harness, occupyPaneId);
        setSessions((prev) =>
          prev.filter((session) => session.id !== occupyPaneId),
        );
      }

      const file = newTerminalFile(
        workdir,
        nextTerminalTitle(activeTab, workdir),
      );
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTab.id
            ? openTerminalTab(tab, file, occupyPaneId)
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [active?.cwd, activeTab, appendTab, openProjectTerminal, projectCwd],
  );

  const onNewTerminal = useCallback(() => {
    onOpenTerminal(active?.cwd ?? projectCwd);
  }, [active?.cwd, onOpenTerminal, projectCwd]);

  const onNewTerminalInSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      onOpenTerminal(
        session ? sessionWorkCwd(session) : projectCwd,
        false,
        sessionId,
      );
    },
    [onOpenTerminal, projectCwd],
  );

  const onToggleProjectTerminal = useCallback(() => {
    if (!looksLikeProject(projectCwd)) return;
    const dock = findProjectTerminal(projectTerminalsRef.current, projectCwd);
    if (!dock) {
      openProjectTerminal(active?.cwd ?? projectCwd);
      return;
    }
    const nextOpen = !dock.open;
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwd, (entry) =>
        withDockOpen(entry, nextOpen),
      ),
    );
    if (nextOpen) focusProjectTerminal();
    else setProjectTerminalFocused(false);
  }, [active?.cwd, focusProjectTerminal, openProjectTerminal, projectCwd]);

  const onHideProjectTerminal = useCallback(() => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockOpen(dock, false),
      ),
    );
    setProjectTerminalFocused(false);
  }, []);

  const onProjectTerminalSide = useCallback((side: DockSide) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSide(dock, side, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onProjectTerminalSize = useCallback((size: number) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        withDockSize(dock, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      ),
    );
  }, []);

  const onSelectProjectTerminal = useCallback(
    (fileId: string) => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
          selectDockTerminal(dock, fileId),
        ),
      );
      focusProjectTerminal();
    },
    [focusProjectTerminal],
  );

  const onReorderProjectTerminals = useCallback((ids: string[]) => {
    setProjectTerminals((prev) =>
      mapProjectTerminal(prev, projectCwdRef.current, (dock) =>
        reorderDockTerminals(dock, orderByIds(dock.pane.files, ids)),
      ),
    );
  }, []);

  const onCloseProjectTerminal = useCallback((fileId: string) => {
    const dock = findProjectTerminal(
      projectTerminalsRef.current,
      projectCwdRef.current,
    );
    const file = dock?.pane.files.find((entry) => entry.id === fileId);
    if (!file) return;
    const finishClose = () => {
      setProjectTerminals((prev) =>
        mapProjectTerminal(prev, projectCwdRef.current, (entry) =>
          closeTerminalInDock(entry, fileId),
        ),
      );
    };
    void confirmCloseTerminal(file).then((ok) => ok && finishClose());
  }, []);

  const onTerminalMetaChange = useCallback(
    (fileId: string, patch: TerminalMetaPatch) => {
      setProjectTerminals((prev) => patchProjectTerminals(prev, fileId, patch));
      setTabs((prev) =>
        prev.map((tab) => updateTerminalTab(tab, fileId, patch)),
      );
    },
    [],
  );

  const onNewTerminalTab = useCallback(() => {
    leaveExpandedPreview();
    onOpenTerminal(active?.cwd ?? projectCwd, true);
  }, [active?.cwd, onOpenTerminal, projectCwd]);

  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      const current = tabsRef.current;
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const closePlan = planWorkspaceTabClose({
        tabs: current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
      });
      if (closePlan.action === "keep") return;
      const closing = current[index];
      const closingFiles = [
        ...closing.editorPanes.flatMap((pane) => pane.files),
        ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const terminals = closingFiles.filter(
        (file) => file.terminal && !confirmed.has(file.id),
      );

      const finishClose = () => {
        const current = tabsRef.current;
        const closing = current.find((tab) => tab.id === id);
        if (!closing) return;
        const closePlan = planWorkspaceTabClose({
          tabs: current,
          sessions: sessionsRef.current,
          closingTabId: id,
          scope: tabCloseScope,
        });
        if (closePlan.action === "keep") return;
        const closingFiles = [
          ...closing.editorPanes,
          ...closing.terminalPanes,
        ].flatMap((pane) => pane.files);
        discardEditorDrafts(closingFiles.filter(isFilesystemTab));
        rememberClosed({
          kind: "tab",
          cwd:
            workspaceTabCwd(closing, sessionsRef.current) ||
            projectCwdRef.current,
          closedAt: Date.now(),
          tab: closing,
          sessionStubs: collectWorkspaceSnapshot(
            [closing],
            sessionsRef.current,
            closing.id,
            projectCwdRef.current,
          ).sessions.map(({ draft: _draft, ...stub }) => stub),
        });
        const nextActiveTabId = closePlan.nextActiveTabId;
        const next = current.filter((t) => t.id !== id);
        const gone = new Set(
          leafIds(closing.layout).filter((paneId) =>
            sessionsRef.current.some((session) => session.id === paneId),
          ),
        );
        for (const sessionId of gone) {
          persistSession(sessionsRef.current.find((s) => s.id === sessionId));
        }
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        tabsRef.current = next;
        setTabs(next);
        const closingCwd =
          workspaceTabCwd(closing, sessionsRef.current) ||
          projectCwdRef.current;
        const nextView = closeWorkspaceViews(
          viewRef.current.get(closingCwd),
          [id],
          nextActiveTabId ?? "",
        );
        viewRef.current.restore(closingCwd, nextView);
        if (id === activeTabIdRef.current && nextActiveTabId) {
          if (next.some((tab) => tab.id === nextView.focusedId))
            activateTab(nextView.focusedId);
          else setActiveTabId(nextActiveTabId);
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close this tab with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd, tabCloseScope],
  );

  const onCloseTabs = useCallback(
    (ids: string[], fallbackId: string) => {
      const current = tabsRef.current;
      const closingIds = new Set(ids);
      const closing = current.filter((tab) => closingIds.has(tab.id));
      const fallback = current.find(
        (tab) => tab.id === fallbackId && !closingIds.has(tab.id),
      );
      if (!fallback || closing.length === 0) return;

      const closingFiles = closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = () => {
        const current = tabsRef.current;
        const closing = current.filter((tab) => closingIds.has(tab.id));
        const fallback =
          current.find(
            (tab) => tab.id === fallbackId && !closingIds.has(tab.id),
          ) ?? current.find((tab) => !closingIds.has(tab.id));
        if (!fallback || !closing.length) return;
        const closingFiles = closing.flatMap((tab) =>
          [...tab.editorPanes, ...tab.terminalPanes].flatMap(
            (pane) => pane.files,
          ),
        );
        discardEditorDrafts(closingFiles.filter(isFilesystemTab));
        for (const tab of closing)
          rememberClosed({
            kind: "tab",
            cwd:
              workspaceTabCwd(tab, sessionsRef.current) ||
              projectCwdRef.current,
            closedAt: Date.now(),
            tab,
            sessionStubs: collectWorkspaceSnapshot(
              [tab],
              sessionsRef.current,
              tab.id,
              projectCwdRef.current,
            ).sessions.map(({ draft: _draft, ...stub }) => stub),
          });
        const sessionIds = new Set(
          closing.flatMap((tab) =>
            leafIds(tab.layout).filter((paneId) =>
              sessionsRef.current.some((session) => session.id === paneId),
            ),
          ),
        );
        for (const sessionId of sessionIds) {
          persistSession(
            sessionsRef.current.find((session) => session.id === sessionId),
          );
        }
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          for (const file of closingFiles) next.delete(file.id);
          return next;
        });
        const nextTabs = current.filter((tab) => !closingIds.has(tab.id));
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        const byProject = new Map<string, string[]>();
        for (const tab of closing) {
          const cwd =
            workspaceTabCwd(tab, sessionsRef.current) || projectCwdRef.current;
          byProject.set(cwd, [...(byProject.get(cwd) ?? []), tab.id]);
        }
        let nextFocus = fallback.id;
        for (const [cwd, projectIds] of byProject) {
          const projectFallback = nextTabs.find(
            (tab) => workspaceTabCwd(tab, sessionsRef.current) === cwd,
          );
          const nextView = closeWorkspaceViews(
            viewRef.current.get(cwd),
            projectIds,
            projectFallback?.id ?? "",
          );
          viewRef.current.restore(cwd, nextView);
          if (cwd === projectCwdRef.current && nextView.focusedId)
            nextFocus = nextView.focusedId;
        }
        if (closingIds.has(activeTabIdRef.current)) {
          activateTab(
            nextTabs.some((tab) => tab.id === nextFocus)
              ? nextFocus
              : fallback.id,
          );
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (unsaved.length > 0) {
          const ok = await confirmDiscardUnsaved(
            "Close these tabs with unsaved files?",
          );
          if (!ok) return;
        }
        if (terminals.length > 0) {
          const ok = await confirmCloseTerminals(terminals);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd],
  );

  const onCloseOtherTabs = useCallback(() => {
    const current = tabsRef.current;
    const activeId = activeTabIdRef.current;
    if (!current.some((tab) => tab.id === activeId)) return;
    onCloseTabs(
      current.filter((tab) => tab.id !== activeId).map((tab) => tab.id),
      activeId,
    );
  }, [onCloseTabs]);

  const onCloseFile = useCallback(
    (paneId: string, fileId: string) => {
      const tab = tabsRef.current.find((entry) =>
        findSurfacePane(entry, paneId),
      );
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const { pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        isFilesystemTab(file) && dirtyFilesRef.current.has(fileId);

      const finishClose = () => {
        const tab = tabsRef.current.find((entry) =>
          findSurfacePane(entry, paneId),
        );
        if (!tab) return;
        const found = findSurfacePane(tab, paneId);
        if (!found) return;
        const { kind, pane } = found;
        const index = pane.files.findIndex((file) => file.id === fileId);
        if (index < 0) return;
        const file = pane.files[index];
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        let nextLayout = tab.layout;
        let nextPanes = surfacePanes(tab, kind);
        if (files.length > 0) {
          nextFocus = paneId;
          const activeFileId =
            pane.activeFileId === fileId
              ? files[Math.min(index, files.length - 1)].id
              : pane.activeFileId;
          nextPanes = nextPanes.map((entry) =>
            entry.id === paneId ? { ...entry, files, activeFileId } : entry,
          );
        } else {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            setDirtyFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
            const closePlan = planWorkspaceTabClose({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              closingTabId: tab.id,
              scope: tabCloseScope,
            });
            if (closePlan.action === "close") {
              onCloseTab(
                tab.id,
                file.terminal ? { confirmedTerminalIds: [fileId] } : undefined,
              );
              return;
            }
            if (!file.terminal)
              rememberClosed({
                kind: "file",
                cwd: file.cwd || projectCwdRef.current,
                closedAt: Date.now(),
                tabId: tab.id,
                paneId,
                file,
              });
            const seed = sessionsRef.current[0];
            const session = newSession(
              seed?.harness ?? "claude",
              file.cwd || projectCwd,
              seed?.model,
              loadDefaultRuntimeMode(),
              seed?.modelSettings,
            );
            setSessions((prev) => [...prev, session]);
            setTabs((prev) =>
              prev.map((entry) =>
                entry.id === tab.id
                  ? {
                      ...entry,
                      layout: leaf(session.id),
                      focusedId: session.id,
                      editorPanes: [],
                      terminalPanes: [],
                      diffOpen: false,
                      diffFocused: false,
                    }
                  : entry,
              ),
            );
            setComposerFocused(true);
            return;
          }
          nextLayout = withoutPane;
          nextFocus =
            tab.focusedId === paneId
              ? (sibling ?? firstLeafId(withoutPane))
              : tab.focusedId;
          nextPanes = nextPanes.filter((entry) => entry.id !== paneId);
        }

        if (isFilesystemTab(file)) discardEditorDrafts([file]);
        if (!file.terminal)
          rememberClosed({
            kind: "file",
            cwd: file.cwd || projectCwdRef.current,
            closedAt: Date.now(),
            tabId: tab.id,
            paneId,
            file,
          });
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === tab.id
              ? withSurfacePanes(
                  {
                    ...entry,
                    layout: nextLayout,
                    focusedId: nextFocus,
                  },
                  kind,
                  nextPanes,
                )
              : entry,
          ),
        );
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
        if (tab.id === activeTabId && files.length === 0) {
          setComposerFocused(
            sessionsRef.current.some((session) => session.id === nextFocus),
          );
        }
      };

      void (async () => {
        if (needsUnsavedConfirm) {
          const ok = await confirmDiscardUnsaved(
            `Close ${basename(file.path)} without saving?`,
          );
          if (!ok) return;
        }
        if (file.terminal) {
          const ok = await confirmCloseTerminal(file);
          if (!ok) return;
        }
        finishClose();
      })();
    },
    [activeTabId, onCloseTab, projectCwd, tabCloseScope],
  );

  const onClearTabSession = useCallback(
    (id: string) => {
      const tab = tabs.find((entry) => entry.id === id);
      if (!tab || isBlankWorkspaceTab(tab, sessionsRef.current)) return;

      const closingFiles = [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );

      const oldSessionId = leafIds(tab.layout).find((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      const oldSession = sessionsRef.current.find(
        (session) => session.id === oldSessionId,
      );
      if (!oldSession) return;

      const finishClear = () => {
        discardEditorDrafts(closingFiles.filter(isFilesystemTab));
        persistSession(oldSession);

        const session = newSession(
          oldSession.harness,
          oldSession.cwd,
          oldSession.model,
          oldSession.runtimeMode,
          oldSession.modelSettings,
        );

        setSessions((prev) => [...prev, session]);
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  layout: leaf(session.id),
                  focusedId: session.id,
                  editorPanes: [],
                  terminalPanes: [],
                  diffOpen: false,
                  diffFocused: false,
                }
              : entry,
          ),
        );
        setComposerFocused(true);
        void refreshHistory(sidebarCwd);
      };

      if (unsaved.length === 0) {
        finishClear();
        return;
      }
      void confirmDiscardUnsaved(
        "Close this conversation with unsaved files?",
      ).then((ok) => ok && finishClear());
    },
    [tabs, persistSession, refreshHistory, sidebarCwd],
  );

  const onClosePane = useCallback(
    (sessionId?: string) => {
      // The project terminal is shared by every workspace tab in the project.
      // Keep the global close command scoped to workspace tabs and panes even
      // while the dock has focus; terminal tabs have their own close buttons.
      const closingTab = resolvePaneCloseTab(
        tabsRef.current,
        activeTabIdRef.current,
        sessionId,
      );
      if (!closingTab) return;
      const focusedSurface = findSurfacePane(closingTab, closingTab.focusedId);
      if (sessionId === undefined && focusedSurface) {
        onCloseFile(focusedSurface.pane.id, focusedSurface.pane.activeFileId);
        return;
      }
      const closingId = sessionId ?? closingTab.focusedId;
      const ids = leafIds(closingTab.layout);
      const sessionIds = ids.filter((paneId) =>
        sessionsRef.current.some((session) => session.id === paneId),
      );
      if (!sessionIds.includes(closingId)) return;
      const nextTab = closeLeaf(closingTab, closingId);
      if (!nextTab) {
        const closePlan = planWorkspaceTabClose({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          closingTabId: closingTab.id,
          scope: tabCloseScope,
        });
        if (closePlan.action === "keep") onClearTabSession(closingTab.id);
        else onCloseTab(closingTab.id);
        return;
      }
      persistSession(sessionsRef.current.find((s) => s.id === closingId));
      setTabs((prev) =>
        prev.map((t) =>
          t.id === closingTab.id
            ? { ...t, layout: nextTab.layout, focusedId: nextTab.focusedId }
            : t,
        ),
      );
      if (
        closingTab.id === activeTabIdRef.current &&
        closingId === closingTab.focusedId
      ) {
        setComposerFocused(
          nextTab &&
            sessionsRef.current.some(
              (session) => session.id === nextTab.focusedId,
            ),
        );
      }
      void refreshHistory(sidebarCwd);
    },
    [
      onCloseFile,
      onCloseTab,
      onClearTabSession,
      persistSession,
      refreshHistory,
      sidebarCwd,
      tabCloseScope,
    ],
  );

  const onCloseTitleTab = useCallback(
    (id: string) => {
      const closePlan = planWorkspaceTabClose({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
      });
      if (closePlan.action === "keep" && id === activeTabIdRef.current) {
        onClosePane();
        return;
      }
      onCloseTab(id);
    },
    [onClosePane, onCloseTab, tabCloseScope],
  );

  const onSelectSurface = useCallback(
    (id: string) => {
      if (browserSurfaces.some((tab) => tab.surfaceId === id))
        onSelectBrowserTab(id);
      else {
        viewRef.current.change((view) => selectWorkspaceView(view, id));
        activateTab(id);
      }
    },
    [browserSurfaces, onSelectBrowserTab, activateTab],
  );
  const onNext = useCallback(() => {
    const { groups, focusedId } = viewRef.current.view;
    const order = groups[focusedId] ?? [];
    const index = order.indexOf(focusedId);
    if (order.length) onSelectSurface(order[(index + 1) % order.length]);
  }, [onSelectSurface]);
  const onPrev = useCallback(() => {
    const { groups, focusedId } = viewRef.current.view;
    const order = groups[focusedId] ?? [];
    const index = order.indexOf(focusedId);
    if (order.length)
      onSelectSurface(order[(index - 1 + order.length) % order.length]);
  }, [onSelectSurface]);

  const navigateHistory = useCallback(
    (direction: "back" | "forward") => {
      const history = navigationHistory.current;
      if (!history) return;
      const next = visitWorkspaceLocation(
        history,
        direction,
        isLocationAvailable,
      );
      if (!next) return;
      const place = next.current;
      commitNavigation(next);
      profilesRef.current.selectProfile(place.profileId);
      setProjectCwd(place.cwd);
      setSettingsOpen(place.kind === "settings");
      setSearchViewOpen(place.kind === "search");
      setInboxViewOpen(place.kind === "inbox");
      setNotesViewOpen(place.kind === "notes");
      setHomeViewOpen(place.kind === "home");
      setFilePickerOpen(false);
      if (place.settingsSection && place.kind === "settings")
        setSettingsSection(place.settingsSection as SettingsSectionId);
      if (place.kind !== "workspace") return;
      if (place.tabId && tabsRef.current.some((tab) => tab.id === place.tabId))
        setActiveTabId(place.tabId);
      if (place.surfaceId) viewRef.current.focus(place.cwd, place.surfaceId);
      if (place.paneId)
        setTabs((all) =>
          all.map((tab) => {
            if (tab.id !== place.tabId) return tab;
            const panes = [...tab.editorPanes, ...tab.terminalPanes];
            const paneId = place.fileId
              ? panes.find((pane) =>
                  pane.files.some((file) => file.id === place.fileId),
                )?.id
              : place.paneId;
            if (!paneId || !leafIds(tab.layout).includes(paneId)) return tab;
            const restorePane = (pane: EditorPane) =>
              pane.id === paneId && place.fileId
                ? { ...pane, activeFileId: place.fileId }
                : pane;
            return {
              ...tab,
              focusedId: paneId,
              editorPanes: tab.editorPanes.map(restorePane),
              terminalPanes: tab.terminalPanes.map(restorePane),
            };
          }),
        );
      setComposerFocused(false);
    },
    [commitNavigation, isLocationAvailable],
  );
  const onVisitBack = useCallback(
    () => navigateHistory("back"),
    [navigateHistory],
  );
  const onVisitForward = useCallback(
    () => navigateHistory("forward"),
    [navigateHistory],
  );

  const onActivate = useCallback(
    (slot: number) => {
      const { groups, focusedId } = viewRef.current.view;
      const order = groups[focusedId] ?? [];
      const id = order[slot < 0 ? order.length - 1 : slot];
      if (id) onSelectSurface(id);
    },
    [onSelectSurface],
  );

  const onFocusPane = useCallback(
    (paneId: string) => {
      setProjectTerminalFocused(false);
      if (inboxAskPortal?.sessionId === paneId) {
        setComposerFocused(true);
        return;
      }
      const owner = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(paneId),
      );
      if (!owner) return;
      setActiveTabId(owner.id);
      leaveExpandedPreview();
      viewRef.current.change((view) => selectWorkspaceView(view, owner.id));
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === owner.id
            ? { ...tab, focusedId: paneId, diffFocused: false }
            : tab,
        ),
      );
      setComposerFocused(
        sessionsRef.current.some((session) => session.id === paneId),
      );
    },
    [inboxAskPortal, leaveExpandedPreview],
  );

  const onOpenDiff = useCallback(
    (
      path?: string,
      session?: { sessionId: string; cwd: string },
      changeKind?: GitFileDiffKind,
    ) => {
      leaveExpandedPreview();
      void (async () => {
        const diffCwd = session?.cwd ?? gitCwdRef.current;
        const resolved = path
          ? ((await resolveOpenablePath(diffCwd, path)) ?? path)
          : undefined;
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        setTabs((prev) =>
          prev.map((tab) => {
            if (tab.id !== activeTabId) return tab;
            if (session) {
              return openSessionChangesTab(
                tab,
                session.cwd,
                session.sessionId,
                resolved,
              );
            }
            if (loadDiffViewer() === "unified") {
              return openChangesTab(
                tab,
                sidebarCwdRef.current,
                resolved,
                changeKind,
              );
            }
            if (!resolved) return tab;
            return openEditorTab(
              tab,
              newFileTab(resolved, sidebarCwdRef.current, true, changeKind),
            );
          }),
        );
        setSidebarTab("changes");
        setComposerFocused(false);
      })();
    },
    [activeTabId],
  );

  const onOpenWorkingTreeDiff = useCallback(
    (path: string, kind?: GitFileDiffKind) => onOpenDiff(path, undefined, kind),
    [onOpenDiff],
  );

  /** Stack every working-tree change in one review, whatever the diff-view setting. */
  const onOpenAllChanges = useCallback(() => {
    leaveExpandedPreview();
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId
          ? openChangesTab(tab, sidebarCwdRef.current)
          : tab,
      ),
    );
    setComposerFocused(false);
  }, [activeTabId]);

  const onOpenCommit = useCallback(
    (commit: GitHistoryCommit) => {
      leaveExpandedPreview();
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openCommitTab(tab, sidebarCwdRef.current, {
                sha: commit.sha,
                shortSha: commit.shortSha,
                subject: commit.subject,
              })
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onShowSourceControl = useCallback(() => {
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setSidebarTab("changes");
  }, []);

  const onToggleChanges = useCallback(() => {
    onShowSourceControl();
  }, [onShowSourceControl]);

  const onReorderTabs = useCallback(
    (ids: string[], movedId?: string) => {
      setTabs((prev) => {
        const visibleIds = new Set(ids);
        const visibleTabs = prev.filter((tab) => visibleIds.has(tab.id));
        if (movedId) {
          const reordered = applyGroupedReorder(
            visibleTabs,
            ids,
            movedId,
            projectOfTab,
          );
          return reordered ? mergeOrderedSubset(prev, reordered) : prev;
        }
        return mergeOrderedSubset(prev, orderByIds(visibleTabs, ids));
      });
    },
    [projectOfTab],
  );

  const onReorderFiles = useCallback((paneId: string, ids: string[]) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          tab,
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId
              ? { ...pane, files: orderByIds(pane.files, ids) }
              : pane,
          ),
        );
      }),
    );
  }, []);

  const onMovePane = useCallback(
    (fromId: string, toId: string, edge: PaneEdge) => {
      setTabs((prev) =>
        prev.map((tab) => {
          return leafIds(tab.layout).includes(fromId)
            ? {
                ...tab,
                layout: movePane(tab.layout, fromId, toId, edge),
                focusedId: fromId,
              }
            : tab;
        }),
      );
    },
    [],
  );

  const focusOpenSession = useCallback((sessionId: string) => {
    const tab = tabsRef.current.find((entry) =>
      leafIds(entry.layout).includes(sessionId),
    );
    if (!tab) return false;
    const target = sessionsRef.current.find((entry) => entry.id === sessionId);
    viewRef.current.focus(
      target?.cwd ? normalizeProjectPath(target.cwd) : projectCwdRef.current,
      tab.id,
    );
    if (target && looksLikeProject(target.cwd)) {
      revealProjectTask(target.cwd);
      profilesRef.current.selectProfile(
        projectWorkspaceProfile(loadWorkspaceProfiles(), target.cwd),
      );
      setProjectCwd(target.cwd);
      setRecents(rememberProject(target.cwd));
    }
    setActiveTabId(tab.id);
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id ? { ...entry, focusedId: sessionId } : entry,
      ),
    );
    setComposerFocused(true);
    return true;
  }, []);

  const replaceBlankPaneWithSession = useCallback((session: Session) => {
    const tab =
      tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ??
      tabsRef.current[0];
    if (!tab) return false;

    const paneId = isBlankSession(
      sessionsRef.current.find((entry) => entry.id === tab.focusedId),
    )
      ? tab.focusedId
      : leafIds(tab.layout).find((id) =>
          isBlankSession(sessionsRef.current.find((entry) => entry.id === id)),
        );
    if (!paneId || paneId === session.id) return false;

    lastPersisted.current.delete(paneId);
    {
      const blank = sessionsRef.current.find((entry) => entry.id === paneId);
      if (blank) void forgetHarnessSession(blank.harness, paneId);
    }
    setSessions((prev) => {
      const next = prev.filter((entry) => entry.id !== paneId);
      return next.some((entry) => entry.id === session.id)
        ? next
        : [...next, session];
    });
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? {
              ...entry,
              layout: replaceLeafId(entry.layout, paneId, session.id),
              focusedId: session.id,
            }
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return true;
  }, []);

  const ensureOpenSession = useCallback(
    async (sessionId: string): Promise<Session | null> => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open) return open;

      const loaded = await getSession(sessionId).catch(() => null);
      if (!loaded) {
        void refreshHistory(sidebarCwd);
        return null;
      }
      const restored = await restoreSessionCheckout(loaded);
      if (restored.providerSessionId && isLiveHarness(restored.harness)) {
        bindHarnessSession(
          restored.harness,
          restored.id,
          restored.providerSessionId,
          sessionWorkCwd(restored),
        );
      }
      lastPersisted.current.set(restored.id, persistFingerprint(restored));
      if (!sessionsRef.current.some((session) => session.id === restored.id)) {
        const next = [...sessionsRef.current, restored];
        sessionsRef.current = next;
        setSessions(next);
      }
      return restored;
    },
    [refreshHistory, sidebarCwd],
  );

  const reopeningClosed = useRef(false);
  const onReopenClosedTab = useCallback(async () => {
    if (reopeningClosed.current) return;
    const entry = peekClosedWorkspaceEntry(
      recoveryRef.current,
      projectCwdRef.current,
    );
    if (!entry) return;
    reopeningClosed.current = true;
    try {
      let surfaceId = "";
      if (entry.kind === "browser") {
        surfaceId = browserIdForTab(entry.cwd, entry.browser.id);
        setBrowserWorkspaces((all) => ({
          ...all,
          [entry.cwd]: addBrowserTab(
            { ...(all[entry.cwd] ?? EMPTY_BROWSER), mode: "tab" },
            entry.browser,
          ),
        }));
      } else if (entry.kind === "tab") {
        const recovered = prepareRecoveredWorkspaceTab(entry.tab);
        const filePaneIds = new Set(
          [...recovered.editorPanes, ...recovered.terminalPanes].map(
            (pane) => pane.id,
          ),
        );
        for (const id of leafIds(recovered.layout).filter(
          (id) => !filePaneIds.has(id),
        )) {
          if (await ensureOpenSession(id)) continue;
          const stub = entry.sessionStubs?.find(
            (candidate) => candidate.id === id,
          );
          if (!stub)
            throw new Error(
              "This session is no longer available in local history.",
            );
          const session = {
            ...newSession(
              stub.harness,
              stub.cwd,
              stub.model,
              stub.runtimeMode,
              stub.modelSettings,
            ),
            ...stub,
            id,
          };
          const next = [...sessionsRef.current, session];
          sessionsRef.current = next;
          setSessions(next);
        }
        if (!tabsRef.current.some((tab) => tab.id === recovered.id)) {
          const next = [...tabsRef.current, recovered];
          tabsRef.current = next;
          setTabs(next);
        }
        surfaceId = recovered.id;
        setActiveTabId(recovered.id);
      } else {
        let target = tabsRef.current.find((tab) => tab.id === entry.tabId);
        if (target)
          target = openEditorTab(
            {
              ...target,
              focusedId: leafIds(target.layout).includes(entry.paneId)
                ? entry.paneId
                : target.focusedId,
            },
            entry.file,
          );
        else {
          const pane: EditorPane = {
            id: crypto.randomUUID(),
            activeFileId: entry.file.id,
            files: [entry.file],
          };
          target = {
            ...newTab(pane.id),
            id: crypto.randomUUID(),
            editorPanes: [pane],
          };
        }
        const restored = target;
        const next = tabsRef.current.some((tab) => tab.id === restored.id)
          ? tabsRef.current.map((tab) =>
              tab.id === restored.id ? restored : tab,
            )
          : [...tabsRef.current, restored];
        tabsRef.current = next;
        setTabs(next);
        surfaceId = restored.id;
        setActiveTabId(restored.id);
      }
      setHomeViewOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      profilesRef.current.selectProfile(
        projectlessProfileForCwd(entry.cwd) ??
          projectWorkspaceProfile(loadWorkspaceProfiles(), entry.cwd),
      );
      setProjectCwd(entry.cwd);
      viewRef.current.focus(entry.cwd, surfaceId);
      // Preserve any newer close that happened while a persisted session loaded.
      const current = recoveryRef.current;
      const popped =
        peekClosedWorkspaceEntry(current, entry.cwd) === entry
          ? popClosedWorkspaceEntry(current, entry.cwd)?.state
          : undefined;
      const next = popped ?? {
        ...current,
        closed: current.closed.filter((candidate) => candidate !== entry),
      };
      recoveryRef.current = next;
      setRecovery(next);
    } catch (error) {
      void message(error instanceof Error ? error.message : String(error), {
        title: "Reopen closed tab",
        kind: "error",
      });
    } finally {
      reopeningClosed.current = false;
    }
  }, [ensureOpenSession]);

  const onAskInboxItem = useCallback(
    (item: InboxItem): Promise<string> => {
      const key = inboxAskKey(item);
      const pending = openingInboxSessions.current.get(key);
      if (pending) return pending;
      const opening = (async () => {
        let session = sessionsRef.current.find(
          (entry) => entry.inboxAsk?.key === key,
        );
        if (!session) {
          const candidate = item.projectPath || sidebarCwd;
          const cwd =
            candidate && candidate !== "~"
              ? candidate
              : await invoke<string>("default_cwd");
          const description =
            item.provider === "linear" && item.id
              ? (
                  peekLinearIssueDetails(item.id) ??
                  (await linearIssueDetails(item.id))
                ).body
              : undefined;
          session = {
            ...newDefaultSession(cwd),
            title: `Ask · ${item.title}`,
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
              description,
            },
          };
          sessionsRef.current = [...sessionsRef.current, session];
          setSessions(sessionsRef.current);
        }
        return session.id;
      })();
      openingInboxSessions.current.set(key, opening);
      void opening.then(
        () => openingInboxSessions.current.delete(key),
        () => openingInboxSessions.current.delete(key),
      );
      return opening;
    },
    [sidebarCwd],
  );

  const onRestartInboxAsk = useCallback(
    async (item: InboxItem): Promise<string> => {
      const id = await onAskInboxItem(item);
      const current = sessionsRef.current.find((session) => session.id === id)!;
      removingSessionIds.current.add(id);
      try {
        await stopSessionForRemoval(id);
        await Promise.all(
          sessionChildHarnesses(current).map((harness) =>
            forgetHarnessSession(harness, id),
          ),
        );
        const fresh = {
          ...newSession(
            current.harness,
            current.cwd,
            current.model,
            current.runtimeMode,
            current.modelSettings,
          ),
          title: current.title,
          inboxAsk: current.inboxAsk,
        };
        const next = sessionsRef.current.map((session) =>
          session.id === id ? fresh : session,
        );
        sessionsRef.current = next;
        setSessions(next);
        setInboxAskPortal((portal) =>
          portal?.sessionId === id
            ? { ...portal, sessionId: fresh.id }
            : portal,
        );
        return fresh.id;
      } finally {
        removingSessionIds.current.delete(id);
      }
    },
    [onAskInboxItem, stopSessionForRemoval],
  );

  useEffect(() => {
    if (!inboxAskPortal || !inboxViewOpen) return;
    setComposerFocused(true);
  }, [inboxAskPortal, inboxViewOpen]);

  const onSelectHistorySession = useCallback(
    async (sessionId: string) => {
      clearReturnFocus();
      if (await activityWindowBridgeRef.current.showSession?.(sessionId))
        return;
      leaveExpandedPreview();
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      if (focusOpenSession(sessionId)) return;
      let session = await ensureOpenSession(sessionId);
      if (!session || session.inboxAsk) return;
      const parentId =
        session.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!session) return;
        if (focusOpenSession(session.id)) return;
      }
      revealProjectTask(session.cwd);
      profilesRef.current.selectProfile(
        projectWorkspaceProfile(loadWorkspaceProfiles(), session.cwd),
      );
      setProjectCwd(session.cwd);
      setRecents(rememberProject(session.cwd));
      if (
        sameProjectPath(session.cwd, projectCwdRef.current) &&
        replaceBlankPaneWithSession(session)
      )
        return;
      const tab = newTab(session.id);
      appendTab(tab, session.cwd);
      viewRef.current.focus(normalizeProjectPath(session.cwd), tab.id);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [
      appendTab,
      ensureOpenSession,
      focusOpenSession,
      replaceBlankPaneWithSession,
      clearReturnFocus,
    ],
  );

  const onPlaceSessionOnPane = useCallback(
    async (sessionId: string, targetId: string, edge: PaneEdge) => {
      if (sessionId === targetId) return;
      const targetTab = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(targetId),
      );
      if (!targetTab) return;

      const alreadyHere = leafIds(targetTab.layout).includes(sessionId);
      if (!alreadyHere) {
        const session = await ensureOpenSession(sessionId);
        if (!session) return;
      }

      const tab = tabsRef.current.find((entry) => entry.id === targetTab.id);
      if (!tab || !leafIds(tab.layout).includes(targetId)) return;

      const replaceTarget =
        !leafIds(tab.layout).includes(sessionId) &&
        isBlankSession(
          sessionsRef.current.find((entry) => entry.id === targetId),
        );

      if (replaceTarget) {
        lastPersisted.current.delete(targetId);
        const blank = sessionsRef.current.find(
          (entry) => entry.id === targetId,
        );
        if (blank) void forgetHarnessSession(blank.harness, targetId);
      }

      const result = applyPlaceSessionOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sessionId,
        targetId,
        edge,
        replaceTarget,
        scope: tabCloseScope,
        createReplacement: (seed) =>
          newSplitSession(seed, projectCwdRef.current),
      });
      if (!result) return;

      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(true);
    },
    [ensureOpenSession, tabCloseScope],
  );

  const onRenameHistorySession = useCallback(
    async (sessionId: string, displayTitle: string) => {
      const trimmed = displayTitle.trim();
      if (!trimmed) return;

      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open) {
        const title = formatSessionTitle(open.harness, trimmed);
        const updated = { ...open, title };
        setSessions((prev) =>
          prev.map((session) => (session.id === sessionId ? updated : session)),
        );
        persistSession(updated);
      } else {
        const restored = await getSession(sessionId).catch(() => null);
        if (!restored) {
          void refreshHistory(sidebarCwd);
          return;
        }
        const updated = {
          ...restored,
          title: formatSessionTitle(restored.harness, trimmed),
        };
        await upsertSession(updated).catch(() => undefined);
        lastPersisted.current.set(sessionId, persistFingerprint(updated));
      }
      void refreshHistory(sidebarCwd);
    },
    [persistSession, refreshHistory, sidebarCwd],
  );

  const onRemoveHistorySession = useCallback(
    async (
      sessionId: string,
      mode: "archive" | "delete",
      skipDeleteConfirm = false,
    ): Promise<boolean> => {
      if (removingSessionIds.current.has(sessionId)) return false;
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      const summary = history.find((entry) => entry.id === sessionId);
      const seed = open ?? summary;
      const label = seed
        ? sessionDisplayTitle(seed.title, seed.harness)
        : "this session";
      if (
        mode === "delete" &&
        !skipDeleteConfirm &&
        !window.confirm(`Delete “${label}”?`)
      )
        return false;

      removingSessionIds.current.add(sessionId);
      pendingPersist.current.delete(sessionId);
      let savedSummary: SessionSummary | undefined;
      try {
        return await runSessionRemoval({
          sessionId,
          scope: tabCloseScope,
          readWorkspace: () => ({
            tabs: tabsRef.current,
            sessions: sessionsRef.current,
            activeTabId: activeTabIdRef.current,
            dirtyFiles: dirtyFilesRef.current,
          }),
          createReplacement: (latest) =>
            newSession(
              latest?.harness ?? seed?.harness ?? "cursor",
              latest?.cwd ?? seed?.cwd ?? sidebarCwd,
              latest?.model ?? seed?.model,
              loadDefaultRuntimeMode(),
              latest?.modelSettings ?? open?.modelSettings,
            ),
          confirmClose: async (closedTabs) => {
            const files = filesInWorkspaceTabs(closedTabs);
            const unsaved = files.some(
              (file) =>
                isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
            );
            if (
              unsaved &&
              !(await confirmDiscardUnsaved(
                `${mode === "archive" ? "Archive" : "Delete"} this conversation with unsaved files?`,
              ))
            )
              return false;
            const terminals = files.filter((file) => file.terminal);
            return (
              terminals.length === 0 || (await confirmCloseTerminals(terminals))
            );
          },
          stop: async () => {
            const run =
              mode === "delete"
                ? orchestrator.forSession(sessionId)
                : undefined;
            if (run && (run.status === "active" || run.status === "paused"))
              await orchestrator.stopRun(run.leadId);
            await stopSessionForRemoval(sessionId);
          },
          updateSession: (stopped) => {
            const next = sessionsRef.current.map((session) =>
              session.id === sessionId ? stopped : session,
            );
            sessionsRef.current = next;
            setSessions(next);
          },
          persist: async (latest) => {
            if (latest) await flushSessionCheckpoint(sessionId);
            if (mode === "delete") {
              await orchestrator.deleteSession(sessionId, () =>
                deleteSession(sessionId),
              );
              const released = sessionsRef.current.map((session) =>
                releaseOrchestrationWorker(session, sessionId),
              );
              sessionsRef.current = released;
              setSessions(released);
              for (const [id, pending] of pendingPersist.current) {
                pendingPersist.current.set(
                  id,
                  releaseOrchestrationWorker(pending, sessionId),
                );
              }
              const releaseSummary = (entry: SessionSummary) =>
                entry.orchestrationLeadId === sessionId
                  ? { ...entry, orchestrationLeadId: undefined }
                  : entry;
              setHistory((current) => current.map(releaseSummary));
              return;
            }
            if (latest && shouldPersistSession(latest)) {
              const saved = await upsertSession(latest);
              if (!saved)
                throw new Error("The conversation could not be saved.");
              savedSummary = saved;
            }
            await setSessionArchived(sessionId, true);
          },
          commit: (removal) => {
            discardEditorDrafts(
              filesInWorkspaceTabs(removal.closedTabs).filter(isFilesystemTab),
            );
            const latest = sessionsRef.current.find(
              (session) => session.id === sessionId,
            );
            const harnesses: HarnessId[] = latest
              ? sessionChildHarnesses(latest)
              : [seed?.harness ?? "cursor"];
            for (const harness of harnesses) {
              void forgetHarnessSession(harness, sessionId);
            }
            lastPersisted.current.delete(sessionId);
            pendingPersist.current.delete(sessionId);
            const closingFiles = filesInWorkspaceTabs(removal.closedTabs);
            setDirtyFiles((current) => {
              const next = new Set(current);
              for (const file of closingFiles) next.delete(file.id);
              return next;
            });
            sessionsRef.current = removal.sessions;
            tabsRef.current = removal.tabs;
            setSessions(removal.sessions);
            setTabs(removal.tabs);
            if (removal.activeTabId !== activeTabIdRef.current) {
              activateTab(removal.activeTabId);
            }
            const activeTab = removal.tabs.find(
              (tab) => tab.id === removal.activeTabId,
            );
            setComposerFocused(
              removal.sessions.some(
                (session) => session.id === activeTab?.focusedId,
              ),
            );
            if (mode === "archive") {
              const archived =
                savedSummary ??
                summary ??
                (latest && summaryFromSession(latest));
              if (archived) {
                setHistory((current) =>
                  mergeHistorySummary(current, { ...archived, archived: true }),
                );
              }
            } else {
              setHistory((current) =>
                current.filter((entry) => entry.id !== sessionId),
              );
              void refreshHistory(sidebarCwd);
            }
          },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void message(`Could not ${mode} this conversation.\n\n${detail}`, {
          title: "Aven",
          kind: "error",
        });
        return false;
      } finally {
        removingSessionIds.current.delete(sessionId);
      }
    },
    [
      activateTab,
      history,
      refreshHistory,
      sidebarCwd,
      stopSessionForRemoval,
      tabCloseScope,
    ],
  );

  const onArchiveHistorySession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (archived) return onRemoveHistorySession(sessionId, "archive");
      if (removingSessionIds.current.has(sessionId)) return false;
      try {
        await setSessionArchived(sessionId, false);
        setHistory((current) =>
          current.map((entry) =>
            entry.id === sessionId ? { ...entry, archived: false } : entry,
          ),
        );
        return true;
      } catch (error) {
        void message(
          `Could not unarchive this conversation.\n\n${String(error)}`,
          {
            title: "Aven",
            kind: "error",
          },
        );
        return false;
      }
    },
    [onRemoveHistorySession],
  );

  const onArchiveFocusedSession = useCallback(
    (event: KeyboardEvent) => {
      archiveFocusedSession(
        event,
        {
          activeTabId: activeTabIdRef.current,
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          projectTerminalFocused: projectTerminalFocusedRef.current,
          surfaceOpen: Boolean(
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            whatsNewVersionRef.current,
          ),
        },
        (sessionId) => {
          void onArchiveHistorySession(sessionId, true);
        },
      );
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySession = useCallback(
    async (sessionId: string, pinned: boolean) => {
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (open && shouldPersistSession(open)) {
        await upsertSession(open).catch(() => undefined);
      }
      await setSessionPinned(sessionId, pinned).catch(() => undefined);
      setHistory((current) => {
        const existing = current.find((entry) => entry.id === sessionId);
        if (existing) {
          return mergeProjectHistorySummary(current, { ...existing, pinned });
        }
        if (!open) return current;
        return mergeProjectHistorySummary(current, {
          ...summaryFromSession(open),
          pinned,
        });
      });
    },
    [],
  );

  const onArchiveHistorySessions = useCallback(
    async (sessionIds: readonly string[], archived: boolean) => {
      for (const sessionId of sessionIds) {
        if (!(await onArchiveHistorySession(sessionId, archived))) break;
      }
    },
    [onArchiveHistorySession],
  );

  const onPinHistorySessions = useCallback(
    async (sessionIds: readonly string[], pinned: boolean) => {
      await Promise.all(
        sessionIds.map((sessionId) => onPinHistorySession(sessionId, pinned)),
      );
    },
    [onPinHistorySession],
  );

  const onDeleteHistorySession = useCallback(
    (sessionId: string) => onRemoveHistorySession(sessionId, "delete"),
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessions = useCallback(
    async (sessionIds: readonly string[]) => {
      if (sessionIds.length === 0) return;
      if (
        !window.confirm(
          `Delete ${sessionIds.length} selected conversations? This can’t be undone.`,
        )
      )
        return;
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) break;
      }
    },
    [onRemoveHistorySession],
  );

  const onFocusDir = useCallback(
    (dir: FocusDir) => {
      if (!activeTab) return;
      const next = neighborLeafId(activeTab.layout, activeTab.focusedId, dir);
      if (next) onFocusPane(next);
    },
    [activeTab, onFocusPane],
  );

  const onRatio = useCallback(
    (tabId: string, splitId: string, index: number, ratio: number) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, layout: setSplitRatio(t.layout, splitId, index, ratio) }
            : t,
        ),
      );
    },
    [],
  );

  const onCwdChange = useCallback(
    (sessionId: string, cwd: string) => {
      const normalized = normalizeProjectPath(cwd);
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      const previous = current?.cwd;
      if (
        previous &&
        isProjectlessCwd(previous) &&
        !isProjectlessCwd(normalized)
      ) {
        if (
          loadRecents().some((project) =>
            sameProjectPath(project.path, normalized),
          )
        ) {
          profilesRef.current.selectProfile(
            projectWorkspaceProfile(loadWorkspaceProfiles(), normalized),
          );
        } else profilesRef.current.assignProject(normalized);
      }
      // Threads stay bound to their project. Switching from the composer opens a
      // new tab instead of retargeting the conversation.
      if (
        current &&
        previous &&
        looksLikeProject(previous) &&
        !sameProjectPath(previous, normalized) &&
        !isBlankSession(current)
      ) {
        setProjectCwd(normalized);
        setRecents(rememberProject(normalized));
        const session = newSession(
          current.harness,
          normalized,
          current.model,
          current.runtimeMode,
          current.modelSettings,
        );
        const tab = newTab(session.id);
        setSessions((prev) => [...prev, session]);
        appendTab(tab, normalized);
        setActiveTabId(tab.id);
        setComposerFocused(true);
        return;
      }
      if (
        previous &&
        !sameProjectPath(previous, normalized) &&
        previous !== "~"
      ) {
        void keepSessionChanges(sessionId, previous).catch(() => undefined);
      }
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                cwd: normalized,
                branch: undefined,
                worktreeCwd: undefined,
              }
            : s,
        ),
      );
      // The session's project just moved in place; a group only holds tabs that
      // share one project, so drop this tab out if it no longer matches.
      setTabs((prev) => {
        const tab = prev.find((t) => leafIds(t.layout).includes(sessionId));
        // The tab's visible project follows its focused pane; a background
        // pane changing project doesn't change what the group check should see.
        if (!tab?.groupId || tab.focusedId !== sessionId) return prev;
        const newProject = projectName(normalized);
        const othersProject = tabGroupProject(
          prev.filter((t) => t.id !== tab.id),
          tab.groupId,
          projectOfTab,
        );
        if (othersProject && newProject && othersProject !== newProject) {
          return removeTabFromGroup(prev, tab.id);
        }
        return prev;
      });
      notifyReviewChanged(sessionId);
    },
    [appendTab, projectOfTab],
  );

  const onBranchChange = useCallback(
    (sessionId: string) => {
      notifyGitChanged();
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current || (!current.branch && !current.worktreeCwd)) return;
      if (current.worktreeCwd && current.providerSessionId) {
        void forgetHarnessSession(current.harness, sessionId);
      }
      const next = {
        ...current,
        branch: undefined,
        worktreeCwd: undefined,
        ...(current.worktreeCwd ? { providerSessionId: undefined } : {}),
      };
      setSessions((prev) => prev.map((s) => (s.id === sessionId ? next : s)));
      persistSession(next);
      notifyReviewChanged(sessionId);
    },
    [persistSession],
  );

  const onSelectProject = useCallback(
    (path: string, restoreWorkspace = false) => {
      clearReturnFocus();
      setHomeViewOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      const normalized = normalizeProjectPath(path);
      if (!looksLikeProject(normalized)) return;
      if (!restoreWorkspace) revealProjectTask(normalized);
      profilesRef.current.selectProfile(
        projectWorkspaceProfile(loadWorkspaceProfiles(), normalized),
      );

      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      const current = activeWorkspace
        ? sessionsRef.current.find(
            (session) => session.id === activeWorkspace.focusedId,
          )
        : undefined;
      const currentCwd =
        current?.cwd ??
        (activeWorkspace ? focusedFileTab(activeWorkspace)?.cwd : undefined);
      if (currentCwd && sameProjectPath(currentCwd, normalized)) return;

      const match = findTabForProject(
        tabsRef.current,
        sessionsRef.current,
        normalized,
        lastTabByProjectRef.current[normalized],
      );
      if (match) {
        // Attached tabs update cwd and recents inside activateTab. Detached
        // tabs only reveal their own window, so retain this window's update.
        if (detachedIdsRef.current.has(match.id)) {
          setProjectCwd(normalized);
          setRecents(rememberProject(normalized));
        }
        activateTab(match.id, true);
        return;
      }

      const seed = current ?? sessionsRef.current[0];
      const session = newSession(
        seed?.harness ?? "claude",
        normalized,
        seed?.model,
        loadDefaultRuntimeMode(),
        seed?.modelSettings,
      );
      const tab = newTab(session.id);
      setProjectCwd(normalized);
      setRecents(rememberProject(normalized));
      setSessions((prev) => [...prev, session]);
      appendTab(tab, normalized);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [activateTab, appendTab, clearReturnFocus],
  );

  const onSelectProfile = useCallback(
    (id: string) => {
      setWorkspaceAction(null);
      setAddProjectAnchor(null);
      setBranchAnchor(null);
      setPrAnchor(null);
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      restoreProfileWorkspace(
        id,
        profilesRef.current.selectProfile,
        onSelectProject,
      );
    },
    [onSelectProject],
  );
  const restoredProfile = useRef(false);
  useEffect(() => {
    if (restoredProfile.current) return;
    restoredProfile.current = true;
    const current = profilesRef.current;
    const target = current.selectProfile(current.activeProfileId);
    if (
      looksLikeProject(target) &&
      !sameProjectPath(target, projectCwdRef.current)
    )
      onSelectProject(target, true);
  }, [onSelectProject]);
  const onCreatedProject = useCallback(
    (path: string, profileId: string) => {
      const current = profilesRef.current;
      current.assignProject(path, profileId);
      current.selectProfile(profileId);
      onSelectProject(path);
    },
    [onSelectProject],
  );
  const pickProject = useCallback(async () => {
    const profileId = profilesRef.current.activeProfileId;
    setAddProjectAnchor(null);
    const path = await pickFolder();
    if (path) onCreatedProject(path, profileId);
  }, [onCreatedProject]);
  const onNewProjectTask = useCallback(
    (path: string) => {
      revealProjectTask(path);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      const session = newDefaultSession(path);
      const tab = newTab(session.id);
      setProjectCwd(path);
      setRecents(rememberProject(path));
      setSessions((previous) => [...previous, session]);
      appendTab(tab, path);
      setActiveTabId(tab.id);
      setComposerFocused(true);
    },
    [appendTab],
  );

  const onRemoveProject = useCallback(
    (path: string, options: { purgeData: boolean }) => {
      const normalized = normalizeProjectPath(path);
      const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
      const remaining = options.purgeData
        ? forgetProject(normalized)
        : archiveProject(normalized);
      setRecents(remaining);

      const tabs = tabsRef.current;
      const sessions = sessionsRef.current;
      const projectTabs = filterTabsForProject(tabs, sessions, normalized);
      const projectTabIds = new Set(projectTabs.map((tab) => tab.id));
      const projectSessions = sessions.filter((session) =>
        sameProjectPath(session.cwd, normalized),
      );
      const projectSessionIds = new Set(
        projectSessions.map((session) => session.id),
      );

      if (options.purgeData) {
        for (const session of projectSessions) {
          pendingPersist.current.delete(session.id);
          if (session.busy) {
            turnGen.current.set(
              session.id,
              (turnGen.current.get(session.id) ?? 0) + 1,
            );
            for (const id of sessionChildHarnesses(session)) {
              void cancelHarnessTurn(id, session.id);
            }
          }
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
          lastPersisted.current.delete(session.id);
        }
        void removeProjectData(normalized);
      } else {
        for (const session of projectSessions) {
          if (session.busy) continue;
          persistSession(session);
          pendingPersist.current.delete(session.id);
          for (const id of sessionChildHarnesses(session)) {
            void forgetHarnessSession(id, session.id);
          }
        }
      }

      let nextTabs = tabs.filter((tab) => !projectTabIds.has(tab.id));
      let nextSessions = sessions.filter((session) => {
        if (!projectSessionIds.has(session.id)) return true;
        return !options.purgeData && session.busy;
      });
      let nextActiveTabId = activeTabIdRef.current;

      if (nextTabs.length === 0) {
        const session = newDefaultSession("~");
        const tab = newTab(session.id);
        nextSessions = [...nextSessions, session];
        nextTabs = [tab];
        nextActiveTabId = tab.id;
      } else if (projectTabIds.has(nextActiveTabId)) {
        nextActiveTabId = nextTabs[0]?.id ?? nextActiveTabId;
      }

      sessionsRef.current = nextSessions;
      tabsRef.current = nextTabs;
      activeTabIdRef.current = nextActiveTabId;
      setSessions(nextSessions);
      setTabs(nextTabs);
      if (nextActiveTabId !== activeTabId) {
        setActiveTabId(nextActiveTabId);
      }
      setDirtyFiles((prev) => {
        const updated = new Set(prev);
        for (const tab of projectTabs) {
          for (const file of [
            ...tab.editorPanes.flatMap((pane) => pane.files),
            ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
          ]) {
            updated.delete(file.id);
          }
        }
        return updated;
      });
      setProjectTerminals((prev) =>
        prev.filter((dock) => !sameProjectPath(dock.projectPath, normalized)),
      );

      if (wasCurrent) {
        const profileState = loadWorkspaceProfiles();
        const next = remaining.find(
          (item) =>
            looksLikeProject(item.path) &&
            projectWorkspaceProfile(profileState, item.path) ===
              profilesRef.current.activeProfileId,
        );
        if (next) {
          onSelectProject(next.path);
          setProjectCwd(next.path);
        } else {
          setProjectCwd("~");
          setComposerFocused(true);
        }
      }
    },
    [activeTabId, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      setRecents(rememberProject(path));
      onSelectProject(path);
    },
    [onSelectProject],
  );

  const onFileMoved = useCallback((from: string, to: string) => {
    invalidateProjectFiles();
    setTabs((prev) =>
      prev.map((tab) => {
        return {
          ...tab,
          editorPanes: tab.editorPanes.map((pane) => ({
            ...pane,
            files: pane.files.map((file) =>
              isFilesystemTab(file)
                ? { ...file, path: rebasePath(file.path, from, to) }
                : file,
            ),
          })),
        };
      }),
    );
  }, []);

  const onFileDeleted = useCallback((path: string) => {
    invalidateProjectFiles();
    const dropped = new Set<string>();
    for (const tab of tabsRef.current) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (isFilesystemTab(file) && isEqualOrInside(file.path, path)) {
            dropped.add(file.id);
          }
        }
      }
    }
    setTabs((prev) =>
      prev.map((tab) =>
        dropOpenFiles(tab, (filePath) => isEqualOrInside(filePath, path)),
      ),
    );
    if (dropped.size === 0) return;
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const id of dropped) next.delete(id);
      return next;
    });
  }, []);

  const onOpenWebLink = useCallback(
    async (value: string) => {
      setHomeViewOpen(false);
      const url = normalizeBrowserUrl(value);
      if (profileHome) {
        await onNewStandalone(true, url);
        return;
      }
      const cwd = projectCwdRef.current;
      const current = normalizeBrowserWorkspace(
        browserWorkspacesRef.current[cwd] ?? EMPTY_BROWSER,
      );
      const existing = current.tabs.find((tab) => tab.url === url);
      const id = existing?.id ?? crypto.randomUUID();
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setBrowserWorkspaces((all) => ({
        ...all,
        [cwd]: existing
          ? {
              ...selectBrowserTab(all[cwd] ?? EMPTY_BROWSER, id),
              open: true,
              mode: "tab",
              expanded: true,
            }
          : addBrowserTab(
              { ...(all[cwd] ?? EMPTY_BROWSER), mode: "tab" },
              { id, url },
            ),
      }));
      viewRef.current.focus(cwd, browserIdForTab(cwd, id));
      setComposerFocused(false);
    },
    [profileHome, onNewStandalone],
  );

  const onOpenFile = useCallback<OpenFileFn>(
    (path, navigation) => {
      clearReturnFocus();
      leaveExpandedPreview();
      const requestedCwd = projectCwdRef.current;
      const requestedTab = activeTabIdRef.current;
      const requestedProfile = profilesRef.current.activeProfileId;
      void (async () => {
        const resolved =
          (await resolveOpenablePath(gitCwdRef.current, path)) ?? path;
        if (
          projectCwdRef.current !== requestedCwd ||
          profilesRef.current.activeProfileId !== requestedProfile
        )
          return;
        let cwd = requestedCwd;
        let tab =
          profileHome || detachedIdsRef.current.has(requestedTab)
            ? undefined
            : tabsRef.current.find((entry) => entry.id === requestedTab);
        if (!tab) {
          const profileId = profilesRef.current.activeProfileId;
          ({ cwd } = await ensureProjectlessWorkspace(profileId));
          if (profilesRef.current.activeProfileId !== profileId) return;
          const session = newDefaultSession(cwd);
          tab = openEditorTab(newTab(session.id), newFileTab(resolved, cwd));
          setSessions((previous) => [...previous, session]);
          appendTab(tab, cwd);
          setProjectCwd(cwd);
          setActiveTabId(tab.id);
        } else {
          const targetId = tab.id;
          const file = newFileTab(resolved, sidebarCwdRef.current);
          setTabs((prev) =>
            prev.map((entry) =>
              entry.id === targetId ? openEditorTab(entry, file) : entry,
            ),
          );
        }
        rememberOpenedFile(cwd, resolved);
        if (navigation) {
          editorNavigationToken.current += 1;
          setEditorNavigation({
            path: resolved,
            ...navigation,
            token: editorNavigationToken.current,
          });
        }
        setComposerFocused(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        viewRef.current.focus(cwd, tab.id);
      })().catch((error) =>
        message(String(error), { title: "Could not open file", kind: "error" }),
      );
    },
    [profileHome, appendTab, clearReturnFocus],
  );

  agentFileBridge.current = async (sessionId, cwd, path, navigation) => {
    const ownsSession = () =>
      sessionsRef.current.some(
        (session) =>
          session.id === sessionId &&
          sameProjectPath(sessionWorkCwd(session), cwd),
      );
    if (!ownsSession())
      throw new Error("The requesting task is no longer available.");
    if (await detachedFileBridge.current(sessionId, path, navigation)) return;
    if (!ownsSession()) throw new Error("The requesting task was closed.");
    const session = sessionsRef.current.find((item) => item.id === sessionId)!;
    const opened = openAgentFileInTabs(
      tabsRef.current,
      sessionId,
      cwd,
      path,
      detachedIdsRef.current,
    );
    flushSync(() => {
      tabsRef.current = opened.tabs;
      setTabs(opened.tabs);
      if (navigation) {
        editorNavigationToken.current += 1;
        setEditorNavigation({
          path,
          ...navigation,
          token: editorNavigationToken.current,
        });
      }
    });
    rememberOpenedFile(cwd, path);
    // Background tasks may prepare their own editor without changing profiles.
    if (sameProjectPath(projectCwdRef.current, session.cwd)) {
      clearReturnFocus();
      leaveExpandedPreview();
      setHomeViewOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setComposerFocused(false);
      viewRef.current.focus(session.cwd, opened.tabId);
    }
  };

  useEffect(
    () =>
      installInAppLinks(
        { openUrl: onOpenWebLink, openFile: onOpenFile },
        (error) => {
          void message(String(error), {
            title: "Could not open link",
            kind: "error",
          });
        },
      ),
    [onOpenWebLink, onOpenFile],
  );

  const onOpenPlan = useCallback(
    (sessionId: string, blockId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === activeTabId);
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (!tab || !session || !block) return;
      const file = newPlanTab(
        session.id,
        block.id,
        planTitle(block.text),
        session.cwd,
      );
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id ? openEditorTab(entry, file) : entry,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

  const onFileDirtyChange = useCallback((fileId: string, dirty: boolean) => {
    setDirtyFiles((prev) => {
      if (prev.has(fileId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  }, []);

  /** The editor reports 0 as it unmounts, so closed tabs drop out on their own. */
  const onFileErrorCountChange = useCallback(
    (fileId: string, count: number) => {
      setFileErrorCounts((prev) => {
        if ((prev.get(fileId) ?? 0) === count) return prev;
        const next = new Map(prev);
        if (count > 0) next.set(fileId, count);
        else next.delete(fileId);
        return next;
      });
    },
    [],
  );

  const onSelectFileSurface = useCallback((paneId: string, fileId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          { ...tab, focusedId: paneId },
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, activeFileId: fileId } : pane,
          ),
        );
      }),
    );
    setComposerFocused(false);
  }, []);

  const onModelChange = useCallback(
    (sessionId: string, harness: HarnessId, model: string) => {
      const current = sessionsRef.current.find((s) => s.id === sessionId);
      if (!current) return;
      if (isPreparingHandoff(current)) return;
      const resolved = resolveModel(harness, model);
      if (current.modelSettings) {
        saveLastModelSettings(current.modelSettings, "fill");
      }
      const modelSettings = preferredModelSettings(
        resolved,
        current.modelSettings,
      );
      const plan = planComposerSwitch(current, harness);
      if (plan.kind === "empty") {
        void forgetHarnessSession(plan.forget, sessionId);
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const next = withHarnessChoice(
            s,
            harness,
            resolved.id,
            modelSettings,
          );
          if (plan.kind === "arm") {
            return { ...next, pendingSwitch: plan.pending };
          }
          if (plan.kind === "revert") {
            return {
              ...next,
              pendingSwitch: undefined,
              ...(plan.restoreProviderSessionId
                ? { providerSessionId: plan.restoreProviderSessionId }
                : { providerSessionId: undefined }),
            };
          }
          if (plan.kind === "empty") {
            return { ...next, pendingSwitch: undefined };
          }
          return next;
        }),
      );
    },
    [],
  );

  const onModelSettingsChange = useCallback(
    (sessionId: string, modelSettings: Record<string, string>) => {
      saveLastModelSettings(modelSettings);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, modelSettings } : s)),
      );
    },
    [],
  );

  const onRuntimeModeChange = useCallback(
    (sessionId: string, runtimeMode: RuntimeMode) => {
      saveDefaultRuntimeMode(runtimeMode);
      setDefaultAccess(runtimeMode);
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, runtimeMode } : s)),
      );
    },
    [],
  );

  const onSubmit = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: {
        secondOpinion?: SecondOpinionMeta;
        followUpBehavior?: FollowUpBehavior;
        noteCard?: NoteComposerCard;
        handoffCard?: HandoffComposerCard;
        queuedMessageId?: string;
        intent?: TurnIntent;
        planBlockId?: string;
        buildTarget?: PlanBuildTarget;
        managed?: boolean;
        onSettled?: (outcome: ControlOutcome) => void;
      },
    ) => {
      const controlError = orchestrator.submissionError(
        sessionId,
        options?.managed,
      );
      if (controlError) {
        enqueueHarnessEvent(sessionId, { type: "status", text: controlError });
        flushHarnessEvents();
        return false;
      }
      if (options?.managed) {
        const target = sessionsRef.current.find((s) => s.id === sessionId);
        if (
          !target ||
          target.busy ||
          !!target.queuedMessages?.length ||
          target.pendingSwitch ||
          isPreparingHandoff(target) ||
          removingSessionIds.current.has(sessionId)
        ) {
          options.onSettled?.({
            status: "failed",
            text: "",
            error: "Session is unavailable or already running",
          });
          return false;
        }
      }
      if (removingSessionIds.current.has(sessionId)) return false;
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (!storedCurrent) return false;
      const current = options?.buildTarget
        ? withPlanBuildTarget(storedCurrent, options.buildTarget)
        : storedCurrent;
      const controlledTurn =
        !!options?.managed ||
        orchestrationOwnsTurn(orchestrator.forSession(sessionId));
      const intent = options?.intent ?? "default";
      if (intent === "orchestrate") {
        try {
          const run = orchestrator.forSession(sessionId);
          if (run && ["active", "paused"].includes(run.status))
            throw new Error(
              "Stop the current orchestration run before preparing another proposal.",
            );
        } catch (error) {
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: error instanceof Error ? error.message : String(error),
          });
          flushHarnessEvents();
          return false;
        }
      }
      const approvedPlan = options?.planBlockId
        ? current.blocks.find(
            (block) =>
              block.id === options.planBlockId && block.role === "plan",
          )
        : undefined;
      if (intent === "build" && !approvedPlan?.text.trim()) return false;
      if (options?.queuedMessageId) {
        const mode =
          options.followUpBehavior === "steer" ? "steer" : "dispatch";
        if (!queuedMessageForSubmit(current, options.queuedMessageId, mode)) {
          return false;
        }
      }
      const noteCard =
        options && "noteCard" in options ? options.noteCard : current.noteCard;
      const handoffCard =
        options && "handoffCard" in options
          ? options.handoffCard
          : current.handoffCard;
      if (
        !text.trim() &&
        attachments.length === 0 &&
        !noteCard &&
        !handoffCard
      ) {
        return false;
      }
      if (isPreparingHandoff(current)) return false;
      const workCwd = sessionWorkCwd(current);
      const submittedText = intent === "build" ? "Build approved plan" : text;
      const rawCommand = isNativeCommandPrompt(submittedText, current.harness);
      const harnessText = rawCommand
        ? submittedText
        : composeNoteMessage(noteCard, submittedText);

      const pendingSwitch =
        current.pendingSwitch && current.pendingSwitch.from !== current.harness
          ? current.pendingSwitch
          : null;

      const followUpBehavior =
        intent === "plan" || intent === "orchestrate"
          ? "queue"
          : (options?.followUpBehavior ?? loadFollowUpBehavior());
      if (
        shouldEnqueueSubmission(
          current,
          followUpBehavior,
          options?.queuedMessageId,
        )
      ) {
        // An existing queue row stays queued when this provider cannot steer.
        if (options?.queuedMessageId) return false;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  inboxCard: rawCommand ? s.inboxCard : undefined,
                  noteCard: rawCommand ? s.noteCard : undefined,
                  handoffCard: rawCommand ? s.handoffCard : undefined,
                  queuedMessages: [
                    ...(s.queuedMessages ?? []),
                    {
                      id: crypto.randomUUID(),
                      text,
                      attachments,
                      noteCard,
                      handoffCard,
                      intent,
                    },
                  ],
                  queueStatus: s.queueStatus === "paused" ? "paused" : "active",
                }
              : s,
          ),
        );
        return;
      }

      if (current.busy && !pendingSwitch) {
        const visible = displayAttachments(attachments);
        const cards = userTurnCards(noteCard);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== sessionId) return s;
            let next: Session = {
              ...s,
              inboxCard: rawCommand ? s.inboxCard : undefined,
              noteCard: rawCommand ? s.noteCard : undefined,
              handoffCard: rawCommand ? s.handoffCard : undefined,
            };
            if (options?.queuedMessageId) {
              next = dequeueQueuedMessage(next, options.queuedMessageId);
            }
            return appendSteerUser(next, submittedText, visible, cards);
          }),
        );
        const steeredGeneration = turnGen.current.get(sessionId);
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = await preparePrompt(harnessText, {
              harness: current.harness,
              sessionId,
              cwd: workCwd,
            });
            const browserPrompt = rawCommand
              ? prompt
              : await prepareAgentBrowserPrompt(prompt, {
                  sessionId,
                  cwd: workCwd,
                });
            await steerHarnessTurn({
              harness: current.harness,
              sessionId,
              cwd: workCwd,
              model: current.model,
              modelSettings: current.modelSettings,
              text: inboxAskPrompt(
                rawCommand ? undefined : current.inboxAsk,
                browserPrompt,
              ),
              attachments: prepared,
            });
          } catch (error: unknown) {
            if (turnGen.current.get(sessionId) !== steeredGeneration) return;
            // Only the follow-up failed. The original turn still owns its
            // streams, completion, and activity outcome.
            flushHarnessEvents();
            setSessions((prev) =>
              turnGen.current.get(sessionId) !== steeredGeneration
                ? prev
                : prev.map((session) =>
                    session.id === sessionId
                      ? appendSteerFailure(session, error)
                      : session,
                  ),
            );
          }
        })();
        return;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const activityTurnId = `${sessionId}:turn:${crypto.randomUUID()}`;
      activityTurnIds.current.set(sessionId, activityTurnId);
      failedActivityTurns.current.delete(sessionId);
      const proposalId =
        intent === "orchestrate" ? crypto.randomUUID() : undefined;
      let proposalDraft: OrchestrationProposal | undefined = proposalId
        ? {
            version: 1,
            leadId: sessionId,
            cwd: current.cwd,
            request: harnessText,
            author: {
              harness: current.harness,
              model: current.model,
              name: resolveModel(current.harness, current.model).name,
            },
            settings: { choices: [], maxWorkers: 2 },
            status: "planning",
            title: "Orchestration plan",
            summary: "",
            tasks: [],
          }
        : undefined;
      const isFirstTurn = current.blocks.length === 0;
      const placeholderTitle = canReplaceSessionTitle(
        current.title,
        current.harness,
        HARNESS_LABEL[current.harness],
      );
      const titleSeed =
        isFirstTurn &&
        !current.inboxCard &&
        !current.noteCard &&
        placeholderTitle
          ? titleFromPrompt(submittedText, current.harness, attachments)
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ??
        (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText =
        card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText;
      const cards = {
        ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
        // The orchestrator writes these turns, not the user; hide them.
        ...(options?.managed ? { internal: true } : {}),
      };
      const live = isLiveHarness(current.harness);
      const queuedHandoff =
        live && !pendingSwitch ? pendingHandoff(current) : null;

      if (pendingSwitch && current.busy) {
        void cancelHarnessTurn(pendingSwitch.from, sessionId);
      }

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const selected = options?.buildTarget
            ? withPlanBuildTarget(s, options.buildTarget)
            : s;
          const titled = isFirstTurn ? titleSeed : selected.title;
          let next: Session = {
            ...selected,
            inboxCard: rawCommand ? s.inboxCard : undefined,
            noteCard: rawCommand ? s.noteCard : undefined,
            handoffCard: rawCommand ? s.handoffCard : undefined,
          };
          if (approvedPlan && intent === "build") {
            next = {
              ...next,
              blocks: next.blocks.map((block) =>
                block.id === approvedPlan.id
                  ? {
                      ...block,
                      plan: {
                        ...(block.plan ?? { status: "ready" as const }),
                        status: "building" as const,
                        approvedText: block.text,
                      },
                    }
                  : block,
              ),
            };
          }
          if (options?.queuedMessageId) {
            next = dequeueQueuedMessage(next, options.queuedMessageId);
          }
          if (!live) {
            return {
              ...next,
              title: titled,
              pendingSwitch: undefined,
              busy: false,
              blocks: [
                ...next.blocks,
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  text: visibleText,
                  ...(visible.length > 0 ? { attachments: visible } : {}),
                  ...cards,
                },
                {
                  id: crypto.randomUUID(),
                  role: "system",
                  text: `${next.harness} is not connected yet — install and sign in to that provider, then retry.`,
                },
              ],
            };
          }
          if (pendingSwitch) {
            const sealed = stopStreaming({
              ...next,
              title: titled,
              pendingSwitch: undefined,
            });
            return appendUser(
              appendPreparingHandoff(sealed, pendingSwitch.from, next.harness),
              visibleText,
              visible,
              cards,
            );
          }
          return appendUser(
            { ...next, title: titled },
            visibleText,
            visible,
            cards,
          );
        }),
      );

      if (isFirstTurn && live && placeholderTitle) {
        void generateHarnessTitle(current.harness, {
          sessionId,
          cwd: workCwd,
          message:
            harnessText || attachments.map((file) => file.name).join(", "),
        })
          .then((title) => {
            if (!title) return;
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                if (!canReplaceSessionTitle(s.title, s.harness, titleSeed)) {
                  return s;
                }
                return { ...s, title: formatSessionTitle(s.harness, title) };
              }),
            );
          })
          .catch(() => undefined);
      }

      if (!live) {
        announceActivity(
          { ...current, title: titleSeed },
          {
            id: `${activityTurnId}:failed`,
            outcome: "failed",
            summary: `${HARNESS_TITLE[current.harness]} is not connected. Install and sign in, then retry.`,
          },
        );
        activityTurnIds.current.delete(sessionId);
        if (pendingSwitch) {
          void forgetHarnessSession(pendingSwitch.from, sessionId);
        }
        options?.onSettled?.({
          status: "failed",
          text: "",
          error: "Harness is not connected",
        });
        return;
      }

      if (proposalId && proposalDraft) {
        const draft = proposalDraft;
        setSessions((prev) =>
          prev.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  blocks: [...session.blocks, proposalBlock(proposalId, draft)],
                }
              : session,
          ),
        );
      }

      let controlOutcome: ControlOutcome = {
        status: "failed",
        text: "",
        error: "Turn did not complete",
      };
      let controlText = "";
      let proposalText = "";
      let nativeProposalText = "";
      void (async () => {
        if (proposalDraft && proposalId) {
          const settings = await discoverOrchestrationSettings();
          if (turnGen.current.get(sessionId) !== gen) return;
          proposalDraft = { ...proposalDraft, settings };
          const discovering = proposalDraft;
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId
                ? withOrchestrationProposal(session, proposalId, discovering)
                : session,
            ),
          );
        }
        let wrap = handoffCard
          ? {
              from: handoffCard.from,
              to: current.harness,
              text: handoffCard.brief,
            }
          : queuedHandoff;
        if (pendingSwitch) {
          let agentText = "";
          if (
            shouldAskOutgoingAgent(current) &&
            isLiveHarness(pendingSwitch.from)
          ) {
            try {
              agentText = await requestOutgoingHandoff({
                harness: pendingSwitch.from,
                sessionId,
                cwd: workCwd,
                model: pendingSwitch.fromModel,
                modelSettings: pendingSwitch.fromSettings,
                userRequest: text,
              });
            } catch {
              agentText = "";
            }
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          const latest = sessionsRef.current.find((s) => s.id === sessionId);
          const brief = chooseHandoffBrief(
            agentText,
            buildDeterministicHandoff(latest ?? current, text),
          );
          await forgetHarnessSession(pendingSwitch.from, sessionId);
          if (turnGen.current.get(sessionId) !== gen) return;
          wrap = { from: pendingSwitch.from, to: current.harness, text: brief };
        }

        const revealHandoff = (brief: string) => {
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id !== sessionId || !isPreparingHandoff(s)) return s;
              return { ...completeHandoff(s, brief), busy: true };
            }),
          );
        };

        const planEventKey = `turn:${gen}`;
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        let failureSummary: string | undefined;
        const routePlanEvent = (event: HarnessEvent): HarnessEvent | null => {
          if (event.type === "session.error") {
            providerFailureSeen = true;
            failureSummary = event.message;
            failedActivityTurns.current.set(sessionId, activityTurnId);
            announceActivity(
              sessionsRef.current.find((session) => session.id === sessionId) ??
                current,
              {
                id: `${activityTurnId}:failed`,
                outcome: "failed",
                summary: event.message,
              },
            );
          }
          if (proposalDraft) {
            if (event.type === "message.delta") {
              proposalText = (proposalText + event.text).slice(-200_000);
              return null;
            }
            if (event.type === "message.completed") {
              proposalText += "\n";
              return null;
            }
            if (event.type === "plan") {
              nativeProposalText = event.append
                ? nativeProposalText + event.text
                : event.text;
              return null;
            }
          }
          if (intent !== "plan") return event;
          if (event.type === "plan") {
            nativePlanSeen = true;
            return {
              ...event,
              key: planEventKey,
            };
          }
          return event;
        };

        if (!current.inboxAsk && !controlledTurn) {
          await beginSessionTurn(sessionId, workCwd).catch(() => undefined);
        }
        if (turnGen.current.get(sessionId) !== gen) return;
        let buildSucceeded = false;
        try {
          const prepared = await prepareAttachments(attachments);
          const prompt =
            intent === "build" && approvedPlan
              ? buildPlanPrompt(approvedPlan.text)
              : await preparePrompt(harnessText, {
                  harness: current.harness,
                  sessionId,
                  cwd: workCwd,
                });
          const browserPrompt = rawCommand
            ? prompt
            : await prepareAgentBrowserPrompt(prompt, {
                sessionId,
                cwd: workCwd,
              });
          const turnPrompt = proposalDraft
            ? orchestrationPlanningPrompt(browserPrompt, proposalDraft.settings)
            : intent === "plan" && !rawCommand
              ? planTurnPrompt(browserPrompt)
              : browserPrompt;
          const earlier = queuedHandoff
            ? userMessagesAfterHandoff(current)
            : [];
          await sendHarnessTurn({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            runtimeMode: current.runtimeMode,
            intent: intent === "orchestrate" ? "plan" : intent,
            // A lead drives the control CLI over loopback; without this the
            // harness sandbox denies the socket and it cannot supervise.
            controlsAgents: orchestrator.run(sessionId)?.status === "active",
            text: orchestrator.prompt(
              sessionId,
              inboxAskPrompt(
                rawCommand ? undefined : current.inboxAsk,
                wrap && !rawCommand
                  ? wrapHandoffPrompt(
                      wrap.text,
                      wrap.from,
                      turnPrompt.trim() || CONTINUE_PROMPT,
                      earlier,
                    )
                  : turnPrompt,
              ),
            ),
            attachments: prepared,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              orchestrator.observe(sessionId, event);
              if (options?.onSettled && event.type === "message.delta")
                controlText = (controlText + event.text).slice(-20_000);
              if (options?.onSettled && event.type === "message.completed")
                controlText += "\n";
              if (event.type === "session.error")
                controlOutcome.error = event.message;
              if (
                wrap &&
                (event.type === "session.started" ||
                  event.type === "session.providerBound")
              ) {
                revealHandoff(wrap.text);
              }
              nudgeOpenEditors(event, workCwd);
              if (!controlledTurn) trackSessionEdits(sessionId, workCwd, event);
              const routed = routePlanEvent(event);
              if (routed) enqueueHarnessEvent(sessionId, routed);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) {
            setSessions((prev) =>
              prev.map((s) => {
                if (s.id !== sessionId) return s;
                const ready = isPreparingHandoff(s)
                  ? completeHandoff(s, wrap.text)
                  : s;
                // A command owns its arguments; deliver the recap with the next chat prompt.
                return rawCommand ? ready : consumeHandoff(ready);
              }),
            );
          }
          buildSucceeded = true;
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) revealHandoff(wrap.text);
          const message =
            error instanceof Error
              ? error.message
              : `${current.harness} adapter failed`;
          controlOutcome.error = message;
          providerFailureSeen = true;
          failureSummary = message;
          failedActivityTurns.current.set(sessionId, activityTurnId);
          announceActivity(
            sessionsRef.current.find((session) => session.id === sessionId) ??
              current,
            {
              id: `${activityTurnId}:failed`,
              outcome: "failed",
              summary: message,
            },
          );
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          controlOutcome = {
            status:
              providerFailureSeen ||
              isProviderFailureText(controlText) ||
              !buildSucceeded
                ? "failed"
                : "completed",
            text: controlText.trim(),
            ...(providerFailureSeen ? { error: controlOutcome.error } : {}),
          };
          await flushSessionCheckpoint(sessionId);
          // Stop/removal may happen while the checkpoint was being flushed.
          if (turnGen.current.get(sessionId) !== gen) return;
          const latest = sessionsRef.current.find(
            (session) => session.id === sessionId,
          );
          if (!latest) return;
          const stopped = stopStreaming(latest);
          const providerFailed =
            providerFailureSeen ||
            failedActivityTurns.current.get(sessionId) === activityTurnId ||
            !buildSucceeded ||
            isProviderFailureText(lastAssistantTextInTurn(stopped));
          const finalized =
            proposalDraft && proposalId
              ? withOrchestrationProposal(
                  stopped,
                  proposalId,
                  completeOrchestrationProposal(
                    proposalDraft,
                    [nativeProposalText, proposalText],
                    providerFailed
                      ? (controlOutcome.error ??
                          failureSummary ??
                          "The lead could not finish planning.")
                      : undefined,
                  ),
                )
              : intent === "plan" && !nativePlanSeen && !providerFailed
                ? promoteLastAssistantToPlan(stopped, planEventKey)
                : stopped;
          const finished =
            approvedPlan && intent === "build"
              ? withPlanStatus(
                  finalized,
                  approvedPlan.id,
                  buildSucceeded && !providerFailed ? "built" : "ready",
                )
              : finalized;
          const nextSessions = sessionsRef.current.map((session) =>
            session.id === sessionId ? finished : session,
          );
          sessionsRef.current = nextSessions;
          setSessions(nextSessions);
          reconcileSessionActivityInputs(sessionId, []);
          const outcome = providerFailed ? "failed" : "completed";
          announceActivity(finished, {
            id: `${activityTurnId}:${outcome}`,
            outcome,
            summary: failureSummary,
          });
          activityTurnIds.current.delete(sessionId);
          failedActivityTurns.current.delete(sessionId);
          notifyReviewChanged(sessionId);
          notifyGitChanged();
          nudgeWorkspace(workCwd);
          nudgeWatchedFiles();
          window.setTimeout(() => nudgeWatchedFiles(), 150);
        }
      })()
        .catch((error: unknown) => {
          controlOutcome = {
            status: "failed",
            text: controlText,
            error: error instanceof Error ? error.message : String(error),
          };
          if (turnGen.current.get(sessionId) === gen) {
            enqueueHarnessEvent(sessionId, {
              type: "session.error",
              message: controlOutcome.error!,
            });
            flushHarnessEvents();
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId
                  ? proposalId && proposalDraft
                    ? withOrchestrationProposal(
                        stopStreaming(session),
                        proposalId,
                        completeOrchestrationProposal(
                          proposalDraft,
                          "",
                          controlOutcome.error,
                        ),
                      )
                    : stopStreaming(session)
                  : session,
              ),
            );
          }
        })
        .finally(() => {
          options?.onSettled?.(
            turnGen.current.get(sessionId) !== gen
              ? { status: "cancelled", text: controlText }
              : controlOutcome,
          );
        });
    },
    [enqueueHarnessEvent, flushHarnessEvents, announceActivity],
  );

  const onUpdatePlan = useCallback(
    (sessionId: string, blockId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId || session.busy) return session;
          return {
            ...session,
            blocks: session.blocks.map((block) => {
              if (
                block.id !== blockId ||
                block.role !== "plan" ||
                block.plan?.status === "streaming" ||
                block.plan?.status === "building" ||
                block.plan?.status === "built"
              ) {
                return block;
              }
              const originalText = block.plan?.originalText ?? block.text;
              return {
                ...block,
                text,
                plan: {
                  ...(block.plan ?? { status: "ready" as const }),
                  status: "ready" as const,
                  originalText,
                  edited: text !== originalText,
                },
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const onBuildPlan = useCallback(
    (sessionId: string, blockId: string, target?: PlanBuildTarget) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const block = session?.blocks.find((entry) => entry.id === blockId);
      if (
        !session ||
        session.busy ||
        block?.role !== "plan" ||
        !!block.orchestration ||
        !block.text.trim() ||
        block.plan?.status === "streaming" ||
        block.plan?.status === "building" ||
        block.plan?.status === "built"
      ) {
        return;
      }
      if (target && session.modelSettings) {
        saveLastModelSettings(session.modelSettings, "fill");
      }
      onSubmit(sessionId, "Build approved plan", [], {
        intent: "build",
        planBlockId: blockId,
        buildTarget: target,
      });
    },
    [onSubmit],
  );

  useEffect(() => {
    const timers: number[] = [];
    const scheduled = new Set<string>();
    for (const session of sessions) {
      const queued = session.queuedMessages ?? [];
      if (session.busy || queued.length === 0) continue;

      if (session.queueStatus === "resuming") {
        setSessions((prev) =>
          prev.map((entry) =>
            entry.id === session.id
              ? { ...entry, queueStatus: "active" }
              : entry,
          ),
        );
        continue;
      }
      if (
        !canDispatchQueuedHead(session) ||
        queueDispatchingRef.current.has(session.id)
      ) {
        continue;
      }

      const next = queued[0];
      if (!next) continue;
      queueDispatchingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          queueDispatchingRef.current.delete(session.id);
          const latest = sessionsRef.current.find(
            (entry) => entry.id === session.id,
          );
          const head = latest?.queuedMessages?.[0];
          if (
            !latest ||
            !head ||
            head.id !== next.id ||
            !canDispatchQueuedHead(latest)
          ) {
            return;
          }
          onSubmit(session.id, head.text, head.attachments, {
            queuedMessageId: head.id,
            noteCard: head.noteCard,
            handoffCard: head.handoffCard,
            intent: head.intent,
          });
        }, 0),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) queueDispatchingRef.current.delete(id);
    };
  }, [onSubmit, sessions]);

  const onDeleteQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? dequeueQueuedMessage(session, messageId)
            : session,
        ),
      );
    },
    [],
  );

  const onQueuedMessageEditingChange = useCallback(
    (sessionId: string, messageId?: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? { ...session, editingQueuedMessageId: messageId }
            : session,
        ),
      );
    },
    [],
  );

  const onEditQueuedMessage = useCallback(
    (sessionId: string, messageId: string, text: string) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId ? { ...message, text } : message,
                ),
                editingQueuedMessageId: undefined,
              }
            : session,
        ),
      );
    },
    [],
  );

  const onSteerQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      const message = session
        ? queuedMessageForSubmit(session, messageId, "steer")
        : undefined;
      if (!session || !message) return;
      if (message.intent === "orchestrate" && session.busy) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Orchestration planning will start after the current turn finishes.",
        });
        flushHarnessEvents();
        return;
      }
      onSubmit(sessionId, message.text, message.attachments, {
        followUpBehavior: "steer",
        queuedMessageId: message.id,
        noteCard: message.noteCard,
        handoffCard: message.handoffCard,
        intent: message.intent,
      });
    },
    [onSubmit, enqueueHarnessEvent, flushHarnessEvents],
  );

  const onResumeQueue = useCallback((sessionId: string) => {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (
      !session ||
      session.busy ||
      session.queueStatus !== "paused" ||
      !session.queuedMessages?.length
    ) {
      return;
    }
    setSessions((prev) =>
      prev.map((entry) =>
        entry.id === sessionId ? { ...entry, queueStatus: "active" } : entry,
      ),
    );
  }, []);

  const openSessionBeside = useCallback(
    (
      sourceId: string,
      session: Session,
      cwd: string,
      focusComposer = false,
    ) => {
      const nextSessions = [...sessionsRef.current, session];
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      const tab = tabsRef.current.find((entry) =>
        leafIds(entry.layout).includes(sourceId),
      );
      if (tab) {
        const nextTabs = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? {
                ...entry,
                layout: splitPane(entry.layout, sourceId, "right", session.id),
                focusedId: session.id,
                diffFocused: false,
              }
            : entry,
        );
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
        if (tab.id !== activeTabIdRef.current) setActiveTabId(tab.id);
      } else {
        const nextTab = newTab(session.id);
        appendTab(nextTab, cwd);
        setActiveTabId(nextTab.id);
      }

      setProjectTerminalFocused(false);
      setComposerFocused(focusComposer);
    },
    [appendTab],
  );

  const onSecondOpinion = useCallback(
    (sourceId: string, harness: HarnessId, turn: Block[], model: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source) return;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(turn, cwd);
      const prompt = buildSecondOpinionPrompt({
        from,
        userRequest,
        report: turnReport(turn),
        files,
      });
      const session = {
        ...newSession(harness, cwd, model, source.runtimeMode),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
      };
      openSessionBeside(sourceId, session, cwd);
      onSubmit(session.id, prompt, [], {
        secondOpinion: buildSecondOpinionCard({
          from,
          to: harness,
          userRequest,
          files,
        }),
      });
    },
    [onSubmit, openSessionBeside],
  );

  const onHandoff = useCallback(
    (sourceId: string, harness: HarnessId, turn: Block[], model: string) => {
      const source = sessionsRef.current.find(
        (session) => session.id === sourceId,
      );
      if (!source) return;
      const cwd = sessionWorkCwd(source);
      const from = harnessForTurn(source.blocks, turn, source.harness);
      const sliced = sessionThroughTurn(source, turn);
      const userRequest = turnUserRequest(turn);
      const files = turnEditedFiles(sliced.blocks, cwd);
      const display = sessionDisplayTitle(source.title, source.harness);
      const session = {
        ...newSession(harness, cwd, model, source.runtimeMode),
        title: formatSessionTitle(
          harness,
          display === "New session" ? HANDOFF_TITLE : display,
        ),
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, cwd, true);
    },
    [openSessionBeside],
  );

  const autoContinueKey = sessions
    .filter(
      (session) => canAutoContinue(session) && isLiveHarness(session.harness),
    )
    .map((session) => session.id)
    .join("\n");

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit]);

  const onCompactContext = useCallback(
    (sessionId: string) => {
      const current = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!current || current.busy) return false;
      if (!canCompactHarnessContext(current.harness)) {
        const unsupported = sessionsRef.current.map((session) =>
          session.id === sessionId
            ? applyHarnessEvent(session, {
                type: "status",
                text: `${HARNESS_TITLE[current.harness]} does not support manual context compaction.`,
              })
            : session,
        );
        sessionsRef.current = unsupported;
        syncDockBadge(unsupported);
        setSessions(unsupported);
        return true;
      }

      const gen = (turnGen.current.get(sessionId) ?? 0) + 1;
      turnGen.current.set(sessionId, gen);
      const workCwd = sessionWorkCwd(current);
      const started = sessionsRef.current.map((session) =>
        session.id === sessionId
          ? applyHarnessEvent(
              { ...session, busy: true },
              { type: "status", text: "Compacting context…" },
            )
          : session,
      );
      sessionsRef.current = started;
      syncDockBadge(started);
      setSessions(started);

      void (async () => {
        try {
          await compactHarnessContext({
            harness: current.harness,
            sessionId,
            cwd: workCwd,
            model: current.model,
            modelSettings: current.modelSettings,
            runtimeMode: current.runtimeMode,
            onEvent: (event) => {
              if (turnGen.current.get(sessionId) !== gen) return;
              enqueueHarnessEvent(sessionId, event);
            },
          });
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "status",
            text: "Compacted context",
          });
        } catch (error: unknown) {
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, {
            type: "session.error",
            message:
              error instanceof Error
                ? error.message
                : `${current.harness} could not compact this context`,
          });
        } finally {
          if (turnGen.current.get(sessionId) !== gen) return;
          flushHarnessEvents();
          const finished = sessionsRef.current.map((session) =>
            session.id === sessionId ? { ...session, busy: false } : session,
          );
          sessionsRef.current = finished;
          syncDockBadge(finished);
          setSessions(finished);
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      if (!managed) {
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          void stopping.catch(console.error);
          return;
        }
      }
      flushHarnessEvents();
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const activityId =
        activityTurnIds.current.get(sessionId) ??
        (session ? sessionTurnActivityId(session) : sessionId);
      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      if (session) {
        for (const id of sessionChildHarnesses(session)) {
          void cancelHarnessTurn(id, sessionId);
        }
      }
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          const stopped = stopStreaming(s);
          const completed = isPreparingHandoff(stopped)
            ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
            : stopped;
          return completed.queuedMessages?.length
            ? { ...completed, queueStatus: "paused" }
            : completed;
        }),
      );
      if (session) {
        if (session.busy || sessionNeedsInput(session)) {
          reconcileSessionActivityInputs(sessionId, []);
          announceActivity(session, {
            id: `${activityId}:stopped`,
            outcome: "stopped",
          });
          activityTurnIds.current.delete(sessionId);
          failedActivityTurns.current.delete(sessionId);
        }
        notifyReviewChanged(sessionId);
        nudgeWorkspace(sessionWorkCwd(session));
        notifyGitChanged();
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents, announceActivity],
  );

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (!workspaceVisibleRef.current || hasWorkspaceOverlay()) return;
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".monocode-terminal"));
      const activeTabId = activeTabIdRef.current;
      if (viewRef.current.view.focusedId !== activeTabId) return;
      const sessionId = focusedBusyAgentSessionId(
        activeTabId,
        tabsRef.current,
        sessionsRef.current,
        projectTerminalFocusedRef.current,
      );
      if (
        !sessionId ||
        !shouldStopFocusedTurnOnEscape(event, {
          inTerminal,
          focusedSessionBusy: true,
        })
      ) {
        return;
      }

      // Other surfaces (drag/reorder included) can claim Escape later in the
      // same keydown dispatch. Defer the destructive stop until every handler
      // has had a chance to preventDefault, then verify focus did not move.
      deferUnhandledEscape(event, () => {
        const stillFocusedSessionId = focusedBusyAgentSessionId(
          activeTabIdRef.current,
          tabsRef.current,
          sessionsRef.current,
          projectTerminalFocusedRef.current,
        );
        if (
          viewRef.current.view.focusedId !== activeTabId ||
          activeTabIdRef.current !== activeTabId ||
          stillFocusedSessionId !== sessionId
        ) {
          return;
        }
        onStop(sessionId);
      });
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onStop]);

  const onApproval = useCallback(
    (sessionId: string, requestId: number, decision: ApprovalDecision) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      respondHarnessApproval(session.harness, sessionId, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      respondHarnessQuestion(session.harness, sessionId, requestId, reply);
    },
    [],
  );

  const onOpenApprovalSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const parentId =
        sessionsRef.current.find((session) => session.id === sessionId)
          ?.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        sessionId = parentId;
      }
      try {
        if (await activityWindowBridgeRef.current.showSession?.(sessionId))
          return true;
        if (activityPipIdsRef.current.includes(sessionId)) {
          await nativeSessionPip.show(sessionId);
          return true;
        }
        const session = await ensureOpenSession(sessionId);
        if (!session || session.inboxAsk) return false;
        flushSync(() => {
          profilesRef.current.selectProfile(
            projectWorkspaceProfile(loadWorkspaceProfiles(), session.cwd),
          );
          setProjectCwd(session.cwd);
          setHomeViewOpen(false);
          setSettingsOpen(false);
          setSearchViewOpen(false);
          setInboxViewOpen(false);
          setNotesViewOpen(false);
          leaveExpandedPreview();
        });
        if (!focusOpenSession(sessionId))
          await onSelectHistorySession(sessionId);
        const appWindow = getCurrentWindow();
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setFocus();
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
        return tabsRef.current.some((tab) =>
          leafIds(tab.layout).includes(sessionId),
        );
      } catch {
        return false;
      }
    },
    [
      ensureOpenSession,
      focusOpenSession,
      onSelectHistorySession,
      leaveExpandedPreview,
    ],
  );

  useEffect(() => {
    setSessions((prev) => attachOrchestrationWorkers(prev, orchestrationRuns));
  }, [orchestrationRuns]);

  useEffect(() => {
    const next = consolidateOrchestrationTabs(
      tabs,
      activeTabId,
      orchestrationRuns,
    );
    if (next.tabs !== tabs) setTabs(next.tabs);
    if (next.activeTabId !== activeTabId) setActiveTabId(next.activeTabId);
  }, [tabs, activeTabId, orchestrationRuns]);

  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      choices: orchestrationWorkerChoices,
      createWorker: async (run, task) => {
        await invoke("control_attach_worker", {
          leadId: run.leadId,
          sessionId: task.sessionId,
        });
        const existing = sessionsRef.current.find(
          (session) => session.id === task.sessionId,
        );
        const lead = sessionsRef.current.find(
          (session) => session.id === run.leadId,
        );
        if (!lead) throw new Error("Lead session is unavailable");
        if (existing) {
          if (
            existing.harness !== task.harness ||
            existing.model !== task.model ||
            existing.cwd !== run.cwd
          )
            throw new Error(
              "This worker's configuration changed. Restore its approved harness, model and project before retrying.",
            );
          // The lead's runtime mode governs its agents, including across a
          // change mid-run: auto stays auto, supervised asks the lead.
          if (existing.runtimeMode !== lead.runtimeMode) {
            const synced = { ...existing, runtimeMode: lead.runtimeMode };
            await upsertSession(synced);
            const next = sessionsRef.current.map((session) =>
              session.id === synced.id ? synced : session,
            );
            sessionsRef.current = next;
            setSessions(next);
          }
          return;
        }
        const restored = await getSession(task.sessionId);
        if (
          restored &&
          (restored.harness !== task.harness || restored.model !== task.model)
        )
          throw new Error(
            "The saved worker no longer matches its approved model. Create a new assignment.",
          );
        const base = restored
          ? {
              ...restored,
              busy: false,
              cwd: run.cwd,
              worktreeCwd: undefined,
              runtimeMode: lead.runtimeMode,
            }
          : {
              ...newSession(
                task.harness,
                run.cwd,
                task.model,
                lead.runtimeMode,
              ),
              id: task.sessionId,
              title: task.title,
            };
        const worker = { ...base, orchestrationLeadId: run.leadId };
        if (worker.providerSessionId)
          bindHarnessSession(
            worker.harness,
            worker.id,
            worker.providerSessionId,
            worker.cwd,
          );
        await upsertSession(worker);
        const next = [...sessionsRef.current, worker];
        sessionsRef.current = next;
        setSessions(next);
        // Workers belong to the lead's agent panel; no workspace tab is created.
      },
      submit: (id, text, done) => {
        // Commit the new turn before the scheduler or confirmation updates
        // another session snapshot in the same event loop.
        submitManagedTurn((settle) => {
          let accepted: boolean | void = undefined;
          flushSync(() => {
            accepted = onSubmit(id, text, [], {
              managed: true,
              onSettled: settle,
            });
          });
          return accepted;
        }, done);
      },
      steer: async (id, text) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) throw new Error("This agent is no longer available");
        if (!session.busy)
          throw new Error(
            "This agent is not running a turn; send it a fresh one with message.",
          );
        if (
          !isLiveHarness(session.harness) ||
          !canSteerHarness(session.harness)
        )
          throw new Error(
            `${session.harness} cannot take guidance mid-turn. Wait for the turn to finish, then use message.`,
          );
        // Record it on the worker before dispatch, so its own transcript shows
        // why it changed course even if the harness call then fails.
        const next = sessionsRef.current.map((entry) =>
          entry.id === id ? appendSteerUser(entry, text) : entry,
        );
        sessionsRef.current = next;
        setSessions(next);
        const generation = turnGen.current.get(id);
        await steerManagedTurn(
          {
            harness: session.harness,
            sessionId: id,
            cwd: sessionWorkCwd(session),
            model: session.model,
            modelSettings: session.modelSettings,
            text,
          },
          () =>
            turnGen.current.get(id) === generation &&
            sessionsRef.current.some((entry) => entry.id === id && entry.busy),
        );
      },
      respondApproval: (id, requestId, decision) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessApproval(session.harness, id, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (session)
          respondHarnessQuestion(session.harness, id, requestId, reply);
      },
      stop: async (id) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        onStop(id, true);
        try {
          if (session)
            await Promise.all(
              sessionChildHarnesses(session).map((harness) =>
                stopHarnessSession(harness, id),
              ),
            );
        } finally {
          // Also reap processes left behind by a renderer reload, before the
          // corresponding session has been restored in this window.
          await invoke("harness_kill", { sessionId: id });
          await invoke("control_turn_finished", { sessionId: id });
        }
      },
    });
  }, [onSubmit, onStop]);

  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);

  useEffect(() => {
    const listening = listen<{
      id: string;
      sessionId: string;
      requestId: string;
      action: string;
      input: Record<string, unknown>;
    }>("monocode-control-request", ({ payload }) => {
      void orchestrator
        .handle(
          payload.sessionId,
          payload.requestId,
          payload.action,
          payload.input,
        )
        .then(
          (result) =>
            invoke("control_reply", {
              id: payload.id,
              response: { ok: true, result },
            }),
          (error: unknown) =>
            invoke("control_reply", {
              id: payload.id,
              response: {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }),
        )
        .catch(console.error);
    });
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);

  const confirmingOrchestration = useRef(new Set<string>());
  const queueWorkerPanes = useCallback(
    (workers: OrchestrationWorkerDetail[]) => {
      // Finished workers are not open; load stored transcripts before the
      // tabs appear so the pane does not flash the empty state.
      void prepareOrchestrationWorkerDetails(workers, {
        openLead: async (leadId) => {
          if (!focusOpenSession(leadId)) await onSelectHistorySession(leadId);
        },
        openWorker: ensureOpenSession,
        hasSession: (id) =>
          sessionsRef.current.some((session) => session.id === id),
      })
        .then((request) => {
          if (request?.workers.length) setWorkerDetailRequest(request);
        })
        .catch(console.error);
    },
    [ensureOpenSession, focusOpenSession, onSelectHistorySession],
  );
  const onOpenWorkerDetails = useCallback(
    (worker: OrchestrationWorkerDetail) => {
      setInspectedWorkerId(worker.sessionId);
      queueWorkerPanes([worker]);
    },
    [queueWorkerPanes],
  );
  useEffect(() => {
    if (!workerDetailRequest) return;
    const { leadId, workers } = workerDetailRequest;
    const tab = tabs.find((entry) => leafIds(entry.layout).includes(leadId));
    if (!tab) {
      // Still opening: this runs again on the commit that lands the lead. If
      // the lead never arrived at all, drop the request rather than let it
      // fire against some later tab change.
      if (!sessionsRef.current.some((entry) => entry.id === leadId)) {
        setWorkerDetailRequest(null);
      }
      return;
    }
    setWorkerDetailRequest(null);
    // Every agent of a run shares one pane, the way files do: `openEditorTab`
    // focuses an open tab, adds to the pane already beside the lead, or splits
    // one off when there is none.
    const cwd =
      sessionsRef.current.find((entry) => entry.id === leadId)?.cwd ??
      projectCwdRef.current;
    const files = workers.map((worker) =>
      newAgentTab(worker.title, cwd, {
        sessionId: worker.sessionId,
        leadId,
        harness: worker.harness,
      }),
    );
    setTabs((prev) =>
      prev.map((entry) => {
        if (entry.id !== tab.id) return entry;
        const opened = files.reduce(
          (next, file) => openEditorTab(next, file),
          entry,
        );
        // Leave the first worker focused so View agents lands on the start
        // of the run rather than the last tab added.
        return files[0] ? openEditorTab(opened, files[0]) : opened;
      }),
    );
    setActiveTabId(tab.id);
    setComposerFocused(false);
  }, [tabs, workerDetailRequest]);
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
    }),
    [inspectedWorkerId, onOpenWorkerDetails],
  );
  const updateOrchestrationCard = useCallback(
    (leadId: string, blockId: string, proposal: OrchestrationProposal) => {
      const next = sessionsRef.current.map((session) =>
        session.id === leadId
          ? withOrchestrationProposal(session, blockId, proposal)
          : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      return next.find((session) => session.id === leadId);
    },
    [],
  );
  const orchestrationActions = useMemo(
    () => ({
      open: onOpenApprovalSession,
      openAgents: queueWorkerPanes,
      update: (
        leadId: string,
        blockId: string,
        edited: OrchestrationProposal,
      ) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === leadId,
        );
        const proposal = session?.blocks.find(
          (block) => block.id === blockId,
        )?.orchestration;
        if (
          !session ||
          session.busy ||
          proposal?.status !== "ready" ||
          confirmingOrchestration.current.has(leadId)
        )
          return;
        // Keep the discovered catalog authoritative while allowing task and parallelism edits.
        const settings = validateOrchestrationSettings({
          ...proposal.settings,
          maxWorkers: edited.settings.maxWorkers,
        });
        updateOrchestrationCard(leadId, blockId, {
          ...proposal,
          settings,
          tasks: edited.tasks,
        });
      },
      confirm: async (leadId: string, blockId: string) => {
        if (confirmingOrchestration.current.has(leadId)) return;
        confirmingOrchestration.current.add(leadId);
        let proposal: OrchestrationProposal | undefined;
        try {
          await orchestrator.hydrate(leadId);
          const session = sessionsRef.current.find(
            (entry) => entry.id === leadId,
          );
          proposal = session?.blocks.find(
            (block) => block.id === blockId,
          )?.orchestration;
          if (!session || session.busy || proposal?.status !== "ready")
            throw new Error(
              "Wait for the proposal to finish before confirming.",
            );
          if (
            session.harness !== proposal.author.harness ||
            session.model !== proposal.author.model
          )
            throw new Error(
              "The lead model has changed. Switch back to the model shown on this card, or generate a new proposal.",
            );
          const starting = updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "starting",
          })!;
          // Save the edited card before anything can execute.
          await upsertSession(starting);
          await orchestrator.startApproved(leadId, blockId, proposal);
          updateOrchestrationCard(leadId, blockId, {
            ...proposal,
            status: "approved",
          });
        } catch (error) {
          if (proposal)
            updateOrchestrationCard(leadId, blockId, {
              ...proposal,
              status: "ready",
            });
          throw error;
        } finally {
          confirmingOrchestration.current.delete(leadId);
        }
      },
      retry: (leadId: string, blockId: string) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === leadId,
        );
        const proposal = session?.blocks.find(
          (block) => block.id === blockId,
        )?.orchestration;
        if (!session || session.busy || !proposal) return;
        onSubmit(leadId, proposal.request, [], { intent: "orchestrate" });
      },
    }),
    [
      onOpenApprovalSession,
      queueWorkerPanes,
      onSubmit,
      updateOrchestrationCard,
    ],
  );

  const onSelectLiveAgent = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      return onOpenApprovalSession(sessionId);
    },
    [onOpenApprovalSession],
  );

  const nextTitleTabs: TitleTab[] = deckProjectTabs.map((tab) =>
    toTitleTab(tab, sessions, dirtyFiles),
  );
  tabProjectsRef.current = new Map(
    nextTitleTabs.map((tab) => [tab.id, tab.project]),
  );
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;

  // `history` now spans every visited project; consumers that expect the
  // current project only get this slice.
  const projectHistory = useMemo(
    () => history.filter((entry) => sameProjectPath(entry.cwd, sidebarCwd)),
    [history, sidebarCwd],
  );

  const sidebarHistory = useMemo(
    () =>
      historyWithLiveSessions(
        history,
        sessions,
        sidebarCwd,
        {
          ...(projectBranches?.current
            ? { branch: projectBranches.current }
            : {}),
          ...(sidebarCwd && sidebarCwd !== "~" && !isProjectlessCwd(sidebarCwd)
            ? { repo: projectName(sidebarCwd) }
            : {}),
        },
        orchestrationRuns,
      ),
    [history, projectBranches, sessions, sidebarCwd, orchestrationRuns],
  );
  const openProjectSessions = useMemo(
    () =>
      sessions
        .filter(
          (session) =>
            !session.inboxAsk &&
            !session.orchestrationLeadId &&
            sameProjectPath(session.cwd, sidebarCwd),
        )
        .map((session) =>
          summaryFromSession(session, {
            ...(projectBranches?.current
              ? { branch: projectBranches.current }
              : {}),
            ...(sidebarCwd &&
            sidebarCwd !== "~" &&
            !isProjectlessCwd(sidebarCwd)
              ? { repo: projectName(sidebarCwd) }
              : {}),
          }),
        ),
    [projectBranches, sessions, sidebarCwd],
  );
  // Installed accounts stay visible across projects, tabs, and workspaces.
  const usageProviders = useAccountUsageProviders(sessions);
  useAutomaticModelCatalogs(sessions);

  const onToggleSidebar = useCallback(() => {
    sidebarHover.dismiss();
    setSidebarOpen((open) => {
      savePersonalSidebar(!open);
      return !open;
    });
  }, [sidebarHover.dismiss]);
  const onToggleProjectRail = onToggleSidebar;

  const onGoToFile = useCallback(() => {
    if (profileHome) {
      openWorkspaceAction("create");
      return;
    }
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setFilePickerOpen(true);
  }, [profileHome, openWorkspaceAction]);

  const onFindInProject = useCallback(() => {
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const captureUtilityFocus = useCallback(() => {
    if (
      !settingsOpenRef.current &&
      !searchViewOpenRef.current &&
      !inboxViewOpenRef.current &&
      !notesViewOpenRef.current
    )
      clearReturnFocus();
    captureReturnFocus();
  }, [captureReturnFocus, clearReturnFocus]);

  const onOpenSearch = useCallback(() => {
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setSearchViewOpen(true);
    setSearchViewFocusToken((token) => token + 1);
  }, [captureUtilityFocus]);

  const onLeaveSearch = useCallback(() => {
    setSearchViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onOpenInbox = useCallback(() => {
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setNotesViewOpen(false);
    setInboxViewOpen(true);
  }, [captureUtilityFocus]);

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onOpenNotes = useCallback(() => {
    if (!loadNotesEnabled()) return;
    captureUtilityFocus();
    setFilePickerOpen(false);
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(true);
  }, [captureUtilityFocus]);

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const openSettings = useCallback(
    (section?: SettingsSectionId) => {
      captureUtilityFocus();
      setFilePickerOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      if (section) {
        setSettingsSection(section);
        saveSettingsSection(section);
      }
      setSettingsOpen(true);
    },
    [captureUtilityFocus],
  );

  const onOpenSettings = useCallback(() => openSettings(), [openSettings]);

  const onOpenHome = useCallback(() => {
    clearReturnFocus();
    setSettingsOpen(false);
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setFilePickerOpen(false);
    setHomeViewOpen(true);
  }, [clearReturnFocus]);

  const onCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    restoreReturnFocus();
  }, [restoreReturnFocus]);

  const onSelectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section);
    saveSettingsSection(section);
  }, []);

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession],
  );

  const onRailBack = onVisitBack;
  const onRailForward = onVisitForward;

  useEffect(() => {
    if (sidebarTab === "inbox") setSidebarTab("sessions");
  }, [sidebarTab]);

  useEffect(() => {
    if (!dockVisible) setProjectTerminalFocused(false);
  }, [dockVisible]);

  const openFilePaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const tab of tabs) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (!isFilesystemTab(file) || seen.has(file.path)) continue;
          seen.add(file.path);
          paths.push(file.path);
        }
      }
    }
    return paths;
  }, [tabs]);

  useEffect(() => {
    void invoke("set_traffic_lights_visible", { visible: true }).catch(
      () => {},
    );
  }, []);

  const onSessionNavigationOrder = useCallback((ids: readonly string[]) => {
    sessionNavigationIdsRef.current = ids;
  }, []);

  const onNavigateSessionList = useCallback(
    (delta: number) => {
      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      if (!activeWorkspace || activeWorkspace.diffFocused) return;
      const current = sessionsRef.current.find(
        (session) => session.id === activeWorkspace.focusedId,
      );
      if (!current) return;

      const next = adjacentItemId(
        sessionNavigationIdsRef.current,
        current.id,
        delta,
      );
      if (!next || next === current.id) return;
      void onSelectHistorySession(next);
    },
    [onSelectHistorySession],
  );

  const onNavigateProjectList = useCallback(
    (delta: number) => {
      const current = normalizeProjectPath(projectCwdRef.current);
      const ids = profilesRef.current.profileProjects.map(
        (project) => project.path,
      );
      const next = adjacentItemId(ids, current, delta);
      if (!next || sameProjectPath(next, current)) return;
      onSelectProject(next);
    },
    [onSelectProject],
  );

  const actions = useRef({
    onNew,
    onReopenClosedTab,
    onArchiveFocusedSession,
    onCloseOtherTabs,
    onClosePane,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
    onActivate,
    onSplit,
    onFocusDir,
    onToggleSidebar,
    onToggleInspector,
    onGoToFile,
    onFindInProject,
    onOpenSearch,
    onOpenInbox,
    onOpenNotes,
    pickProject,
    onNewTerminal,
    onNewTerminalTab,
    onToggleProjectTerminal,
    onNavigateSessionList,
    onNavigateProjectList,
    openSettings,
    onOpenApprovalSession,
  });
  actions.current = {
    onNew,
    onReopenClosedTab,
    onArchiveFocusedSession,
    onCloseOtherTabs,
    onClosePane,
    onNext,
    onPrev,
    onVisitBack,
    onVisitForward,
    onActivate,
    onSplit,
    onFocusDir,
    onToggleSidebar,
    onToggleInspector,
    onGoToFile,
    onFindInProject,
    onOpenSearch,
    onOpenInbox,
    onOpenNotes,
    pickProject,
    onNewTerminal,
    onNewTerminalTab,
    onToggleProjectTerminal,
    onNavigateSessionList,
    onNavigateProjectList,
    openSettings,
    onOpenApprovalSession,
  };

  if (profileHome) {
    actions.current.onArchiveFocusedSession = () => undefined;
    actions.current.onCloseOtherTabs = () => undefined;
    actions.current.onClosePane = () => undefined;
    actions.current.onSplit = () => undefined;
    actions.current.onFocusDir = () => undefined;
    actions.current.onNavigateSessionList = () => undefined;
    actions.current.onNewTerminal = () => openWorkspaceAction("create");
    actions.current.onNewTerminalTab = () => openWorkspaceAction("create");
    actions.current.onToggleProjectTerminal = () =>
      openWorkspaceAction("create");
    actions.current.onFindInProject = () => openWorkspaceAction("create");
  }
  if (workspaceVisible && browserExpanded) {
    actions.current.onClosePane = () => onCloseBrowserTab(view.focusedId);
  }

  const notificationRouteClaims = useRef(new Map<string, number>());
  const notificationRouteTimers = useRef(new Set<number>());
  const debounce = useRef({ name: "", at: 0 });
  const run = useCallback(
    (name: string, fn: () => void) => {
      const disposition = workspaceShortcutDisposition(name, {
        overlay: hasWorkspaceOverlay(),
        utility:
          settingsOpenRef.current ||
          searchViewOpenRef.current ||
          inboxViewOpenRef.current ||
          notesViewOpenRef.current,
        workspace: workspaceVisibleRef.current,
      });
      if (disposition === "block") return;
      if (disposition === "dismiss-utility") {
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setNotesViewOpen(false);
        restoreReturnFocus();
        return;
      }
      const now = performance.now();
      if (name === debounce.current.name && now - debounce.current.at < 80)
        return;
      debounce.current = { name, at: now };
      fn();
    },
    [restoreReturnFocus],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Browser-standard UI zoom. Runs before tabCommand and always applies —
      // even in inputs and the terminal — so Ctrl/Cmd + - 0 behave like a browser.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.isComposing) {
        const zoom = uiScaleCommand(e);
        if (zoom) {
          e.preventDefault();
          e.stopPropagation();
          if (zoom === "zoom-in") {
            const next = saveUiScale(zoomInUiScale(loadUiScale()));
            void applyUiScale(next);
          } else if (zoom === "zoom-out") {
            const next = saveUiScale(zoomOutUiScale(loadUiScale()));
            void applyUiScale(next);
          } else {
            saveUiScale(UI_SCALE_DEFAULT);
            void applyUiScale(UI_SCALE_DEFAULT);
          }
          return;
        }
      }
      const cmd = tabCommand(e);
      if (cmd) {
        if (cmd === "archive-session") {
          actions.current.onArchiveFocusedSession(e);
          return;
        }
        const target = e.target instanceof Element ? e.target : null;
        const listNavigation =
          cmd === "prev-session" ||
          cmd === "next-session" ||
          cmd === "prev-project" ||
          cmd === "next-project";
        if (listNavigation) {
          const blockedTarget = Boolean(
            target?.closest(
              'input, textarea, select, [contenteditable="true"], .cm-editor, .monocode-terminal, [role="dialog"], [data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]',
            ),
          );
          const emptyComposerTarget = Boolean(
            target?.matches('textarea[data-composer-empty="true"]'),
          );
          const surfaceOpen =
            searchViewOpenRef.current ||
            inboxViewOpenRef.current ||
            notesViewOpenRef.current ||
            settingsOpenRef.current ||
            filePickerOpenRef.current ||
            Boolean(whatsNewVersionRef.current);
          if (
            !shouldHandleListNavigation({
              blockedTarget,
              emptyComposerTarget,
              surfaceOpen,
            })
          ) {
            return;
          }
        }
        if (
          target?.closest(".monocode-terminal") &&
          e.ctrlKey &&
          !e.metaKey &&
          (cmd === "back" ||
            cmd === "forward" ||
            /Mac|iPhone|iPad/.test(navigator.platform))
        ) {
          return;
        }
        if (
          (cmd === "split-right" || cmd === "split-down") &&
          target?.closest(".cm-editor")
        ) {
          return;
        }
        if (
          (cmd === "back" || cmd === "forward") &&
          target?.closest(".cm-editor")
        ) {
          e.preventDefault();
          e.stopPropagation();
          run(cmd, () => {
            indentFocusedEditor(cmd === "back" ? "less" : "more");
          });
          return;
        }
        const inPicker =
          target &&
          target.closest(
            "[data-model-picker], [data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-app-search]",
          );
        if (inPicker && typeof cmd === "object" && "activate" in cmd) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const a = actions.current;
        if (cmd === "new") run("new", a.onNew);
        else if (cmd === "reopen")
          run("reopen", () => {
            void a.onReopenClosedTab();
          });
        else if (cmd === "close-others")
          run("close-others", a.onCloseOtherTabs);
        else if (cmd === "close") run("close", a.onClosePane);
        else if (cmd === "next") run("next", a.onNext);
        else if (cmd === "prev") run("prev", a.onPrev);
        else if (cmd === "back") run("back", a.onVisitBack);
        else if (cmd === "forward") run("forward", a.onVisitForward);
        else if (cmd === "split-right")
          run("split-right", () => a.onSplit("right"));
        else if (cmd === "split-down")
          run("split-down", () => a.onSplit("down"));
        else if (cmd === "new-terminal") run("new-terminal", a.onNewTerminal);
        else if (cmd === "new-terminal-tab")
          run("new-terminal-tab", a.onNewTerminalTab);
        else if (cmd === "toggle-terminal")
          run("toggle-terminal", a.onToggleProjectTerminal);
        else if (cmd === "prev-session")
          run("prev-session", () => a.onNavigateSessionList(-1));
        else if (cmd === "next-session")
          run("next-session", () => a.onNavigateSessionList(1));
        else if (cmd === "prev-project")
          run("prev-project", () => a.onNavigateProjectList(-1));
        else if (cmd === "next-project")
          run("next-project", () => a.onNavigateProjectList(1));
        else if ("focus" in cmd)
          run(`focus-${cmd.focus}`, () => a.onFocusDir(cmd.focus));
        else run(`activate-${cmd.activate}`, () => a.onActivate(cmd.activate));
        return;
      }
      if (
        !searchViewOpenRef.current &&
        !inboxViewOpenRef.current &&
        !notesViewOpenRef.current &&
        handleEditorFindKey(e)
      ) {
        e.stopPropagation();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.altKey && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        run("toggle_inspector", actions.current.onToggleInspector);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        e.stopPropagation();
        run("toggle_sidebar", actions.current.onToggleSidebar);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        run("go_to_file", actions.current.onGoToFile);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest(".monocode-terminal") && e.ctrlKey && !e.metaKey) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        run("open_search", actions.current.onOpenSearch);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key === ",") {
        e.preventDefault();
        e.stopPropagation();
        run("open_settings", () => actions.current.openSettings());
        return;
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        run("find_in_project", actions.current.onFindInProject);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run]);

  useEffect(() => {
    const unlisten: Array<Promise<() => void>> = [
      listen("new_tab", () => run("new", actions.current.onNew)),
      listen("close_other_tabs", () =>
        run("close-others", actions.current.onCloseOtherTabs),
      ),
      listen("close_tab", () => run("close", actions.current.onClosePane)),
      listen("next_tab", () => run("next", actions.current.onNext)),
      listen("prev_tab", () => run("prev", actions.current.onPrev)),
      listen("back_tab", () =>
        run("back", () => {
          if (!indentFocusedEditor("less")) actions.current.onVisitBack();
        }),
      ),
      listen("forward_tab", () =>
        run("forward", () => {
          if (!indentFocusedEditor("more")) actions.current.onVisitForward();
        }),
      ),
      listen("split_right", () =>
        run("split-right", () => actions.current.onSplit("right")),
      ),
      listen("split_down", () =>
        run("split-down", () => actions.current.onSplit("down")),
      ),
      listen("new_terminal", () =>
        run("new-terminal", actions.current.onNewTerminal),
      ),
      listen("new_terminal_tab", () =>
        run("new-terminal-tab", actions.current.onNewTerminalTab),
      ),
      listen("toggle_terminal", () =>
        run("toggle-terminal", actions.current.onToggleProjectTerminal),
      ),
      listen("focus_left", () =>
        run("focus-left", () => actions.current.onFocusDir("left")),
      ),
      listen("focus_right", () =>
        run("focus-right", () => actions.current.onFocusDir("right")),
      ),
      listen("focus_up", () =>
        run("focus-up", () => actions.current.onFocusDir("up")),
      ),
      listen("focus_down", () =>
        run("focus-down", () => actions.current.onFocusDir("down")),
      ),
      listen("toggle_sidebar", () =>
        run("toggle_sidebar", actions.current.onToggleSidebar),
      ),
      listen("toggle_inspector", () =>
        run("toggle_inspector", actions.current.onToggleInspector),
      ),
      listen("open_project", () => {
        void actions.current.pickProject();
      }),
      listen("go_to_file", () => actions.current.onGoToFile()),
      listen("open_search", () => actions.current.onOpenSearch()),
      listen("open_inbox", () => actions.current.onOpenInbox()),
      listen("open_notes", () => actions.current.onOpenNotes()),
      listen("open_settings", () => actions.current.openSettings()),
      listen("check_for_updates", () => {
        void runUpdateFlow(true);
      }),
      listen("sidebar_opacity", () => {
        actions.current.openSettings("appearance");
      }),
      listen("find_in_project", () => actions.current.onFindInProject()),
      listen("find", () => {
        openFindInActiveEditor();
      }),
      listen("open_model_picker", () => {
        window.dispatchEvent(new Event("open_model_picker"));
      }),
      listen<string>(
        "monocode:notification-route-claim",
        ({ payload: sessionId }) => {
          notificationRouteClaims.current.set(sessionId, Date.now());
          if (notificationRouteClaims.current.size > 40)
            notificationRouteClaims.current.delete(
              notificationRouteClaims.current.keys().next().value!,
            );
        },
      ),
      listen<string>(NOTIFICATION_CLICK_EVENT, ({ payload: sessionId }) => {
        if (typeof sessionId !== "string" || !sessionId) return;
        if (sessionsRef.current.some((session) => session.id === sessionId)) {
          void emit("monocode:notification-route-claim", sessionId);
          void actions.current.onOpenApprovalSession(sessionId);
          return;
        }
        if (getCurrentWindow().label !== "main") return;
        const clickedAt = Date.now();
        const timer = window.setTimeout(() => {
          notificationRouteTimers.current.delete(timer);
          if (
            (notificationRouteClaims.current.get(sessionId) ?? 0) >=
            clickedAt - 50
          )
            return;
          void actions.current.onOpenApprovalSession(sessionId);
        }, 200);
        notificationRouteTimers.current.add(timer);
      }),
      listen("zoom_in", () => {
        const next = zoomInUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_out", () => {
        const next = zoomOutUiScale(loadUiScale());
        saveUiScale(next);
        void applyUiScale(next);
      }),
      listen("zoom_reset", () => {
        saveUiScale(UI_SCALE_DEFAULT);
        void applyUiScale(UI_SCALE_DEFAULT);
      }),
    ];
    return () => {
      for (const timer of notificationRouteTimers.current)
        window.clearTimeout(timer);
      notificationRouteTimers.current.clear();
      void Promise.all(unlisten).then((fns) => fns.forEach((fn) => fn()));
    };
  }, [run]);

  const dockGridRef = useRef<HTMLDivElement>(null);
  const dockDragSize = useRef<number | null>(null);
  const paintDockSize = useCallback((size: number) => {
    const dock = findProjectTerminal(
      projectTerminalsRef.current,
      projectCwdRef.current,
    );
    const el = dockGridRef.current;
    if (!dock || !el) return;
    dockDragSize.current = size;
    applyDockGridStyle(el, dock.side, size);
  }, []);
  const commitDockSize = useCallback(
    (size: number) => {
      dockDragSize.current = null;
      onProjectTerminalSize(size);
    },
    [onProjectTerminalSize],
  );
  useLayoutEffect(() => {
    if (dockDragSize.current != null) return;
    const el = dockGridRef.current;
    if (!el) return;
    applyDockGridStyle(
      el,
      dockVisible && currentProjectDock ? currentProjectDock.side : null,
      currentProjectDock?.size ?? 0,
    );
  }, [currentProjectDock, dockVisible]);

  const sessionPaneProps = {
    recents,
    hideProjectPicker: true,
    onFocus: onFocusPane,
    onClose: onClosePane,
    onCwdChange,
    onBranchChange,
    onModelChange,
    onModelSettingsChange,
    onRuntimeModeChange,
    onSubmit,
    onStop,
    onCompactContext,
    onDeleteQueuedMessage,
    onEditQueuedMessage,
    onQueuedMessageEditingChange,
    onSteerQueuedMessage,
    onResumeQueue,
    onInboxCardDismiss,
    onNoteCardDismiss,
    onHandoffCardDismiss,
    onApproval,
    onQuestionReply,
    onOpenFile,
    onOpenUrl: onOpenWebLink,
    onOpenDiff,
    onOpenPlan,
    onBuildPlan,
    onSecondOpinion,
    onHandoff,
    onNewTerminal: onNewTerminalInSession,
  };

  const returnToSession = useCallback(
    (id: string) => {
      const session = sessionsRef.current.find((entry) => entry.id === id);
      if (!session || removingSessionIds.current.has(id)) return;
      // Return is also used before opening a file from a floating transcript.
      // Commit the owning project and tab before those callbacks read their refs.
      flushSync(() => {
        let tab = tabsRef.current.find((entry) =>
          leafIds(entry.layout).includes(id),
        );
        if (!tab) {
          tab = newTab(id);
          const next = [...tabsRef.current, tab];
          tabsRef.current = next;
          setTabs(next);
        }
        onSelectProject(session.cwd);
        activateTab(tab.id);
        const focused = tabsRef.current.map((entry) =>
          entry.id === tab.id
            ? { ...entry, focusedId: id, diffFocused: false }
            : entry,
        );
        tabsRef.current = focused;
        setTabs(focused);
        setProjectTerminalFocused(false);
        setComposerFocused(true);
      });
    },
    [activateTab, onSelectProject],
  );
  const sessionPip = useSessionPictureInPicture(
    sessions,
    sessionPaneProps,
    returnToSession,
    (id, focusAndRunActions, hasOwnerActions) => {
      if (
        !groupPipReturns.restored(
          "session",
          id,
          focusAndRunActions,
          hasOwnerActions,
        )
      )
        focusAndRunActions();
    },
  );
  activityPipIdsRef.current = sessionPip.ids;
  const mergeDetachedState = useCallback(
    (state: DetachedWorkspaceState, returning: boolean) => {
      const ids = new Set(
        state.originalSurfaceIds ?? [
          ...state.tabs.map((tab) => tab.id),
          ...state.browsers.map((tab) => tab.id),
        ],
      );
      const closed = new Set(state.closedSurfaceIds ?? []);
      const incoming = new Map(state.tabs.map((tab) => [tab.id, tab]));
      const nextTabs = tabsRef.current.flatMap((tab) => {
        if (closed.has(tab.id)) return [];
        const updated = incoming.get(tab.id);
        incoming.delete(tab.id);
        return [updated ?? tab];
      });
      nextTabs.push(...incoming.values());
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setBrowserWorkspaces((all) => {
        const next = { ...all };
        for (const [cwd, value] of Object.entries(next)) {
          let current = normalizeBrowserWorkspace(value);
          for (const page of current.tabs)
            if (closed.has(browserIdForTab(cwd, page.id)))
              current = closeBrowserTab(current, page.id);
          next[cwd] = current;
        }
        for (const page of state.browsers) {
          const cwd = page.project ?? state.cwd;
          const current = normalizeBrowserWorkspace(next[cwd] ?? EMPTY_BROWSER);
          const existing = current.tabs.some((tab) => tab.id === page.tabId);
          next[cwd] = existing
            ? updateBrowserTab(current, page.tabId, {
                url: page.url,
                title: page.title,
                favicon: page.favicon,
              })
            : addBrowserTab(current, {
                id: page.tabId,
                url: page.url,
                title: page.title,
                favicon: page.favicon,
              });
        }
        browserWorkspacesRef.current = next;
        return next;
      });
      setDirtyFiles((current) => {
        const next = new Set(current);
        const fileIds = new Set(
          state.tabs.flatMap((tab) =>
            [...tab.editorPanes, ...tab.terminalPanes].flatMap((pane) =>
              pane.files.map((file) => file.id),
            ),
          ),
        );
        for (const id of fileIds)
          if (!state.dirtyFileIds?.includes(id)) next.delete(id);
        for (const id of state.dirtyFileIds ?? []) next.add(id);
        return next;
      });
      if (!returning) return;
      const cwd = state.cwd;
      const returningIds = [
        ...state.tabs.map((tab) => tab.id),
        ...state.browsers.map((tab) => tab.id),
      ];
      const remaining = sameProjectPath(projectCwdRef.current, cwd)
        ? viewRef.current.view
        : viewRef.current.get(cwd);
      const restored = restoreWorkspaceArrangement(
        remaining,
        resolveWorkspaceView(state.view, returningIds, state.view.focusedId),
        state.returnPlacement,
      );
      setDetachedIds(
        (current) =>
          new Set(
            [...current].filter(
              (id) => !ids.has(id) && !returningIds.includes(id),
            ),
          ),
      );
      setHomeViewOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      profilesRef.current.selectProfile(
        projectlessProfileForCwd(cwd) ??
          projectWorkspaceProfile(loadWorkspaceProfiles(), cwd),
      );
      setProjectCwd(cwd);
      viewRef.current.restore(cwd, restored);
      const focusedTab =
        state.tabs.find((tab) => tab.id === restored.focusedId) ??
        state.tabs[0];
      if (focusedTab) setActiveTabId(focusedTab.id);
    },
    [],
  );
  const detached = useDetachedWorkspaces({
    sessions,
    sessionProps: sessionPaneProps,
    onUpdatePlan,
    onNewSession: async (_windowId, cwd) => {
      const session = newDefaultSession(cwd);
      const tab = newTab(session.id);
      flushSync(() => {
        const next = [...sessionsRef.current, session];
        sessionsRef.current = next;
        setSessions(next);
      });
      return {
        cwd,
        title: basename(cwd) || "Workspace",
        tabs: [tab],
        browsers: [],
        view: resolveWorkspaceView(undefined, [tab.id], tab.id),
        sessions: [{ session, recents }],
      };
    },
    onCheckpoint: (state) => mergeDetachedState(state, false),
    onReturned: (state) => {
      flushSync(() => mergeDetachedState(state, true));
    },
    onError: (error) => {
      void message(error, { title: "Workspace window", kind: "error" });
    },
  });
  detachedBrowserBridge.current = detached.openForSession;
  detachedFileBridge.current = detached.openFileForSession;
  detachedShowSurface.current = async (surfaceId) => {
    const window = detached.snapshots.find(
      (entry) =>
        entry.state.tabs.some((tab) => tab.id === surfaceId) ||
        entry.state.browsers.some((tab) => tab.id === surfaceId),
    );
    if (!window) return false;
    try {
      await detached.show(window.id);
      return true;
    } catch (error) {
      void message(String(error), { kind: "error" });
      return false;
    }
  };
  activityWindowBridgeRef.current = {
    floatingSessionIds: [...detached.detachedSessionIds],
    focusedSessionIds: detached.activeVisibleSessionIds,
    showSession: detached.showSession,
  };
  const detachedKey = [...detached.detachedSurfaceIds].sort().join("\0");
  useLayoutEffect(() => {
    setDetachedIds(new Set(detached.detachedSurfaceIds));
  }, [detachedKey]);
  const movingWindow = useRef(false);
  moveWindowRef.current = async (ids, target, point) => {
    if (movingWindow.current) return;
    movingWindow.current = true;
    const cwd = projectCwdRef.current;
    const before = viewRef.current.view;
    const available = ids.filter((id) => before.order.includes(id));
    try {
      if (!available.length) return;
      const selection = new Set(available);
      const moveError = orchestrationMoveError(
        tabsRef.current.filter((tab) => selection.has(tab.id)),
        orchestrator.snapshot(),
      );
      if (moveError) throw new Error(moveError);
      const state: DetachedWorkspaceState = {
        cwd,
        title: `${basename(cwd) || "Workspace"} · ${available.length === 1 ? "Tab" : "Group"}`,
        tabs: tabsRef.current.filter((tab) => selection.has(tab.id)),
        browsers: normalizeBrowserWorkspace(
          browserWorkspacesRef.current[cwd] ?? EMPTY_BROWSER,
        )
          .tabs.filter((tab) => selection.has(browserIdForTab(cwd, tab.id)))
          .map((tab) => ({
            ...tab,
            tabId: tab.id,
            id: browserIdForTab(cwd, tab.id),
            project: cwd,
            nativeId: detached.nativeBrowserIds[browserIdForTab(cwd, tab.id)],
          })),
        view: selectWorkspaceArrangement(before, available),
        returnPlacement: target
          ? undefined
          : captureWorkspaceReturnPlacement(before, available),
        sessions: [],
        dirtyFileIds: [...dirtyFilesRef.current],
      };
      const openedId = await detached.open(state, target, point);
      setDetachedIds((current) => new Set([...current, ...available]));
      const saved = pushWorkspaceLayoutUndo(recoveryRef.current, cwd, before);
      recoveryRef.current = saved;
      setRecovery(saved);
      const current = viewRef.current.get(cwd);
      viewRef.current.restore(
        cwd,
        closeWorkspaceViews(current, available, current.focusedId),
      );
      return openedId;
    } catch (error) {
      void message(error instanceof Error ? error.message : String(error), {
        title: "Move to window",
        kind: "error",
      });
    } finally {
      movingWindow.current = false;
    }
  };
  const moveTabToWindow = (id: string, target?: string) => {
    void moveWindowRef.current([id], target);
  };
  const moveGroupToWindow = (id: string, target?: string) => {
    void moveWindowRef.current(viewRef.current.view.groups[id] ?? [id], target);
  };

  const reportPipError = (reason: unknown) => {
    void message(reason instanceof Error ? reason.message : String(reason), {
      title: "Picture in Picture",
      kind: "error",
    });
  };
  const onGroupPictureInPicture = async (members: string[]) => {
    const id = await moveWindowRef.current(members);
    if (id) await nativeWorkspaceWindow.pinned(true, id).catch(reportPipError);
  };
  const onPictureInPicture = (id: string) => {
    void onGroupPictureInPicture([id]);
  };
  useEffect(() => {
    if (sessionPip.error)
      void message(sessionPip.error, {
        title: "Picture in Picture",
        kind: "error",
      });
  }, [sessionPip.error]);

  const profileSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          projectlessProfileForCwd(session.cwd) === profiles.activeProfileId ||
          profiles.profileProjects.some((project) =>
            sameProjectPath(project.path, session.cwd),
          ),
      ),
    [profiles.profileProjects, profiles.activeProfileId, sessions],
  );
  const standaloneSessions = useMemo(() => {
    if (!standaloneCwd) return [];
    const rows = new Map(
      historyWithLiveSessions(history, sessions, standaloneCwd).map(
        (session) => [session.id, session],
      ),
    );
    for (const session of sessions) {
      if (
        !session.inboxAsk &&
        sameProjectPath(session.cwd, standaloneCwd) &&
        !rows.has(session.id)
      ) {
        rows.set(session.id, summaryFromSession(session));
      }
    }
    return [...rows.values()];
  }, [standaloneCwd, history, sessions]);
  const profileSessionSummaries = useMemo(
    () =>
      !sidebarHover.visible
        ? {}
        : Object.fromEntries(
            profiles.profileProjects.map((project) => [
              project.path,
              historyWithLiveSessions(
                history,
                sessions,
                project.path,
                undefined,
                orchestrationRuns,
              ),
            ]),
          ),
    [
      sidebarHover.visible,
      profiles.profileProjects,
      history,
      sessions,
      orchestrationRuns,
    ],
  );
  const profilePreviews = useMemo<
    Readonly<Record<string, WorkspaceProfilePreviewData>>
  >(() => {
    if (!sidebarHover.visible) return {};
    const labels = loadTabGroupLabels();
    const tasksFor = (cwd: string) =>
      historyWithLiveSessions(
        history,
        sessions,
        cwd,
        undefined,
        orchestrationRuns,
      )
        .filter((session) => !session.archived && !session.orchestrationLeadId)
        .slice(0, SESSION_LIST_PAGE)
        .map((session) => ({
          id: session.id,
          title: sessionDisplayTitle(session.title, session.harness),
          busy: busySessionIds.has(session.id),
        }));
    return Object.fromEntries(
      profiles.profiles.map((profile) => {
        const standalone = projectlessCwdForProfile(profile.id);
        return [
          profile.id,
          {
            id: profile.id,
            name: profile.name,
            projects: projectRailItems(
              profiles.projectsByProfile[profile.id] ?? [],
              "~",
            ).map((project) => ({
              path: project.path,
              name: projectDisplayName(project.path, labels),
              tasks: tasksFor(project.path),
            })),
            standaloneTasks: standalone ? tasksFor(standalone) : [],
          },
        ];
      }),
    );
  }, [
    sidebarHover.visible,
    profiles.profiles,
    profiles.projectsByProfile,
    history,
    sessions,
    orchestrationRuns,
    busySessionIds,
  ]);
  const openActions: WorkspaceStatusAction[] = [
    {
      id: "browser",
      label: "Open preview in Brave",
      disabled: profileHome || !browserState.url,
      onSelect: () => {
        void openUrl(browserState.url, "Brave Browser").catch((error) =>
          message(String(error), { kind: "error" }),
        );
      },
    },
    {
      id: "finder",
      label: "Reveal project in Finder",
      disabled: profileHome,
      onSelect: () => {
        void revealPath(projectCwd).catch((error) =>
          message(String(error), { kind: "error" }),
        );
      },
    },
  ];
  const browserSurfaceActions = useRef<BrowserSurfaceActions>(null!);
  browserSurfaceActions.current = {
    pictureInPictureResult: browserPip.complete,
    returnToWorkspace: (project, id, tabId) => {
      const restore = () => {
        if (
          !normalizeBrowserWorkspace(browserWorkspaces[project]).tabs.some(
            (tab) => tab.id === tabId,
          )
        )
          return;
        // Project selection normally reveals its session. Restore the browser
        // selection in the same commit so that fallback cannot steal focus.
        flushSync(() => {
          onSelectProject(project);
          setBrowserWorkspaces((all) => {
            const current = all[project];
            return current
              ? {
                  ...all,
                  [project]: {
                    ...selectBrowserTab(current, tabId),
                    expanded: true,
                  },
                }
              : all;
          });
          viewRef.current.focus(project, id);
          setComposerFocused(false);
        });
      };
      if (!groupPipReturns.restored("browser", id, restore)) restore();
    },
    focus: (project, id) => {
      if (project === projectCwd && workspaceVisible && view.focusedId !== id)
        onSelectBrowserTab(id);
    },
    close: (project, id) => {
      if (project === projectCwd) onCloseBrowserTab(id);
    },
    expand: (id) =>
      workspaceViews.change((view) => {
        return toggleWorkspaceExpansion(view, id, activeTabId);
      }),
    update: (project, tabId, patch) =>
      setBrowserWorkspaces((all) => {
        const current = all[project];
        const page = current?.tabs?.find((page) => page.id === tabId);
        if (
          !page ||
          Object.entries(patch).every(
            ([key, value]) =>
              page[key as "url" | "title" | "favicon"] === value,
          )
        )
          return all;
        return { ...all, [project]: updateBrowserTab(current, tabId, patch) };
      }),
    addToChat: (text, attachments) => {
      workspaceViews.change((view) => selectWorkspaceView(view, activeTabId));
      activateTab(activeTabId);
      requestAnimationFrame(() => requestAddToChat(text, "plain", attachments));
    },
  };

  return (
    <OrchestrationActions.Provider value={orchestrationActions}>
      <OrchestrationWorkers.Provider value={orchestrationWorkers}>
        <div
          className="personal-shell flex h-full text-content"
          data-sidebar-pinned={sidebarOpen}
          data-unified-toolbar
        >
          <WorkspaceStatusBar
            settingsView={
              settingsOpen
                ? { section: settingsSection, onClose: onCloseSettings }
                : undefined
            }
            workspaceTabs={
              unifiedWorkspaceTabs ? (
                <div
                  ref={setWorkspaceToolbarHost}
                  className="personal-workspace-toolbar-host"
                />
              ) : undefined
            }
            sessions={profileSessions}
            session={profileHome ? undefined : active}
            accessMode={
              profileHome
                ? defaultAccess
                : (active?.runtimeMode ?? defaultAccess)
            }
            onAccessModeChange={(mode) => {
              setDefaultAccess(mode);
              saveDefaultRuntimeMode(mode);
              if (!profileHome && active) onRuntimeModeChange(active.id, mode);
            }}
            onSelectSession={onOpenApprovalSession}
            usageProviders={profileHome ? [] : usageProviders}
            openActions={openActions}
            onToggleSidebar={onToggleSidebar}
            sidebarOpen={sidebarOpen}
            onSearch={onOpenSearch}
            onNewBrowser={onGlobalNewBrowser}
            onGoBack={onRailBack}
            onGoForward={onRailForward}
            canGoBack={tabVisitNav.canBack}
            canGoForward={tabVisitNav.canForward}
            onHome={onOpenHome}
            homeOpen={homeViewOpen || profileHome}
            onToggleInspector={onToggleInspector}
            inspectorOpen={inspector.open}
            onOpenSettings={onOpenSettings}
          />
          <div className="personal-shell-body">
            {!sidebarOpen ? (
              <button
                type="button"
                className="personal-panel-edge personal-panel-edge-left"
                aria-label="Show workspace sidebar"
                {...sidebarHover.edgeHandlers}
                onClick={onToggleSidebar}
              />
            ) : null}
            <Sidebar
              cwd={profileHome ? "~" : sidebarCwd}
              gitCwd={profileHome ? "~" : gitCwd}
              profiles={profiles.profiles}
              profilePreviews={profilePreviews}
              activeProfileId={profiles.activeProfileId}
              onSelectProfile={onSelectProfile}
              onCreateProfile={(name) =>
                onSelectProfile(profiles.createProfile(name))
              }
              onMoveProject={(path, id) => {
                const next = profiles.moveProject(path, id);
                if (looksLikeProject(next)) onSelectProject(next);
              }}
              onAddProject={(anchor) =>
                anchor ? setAddProjectAnchor(anchor) : void pickProject()
              }
              projectSessions={profileSessionSummaries}
              onExpandProject={refreshProfileHistory}
              loadedProjectPaths={loadedProjects}
              projectHistoryErrors={profileHistoryErrors}
              onSelectProjectSession={(_path, id) =>
                void onSelectHistorySession(id)
              }
              onNewProjectTask={onNewProjectTask}
              open={sidebarHover.visible}
              floating={!sidebarOpen}
              hoverHandlers={sidebarHover.panelHandlers}
              tab={sidebarTab}
              onTabChange={(tab) => {
                setSidebarTab(tab);
                setSearchViewOpen(false);
                setInboxViewOpen(false);
                setNotesViewOpen(false);
              }}
              filesSearchOpen={filesSearchOpen}
              onFilesSearchOpenChange={setFilesSearchOpen}
              onOpenFilesSearch={onFindInProject}
              searchFocusToken={searchFocusToken}
              sessions={
                profileHome
                  ? []
                  : standaloneActive
                    ? standaloneSessions
                    : sidebarHistory
              }
              busySessionIds={busySessionIds}
              approvalSessionIds={approvalSessionIds}
              activeSessionId={profileHome ? undefined : active?.id}
              status={historyFailed ? "error" : "idle"}
              pending={historyPending}
              onSelectSession={onSelectHistorySession}
              onSessionNavigationOrder={onSessionNavigationOrder}
              onPlaceSessionOnPane={onPlaceSessionOnPane}
              onRenameSession={onRenameHistorySession}
              onArchiveSession={onArchiveHistorySession}
              onArchiveSessions={onArchiveHistorySessions}
              onPinSession={onPinHistorySession}
              onPinSessions={onPinHistorySessions}
              onDeleteSession={onDeleteHistorySession}
              onDeleteSessions={onDeleteHistorySessions}
              onOpenFile={onOpenFile}
              onOpenTerminal={onOpenTerminal}
              onFileMoved={onFileMoved}
              onFileDeleted={onFileDeleted}
              canGoBack={tabVisitNav.canBack}
              canGoForward={tabVisitNav.canForward}
              onGoBack={onRailBack}
              onGoForward={onRailForward}
              onOpenDiff={onOpenWorkingTreeDiff}
              onOpenAllChanges={onOpenAllChanges}
              onOpenCommit={onOpenCommit}
              onShowSourceControl={onToggleChanges}
              selectedDiffPath={
                activeTab ? selectedChangePath(activeTab, gitCwd) : undefined
              }
              selectedDiffKind={
                activeTab ? selectedChangeKind(activeTab) : undefined
              }
              selectedCommitSha={
                activeTab ? selectedCommitSha(activeTab) : undefined
              }
              textHarness={pickTextHarness(active?.harness)}
              recents={profiles.profileProjects}
              busyProjectPaths={sessions.flatMap((session) =>
                session.busy && session.cwd ? [session.cwd] : [],
              )}
              liveAgents={liveAgents}
              onSelectAgent={onSelectLiveAgent}
              onSelectProject={onSelectProject}
              onOpenProject={pickProject}
              onRemoveProject={onRemoveProject}
              onNew={onNew}
              onNewStandalone={() => void onNewStandalone()}
              startingStandalone={startingStandalone}
              standaloneActive={standaloneActive}
              standaloneSessions={standaloneSessions}
              onOpenStandalone={
                standaloneCwd ? () => onSelectProject(standaloneCwd) : undefined
              }
              openSessions={profileHome ? [] : openProjectSessions}
              onNewTerminal={onNewTerminal}
              onSearch={onOpenSearch}
              onOpenInbox={onOpenInbox}
              onOpenNotes={notesEnabled ? onOpenNotes : undefined}
              onGoToFile={onGoToFile}
              searchActive={searchViewOpen}
              inboxActive={inboxViewOpen}
              notesActive={notesViewOpen}
              notesEnabled={notesEnabled}
              projectRailOpen={projectRailOpen}
              onToggleProjectRail={onToggleProjectRail}
              unseenFinishedIds={unseenFinishedIds}
              settingsOpen={settingsOpen}
              settingsSection={settingsSection}
              onOpenSettings={onOpenSettings}
              onSelectSettingsSection={onSelectSettingsSection}
              onCloseSettings={onCloseSettings}
              updateNotice={updateNotice}
              onOpenWhatsNew={onOpenWhatsNew}
              onDismissUpdate={() => setUpdateNotice(null)}
            />

            <div
              className="personal-workspace-column"
              data-settings-open={settingsOpen}
              style={
                {
                  "--workspace-inspector-width":
                    inspector.open && workspaceVisible
                      ? `${inspector.width}px`
                      : "0px",
                } as CSSProperties
              }
            >
              <div className="personal-workspace-body">
                <div className="personal-main body-glass flex min-h-0 min-w-0 flex-1 flex-col">
                  {(profileHome || homeViewOpen || view.order.length === 0) &&
                  !settingsOpen &&
                  !searchViewOpen &&
                  !inboxViewOpen &&
                  !notesViewOpen ? (
                    <WorkspaceHome
                      profile={profiles.activeProfile.name}
                      projects={profiles.profileProjects.map((project) => ({
                        path: project.path,
                        name: basename(project.path),
                      }))}
                      sessions={[
                        ...new Map(
                          [
                            ...history.filter((entry) => !entry.archived),
                            ...sessions.map((entry) => ({
                              ...summaryFromSession(entry),
                              busy: entry.busy,
                            })),
                          ].map((entry) => [entry.id, entry]),
                        ).values(),
                      ]
                        .filter((session) => !session.orchestrationLeadId)
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .filter(
                          (session) =>
                            projectlessProfileForCwd(session.cwd) ===
                              profiles.activeProfileId ||
                            profiles.profileProjects.some((project) =>
                              sameProjectPath(project.path, session.cwd),
                            ),
                        )
                        .map((session) => ({
                          id: session.id,
                          cwd: session.cwd,
                          title: sessionDisplayTitle(
                            session.title,
                            session.harness,
                          ),
                          project: isProjectlessCwd(session.cwd)
                            ? "No project"
                            : basename(session.cwd),
                          harness: session.harness,
                          busy: sessions.find((live) => live.id === session.id)
                            ?.busy,
                        }))}
                      windows={detached.windows}
                      onShowWindow={(id) => {
                        void detached
                          .show(id)
                          .catch((error) =>
                            message(String(error), { kind: "error" }),
                          );
                      }}
                      onReturnWindow={(id) => {
                        void detached
                          .returnWindow(id)
                          .catch((error) =>
                            message(String(error), { kind: "error" }),
                          );
                      }}
                      starting={startingStandalone}
                      onNew={() => void onNewStandalone()}
                      onBrowser={() => void onNewStandalone(true)}
                      onProject={onSelectProject}
                      onSession={(id) => {
                        setHomeViewOpen(false);
                        void onSelectHistorySession(id);
                      }}
                      onAddProject={pickProject}
                      onSearch={onOpenSearch}
                    />
                  ) : null}
                  <div
                    className="personal-workspace-content flex min-h-0 min-w-0 flex-1 flex-col"
                    hidden={!workspaceVisible}
                    aria-hidden={!workspaceVisible}
                    inert={!workspaceVisible || undefined}
                  >
                    {!IS_MAC ? (
                      <MenuBar
                        onNew={onNew}
                        onNewTerminal={onNewTerminal}
                        onToggleTerminal={onToggleProjectTerminal}
                        onGoToFile={onGoToFile}
                        onToggleSidebar={onToggleSidebar}
                        onShowSourceControl={onToggleChanges}
                        onCloseCurrentTab={
                          browserExpanded
                            ? () => onCloseBrowserTab(view.focusedId)
                            : activeTabId
                              ? () => onCloseTab(activeTabId)
                              : undefined
                        }
                        onCloseOtherTabs={onCloseOtherTabs}
                        onPickProject={pickProject}
                        onFindInProject={onFindInProject}
                        onSearch={onOpenSearch}
                        onOpenInbox={onOpenInbox}
                        onOpenNotes={notesEnabled ? onOpenNotes : undefined}
                        onZoomIn={() => {
                          const next = saveUiScale(
                            zoomInUiScale(loadUiScale()),
                          );
                          void applyUiScale(next);
                        }}
                        onZoomOut={() => {
                          const next = saveUiScale(
                            zoomOutUiScale(loadUiScale()),
                          );
                          void applyUiScale(next);
                        }}
                        onZoomReset={() => {
                          saveUiScale(UI_SCALE_DEFAULT);
                          void applyUiScale(UI_SCALE_DEFAULT);
                        }}
                      />
                    ) : null}

                    <main className="relative min-h-0 min-w-0 flex-1">
                      <div
                        ref={dockGridRef}
                        className="absolute inset-0 grid h-full min-h-0 min-w-0"
                      >
                        {projectTerminals.map((dock) => {
                          const show =
                            dock.open &&
                            sameProjectPath(dock.projectPath, projectCwd);
                          return (
                            <div
                              key={dock.projectPath}
                              className={
                                show
                                  ? "h-full min-h-0 min-w-0 w-full overflow-hidden"
                                  : "hidden"
                              }
                              style={show ? { gridArea: "dock" } : undefined}
                              aria-hidden={!show}
                            >
                              <ProjectTerminalDock
                                dock={dock}
                                presented={show && workspaceVisible}
                                focused={show && projectTerminalFocused}
                                onFocus={focusProjectTerminal}
                                onHide={onHideProjectTerminal}
                                onSideChange={onProjectTerminalSide}
                                onSizePaint={paintDockSize}
                                onSizeCommit={commitDockSize}
                                onAddTerminal={() =>
                                  onOpenTerminal(active?.cwd ?? projectCwd)
                                }
                                onSelectTerminal={onSelectProjectTerminal}
                                onCloseTerminal={onCloseProjectTerminal}
                                onReorderTerminals={onReorderProjectTerminals}
                                onTerminalMetaChange={onTerminalMetaChange}
                              />
                            </div>
                          );
                        })}
                        <div
                          className="relative min-h-0 min-w-0"
                          style={{ gridArea: "main" }}
                        >
                          <WorkspaceStage
                            toolbarHost={
                              unifiedWorkspaceTabs ? workspaceToolbarHost : null
                            }
                            headers={visibleSurfaceIds.map((owner) => {
                              const members = view.groups[owner] ?? [owner];
                              return {
                                id: owner,
                                key: workspaceHeaderKeys[owner],
                                content: (
                                  <TitleBar
                                    tabs={titleTabs.filter((tab) =>
                                      members.includes(tab.id),
                                    )}
                                    totalSessionTabs={titleTabs.length}
                                    paneLocal
                                    windowToolbar={unifiedWorkspaceTabs}
                                    paneFocused={owner === view.focusedId}
                                    activeId={owner}
                                    cwd={sidebarCwd}
                                    projectRailOpen={projectRailOpen}
                                    sidebarOpen={sidebarOpen}
                                    inspectorOpen={
                                      inspector.open && workspaceVisible
                                    }
                                    onToggleInspector={onToggleInspector}
                                    browserTabs={browserSurfaces
                                      .filter((tab) =>
                                        members.includes(tab.surfaceId),
                                      )
                                      .map((tab) => ({
                                        id: tab.surfaceId,
                                        favicon: tab.favicon,
                                        title:
                                          tab.title ||
                                          (tab.url
                                            ? tab.url
                                                .replace(/^https?:\/\//, "")
                                                .split("/")[0]
                                            : "New browser tab"),
                                      }))}
                                    browserOpen={browserState.open}
                                    browserActive={browserFocused}
                                    visibleIds={visibleSurfaceIds}
                                    surfaceOrder={members}
                                    onReorderSurfaces={(ids, movedId) => {
                                      changeLayout((view) =>
                                        reorderWorkspaceGroup(view, owner, ids),
                                      );
                                      onReorderTabs(
                                        ids.filter((id) =>
                                          tabs.some((tab) => tab.id === id),
                                        ),
                                        movedId &&
                                          tabs.some((tab) => tab.id === movedId)
                                          ? movedId
                                          : undefined,
                                      );
                                    }}
                                    onSplitTab={(id, edge, targetId) =>
                                      changeLayout((view) =>
                                        splitWorkspaceView(
                                          view,
                                          id,
                                          edge,
                                          targetId,
                                        ),
                                      )
                                    }
                                    onUnsplit={() =>
                                      changeLayout((view) =>
                                        collapseWorkspaceView(view, owner),
                                      )
                                    }
                                    combineTargets={
                                      view.layout
                                        ? (
                                            [
                                              ["left", "left pane"],
                                              ["right", "right pane"],
                                              ["up", "pane above"],
                                              ["down", "pane below"],
                                            ] as const
                                          )
                                            .map(([direction, label]) => ({
                                              id: neighborLeafId(
                                                view.layout!,
                                                owner,
                                                direction,
                                              ),
                                              label: String(label),
                                            }))
                                            .filter(
                                              (
                                                target,
                                                index,
                                                all,
                                              ): target is {
                                                id: string;
                                                label: string;
                                              } =>
                                                !!target.id &&
                                                all.findIndex(
                                                  (entry) =>
                                                    entry.id === target.id,
                                                ) === index,
                                            )
                                        : []
                                    }
                                    onCombineWith={(targetId) =>
                                      changeLayout((view) =>
                                        combineWorkspaceGroups(
                                          view,
                                          owner,
                                          targetId,
                                        ),
                                      )
                                    }
                                    onPictureInPicture={onPictureInPicture}
                                    onGroupPictureInPicture={() => {
                                      void onGroupPictureInPicture(members);
                                    }}
                                    pictureInPictureIds={members}
                                    windowTargets={detached.windows.filter(
                                      (target) =>
                                        detached.states.get(target.id)?.cwd ===
                                        projectCwd,
                                    )}
                                    onMoveTabToWindow={moveTabToWindow}
                                    onMoveGroupToWindow={moveGroupToWindow}
                                    groupId={owner}
                                    groupLabel={`${members.length} tabs`}
                                    onGroupDragMove={onGroupDragMove}
                                    onGroupDragEnd={onGroupDragEnd}
                                    onReopenClosedTab={() => {
                                      void onReopenClosedTab();
                                    }}
                                    canReopenClosedTab={recovery.closed.some(
                                      (entry) => entry.cwd === projectCwd,
                                    )}
                                    onUndoLayout={onUndoLayout}
                                    canUndoLayout={recovery.layouts.some(
                                      (entry) => entry.cwd === projectCwd,
                                    )}
                                    onSurfaceDragMove={onSurfaceDragMove}
                                    onSurfaceDragEnd={onSurfaceDragEnd}
                                    onNewBrowser={() => {
                                      workspaceViews.change((view) =>
                                        selectWorkspaceView(view, owner),
                                      );
                                      onNewBrowserTab();
                                    }}
                                    onNewView={
                                      members.length > 1 ||
                                      visibleSurfaceIds.length > 1
                                        ? (id) =>
                                            changeLayout((view) =>
                                              splitWorkspaceView(
                                                view,
                                                id,
                                                "right",
                                                owner,
                                              ),
                                            )
                                        : undefined
                                    }
                                    onSelectBrowser={onSelectBrowserTab}
                                    onCloseBrowser={onCloseBrowserTab}
                                    onToggleSidebar={onToggleSidebar}
                                    onSelect={(id) => {
                                      workspaceViews.change((view) =>
                                        selectWorkspaceView(view, id),
                                      );
                                      activateTab(id);
                                    }}
                                    onNew={() => {
                                      workspaceViews.change((view) =>
                                        selectWorkspaceView(view, owner),
                                      );
                                      onNew();
                                    }}
                                    onShowTerminal={undefined}
                                    projectTerminalActive={
                                      !!currentProjectDock &&
                                      currentProjectDock.pane.files.length > 0
                                    }
                                    onOpenSettings={onOpenSettings}
                                    onOpenInbox={onOpenInbox}
                                    onOpenNotes={
                                      notesEnabled ? onOpenNotes : undefined
                                    }
                                    onClose={onCloseTitleTab}
                                    onCloseMany={onCloseTabs}
                                    onReorder={onReorderTabs}
                                    onGoToFile={onGoToFile}
                                    recents={recents}
                                    onSelectProject={onSelectProject}
                                  />
                                ),
                              };
                            })}
                            layout={view.layout}
                            focusedId={view.focusedId}
                            visible={workspaceVisible}
                            onFocus={(id) => {
                              if (id === view.focusedId) return;
                              if (
                                browserSurfaces.some(
                                  (tab) => tab.surfaceId === id,
                                )
                              )
                                onSelectBrowserTab(id);
                              else {
                                workspaceViews.change((view) =>
                                  selectWorkspaceView(view, id),
                                );
                                activateTab(id);
                              }
                            }}
                            onLayoutChange={(layout) =>
                              changeLayout((view) => ({ ...view, layout }))
                            }
                            dragging={surfaceDragging}
                            dragKind={dragKind}
                            dragLabel={
                              dragKind === "group" ? "Move group" : "Move tab"
                            }
                            dragTarget={surfaceDrop}
                            surfaces={[
                              ...tabs
                                .filter((tab) => !detachedIds.has(tab.id))
                                .map((tab) => ({
                                  id: tab.id,
                                  content: (
                                    <PaneTree
                                      {...sessionPaneProps}
                                      floatingSessionIds={sessionPip.ids}
                                      onShowFloatingSession={sessionPip.show}
                                      onReturnFloatingSession={
                                        sessionPip.returnSession
                                      }
                                      visible={
                                        visibleSurfaceIds.includes(tab.id) &&
                                        workspaceVisible
                                      }
                                      layout={tab.layout}
                                      sessions={sessions}
                                      editorPanes={[
                                        ...tab.editorPanes,
                                        ...(tab.terminalPanes ?? []),
                                      ]}
                                      dirtyFileIds={dirtyFiles}
                                      fileErrorCounts={fileErrorCounts}
                                      focusedId={
                                        tab.id === view.focusedId &&
                                        workspaceVisible &&
                                        !tab.diffFocused &&
                                        !projectTerminalFocused
                                          ? tab.focusedId
                                          : ""
                                      }
                                      addToChatSessionId={
                                        tab.id === activeTabId
                                          ? active?.id
                                          : undefined
                                      }
                                      composerFocused={
                                        composerFocused &&
                                        tab.id === view.focusedId &&
                                        workspaceVisible &&
                                        !projectTerminalFocused
                                      }
                                      onSelectFile={onSelectFileSurface}
                                      onCloseFile={onCloseFile}
                                      onReorderFiles={onReorderFiles}
                                      onFileDirtyChange={onFileDirtyChange}
                                      onFileErrorCountChange={
                                        onFileErrorCountChange
                                      }
                                      onRatio={(splitId, index, ratio) =>
                                        onRatio(tab.id, splitId, index, ratio)
                                      }
                                      editorNavigation={editorNavigation}
                                      onUpdatePlan={onUpdatePlan}
                                      onMovePane={onMovePane}
                                      onTerminalMetaChange={
                                        onTerminalMetaChange
                                      }
                                    />
                                  ),
                                })),
                              ...Object.entries(browserWorkspaces).flatMap(
                                ([project, state]) => {
                                  const current =
                                    normalizeBrowserWorkspace(state);
                                  return current.open
                                    ? current.tabs
                                        .filter(
                                          (tab) =>
                                            !detachedIds.has(
                                              browserIdForTab(project, tab.id),
                                            ),
                                        )
                                        .map((tab) => {
                                          const id = browserIdForTab(
                                            project,
                                            tab.id,
                                          );
                                          return {
                                            id,
                                            content: (
                                              <WorkspaceBrowserSurface
                                                id={id}
                                                project={project}
                                                tabId={tab.id}
                                                url={tab.url}
                                                attachedNativeId={
                                                  detached.nativeBrowserIds[id]
                                                }
                                                agentRequested={agentBrowserSurfaces.has(
                                                  id,
                                                )}
                                                visible={
                                                  project === projectCwd &&
                                                  workspaceVisible &&
                                                  visibleSurfaceIds.includes(id)
                                                }
                                                expanded={
                                                  visibleSurfaceIds.length === 1
                                                }
                                                pictureInPictureRequest={
                                                  browserPipRequests[id]
                                                }
                                                actions={browserSurfaceActions}
                                              />
                                            ),
                                          };
                                        })
                                    : [];
                                },
                              ),
                            ]}
                          />
                        </div>
                      </div>
                    </main>
                  </div>
                  {searchViewOpen ? (
                    <SearchView
                      open
                      cwd={sidebarCwd}
                      recents={recents}
                      history={projectHistory}
                      sessions={sessions.filter((session) => !session.inboxAsk)}
                      focusToken={searchViewFocusToken}
                      besideRail={sidebarOpen}
                      onClose={onLeaveSearch}
                      onToggleSidebar={onToggleSidebar}
                      onOpenFile={onOpenFile}
                      onOpenSession={onSelectHistorySession}
                      onOpenProject={onSelectProject}
                    />
                  ) : null}
                  <div className="hidden" aria-hidden>
                    {sessions
                      .filter((session) => session.inboxAsk)
                      .map((session) => {
                        const visible =
                          inboxViewOpen &&
                          inboxAskPortal?.sessionId === session.id;
                        return (
                          <SessionSurface
                            key={session.id}
                            host={visible ? inboxAskPortal.host : undefined}
                          >
                            <SessionPane
                              {...sessionPaneProps}
                              session={session}
                              visible={visible}
                              focused={visible}
                              inSplit={false}
                              composerFocused={composerFocused}
                            />
                          </SessionSurface>
                        );
                      })}
                  </div>
                  {inboxViewOpen ? (
                    <InboxView
                      cwd={sidebarCwd}
                      recents={recents}
                      besideRail={sidebarOpen}
                      onClose={onLeaveInbox}
                      onToggleSidebar={onToggleSidebar}
                      onStart={onStartInboxItem}
                      onAsk={onAskInboxItem}
                      onAskRestart={onRestartInboxAsk}
                      onAskMount={setInboxAskPortal}
                    />
                  ) : null}
                  {notesViewOpen ? (
                    <NotesView
                      besideRail={sidebarOpen}
                      cwd={projectCwd}
                      onClose={onLeaveNotes}
                      onToggleSidebar={onToggleSidebar}
                    />
                  ) : null}
                  {settingsOpen ? (
                    <SettingsView
                      showToolbar={false}
                      section={settingsSection}
                      onSelectSection={onSelectSettingsSection}
                      workspaceName={profiles.activeProfile.name}
                      cwd={sidebarCwd}
                      sessions={sidebarHistory}
                      besideRail={sidebarOpen}
                      onToggleSidebar={onToggleSidebar}
                      onClose={onCloseSettings}
                      onOpenSession={onOpenArchivedSession}
                      onArchiveSession={onArchiveHistorySession}
                      onDeleteSession={onDeleteHistorySession}
                      onRestoreProject={onRestoreProject}
                      onDeleteProject={(path) =>
                        onRemoveProject(path, { purgeData: true })
                      }
                      onOpenWhatsNew={onOpenWhatsNew}
                    />
                  ) : null}
                </div>

                <PersonalInspectorDock
                  active={inspectorVisible}
                  width={inspector.width}
                  onWidthChange={onInspectorWidth}
                  cwd={sidebarCwd}
                  gitCwd={gitCwd}
                  tab={inspector.tab}
                  onTabChange={onInspectorTab}
                  onClose={onCloseInspector}
                  onOpenFile={onOpenFile}
                  onOpenTerminal={onOpenTerminal}
                  onFileMoved={onFileMoved}
                  onFileDeleted={onFileDeleted}
                  onOpenDiff={onOpenWorkingTreeDiff}
                  onOpenAllChanges={onOpenAllChanges}
                  onOpenCommit={onOpenCommit}
                  selectedDiffPath={
                    activeTab
                      ? selectedChangePath(activeTab, gitCwd)
                      : undefined
                  }
                  selectedDiffKind={
                    activeTab ? selectedChangeKind(activeTab) : undefined
                  }
                  selectedCommitSha={
                    activeTab ? selectedCommitSha(activeTab) : undefined
                  }
                  textHarness={pickTextHarness(active?.harness)}
                  filesSearchOpen={filesSearchOpen}
                  onFilesSearchOpenChange={setFilesSearchOpen}
                  onOpenFilesSearch={onFindInProject}
                  searchFocusToken={searchFocusToken}
                />
              </div>
              <WorkspaceFooter
                active={
                  !settingsOpen &&
                  !searchViewOpen &&
                  !inboxViewOpen &&
                  !notesViewOpen
                }
                cwd={profileHome ? "~" : gitCwd}
                branch={profileHome ? null : projectBranches?.current}
                detached={projectBranches?.detached}
                onOpenBranchPicker={setBranchAnchor}
                branchDisabledReason={
                  !projectBranches
                    ? "This project is not a Git repository"
                    : undefined
                }
                onOpenChanges={onToggleChanges}
                changesOpen={inspectorVisible && inspector.tab === "changes"}
                onToggleTerminal={() => {
                  if (!profileHome) onToggleProjectTerminal();
                }}
                terminalOpen={!profileHome && dockVisible}
                onCreatePR={() => openWorkspaceAction("pr")}
                createPRDisabledReason={
                  !projectBranches
                    ? "This project is not a Git repository"
                    : undefined
                }
                onOpenPRMenu={setPrAnchor}
                prMenuOpen={!!prAnchor}
              />
            </div>
          </div>
          {addProjectAnchor ? (
            <Popover
              anchor={addProjectAnchor}
              side="top"
              align="start"
              width={228}
              autoFocus
              onDismiss={() => setAddProjectAnchor(null)}
            >
              <div
                className="personal-project-menu"
                role="menu"
                aria-label="Add project"
              >
                <button role="menuitem" onClick={() => void pickProject()}>
                  <FolderPlus className="size-3.5" /> Add existing project
                </button>
                <button
                  role="menuitem"
                  onClick={() => openWorkspaceAction("clone")}
                >
                  <ArrowDownCircle className="size-3.5" /> Clone from URL
                </button>
                <button
                  role="menuitem"
                  onClick={() => openWorkspaceAction("create")}
                >
                  <Folder className="size-3.5" /> Quick start new project
                </button>
              </div>
            </Popover>
          ) : null}
          {branchAnchor && !profileHome ? (
            <BranchPicker
              key={gitCwd}
              cwd={gitCwd}
              branch={projectBranches?.current ?? undefined}
              externalAnchor={branchAnchor}
              defaultOpen
              hideTrigger
              onClose={() => setBranchAnchor(null)}
            />
          ) : null}
          {prAnchor ? (
            <Popover
              anchor={prAnchor}
              side="top"
              align="end"
              width={215}
              autoFocus
              onDismiss={() => setPrAnchor(null)}
            >
              <div
                className="personal-project-menu"
                role="menu"
                aria-label="Pull request options"
              >
                <button
                  role="menuitem"
                  onClick={() => openWorkspaceAction("pr")}
                >
                  Create PR in GitHub…
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setPrAnchor(null);
                    onToggleChanges();
                  }}
                >
                  Review changes
                </button>
              </div>
            </Popover>
          ) : null}
          {workspaceAction ? (
            <WorkspaceActionDialog
              key={`${workspaceAction.kind}:${workspaceAction.cwd}:${workspaceAction.profileId}`}
              {...workspaceAction}
              scripts={loadRunScripts(workspaceAction.cwd)}
              onScriptsChange={(next) => {
                saveRunScripts(workspaceAction.cwd, next);
              }}
              onCreated={onCreatedProject}
              onClose={() => setWorkspaceAction(null)}
            />
          ) : null}

          {filePickerOpen ? (
            <FilePicker
              open
              cwd={gitCwd}
              openPaths={openFilePaths}
              onOpenFile={onOpenFile}
              onClose={() => setFilePickerOpen(false)}
            />
          ) : null}

          <ApprovalToasts
            notices={hiddenApprovalToasts}
            onFocusSession={onOpenApprovalSession}
            onApproval={onApproval}
          />
          {whatsNewVersion ? (
            <WhatsNewDialog
              version={whatsNewVersion}
              onClose={() => setWhatsNewVersion(null)}
            />
          ) : null}
        </div>
      </OrchestrationWorkers.Provider>
    </OrchestrationActions.Provider>
  );
}
function conversationTitle(session: Session): string {
  const title = sessionDisplayTitle(session.title, session.harness);
  return title === "New session" ? "" : title;
}

function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

function isBlankSession(session: Session | undefined): boolean {
  if (!session || session.busy) return false;
  return !session.blocks.some((block) => block.role === "user");
}

function selectedChangePath(
  tab: WorkspaceTab,
  gitCwd?: string,
): string | undefined {
  const file = focusedFileTab(tab);
  if (!file || !isFilesystemTab(file) || !file.review) return undefined;
  return displayPath(file.path, gitCwd || file.cwd);
}

function selectedChangeKind(tab: WorkspaceTab): GitFileDiffKind | undefined {
  const file = focusedFileTab(tab);
  return file?.review ? file.changeKind : undefined;
}

function selectedCommitSha(tab: WorkspaceTab): string | undefined {
  const focused = focusedFileTab(tab);
  if (focused && isCommitTab(focused)) return focused.commit.sha;
  for (const pane of tab.editorPanes) {
    const file = pane.files.find((entry) => entry.id === pane.activeFileId);
    if (file && isCommitTab(file)) return file.commit.sha;
  }
}

function isBlankWorkspaceTab(tab: WorkspaceTab, sessions: Session[]): boolean {
  if (tab.editorPanes.some((pane) => pane.files.length > 0)) return false;
  if ((tab.terminalPanes ?? []).some((pane) => pane.files.length > 0))
    return false;
  const ids = leafIds(tab.layout);
  if (ids.length !== 1) return false;
  return isBlankSession(sessions.find((entry) => entry.id === ids[0]));
}

function toTitleTab(
  tab: WorkspaceTab,
  sessions: Session[],
  dirtyFiles: Set<string>,
): TitleTab {
  const paneIds = leafIds(tab.layout);
  const multiPane = paneIds.length > 1;
  const tabSessions = paneIds
    .map((id) => sessions.find((session) => session.id === id))
    .filter((session): session is Session => session != null);
  const sessionFocused = tabSessions.some(
    (session) => session.id === tab.focusedId,
  );
  const fileFocused =
    !sessionFocused &&
    (tab.editorPanes.some((pane) => pane.id === tab.focusedId) ||
      (tab.terminalPanes ?? []).some((pane) => pane.id === tab.focusedId));
  const focused =
    sessions.find((session) => session.id === tab.focusedId) ?? tabSessions[0];

  const seen = new Set<HarnessId>();
  const harnesses: HarnessId[] = [];
  const busySeen = new Set<HarnessId>();
  const busyHarnesses: HarnessId[] = [];
  const ordered = focused
    ? [focused, ...tabSessions.filter((session) => session.id !== focused.id)]
    : tabSessions;
  for (const session of ordered) {
    const { harness } = sessionModelIdentity(session);
    if (session.busy && !sessionNeedsInput(session) && !busySeen.has(harness)) {
      busySeen.add(harness);
      busyHarnesses.push(harness);
    }
    if (seen.has(harness)) continue;
    seen.add(harness);
    harnesses.push(harness);
  }

  const files: string[] = [];
  const seenKeys = new Set<string>();
  const pushFile = (file: FilePaneTab) => {
    const key = file.terminal
      ? `terminal:${file.id}`
      : file.plan
        ? `plan:${file.plan.blockId}`
        : file.releaseNotes
          ? `release-notes:${file.releaseNotes.version}`
          : file.path;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    files.push(
      file.plan?.title?.trim() ||
        (file.releaseNotes
          ? releaseNotesTitle(file.releaseNotes.version)
          : file.terminal
            ? terminalTabLabel(file)
            : basename(file.path)),
    );
  };
  const focusedPane =
    tab.editorPanes.find((pane) => pane.id === tab.focusedId) ??
    (tab.terminalPanes ?? []).find((pane) => pane.id === tab.focusedId);
  const otherPanes = [
    ...tab.editorPanes.filter((pane) => pane.id !== focusedPane?.id),
    ...(tab.terminalPanes ?? []).filter((pane) => pane.id !== focusedPane?.id),
  ];
  const panes = focusedPane ? [focusedPane, ...otherPanes] : otherPanes;
  for (const pane of panes) {
    const active = pane.files.find((file) => file.id === pane.activeFileId);
    if (active) pushFile(active);
  }
  for (const pane of panes) {
    for (const file of pane.files) pushFile(file);
  }

  const more = tabSessions
    .filter((session) => session.id !== focused?.id)
    .map(conversationTitle)
    .filter(Boolean);

  const hasTerminal = (tab.terminalPanes ?? []).some((pane) =>
    pane.files.some(isTerminalTab),
  );
  const focusedFile = focusedFileTab(tab);

  return {
    id: tab.id,
    projectPath: focused?.cwd ?? focusedFile?.cwd,
    project: focused
      ? projectName(focused.cwd)
      : focusedFile
        ? projectName(focusedFile.cwd)
        : "~",
    title: focused ? conversationTitle(focused) : "",
    more,
    sessionCount: tabSessions.length,
    models: ordered.map(sessionModelIdentity),
    harnesses,
    busyHarnesses,
    files,
    multiPane,
    fileFocused,
    blank: isBlankWorkspaceTab(tab, sessions),
    dirty: tab.editorPanes.some((pane) =>
      pane.files.some(
        (file) => isFilesystemTab(file) && dirtyFiles.has(file.id),
      ),
    ),
    terminal: hasTerminal && harnesses.length === 0,
    groupId: tab.groupId,
  };
}

function dropOpenFiles(
  tab: WorkspaceTab,
  shouldDrop: (path: string) => boolean,
): WorkspaceTab {
  let layout = tab.layout;
  let focusedId = tab.focusedId;
  const editorPanes: EditorPane[] = [];
  for (const pane of tab.editorPanes) {
    const files = pane.files.filter(
      (file) => !isFilesystemTab(file) || !shouldDrop(file.path),
    );
    if (files.length === 0) {
      const sibling = siblingLeafId(layout, pane.id);
      const withoutPane = removePane(layout, pane.id);
      if (withoutPane) {
        layout = withoutPane;
        if (focusedId === pane.id)
          focusedId = sibling ?? firstLeafId(withoutPane);
      }
      continue;
    }
    editorPanes.push({
      ...pane,
      files,
      activeFileId: files.some((file) => file.id === pane.activeFileId)
        ? pane.activeFileId
        : files[0].id,
    });
  }
  return { ...tab, layout, focusedId, editorPanes };
}

function trackSessionEdits(
  sessionId: string,
  cwd: string,
  event: HarnessEvent,
) {
  if (event.type !== "tool.started" && event.type !== "tool.updated") return;
  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const paths = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ].filter((path, index, all) => all.indexOf(path) === index);
  if (paths.length === 0 || cwd === "~") return;
  const completed =
    event.type === "tool.updated" &&
    (event.status === "completed" || event.status === "success");
  if (!completed) {
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch(() => undefined);
    return;
  }
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch(() => undefined)
    .then(() => notifyReviewChanged(sessionId));
}

function nudgeWorkspace(cwd?: string) {
  invalidateProjectFiles(cwd);
  notifyDirsChanged();
}

function nudgeOpenEditors(event: HarnessEvent, cwd: string) {
  if (event.type !== "tool.updated") return;
  const completed = event.status === "completed" || event.status === "success";

  const kind = event.kind?.trim().toLowerCase();
  if (kind === "execute" || event.preview?.kind === "shell") {
    if (!completed) return;
    nudgeWatchedFiles();
    window.setTimeout(() => nudgeWatchedFiles(), 150);
    notifyGitChanged();
    nudgeWorkspace(cwd);
    window.setTimeout(() => nudgeWorkspace(cwd), 150);
    return;
  }

  if (!isEditTool(event.kind, event.title, event.preview)) return;
  const resolved = [
    ...(event.paths ?? []),
    ...(event.preview?.path ? [event.preview.path] : []),
  ]
    .map((path) => resolveWorkspacePath(path, cwd) ?? path)
    .filter((path, index, paths) => paths.indexOf(path) === index);
  if (completed) {
    // A successful edit is authoritative. Reload it even if a startup race or
    // coarse filesystem timestamp makes the mtime appear unchanged.
    invalidateWatchedFiles(resolved.length > 0 ? resolved : undefined);
  } else if (resolved.length > 0) {
    nudgeWatchedFiles(resolved);
  }
  if (completed) {
    window.setTimeout(
      () => nudgeWatchedFiles(resolved.length > 0 ? resolved : undefined),
      150,
    );
    notifyGitChanged();
    nudgeWorkspace(cwd);
  }
}

function sameSettings(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
