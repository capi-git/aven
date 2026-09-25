import { ChevronDown, GripVertical, X } from "../chrome/icons";
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
import { orchestrator, sameCheckout } from "../lib/orchestration";
import { sessionWithManagedAgents } from "../lib/sessionAgents";
import { OrchestrationWorkers } from "../chrome/OrchestrationActions";
import { DiscussionEmpty } from "../chrome/DiscussionEmpty";
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
  sessionWorkCwd,
  type Attachment,
  type Block,
  type HarnessId,
  type PlanBuildTarget,
  type RuntimeMode,
  type Session,
  type ComposerTurnOptions,
} from "../lib/session";
import { AgentTranscript } from "./AgentTranscript";
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
import { sessionPaneLabel } from "../lib/sessionLabels";
import { isAstraModel } from "../lib/astraWelcome";
import { AstraWelcome } from "./AstraWelcome";
import { projectKey } from "../lib/paths";
import { readComposerDraft, retainComposerDraft, updateComposerDraft } from "../lib/composerDrafts";
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

type Props = {
  session: Session;
  reviewUndoLocked?: boolean;
  visible: boolean;
  focused: boolean;
  addToChatTarget?: boolean;
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
  /** Race a message across several agents; absent hides Race. */
  onRace?: (
    sessionId: string,
    text: string,
    attachments: Attachment[],
    agents: PaletteAgent[],
  ) => void;
  onStop: (sessionId: string) => void;
  onCompactContext: (sessionId: string) => boolean;
  onDeleteQueuedMessage: (sessionId: string, messageId: string) => void;
  onEditQueuedMessage: (
    sessionId: string,
    messageId: string,
    text: string,
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
}: Props) {
  // Streaming updates this pane's transcript directly while it is shown.
  const session = useLiveSession(committedSession, visible);
  const workerAgents = useContext(OrchestrationWorkers).agentsByLead?.get(session.id);
  const orchestrationRuns = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const managed = orchestrationRuns.some(
    (run) =>
      (run.status === "active" || run.status === "paused") &&
      sameCheckout(run.cwd, sessionWorkCwd(session)),
  );
  useEffect(() => {
    if (!session.inboxAsk)
      void orchestrator.hydrate(session.id).catch(console.error);
  }, [session.id, session.inboxAsk]);
  useSyncExternalStore(subscribeModels, getModelSnapshot, getModelSnapshot);
  const paneLabel = sessionPaneLabel(session);
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
  const saveNote = useCallback(
    (text: string) => {
      const sessionTitle = sessionDisplayTitle(session.title, session.harness);
      void createNote({
        title:
          sessionTitle && sessionTitle !== "New session"
            ? sessionTitle
            : noteTitle(text),
        body: text,
        sourceSessionId: session.id,
        sourceCwd: session.cwd,
      });
    },
    [session.cwd, session.harness, session.id, session.title],
  );

  useEffect(() => {
    if (!addToChatTarget) return;
    const onAdd = (event: Event) => {
      const detail = (event as CustomEvent<AddToChatRequest>).detail;
      if (
        typeof detail?.text !== "string" ||
        (!detail.text.trim() && !detail.attachments?.length)
      )
        return;
      addSelectionToChat(detail.text, detail.mode, detail.attachments);
    };
    window.addEventListener(ADD_TO_CHAT_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CHAT_EVENT, onAdd);
  }, [addSelectionToChat, addToChatTarget]);
  const workCwd = sessionWorkCwd(session);
  const isEmpty = session.blocks.length === 0;
  const showDeckProjectPicker = isEmpty && !looksLikeProject(session.cwd);
  const dockComposer = !isEmpty || inSplit || !!session.inboxAsk;
  const draftRef = useRef<{
    sessionId: string;
    text: string | undefined;
    attachments: Attachment[];
  } | null>(null);
  const persistDraft = !session.inboxAsk;
  useEffect(() => persistDraft ? retainComposerDraft(session.id) : undefined, [persistDraft, session.id]);
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
    (messageId: string, text: string) =>
      onEditQueuedMessage(sessionId, messageId, text),
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
  const reviewUndoBlocked =
    reviewUndoLocked ||
    orchestrationRuns.some(
      (run) =>
        (run.status === "active" || run.status === "paused") &&
        (run.leadId === sessionId ||
          run.tasks.some((task) => task.sessionId === sessionId)),
    );
  const busy = !!session.busy;
  const review = useMemo(
    () =>
      inboxAsk ? null : (
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
        (hideProjectPicker ? !showDeckProjectPicker : false)
      }
      hideBranchPicker={!!session.inboxAsk || hideProjectPicker || managed}
      hideTopBar={!!session.inboxAsk}
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
      onRace={onRace && !session.inboxAsk ? race : undefined}
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
      {inSplit ? (
        <div
          className={`flex h-9 shrink-0 touch-none items-center gap-1.5 border-b border-content/10 px-2 select-none ${
            onPaneDragStart ? "cursor-grab active:cursor-grabbing" : ""
          }`}
          onPointerDown={(event) => {
            if (event.button !== 0 || !onPaneDragStart) return;
            if (
              (event.target as HTMLElement | null)?.closest("[data-no-drag]")
            ) {
              return;
            }
            onPaneDragStart(event);
          }}
        >
          {onPaneDragStart ? (
            <GripVertical
              className="size-3.5 shrink-0 text-content/35"
              strokeWidth={1.75}
            />
          ) : null}
          <span
            className={`size-2 shrink-0 rounded-full ${focused ? "bg-accent" : "bg-transparent"}`}
          />
          <span
            className="min-w-0 flex-1 truncate text-xs text-content"
            data-session-pane-label
            title={paneLabel.tooltip}
          >
            {paneLabel.headline}
          </span>
          {paneLabel.model ? (
            <span
              className="max-w-[45%] shrink truncate text-[10px] text-content/45"
              data-session-pane-model
              title={paneLabel.model}
            >
              {paneLabel.model}
            </span>
          ) : null}
          <button
            type="button"
            title={`Close Pane (${MOD}W)`}
            aria-label="Close pane"
            data-no-drag
            className="grid size-5 shrink-0 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose(session.id);
            }}
          >
            <X className="size-3" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div ref={transcriptScope} className="@container relative min-h-0 flex-1">
        {isEmpty ? (
          session.inboxAsk ? (
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
            <AgentTranscript
              blocks={session.blocks}
              busy={!!session.busy}
              visible={visible}
              cwd={workCwd}
              harness={session.harness}
              model={session.model}
              pendingQuestion={!!session.pendingQuestion}
              onApproval={approve}
              onAddToChat={addSelectionToChat}
              onSaveNote={notesEnabled ? saveNote : undefined}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
              onOpenPlan={openPlan}
              onBuildPlan={buildPlan}
              onSecondOpinion={
                !session.inboxAsk && onSecondOpinion
                  ? (harness, turn, model) =>
                      onSecondOpinion(session.id, harness, turn, model)
                  : undefined
              }
              onHandoff={
                !session.inboxAsk && onHandoff
                  ? (harness, turn, model) =>
                      onHandoff(session.id, harness, turn, model)
                  : undefined
              }
              onJumpToBottomChange={setShowJumpToBottom}
              onJumpToBottomReady={onJumpToBottomReady}
              onRevealReady={onRevealReady}
            />
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
                  className="pointer-events-auto grid size-6 place-items-center rounded-md border border-content/15 bg-content/10 text-content shadow-md hover:bg-content/5 backdrop-blur-md"
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
          <SessionRunStatus session={sessionWithManagedAgents(session, orchestrationRuns, workerAgents)} visible={visible} onStop={onStop} onOpenTerminal={onNewTerminal} />
          {composer}
        </div>
      ) : null}
    </div>
  );
});
