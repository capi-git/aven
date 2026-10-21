import { errorText, failureText, logError } from "./lib/errors";
import { useWorkspaceSessions } from "./hooks/useWorkspaceSessions";
import { useDevSmoke } from "./hooks/useDevSmoke";
import { discardEditorDrafts } from "./lib/workspaceTransfers";
import { useFixedDeadline } from "./hooks/useFixedDeadline";
import { useUtilityViews } from "./hooks/useUtilityViews";
import { whenIdle } from "./lib/idle";
import {
  useWorkspaceShortcuts,
  type WorkspaceActions,
} from "./hooks/useWorkspaceShortcuts";
import { useAccountUsageProviders } from "./hooks/useAccountUsageProviders";
import { useAutomaticModelCatalogs } from "./hooks/useAutomaticModelCatalogs";
import {
  installAgentBrowserHost,
  prepareAgentBrowserPrompt,
  refreshAgentBrowserScopes,
} from "./lib/agentBrowser";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openAgentFileInTabs } from "./lib/agentFiles";
import { orchestrator, type ControlOutcome } from "./lib/orchestration";
import {
  memberTurns,
  quietTurns,
  runOutcomeActivity,
} from "./lib/orchestrationActivity";
import { encodedSidebarRuns } from "./lib/orchestrationSummary";
import { retainedSessionIds } from "./lib/sessionRetention";
import {
  attentionSessionIds,
  leadDecidedIds,
  sessionNeedsUser,
  teamNeedSessionIds,
  type LeadDecided,
} from "./lib/teamAttention";
import { submitManagedTurn } from "./lib/managedSubmission";
import { steerManagedTurn } from "./lib/managedSteering";
import { orchestrationOwnsTurn } from "./lib/workspaceOrchestration";
import {
  adoptLateProposal,
  completeOrchestrationProposal,
  latestProposalId,
  orchestrationPlanningPrompt,
  proposalBlock,
  validateOrchestrationSettings,
  withOrchestrationProposal,
  type OrchestrationProposal,
} from "./lib/orchestrationPlan";
import { createOrchestrationProposalStream } from "./lib/orchestrationProposalStream";
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
import { UpdateNoticeDialog } from "./chrome/UpdateNoticeDialog";
import { UpdateRestartDialog } from "./chrome/UpdateRestartDialog";
import { listen } from "@tauri-apps/api/event";
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
} from "react";
import { PersonalInspectorDock } from "./chrome/PersonalInspectorDock";
import { WorkspaceHome } from "./surfaces/WorkspaceHome";
import { useNativeFloatingSidebar } from "./hooks/useNativeFloatingSidebar";
import { useProjectStatus } from "./hooks/useProjectStatus";
import { useWorkspaceHomeData } from "./hooks/useWorkspaceHomeData";
import { usePresenceTracking } from "./hooks/useHomeBriefing";
import { useSidebarVisibility } from "./hooks/useSidebarVisibility";
import { useSidebarData } from "./hooks/useSidebarData";
import { useSessionModelControls } from "./hooks/useSessionModelControls";
import { useDiscussionBroker } from "./hooks/useDiscussionBroker";
import {
  captureDiscussionWrapUp,
  discussionStore,
  keptDiscussionChats,
} from "./lib/discussions";
import { useDiscussionChatsLoaded } from "./hooks/useDiscussionChatsLoaded";
import { useTeamWatch } from "./hooks/useTeamWatch";
import { TeamWatchFloat, TeamWatchPills } from "./surfaces/TeamWatchPanel";
import { useDiscussionList } from "./hooks/useDiscussions";
import { withPlanBuildTarget } from "./lib/sessionModelChoice";
import { encodeSidebarValue } from "./lib/floatingSidebar";
import { setExternalPaneDrop, type PaneDrop } from "./lib/paneDrop";
import { useWorkspaceSnapshotPersistence } from "./hooks/useWorkspaceSnapshotPersistence";
import { useRecentProjects } from "./hooks/useRecentProjects";
import {
  useAutomationsKeepAwake,
  useScheduledAgents,
} from "./hooks/useScheduledAgents";
import { useAgentKeepAwake } from "./hooks/useAgentKeepAwake";
import { useMemoryKeeper } from "./hooks/useMemoryKeeper";
import {
  agentKeepAwakeProgress,
  agentKeepAwakeSessionIds,
} from "./lib/agentKeepAwake";
import { Sidebar, type SidebarProps } from "./chrome/Sidebar";
import { projectDisplayName } from "./hooks/useProjectLabels";
import { useNavigationIntent } from "./hooks/useNavigationIntent";
import { loadTabGroupLabels } from "./lib/tabGroups";
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
  revealBesideWorkspaceView,
  selectWorkspaceView,
  closeWorkspaceViews,
  toggleWorkspaceExpansion,
  resolveWorkspaceView,
  type WorkspaceView,
} from "./lib/workspaceViews";
import {
  applyWorkspaceIntent,
  hiddenSplitStatus,
  neighborCombineTargets,
  type WorkspaceIntent,
} from "./lib/workspaceIntents";
import { restoreWorkspaceArrangement } from "./lib/workspaceArrangement";
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
  type DetachedWorkspaceState,
} from "./lib/detachedWorkspaces";
import { useWorkspaceHeaderKeys } from "./hooks/useWorkspaceHeaderKeys";
import { requestAddToChat } from "./lib/quoteDraft";
import { filesOpenInTabs, setOpenFiles } from "./lib/openFiles";
import { addFileToChat, fileChatTarget } from "./lib/fileTabChat";
import {
  ensureProjectlessWorkspace,
  isProjectlessCwd,
  projectlessCwdForProfile,
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
  addRetainedBrowserTab,
  addBackgroundBrowserTab,
  selectBrowserTab,
  closeBrowserTab,
  keepBrowserTab,
  updateBrowserTab,
  browserIdForTab,
  patchBrowserWorkspace,
} from "./lib/personalWorkspace";
import { resolveBrowserTabTarget } from "./lib/browserTabTarget";
import {
  openAgentBrowserTab,
  createAgentBrowserRouter,
  presentAgentBrowserView,
  agentRequesterTab,
  type AgentBrowserPlacement,
  type AgentBrowserOpenOptions,
} from "./lib/agentBrowserOpen";
import {
  installDevPreviewOpener,
  observeAgentPreviewEvent,
  openDevPreview,
  previewBelongsTo,
  previewTabMatch,
  previewTabsOnServer,
  publishDevPreviewTabs,
} from "./lib/devPreviews";
import { placeDevPreview } from "./lib/devPreviewLayout";
import { installDevServerStarter } from "./lib/devServerStart";
import { queueTerminalCommand } from "./lib/pty";
import {
  newSessionChangesWorkspaceTab,
  reviewPaneFor,
  sessionChangesTabFor,
  showInPane,
} from "./lib/reviewPlacement";
import { useDevPreviewAutoOpen } from "./hooks/useDevPreviews";
import {
  useDuplicateServerMessenger,
  useSharedWorkSessions,
  useWorkConflicts,
} from "./hooks/useSharedWork";
import { loadDefaultRuntimeMode } from "./lib/runtimeMode";
import { ApprovalToasts } from "./chrome/ApprovalToasts";
import {
  AgentPageNotices,
  type AgentPageNotice,
} from "./chrome/AgentPageNotices";
import type {
  PaletteChatRequest,
  PaletteRaceRequest,
} from "./chrome/CommandPalette";
import {
  createRaceLanes,
  getRace,
  installRaceWorkspace,
  isFinishingRaceCheckout,
  listRaces,
  raceHost,
  racePrompt,
  releaseRaceCheckout,
  raceLaneEnded,
  raceLaneFor,
  raceLaneRecords,
  raceLanesNotKept,
  raceLaneStarted,
  raceOriginBlock,
  saveRace,
  settleInterruptedLanes,
  adoptOrphanRaces,
  raceLaneRemoved,
  settleMissingLanes,
  subscribeRaces,
  updateRace,
  usesRaceCheckout,
  type RaceBase,
  type RaceWorkspace,
} from "./lib/race";
import {
  finalAssistantText,
  getScheduledRun,
  requestScheduleEditor,
  runSummary,
  saveScheduledRun,
  scheduledAgentProblem,
  updateScheduledRun,
  type ScheduledAgent,
} from "./lib/scheduledAgents";
import {
  DEV_PALETTE_COMMANDS,
  PALETTE_COMMANDS,
  type PaletteAgent,
  type PaletteChat,
  type DevPaletteCommandId,
  type PaletteCommandId,
} from "./lib/commandPalette";
import {
  availablePaletteAgents,
  searchPaletteChats,
} from "./lib/paletteAgents";
import { searchSettings } from "./lib/settingsSearch";
import { conversationRowsFrom } from "./lib/appSearch";
import { TitleBar, type Tab as TitleTab } from "./chrome/TitleBar";
import { MenuBar } from "./chrome/MenuBar";
import { FilePicker } from "./chrome/FilePicker";
import { hasWorkspaceOverlay } from "./lib/workspaceKeyboard";
import { WorkspaceStatusBar } from "./chrome/WorkspaceStatusBar";
import { WorkspaceFooter } from "./chrome/WorkspaceFooter";
import { FooterUsage } from "./chrome/FooterUsage";
import {
  WorkspaceActionDialog,
  type WorkspaceActionKind,
} from "./chrome/WorkspaceActionDialog";
import { BranchPicker } from "./chrome/BranchPicker";
import { AddProjectMenu } from "./chrome/AddProjectMenu";
import { installInAppLinks, openInAppUrl } from "./lib/inAppLinks";
import { openImageFile, shouldOpenInImageViewer } from "./lib/imageViewer";
import { normalizeBrowserUrl } from "./lib/browser";
import {
  useWorkspaceProfiles,
  restoreProfileWorkspace,
  projectWorkspaceProfile,
  standaloneWorkspacePaths,
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
  zoomInUiScale,
  zoomOutUiScale,
} from "./lib/uiScale";
import { displayAttachments, prepareAttachments } from "./lib/attachments";
import {
  basename,
  listDir,
  notifyGitChanged,
  pickFolder,
  readTextFile,
  restoreSessionCheckout,
  type GitFileDiffKind,
  type GitHistoryCommit,
} from "./lib/fs";
import { resolveGrokBinary } from "./lib/harness/child";
import { saveRaceLaneChoice } from "./lib/raceAgents";
import { raceAgentNames, raceLaneTitle, raceTaskWords } from "./lib/raceNames";
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
  newRaceWorkspaceTab,
  newBoardWorkspaceTab,
  boardTabFor,
  isBoardTab,
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
import {
  loadBundledChangelog,
  releaseNotesForVersion,
  releaseNotesTitle,
} from "./lib/releaseNotes";
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
  projectPanelTerminals,
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
  applyHarnessEvents,
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
  sessionChildHarnesses,
  sessionThroughTurn,
  shouldAskOutgoingAgent,
  type HandoffComposerCard,
  userMessagesAfterHandoff,
  wrapHandoffPrompt,
} from "./lib/handoff";
import { requestOutgoingHandoff } from "./lib/handoffTurn";
import {
  answerQuestion,
  deliverApproval,
  deliverQuestionReply,
} from "./lib/questionReply";
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
  preferredModelId,
  resolveModel,
  saveLastModelChoice,
  saveLastModelSettings,
} from "./lib/models";
import {
  buildPlanPrompt,
  isProviderFailureText,
  planTitle,
  planTurnKey,
  planTurnPrompt,
} from "./lib/plan";
import {
  displayPath,
  isEqualOrInside,
  projectName,
  rebasePath,
  resolveWorkspacePath,
} from "./lib/paths";
import { openProjectFiles, removeProjectData } from "./lib/projectData";
import {
  lastProjectPath,
  looksLikeProject,
  normalizeProjectPath,
  sameProjectPath,
} from "./lib/recents";
import {
  applyPlaceSessionOnPane,
  filterTabsForProject,
  findProjectPane,
  findTabForProject,
  focusedWorkspaceTabCwd,
  loadProjectFocusedTabs,
  saveProjectFocusedTabs,
  planWorkspaceTabClose,
  visibleProjectTabs,
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
  sessionIsWaitingForInput,
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
  type PlanStatus,
  type SecondOpinionMeta,
  type DiscussionRelayMeta,
  type Session,
  type TurnIntent,
} from "./lib/session";
import { isUntitledChatTitle } from "./lib/untitledChat";

import {
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  queuedMessageForSubmit,
  queuedSubmitOptions,
  shouldEnqueueSubmission,
} from "./lib/messageQueue";
import {
  deleteSession,
  getSession,
  listProjectSessionIds,
  listSessionsByProject,
  persistFingerprint,
  replaceInFlightSessions,
  saveWorkspaceSnapshot,
  setSessionArchived,
  chatIsArchived,
  setSessionPinned,
  shouldPersistSession,
  upsertSession,
  type SessionSummary,
} from "./lib/sessionStore";
import {
  setDockLeadDecided,
  setDockTeamNeeds,
  syncDockBadge,
} from "./lib/dockBadge";
import {
  teamCompanions,
  teamIdOf,
  teamKeyOf,
  teamKindOf,
  teamRunsFrom,
} from "./lib/teamRuns";
import { sidebarTeams } from "./lib/teamGrouping";
import { currentWindowLabel } from "./lib/windowLabel";
import { popOutShownChats } from "./lib/teamWatch";
import {
  focusedTeamPopOut,
  subscribeFocusedTeamPopOut,
} from "./lib/teamWatchBridge";
import {
  teamActivityEvents,
  teamEndSummaries,
  teamsNoLongerNeedingYou,
  teamsPostedHere,
  type TeamSeen,
} from "./lib/teamActivity";
import {
  leadVerdict,
  noteRaceKept,
  reconcileRaceReviews,
  summarizeRun,
  watchRaceSuggestions,
} from "./lib/teamResult";
import { turnChangeOwner } from "./lib/teamChanges";
import { installTeamWorkspace, type TeamWorkspace } from "./lib/teamWorkspace";
import { useTeamStores } from "./hooks/useTeamRuns";
import { useTeamPanelTidy } from "./hooks/useTeamPanelTidy";
import { useRacePreviewLabel } from "./hooks/useRacePreviewLabel";
import { racePreviewTitle } from "./lib/racePreviews";
import { equalChromeData } from "./hooks/useChromeProps";
import {
  backgroundWorkerIdsForStop,
  isCurrentSessionAgentSource,
  keepsUnseenFinished,
  liveAgentsFromSessions,
  workerAgentsByLead,
} from "./lib/liveAgents";
import {
  activeSessionAgents,
  uncertainSessionAgents,
} from "./lib/sessionAgents";
import { hiddenApprovalNotices } from "./lib/approvalToast";
import {
  useActivity,
  markSessionActivityRead,
  reconcileSessionActivityInputs,
  resolveTeamNeedActivity,
  amendTeamEnd,
  isPendingActivity,
  isTurnActivity,
  retractActivityTurn,
  type ActivityTeam,
} from "./lib/activity";
import { visibleActivitySessionIds } from "./lib/activityVisibility";
import {
  loadNotificationsEnabled,
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
  shouldStopFocusedTurnOnEscape,
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
import { loadProjectMemory, projectMemoryForTurn } from "./lib/projectMemory";
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
import { ImageViewer } from "./surfaces/ImageViewer";
import { ProjectTerminalDock } from "./surfaces/ProjectTerminalDock";
import {
  AutomationsView,
  CommandPalette,
  InboxView,
  LazyViewSlot,
  NotesView,
  preloadLazyViews,
  SearchView,
  SettingsView,
  TourOverlay,
  WalkthroughDialog,
  WhatsNewDialog,
} from "./surfaces/lazyViews";
import { loadProviderSetup, saveProviderSetup } from "./lib/providerSetup";
import {
  loadWalkthrough,
  saveWalkthrough,
  shouldOfferWalkthrough,
  walkthroughReducer,
  type WalkthroughAction,
  type WalkthroughState,
} from "./lib/walkthrough";
import { offerGettingStarted } from "./lib/gettingStarted";
import type { GettingStartedStepId } from "./lib/gettingStarted";
import { useGettingStarted } from "./hooks/useGettingStarted";
import {
  createSampleProject,
  isSampleProject,
  PREVIEW_MESSAGE,
  SAMPLE_FIRST_MESSAGE,
} from "./lib/sampleProject";
import { TOUR_START_EVENT, startTour } from "./lib/tour";
import type { TourPrepare } from "./chrome/Tour";
import type { WalkthroughProjectChoice } from "./surfaces/Walkthrough";
import type { InboxSessionPortal } from "./surfaces/InboxDiscussionPanel";
import { inboxAskKey, inboxAskPrompt } from "./lib/inboxAsk";
import { inboxComposerCard, type InboxItem } from "./lib/githubTasks";
import {
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  loadDiffViewer,
  loadFollowUpBehavior,
  subscribeLiveAgentsEnabled,
  type SettingsSectionId,
  type FollowUpBehavior,
} from "./lib/settings";

import {
  mergeHistorySummary,
  mergeProjectHistorySummary,
  replaceProjectHistory,
  historyHoldsProject,
  historyWithLiveSessions,
  summaryFromSession,
} from "./lib/sessionHistory";
import {
  CONTINUE_PROMPT,
  canAutoContinue,
  inFlightRefs,
  inFlightSnapshotKey,
  isInFlightSession,
  shouldWriteInFlightSnapshot,
  wasTurnInterrupted,
} from "./lib/inFlight";
import {
  collectWorkspaceSnapshot,
  stableSnapshotSessions,
} from "./lib/workspaceSnapshot";
import {
  readComposerDraft,
  subscribeComposerDrafts,
} from "./lib/composerDrafts";
import type { InstalledUpdate } from "./lib/updateNotice";
import {
  bindResumedSessions,
  closeBusyWindow,
  hasInFlightSessions,
  hideCurrentWindow,
  isAppQuitting,
  persistLiveTranscripts,
  persistQuitState,
  reapWindowRuntime,
  setQuitWorkspace,
  type ResumedWorkspace,
} from "./lib/appLifecycle";
import {
  listenForUpdateWindowClose,
  reportWorkspaceActivity,
} from "./lib/updateRestart";
import {
  previewUpdateRestart,
  type UpdateRestartPreview,
} from "./lib/updateRestartPreview";
import {
  cancelScheduledFlush,
  scheduleStreamFlush,
  type ScheduledFlush,
} from "./lib/streamFlush";
import { LiveSessionsContext } from "./lib/liveSessions";
import {
  requestShip,
  subscribeOpenChatRequests,
  subscribeShipRequests,
} from "./lib/shipRequest";
import { forgetChatReview, useChatReviews } from "./lib/chatReview";
import { forgetShippedChat, useShippedChats } from "./lib/shippedChats";
import { forgetTurnNotes, takeTurnNotes } from "./lib/turnNotes";
import {
  chatHoldUpHints,
  chatStatuses,
  type ChatStatusWord,
} from "./lib/chatStatus";
import { holdUpHint, sessionHoldUps } from "./lib/sessionHoldUp";
import { useChatReviewTracker } from "./hooks/useChatReviewTracker";
import { useWorkBoardPublisher } from "./hooks/useWorkBoardPublisher";
import {
  installWorkBoardActions,
  type WorkBoardActions,
} from "./lib/workBoardFeed";
import { addChatsToBoard } from "./lib/featureCards";
import { chatCardDrafts } from "./lib/workBoard";

/** Minimum spacing between full transcript saves of a chat that is still running. */
const BUSY_PERSIST_INTERVAL_MS = 10_000;

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

/** A chat started from a Race lane keeps the project but works in the lane. */
function laneCheckout(source: Session): Pick<Session, "worktreeCwd"> {
  return source.worktreeCwd ? { worktreeCwd: source.worktreeCwd } : {};
}

/** A turn Aven cut short (a quit) that it is about to continue by itself. */
function willAutoContinue(session: Session | undefined): boolean {
  return (
    !!session && canAutoContinue(session) && isLiveHarness(session.harness)
  );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
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
      tab.groupId === other.groupId &&
      tab.needsInput === other.needsInput &&
      tab.waitingOn === other.waitingOn &&
      tab.race === other.race &&
      tab.board === other.board
    );
  });
}

// Register capabilities before composer hooks choose their discovery strategy.
registerBuiltinHarnesses();

/** How soon after a run finishes its agents are summed up (see teamResult). */
const RUN_SUMMARY_WINDOW_MS = 10 * 60_000;

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
  const {
    recents,
    remember: rememberRecentProject,
    rememberIfEmpty: rememberInitialProject,
    forget: forgetRecentProject,
    archive: archiveRecentProject,
    isKnownProject,
  } = useRecentProjects(resumed?.projectCwd);
  const [seed] = useState(() => {
    const cwd = lastProjectPath() ?? "~";
    const session = newDefaultSession(cwd);
    const tab = newTab(session.id);
    return { session, tab };
  });
  // The first-run walkthrough: only a fresh install with no existing work
  // sees it, under the rule that offered provider setup before it. The
  // automated checks start from a finished setup, so they never do.
  const [walkthrough, setWalkthrough] = useState<WalkthroughState | null>(() =>
    shouldOfferWalkthrough(
      Boolean(
        windowTransfer ||
        lastProjectPath() ||
        recents.length ||
        bootHistory.length ||
        resumed?.sessions.some((session) => session.blocks.length > 0),
      ),
    )
      ? loadWalkthrough()
      : null,
  );
  const walkthroughRef = useRef(walkthrough);
  walkthroughRef.current = walkthrough;
  useEffect(() => {
    // Begun on this install: it resumes if Aven quits part way, and Home
    // offers its Getting started card afterwards.
    const current = walkthroughRef.current;
    if (!current || current.started) return;
    const next = walkthroughReducer(current, { type: "start" });
    saveWalkthrough(next);
    offerGettingStarted();
    setWalkthrough(next);
  }, []);
  // Help › Take the Tour Again, or Settings: the tour alone, not the setup.
  const [tourAgain, setTourAgain] = useState(false);
  const {
    sessions,
    sessionsRef,
    liveSessions,
    setSessions,
    commitStream,
    flushCommittedSessions,
  } = useWorkspaceSessions(
    () => windowTransfer?.sessions ?? resumed?.sessions ?? [seed.session],
  );
  const [tabs, setTabs] = useState<WorkspaceTab[]>(
    () => windowTransfer?.tabs ?? resumed?.tabs ?? [seed.tab],
  );
  const [projectTerminals, setProjectTerminals] = useState<ProjectTerminal[]>(
    () => windowTransfer?.projectTerminals ?? resumed?.projectTerminals ?? [],
  );
  const beginNavigation = useNavigationIntent();
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
  const {
    notesEnabled,
    homeViewOpen,
    setHomeViewOpen,
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    searchViewOpen,
    setSearchViewOpen,
    searchViewFocusToken,
    inboxViewOpen,
    setInboxViewOpen,
    notesViewOpen,
    setNotesViewOpen,
    automationsViewOpen,
    setAutomationsViewOpen,
    filePickerOpen,
    setFilePickerOpen,
    searchViewOpenRef,
    inboxViewOpenRef,
    automationsViewOpenRef,
    notesViewOpenRef,
    settingsOpenRef,
    filePickerOpenRef,
    restoreReturnFocus,
    clearReturnFocus,
    closeUtilityViews,
    showWorkspace,
    onOpenSearch,
    onLeaveSearch,
    onOpenInbox,
    onLeaveInbox,
    onOpenAutomations,
    onLeaveAutomations,
    onOpenNotes,
    onLeaveNotes,
    openSettings,
    onOpenSettings,
    onCloseSettings,
    onSelectSettingsSection,
    onOpenHome,
  } = useUtilityViews();
  // Settings, Search and the other views load on request; fetch them once
  // startup settles so opening one shows it at once.
  useEffect(() => whenIdle(() => void preloadLazyViews()), []);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const standaloneActive =
    isProjectlessCwd(projectCwd) &&
    projectWorkspaceProfile(
      { profiles: profiles.profiles, projectProfiles: {} },
      projectCwd,
    ) === profiles.activeProfileId;
  const standaloneCwd = projectlessCwdForProfile(profiles.activeProfileId);
  const standaloneCwds = useMemo(() => {
    const inherited = standaloneWorkspacePaths(
      { profiles: profiles.profiles, projectProfiles: {} },
      profiles.activeProfileId,
    ).filter((cwd) => cwd !== standaloneCwd);
    // The current workspace's folder may first become available after New
    // session resolves. Include it immediately and retain inherited folders.
    return standaloneCwd ? [standaloneCwd, ...inherited] : inherited;
  }, [profiles.profiles, profiles.activeProfileId, standaloneCwd]);
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
  const openWorkspaceAction = useCallback((kind: WorkspaceActionKind) => {
    const current = profilesRef.current;
    setAddProjectAnchor(null);
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
  const [agentPageNotices, setAgentPageNotices] = useState<AgentPageNotice[]>(
    [],
  );
  const showAgentPageRef = useRef<(notice: AgentPageNotice) => void>(() => {});
  const startRaceRef = useRef<
    (request: PaletteRaceRequest) => Promise<boolean>
  >(async () => false);
  const startScheduledAgentRef = useRef<(agent: ScheduledAgent) => void>(
    () => {},
  );
  useScheduledAgents((agent) => startScheduledAgentRef.current(agent));
  useAutomationsKeepAwake();
  const onRaceFromChat = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[],
      agents: PaletteAgent[],
    ) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (!session) return Promise.resolve(false);
      // Lanes keep this chat's access; the first keeps its model settings too.
      const own = agents[0];
      return startRaceRef.current({
        text,
        agents,
        project: session.cwd,
        attachments,
        runtimeMode: session.runtimeMode,
        modelSettings:
          own?.harness === session.harness && own.model === session.model
            ? session.modelSettings
            : undefined,
        origin: session.id,
      });
    },
    [],
  );
  const raceActionsRef = useRef<RaceWorkspace>({
    stop: () => {},
    settle: async () => {},
    release: async () => {},
    openChat: () => {},
    compare: () => {},
    retry: () => {},
  });
  useEffect(
    () =>
      installRaceWorkspace({
        stop: (ids) => raceActionsRef.current.stop(ids),
        settle: (race) => raceActionsRef.current.settle(race),
        release: (race) => raceActionsRef.current.release(race),
        openChat: (id) => raceActionsRef.current.openChat(id),
        compare: (id) => raceActionsRef.current.compare(id),
        retry: (race, lane) => raceActionsRef.current.retry(race, lane),
      }),
    [],
  );
  // What a team's card asks of the workspace (see teamWorkspace).
  const teamActionsRef = useRef<TeamWorkspace>({
    reviewChanges: () => {},
    openChat: () => {},
    watch: () => {},
    send: async () => false,
  });
  // What a project board's buttons do, kept current below and installed once.
  const boardActionsRef = useRef<WorkBoardActions | null>(null);
  const addToBoardRef = useRef<(sessionIds: string[]) => void>(() => {});
  const onAddToBoard = useCallback(
    (sessionIds: string[]) => addToBoardRef.current(sessionIds),
    [],
  );
  useEffect(
    () =>
      installWorkBoardActions({
        openChat: (...args) => boardActionsRef.current?.openChat(...args),
        allow: (...args) => boardActionsRef.current?.allow(...args),
        review: (...args) => boardActionsRef.current?.review(...args),
        ship: (...args) => boardActionsRef.current?.ship(...args),
        watch: (...args) => boardActionsRef.current?.watch(...args),
        compare: (...args) => boardActionsRef.current?.compare(...args),
        preview: (...args) => boardActionsRef.current?.preview(...args),
        openCommit: (...args) => boardActionsRef.current?.openCommit(...args),
        openUrl: (...args) => boardActionsRef.current?.openUrl(...args),
        build: (...args) => boardActionsRef.current?.build(...args) ?? null,
        draft: (...args) => boardActionsRef.current?.draft(...args) ?? null,
      }),
    [],
  );
  useEffect(
    () =>
      installTeamWorkspace({
        reviewChanges: (project) =>
          teamActionsRef.current.reviewChanges(project),
        openChat: (id) => teamActionsRef.current.openChat(id),
        watch: (id) => teamActionsRef.current.watch?.(id),
        send: (id, compose, options) =>
          teamActionsRef.current.send(id, compose, options),
      }),
    [],
  );
  const [agentBrowserSurfaces, setAgentBrowserSurfaces] = useState<Set<string>>(
    () => new Set(),
  );
  const [agentBrowserRouter] = useState(createAgentBrowserRouter);
  const detachedBrowserBridge = useRef<
    (
      sessionId: string,
      url: string,
      options?: AgentBrowserOpenOptions,
    ) => Promise<string | null>
  >(async () => null);
  const detachedFocusBrowser = useRef<
    (surfaceId: string, options?: AgentBrowserOpenOptions) => Promise<boolean>
  >(async () => false);
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
  const detachedShowSurface = useRef<
    (surfaceId: string, paneId?: string) => Promise<boolean>
  >(async () => false);
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
        async open({ sessionId, cwd }, url, options) {
          const session = sessionsRef.current.find(
            (item) => item.id === sessionId,
          );
          if (!session || !sameProjectPath(sessionWorkCwd(session), cwd))
            throw new Error("The task is no longer available.");
          const open = async (
            existing: boolean,
            placement: AgentBrowserPlacement,
          ) => {
            const detachedSurface = existing
              ? null
              : await detachedBrowserBridge.current(sessionId, url, options);
            if (detachedSurface) return detachedSurface;
            const currentSession = sessionsRef.current.find(
              (item) => item.id === sessionId,
            );
            if (
              !currentSession ||
              currentSession.cwd !== session.cwd ||
              !sameProjectPath(sessionWorkCwd(currentSession), cwd)
            )
              throw new Error("The task is no longer available.");
            const project = session.cwd;
            const before =
              browserWorkspacesRef.current[project] ?? EMPTY_BROWSER;
            // No await between selecting and committing: overlapping opens see the
            // committed tab and return the same surface instead of creating copies.
            const {
              tab: { id },
              workspace,
            } = openAgentBrowserTab(before, url, {
              ...options,
              focus: placement.activate,
            });
            const created = !normalizeBrowserWorkspace(before).tabs.some(
              (page) => page.id === id,
            );
            const surfaceId = browserIdForTab(project, id);
            if (detachedIdsRef.current.has(surfaceId)) {
              // A browser can be detached without its chat. Select it in that
              // window; never add its unavailable surface to the main layout.
              if (await detachedFocusBrowser.current(surfaceId, options))
                return surfaceId;
              throw new Error("The browser tab moved. Try opening it again.");
            }
            // Commit the tab first so the workspace view knows the new surface.
            flushSync(() => {
              setAgentBrowserSurfaces(
                (current) => new Set([...current, surfaceId]),
              );
              setBrowserWorkspaces((all) => ({
                ...all,
                [project]: workspace,
              }));
            });
            // Show a requested page in the active project without switching
            // profiles, in the browser pane already open (one showing the
            // same server first), else beside the chat that asked for it,
            // never behind it. arrange:false only lets a new page join an
            // open browser pane as a background tab (without one it waits
            // in the focused pane) and never moves a page already open.
            if (
              sameProjectPath(projectCwdRef.current, project) &&
              (placement.arrange || created)
            ) {
              // A worker has no tab of its own: its lead's chat asked.
              const requester = agentRequesterTab(tabsRef.current, [
                sessionId,
                session.orchestrationLeadId,
              ]);
              const pages = workspace.tabs.filter((page) => page.id !== id);
              viewRef.current.change((view) =>
                presentAgentBrowserView(
                  view,
                  surfaceId,
                  workspace.tabs.map((page) =>
                    browserIdForTab(project, page.id),
                  ),
                  requester,
                  placement.arrange,
                  previewTabsOnServer(pages, url).map((page) =>
                    browserIdForTab(project, page.id),
                  ),
                ),
              );
            } else if (!sameProjectPath(projectCwdRef.current, project)) {
              // Never switch projects under the user; say where the page went.
              const notice: AgentPageNotice = {
                id: surfaceId,
                project,
                projectName: projectDisplayName(project, loadTabGroupLabels()),
                surfaceId,
                tabId: id,
                sessionId,
                harness: session.harness,
                url,
              };
              setAgentPageNotices((current) =>
                [
                  ...current.filter((item) => item.id !== notice.id),
                  notice,
                ].slice(-3),
              );
              window.setTimeout(
                () =>
                  setAgentPageNotices((current) =>
                    current.filter((item) => item.id !== notice.id),
                  ),
                12_000,
              );
            }
            return surfaceId;
          };
          return agentBrowserRouter.open(session.cwd, url, options, {
            tabs: () =>
              normalizeBrowserWorkspace(
                browserWorkspacesRef.current[session.cwd] ?? EMPTY_BROWSER,
              ).tabs,
            reuse: (_, placement) => open(true, placement),
            create: (_, placement) => open(false, placement),
          });
        },
      }),
    [agentBrowserRouter],
  );
  // A dev server's page opens in the project on screen, beside the chat,
  // reusing a tab that already shows that server.
  useEffect(
    () =>
      installDevPreviewOpener((preview, { requesterSessionId, automatic }) => {
        const project = projectCwdRef.current;
        if (!previewBelongsTo(preview, project)) return false;
        const current = normalizeBrowserWorkspace(
          browserWorkspacesRef.current[project] ?? EMPTY_BROWSER,
        );
        const shown = previewTabMatch(
          current.tabs,
          preview.url,
          current.activeTabId,
        );
        const { tab, workspace } = openAgentBrowserTab(
          current,
          shown?.url ?? preview.url,
          { focus: false },
        );
        const surfaceId = browserIdForTab(project, tab.id);
        if (detachedIdsRef.current.has(surfaceId)) {
          if (!automatic) void detachedShowSurface.current(surfaceId);
          return true;
        }
        flushSync(() =>
          setBrowserWorkspaces((all) => ({ ...all, [project]: workspace })),
        );
        const chat = requesterSessionId ?? preview.sessionId;
        const requester =
          (chat &&
            tabsRef.current.find((entry) =>
              leafIds(entry.layout).includes(chat),
            )?.id) ||
          activeTabIdRef.current;
        viewRef.current.change((view) =>
          placeDevPreview(
            view,
            surfaceId,
            workspace.tabs.map((page) => browserIdForTab(project, page.id)),
            requester,
            !!automatic,
          ),
        );
        return true;
      }),
    [],
  );
  useDevPreviewAutoOpen(projectCwd);
  // Chats' titles and projects for the shared-work note, read only when a
  // note is built; closed chats stop counting as working.
  useSharedWorkSessions(
    sessionsRef,
    sessions.map((session) => session.id).join("\n"),
  );
  // A server a tab already shows, opened by an agent or typed, is not offered.
  useEffect(() => {
    publishDevPreviewTabs(
      Object.entries(browserWorkspaces).map(([project, saved]) => {
        const workspace = normalizeBrowserWorkspace(saved);
        return [
          project,
          workspace.open ? workspace.tabs.map((tab) => tab.url) : [],
        ] as const;
      }),
    );
  }, [browserWorkspaces]);
  const agentBrowserSessionKeys = sessions
    .map((session) => `${session.id}:${session.cwd}:${sessionWorkCwd(session)}`)
    .join("\n");
  useEffect(() => {
    void refreshAgentBrowserScopes();
  }, [browserWorkspaces, agentBrowserSessionKeys]);
  const [detachedIds, setDetachedIds] = useState<Set<string>>(() => new Set());
  const detachedIdsRef = useRef(detachedIds);
  detachedIdsRef.current = detachedIds;
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
    return visibleProjectTabs(tabs, sessions, projectCwd, activeTabId).filter(
      (tab) => !detachedIds.has(tab.id),
    );
  }, [activeTabId, tabs, sessions, projectCwd, detachedIds]);
  const browserState = normalizeBrowserWorkspace(
    browserWorkspaces[projectCwd] ?? EMPTY_BROWSER,
  );
  const racePreviewLabelFor = useRacePreviewLabel();
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
  const onKeepBrowser = useCallback((surfaceId: string) => {
    const cwd = projectCwdRef.current;
    setBrowserWorkspaces((all) => {
      const current = all[cwd];
      if (!current) return all;
      const target = normalizeBrowserWorkspace(current).tabs.find(
        (tab) => browserIdForTab(cwd, tab.id) === surfaceId,
      );
      if (!target || target.kept) return all;
      return { ...all, [cwd]: keepBrowserTab(current, target.id) };
    });
  }, []);
  const onWorkspaceIntent = useCallback(
    (intent: WorkspaceIntent) => {
      const result = applyWorkspaceIntent(viewRef.current.view, intent);
      result.keep.forEach(onKeepBrowser);
      changeLayout(() => result.view);
    },
    [changeLayout, onKeepBrowser],
  );
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
  const [surfaceDragging, setSurfaceDragging] = useState(false);
  const [surfaceDrop, setSurfaceDrop] =
    useState<WorkspaceSurfaceDropTarget | null>(null);
  const surfaceDropRef = useRef<WorkspaceSurfaceDropTarget | null>(null);
  const onSurfaceDragMove = useCallback((id: string, x: number, y: number) => {
    const stage = document.querySelector<HTMLElement>("[data-workspace-stage]");
    const target = stage
      ? workspaceSurfaceDropAt(stage, x, y, id, surfaceDropRef.current)
      : null;
    surfaceDropRef.current = target;
    setSurfaceDragging(true);
    setSurfaceDrop((previous) =>
      JSON.stringify(previous) === JSON.stringify(target) ? previous : target,
    );
  }, []);
  const onSurfaceDragEnd = useCallback(
    (id: string, x: number, y: number, cancelled: boolean) => {
      const stage = document.querySelector<HTMLElement>(
        "[data-workspace-stage]",
      );
      const target =
        !cancelled && stage
          ? workspaceSurfaceDropAt(stage, x, y, id, surfaceDropRef.current)
          : null;
      surfaceDropRef.current = null;
      setSurfaceDragging(false);
      setSurfaceDrop(null);
      if (cancelled) return false;
      // Outside drops cancel. Splits and tab moves stay inside this workspace.
      if (!target) return false;
      onWorkspaceIntent({ type: "drop", id, target });
      return true;
    },
    [onWorkspaceIntent],
  );
  const onNewBrowserTab = useCallback(() => {
    setHomeViewOpen(false);
    const id = crypto.randomUUID();
    setBrowserWorkspaces((all) => ({
      ...all,
      // Every caller is an explicit "new browser" request, so the page it
      // covers stays in the strip instead of being replaced as a preview.
      [projectCwd]: addRetainedBrowserTab(
        { ...(all[projectCwd] ?? EMPTY_BROWSER), mode: "tab" },
        { id, url: "" },
      ),
    }));
  }, [projectCwd, setHomeViewOpen]);
  const onSelectBrowserTab = useCallback(
    (surfaceId?: string) => {
      if (surfaceId && detachedIdsRef.current.has(surfaceId)) {
        void detachedShowSurface.current(surfaceId);
        return;
      }
      const current = browserState;
      const target = resolveBrowserTabTarget(current, projectCwd, surfaceId);
      if (!target) {
        if (surfaceId === undefined) onNewBrowserTab();
        return;
      }
      setHomeViewOpen(false);
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
    [browserState, projectCwd, onNewBrowserTab, setHomeViewOpen],
  );
  const onCloseBrowserTab = useCallback(
    (surfaceId?: string) => {
      const current = browserState;
      const target = resolveBrowserTabTarget(current, projectCwd, surfaceId);
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
  const [inboxAskPortal, setInboxAskPortal] =
    useState<InboxSessionPortal | null>(null);
  const openingInboxSessions = useRef(new Map<string, Promise<string>>());
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
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const workspaceVisible =
    !profileHome &&
    !homeViewOpen &&
    view.order.length > 0 &&
    !settingsOpen &&
    !searchViewOpen &&
    !inboxViewOpen &&
    !automationsViewOpen &&
    !notesViewOpen;
  // The footer shows outside the full-window views; while it does, shrunk
  // teams sit in it rather than floating over the workspace.
  const footerShown =
    !settingsOpen &&
    !searchViewOpen &&
    !inboxViewOpen &&
    !automationsViewOpen &&
    !notesViewOpen;
  const {
    floatingSidebarLayer,
    nativeSidebar,
    sidebarHover,
    sidebarShown,
    setFloatingSidebarRevealed,
  } = useSidebarVisibility({ pinned: sidebarOpen, allowNativeLayer: IS_MAC });
  // Remounts the workspace's own sidebar so it reloads what the native
  // floating sidebar saved (folders, filters, width) before it shows again.
  const [sidebarGeneration, setSidebarGeneration] = useState(0);
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
  const inspectorRef = useRef(inspector);
  inspectorRef.current = inspector;
  // The tour may open the side panel on Changes to point at it, and puts it
  // back as it was when it moves on. Nothing else is opened for it.
  const tourPrepare = useMemo<TourPrepare>(
    () => ({
      changes: () => {
        const before = inspectorRef.current;
        if (before.open && before.tab === "changes") return;
        setInspector((previous) => ({
          ...previous,
          open: true,
          tab: "changes",
        }));
        return () =>
          setInspector((previous) => ({
            ...previous,
            open: before.open,
            tab: before.tab,
          }));
      },
    }),
    [],
  );
  useEffect(() => {
    const onStart = () => {
      // The walkthrough's own tour is already on its way.
      if (walkthroughRef.current) return;
      showWorkspace();
      setTourAgain(true);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [showWorkspace]);
  const browserExpanded = browserFocused;
  const [updateNotice, setUpdateNotice] = useState(installedUpdate);
  const [whatsNewVersion, setWhatsNewVersion] = useState<string | null>(null);
  const [editorNavigation, setEditorNavigation] =
    useState<EditorNavigationTarget | null>(null);
  const editorNavigationToken = useRef(0);
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(
    () => new Set(windowTransfer?.dirtyFileIds ?? []),
  );
  // Not carried across a window transfer the way dirty state is: the editor
  // re-lints whatever it mounts, so the counts rebuild themselves.
  const [fileErrorCounts, setFileErrorCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [history, setHistory] = useState<SessionSummary[]>(() => bootHistory);
  const historyRef = useRef(history);
  historyRef.current = history;
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

  const queueDispatchingRef = useRef(new Set<string>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const dirtyFilesRef = useRef(dirtyFiles);
  dirtyFilesRef.current = dirtyFiles;
  /** The Stop button's handler, for a restart that stops running work. */
  const stopSessionRef = useRef<(sessionId: string) => void>(() => {});
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
    const cwd = tab ? focusedWorkspaceTabCwd(tab, sessionsRef.current) : null;
    if (!cwd || !looksLikeProject(cwd)) return;
    const key = normalizeProjectPath(cwd);
    if (lastTabByProjectRef.current[key] === activeTabId) return;
    const next = { ...lastTabByProjectRef.current, [key]: activeTabId };
    lastTabByProjectRef.current = next;
    saveProjectFocusedTabs(next);
  }, [activeTabId, projectCwd, tabs]);
  // `@` in a message offers the files open in this window's tabs first.
  useEffect(() => {
    setOpenFiles(filesOpenInTabs(tabs, activeTabId));
  }, [activeTabId, tabs]);
  const leaveExpandedPreview = useCallback(() => {
    setHomeViewOpen(false);
    setBrowserWorkspaces((all) => {
      const path = projectCwdRef.current;
      const current = all[path];
      return current?.expanded
        ? { ...all, [path]: { ...current, expanded: false } }
        : all;
    });
  }, [setHomeViewOpen]);
  // Session surfaces outside the workspace tab tree, for stream flush pacing.
  const streamSurfacesRef = useRef<{
    inboxSessionId?: string;
    inspectedWorkerId?: string | null;
  }>({});
  streamSurfacesRef.current = {
    inboxSessionId: inboxViewOpen ? inboxAskPortal?.sessionId : undefined,
    inspectedWorkerId,
  };
  const sessionNavigationIdsRef = useRef<readonly string[]>([]);
  const workspaceVisibleRef = useRef(workspaceVisible);
  workspaceVisibleRef.current = workspaceVisible;
  const whatsNewVersionRef = useRef(whatsNewVersion);
  whatsNewVersionRef.current = whatsNewVersion;

  const navigationHistory = useRef<WorkspaceNavigation | null>(null);
  const [tabVisitNav, setTabVisitNav] = useState({
    canBack: false,
    canForward: false,
  });
  const turnGen = useRef(new Map<string, number>());
  // Child agents may report progress after their lead turn has settled or a
  // follow-up has started. Invalidate only when that provider runtime is stopped.
  const agentRuntimeEpoch = useRef(new Map<string, number>());
  const stoppedAgentRuntimes = useRef(new Set<string>());
  const activityTurnIds = useRef(new Map<string, string>());
  /** The planning turn each plan card came from, by the card's id. */
  const proposalTurns = useRef(new Map<string, string>());
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
  const lastBusyPersistAt = useRef(new Map<string, number>());
  const removingSessionIds = useRef(new Set<string>());
  // Tokens arrive many times per frame; apply them once so React/markdown aren't
  // recomputed for every delta.
  const harnessQueued = useRef(new Map<string, HarnessEvent[]>());
  const harnessFlush = useRef<ScheduledFlush | null>(null);
  /** Sessions shown by pop-out or detached windows, which sync from state. */
  const externallyRenderedSessionIds = useRef<ReadonlySet<string>>(new Set());
  const lastHarnessFlushAt = useRef(0);
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
    lastHarnessFlushAt.current = performance.now();
    const prev = sessionsRef.current;
    const next = prev.map((session) => {
      const events = batches.get(session.id);
      return events ? applyHarnessEvents(session, events) : session;
    });
    if (!next.some((session, index) => session !== prev[index])) return;
    syncDockBadge(next);
    commitStream(next, externallyRenderedSessionIds.current);
  }, [commitStream]);

  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      await orchestrator.stopForSession(sessionId);
      flushHarnessEvents();
      const open = sessionsRef.current.find(
        (session) => session.id === sessionId,
      );
      if (!open) return open;
      agentRuntimeEpoch.current.set(
        sessionId,
        (agentRuntimeEpoch.current.get(sessionId) ?? 0) + 1,
      );
      if (!isInFlightSession(open) && !uncertainSessionAgents(open).length)
        return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      try {
        await Promise.all(
          sessionChildHarnesses(open).map((harness) =>
            activeSessionAgents(open).length ||
            uncertainSessionAgents(open).length
              ? stopHarnessSession(harness, sessionId)
              : cancelHarnessTurn(harness, sessionId),
          ),
        );
      } catch (error) {
        // Removal may fail while the provider process remains alive. Keep a
        // truthful, stoppable row instead of either forgetting it or spinning.
        const next = sessionsRef.current.map((session) =>
          session.id !== sessionId
            ? session
            : {
                ...session,
                liveAgents: session.liveAgents?.map((agent) =>
                  ["running", "waiting", "unknown"].includes(agent.status)
                    ? {
                        ...agent,
                        status: "unknown" as const,
                        detail: "Could not confirm the agent process stopped",
                      }
                    : agent,
                ),
              },
        );
        sessionsRef.current = next;
        setSessions(next);
        throw error;
      }
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  /** Sessions on screen in this or a detached window flush at full rate. */
  const isStreamForeground = useCallback((sessionId: string) => {
    if (externallyRenderedSessionIds.current.has(sessionId)) return true;
    if (document.hidden) return false;
    const surfaces = streamSurfacesRef.current;
    if (
      surfaces.inboxSessionId === sessionId ||
      surfaces.inspectedWorkerId === sessionId
    )
      return true;
    const tab = tabsRef.current.find(
      (entry) => entry.id === activeTabIdRef.current,
    );
    return !!tab && leafIds(tab.layout).includes(sessionId);
  }, []);

  const applyApprovalEvent = useCallback(
    (sessionId: string, event: HarnessEvent) => {
      const queued = harnessQueued.current.get(sessionId) ?? [];
      harnessQueued.current.delete(sessionId);
      const events = [...queued, event];
      const prev = sessionsRef.current;
      const next = prev.map((session) =>
        session.id === sessionId
          ? applyHarnessEvents(session, events)
          : session,
      );
      if (!next.some((session, index) => session !== prev[index])) return;
      sessionsRef.current = next;
      syncDockBadge(next);
      setSessions(next);
    },
    [],
  );

  // An agent's dev server belongs to its chat's project; read only on a find.
  const devPreviewPlace = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find(
        (entry) => entry.id === sessionId,
      );
      return session
        ? { project: session.cwd, cwd: sessionWorkCwd(session) }
        : undefined;
    },
    [sessionsRef],
  );

  const enqueueHarnessEvent = useCallback(
    (sessionId: string, event: HarnessEvent) => {
      // Shell tool output only; returns at once for streamed text.
      observeAgentPreviewEvent(sessionId, event, devPreviewPlace);
      if (
        event.type === "approval.requested" ||
        event.type === "approval.resolved" ||
        event.type === "question.asked" ||
        event.type === "question.submitting" ||
        event.type === "question.failed" ||
        event.type === "question.resolved"
      ) {
        applyApprovalEvent(sessionId, event);
        return;
      }
      const queued = harnessQueued.current;
      const events = queued.get(sessionId);
      if (events) events.push(event);
      else queued.set(sessionId, [event]);
      const foreground = isStreamForeground(sessionId);
      // A visible stream must not wait for a background-only timer.
      if (foreground && harnessFlush.current?.background) {
        cancelScheduledFlush(harnessFlush.current);
        harnessFlush.current = null;
      }
      if (!harnessFlush.current) {
        harnessFlush.current = scheduleStreamFlush(
          flushHarnessEvents,
          lastHarnessFlushAt.current,
          undefined,
          foreground,
        );
      }
    },
    [
      applyApprovalEvent,
      devPreviewPlace,
      flushHarnessEvents,
      isStreamForeground,
    ],
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
      // Never leave streamed text only in the live store.
      flushCommittedSessions();
    };
  }, [resumed, flushCommittedSessions]);

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
          : automationsViewOpen
            ? "automations"
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
      if (isInFlightSession(session)) {
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
  // Working chats hold off idle sleep (Settings > Tasks), shared with
  // automations. Chats waiting for the user's answer or approval do not.
  const keepAwakeSessionIds = useMemo(
    () => agentKeepAwakeSessionIds(sessions),
    [sessions],
  );
  const keepAwakeProgress = useMemo(
    () => agentKeepAwakeProgress(sessions, keepAwakeSessionIds),
    [sessions, keepAwakeSessionIds],
  );
  useAgentKeepAwake(keepAwakeSessionIds, keepAwakeProgress);
  // Fills and updates project memories the user asked Aven to keep, while
  // no agent works in that project.
  useMemoryKeeper(sessions);

  // Restored and newly selected providers may arrive after the boot refresh.
  // Catalog loaders deduplicate already loaded catalogs and in-flight probes.
  const activeHarness = active?.harness;
  useEffect(() => {
    if (!activeHarness || !isLiveHarness(activeHarness)) return;
    void refreshHarnessCatalogs([activeHarness]);
  }, [activeHarness]);

  const activityEntries = useActivity();
  // Every discussion, race and orchestration as one team view (see
  // teamRuns), from the committed sessions: streaming that commits nothing
  // never recomputes it, and its identity holds until a team changes.
  const teamStores = useTeamStores();
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  // Workers whose approvals and questions their lead decides right now:
  // those of a run that is still open, unless the lead left one to you.
  const nextLeadDecided = useMemo(
    () => leadDecidedIds(orchestrationRuns, (id) => sessionById.get(id)),
    [orchestrationRuns, sessionById],
  );
  const leadDecidedRef = useRef(nextLeadDecided);
  if (!setsEqual(leadDecidedRef.current, nextLeadDecided))
    leadDecidedRef.current = nextLeadDecided;
  const leadDecided = leadDecidedRef.current;
  const nextTeams = useMemo(
    () =>
      teamRunsFrom(teamStores, {
        session: (id) => sessionById.get(id),
        activity: activityEntries,
      }),
    [activityEntries, sessionById, teamStores],
  );
  const teamsRef = useRef(nextTeams);
  if (!equalChromeData(teamsRef.current, nextTeams))
    teamsRef.current = nextTeams;
  const teams = teamsRef.current;
  const teamsLatest = useRef(teams);
  teamsLatest.current = teams;
  // Open races as one sidebar row each (see teamGrouping).
  const sidebarTeamRows = useMemo(() => sidebarTeams(teams), [teams]);

  // Chats waiting on the user (see teamAttention): their own approvals and
  // questions, never an orchestration worker's, which its lead decides; and
  // the chat to open for a team that paused or that no agent finished.
  const nextTeamNeedIds = useMemo(() => teamNeedSessionIds(teams), [teams]);
  const teamNeedIdsRef = useRef(nextTeamNeedIds);
  if (!setsEqual(teamNeedIdsRef.current, nextTeamNeedIds))
    teamNeedIdsRef.current = nextTeamNeedIds;
  const teamNeedIds = teamNeedIdsRef.current;
  const nextApprovalSessionIds = useMemo(
    () => attentionSessionIds(sessions, teams, leadDecided),
    [sessions, teams, leadDecided],
  );
  const approvalSessionIdsRef = useRef(nextApprovalSessionIds);
  if (!setsEqual(approvalSessionIdsRef.current, nextApprovalSessionIds)) {
    approvalSessionIdsRef.current = nextApprovalSessionIds;
  }
  const approvalSessionIds = approvalSessionIdsRef.current;
  // One word per chat, for its sidebar row and the project boards: what its
  // turns, teams, unreviewed changes and ships say (see chatStatus).
  useChatReviewTracker(sessionsRef);
  const chatReviews = useChatReviews();
  const shippedChats = useShippedChats();
  const nextChatStatus = useMemo(
    () =>
      chatStatuses({
        working: busySessionIds,
        needsYou: approvalSessionIds,
        teams,
        reviews: chatReviews,
        shipped: shippedChats,
      }),
    [busySessionIds, approvalSessionIds, teams, chatReviews, shippedChats],
  );
  const chatStatusRef =
    useRef<Readonly<Record<string, ChatStatusWord>>>(nextChatStatus);
  if (
    chatStatusRef.current !== nextChatStatus &&
    !equalChromeData(chatStatusRef.current, nextChatStatus)
  )
    chatStatusRef.current = nextChatStatus;
  const chatStatus = chatStatusRef.current;
  // What holds each working chat up, for its pill's tooltip. It changes
  // rarely, so the sidebar keeps the same object through streamed tokens.
  const nextChatStatusHints = useMemo(
    () => chatHoldUpHints(sessions),
    [sessions],
  );
  const chatStatusHintsRef =
    useRef<Readonly<Record<string, string>>>(nextChatStatusHints);
  if (!equalChromeData(chatStatusHintsRef.current, nextChatStatusHints))
    chatStatusHintsRef.current = nextChatStatusHints;
  const chatStatusHints = chatStatusHintsRef.current;
  const [notificationWindowFocused, setNotificationWindowFocused] = useState(
    () => document.hasFocus(),
  );
  const notificationWindowFocusedRef = useRef(notificationWindowFocused);
  notificationWindowFocusedRef.current = notificationWindowFocused;
  // The later-created detached-window controller updates this bridge before effects run.
  const activityWindowBridgeRef = useRef<{
    floatingSessionIds: readonly string[];
    focusedSessionIds: ReadonlySet<string>;
    showSession?: (id: string) => boolean | Promise<boolean>;
  }>({ floatingSessionIds: [], focusedSessionIds: new Set() });
  const activityMainViewRef = useRef({ workspaceVisible, visibleSurfaceIds });
  activityMainViewRef.current = { workspaceVisible, visibleSurfaceIds };
  /** The chats of the discussion open in this window's panel. */
  const panelChatsRef = useRef<readonly string[]>([]);
  /** The chats of the team whose pop-out has focus. */
  const popOutChatsRef = useRef<readonly string[]>([]);
  /**
   * Whether each chat is on screen and focused now, worked out once for
   * however many chats are asked about (the read check asks for each unread
   * chat on every render).
   */
  const activityPresenter = useCallback(() => {
    const view = activityMainViewRef.current;
    // A race's overview on screen shows its lanes, as the discussion panel
    // shows both of its chats.
    const surfaces = new Set(view.visibleSurfaceIds);
    const watched = [...panelChatsRef.current];
    for (const tab of tabsRef.current) {
      if (!surfaces.has(tab.id)) continue;
      for (const pane of tab.editorPanes)
        for (const file of pane.files)
          if (file.race)
            for (const lane of getRace(file.race.raceId)?.lanes ?? [])
              watched.push(lane.sessionId);
    }
    const mainVisible = visibleActivitySessionIds({
      ...view,
      tabs: tabsRef.current,
      sessionIds: new Set(sessionsRef.current.map((session) => session.id)),
      floatingSessionIds: activityWindowBridgeRef.current.floatingSessionIds,
      companions: teamCompanions(teamsLatest.current),
      panel: watched,
    });
    const elsewhere = activityWindowBridgeRef.current.focusedSessionIds;
    const popOut = new Set(popOutChatsRef.current);
    const windowFocused = notificationWindowFocusedRef.current;
    return (sessionId: string) => {
      const otherFocused = elsewhere.has(sessionId) || popOut.has(sessionId);
      return {
        visible: otherFocused || mainVisible.has(sessionId),
        focused: otherFocused || windowFocused,
      };
    };
  }, []);
  const activityPresentation = useCallback(
    (sessionId: string) => activityPresenter()(sessionId),
    [activityPresenter],
  );
  // Turns the orchestrator sends (a worker's, or the lead's hidden
  // continuation) post no Activity entry or banner of their own; the run
  // posts one when it finishes or pauses.
  const quietActivityTurns = useRef<ReturnType<typeof quietTurns>>(null);
  quietActivityTurns.current ??= quietTurns();
  // Turns a team sends its members (a discussion's relays, a race's lanes)
  // are recorded quietly for their chat's status; the team posts its own
  // entry per need and at its end.
  const memberActivityTurns = useRef<ReturnType<typeof memberTurns>>(null);
  memberActivityTurns.current ??= memberTurns();
  const announceActivity = useCallback(
    (session: Session, event: SessionActivityEvent) => {
      // A race keeps how each lane ended, whether or not its chat stays
      // loaded or the ledger keeps the entry. Only the chat's own turn says
      // that: a team's notice posted on a lane's chat is not its ending.
      if (
        isTurnActivity(session.id, event.id) &&
        (event.outcome === "completed" ||
          event.outcome === "failed" ||
          event.outcome === "stopped")
      )
        raceLaneEnded(session.id, event.outcome);
      if (quietActivityTurns.current?.silences(event.id)) return;
      const team = memberActivityTurns.current?.teamOf(event.id);
      const presentation = activityPresentation(session.id);
      void publishSessionActivity(
        session,
        team ? { ...event, team } : event,
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
      const events = pendingSessionActivityEvents(session, leadDecided);
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
    leadDecided,
  ]);

  /**
   * The chat a team's notice belongs to, loaded or not: a notice is posted
   * even when that chat is closed (a race's starting chat, a discussion's
   * missing partner, a run's tab-less lead), from its saved row or what the
   * team knows of it.
   */
  const noticeChat = useCallback(
    (
      id: string,
      known: {
        harness?: Session["harness"];
        cwd?: string;
        title?: string;
        model?: string;
      } = {},
    ): Session | undefined => {
      const loaded = sessionsRef.current.find((session) => session.id === id);
      if (loaded) return loaded;
      const saved = historyRef.current.find((row) => row.id === id);
      const harness = saved?.harness ?? known.harness;
      if (!harness) return undefined;
      return {
        ...newSession(harness, saved?.cwd ?? known.cwd ?? "~"),
        id,
        title: saved?.title ?? known.title ?? "",
        model: saved?.model ?? known.model ?? "",
      };
    },
    [sessionsRef],
  );

  // One entry per run outcome, on the lead's chat: "Run finished · 4 agents"
  // or "Run paused · <reason>", with a banner while you are elsewhere.
  useEffect(
    () =>
      orchestrator.onOutcome((outcome) => {
        const { run } = outcome;
        // A run that ends during a turn of yours to the lead (wrap up, an
        // answer, an instruction) is that turn's news: its own end posts
        // nothing, so the run counts once, with one banner and one cheer.
        const turn = activityTurnIds.current.get(run.leadId);
        if (turn) quietActivityTurns.current?.add(turn);
        const lead = noticeChat(run.leadId, {
          harness: run.lead?.harness,
          cwd: run.cwd,
          title: run.title,
        });
        if (lead) announceActivity(lead, runOutcomeActivity(outcome));
      }),
    [announceActivity, noticeChat],
  );

  // A run is never lost, or left holding its checkout, across a restart or
  // a reload: this page loads (and pauses, if it was running) every run its
  // earlier page held, and in the main window every open run whose lead has
  // no tab.
  useEffect(() => {
    void orchestrator.loadPageRuns(
      () => invoke<string[]>("control_page_loaded"),
      (error) => logError("Couldn't load open runs", error),
    );
  }, []);

  // A suggested winner this window asked for before a reload, or one that
  // ran longer than a call can, is over; a review asked before a reload is
  // settled from its chat's reply once that chat stops working.
  useEffect(() => watchRaceSuggestions(subscribeRaces), []);
  useEffect(() => {
    if (
      teamStores.races.some(
        (race) => race.state === "running" && race.review?.status === "running",
      )
    )
      void reconcileRaceReviews(
        (id) => sessionById.get(id),
        undefined,
        undefined,
        undefined,
        (id) => willAutoContinue(sessionById.get(id)),
      ).catch((error) => logError("Race review", error));
  }, [sessionById, teamStores.races]);
  // A lane whose chat was deleted or archived elsewhere, or before races
  // recorded that, reads stopped rather than working for good.
  useEffect(() => {
    if (!teamStores.races.some((race) => race.state === "running")) return;
    void settleMissingLanes(
      (id) => sessionsRef.current.some((session) => session.id === id),
      async (id) =>
        !chatIsArchived(
          id,
          historyRef.current.find((row) => row.id === id)?.archived,
        ) && (await getSession(id).catch(() => null)) != null,
    ).catch((error) => logError("Race agents", error));
  }, [teamStores.races, sessionsRef]);
  // A lane cut short by a quit or reload, and not about to carry on,
  // reports no ending: record it, so a window that doesn't hold it stops
  // reading it as working.
  useEffect(() => {
    if (teamStores.races.some((race) => race.state === "running"))
      settleInterruptedLanes(
        sessions,
        (session) => wasTurnInterrupted(session) && !willAutoContinue(session),
      );
  }, [sessions, teamStores.races]);

  // A finished run's result card: the lead's verdict once its last turn
  // ended, and a line per agent from the cheap model (see teamResult).
  useEffect(() => {
    for (const run of teamStores.runs) {
      if (run.status !== "finished") continue;
      const lead = sessionById.get(run.leadId);
      // The reply of the turn the run ended in. A run from an earlier
      // version has no end to match, so it keeps no verdict rather than a
      // line from a later conversation.
      if (run.verdict === undefined && lead && !lead.busy)
        void orchestrator
          .noteVerdict(
            run.leadId,
            run.endedAt === undefined
              ? ""
              : leadVerdict(lead.blocks, run.endedAt),
          )
          .catch(console.error);
      // Only a run that just finished here: an older one is not summed up
      // again each time Aven reopens it.
      if (
        !run.summaries &&
        run.endedAt !== undefined &&
        Date.now() - run.endedAt < RUN_SUMMARY_WINDOW_MS
      )
        void (async () => {
          if (!(await orchestrator.noteSummaries(run.leadId, "running")))
            return;
          const lines = await summarizeRun(run);
          await orchestrator.noteSummaries(
            run.leadId,
            lines ? "done" : "failed",
            lines ?? {},
          );
        })().catch(console.error);
    }
  }, [sessionById, teamStores.runs]);

  // A team posts one entry per new need and one at its end (see
  // teamActivity); its members' own turns were recorded quietly.
  // A team's end entry says what it did once that is known, for Activity
  // and the memory keeper (see teamEndSummaries).
  useEffect(() => {
    for (const { teamId, detail } of teamEndSummaries(teamStores))
      amendTeamEnd(teamId, detail);
  }, [teamStores]);
  const loadedSessionIds = useCallback(
    () => sessionsRef.current.map((session) => session.id),
    [sessionsRef],
  );
  const seenTeams = useRef<Map<string, TeamSeen> | null>(null);
  useEffect(() => {
    // Only the window that drives a team posts its notices.
    const posted = teamsPostedHere(teams, teamStores, {
      window: currentWindowLabel(),
      loaded: new Set(loadedSessionIds()),
    });
    const { events, seen } = teamActivityEvents(seenTeams.current, posted);
    seenTeams.current = seen;
    resolveTeamNeedActivity(teamsNoLongerNeedingYou(posted));
    for (const { sessionId, event } of events) {
      const team = teams.find((entry) => entry.id === event.team?.id);
      const member =
        team?.members.find((entry) => entry.sessionId === sessionId) ??
        team?.members[0];
      const session = noticeChat(sessionId, {
        harness: member?.harness,
        cwd: team?.project,
        title: member?.title ?? team?.title,
      });
      if (session) announceActivity(session, event);
    }
  }, [announceActivity, noticeChat, teams, teamStores, loadedSessionIds]);

  // Read requires an actually displayed transcript, including split siblings or
  // a focused detached window. An active ID behind Settings/browser is insufficient.
  useEffect(() => {
    const unreadSessions = new Set(
      activityEntries
        .filter((entry) => entry.readAt === null)
        .map((entry) => entry.sessionId),
    );
    if (!unreadSessions.size) return;
    const presentation = activityPresenter();
    for (const id of unreadSessions) {
      const { visible, focused } = presentation(id);
      if (visible && focused) markSessionActivityRead(id);
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
    () =>
      hiddenApprovalNotices(
        sessions,
        activeTabId,
        tabs,
        composerFocused,
        leadDecided,
      ),
    [sessions, activeTabId, tabs, composerFocused, leadDecided],
  );

  useEffect(() => {
    setDockTeamNeeds(teamNeedIds);
    setDockLeadDecided(leadDecided);
    syncDockBadge(sessions);
  }, [sessions, teamNeedIds, leadDecided]);

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
      () => saveBrowserWorkspaces(browserWorkspacesRef.current, true),
      {
        dirtyFileIds: () => dirtyFilesRef.current,
        stopSessions: (ids) => {
          for (const id of ids) stopSessionRef.current(id);
        },
        leadDecided: () => leadDecidedRef.current,
      },
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
        // The red close button is an explicit, cancellable close, not a
        // best-effort unload. Keep this renderer and its drafts if saving fails.
        void closeBusyWindow();
      })
      .then((fn) => {
        unlistenClose = fn;
      });
    return () => {
      releaseQuit();
      unlistenClose?.();
    };
  }, [flushHarnessEvents]);

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

  const {
    profileHistoryErrors,
    refreshProfileHistory,
    standaloneSessions,
    profileSessionSummaries,
    profilePreviews,
  } = useSidebarData({
    onScreen: sidebarShown,
    profiles,
    standaloneCwds,
    history,
    sessions,
    orchestrationRuns,
    busySessionIds,
    setHistory,
    setLoadedProjects,
    loadedProjectsRef,
  });

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
        if (
          historyHoldsProject(
            summary.cwd,
            sidebarCwdRef.current,
            loadedProjectsRef.current,
          )
        ) {
          setHistory((current) => mergeProjectHistorySummary(current, summary));
        }
      })
      .catch(() => undefined);
  }, []);

  const scheduleTranscriptDrain = useFixedDeadline(() => {
    const dirty = [...pendingPersist.current.values()];
    pendingPersist.current.clear();
    const now = Date.now();
    void Promise.all(
      dirty.map(async (session) => {
        if (removingSessionIds.current.has(session.id)) return;
        const fingerprint = persistFingerprint(session);
        if (lastPersisted.current.get(session.id) === fingerprint) return;
        // A running chat rewrites its whole transcript on every save. Space
        // those out; the final state is saved as soon as the turn ends.
        if (
          session.busy &&
          now - (lastBusyPersistAt.current.get(session.id) ?? 0) <
            BUSY_PERSIST_INTERVAL_MS
        ) {
          if (!pendingPersist.current.has(session.id))
            pendingPersist.current.set(session.id, session);
          scheduleTranscriptDrain();
          return;
        }
        if (session.busy) lastBusyPersistAt.current.set(session.id, now);
        const summary = await upsertSession(session).catch(() => null);
        if (!summary) return;
        lastPersisted.current.set(session.id, fingerprint);
        if (
          historyHoldsProject(
            summary.cwd,
            sidebarCwdRef.current,
            loadedProjectsRef.current,
          )
        ) {
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

  const snapshotSessionsRef = useRef(sessions);
  const snapshotSessions = useMemo(() => {
    snapshotSessionsRef.current = stableSnapshotSessions(
      snapshotSessionsRef.current,
      sessions,
    );
    return snapshotSessionsRef.current;
  }, [sessions]);

  useEffect(() => {
    if (windowTransfer) return;
    const snapshot = collectWorkspaceSnapshot(
      tabs,
      snapshotSessions,
      activeTabId,
      projectCwd,
      projectTerminals,
    );
    scheduleWorkspaceSnapshot(snapshot);
  }, [
    tabs,
    snapshotSessions,
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
        rememberInitialProject(cwd);
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

  // This window's team panel and pills (see `useTeamWatch`).
  const teamWatch = useTeamWatch();
  // Only live work floats: an ended race's pill goes after a moment, and a
  // finished discussion's panel shrinks once you leave its chat or send its
  // plan to build (see `useTeamPanelTidy`).
  const sessionIdsKey = sessions.map((session) => session.id).join("\n");
  const visibleSurfacesKey = visibleSurfaceIds.join("\n");
  const chatsOnScreen = useMemo(
    () =>
      [
        ...visibleActivitySessionIds({
          workspaceVisible,
          visibleSurfaceIds: visibleSurfacesKey
            ? visibleSurfacesKey.split("\n")
            : [],
          tabs,
          sessionIds: new Set(sessionIdsKey ? sessionIdsKey.split("\n") : []),
          floatingSessionIds: [],
        }),
      ]
        .sort()
        .join("\n"),
    [workspaceVisible, visibleSurfacesKey, tabs, sessionIdsKey],
  );
  useTeamPanelTidy(teamWatch, chatsOnScreen);
  // Chats in a discussion this window drives, while it runs or still owes a
  // closing note, and the two in the open or popped-out panel. A
  // discussion's partner has no tab: it plays out in the chat that started it.
  const discussionList = useDiscussionList();
  const panelDiscussions = [teamWatch.state.expanded, ...teamWatch.state.popped]
    .filter((id): id is string => !!id && teamKindOf(id) === "discuss")
    .map(teamKeyOf)
    .join("\n");
  const panelChats = useMemo(() => {
    const ids = panelDiscussions ? panelDiscussions.split("\n") : [];
    return discussionList
      .filter((discussion) => ids.includes(discussion.id))
      .flatMap((discussion) => [
        discussion.a.sessionId,
        discussion.b.sessionId,
      ]);
  }, [discussionList, panelDiscussions]);
  // On screen here: only the discussion open in this window's panel. A
  // popped-out team is on screen in its own window, and counts as seen only
  // while that window has focus.
  const expandedDiscussion =
    teamWatch.state.expanded &&
    teamKindOf(teamWatch.state.expanded) === "discuss"
      ? teamKeyOf(teamWatch.state.expanded)
      : null;
  panelChatsRef.current = useMemo(
    () =>
      discussionList
        .filter((discussion) => discussion.id === expandedDiscussion)
        .flatMap((discussion) => [
          discussion.a.sessionId,
          discussion.b.sessionId,
        ]),
    [discussionList, expandedDiscussion],
  );
  const focusedPopOut = useSyncExternalStore(
    subscribeFocusedTeamPopOut,
    focusedTeamPopOut,
    () => null,
  );
  const focusedPopOutTeam =
    focusedPopOut && teamWatch.state.popped.includes(focusedPopOut)
      ? teams.find((team) => team.id === focusedPopOut)
      : undefined;
  popOutChatsRef.current = useMemo(
    () => (focusedPopOutTeam ? popOutShownChats(focusedPopOutTeam) : []),
    [focusedPopOutTeam],
  );
  const keptDiscussionKey = useMemo(
    () =>
      [
        ...keptDiscussionChats(discussionList, discussionStore().owner),
        ...panelChats,
      ].join("\n"),
    [discussionList, panelChats],
  );

  // Tabs are views. Hidden idle sessions drop their child. A visible session
  // keeps its child for a few minutes after a turn so follow-ups stay instant,
  // then parks it and resumes on the next prompt.
  useEffect(() => {
    // Inbox chats, a discussion's chats until it is finished, the lead of a
    // running or paused orchestration and its workers stay loaded without a
    // tab (see retainedSessionIds). Read the discussion store too: a chat
    // started for a discussion is added in the same step that starts it.
    const discussions = discussionStore();
    const visibleIds = retainedSessionIds(
      sessions,
      openSessionIds(tabs),
      orchestrationRuns,
      [
        ...keptDiscussionKey.split("\n"),
        ...keptDiscussionChats(discussions.snapshot(), discussions.owner),
      ],
    );
    const keepUnseen = liveAgentsEnabled;
    const idleDetached = sessions.filter(
      (session) =>
        !visibleIds.has(session.id) &&
        !isInFlightSession(session) &&
        !uncertainSessionAgents(session).length &&
        !(
          keepUnseen && keepsUnseenFinished(session, unseenFinishedRef.current)
        ),
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
          isInFlightSession(session) ||
          uncertainSessionAgents(session).length > 0 ||
          (keepUnseen &&
            keepsUnseenFinished(session, unseenFinishedRef.current)) ||
          skipForgetSessionIds.current.has(session.id),
      ),
    );
  }, [
    sessions,
    tabs,
    persistSession,
    liveAgentsEnabled,
    orchestrationRuns,
    keptDiscussionKey,
  ]);

  const activateTab = useCallback(
    (id: string, restoreWorkspace = false, paneId?: string) => {
      if (detachedIdsRef.current.has(id)) {
        void detachedShowSurface.current(id, paneId);
        return;
      }
      setHomeViewOpen(false);
      if (!restoreWorkspace) leaveExpandedPreview();
      setActiveTabId(id);
      const original = tabsRef.current.find((entry) => entry.id === id);
      const requestedPane =
        original && paneId && leafIds(original.layout).includes(paneId)
          ? paneId
          : undefined;
      const tab =
        original &&
        requestedPane &&
        (requestedPane !== original.focusedId || original.diffFocused)
          ? { ...original, focusedId: requestedPane, diffFocused: false }
          : original;
      if (tab && tab !== original)
        setTabs((previous) =>
          previous.map((entry) =>
            entry.id === id
              ? { ...entry, focusedId: tab.focusedId, diffFocused: false }
              : entry,
          ),
        );
      const targetCwd = tab
        ? focusedWorkspaceTabCwd(tab, sessionsRef.current)
        : "";
      if (!restoreWorkspace)
        viewRef.current.focus(
          targetCwd ? normalizeProjectPath(targetCwd) : projectCwdRef.current,
          id,
        );
      if (targetCwd && looksLikeProject(targetCwd)) {
        const normalized = normalizeProjectPath(targetCwd);
        profilesRef.current.selectProjectProfile(normalized);
        if (!sameProjectPath(normalized, projectCwdRef.current)) {
          setProjectCwd(normalized);
          rememberRecentProject(normalized);
        }
      }
      setComposerFocused(
        !!tab &&
          sessionsRef.current.some((session) => session.id === tab.focusedId),
      );
    },
    [leaveExpandedPreview, rememberRecentProject],
  );

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
    void loadBundledChangelog()
      .then((changelog) => releaseNotesForVersion(version, changelog))
      .catch(() => null)
      .then((document) => {
        if (!document) {
          void message(
            "Release notes for this version are not available in this build.",
            { title: "Aven" },
          );
          return;
        }
        setWhatsNewVersion(document.source.version);
      });
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
        closeUtilityViews();
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
              ? addRetainedBrowserTab(
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
          title: "Could not start chat",
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
    closeUtilityViews();
    setComposerFocused(false);
    onNewBrowserTab();
  }, [profileHome, onNewStandalone, onNewBrowserTab, closeUtilityViews]);

  const onNew = useCallback(() => {
    setHomeViewOpen(false);
    if (profileHome) {
      void onNewStandalone();
      return;
    }
    leaveExpandedPreview();
    closeUtilityViews();
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
    (item: InboxItem) => {
      // The Inbox may have been opened over Home; show the new chat.
      showWorkspace();
      setSidebarTab("sessions");
      const cwd =
        item.projectPath || active?.cwd || sessionDefaults?.cwd || projectCwd;
      const session = {
        ...newDefaultSession(cwd),
        title: `#${item.number} ${item.title}`,
        inboxCard: inboxComposerCard(item),
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
      showWorkspace,
    ],
  );

  const onAddNoteToChat = useCallback(
    (card: NoteComposerCard) => {
      if (!card.id) return;
      // Notes may have been opened over Home; show the new chat.
      showWorkspace();
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
      showWorkspace,
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

  // A preview tab's Start dev server: a new terminal in the project's panel
  // runs the script, queued until its shell starts like any terminal
  // command. The panel opens to show the output; focus stays where it is.
  useEffect(
    () =>
      installDevServerStarter((project, command) => {
        const projectPath = projectCwdRef.current;
        if (
          !looksLikeProject(projectPath) ||
          !sameProjectPath(projectPath, project)
        )
          return false;
        const existing = findProjectTerminal(
          projectTerminalsRef.current,
          projectPath,
        );
        const file = newTerminalFile(
          projectPath,
          existing ? nextDockTerminalTitle(existing, projectPath) : undefined,
        );
        queueTerminalCommand(file.id, command);
        setProjectTerminals((prev) =>
          findProjectTerminal(prev, projectPath)
            ? mapProjectTerminal(prev, projectPath, (dock) =>
                addTerminalToDock(dock, file),
              )
            : [...prev, createProjectTerminal(projectPath, file)],
        );
        return true;
      }),
    [],
  );

  // New terminals open in the active session's worktree when it has one, so
  // they never land in the main checkout while the session works elsewhere.
  const terminalCwd = active ? sessionWorkCwd(active) : projectCwd;

  const onOpenTerminal = useCallback(
    (cwd: string, asWorkspaceTab = false, occupySessionId?: string) => {
      leaveExpandedPreview();
      const workdir = cwd || terminalCwd;
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
    [terminalCwd, activeTab, appendTab, openProjectTerminal],
  );

  const onNewTerminal = useCallback(() => {
    onOpenTerminal(terminalCwd);
  }, [terminalCwd, onOpenTerminal]);

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
      openProjectTerminal(terminalCwd);
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
  }, [terminalCwd, focusProjectTerminal, openProjectTerminal, projectCwd]);

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
    onOpenTerminal(terminalCwd, true);
  }, [terminalCwd, onOpenTerminal]);

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
      void confirmDiscardUnsaved("Close this chat with unsaved files?").then(
        (ok) => ok && finishClear(),
      );
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
      setAutomationsViewOpen(place.kind === "automations");
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
    [
      commitNavigation,
      isLocationAvailable,
      setSettingsOpen,
      setSearchViewOpen,
      setInboxViewOpen,
      setAutomationsViewOpen,
      setNotesViewOpen,
      setHomeViewOpen,
      setFilePickerOpen,
      setSettingsSection,
    ],
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
      activateTab(owner.id, false, paneId);
    },
    [activateTab, inboxAskPortal],
  );

  /**
   * A chat's review, when the chat's tab holds only chats and another pane on
   * screen shows something else (a live preview, a board): a tab in the
   * widest such pane, beside what it shows, rather than a third column
   * squeezed in beside the chat. Says whether it went there.
   */
  const openReviewInOtherPane = (
    session: { sessionId: string; cwd: string },
    focusPath: string | undefined,
  ): boolean => {
    const chatTab = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    );
    if (!chatTab || chatTab.editorPanes.length > 0) return false;
    const isChat = (surfaceId: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === surfaceId);
      return (
        !!tab &&
        leafIds(tab.layout).some((id) =>
          sessionsRef.current.some((entry) => entry.id === id),
        )
      );
    };
    const pane = reviewPaneFor(viewRef.current.view, chatTab.id, isChat);
    if (!pane) return false;
    const existing = sessionChangesTabFor(
      tabsRef.current,
      session.cwd,
      session.sessionId,
    );
    let id: string;
    if (existing) {
      // One shown elsewhere (another window, another project) is left there.
      const view = viewRef.current.view;
      const known = Object.values({ ...view.groups, ...view.hiddenGroups });
      if (!known.some((members) => members.includes(existing.id))) return false;
      id = existing.id;
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === id
            ? openSessionChangesTab(
                tab,
                session.cwd,
                session.sessionId,
                focusPath,
              )
            : tab,
        ),
      );
    } else {
      const review = newSessionChangesWorkspaceTab(
        session.cwd,
        session.sessionId,
        focusPath,
      );
      // Only a tab of the project on screen can join one of its panes.
      const project = workspaceTabCwd(review, sessionsRef.current);
      if (!project || !sameProjectPath(project, projectCwdRef.current))
        return false;
      id = review.id;
      // Commit the tab first so the workspace view knows the new surface.
      flushSync(() => appendTab(review, projectCwdRef.current));
    }
    viewRef.current.change((view) => showInPane(view, id, pane));
    return true;
  };
  const openReviewInOtherPaneRef = useRef(openReviewInOtherPane);
  openReviewInOtherPaneRef.current = openReviewInOtherPane;

  const onOpenDiff = useCallback(
    (
      path?: string,
      session?: { sessionId: string; cwd: string },
      changeKind?: GitFileDiffKind,
      options?: { exact?: boolean },
    ) => {
      leaveExpandedPreview();
      void (async () => {
        const diffCwd = session?.cwd ?? gitCwdRef.current;
        // Git already reports exact paths; guessing would scan the project on
        // every click and could swap in a same-named file.
        const resolved = path
          ? options?.exact
            ? path
            : ((await resolveOpenablePath(diffCwd, path)) ?? path)
          : undefined;
        if (resolved) rememberOpenedFile(diffCwd, resolved);
        if (session && openReviewInOtherPaneRef.current(session, resolved)) {
          setSidebarTab("changes");
          setComposerFocused(false);
          return;
        }
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
    (path: string, kind?: GitFileDiffKind) =>
      onOpenDiff(path, undefined, kind, { exact: true }),
    [onOpenDiff],
  );

  /** Stack the working-tree changes in one review, whatever the diff-view setting: one section's, or all of them without a kind. */
  const onOpenAllChanges = useCallback(
    (kind?: GitFileDiffKind) => {
      leaveExpandedPreview();
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? openChangesTab(tab, sidebarCwdRef.current, undefined, kind)
            : tab,
        ),
      );
      setComposerFocused(false);
    },
    [activeTabId],
  );

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
    closeUtilityViews();
    setSidebarTab("changes");
  }, []);

  const onToggleChanges = useCallback(() => {
    onShowSourceControl();
  }, [onShowSourceControl]);
  // "Ship it" on a finished turn's changes opens the Changes panel, which
  // then opens its Ship flow for that folder.
  useEffect(
    () => subscribeShipRequests(() => onShowSourceControl()),
    [onShowSourceControl],
  );

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

  /** A file tab's "Add to chat": the chat beside it, else the active one. */
  const onAddFileToChat = useCallback(
    (paneId: string, fileId: string) => {
      const tab = tabsRef.current.find((entry) =>
        findSurfacePane(entry, paneId),
      );
      const file = tab
        ? findSurfacePane(tab, paneId)?.pane.files.find(
            (entry) => entry.id === fileId,
          )
        : undefined;
      if (!file) return;
      const target = fileChatTarget(
        tabsRef.current,
        paneId,
        sessionsRef.current,
        activeTabIdRef.current,
      );
      if (!target) return;
      if (target.tabId !== tab?.id) {
        viewRef.current.change((view) =>
          selectWorkspaceView(view, target.tabId),
        );
        activateTab(target.tabId, false, target.session.id);
      }
      // After the chat's tab shows, so its message box can take focus.
      requestAnimationFrame(
        () => void addFileToChat(file.path, target.session),
      );
    },
    [activateTab],
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
      profilesRef.current.selectProjectProfile(target.cwd);
      setProjectCwd(target.cwd);
      rememberRecentProject(target.cwd);
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
          restored.blocks,
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

  // A reload brings back a discussion's partner, which has no tab.
  useDiscussionChatsLoaded(ensureOpenSession, loadedSessionIds);

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
              "This chat is no longer available in local history.",
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
      closeUtilityViews();
      profilesRef.current.selectProfile(
        profilesRef.current.projectProfile(entry.cwd),
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
          session = {
            ...newDefaultSession(cwd),
            title: `Ask · ${item.title}`,
            inboxAsk: {
              key,
              title: item.title,
              url: item.url,
              provider: item.provider,
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
      const currentIntent = beginNavigation();
      clearReturnFocus();
      if (await activityWindowBridgeRef.current.showSession?.(sessionId))
        return;
      if (!currentIntent()) return;
      leaveExpandedPreview();
      closeUtilityViews();
      if (focusOpenSession(sessionId)) return;
      let session = await ensureOpenSession(sessionId);
      if (!currentIntent() || !session || session.inboxAsk) return;
      const parentId =
        session.orchestrationLeadId ??
        orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!currentIntent() || !session) return;
        if (focusOpenSession(session.id)) return;
      }
      revealProjectTask(session.cwd);
      profilesRef.current.selectProjectProfile(session.cwd);
      setProjectCwd(session.cwd);
      rememberRecentProject(session.cwd);
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
      beginNavigation,
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
      // Rows from other projects and standalone chats are not revalidated by
      // the current project's refresh; show the new title wherever it is listed.
      setHistory((current) =>
        current.map((row) =>
          row.id === sessionId
            ? { ...row, title: formatSessionTitle(row.harness, trimmed) }
            : row,
        ),
      );
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
        : "this chat";
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
                `${mode === "archive" ? "Archive" : "Delete"} this chat with unsaved files?`,
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
            // A race agent removed mid-turn reports no ending of its own.
            raceLaneRemoved(sessionId);
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
              // A running race started here is shown by its first agent's
              // row from now on, and its notices go there.
              for (const race of listRaces())
                if (
                  race.state === "running" &&
                  race.origin?.sessionId === sessionId
                )
                  updateRace(race.id, { origin: undefined });
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
              // A deleted chat leaves no card on its project's board.
              forgetChatReview(sessionId);
              forgetShippedChat(sessionId);
              forgetTurnNotes(sessionId);
            }
          },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void message(`Could not ${mode} this chat.\n\n${detail}`, {
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
        void message(`Could not unarchive this chat.\n\n${String(error)}`, {
          title: "Aven",
          kind: "error",
        });
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
            automationsViewOpenRef.current ||
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
          `Delete ${sessionIds.length} selected chats? This can’t be undone.`,
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
        if (isKnownProject(normalized)) {
          profilesRef.current.selectProjectProfile(normalized);
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
        rememberRecentProject(normalized);
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
      rememberRecentProject(normalized);
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
      closeUtilityViews();
      const normalized = normalizeProjectPath(path);
      if (!looksLikeProject(normalized)) return;
      if (!restoreWorkspace) revealProjectTask(normalized);
      profilesRef.current.selectProjectProfile(normalized);

      const activeWorkspace = tabsRef.current.find(
        (entry) => entry.id === activeTabIdRef.current,
      );
      const current = activeWorkspace
        ? sessionsRef.current.find(
            (session) => session.id === activeWorkspace.focusedId,
          )
        : undefined;
      const currentCwd = activeWorkspace
        ? focusedWorkspaceTabCwd(activeWorkspace, sessionsRef.current)
        : undefined;
      if (currentCwd && sameProjectPath(currentCwd, normalized)) {
        setProjectCwd(normalized);
        rememberRecentProject(normalized);
        return;
      }

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
          rememberRecentProject(normalized);
        }
        activateTab(
          match.id,
          true,
          findProjectPane(match, sessionsRef.current, normalized),
        );
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
      rememberRecentProject(normalized);
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
      setFilePickerOpen(false);
      closeUtilityViews();
      restoreProfileWorkspace(
        id,
        profilesRef.current.selectProfile,
        onSelectProject,
      );
    },
    [onSelectProject, setFilePickerOpen, closeUtilityViews],
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
    return !!path;
  }, [onCreatedProject]);
  /**
   * A new chat in `path`, its message box holding `seed` (never sent).
   * Returns the chat's id.
   */
  const startProjectChat = useCallback(
    (path: string, seed?: string): string => {
      revealProjectTask(path);
      // The sidebar's "New chat" can be pressed over Home; the new chat has
      // to replace it, or nothing seems to happen.
      showWorkspace();
      const session = seed
        ? { ...newDefaultSession(path), composerSeed: seed }
        : newDefaultSession(path);
      // A suggested message takes the place of an untouched new chat already
      // open in this project (the walkthrough leaves one), not a second tab.
      if (seed) {
        const active = tabsRef.current.find(
          (entry) => entry.id === activeTabIdRef.current,
        );
        const focused = sessionsRef.current.find(
          (entry) => entry.id === active?.focusedId,
        );
        if (
          focused &&
          sameProjectPath(focused.cwd, path) &&
          isBlankSession(focused) &&
          !readComposerDraft(focused.id)?.text
        ) {
          setProjectCwd(path);
          rememberRecentProject(path);
          if (replaceBlankPaneWithSession(session)) return session.id;
        }
      }
      const tab = newTab(session.id);
      setProjectCwd(path);
      rememberRecentProject(path);
      setSessions((previous) => [...previous, session]);
      appendTab(tab, path);
      setActiveTabId(tab.id);
      setComposerFocused(true);
      return session.id;
    },
    [appendTab, replaceBlankPaneWithSession, showWorkspace],
  );
  const onNewProjectTask = useCallback(
    (path: string) => void startProjectChat(path),
    [startProjectChat],
  );

  const dispatchWalkthrough = useCallback(
    (action: WalkthroughAction) => {
      const current = walkthroughRef.current;
      if (!current) return;
      const next = walkthroughReducer(current, action);
      saveWalkthrough(next);
      if (!next.ended) {
        // The tour runs over the workspace with what was just added.
        if (next.step === "tour" && current.step !== "tour") showWorkspace();
        setWalkthrough(next);
        return;
      }
      walkthroughRef.current = null;
      setWalkthrough(null);
      // Ended or skipped, setup counts as finished or deferred, as closing
      // provider setup did; Settings can always open it again.
      if (!loadProviderSetup().finished)
        saveProviderSetup({ ...loadProviderSetup(), finished: true });
      // Home holds the Getting started card that follows.
      onOpenHome();
    },
    [onOpenHome, showWorkspace],
  );
  /** The Agents step is done: start the first chat with that provider. */
  const onWalkthroughAgents = useCallback(
    (harness?: HarnessId) => {
      void probeHarnessAvailability({ force: true });
      if (!harness) return;
      saveLastModelChoice(harness, preferredModelId(harness));
      // The fresh welcome chat was seeded before setup. Keep it on the
      // provider chosen here; never alter an existing chat.
      setSessions((previous) =>
        previous.map((session) =>
          session.id === seed.session.id && session.blocks.length === 0
            ? {
                ...session,
                harness,
                title: HARNESS_LABEL[harness],
                model: preferredModelId(harness),
                modelSettings: preferredModelSettings(
                  resolveModel(harness, preferredModelId(harness)),
                ),
              }
            : session,
        ),
      );
      void refreshHarnessCatalogs([harness], { force: true }).catch(
        () => undefined,
      );
    },
    [seed.session.id, setSessions],
  );
  const onTourClose = useCallback(
    (finished: boolean) => {
      setTourAgain(false);
      if (walkthroughRef.current?.step === "tour")
        dispatchWalkthrough({ type: finished ? "finish" : "skip" });
    },
    [dispatchWalkthrough],
  );
  /** The Project step: a folder of the user's, or the sample. */
  const onWalkthroughProject = useCallback(
    async (choice: WalkthroughProjectChoice) => {
      const profileId = profilesRef.current.activeProfileId;
      const path =
        choice === "sample" ? await createSampleProject() : await pickFolder();
      if (!path) return false;
      onCreatedProject(path, profileId);
      return true;
    },
    [onCreatedProject],
  );

  const removingProjects = useRef(new Set<string>());
  /** Removes a project; resolves with why it could not, or null. */
  const onRemoveProject = useCallback(
    async (
      path: string,
      options: { purgeData: boolean },
    ): Promise<string | null> => {
      const normalized = normalizeProjectPath(path);
      if (removingProjects.current.has(normalized))
        return "This project is already being removed.";
      removingProjects.current.add(normalized);
      try {
        if (options.purgeData) {
          // The project's terminal panel goes with it, even while hidden or
          // when another project is on screen. Ask only about terminals still
          // running something, as closing them by hand would; declining
          // keeps the project.
          const panelTerminals = projectPanelTerminals(
            projectTerminalsRef.current,
            normalized,
          );
          if (
            panelTerminals.length > 0 &&
            !(await confirmCloseTerminals(panelTerminals))
          )
            return "Its terminals were kept running.";
          const closingTerminals = new Set(
            panelTerminals.map((file) => file.id),
          );
          // A terminal opened while the deletion runs is new work.
          const hasProjectTerminals = () =>
            projectPanelTerminals(projectTerminalsRef.current, normalized).some(
              (file) => !closingTerminals.has(file.id),
            );
          const assertWorkspaceReady = () => {
            // A removal can leave an empty replacement chat. Keep any new
            // work or file panes opened while an earlier deletion awaited IO.
            const currentSessions = sessionsRef.current;
            const newWork = currentSessions.some((session) => {
              if (!sameProjectPath(session.cwd, normalized)) return false;
              const draft = readComposerDraft(session.id);
              return (
                session.blocks.length > 0 ||
                isInFlightSession(session) ||
                uncertainSessionAgents(session).length > 0 ||
                !!session.queuedMessages?.length ||
                !!draft?.text ||
                !!draft?.attachments.length ||
                !!session.composerSeed ||
                !!session.inboxCard ||
                !!session.noteCard ||
                !!session.handoffCard
              );
            });
            // Its board and race overviews are views, not work: they close
            // with the project below.
            const remainingFiles = openProjectFiles(
              tabsRef.current,
              currentSessions,
              normalized,
            );
            if (newWork || remainingFiles.length || hasProjectTerminals()) {
              throw new Error(
                "The project still has open work. Save and close its remaining tabs, then retry.",
              );
            }
          };
          await removeProjectData(normalized, {
            openSessionIds: sessionsRef.current
              .filter((session) => sameProjectPath(session.cwd, normalized))
              .map((session) => session.id),
            removeSession: (id) => onRemoveHistorySession(id, "delete", true),
            assertWorkspaceReady,
          });
          assertWorkspaceReady();
        }
        // Read current state only after all saves, process stops, and deletes.
        const wasCurrent = sameProjectPath(projectCwdRef.current, normalized);
        const remaining = options.purgeData
          ? forgetRecentProject(normalized)
          : archiveRecentProject(normalized);

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

        if (!options.purgeData) {
          for (const session of projectSessions) {
            if (
              isInFlightSession(session) ||
              uncertainSessionAgents(session).length
            )
              continue;
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
          return (
            !options.purgeData &&
            (isInFlightSession(session) ||
              uncertainSessionAgents(session).length > 0)
          );
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
        setActiveTabId(nextActiveTabId);
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
          const next = remaining.find(
            (item) =>
              looksLikeProject(item.path) &&
              profilesRef.current.projectProfile(item.path) ===
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
      } catch (error) {
        const reason = errorText(error);
        void message(`Could not delete this project.\n\n${reason}`, {
          title: "Aven",
          kind: "error",
        });
        return reason;
      } finally {
        removingProjects.current.delete(normalized);
      }
      return null;
    },
    [onRemoveHistorySession, onSelectProject, persistSession],
  );

  const onRestoreProject = useCallback(
    (path: string) => {
      rememberRecentProject(path);
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
      closeUtilityViews();
      setBrowserWorkspaces((all) => ({
        ...all,
        [cwd]: existing
          ? {
              ...selectBrowserTab(all[cwd] ?? EMPTY_BROWSER, id),
              open: true,
              mode: "tab",
              expanded: true,
            }
          : addRetainedBrowserTab(
              { ...(all[cwd] ?? EMPTY_BROWSER), mode: "tab" },
              { id, url },
            ),
      }));
      viewRef.current.focus(cwd, browserIdForTab(cwd, id));
      setComposerFocused(false);
    },
    [profileHome, onNewStandalone, setHomeViewOpen, closeUtilityViews],
  );

  const onOpenFile = useCallback<OpenFileFn>(
    (path, navigation, options) => {
      // A picture the user opens shows over their work, not as a tab.
      if (shouldOpenInImageViewer(path, navigation, options)) {
        const cwd = projectCwdRef.current;
        void resolveOpenablePath(gitCwdRef.current, path)
          .catch(() => undefined)
          .then((resolved) => {
            const target = resolved ?? path;
            rememberOpenedFile(cwd, target);
            openImageFile(target);
          });
        return;
      }
      const currentIntent = beginNavigation();
      clearReturnFocus();
      leaveExpandedPreview();
      const requestedCwd = projectCwdRef.current;
      const requestedTab = activeTabIdRef.current;
      const requestedProfile = profilesRef.current.activeProfileId;
      void (async () => {
        const resolved =
          (await resolveOpenablePath(gitCwdRef.current, path)) ?? path;
        if (
          !currentIntent() ||
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
          if (
            !currentIntent() ||
            profilesRef.current.activeProfileId !== profileId
          )
            return;
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
        closeUtilityViews();
        viewRef.current.focus(cwd, tab.id);
      })().catch((error) => {
        if (currentIntent())
          void message(String(error), {
            title: "Could not open file",
            kind: "error",
          });
      });
    },
    [profileHome, appendTab, clearReturnFocus, beginNavigation],
  );

  const onOpenImageInTab = useCallback(
    (path: string) => onOpenFile(path, undefined, { asTab: true }),
    [onOpenFile],
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
          focus: false,
        });
      }
    });
    rememberOpenedFile(cwd, path);
    // Preparing a task's editor never selects its chat, closes the user's
    // current view, or moves the caret out of another composer.
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

  const { onModelChange, onModelSettingsChange, onRuntimeModeChange } =
    useSessionModelControls({ sessionsRef, setSessions });

  const onSubmit = useCallback(
    (
      sessionId: string,
      text: string,
      attachments: Attachment[] = [],
      options?: {
        secondOpinion?: SecondOpinionMeta;
        /** Transcript text when the agent receives a framed prompt. */
        displayText?: string;
        discussion?: DiscussionRelayMeta;
        /** Another agent's words: no skill or @ expansion. */
        verbatim?: boolean;
        followUpBehavior?: FollowUpBehavior;
        noteCard?: NoteComposerCard;
        handoffCard?: HandoffComposerCard;
        queuedMessageId?: string;
        intent?: TurnIntent;
        planBlockId?: string;
        buildTarget?: PlanBuildTarget;
        managed?: boolean;
        /**
         * A turn a team sends its member, such as a race lane's task. Its
         * outcome is recorded quietly; the team announces itself.
         */
        teamMember?: ActivityTeam;
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
      flushHarnessEvents();
      const storedCurrent = sessionsRef.current.find((s) => s.id === sessionId);
      if (!storedCurrent) return false;
      if (isFinishingRaceCheckout(sessionWorkCwd(storedCurrent))) {
        enqueueHarnessEvent(sessionId, {
          type: "status",
          text: "Wait for the race to finish before continuing this chat.",
        });
        flushHarnessEvents();
        return false;
      }
      const current = options?.buildTarget
        ? withPlanBuildTarget(storedCurrent, options.buildTarget)
        : storedCurrent;
      const drivingRun = orchestrator.forSession(sessionId);
      const controlledTurn =
        !!options?.managed || orchestrationOwnsTurn(drivingRun);
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
      // A run's driven turns write for its lead: the lead chat reviews and
      // ships everything the run changed.
      const drivingLead = drivingRun
        ? sessionsRef.current.find(
            (session) => session.id === drivingRun.leadId,
          )
        : undefined;
      const changeOwner = turnChangeOwner({
        sessionId,
        workCwd,
        driven: controlledTurn,
        lead: drivingLead && {
          id: drivingLead.id,
          workCwd: sessionWorkCwd(drivingLead),
        },
      });
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
                      ...(options?.displayText !== undefined
                        ? { displayText: options.displayText }
                        : {}),
                      ...(options?.verbatim ? { verbatim: true } : {}),
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
            return appendSteerUser(
              next,
              options?.displayText ?? submittedText,
              visible,
              cards,
            );
          }),
        );
        const steeredGeneration = turnGen.current.get(sessionId);
        void (async () => {
          try {
            const prepared = await prepareAttachments(attachments);
            const prompt = options?.verbatim
              ? harnessText
              : await preparePrompt(harnessText, {
                  harness: current.harness,
                  sessionId,
                  cwd: workCwd,
                });
            const browserPrompt = rawCommand
              ? prompt
              : await prepareAgentBrowserPrompt(
                  prompt,
                  {
                    harness: current.harness,
                    title: current.title,
                    sessionId,
                    cwd: workCwd,
                  },
                  { worker: !!current.orchestrationLeadId },
                );
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
      const restartingAgents = stoppedAgentRuntimes.current.delete(sessionId);
      if (pendingSwitch || restartingAgents) {
        agentRuntimeEpoch.current.set(
          sessionId,
          (agentRuntimeEpoch.current.get(sessionId) ?? 0) + 1,
        );
      }
      const runtimeEpoch = agentRuntimeEpoch.current.get(sessionId) ?? 0;
      const activityTurnId = `${sessionId}:turn:${crypto.randomUUID()}`;
      activityTurnIds.current.set(sessionId, activityTurnId);
      raceLaneStarted(sessionId);
      if (options?.managed) quietActivityTurns.current?.add(activityTurnId);
      const member: ActivityTeam | undefined = options?.discussion
        ? { id: `discuss:${options.discussion.id}`, kind: "discuss" }
        : options?.teamMember;
      if (member) memberActivityTurns.current?.add(activityTurnId, member);
      failedActivityTurns.current.delete(sessionId);
      const proposalId =
        intent === "orchestrate" ? crypto.randomUUID() : undefined;
      if (proposalId) {
        proposalTurns.current.set(proposalId, activityTurnId);
        // Keep the map small: only recent plans are confirmed.
        if (proposalTurns.current.size > 50)
          proposalTurns.current.delete(
            proposalTurns.current.keys().next().value!,
          );
      }
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
          ? titleFromPrompt(
              options?.displayText ?? submittedText,
              current.harness,
              attachments,
            )
          : current.title;
      const visible = displayAttachments(attachments);
      const card =
        options?.secondOpinion ??
        (handoffCard ? handoffTurnCard(handoffCard) : undefined);
      const visibleText =
        options?.displayText ??
        (card?.kind === "handoff"
          ? submittedText
          : card
            ? SECOND_OPINION_TITLE
            : submittedText);
      const cards = {
        ...(rawCommand ? undefined : userTurnCards(noteCard, card)),
        ...(options?.discussion ? { discussion: options.discussion } : {}),
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
      let proposalStream:
        ReturnType<typeof createOrchestrationProposalStream> | undefined;
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
          try {
            await forgetHarnessSession(pendingSwitch.from, sessionId);
          } catch (error) {
            if (turnGen.current.get(sessionId) === gen) {
              const uncertain = sessionsRef.current.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      liveAgents: session.liveAgents?.map((agent) =>
                        ["running", "waiting", "unknown"].includes(agent.status)
                          ? {
                              ...agent,
                              status: "unknown" as const,
                              detail:
                                "Could not confirm the previous provider stopped",
                            }
                          : agent,
                      ),
                    }
                  : session,
              );
              sessionsRef.current = uncertain;
              setSessions(uncertain);
            }
            throw error;
          }
          if (turnGen.current.get(sessionId) !== gen) return;
          enqueueHarnessEvent(sessionId, { type: "agents.cleared" });
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

        const planEventKey = planTurnKey(gen);
        let nativePlanSeen = false;
        let providerFailureSeen = false;
        let failureSummary: string | undefined;
        if (proposalId && proposalDraft)
          proposalStream = createOrchestrationProposalStream(
            proposalId,
            proposalDraft,
          );
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
          const proposalEvent = proposalStream?.consume(event);
          if (
            proposalStream &&
            (event.type === "session.error" ||
              event.type === "message.completed" ||
              (event.type === "plan" && !event.streaming))
          ) {
            const stream = proposalStream;
            setSessions((prev) =>
              prev.map((session) =>
                session.id === sessionId
                  ? stream.recover(session, event)
                  : session,
              ),
            );
          }
          if (proposalEvent) return null;
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

        if (!current.inboxAsk && changeOwner) {
          await beginSessionTurn(changeOwner.sessionId, changeOwner.cwd).catch(
            () => undefined,
          );
        }
        if (turnGen.current.get(sessionId) !== gen) return;
        let buildSucceeded = false;
        let restoreNotes = () => {};
        try {
          const prepared = await prepareAttachments(attachments);
          const prompt =
            intent === "build" && approvedPlan
              ? buildPlanPrompt(approvedPlan.text)
              : options?.verbatim
                ? harnessText
                : await preparePrompt(harnessText, {
                    harness: current.harness,
                    sessionId,
                    cwd: workCwd,
                  });
          const browserPrompt = rawCommand
            ? prompt
            : await prepareAgentBrowserPrompt(
                prompt,
                {
                  harness: current.harness,
                  title: current.title,
                  sessionId,
                  cwd: workCwd,
                },
                { worker: !!current.orchestrationLeadId },
              );
          const turnPrompt = proposalDraft
            ? orchestrationPlanningPrompt(browserPrompt, proposalDraft.settings)
            : intent === "plan" && !rawCommand
              ? planTurnPrompt(browserPrompt)
              : browserPrompt;
          const earlier = queuedHandoff
            ? userMessagesAfterHandoff(current)
            : [];
          const projectMemory = await projectMemoryForTurn(current.cwd);
          const composed = orchestrator.prompt(
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
          );
          // What Aven did for this chat since its last turn (a Ship it
          // commit, the race version kept) rides ahead, hidden, once.
          const noted = rawCommand
            ? { text: composed, restore: () => {} }
            : takeTurnNotes(sessionId, composed);
          restoreNotes = noted.restore;
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
            projectMemory,
            text: noted.text,
            attachments: prepared,
            onEvent: (event) => {
              if (
                event.type === "agent.updated" ||
                event.type === "agents.cleared"
              ) {
                if (
                  !removingSessionIds.current.has(sessionId) &&
                  isCurrentSessionAgentSource(
                    sessionsRef.current.find(
                      (session) => session.id === sessionId,
                    ),
                    current.harness,
                    runtimeEpoch,
                    agentRuntimeEpoch.current.get(sessionId) ?? 0,
                  )
                )
                  enqueueHarnessEvent(sessionId, event);
                return;
              }
              if (
                turnGen.current.get(sessionId) !== gen ||
                removingSessionIds.current.has(sessionId) ||
                !isCurrentSessionAgentSource(
                  sessionsRef.current.find(
                    (session) => session.id === sessionId,
                  ),
                  current.harness,
                  runtimeEpoch,
                  agentRuntimeEpoch.current.get(sessionId) ?? 0,
                )
              )
                return;
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
              if (changeOwner)
                trackSessionEdits(
                  changeOwner.sessionId,
                  changeOwner.cwd,
                  event,
                );
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
          // The message never reached the agent: its notes wait for the next.
          restoreNotes();
          if (turnGen.current.get(sessionId) !== gen) return;
          if (wrap) revealHandoff(wrap.text);
          const message = failureText(
            error,
            `${current.harness} adapter failed`,
          );
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
          if (turnGen.current.get(sessionId) === gen) {
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
            const latest =
              turnGen.current.get(sessionId) === gen
                ? sessionsRef.current.find(
                    (session) => session.id === sessionId,
                  )
                : undefined;
            if (latest) {
              const stopped = stopStreaming(latest);
              const providerFailed =
                providerFailureSeen ||
                failedActivityTurns.current.get(sessionId) === activityTurnId ||
                !buildSucceeded ||
                isProviderFailureText(lastAssistantTextInTurn(stopped));
              let finalized =
                proposalStream && proposalId
                  ? withOrchestrationProposal(
                      stopped,
                      proposalId,
                      proposalStream.finish(
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
              if (!proposalStream && !providerFailed) {
                const blocks = adoptLateProposal(finalized.blocks);
                if (blocks !== finalized.blocks)
                  finalized = { ...finalized, blocks };
              }
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
              if (changeOwner && changeOwner.sessionId !== sessionId)
                notifyReviewChanged(changeOwner.sessionId);
              notifyGitChanged(workCwd);
              nudgeWorkspace(workCwd);
              nudgeWatchedFiles();
              window.setTimeout(() => nudgeWatchedFiles(), 150);
            }
          }
        }
      })()
        .catch((error: unknown) => {
          controlOutcome = {
            status: "failed",
            text: controlText,
            error: error instanceof Error ? error.message : String(error),
          };
          proposalStream?.finish(controlOutcome.error);
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
      return undefined;
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
          onSubmit(
            session.id,
            head.text,
            head.attachments,
            queuedSubmitOptions(head),
          );
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
    (
      sessionId: string,
      messageId: string,
      text: string,
      attachments: Attachment[],
    ) => {
      setSessions((prev) =>
        prev.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                queuedMessages: session.queuedMessages?.map((message) =>
                  message.id === messageId
                    ? {
                        ...message,
                        text,
                        attachments,
                        // Rewritten, it shows as you wrote it.
                        ...(text !== message.text
                          ? { displayText: undefined }
                          : {}),
                      }
                    : message,
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
        ...queuedSubmitOptions(message),
        followUpBehavior: "steer",
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
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        ...laneCheckout(source),
        title: formatSessionTitle(harness, SECOND_OPINION_TITLE),
      };
      openSessionBeside(sourceId, session, source.cwd);
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
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        ...laneCheckout(source),
        title: formatSessionTitle(
          harness,
          isUntitledChatTitle(display) ? HANDOFF_TITLE : display,
        ),
        handoffCard: buildHandoffComposerCard({
          from,
          to: harness,
          brief: buildDeterministicHandoff(sliced),
          userRequest,
          files,
        }),
      };
      openSessionBeside(sourceId, session, source.cwd, true);
    },
    [openSessionBeside],
  );

  /** Watch, Open, the sidebar connector: a discussion in its floating panel. */
  const openTeamPanel = teamWatch.open;
  const startedTeam = teamWatch.started;
  const onDiscussionStarted = useCallback(
    (id: string) => startedTeam(teamIdOf("discuss", id)),
    [startedTeam],
  );
  const openDiscussionView = useCallback(
    (id: string) => {
      if (discussionStore().get(id)) openTeamPanel(teamIdOf("discuss", id));
    },
    [openTeamPanel],
  );

  // Two chats discussing a topic, started by the user; relayed at turn end.
  const discussions = useDiscussionBroker({
    sessions,
    sessionsRef,
    onSubmit,
    postNote: (sessionId, text, wrapUp) => {
      enqueueHarnessEvent(sessionId, {
        type: "status",
        text,
        ...(wrapUp ? { discussionEnd: wrapUp } : {}),
      });
      flushHarnessEvents();
    },
    postReply: (sessionId, text, meta) => {
      enqueueHarnessEvent(sessionId, {
        type: "status",
        text,
        discussionReply: meta,
      });
      flushHarnessEvents();
    },
    recordWrapUp: (sessionId, wrapUp) => {
      flushHarnessEvents();
      setSessions((prev) => {
        const next = prev.map((session) =>
          session.id === sessionId
            ? captureDiscussionWrapUp(session, wrapUp)
            : session,
        );
        return next.some((session, index) => session !== prev[index])
          ? next
          : prev;
      });
    },
    // The new chat is not shown: the discussion plays out in the chat that
    // started it. It stays loaded without a tab while the discussion runs
    // (see the keep-alive in "Tabs are views") and is listed in the sidebar.
    openPartner: (sourceId, harness, model, title) => {
      const source = sessionsRef.current.find((entry) => entry.id === sourceId);
      if (!source) return undefined;
      const session = {
        ...newSession(harness, source.cwd, model, source.runtimeMode),
        ...laneCheckout(source),
        title: formatSessionTitle(harness, title),
      };
      const next = [...sessionsRef.current, session];
      sessionsRef.current = next;
      setSessions(next);
      return session.id;
    },
    openView: openDiscussionView,
    onStarted: onDiscussionStarted,
    // Its end is the team's own entry, "Discussion ended · N rounds" (see
    // teamActivity), posted once per ending.
    focusChat: (sessionId) => void onSelectHistorySession(sessionId),
    // A new partner has no tab: it is parked once the discussion ends, and
    // loaded again when the discussion continues or is asked to build.
    // An archived chat is never brought back to relay to: its discussion
    // paused when it was archived, and stays paused until it is unarchived.
    loadChat: (id) =>
      chatIsArchived(
        id,
        historyRef.current.find((row) => row.id === id)?.archived,
      )
        ? Promise.resolve(null)
        : ensureOpenSession(id),
  });

  // "Ask Codex to stop it" on a second dev server queues a message here.
  useDuplicateServerMessenger((sessionId, text) =>
    onSubmit(sessionId, text, [], { followUpBehavior: "queue" }),
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
      if (stoppedAgentRuntimes.current.delete(sessionId)) {
        agentRuntimeEpoch.current.set(
          sessionId,
          (agentRuntimeEpoch.current.get(sessionId) ?? 0) + 1,
        );
      }
      const runtimeEpoch = agentRuntimeEpoch.current.get(sessionId) ?? 0;
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
              if (
                event.type === "agent.updated" ||
                event.type === "agents.cleared"
              ) {
                if (
                  !removingSessionIds.current.has(sessionId) &&
                  isCurrentSessionAgentSource(
                    sessionsRef.current.find(
                      (session) => session.id === sessionId,
                    ),
                    current.harness,
                    runtimeEpoch,
                    agentRuntimeEpoch.current.get(sessionId) ?? 0,
                  )
                )
                  enqueueHarnessEvent(sessionId, event);
                return;
              }
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
            message: failureText(
              error,
              `${current.harness} could not compact this context`,
            ),
          });
        } finally {
          if (turnGen.current.get(sessionId) === gen) {
            flushHarnessEvents();
            const finished = sessionsRef.current.map((session) =>
              session.id === sessionId
                ? { ...session, busy: false, waitingOn: undefined }
                : session,
            );
            sessionsRef.current = finished;
            syncDockBadge(finished);
            setSessions(finished);
          }
        }
      })();
      return true;
    },
    [enqueueHarnessEvent, flushHarnessEvents],
  );

  const onStop = useCallback(
    (sessionId: string, managed = false) => {
      if (!managed) {
        const run = orchestrator.forSession(sessionId);
        const managedWorkers = new Set(
          run?.tasks
            .filter(
              (task) =>
                task.status === "running" || task.status === "cancelling",
            )
            .map((task) => task.sessionId) ?? [],
        );
        // The orchestrator stops active assignments. A finished assignment
        // may still own native children, so stop those runtimes as well.
        for (const workerId of backgroundWorkerIdsForStop(
          sessionsRef.current,
          sessionId,
          managedWorkers,
        ))
          onStop(workerId, true);
        const stopping = orchestrator.stopForSession(sessionId);
        if (stopping) {
          if (run?.leadId !== sessionId && !managedWorkers.has(sessionId)) {
            // Closing a completed worker's task only updates orchestration
            // history; it does not ask the provider to stop its child agents.
            const worker = sessionsRef.current.find(
              (entry) => entry.id === sessionId,
            );
            if (
              worker &&
              (activeSessionAgents(worker).length ||
                uncertainSessionAgents(worker).length)
            )
              onStop(sessionId, true);
          }
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
      const hasBackground =
        session &&
        (activeSessionAgents(session).length > 0 ||
          uncertainSessionAgents(session).length > 0);
      const stopEpoch =
        (agentRuntimeEpoch.current.get(sessionId) ?? 0) +
        (hasBackground ? 1 : 0);
      if (hasBackground) {
        agentRuntimeEpoch.current.set(sessionId, stopEpoch);
        stoppedAgentRuntimes.current.add(sessionId);
      }
      if (session) {
        if (hasBackground) {
          // Interrupting only the lead does not reliably stop detached workers.
          // Keep their rows until the process confirms it stopped.
          void Promise.all(
            sessionChildHarnesses(session).map((id) =>
              stopHarnessSession(id, sessionId),
            ),
          ).then(
            () => settleStoppedAgents("stopped"),
            () => settleStoppedAgents("unknown"),
          );
        } else {
          for (const id of sessionChildHarnesses(session)) {
            void cancelHarnessTurn(id, sessionId).catch(console.error);
          }
        }
      }
      function settleStoppedAgents(status: "stopped" | "unknown") {
        if (agentRuntimeEpoch.current.get(sessionId) !== stopEpoch) return;
        const next = sessionsRef.current.map((entry) =>
          entry.id !== sessionId
            ? entry
            : {
                ...entry,
                liveAgents: entry.liveAgents?.map((agent) =>
                  ["running", "waiting", "unknown"].includes(agent.status)
                    ? {
                        ...agent,
                        status,
                        detail:
                          status === "unknown"
                            ? "Could not confirm the agent process stopped"
                            : "Stopped with this chat",
                      }
                    : agent,
                ),
              },
        );
        sessionsRef.current = next;
        syncDockBadge(next);
        setSessions(next);
      }
      const stoppedSessions = sessionsRef.current.map<Session>((s) => {
        if (s.id !== sessionId) return s;
        const stopped = stopStreaming(s);
        const completed = isPreparingHandoff(stopped)
          ? completeHandoff(stopped, buildDeterministicHandoff(stopped))
          : stopped;
        return completed.queuedMessages?.length
          ? { ...completed, queueStatus: "paused" }
          : completed;
      });
      sessionsRef.current = stoppedSessions;
      syncDockBadge(stoppedSessions);
      setSessions(stoppedSessions);
      if (session) {
        if (isInFlightSession(session)) {
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
        notifyGitChanged(sessionWorkCwd(session));
        nudgeWatchedFiles();
        window.setTimeout(() => nudgeWatchedFiles(), 150);
      } else {
        notifyReviewChanged(sessionId);
      }
    },
    [flushHarnessEvents, announceActivity],
  );
  stopSessionRef.current = onStop;

  // Tell a restart to update, here or in another window, what work it would
  // interrupt. Only a changed summary is sent.
  useEffect(() => {
    reportWorkspaceActivity();
  }, [sessions, tabs, dirtyFiles]);
  useEffect(() => listenForUpdateWindowClose(), []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (!workspaceVisibleRef.current || hasWorkspaceOverlay()) return;
      const target = event.target instanceof Element ? event.target : null;
      const inTerminal = Boolean(target?.closest(".aven-terminal"));
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
      deliverApproval(session, requestId, decision);
    },
    [],
  );

  const onQuestionReply = useCallback(
    (sessionId: string, requestId: number, reply: UserQuestionReply) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      if (!session) return;
      answerQuestion(session, requestId, reply, {
        close: (id) =>
          enqueueHarnessEvent(sessionId, {
            type: "question.resolved",
            requestId: id,
            decision: "cancelled",
          }),
        send: (text) =>
          onSubmit(sessionId, text, [], { followUpBehavior: "queue" }) !==
          false,
        note: (text) => {
          enqueueHarnessEvent(sessionId, { type: "status", text });
          flushHarnessEvents();
        },
      });
    },
    [enqueueHarnessEvent, flushHarnessEvents, onSubmit],
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
        const session = await ensureOpenSession(sessionId);
        if (!session || session.inboxAsk) return false;
        flushSync(() => {
          profilesRef.current.selectProjectProfile(session.cwd);
          setProjectCwd(session.cwd);
          setHomeViewOpen(false);
          closeUtilityViews();
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

  const ensureOpenSessionRef = useRef(ensureOpenSession);
  ensureOpenSessionRef.current = ensureOpenSession;
  useLayoutEffect(() => {
    orchestrator.bind({
      session: (id) => sessionsRef.current.find((session) => session.id === id),
      sessions: () => sessionsRef.current,
      load: (id) => ensureOpenSessionRef.current(id),
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
        if (!lead) throw new Error("The lead's chat isn't open.");
        if (existing) {
          if (
            existing.harness !== task.harness ||
            existing.model !== task.model ||
            existing.cwd !== run.cwd
          )
            throw new Error(
              "This agent's model or project changed after the plan was confirmed. Start a new plan.",
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
            "This agent's model changed after the plan was confirmed. Start a new plan.",
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
            worker.blocks,
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
        if (session) deliverApproval(session, requestId, decision);
      },
      answerQuestion: (id, requestId, reply) => {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (!session) return false;
        if (deliverQuestionReply(session, requestId, reply)) return true;
        // Nothing waits on it any more: never leave the card up.
        enqueueHarnessEvent(id, {
          type: "question.resolved",
          requestId,
          decision: "cancelled",
        });
        return false;
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
  }, [onSubmit, onStop, enqueueHarnessEvent]);

  useEffect(() => {
    orchestrator.sync();
  }, [sessions]);

  // Another window opened a paused run's lead and now holds the run. The
  // host tells only this window, so only this page listens.
  useEffect(() => {
    if (!isTauri()) return;
    const listening = getCurrentWebview().listen<string>(
      "control-run-released",
      ({ payload }) => {
        if (typeof payload === "string") orchestrator.release(payload);
      },
    );
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);

  // A race or discussion whose window closed, or was from an earlier
  // launch, would be announced by no window: the main window takes it over
  // at start-up and whenever a workspace window closes.
  useEffect(() => {
    if (!isTauri() || currentWindowLabel() !== "main") return;
    const adopt = (closed?: string) =>
      void invoke<string[]>("workspace_window_labels")
        .then((labels) => {
          const open = new Set(labels);
          if (closed) open.delete(closed);
          adoptOrphanRaces("main", open);
          discussionStore().adoptOrphans(open);
        })
        .catch((error) => logError("Couldn't check open windows", error));
    adopt();
    const listening = getCurrentWebview().listen<string>(
      "aven-workspace-closed",
      ({ payload }) => adopt(typeof payload === "string" ? payload : undefined),
    );
    return () => {
      void listening.then((unlisten) => unlisten());
    };
  }, []);

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
        // Only now may a finished lead's control access go.
        .finally(() => orchestrator.replied(payload.sessionId))
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
  const workerAgentRows = useRef<ReturnType<typeof workerAgentsByLead>>(
    new Map(),
  );
  const agentsByLead = useMemo(() => {
    workerAgentRows.current = workerAgentsByLead(
      sessions,
      workerAgentRows.current,
    );
    return workerAgentRows.current;
  }, [sessions]);
  const orchestrationWorkers = useMemo(
    () => ({
      selectedId: inspectedWorkerId,
      inspect: setInspectedWorkerId,
      openDetails: onOpenWorkerDetails,
      agentsByLead,
    }),
    [inspectedWorkerId, onOpenWorkerDetails, agentsByLead],
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
      title: (sessionId: string) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === sessionId,
        );
        return session
          ? sessionDisplayTitle(session.title, session.harness)
          : undefined;
      },
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
          latestProposalId(session.blocks) !== blockId ||
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
          // An older card describes a plan the lead has since replaced.
          if (latestProposalId(session.blocks) !== blockId)
            throw new Error(
              "Replaced by a newer plan. Confirm the newest plan in this chat instead.",
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
          // The turn that wrote the plan is the run's start now, not news of
          // its own: the run posts one entry when it finishes or pauses.
          const planning = proposalTurns.current.get(blockId);
          if (planning) {
            quietActivityTurns.current?.add(planning);
            retractActivityTurn(planning);
          }
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
      discard: (leadId: string, blockId: string) => {
        const session = sessionsRef.current.find(
          (entry) => entry.id === leadId,
        );
        const proposal = session?.blocks.find(
          (block) => block.id === blockId,
        )?.orchestration;
        if (
          !session ||
          proposal?.status !== "ready" ||
          confirmingOrchestration.current.has(leadId)
        )
          return;
        const discarded = updateOrchestrationCard(leadId, blockId, {
          ...proposal,
          status: "discarded",
        });
        if (discarded) void upsertSession(discarded).catch(console.error);
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
      closeUtilityViews();
      return onOpenApprovalSession(sessionId);
    },
    [onOpenApprovalSession, closeUtilityViews],
  );

  const nextTitleTabs: TitleTab[] = deckProjectTabs.map((tab) =>
    toTitleTab(tab, sessions, dirtyFiles, leadDecided),
  );
  tabProjectsRef.current = new Map(
    nextTitleTabs.map((tab) => [tab.id, tab.project]),
  );
  const titleTabsRef = useRef(nextTitleTabs);
  if (!titleTabsEqual(titleTabsRef.current, nextTitleTabs)) {
    titleTabsRef.current = nextTitleTabs;
  }
  const titleTabs = titleTabsRef.current;
  const restoreStatus = hiddenSplitStatus(view, titleTabs);

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
    // Pinning a peeked sidebar keeps it on screen. Dismissing first would start
    // its slide out; the pin itself ends the peek without closing it.
    if (!sidebarHover.revealed) sidebarHover.dismiss();
    setSidebarOpen((open) => {
      savePersonalSidebar(!open);
      return !open;
    });
  }, [sidebarHover.revealed, sidebarHover.dismiss]);
  const onToggleProjectRail = onToggleSidebar;

  const onGoToFile = useCallback(() => {
    if (profileHome) {
      openWorkspaceAction("create");
      return;
    }
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setAutomationsViewOpen(false);
    setNotesViewOpen(false);
    setFilePickerOpen(true);
  }, [
    profileHome,
    openWorkspaceAction,
    setSearchViewOpen,
    setInboxViewOpen,
    setAutomationsViewOpen,
    setNotesViewOpen,
    setFilePickerOpen,
  ]);

  const onFindInProject = useCallback(() => {
    closeUtilityViews();
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const onOpenPalette = useCallback(() => {
    setFilePickerOpen(false);
    setPaletteQuery("");
    setPaletteOpen(true);
  }, [setFilePickerOpen]);

  const onOpenArchivedSession = useCallback(
    (sessionId: string) => {
      setSettingsOpen(false);
      void onSelectHistorySession(sessionId);
    },
    [onSelectHistorySession, setSettingsOpen],
  );
  // "Open chat" on another copy in the Changes panel.
  useEffect(
    () =>
      subscribeOpenChatRequests((sessionId) => {
        void onSelectHistorySession(sessionId);
      }),
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

  const workspaceActions: WorkspaceActions = {
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
    onOpenPalette,
    onOpenInbox,
    onOpenAutomations,
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
    workspaceActions.onArchiveFocusedSession = () => undefined;
    workspaceActions.onCloseOtherTabs = () => undefined;
    workspaceActions.onClosePane = () => undefined;
    workspaceActions.onSplit = () => undefined;
    workspaceActions.onFocusDir = () => undefined;
    workspaceActions.onNavigateSessionList = () => undefined;
    workspaceActions.onNewTerminal = () => openWorkspaceAction("create");
    workspaceActions.onNewTerminalTab = () => openWorkspaceAction("create");
    workspaceActions.onToggleProjectTerminal = () =>
      openWorkspaceAction("create");
    workspaceActions.onFindInProject = () => openWorkspaceAction("create");
  }
  if (workspaceVisible && browserExpanded) {
    workspaceActions.onClosePane = () => onCloseBrowserTab(view.focusedId);
  }

  const actions = useWorkspaceShortcuts({
    actions: workspaceActions,
    utilityViews: {
      settingsOpenRef,
      searchViewOpenRef,
      inboxViewOpenRef,
      automationsViewOpenRef,
      notesViewOpenRef,
      filePickerOpenRef,
      closeUtilityViews,
      restoreReturnFocus,
    },
    workspaceVisibleRef,
    whatsNewVersionRef,
    sessionsRef,
  });

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
    onRace: onRaceFromChat,
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
    discussion: discussions.host,
    onNewTerminal: onNewTerminalInSession,
  };

  const mergeDetachedState = useCallback(
    (state: DetachedWorkspaceState, returning: boolean) => {
      const ids = new Set(
        state.originalSurfaceIds ?? [
          ...state.tabs.map((tab) => tab.id),
          ...state.browsers.map((tab) => tab.id),
        ],
      );
      const closed = new Set(state.closedSurfaceIds ?? []);
      const closedFileIds = new Set<string>();
      // Detached close prompts have already completed. Keep the last known
      // descriptors before removing them, just like closes in the main window.
      for (const tab of tabsRef.current) {
        if (!closed.has(tab.id)) continue;
        rememberClosed({
          kind: "tab",
          cwd: workspaceTabCwd(tab, sessionsRef.current) || state.cwd,
          closedAt: Date.now(),
          tab,
          sessionStubs: collectWorkspaceSnapshot(
            [tab],
            sessionsRef.current,
            tab.id,
            state.cwd,
          ).sessions.map(({ draft: _draft, ...stub }) => stub),
        });
        for (const pane of [...tab.editorPanes, ...tab.terminalPanes])
          for (const file of pane.files) closedFileIds.add(file.id);
      }
      for (const [cwd, value] of Object.entries(browserWorkspacesRef.current)) {
        for (const browser of normalizeBrowserWorkspace(value).tabs) {
          if (!closed.has(browserIdForTab(cwd, browser.id))) continue;
          rememberClosed({
            kind: "browser",
            cwd,
            closedAt: Date.now(),
            browser,
          });
        }
      }
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
                kept: page.kept,
              })
            : addBrowserTab(current, {
                id: page.tabId,
                url: page.url,
                title: page.title,
                favicon: page.favicon,
                kept: page.kept,
              });
        }
        browserWorkspacesRef.current = next;
        return next;
      });
      setDirtyFiles((current) => {
        const next = new Set(current);
        for (const id of closedFileIds) next.delete(id);
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
      closeUtilityViews();
      profilesRef.current.selectProfile(
        profilesRef.current.projectProfile(cwd),
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
    leadDecided,
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
  detachedFocusBrowser.current = detached.focusBrowser;
  externallyRenderedSessionIds.current = new Set(detached.detachedSessionIds);
  detachedFileBridge.current = detached.openFileForSession;
  detachedShowSurface.current = async (surfaceId, paneId) => {
    const window = detached.snapshots.find(
      (entry) =>
        entry.state.tabs.some((tab) => tab.id === surfaceId) ||
        entry.state.browsers.some((tab) => tab.id === surfaceId),
    );
    if (!window) return false;
    try {
      // The detached protocol can focus chats; editor/terminal panes keep the
      // existing show-window behavior instead of being sent as session IDs.
      if (
        paneId &&
        window.state.sessions.some((entry) => entry.session.id === paneId)
      ) {
        if (await detached.showSession(paneId)) return true;
      }
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
  const profileSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          (isProjectlessCwd(session.cwd) &&
            projectWorkspaceProfile(
              { profiles: profiles.profiles, projectProfiles: {} },
              session.cwd,
            ) === profiles.activeProfileId) ||
          profiles.profileProjects.some((project) =>
            sameProjectPath(project.path, session.cwd),
          ),
      ),
    [
      profiles.profiles,
      profiles.profileProjects,
      profiles.activeProfileId,
      sessions,
    ],
  );
  const browserSurfaceActions = useRef<BrowserSurfaceActions>(null!);
  browserSurfaceActions.current = {
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
    openTab: (project, id, url, background) => {
      if (project !== projectCwd) return;
      const tab = { id: crypto.randomUUID(), url };
      // Like the pane's own new-tab button: the link's page owns the new tab.
      workspaceViews.change((view) => selectWorkspaceView(view, id));
      if (!background) setHomeViewOpen(false);
      setBrowserWorkspaces((all) => {
        const current = all[project] ?? EMPTY_BROWSER;
        return {
          ...all,
          [project]: background
            ? addBackgroundBrowserTab(current, tab)
            : addRetainedBrowserTab({ ...current, mode: "tab" }, tab),
        };
      });
    },
    addToChat: (text, attachments) => {
      workspaceViews.change((view) => selectWorkspaceView(view, activeTabId));
      activateTab(activeTabId);
      requestAnimationFrame(() => requestAddToChat(text, "plain", attachments));
    },
  };

  const labelsForPalette = paletteOpen ? loadTabGroupLabels() : null;
  const paletteProjects = labelsForPalette
    ? profiles.profileProjects.map((project) => ({
        path: project.path,
        name: projectDisplayName(project.path, labelsForPalette),
      }))
    : [];
  const paletteChats: PaletteChat[] = paletteOpen
    ? conversationRowsFrom(
        history,
        sessions.filter((session) => !session.inboxAsk),
      ).map((row) => ({ ...row, busy: busySessionIds.has(row.id) }))
    : [];
  const paletteAgents = paletteOpen ? availablePaletteAgents() : [];
  const boardProject =
    looksLikeProject(projectCwd) && !isProjectlessCwd(projectCwd)
      ? projectCwd
      : null;
  const paletteCommands = [
    ...PALETTE_COMMANDS.filter(
      (command) =>
        (command.id !== "open_notes" || notesEnabled) &&
        (command.id !== "open_board" || boardProject),
    ).map((command) =>
      command.id === "open_board" && boardProject && labelsForPalette
        ? {
            ...command,
            label: `Open board for ${projectDisplayName(boardProject, labelsForPalette)}`,
          }
        : command,
    ),
    ...DEV_PALETTE_COMMANDS,
  ];
  const runPaletteCommand = (id: PaletteCommandId) => {
    // Development builds only; release builds drop this branch entirely.
    if (import.meta.env.DEV && id.startsWith("preview_restart_")) {
      previewUpdateRestart(
        id.slice("preview_restart_".length) as UpdateRestartPreview,
      );
      return;
    }
    const run = actions.current;
    const table: Record<
      Exclude<PaletteCommandId, DevPaletteCommandId>,
      () => void
    > = {
      new_chat: () => void run.onNew(),
      new_terminal: run.onNewTerminal,
      new_browser_tab: onNewBrowserTab,
      open_board: () => onOpenBoard(),
      open_search: run.onOpenSearch,
      go_to_file: run.onGoToFile,
      find_in_project: run.onFindInProject,
      toggle_sidebar: run.onToggleSidebar,
      toggle_inspector: run.onToggleInspector,
      toggle_terminal: run.onToggleProjectTerminal,
      split_right: () => run.onSplit("right"),
      split_down: () => run.onSplit("down"),
      reopen_closed_tab: run.onReopenClosedTab,
      close_pane: run.onClosePane,
      open_inbox: run.onOpenInbox,
      open_automations: run.onOpenAutomations,
      new_scheduled_agent: () => {
        // Taken by the Automations view when it mounts, or at once if open.
        requestScheduleEditor();
        run.onOpenAutomations();
      },
      open_notes: run.onOpenNotes,
      add_project: () => void run.pickProject(),
      open_settings: () => run.openSettings(),
    };
    table[id as Exclude<PaletteCommandId, DevPaletteCommandId>]?.();
  };
  const startPaletteChat = (request: PaletteChatRequest) => {
    const session = newSession(
      request.agent.harness,
      request.project,
      request.agent.model,
      loadDefaultRuntimeMode(),
    );
    const tab = newTab(session.id);
    setSessions((previous) => [...previous, session]);
    appendTab(tab, request.project);
    if (!request.background) {
      setHomeViewOpen(false);
      leaveExpandedPreview();
      closeUtilityViews();
      if (!sameProjectPath(request.project, projectCwdRef.current)) {
        revealProjectTask(request.project);
        setProjectCwd(request.project);
        rememberRecentProject(request.project);
      }
      setActiveTabId(tab.id);
    }
    onSubmit(session.id, request.text, []);
  };

  const startRace = async (request: PaletteRaceRequest): Promise<boolean> => {
    const raceId = crypto.randomUUID();
    let base: RaceBase;
    try {
      base = await raceHost.prepare(request.project);
    } catch (error) {
      void message(String(error), {
        title: "Can't start a race",
        kind: "error",
      });
      return false;
    }
    let created: { path: string; branch: string }[];
    try {
      created = await createRaceLanes(base, raceId, request.agents.length);
    } catch (error) {
      void message(String(error), {
        title: "Can't start a race",
        kind: "error",
      });
      return false;
    }
    const runtimeMode = request.runtimeMode ?? loadDefaultRuntimeMode();
    // Each lane's chat is named for the task and its agent: "Reset button ·
    // Codex", the model only where two of one app race.
    const laneNames = raceAgentNames(request.agents);
    const taskWords = raceTaskWords(request.text);
    const laneSessions: Session[] = request.agents.map((agent, index) => ({
      ...newSession(
        agent.harness,
        request.project,
        agent.model,
        runtimeMode,
        index === 0 ? request.modelSettings : undefined,
      ),
      worktreeCwd: created[index].path,
      title: raceLaneTitle(agent.harness, taskWords, laneNames[index]),
    }));
    // Sent from a chat: your message stays there, followed by the race's
    // card, and you stay in that chat while the agents work.
    const origin = request.origin
      ? sessionsRef.current.find((session) => session.id === request.origin)
      : undefined;
    const startedAt = Date.now();
    const originBlock = origin
      ? raceOriginBlock(raceId, request.text, request.attachments, startedAt)
      : undefined;
    saveRace({
      id: raceId,
      project: request.project,
      root: base.root,
      base: base.base,
      prompt: request.text,
      createdAt: startedAt,
      uncommitted: base.uncommitted,
      untracked: base.untracked,
      state: "running",
      lanes: raceLaneRecords(
        request.agents,
        laneSessions.map((session) => session.id),
        created,
      ),
      // Every lane starts at once; this window posts the race's notices.
      ends: laneSessions.map(() => null),
      window: currentWindowLabel(),
      ...(origin && originBlock
        ? { origin: { sessionId: origin.id, blockId: originBlock.id } }
        : {}),
    });
    const laneTab: WorkspaceTab = {
      ...newTab(laneSessions[0].id),
      layout: {
        type: "split",
        id: crypto.randomUUID(),
        dir: "right",
        children: laneSessions.map((session) => leaf(session.id)),
        sizes: laneSessions.map(() => 1 / laneSessions.length),
      },
    };
    // The overview opens on request (Compare), so the agents get the room.
    const withLanes = [
      ...sessionsRef.current.map((session) =>
        originBlock && session.id === origin?.id
          ? { ...session, blocks: [...session.blocks, originBlock] }
          : session,
      ),
      ...laneSessions,
    ];
    sessionsRef.current = withLanes;
    setSessions(withLanes);
    appendTab(laneTab, request.project);
    if (!origin) {
      setHomeViewOpen(false);
      leaveExpandedPreview();
      closeUtilityViews();
      if (!sameProjectPath(request.project, projectCwdRef.current)) {
        revealProjectTask(request.project);
        setProjectCwd(request.project);
        rememberRecentProject(request.project);
      }
      setActiveTabId(laneTab.id);
    }
    const prompt = racePrompt(request.text, laneSessions.length);
    for (const session of laneSessions)
      onSubmit(session.id, prompt, request.attachments ?? [], {
        teamMember: { id: `race:${raceId}`, kind: "race" },
      });
    // Then the task's words as a new chat gets them, once for every lane.
    const [first] = laneSessions;
    if (first && request.text.trim())
      void generateHarnessTitle(first.harness, {
        sessionId: first.id,
        cwd: created[0].path,
        message: request.text,
      })
        .then((title) => {
          const words = title?.trim();
          if (!words) return;
          setSessions((prev) =>
            prev.map((session) => {
              const index = laneSessions.findIndex(
                (lane) => lane.id === session.id,
              );
              // A title the user changed meanwhile stays.
              if (index < 0 || session.title !== laneSessions[index].title)
                return session;
              return {
                ...session,
                title: raceLaneTitle(session.harness, words, laneNames[index]),
              };
            }),
          );
        })
        .catch(() => undefined);
    return true;
  };
  startRaceRef.current = startRace;
  /** Opens behind the user: no tab, project or focus change. */
  const startScheduledAgent = async (agent: ScheduledAgent) => {
    const run = {
      id: crypto.randomUUID(),
      scheduleId: agent.id,
      name: agent.name,
      project: agent.project,
      summary: "",
      startedAt: Date.now(),
    };
    const problem = await scheduledAgentProblem(agent);
    if (problem) {
      saveScheduledRun({
        ...run,
        status: "failed",
        error: problem,
        finishedAt: Date.now(),
      });
      return;
    }
    const session: Session = {
      ...newSession(
        agent.harness,
        agent.project,
        agent.model,
        agent.runtimeMode,
      ),
      title: `Scheduled · ${agent.name}`,
    };
    setSessions((previous) => [...previous, session]);
    appendTab(newTab(session.id), agent.project);
    saveScheduledRun({ ...run, sessionId: session.id, status: "running" });
    submitManagedTurn(
      (settle) => onSubmit(session.id, agent.prompt, [], { onSettled: settle }),
      (outcome) => {
        if (!getScheduledRun(run.id)) return;
        const finished = sessionsRef.current.find(
          (item) => item.id === session.id,
        );
        updateScheduledRun(run.id, {
          status: outcome.status,
          summary: runSummary(
            finalAssistantText(finished?.blocks ?? []) || outcome.text,
          ),
          error: outcome.error,
          finishedAt: Date.now(),
        });
      },
    );
  };
  startScheduledAgentRef.current = (agent) => void startScheduledAgent(agent);
  /** The race's overview tab, opened or brought forward in its project. */
  const showRaceOverview = (raceId: string) => {
    const race = getRace(raceId);
    if (!race) return;
    flushSync(() => {
      setHomeViewOpen(false);
      closeUtilityViews();
      leaveExpandedPreview();
      if (!sameProjectPath(race.project, projectCwdRef.current)) {
        revealProjectTask(race.project);
        setProjectCwd(race.project);
      }
    });
    const existing = tabsRef.current.find((entry) =>
      entry.editorPanes.some((pane) =>
        pane.files.some((file) => file.race?.raceId === race.id),
      ),
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const overview = newRaceWorkspaceTab(
      race.id,
      "Race overview",
      race.project,
    );
    appendTab(overview, race.project);
    setActiveTabId(overview.id);
  };
  /**
   * The project's board (the current project unless named), opened as a
   * workspace tab, or brought forward when one is already open.
   */
  const openBoard = (path?: string) => {
    const project = normalizeProjectPath(path ?? projectCwdRef.current);
    if (!looksLikeProject(project) || isProjectlessCwd(project)) return;
    flushSync(() => {
      setHomeViewOpen(false);
      closeUtilityViews();
      leaveExpandedPreview();
      if (!sameProjectPath(project, projectCwdRef.current)) {
        revealProjectTask(project);
        profilesRef.current.selectProjectProfile(project);
        setProjectCwd(project);
      }
    });
    setComposerFocused(false);
    const existing = boardTabFor(tabsRef.current, project, sameProjectPath);
    if (existing) {
      activateTab(existing.id);
      return;
    }
    const board = newBoardWorkspaceTab(project);
    appendTab(board, project);
    viewRef.current.focus(project, board.id);
    setActiveTabId(board.id);
  };
  const openBoardRef = useRef(openBoard);
  openBoardRef.current = openBoard;
  const onOpenBoard = useCallback(
    (path?: string) => openBoardRef.current(path),
    [],
  );
  const onOpenDiffRef = useRef(onOpenDiff);
  onOpenDiffRef.current = onOpenDiff;
  const onOpenCommitRef = useRef(onOpenCommit);
  onOpenCommitRef.current = onOpenCommit;
  /** Open a chat, then run `then` once its tab is the active one. */
  const inChat = (sessionId: string, then: () => void) =>
    void onOpenApprovalSession(sessionId).then((opened) => {
      if (opened) requestAnimationFrame(then);
    });
  boardActionsRef.current = {
    openChat: (id) => void onOpenApprovalSession(id),
    allow: (id, requestId) => onApproval(id, requestId, "allow"),
    review: (id, cwd) =>
      inChat(id, () =>
        onOpenDiffRef.current(undefined, { sessionId: id, cwd }),
      ),
    ship: (id, cwd) => {
      // A chat in the project's own folder ships from beside the board; one
      // in another copy opens first, so the Changes panel shows its copy.
      if (sameProjectPath(cwd, sidebarCwdRef.current)) requestShip(cwd, id);
      else inChat(id, () => requestShip(cwd, id));
    },
    watch: (teamId) => openTeamPanel(teamId),
    compare: (raceId) => showRaceOverview(raceId),
    preview: (key) => void openDevPreview(key),
    openCommit: (id, _cwd, commit) =>
      inChat(id, () =>
        onOpenCommitRef.current({
          ...commit,
          parents: [],
          author: "",
          timestamp: 0,
          refs: [],
          head: false,
        }),
      ),
    openUrl: (url) => void openInAppUrl(url),
    // Behind the board, with the default agent and model, as Getting
    // started's first message would be if it were sent.
    build: (project, text) => {
      const session = newDefaultSession(project);
      setSessions((previous) => [...previous, session]);
      appendTab(newTab(session.id), project);
      onSubmit(session.id, text, []);
      return session.id;
    },
    draft: (project, text) => startProjectChat(project, text),
  };
  /**
   * Add to board, from a chat's menu: a card per chat on its project's
   * board, in the column its state implies; then the board comes forward.
   */
  addToBoardRef.current = (sessionIds) => {
    const drafts = chatCardDrafts(
      sessionIds.flatMap((id) => {
        const chat =
          sessionsRef.current.find((session) => session.id === id) ??
          historyRef.current.find((row) => row.id === id);
        return chat ? [chat] : [];
      }),
      chatStatusRef.current,
    );
    for (const [project, cards] of drafts) void addChatsToBoard(project, cards);
    const first = drafts.keys().next().value;
    if (first) openBoardRef.current(first);
  };
  const openRaceOverview = (tabId: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId);
    const race = tab
      ? leafIds(tab.layout)
          .map((id) => raceLaneFor(id)?.race)
          .find((entry) => entry != null)
      : undefined;
    if (race) showRaceOverview(race.id);
  };
  raceActionsRef.current = {
    stop: (ids) => {
      for (const id of ids)
        if (sessionsRef.current.find((session) => session.id === id)?.busy)
          onStop(id);
    },
    settle: async (race) => {
      const affected = sessionsRef.current.filter((session) =>
        usesRaceCheckout(session, race),
      );
      const ids = new Set(affected.map((session) => session.id));
      // A queued follow-up must not restart a lane while its copy is removed.
      const paused = sessionsRef.current.map((session) =>
        ids.has(session.id) && session.queuedMessages?.length
          ? { ...session, queueStatus: "paused" as const }
          : session,
      );
      sessionsRef.current = paused;
      setSessions(paused);
      const settled = await Promise.allSettled(
        affected.map(async (session) => {
          await stopSessionForRemoval(session.id);
          // Idle providers also remember their old cwd. Await their teardown,
          // including pending provider switches, before native worktree cleanup.
          await Promise.all(
            sessionChildHarnesses(session).map((harness) =>
              forgetHarnessSession(harness, session.id),
            ),
          );
        }),
      );
      flushHarnessEvents();
      const stoppedIds = new Set(
        affected
          .filter((_, index) => settled[index].status === "fulfilled")
          .map((session) => session.id),
      );
      const stopped = sessionsRef.current.map((session) =>
        stoppedIds.has(session.id)
          ? {
              ...stopStreaming(session),
              liveAgents: session.liveAgents?.map((agent) =>
                ["running", "waiting", "unknown"].includes(agent.status)
                  ? {
                      ...agent,
                      status: "stopped" as const,
                      detail: "Stopped when the race finished",
                    }
                  : agent,
              ),
            }
          : session,
      );
      sessionsRef.current = stopped;
      setSessions(stopped);
      const failure = settled.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    },
    release: async (race) => {
      const changed: Session[] = [];
      const next = sessionsRef.current.map((session) => {
        const released = releaseRaceCheckout(session, race);
        if (released !== session) {
          changed.push(released);
          pendingPersist.current.delete(session.id);
        }
        return released;
      });
      sessionsRef.current = next;
      setSessions(next);
      await Promise.all(changed.map((session) => upsertSession(session)));
      // Repair legacy chats filed under a lane so project history can find
      // them. Chats already filed under the project clear their old checkout
      // through restoreSessionCheckout when opened; do not load every saved
      // transcript in the project just to finish one race.
      const open = new Set(next.map((session) => session.id));
      const saved = await Promise.all(
        race.lanes.map((lane) => listProjectSessionIds(lane.path)),
      );
      const ids = new Set([
        ...saved.flat(),
        ...race.lanes.map((lane) => lane.sessionId),
      ]);
      await Promise.all(
        [...ids]
          .filter((id) => !open.has(id))
          .map(async (id) => {
            const session = await getSession(id);
            if (!session) return;
            const released = releaseRaceCheckout(session, race);
            if (released !== session) await upsertSession(released);
          }),
      );
      notifyGitChanged();
      nudgeWatchedFiles();
      // The agents whose work was not kept leave the project's live chats;
      // they stay readable under Archived.
      const finished = getRace(race.id);
      for (const lane of finished ? raceLanesNotKept(finished) : [])
        void onRemoveHistorySession(finished!.lanes[lane].sessionId, "archive");
      // The kept agent and the chat the race started from each hear what
      // was kept with their next message.
      if (finished?.state === "kept")
        void noteRaceKept(finished.id, (id) =>
          sessionsRef.current.find((session) => session.id === id),
        );
    },
    // The same open-or-restore path as a notification: a lane whose tab was
    // closed comes back into one.
    openChat: (id) => void onOpenApprovalSession(id),
    compare: showRaceOverview,
    retry: async (race, lane) => {
      const record = race.lanes[lane];
      if (!record || getRace(race.id)?.state !== "running")
        return "This race has already finished.";
      const session = await ensureOpenSession(record.sessionId);
      if (getRace(race.id)?.state !== "running")
        return "This race has already finished.";
      if (!session)
        return "Couldn't retry: the agent's chat couldn't be opened.";
      if (session.busy) return "Couldn't retry: the agent's chat is busy.";
      // The task as the lane first got it, with its attachments: its
      // first message carries them.
      const first = session.blocks.find(
        (block) => block.role === "user" && !block.internal,
      );
      onSubmit(
        session.id,
        racePrompt(race.prompt, race.lanes.length),
        first?.attachments ?? [],
        { teamMember: { id: `race:${race.id}`, kind: "race" } },
      );
      return null;
    },
  };

  teamActionsRef.current = {
    reviewChanges: (project) => {
      flushSync(() => {
        setHomeViewOpen(false);
        if (!sameProjectPath(project, projectCwdRef.current)) {
          revealProjectTask(project);
          setProjectCwd(project);
        }
      });
      onShowSourceControl();
    },
    openChat: (id) => void onOpenApprovalSession(id),
    watch: (teamId) => openTeamPanel(teamId),
    send: async (id, compose, options) => {
      const opened = await ensureOpenSession(id);
      if (!opened) return false;
      await onOpenApprovalSession(id);
      const session =
        sessionsRef.current.find((entry) => entry.id === id) ?? opened;
      // Queued behind other messages or steered into a turn, the message
      // would never report how its own turn ended.
      if (
        options?.whenIdle &&
        (session.busy || !!session.queuedMessages?.length)
      )
        return false;
      const { text, shown } = compose(session.blocks);
      return (
        onSubmit(session.id, text, [], {
          ...(shown ? { displayText: shown } : {}),
          ...(options?.onSettled ? { onSettled: options.onSettled } : {}),
        }) !== false
      );
    },
  };

  showAgentPageRef.current = (notice) => {
    setAgentPageNotices((current) =>
      current.filter((item) => item.id !== notice.id),
    );
    const tabId = notice.tabId;
    flushSync(() => {
      onSelectProject(notice.project);
      setBrowserWorkspaces((all) => {
        const current = all[notice.project];
        return current
          ? {
              ...all,
              [notice.project]: {
                ...selectBrowserTab(current, tabId),
                expanded: true,
              },
            }
          : all;
      });
    });
    const requester = tabsRef.current.find((tab) =>
      leafIds(tab.layout).includes(notice.sessionId),
    )?.id;
    viewRef.current.change((view) =>
      revealBesideWorkspaceView(view, notice.surfaceId, requester),
    );
  };

  // Same-file edits and second dev servers, for the sidebar's rows.
  const workConflicts = useWorkConflicts();
  const projectStatus = useProjectStatus({
    sessions,
    activity: activityEntries,
    projectPaths: profiles.profileProjects.map((project) => project.path),
    leadDecided,
    teams,
  });
  const homeShown =
    (profileHome || homeViewOpen || view.order.length === 0) &&
    !settingsOpen &&
    !searchViewOpen &&
    !inboxViewOpen &&
    !automationsViewOpen &&
    !notesViewOpen;
  // When the user was last here, for Home's "While you were away" card.
  usePresenceTracking();
  // Built only while Home is on screen; keeps its identity across streaming
  // flushes that change nothing it shows.
  const homeData = useWorkspaceHomeData({
    enabled: homeShown,
    sessions,
    inFlightIds: busySessionIds,
    history,
    activity: activityEntries,
    projects: profiles.profileProjects,
    standaloneCwds,
    teams,
    leadDecided,
  });
  // Home's Getting started card, after the walkthrough on a fresh install.
  const gettingStarted = useGettingStarted({
    ready: !walkthrough,
    sessions,
    history,
    browsers: browserWorkspaces,
    shipped: shippedChats,
    projects: profiles.profileProjects,
  });
  const gettingStartedTarget = gettingStarted.target;
  const onGettingStartedStart = useCallback(
    (step: GettingStartedStepId) => {
      const target = gettingStartedTarget;
      if (step === "agent") openSettings("provider-setup");
      else if (step === "project" || !target) void pickProject();
      else if (step === "message")
        startProjectChat(
          target,
          isSampleProject(target) ? SAMPLE_FIRST_MESSAGE : undefined,
        );
      else if (step === "preview") startProjectChat(target, PREVIEW_MESSAGE);
      else {
        // Ship it lives in the side panel's Changes for the project.
        onSelectProject(target);
        showWorkspace();
        setSidebarTab("changes");
      }
    },
    [
      gettingStartedTarget,
      onSelectProject,
      openSettings,
      pickProject,
      setSidebarTab,
      showWorkspace,
      startProjectChat,
    ],
  );
  // The project boards on screen read the chats as small rows (workBoard).
  const boardOnScreen =
    workspaceVisible &&
    tabs.some(
      (tab) =>
        visibleSurfaceIds.includes(tab.id) &&
        tab.editorPanes.some((pane) =>
          pane.files.some(
            (file) => file.id === pane.activeFileId && isBoardTab(file),
          ),
        ),
    );
  useWorkBoardPublisher({
    enabled: boardOnScreen,
    sessions,
    inFlightIds: busySessionIds,
    leadDecided,
    statuses: chatStatus,
    teams,
  });
  const sidebarProps: Omit<
    SidebarProps,
    "open" | "floating" | "hoverHandlers"
  > = {
    cwd: profileHome ? "~" : sidebarCwd,
    gitCwd: profileHome ? "~" : gitCwd,
    profiles: profiles.profiles,
    profilePreviews,
    activeProfileId: profiles.activeProfileId,
    onSelectProfile,
    onDeleteProfile: profiles.deleteProfile,
    onCreateProfile: (name) => onSelectProfile(profiles.createProfile(name)),
    onMoveProject: (path, id) => {
      const next = profiles.moveProject(path, id);
      if (looksLikeProject(next)) onSelectProject(next);
    },
    onAddProject: (anchor) =>
      anchor ? setAddProjectAnchor(anchor) : void pickProject(),
    projectSessions: profileSessionSummaries,
    onExpandProject: refreshProfileHistory,
    loadedProjectPaths: loadedProjects,
    projectHistoryErrors: profileHistoryErrors,
    onSelectProjectSession: (_path, id) => void onSelectHistorySession(id),
    onNewProjectTask,
    tab: sidebarTab,
    onTabChange: (tab) => {
      setSidebarTab(tab);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setAutomationsViewOpen(false);
      setNotesViewOpen(false);
    },
    filesSearchOpen,
    onFilesSearchOpenChange: setFilesSearchOpen,
    onOpenFilesSearch: onFindInProject,
    searchFocusToken,
    sessions: profileHome
      ? []
      : standaloneActive
        ? standaloneSessions
        : sidebarHistory,
    busySessionIds,
    approvalSessionIds,
    teamNeedIds,
    chatStatus,
    chatStatusHints,
    activeSessionId: profileHome ? undefined : active?.id,
    status: historyFailed ? "error" : "idle",
    pending: historyPending,
    onSelectSession: onSelectHistorySession,
    onSessionNavigationOrder,
    onPlaceSessionOnPane,
    onRenameSession: onRenameHistorySession,
    onArchiveSession: onArchiveHistorySession,
    onArchiveSessions: onArchiveHistorySessions,
    onPinSession: onPinHistorySession,
    onPinSessions: onPinHistorySessions,
    onAddToBoard,
    onDeleteSession: onDeleteHistorySession,
    onDeleteSessions: onDeleteHistorySessions,
    onOpenFile,
    onOpenTerminal,
    onFileMoved,
    onFileDeleted,
    canGoBack: tabVisitNav.canBack,
    canGoForward: tabVisitNav.canForward,
    onGoBack: onRailBack,
    onGoForward: onRailForward,
    onOpenDiff: onOpenWorkingTreeDiff,
    onOpenAllChanges,
    onOpenCommit,
    onShowSourceControl: onToggleChanges,
    selectedDiffPath: activeTab
      ? selectedChangePath(activeTab, gitCwd)
      : undefined,
    selectedDiffKind: activeTab ? selectedChangeKind(activeTab) : undefined,
    selectedCommitSha: activeTab ? selectedCommitSha(activeTab) : undefined,
    textHarness: pickTextHarness(active?.harness),
    recents: profiles.profileProjects,
    projectStatus,
    liveAgents,
    discussions: discussions.sidebar,
    teams: sidebarTeamRows,
    onOpenDiscussion: openDiscussionView,
    workConflicts,
    onSelectAgent: onSelectLiveAgent,
    onSelectProject,
    onOpenBoard,
    onOpenProject: pickProject,
    onRemoveProject,
    onNew,
    onNewStandalone: () => void onNewStandalone(),
    startingStandalone,
    standaloneActive,
    standaloneSessions,
    onOpenStandalone: standaloneCwd
      ? () => onSelectProject(standaloneCwd)
      : undefined,
    openSessions: profileHome ? [] : openProjectSessions,
    onNewTerminal,
    onSearch: onOpenSearch,
    onOpenInbox,
    onOpenAutomations,
    onOpenNotes: notesEnabled ? onOpenNotes : undefined,
    onGoToFile,
    searchActive: searchViewOpen,
    inboxActive: inboxViewOpen,
    automationsActive: automationsViewOpen,
    notesActive: notesViewOpen,
    notesEnabled,
    projectRailOpen,
    onToggleProjectRail,
    unseenFinishedIds,
    settingsOpen,
    settingsSection,
    onOpenSettings,
    onSelectSettingsSection,
    onCloseSettings,
    updateNotice,
    onOpenWhatsNew,
    onDismissUpdate: () => setUpdateNotice(null),
  };
  const floatingSidebar = useNativeFloatingSidebar({
    label: floatingSidebarLayer,
    props: sidebarProps,
    handlers: {
      addExistingProject: () => void pickProject(),
      cloneProject: () => openWorkspaceAction("clone"),
      createProject: () => openWorkspaceAction("create"),
      cancelOrchestrationTask: (leadId: string, taskId: string) =>
        orchestrator.cancelTask(leadId, taskId),
      startOrchestration: (...args: Parameters<typeof orchestrator.start>) =>
        orchestrator.start(...args),
      stopOrchestration: (leadId: string) => orchestrator.stopRun(leadId),
      inspectWorker: (sessionId: string | null) =>
        orchestrationWorkers.inspect(sessionId),
      openWorkerDetails: orchestrationWorkers.openDetails
        ? (worker: OrchestrationWorkerDetail) =>
            orchestrationWorkers.openDetails?.(worker)
        : undefined,
      showPaneDrop: (drop: PaneDrop | null) => setExternalPaneDrop(drop),
    },
    extra: () => ({
      orchestration: {
        // States and task rows only: never prompts, results or receipts.
        runs: encodedSidebarRuns(orchestrator.snapshot(), encodeSidebarValue),
        agentsByLead: encodeSidebarValue(orchestrationWorkers.agentsByLead),
        selectedId: orchestrationWorkers.selectedId,
        details: !!orchestrationWorkers.openDetails,
      },
    }),
    pinned: sidebarOpen,
    windowFocused: notificationWindowFocused,
    onToggleSidebar,
    onRefreshSidebar: () => setSidebarGeneration((current) => current + 1),
  });
  // Aven Dev's real-app check; inert unless `dev-aven.py --smoke` launched it.
  useDevSmoke({
    sessions,
    floatingSidebarLabel: floatingSidebarLayer,
    expectFloatingSidebar: IS_MAC,
    // The sidebar's own New chat, as its project rows (and the floating
    // sidebar, by name) call it.
    newProjectTask: sidebarProps.onNewProjectTask ?? onNewProjectTask,
    submit: (sessionId, text) => void onSubmit(sessionId, text, []),
    utilities: {
      openSearch: onOpenSearch,
      openInbox: onOpenInbox,
      openAutomations: onOpenAutomations,
      openNotes: onOpenNotes,
      openSettings: onOpenSettings,
      closeSettings: onCloseSettings,
      leaveNotes: onLeaveNotes,
    },
    motion: {
      openHome: onOpenHome,
      showChanges: onShowSourceControl,
      hideChanges: onCloseInspector,
      showWorkspace,
    },
    projects: recents,
    previewRestartQuestion: () => previewUpdateRestart("question"),
    projectPanel: {
      toggle: onToggleProjectTerminal,
      terminalIds: (path) =>
        projectPanelTerminals(projectTerminalsRef.current, path).map(
          (file) => file.id,
        ),
    },
    deleteProject: (path) => onRemoveProject(path, { purgeData: true }),
    discussion: discussions.host,
    projectMemory: async (path) => (await loadProjectMemory(path))?.body ?? "",
    sharedWork: true,
    paneLayout: true,
    openFile: (path) => onOpenFile(path),
    orchestration: {
      run: (leadId) => orchestrator.run(leadId),
      submissionError: (sessionId) => orchestrator.submissionError(sessionId),
    },
    race: {
      races: listRaces,
      listDir,
      readFile: readTextFile,
      resolveGrok: resolveGrokBinary,
      probe: () => probeHarnessAvailability({ force: true }),
      chooseAgents: saveRaceLaneChoice,
    },
    focusedSurfaceId: view.focusedId,
    sidebarOpen,
    openWebLink: onOpenWebLink,
    board: true,
  });
  useEffect(
    () => setFloatingSidebarRevealed(floatingSidebar.revealed),
    [floatingSidebar.revealed, setFloatingSidebarRevealed],
  );

  return (
    <LiveSessionsContext.Provider value={liveSessions}>
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
              sessions={profileSessions}
              session={profileHome ? undefined : active}
              onSelectSession={onOpenApprovalSession}
              onToggleSidebar={onToggleSidebar}
              sidebarOpen={sidebarOpen}
              onSearch={onOpenSearch}
              onNewBrowser={
                workspaceVisible && visibleSurfaceIds.length > 0
                  ? undefined
                  : onGlobalNewBrowser
              }
              onGoBack={onRailBack}
              onGoForward={onRailForward}
              canGoBack={tabVisitNav.canBack}
              canGoForward={tabVisitNav.canForward}
              onHome={onOpenHome}
              homeOpen={homeViewOpen || profileHome}
              onToggleInspector={onToggleInspector}
              inspectorOpen={inspector.open}
            />
            <div className="personal-shell-body">
              {!sidebarOpen ? (
                <button
                  type="button"
                  className="personal-panel-edge personal-panel-edge-left"
                  aria-label="Show workspace sidebar"
                  {...(nativeSidebar ? {} : sidebarHover.edgeHandlers)}
                  onClick={onToggleSidebar}
                />
              ) : null}
              <Sidebar
                key={sidebarGeneration}
                {...sidebarProps}
                open={
                  nativeSidebar
                    ? sidebarOpen && !floatingSidebar.dockHidden
                    : sidebarHover.visible
                }
                floating={!sidebarOpen}
                hoverHandlers={
                  nativeSidebar ? undefined : sidebarHover.panelHandlers
                }
              />

              <div
                className="personal-workspace-column"
                data-settings-open={settingsOpen}
              >
                <div className="personal-workspace-body">
                  <div className="personal-main body-glass flex min-h-0 min-w-0 flex-1 flex-col">
                    {homeShown ? (
                      <WorkspaceHome
                        profile={profiles.activeProfile.name}
                        needsYou={homeData.needsYou}
                        running={homeData.running}
                        projects={homeData.projects}
                        recent={homeData.recent}
                        finished={homeData.finished}
                        activeDays={homeData.activeDays}
                        projectStatus={projectStatus}
                        usageProviders={usageProviders}
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
                        onNewProjectTask={onNewProjectTask}
                        onOpenBoard={onOpenBoard}
                        onAddProject={pickProject}
                        onSearch={onOpenSearch}
                        onLoadProjects={(paths) => {
                          for (const path of paths)
                            void refreshProfileHistory(path);
                        }}
                        gettingStarted={gettingStarted.card}
                        onGettingStartedStart={onGettingStartedStart}
                        onGettingStartedHide={gettingStarted.hide}
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
                          onOpenAutomations={onOpenAutomations}
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
                                  onAddTerminal={onNewTerminal}
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
                            {/* Tabs stay in each pane's own header, one pane or
                              several, so the window toolbar stays clean. */}
                            <WorkspaceStage
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
                                      onOpenRaceOverview={openRaceOverview}
                                      paneLocal
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
                                          kept: tab.kept,
                                          url: tab.url,
                                          // A race agent's page says whose
                                          // version it shows.
                                          title: racePreviewTitle(
                                            tab.title ||
                                              (tab.url
                                                ? tab.url
                                                    .replace(/^https?:\/\//, "")
                                                    .split("/")[0]
                                                : "New browser tab"),
                                            racePreviewLabelFor(tab.url),
                                          ),
                                        }))}
                                      browserOpen={browserState.open}
                                      browserActive={browserFocused}
                                      visibleIds={visibleSurfaceIds}
                                      surfaceOrder={members}
                                      onReorderSurfaces={(ids, movedId) => {
                                        onWorkspaceIntent({
                                          type: "reorder",
                                          group: owner,
                                          ids,
                                        });
                                        onReorderTabs(
                                          ids.filter((id) =>
                                            tabs.some((tab) => tab.id === id),
                                          ),
                                          movedId &&
                                            tabs.some(
                                              (tab) => tab.id === movedId,
                                            )
                                            ? movedId
                                            : undefined,
                                        );
                                      }}
                                      onSplitTab={(id, edge, beside) =>
                                        onWorkspaceIntent({
                                          type: "split",
                                          id,
                                          edge,
                                          beside,
                                        })
                                      }
                                      onUnsplit={() =>
                                        onWorkspaceIntent({
                                          type: "unsplit",
                                          group: owner,
                                        })
                                      }
                                      combineTargets={neighborCombineTargets(
                                        view,
                                        owner,
                                      )}
                                      onCombineWith={(into) =>
                                        onWorkspaceIntent({
                                          type: "combine",
                                          group: owner,
                                          into,
                                        })
                                      }
                                      groupId={owner}
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
                                      onOpenBoard={
                                        looksLikeProject(projectCwd) &&
                                        !isProjectlessCwd(projectCwd)
                                          ? () => {
                                              workspaceViews.change((view) =>
                                                selectWorkspaceView(
                                                  view,
                                                  owner,
                                                ),
                                              );
                                              onOpenBoard();
                                            }
                                          : undefined
                                      }
                                      onNewView={
                                        members.length > 1 ||
                                        visibleSurfaceIds.length > 1
                                          ? (id) =>
                                              onWorkspaceIntent({
                                                type: "split",
                                                id,
                                                edge: "right",
                                                beside: owner,
                                              })
                                          : undefined
                                      }
                                      onSelectBrowser={onSelectBrowserTab}
                                      onKeepBrowser={onKeepBrowser}
                                      browserPreviewId={
                                        browserState.activeTabId
                                          ? browserIdForTab(
                                              projectCwd,
                                              browserState.activeTabId,
                                            )
                                          : null
                                      }
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
                                      onOpenAutomations={onOpenAutomations}
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
                                onWorkspaceIntent({ type: "resize", layout })
                              }
                              onMinimizeSide={(split, index, side) =>
                                onWorkspaceIntent({
                                  type: "minimize",
                                  split,
                                  index,
                                  side,
                                })
                              }
                              onRestoreSplit={
                                view.restoreView
                                  ? () => onWorkspaceIntent({ type: "restore" })
                                  : undefined
                              }
                              restoreEdge={view.minimizedEdge}
                              restoreStatus={restoreStatus}
                              dragging={surfaceDragging}
                              dragLabel="Move tab"
                              dragTarget={surfaceDrop}
                              surfaces={[
                                ...tabs
                                  .filter((tab) => !detachedIds.has(tab.id))
                                  .map((tab) => ({
                                    id: tab.id,
                                    content: (
                                      <PaneTree
                                        {...sessionPaneProps}
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
                                        onAddFileToChat={onAddFileToChat}
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
                                                browserIdForTab(
                                                  project,
                                                  tab.id,
                                                ),
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
                                                    detached.nativeBrowserIds[
                                                      id
                                                    ]
                                                  }
                                                  agentRequested={agentBrowserSurfaces.has(
                                                    id,
                                                  )}
                                                  visible={
                                                    project === projectCwd &&
                                                    workspaceVisible &&
                                                    visibleSurfaceIds.includes(
                                                      id,
                                                    )
                                                  }
                                                  expanded={
                                                    visibleSurfaceIds.length ===
                                                    1
                                                  }
                                                  actions={
                                                    browserSurfaceActions
                                                  }
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
                      <LazyViewSlot label="search">
                        <SearchView
                          open
                          cwd={sidebarCwd}
                          recents={recents}
                          history={projectHistory}
                          sessions={sessions.filter(
                            (session) => !session.inboxAsk,
                          )}
                          focusToken={searchViewFocusToken}
                          besideRail={sidebarOpen}
                          onClose={onLeaveSearch}
                          onToggleSidebar={onToggleSidebar}
                          onOpenFile={onOpenFile}
                          onOpenSession={onSelectHistorySession}
                          onOpenProject={onSelectProject}
                        />
                      </LazyViewSlot>
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
                      <LazyViewSlot label="inbox">
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
                      </LazyViewSlot>
                    ) : null}
                    {automationsViewOpen ? (
                      <LazyViewSlot label="automations">
                        <AutomationsView
                          cwd={sidebarCwd}
                          recents={recents}
                          besideRail={sidebarOpen}
                          onClose={onLeaveAutomations}
                          onToggleSidebar={onToggleSidebar}
                          onRunAutomation={(agent) =>
                            startScheduledAgentRef.current(agent)
                          }
                          onOpenChat={onOpenApprovalSession}
                        />
                      </LazyViewSlot>
                    ) : null}
                    {notesViewOpen ? (
                      <LazyViewSlot label="notes">
                        <NotesView
                          besideRail={sidebarOpen}
                          cwd={projectCwd}
                          onClose={onLeaveNotes}
                          onToggleSidebar={onToggleSidebar}
                        />
                      </LazyViewSlot>
                    ) : null}
                    {settingsOpen ? (
                      <LazyViewSlot label="Settings">
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
                          onTakeTour={startTour}
                        />
                      </LazyViewSlot>
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
                    onOpenBranchPicker={
                      projectBranches ? setBranchAnchor : undefined
                    }
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
                  active={footerShown}
                  teams={
                    <TeamWatchPills panel={teamWatch} sessions={sessions} />
                  }
                  cwd={profileHome ? "~" : gitCwd}
                  onToggleTerminal={() => {
                    if (!profileHome) onToggleProjectTerminal();
                  }}
                  terminalOpen={!profileHome && dockVisible}
                  usage={
                    <FooterUsage
                      providers={usageProviders}
                      context={profileHome ? null : active?.context}
                    />
                  }
                />
              </div>
            </div>
            {addProjectAnchor ? (
              <AddProjectMenu
                anchor={addProjectAnchor}
                onDismiss={() => setAddProjectAnchor(null)}
                onAddExisting={() => void pickProject()}
                onClone={() => openWorkspaceAction("clone")}
                onCreate={() => openWorkspaceAction("create")}
              />
            ) : null}
            {branchAnchor && !profileHome ? (
              <BranchPicker
                key={gitCwd}
                cwd={gitCwd}
                branch={projectBranches?.current ?? undefined}
                externalAnchor={branchAnchor}
                side="bottom"
                defaultOpen
                hideTrigger
                onClose={() => setBranchAnchor(null)}
              />
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
            <ImageViewer onOpenInTab={onOpenImageInTab} />
            <UpdateNoticeDialog />
            <UpdateRestartDialog />
            {walkthrough && walkthrough.step !== "tour" ? (
              <LazyViewSlot label="setup" quiet>
                <WalkthroughDialog
                  step={walkthrough.step}
                  done={walkthrough.done}
                  onAction={dispatchWalkthrough}
                  onAgentsDone={onWalkthroughAgents}
                  onProject={onWalkthroughProject}
                />
              </LazyViewSlot>
            ) : null}
            {walkthrough?.step === "tour" || tourAgain ? (
              <LazyViewSlot label="tour" quiet>
                <TourOverlay prepare={tourPrepare} onClose={onTourClose} />
              </LazyViewSlot>
            ) : null}
            {paletteOpen ? (
              <LazyViewSlot label="command palette" quiet>
                <CommandPalette
                  open
                  initialQuery={paletteQuery}
                  onClose={() => setPaletteOpen(false)}
                  project={{
                    path: projectCwd,
                    name: projectDisplayName(projectCwd, loadTabGroupLabels()),
                  }}
                  projects={paletteProjects}
                  chats={paletteChats}
                  agents={paletteAgents}
                  commands={paletteCommands}
                  searchChats={searchPaletteChats}
                  searchSettings={searchSettings}
                  onRunCommand={runPaletteCommand}
                  onOpenChat={(id) => void onSelectHistorySession(id)}
                  onOpenProject={onSelectProject}
                  onOpenFile={(path) => onOpenFile(path)}
                  onOpenSetting={(setting) => {
                    openSettings(setting.section);
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() =>
                        document
                          .getElementById(setting.id)
                          ?.scrollIntoView({ block: "center" }),
                      ),
                    );
                  }}
                  onStartChat={startPaletteChat}
                  onStartRace={(request) =>
                    // A race that can't start explains why; keep what was typed.
                    void startRace(request).then((started) => {
                      if (started) return;
                      setPaletteQuery(request.text);
                      setPaletteOpen(true);
                    })
                  }
                />
              </LazyViewSlot>
            ) : null}

            <TeamWatchFloat
              panel={teamWatch}
              sessions={sessions}
              host={discussions.host}
              onOpenFile={onOpenFile}
              onStop={onStop}
              pillsDocked={footerShown}
            />
            <ApprovalToasts
              notices={hiddenApprovalToasts}
              onFocusSession={onOpenApprovalSession}
              onApproval={onApproval}
            />
            <AgentPageNotices
              notices={agentPageNotices}
              onShow={(notice) => showAgentPageRef.current(notice)}
              onDismiss={(id) =>
                setAgentPageNotices((current) =>
                  current.filter((item) => item.id !== id),
                )
              }
            />
            {whatsNewVersion ? (
              <LazyViewSlot label="release notes" quiet>
                <WhatsNewDialog
                  version={whatsNewVersion}
                  onClose={() => setWhatsNewVersion(null)}
                />
              </LazyViewSlot>
            ) : null}
          </div>
        </OrchestrationWorkers.Provider>
      </OrchestrationActions.Provider>
    </LiveSessionsContext.Provider>
  );
}
function conversationTitle(session: Session): string {
  const title = sessionDisplayTitle(session.title, session.harness);
  return isUntitledChatTitle(title) ? "" : title;
}

function lastUserBlockId(session: Session): string | undefined {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    if (session.blocks[i]?.role === "user") return session.blocks[i]?.id;
  }
  return undefined;
}

function isBlankSession(session: Session | undefined): boolean {
  if (
    !session ||
    isInFlightSession(session) ||
    uncertainSessionAgents(session).length
  )
    return false;
  // A new chat waiting for its first discussion turn is not a free pane.
  if (discussionStore().forSession(session.id)) return false;
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
  return undefined;
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
  leadDecided: LeadDecided,
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
  // A race's agents share one tab: name it once, after the prompt.
  const lanes = tabSessions.map((session) => raceLaneFor(session.id));
  const race =
    lanes.length > 1 &&
    lanes.every((lane) => lane && lane.race.id === lanes[0]?.race.id)
      ? lanes[0]?.race
      : undefined;

  const seen = new Set<HarnessId>();
  const harnesses: HarnessId[] = [];
  const busySeen = new Set<HarnessId>();
  const busyHarnesses: HarnessId[] = [];
  const ordered = focused
    ? [focused, ...tabSessions.filter((session) => session.id !== focused.id)]
    : tabSessions;
  for (const session of ordered) {
    const { harness } = sessionModelIdentity(session);
    if (
      isInFlightSession(session) &&
      !sessionIsWaitingForInput(session) &&
      !busySeen.has(harness)
    ) {
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
  const board =
    tabSessions.length === 0 && !!focusedFile && isBoardTab(focusedFile);

  return {
    id: tab.id,
    projectPath: focused?.cwd ?? focusedFile?.cwd,
    project: focused
      ? projectName(focused.cwd)
      : focusedFile
        ? projectName(focusedFile.cwd)
        : "~",
    title: race
      ? racePromptTitle(race.prompt)
      : focused
        ? conversationTitle(focused)
        : "",
    more,
    sessionCount: tabSessions.length,
    sessionIds: tabSessions.map((session) => session.id),
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
    needsInput: tabSessions.some((session) =>
      sessionNeedsUser(session, leadDecided),
    ),
    waitingOn: ordered
      .map((session) => holdUpHint(sessionHoldUps(session)))
      .find(Boolean),
    race: Boolean(race),
    board,
  };
}

function racePromptTitle(prompt: string): string {
  return (
    prompt
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "Race"
  );
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
    void prepareSessionCheckpoint(sessionId, cwd, paths).catch((error) =>
      logError("Prepare change checkpoint", error),
    );
    return;
  }
  void captureSessionCheckpoint(sessionId, cwd, paths)
    .catch((error) => logError("Capture change checkpoint", error))
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
    notifyGitChanged(cwd);
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
    notifyGitChanged(cwd);
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
