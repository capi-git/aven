import { ChevronDown } from "../chrome/icons";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Composer } from "../chrome/Composer";
import { DevPreviewChip } from "../chrome/DevPreviewChip";
import { MemoryKeeperOffer } from "../chrome/MemoryKeeper";
import { DuplicateServerChip } from "../chrome/DuplicateServerChip";
import { PaneNameStrip } from "../chrome/PaneNameStrip";
import { ProviderMarks } from "../chrome/ProviderMarks";
import {
  leadIsIdle,
  orchestrator,
  sameCheckout,
  type OrchestrationRun,
} from "../lib/orchestration";
import {
  useOrchestrationRun,
  useOrchestrationSelector,
} from "../hooks/useOrchestrationRun";
import { isDetachedWorkspace } from "../lib/workspaceTransfers";
import {
  TeamBar,
  teamBarOwnsStop,
  teamBarShows,
  teamBarTakesBoxStop,
} from "../chrome/TeamBar";
import { TeamRunStatusContext } from "../chrome/TeamRunDetails";
import { useTeamOf } from "../hooks/useTeamRuns";
import { chatMayOfferMemoryKeeper } from "../lib/memoryKeeperOffer";
import { teamIsOpen, teamRole } from "../lib/teamRuns";
import { sessionWithManagedAgents } from "../lib/sessionAgents";
import { sessionHoldUps, type SessionHoldUp } from "../lib/sessionHoldUp";
import { equalChromeData } from "../hooks/useChromeProps";
import { OrchestrationWorkers } from "../chrome/OrchestrationActions";
import { DiscussionEmpty } from "../chrome/DiscussionEmpty";
import { DiscussionActions } from "../chrome/DiscussionWrapUpNote";
import { SessionReview } from "../chrome/SessionReview";
import { PromptOutline } from "../chrome/PromptOutline";
import {
  canCompactHarnessContext,
  type ApprovalDecision,
  type UserQuestionReply,
} from "../lib/harness";
import { looksLikeProject, type RecentProject } from "../lib/recents";
import {
  sessionDisplayTitle,
  sessionIsWaitingForInput,
  sessionWorkCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type PlanBuildTarget,
  type RuntimeMode,
  type Session,
  type ComposerTurnOptions,
} from "../lib/session";
import { isUntitledChatTitle } from "../lib/untitledChat";
import { AgentTranscript } from "./AgentTranscript";
import { BotChatHeader, BotIntro } from "./BotChat";
import { useBotChatProject } from "../lib/projectBots";
import { crewMemberName, useCrew, useCrewChat } from "../lib/crews";
import { CrewChatHeader, CrewIntro } from "./CrewChat";
import { useProjectBotName } from "../hooks/useProjectBotName";
import { isBlockingQuestion } from "../lib/userQuestion";
import { SessionRunStatus } from "./SessionRunStatus";
import { EmptySession } from "./EmptySession";
import { MOD } from "../lib/platform";
import {
  acknowledgeQuoteRequest,
  ADD_TO_CHAT_EVENT,
  type AddToChatRequest,
  type QuoteRequest,
} from "../lib/quoteDraft";
import { createNote, noteTitle } from "../lib/notes";
import { loadNotesEnabled, subscribeNotesEnabled } from "../lib/settings";
import { getModelSnapshot, resolveModel, subscribeModels } from "../lib/models";
import { sessionModelIdentity, sessionPaneLabel } from "../lib/sessionLabels";
import { isInFlightSession } from "../lib/inFlight";
import { raceLaneFor } from "../lib/race";
import { isAstraModel } from "../lib/astraWelcome";
import { AstraWelcome } from "./AstraWelcome";
import { projectKey } from "../lib/paths";
import { memoryProjectFor } from "../lib/projectMemory";
import {
  readComposerDraft,
  retainComposerDraft,
  updateComposerDraft,
} from "../lib/composerDrafts";
import {
  loadProjectChatBackground,
  projectChatBackgroundRevision,
  subscribeProjectChatBackground,
} from "../lib/projectChatBackground";
import { projectChatBackgroundSrc } from "../lib/chatBackground";
import { useLiveSession } from "../lib/liveSessions";
import {
  loadChatBackgroundPath,
  subscribeChatBackgroundPath,
} from "../lib/appearance";
import type { PaletteAgent } from "../lib/commandPalette";
import type { DiscussionHost } from "../lib/discussions";

const NO_RUNS: readonly OrchestrationRun[] = [];
const runIsOpen = (run: OrchestrationRun) =>
  run.status === "active" || run.status === "paused";

type Props = {
  session: Session;
  reviewUndoLocked?: boolean;
  visible: boolean;
  focused: boolean;
  addToChatTarget?: boolean;
  /** Shares its tab with another pane, so it shows its own name strip. */
  inSplit: boolean;
  composerFocused: boolean;
  recents: RecentProject[];
  hideProjectPicker?: boolean;
  onFocus: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onCwdChange: (sessionId: string, cwd: string) => void;
  onBranchChange: (sessionId: string) => void;
  onModelChange: (sessionId: string, harness: HarnessId, model: string) => void;
  onModelSettingsChange: (
    sessionId: string,
    settings: Record<string, string>,
  ) => void;
  onRuntimeModeChange: (sessionId: string, mode: RuntimeMode) => void;
  onSubmit: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => void | boolean;
  /**
   * Race a message across several agents; absent hides Race. Resolves false
   * when the race could not start.
   */
  onRace?: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    agents: PaletteAgent[],
  ) => Promise<boolean>;
  onStop: (sessionId: string) => void;
  onCompactContext: (sessionId: string) => boolean;
  onDeleteQueuedMessage: (sessionId: string, messageId: string) => void;
  onEditQueuedMessage: (
    sessionId: string,
    messageId: string,
    text: string,
    attachments: Attachment[],
  ) => void;
  onQueuedMessageEditingChange: (sessionId: string, messageId?: string) => void;
  onSteerQueuedMessage: (sessionId: string, messageId: string) => void;
  onResumeQueue: (sessionId: string) => void;
  onInboxCardDismiss?: (sessionId: string) => void;
  onNoteCardDismiss?: (sessionId: string) => void;
  onHandoffCardDismiss?: (sessionId: string) => void;
  onApproval: (
    sessionId: string,
    requestId: number,
    decision: ApprovalDecision,
  ) => void;
  onQuestionReply: (
    sessionId: string,
    requestId: number,
    reply: UserQuestionReply,
  ) => void;
  onOpenFile: (path: string) => void;
  onOpenUrl?: (url: string) => void | Promise<void>;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
  onOpenPlan: (sessionId: string, blockId: string) => void;
  onBuildPlan: (
    sessionId: string,
    blockId: string,
    target?: PlanBuildTarget,
  ) => void;
  onSecondOpinion?: (
    sessionId: string,
    harness: HarnessId,
    turn: Block[],
    model: string,
  ) => void;
  onHandoff?: (
    sessionId: string,
    harness: HarnessId,
    turn: Block[],
    model: string,
  ) => void;
  onNewTerminal: (sessionId: string) => void;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Starts discussions with other chats; absent where this window can't. */
  discussion?: DiscussionHost;
};

export const SessionPane = memo(function SessionPane({
  session: committedSession,
  reviewUndoLocked = false,
  visible,
  focused,
  addToChatTarget = focused,
  inSplit,
  composerFocused,
  recents,
  hideProjectPicker,
  onFocus,
  onClose,
  onCwdChange,
  onBranchChange,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onSubmit,
  onRace,
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
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSecondOpinion,
  onHandoff,
  onNewTerminal,
  onPaneDragStart,
  discussion,
}: Props) {
  // Streaming updates this pane's transcript directly while it is shown.
  const session = useLiveSession(committedSession, visible);
  const workerAgents = useContext(OrchestrationWorkers).agentsByLead?.get(
    session.id,
  );
  // Only what this pane shows: another run's save re-renders nothing here.
  const runsCwd = sessionWorkCwd(session);
  const managed = useOrchestrationSelector((runs) =>
    runs.some((run) => runIsOpen(run) && sameCheckout(run.cwd, runsCwd)),
  );
  const ownRun = useOrchestrationRun(session.id);
  // The team bar's Stop stops what this chat's own Stop would (a lead's
  // run, a discussion): one Stop is enough.
  const team = useTeamOf(session.inboxAsk ? undefined : session.id, {
    previews: true,
  });
  // The run status shows no Stop where the bar's does the same. The box
  // keeps its Stop except for a lead: in a discussion it interrupts this
  // chat's agent at once, where the bar's End discussion lets it finish.
  const barStops = teamBarOwnsStop(team, session.id);
  const boxStopInBar = teamBarTakesBoxStop(team, session.id);
  // While the team runs, its bar carries this chat's status too: one row
  // says what the team and this chat are doing, with the run's time.
  const teamRow = !session.inboxAsk && teamBarShows(team, session.id);
  const raceLane = raceLaneFor(session.id);
  // A project's bot: its header, its tags and fix cards, its own name. A
  // crew member is a teammate in its own copy too, with its own header.
  const projectBot = useBotChatProject(
    session.inboxAsk ? undefined : session.id,
  );
  const crewChat = useCrewChat(session.inboxAsk ? undefined : session.id);
  const botProject = projectBot ?? crewChat?.path;
  const crewOfChat = useCrew(crewChat?.path);
  const projectBotLabel = useProjectBotName(projectBot);
  const botLabel =
    projectBotLabel ??
    (crewChat && crewOfChat
      ? crewMemberName(crewOfChat, crewChat.role)
      : undefined);
  // Never in a lane, partner, worker, bot or Inbox chat, nor during its own run.
  const offersMemoryKeeper =
    !botProject &&
    chatMayOfferMemoryKeeper(session, {
      lane: !!raceLane,
      teamRole: team ? teamRole(team, session.id) : null,
      teamOpen: !!team && teamIsOpen(team),
    });
  const runLocked = useOrchestrationSelector((runs) =>
    runs.some(
      (run) =>
        runIsOpen(run) &&
        (run.leadId === session.id ||
          run.tasks.some((task) => task.sessionId === session.id)),
    ),
  );
  useEffect(() => {
    // Only the window that holds a chat's runs loads them. A detached
    // workspace shows chats the main window runs; loading a live run there
    // would pause it and save that over the real one.
    if (!session.inboxAsk && !isDetachedWorkspace())
      void orchestrator.hydrate(session.id).catch(console.error);
  }, [session.id, session.inboxAsk]);
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const paneLabel = sessionPaneLabel(session, raceLane?.lane.label);
  // The provider at work, as the chat's tab marks it.
  const paneHarness = sessionModelIdentity(session).harness;
  const backgroundRevision = useSyncExternalStore(
    subscribeProjectChatBackground,
    projectChatBackgroundRevision,
    projectChatBackgroundRevision,
  );
  const globalBackgroundPath = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadChatBackgroundPath,
    loadChatBackgroundPath,
  );
  const projectBackground = loadProjectChatBackground(projectKey(session.cwd));
  const memoryProject = useMemo(
    () => memoryProjectFor(session.cwd) ?? undefined,
    [session.cwd],
  );
  const projectBackgroundStyle = projectBackground
    ? ({
        "--chat-background-image": `url(${JSON.stringify(
          projectChatBackgroundSrc(projectBackground.path, backgroundRevision),
        )})`,
        "--chat-background-opacity": String(projectBackground.opacity),
      } as CSSProperties)
    : undefined;
  const approve = useCallback(
    (requestId: number, decision: ApprovalDecision) =>
      onApproval(session.id, requestId, decision),
    [onApproval, session.id],
  );
  const replyQuestion = useCallback(
    (requestId: number, reply: UserQuestionReply) =>
      onQuestionReply(session.id, requestId, reply),
    [onQuestionReply, session.id],
  );
  const openPlan = useCallback(
    (blockId: string) => onOpenPlan(session.id, blockId),
    [onOpenPlan, session.id],
  );
  const buildPlan = useCallback(
    (blockId: string, target?: PlanBuildTarget) =>
      onBuildPlan(session.id, blockId, target),
    [onBuildPlan, session.id],
  );
  const jumpToBottomRef = useRef<(() => void) | null>(null);
  const transcriptScope = useRef<HTMLDivElement>(null);
  const quoteRequestId = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const astraWelcomeSequence = useRef(0);
  const [astraWelcomeRun, setAstraWelcomeRun] = useState<number | null>(null);
  const dismissAstraWelcome = useCallback(() => setAstraWelcomeRun(null), []);
  useEffect(() => {
    if (!visible) setAstraWelcomeRun(null);
  }, [visible]);
  const [quoteRequest, setQuoteRequest] = useState<QuoteRequest>();
  const onJumpToBottomReady = useCallback((jump: () => void) => {
    jumpToBottomRef.current = jump;
  }, []);
  const revealBlockRef = useRef<((blockId: string) => boolean) | null>(null);
  const onRevealReady = useCallback((reveal: (blockId: string) => boolean) => {
    revealBlockRef.current = reveal;
  }, []);
  const revealBlock = useCallback(
    (blockId: string) => revealBlockRef.current?.(blockId) ?? false,
    [],
  );
  const addSelectionToChat = useCallback(
    (text: string, mode?: QuoteRequest["mode"], attachments?: Attachment[]) => {
      quoteRequestId.current += 1;
      setQuoteRequest({ id: quoteRequestId.current, text, mode, attachments });
    },
    [],
  );
  const acknowledgeQuote = useCallback((handledId: number) => {
    setQuoteRequest((current) => acknowledgeQuoteRequest(current, handledId));
  }, []);
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  // Stable, so finished turns in the transcript skip rendering while it streams.
  const secondOpinion = useCallback(
    (harness: HarnessId, turn: Block[], model: string) =>
      onSecondOpinion?.(session.id, harness, turn, model),
    [onSecondOpinion, session.id],
  );
  const handoff = useCallback(
    (harness: HarnessId, turn: Block[], model: string) =>
      onHandoff?.(session.id, harness, turn, model),
    [onHandoff, session.id],
  );
  const saveNote = useCallback(
    (text: string) => {
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      void createNote({
        title:
          sessionTitle && !isUntitledChatTitle(sessionTitle)
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.harness, session.id, session.title],
  );

  // A request naming a chat goes to that chat; any other to the target.
  const addToChatSessionId = session.id;
  useEffect(() => {
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (
        !detail ||
        (detail.sessionId
          ? detail.sessionId !== addToChatSessionId
          : !addToChatTarget)
      )
        return;
      if (typeof detail.path === "string" && detail.path.trim()) {
        quoteRequestId.current += 1;
        setQuoteRequest({
          id: quoteRequestId.current,
          text: "",
          mention: detail.path,
        });
        return;
      }
      if (
        typeof detail.text !== "string" ||
        (!detail.text.trim() && !detail.attachments?.length)
      )
        return;
      addSelectionToChat(detail.text, detail.mode, detail.attachments);
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  }, [addSelectionToChat, addToChatSessionId, addToChatTarget]);
  const workCwd = sessionWorkCwd(session);
  const isEmpty = session.blocks.length === 0;
  const showDeckProjectPicker = isEmpty && !looksLikeProject(session.cwd);
  const dockComposer =
    !isEmpty || inSplit || !!session.inboxAsk || !!botProject;
  const draftRef = useRef<{
    sessionId: string;
    text: string | undefined;
    attachments: Attachment[];
  } | null>(null);
  const persistDraft = !session.inboxAsk;
  useEffect(
    () => (persistDraft ? retainComposerDraft(session.id) : undefined),
    [persistDraft, session.id],
  );
  if (draftRef.current?.sessionId !== session.id) {
    const saved = persistDraft ? readComposerDraft(session.id) : undefined;
    draftRef.current = {
      sessionId: session.id,
      text:
        saved?.text ??
        (session.inboxCard || session.noteCard || session.handoffCard
          ? undefined
          : session.composerSeed),
      attachments: saved?.attachments ?? [],
    };
  }
  const onDraftChange = useCallback(
    (text: string) => {
      if (draftRef.current?.sessionId !== session.id) return;
      draftRef.current.text = text;
      if (persistDraft) updateComposerDraft(session.id, { text });
    },
    [persistDraft, session.id],
  );
  const onAttachmentsChange = useCallback(
    (attachments: Attachment[]) => {
      if (draftRef.current?.sessionId !== session.id) return;
      // Composer owns and revokes its object URLs. A remounted composer uses
      // the retained path/base64 payload instead of a revoked thumbnail URL.
      draftRef.current.attachments = attachments.map((attachment) => {
        const restored = { ...attachment };
        delete restored.previewUrl;
        return restored;
      });
      if (persistDraft)
        updateComposerDraft(session.id, {
          text: draftRef.current.text ?? "",
          attachments,
        });
    },
    [persistDraft, session.id],
  );
  // Stable handlers and children let the memoized Composer skip renders
  // while this pane re-renders for streamed transcript text.
  const sessionId = session.id;
  const inboxAsk = !!session.inboxAsk;
  const dismissInboxCard = useCallback(
    () => onInboxCardDismiss?.(sessionId),
    [onInboxCardDismiss, sessionId],
  );
  const dismissNoteCard = useCallback(
    () => onNoteCardDismiss?.(sessionId),
    [onNoteCardDismiss, sessionId],
  );
  const dismissHandoffCard = useCallback(
    () => onHandoffCardDismiss?.(sessionId),
    [onHandoffCardDismiss, sessionId],
  );
  const focusSession = useCallback(
    () => onFocus(sessionId),
    [onFocus, sessionId],
  );
  const closeSession = useCallback(
    () => onClose(sessionId),
    [onClose, sessionId],
  );
  const changeCwd = useCallback(
    (cwd: string) => onCwdChange(sessionId, cwd),
    [onCwdChange, sessionId],
  );
  const changeBranch = useCallback(
    () => onBranchChange(sessionId),
    [onBranchChange, sessionId],
  );
  const newTerminal = useCallback(
    () => onNewTerminal(sessionId),
    [onNewTerminal, sessionId],
  );
  const changeRuntimeMode = useCallback(
    (mode: Parameters<typeof onRuntimeModeChange>[1]) =>
      onRuntimeModeChange(sessionId, mode),
    [onRuntimeModeChange, sessionId],
  );
  const race = useCallback(
    (text: string, attachments: Attachment[], agents: PaletteAgent[]) =>
      onRace?.(sessionId, text, attachments, agents),
    [onRace, sessionId],
  );
  const stop = useCallback(() => onStop(sessionId), [onStop, sessionId]);
  const compactContext = useCallback(
    () => onCompactContext(sessionId),
    [onCompactContext, sessionId],
  );
  const resumeQueue = useCallback(
    () => onResumeQueue(sessionId),
    [onResumeQueue, sessionId],
  );
  const changeModelSettings = useCallback(
    (settings: Parameters<typeof onModelSettingsChange>[1]) =>
      onModelSettingsChange(sessionId, settings),
    [onModelSettingsChange, sessionId],
  );
  const submit = useCallback(
    (
      text: Parameters<typeof onSubmit>[1],
      attachments: Parameters<typeof onSubmit>[2],
      options?: Parameters<typeof onSubmit>[3],
    ) => onSubmit(sessionId, text, attachments, options),
    [onSubmit, sessionId],
  );
  const deleteQueuedMessage = useCallback(
    (messageId: string) => onDeleteQueuedMessage(sessionId, messageId),
    [onDeleteQueuedMessage, sessionId],
  );
  const editQueuedMessage = useCallback(
    (messageId: string, text: string, attachments: Attachment[]) =>
      onEditQueuedMessage(sessionId, messageId, text, attachments),
    [onEditQueuedMessage, sessionId],
  );
  const changeQueuedMessageEditing = useCallback(
    (messageId: Parameters<typeof onQueuedMessageEditingChange>[1]) =>
      onQueuedMessageEditingChange(sessionId, messageId),
    [onQueuedMessageEditingChange, sessionId],
  );
  const steerQueuedMessage = useCallback(
    (messageId: string) => onSteerQueuedMessage(sessionId, messageId),
    [onSteerQueuedMessage, sessionId],
  );
  const changeModel = useCallback(
    (
      harness: Parameters<typeof onModelChange>[1],
      model: Parameters<typeof onModelChange>[2],
    ) => {
      onModelChange(sessionId, harness, model);
      const selected = resolveModel(harness, model);
      // A new key restarts the animation and its cleanup timer on every pick.
      setAstraWelcomeRun(
        isAstraModel(selected) ? ++astraWelcomeSequence.current : null,
      );
    },
    [onModelChange, sessionId],
  );
  const reviewUndoBlocked = reviewUndoLocked || runLocked;
  const submitText = useCallback(
    (id: string, text: string) => void onSubmit(id, text, []),
    [onSubmit],
  );
  const busy = !!session.busy;
  // Kept while its inputs hold, so the memoized message box skips streams.
  const idle = leadIsIdle(session);
  const openDiscussion = discussion?.open;
  const teamBar = useMemo(
    () =>
      inboxAsk ? undefined : (
        <TeamBar
          sessionId={sessionId}
          cwd={runsCwd}
          idle={idle}
          onSubmit={submitText}
          onStop={onStop}
          onOpenDiscussion={openDiscussion}
        />
      ),
    [idle, inboxAsk, onStop, openDiscussion, runsCwd, sessionId, submitText],
  );
  const statusSession = useMemo(
    () =>
      sessionWithManagedAgents(
        session,
        ownRun ? [ownRun] : NO_RUNS,
        workerAgents,
      ),
    [session, ownRun, workerAgents],
  );
  const teamRunStatus = useMemo(
    () => ({ session: statusSession, visible }),
    [statusSession, visible],
  );
  // What holds the turn up, for the transcript's working line. It changes
  // rarely, so it keeps its identity through streamed tokens.
  const nextHoldUps = sessionHoldUps(statusSession);
  const holdUpsRef = useRef<readonly SessionHoldUp[]>(nextHoldUps);
  if (!equalChromeData(holdUpsRef.current, nextHoldUps))
    holdUpsRef.current = nextHoldUps;
  const holdUps = holdUpsRef.current;
  const review = useMemo(
    () =>
      // A bot's changes are its fix card's to review, not the chat's.
      inboxAsk || botProject ? null : (
        <SessionReview
          sessionId={sessionId}
          cwd={workCwd}
          enabled={visible}
          busy={busy}
          undoLocked={reviewUndoBlocked}
          onOpenDiff={onOpenDiff}
        />
      ),
    [
      inboxAsk,
      botProject,
      sessionId,
      workCwd,
      visible,
      busy,
      reviewUndoBlocked,
      onOpenDiff,
    ],
  );
  const composer = (
    <Composer
      key={session.id}
      enabled={visible}
      focused={focused && composerFocused}
      hotkeys={focused}
      shell={!dockComposer}
      harness={session.harness}
      model={session.model}
      modelSettings={session.modelSettings}
      runtimeMode={session.runtimeMode}
      cwd={session.cwd}
      executionCwd={workCwd}
      sessionId={session.id}
      compactSupported={canCompactHarnessContext(session.harness)}
      recents={recents}
      hideProjectPicker={
        !!session.inboxAsk ||
        !!botProject ||
        (hideProjectPicker ? !showDeckProjectPicker : false)
      }
      hideBranchPicker={
        !!session.inboxAsk || !!botProject || hideProjectPicker || managed
      }
      hideTopBar={!!session.inboxAsk}
      placeholder={botLabel ? `Message ${botLabel}…` : undefined}
      hideAgentPill={!!botProject}
      context={session.context}
      quoteRequest={quoteRequest}
      initialDraft={draftRef.current.text}
      initialAttachments={draftRef.current.attachments}
      onDraftChange={onDraftChange}
      onAttachmentsChange={onAttachmentsChange}
      inboxCard={session.inboxCard}
      noteCard={session.noteCard}
      handoffCard={session.handoffCard}
      question={session.pendingQuestion}
      onQuoteRequestConsumed={acknowledgeQuote}
      onInboxCardDismiss={dismissInboxCard}
      onNoteCardDismiss={dismissNoteCard}
      onHandoffCardDismiss={dismissHandoffCard}
      onQuestionReply={replyQuestion}
      onFocus={focusSession}
      onCwdChange={changeCwd}
      onBranchChange={changeBranch}
      onNewTerminal={newTerminal}
      onModelChange={changeModel}
      onModelSettingsChange={changeModelSettings}
      onRuntimeModeChange={changeRuntimeMode}
      onSubmit={submit}
      onRace={onRace && !session.inboxAsk && !botProject ? race : undefined}
      onStop={stop}
      onCompactContext={compactContext}
      queuedMessages={session.queuedMessages}
      queueStatus={session.queueStatus}
      onDeleteQueuedMessage={deleteQueuedMessage}
      onEditQueuedMessage={editQueuedMessage}
      onQueuedMessageEditingChange={changeQueuedMessageEditing}
      onSteerQueuedMessage={steerQueuedMessage}
      onResumeQueue={resumeQueue}
      onOpenFile={onOpenFile}
      busy={busy}
      discussion={session.inboxAsk || botProject ? undefined : discussion}
      teamBar={teamBar}
      stopInBar={boxStopInBar}
    >
      {review}
    </Composer>
  );

  return (
    <div
      data-session-drop={session.id}
      data-session-empty={isEmpty}
      data-project-chat-background={!!projectBackground}
      data-project-background-scope={projectBackground?.scope}
      style={projectBackgroundStyle}
      className="chat-pane-background relative isolate flex h-full min-h-0 min-w-0 flex-1 flex-col"
      onMouseDown={focusSession}
    >
      {astraWelcomeRun !== null && visible ? (
        <AstraWelcome key={astraWelcomeRun} onDone={dismissAstraWelcome} />
      ) : null}
      {/* Sharing a tab, the pane names itself in a strip above its content. */}
      {inSplit ? (
        <PaneNameStrip
          name={paneLabel.headline}
          tooltip={paneLabel.tooltip}
          icon={
            <span className="personal-title-tab-identity">
              <ProviderMarks
                harnesses={[paneHarness]}
                busyHarnesses={
                  isInFlightSession(session) &&
                  !sessionIsWaitingForInput(session)
                    ? [paneHarness]
                    : []
                }
                dimmed={!focused}
              />
            </span>
          }
          focused={focused}
          closeTitle={`Close pane (${MOD}W)`}
          onClose={closeSession}
          onDragStart={onPaneDragStart}
        />
      ) : null}
      {projectBot ? (
        <BotChatHeader path={projectBot} working={busy} />
      ) : crewChat ? (
        <CrewChatHeader
          path={crewChat.path}
          role={crewChat.role}
          working={busy}
        />
      ) : null}
      <div ref={transcriptScope} className="@container relative min-h-0 flex-1">
        {isEmpty ? (
          botProject ? (
            <div className="scrollbar-none h-full min-h-0 overflow-y-auto">
              {projectBot ? (
                <BotIntro path={projectBot} />
              ) : crewChat ? (
                <CrewIntro path={crewChat.path} role={crewChat.role} />
              ) : null}
            </div>
          ) : session.inboxAsk ? (
            <div className="scrollbar-none h-full min-h-0 overflow-y-auto">
              <DiscussionEmpty message="Explore this item with your agent." />
            </div>
          ) : (
            <EmptySession
              cwd={session.cwd}
              visible={visible}
              hasChatBackground={Boolean(
                projectBackground || globalBackgroundPath,
              )}
              composer={dockComposer ? undefined : composer}
            />
          )
        ) : (
          <>
            <DiscussionActions host={session.inboxAsk ? undefined : discussion}>
              <AgentTranscript
                blocks={session.blocks}
                busy={!!session.busy}
                visible={visible}
                cwd={workCwd}
                harness={session.harness}
                model={session.model}
                pendingQuestion={isBlockingQuestion(session.pendingQuestion)}
                holdUps={holdUps}
                onApproval={approve}
                onAddToChat={addSelectionToChat}
                onSaveNote={notesEnabled ? saveNote : undefined}
                memoryProject={session.inboxAsk ? undefined : memoryProject}
                onOpenFile={onOpenFile}
                onOpenDiff={onOpenDiff}
                onOpenPlan={openPlan}
                onBuildPlan={buildPlan}
                onSecondOpinion={
                  !session.inboxAsk && onSecondOpinion
                    ? secondOpinion
                    : undefined
                }
                onHandoff={!session.inboxAsk && onHandoff ? handoff : undefined}
                onJumpToBottomChange={setShowJumpToBottom}
                onJumpToBottomReady={onJumpToBottomReady}
                onRevealReady={onRevealReady}
                botProject={botProject}
              />
            </DiscussionActions>
            <PromptOutline
              blocks={session.blocks}
              scope={transcriptScope}
              visible={visible}
              revealBlock={revealBlock}
            />
            {showJumpToBottom ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 z-30 flex justify-center">
                <button
                  type="button"
                  title="Jump to latest"
                  aria-label="Jump to latest"
                  data-jump-to-bottom
                  onClick={() => jumpToBottomRef.current?.()}
                  className="pointer-events-auto grid size-6 place-items-center rounded-md border border-content/15 bg-(--aven-control-bg) text-content shadow-md hover:bg-(--aven-control-hover) backdrop-blur-md"
                >
                  <ChevronDown className="size-4" strokeWidth={2} />
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {dockComposer ? (
        <div className="personal-session-composer-dock mx-auto w-full max-w-4xl shrink-0">
          {/* Asked once per project, in the chat whose turn brought it. */}
          {visible && memoryProject && offersMemoryKeeper ? (
            <MemoryKeeperOffer
              project={memoryProject}
              sessionId={session.id}
              focused={focused}
            />
          ) : null}
          {/* One chat per tab offers the project's dev server: the focused one. */}
          {visible && focused && !session.inboxAsk && !botProject ? (
            <DevPreviewChip
              project={session.cwd}
              placement="chat"
              requesterSessionId={session.id}
            />
          ) : null}
          {/* This chat started a second copy of a server that already runs. */}
          {visible && !session.inboxAsk ? (
            <DuplicateServerChip placement="chat" sessionId={session.id} />
          ) : null}
          <SessionRunStatus
            session={statusSession}
            visible={visible}
            stopElsewhere={barStops}
            // A bot's turn says what it is doing in its transcript; this row
            // shows only what needs you (a failure, signing in, a queue).
            placement={teamRow || botProject ? "attention" : "row"}
            onStop={onStop}
            onOpenTerminal={onNewTerminal}
          />
          <TeamRunStatusContext.Provider value={teamRunStatus}>
            {composer}
          </TeamRunStatusContext.Provider>
        </div>
      ) : null}
    </div>
  );
});
