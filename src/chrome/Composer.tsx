import { harnessDescriptor } from "../lib/harness/descriptors";
import {
  ArrowUp,
  AiIdea,
  Check,
  CornerDownRight,
  FilePlus,
  ListEnd,
  MessageMultiple,
  Pause,
  Pencil,
  Play,
  Plus,
  Race,
  Share,
  Square,
  StickyNote,
  Trash2,
  X,
} from "./icons";
import "./Menu.css";
import "./Composer.css";
import {
  memo,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  attachmentsFromFiles,
  filesFromClipboard,
  hasFileTransfer,
  MAX_ATTACHMENTS,
  mergeAttachments,
  pickAttachments,
  revokeAttachment,
} from "../lib/attachments";
import {
  shouldEnqueueSubmission,
  shouldQueueFollowUp,
} from "../lib/messageQueue";
import type { ContextUsage } from "../lib/contextUsage";
import {
  loadProjectFilesIfStale,
  peekLastProjectFiles,
  peekProjectFiles,
  recentOpenedFiles,
  subscribeProjectFiles,
} from "../lib/fileIndex";
import {
  buildMentionIndex,
  fileMentionParts,
  mentionFilesFor,
  mentionLabel,
  mentionTokenAt,
  rankMentionFiles,
  rankOpenMentionFiles,
  replaceMentionToken,
  withMentionExtras,
  type MentionFile,
  type MentionIndex,
  type MentionLookup,
  type MentionToken,
} from "../lib/fileMentions";
import type { ProjectFile } from "../lib/fs";
import {
  NO_OPEN_FILES,
  openFilesSnapshot,
  rememberMentionedFile,
  subscribeOpenFiles,
} from "../lib/openFiles";
import { pathKey } from "../lib/paths";
import {
  composeInboxMessage,
  type InboxComposerCard,
} from "../lib/githubTasks";
import type { HandoffComposerCard } from "../lib/handoff";
import { looksLikeProject, type RecentProject } from "../lib/recents";
import type {
  Attachment,
  HarnessId,
  MessageQueueStatus,
  QueuedMessage,
  RuntimeMode,
  ComposerTurnOptions,
} from "../lib/session";
import { appName } from "../lib/agentNames";
import { harnessSupportsAttachments } from "../lib/session";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../lib/userQuestion";
import { isImeComposition, moveMenuFocus } from "../lib/keyboard";
import {
  createBlankSkill,
  rankSkillMatches,
  hasNativeCommands,
  isNativeCommandPrompt,
  replaceSlashToken,
  skillNamesInText,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../lib/skills";
import {
  loadRecentSkills,
  rememberRecentSkills,
  subscribeRecentSkills,
} from "../lib/recentSkills";
import { AgentPill } from "./AgentPill";
import { ComposerRunner } from "./ComposerRunner";
import { ContextMeter } from "./ContextMeter";
import { AttachmentChip } from "./AttachmentChip";
import { ChatReferenceText } from "./ChatReferenceText";
import { BranchPicker } from "./BranchPicker";
import { CwdPicker } from "./CwdPicker";
import { FileMentionPicker } from "./FileMentionPicker";
import { FileTypeIcon } from "./FileTypeIcon";
import { InboxMiniCard } from "./InboxMiniCard";
import { NoteMiniCard } from "./NoteMiniCard";
import { HandoffMiniCard } from "./HandoffMiniCard";
import { QuestionForm } from "./QuestionForm";
import { RECENT_SKILL_CHIPS, RecentSkillChips } from "./RecentSkillChips";
import { SKILL_ACTION_ROWS, SkillPicker } from "./SkillPicker";
import { retryableLazy } from "../lib/retryableLazy";
import { projectKey } from "../lib/paths";
import { consumeQuoteRequest, type QuoteRequest } from "../lib/quoteDraft";
import { useTabGroupLogos } from "../hooks/useTabGroupLogos";
import {
  COMPOSER_RUNNER_CHANGE_EVENT,
  loadComposerRunner,
  loadFollowUpBehavior,
  loadNotesEnabled,
  subscribeFollowUpBehavior,
  subscribeNotesEnabled,
} from "../lib/settings";
import {
  isNoteMentionPath,
  loadNotes,
  peekNotes,
  rankNoteFiles,
  notesAsProjectFiles,
  type Note,
  type NoteComposerCard,
} from "../lib/notes";
import { resolveTabGroupLogo } from "../lib/tabGroups";
import { useComposerSkills } from "./useComposerSkills";
import { Popover } from "./Popover";
import { RaceChip } from "./RaceChip";
import type { AgentRoleId } from "../lib/agentRoles";
import type { PaletteAgent } from "../lib/commandPalette";
import { RACE_MIN_LANES } from "../lib/race";
import { useRaceAgents } from "./useRaceAgents";
import { loadRaceLaneChoice, nextRaceAgent } from "../lib/raceAgents";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { consumePlanCommand, PLAN_COMMAND } from "../lib/plan";
import {
  consumeOrchestratorCommand,
  ORCHESTRATOR_COMMAND,
} from "../lib/orchestratorCommand";
import { COMPACT_COMMAND, isCompactCommand } from "../lib/compact";
import { consumeDiscussCommand, DISCUSS_COMMAND } from "../lib/discussCommand";
import {
  discussionStore,
  INTERJECTION_CHAR_LIMIT,
  loadDiscussionRounds,
  saveDiscussionRounds,
  type DiscussionHost,
} from "../lib/discussions";
import { useStartedDiscussionId } from "../hooks/useDiscussions";
import { useWidth } from "../hooks/useNarrow";
import { SharedWorkBar } from "./SharedWorkBar";
import {
  DiscussionChip,
  defaultDiscussionPick,
  partnerChoice,
  type DiscussionPick,
} from "./DiscussionChip";
import { composerFit } from "../lib/composerFit";
import { bestDiscussionAgent } from "../lib/discussionPartner";
import { resizeComposer } from "../lib/composerResize";
import { useTurnNoteHint } from "../lib/turnNotes";

type Props = {
  enabled?: boolean;
  focused: boolean;
  shell?: boolean;
  harness: HarnessId;
  model: string;
  modelSettings?: Record<string, string>;
  runtimeMode: RuntimeMode;
  cwd?: string;
  executionCwd: string;
  sessionId?: string;
  branch?: string;
  recents?: RecentProject[];
  hideProjectPicker?: boolean;
  hideBranchPicker?: boolean;
  hideTopBar?: boolean;
  /** What the empty message box says, in place of the usual hint. */
  placeholder?: string;
  /**
   * Leave out the agent pill (its agent, model and access choices): a
   * project's bot always runs Claude, in its own mode.
   */
  hideAgentPill?: boolean;
  context?: ContextUsage;
  compactSupported?: boolean;
  quoteRequest?: QuoteRequest;
  initialDraft?: string;
  initialAttachments?: Attachment[];
  inboxCard?: InboxComposerCard;
  noteCard?: NoteComposerCard;
  handoffCard?: HandoffComposerCard;
  question?: UserQuestionPrompt;
  busy?: boolean;
  queuedMessages?: QueuedMessage[];
  queueStatus?: MessageQueueStatus;
  hotkeys?: boolean;
  onFocus: () => void;
  onCwdChange: (cwd: string) => void;
  onBranchChange?: () => void;
  onNewTerminal?: () => void;
  onModelChange: (harness: HarnessId, model: string) => void;
  onModelSettingsChange?: (settings: Record<string, string>) => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
  onQuoteRequestConsumed?: (id: number) => void;
  onInboxCardDismiss?: () => void;
  onNoteCardDismiss?: () => void;
  onHandoffCardDismiss?: () => void;
  onQuestionReply?: (requestId: number, reply: UserQuestionReply) => void;
  onSubmit: (
    text: string,
    attachments: Attachment[],
    options?: ComposerTurnOptions,
  ) => void | boolean;
  /**
   * Send the message to several agents at once; absent hides Race. Resolves
   * false when the race could not start, so the draft is put back.
   */
  onRace?: (
    text: string,
    attachments: Attachment[],
    agents: PaletteAgent[],
  ) => void | boolean | Promise<boolean>;
  onStop?: () => void;
  onCompactContext?: () => boolean;
  onDeleteQueuedMessage?: (messageId: string) => void;
  onEditQueuedMessage?: (
    messageId: string,
    text: string,
    attachments: Attachment[],
  ) => void;
  onQueuedMessageEditingChange?: (messageId?: string) => void;
  onSteerQueuedMessage?: (messageId: string) => void;
  onResumeQueue?: () => void;
  onOpenFile?: (path: string) => void;
  onDraftChange?: (text: string) => void;
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  /** Starts a discussion with another chat; absent hides Discuss mode. */
  discussion?: DiscussionHost;
  /**
   * The bar of the team this chat started or belongs to, shown at the top
   * of the message box (see `TeamBar`).
   */
  teamBar?: ReactNode;
  /**
   * The bar's Stop stops what this box's own Stop would (a lead's run), so
   * the box shows none while busy.
   */
  stopInBar?: boolean;
  children?: ReactNode;
};

/** Sending into the reply in progress (steering), in plain words. */
const STEER_HINT = "Send now — the agent sees it straight away";

// Loaded on first use: most chats never add a skill from the web.
const AddSkillDialog = retryableLazy(() =>
  import("./AddSkillDialog").then((module) => module.AddSkillDialog),
);

/** Keys an open picker handles on keydown; their keyup must not reopen it. */
const PICKER_KEYS = new Set(["Escape", "Enter", "Tab", "ArrowUp", "ArrowDown"]);

type TokenRange = { start: number; end: number; query: string };

/**
 * A `/` or `@` token closed with Escape. It stays closed while the caret is
 * in that token, so typing on (a path such as `/tmp`, an address such as
 * `@alice`) and Enter send the message. Leaving the token forgets it.
 */
type DismissedToken = {
  kind: "slash" | "mention";
  start: number;
  /** The text before the token, so an edit before it forgets the dismissal. */
  prefix: string;
};

function sameToken<T extends TokenRange>(a: T | null, b: T | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.start === b.start &&
      a.end === b.end &&
      a.query === b.query)
  );
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const NO_FILES: ProjectFile[] = [];

type MentionSources = {
  projectMentionIndex: MentionIndex;
  files: ProjectFile[];
  cwd: string;
};

/**
 * What a request to mention the file at `path` adds: its `@` label in this
 * box, remembered so it still finds the file when sent, or the plain path
 * when no label can name it.
 */
function mentionInsert(
  request: QuoteRequest,
  path: string,
  { projectMentionIndex, files, cwd }: MentionSources,
): QuoteRequest {
  rememberMentionedFile(path);
  const extras = mentionFilesFor(openFilesSnapshot(), files, cwd);
  const key = pathKey(path);
  const file = extras.find((entry) => pathKey(entry.path) === key);
  if (file) {
    const index = withMentionExtras(projectMentionIndex, extras);
    const label = mentionLabel(file, index);
    const named = index.labels.get(label);
    if (named && pathKey(named.path) === key)
      return { ...request, mode: "mention", text: label };
  }
  return { ...request, mode: "plain", text: path };
}

/** One shared empty value, so the agent pill's props stay the same. */
const NO_MODEL_SETTINGS: Record<string, string> = {};

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid size-6.5 shrink-0 place-items-center rounded-md ${
        active
          ? "bg-content/20 text-content"
          : "bg-content/10 text-content/50 hover:bg-content/15 hover:text-content"
      } disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content/50`}
    >
      {children}
    </button>
  );
}

function MessageQueue({
  messages,
  status,
  onDelete,
  onEdit,
  onEditingChange,
  onSteer,
  onResume,
}: {
  messages: QueuedMessage[];
  status?: MessageQueueStatus;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string, attachments: Attachment[]) => void;
  onEditingChange?: (messageId?: string) => void;
  onSteer?: (messageId: string) => void;
  onResume?: () => void;
}) {
  const [editingId, setEditingId] = useState<string>();
  const [editDraft, setEditDraft] = useState("");
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const onEditingChangeRef = useRef(onEditingChange);
  onEditingChangeRef.current = onEditingChange;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;
  useEffect(() => {
    return () => {
      if (editingIdRef.current) onEditingChangeRef.current?.();
    };
  }, []);
  if (messages.length === 0) return null;
  const paused = status === "paused";

  const startEdit = (message: QueuedMessage) => {
    setEditingId(message.id);
    setEditDraft(message.text);
    setEditAttachments(message.attachments);
    onEditingChange?.(message.id);
  };
  const cancelEdit = () => {
    setEditingId(undefined);
    setEditDraft("");
    setEditAttachments([]);
    onEditingChange?.();
  };
  const saveEdit = (message: QueuedMessage) => {
    if (!editDraft.trim() && editAttachments.length === 0) return;
    onEdit?.(message.id, editDraft, editAttachments);
    setEditingId(undefined);
    setEditDraft("");
    setEditAttachments([]);
  };

  return (
    <div className="px-2 text-content/55" data-message-queue>
      <div
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
        data-message-queue-card
      >
        {paused ? (
          <div className="flex h-7 items-center gap-2 border-b border-content/10 text-ui-label">
            <Pause className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">Queue paused</span>
            <button
              type="button"
              onClick={onResume}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content"
            >
              <Play className="size-3.5" />
              Resume
            </button>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const editing = editingId === message.id;
          const label =
            message.text.trim() ||
            `${message.attachments.length} attachment${message.attachments.length === 1 ? "" : "s"}`;
          // While editing, show the draft's attachments so removals are visible.
          const attachments = editing ? editAttachments : message.attachments;
          return (
            <div
              key={message.id}
              className={index > 0 ? "border-t border-content/10" : undefined}
              data-queued-message
            >
              <div className="flex min-h-7 items-center gap-2 text-ui-label">
                <ListEnd className="size-3.5 shrink-0" />
                {editing ? (
                  <>
                    <textarea
                      autoFocus
                      aria-label="Edit queued message"
                      value={editDraft}
                      rows={1}
                      onChange={(event) => setEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (isImeComposition(event.nativeEvent)) return;
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEdit();
                        } else if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          saveEdit(message);
                        }
                      }}
                      className="aven-field min-h-6 min-w-0 flex-1 resize-none px-1.5 py-0.5 text-ui-label"
                    />
                    <button
                      type="button"
                      title="Save queued message"
                      aria-label="Save queued message"
                      disabled={
                        !editDraft.trim() && editAttachments.length === 0
                      }
                      onClick={() => saveEdit(message)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content disabled:opacity-30"
                    >
                      <Check className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Cancel queued message edit"
                      aria-label="Cancel queued message edit"
                      onClick={cancelEdit}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-content/80">
                      {label}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSteer?.(message.id)}
                      disabled={!onSteer}
                      title={
                        !onSteer
                          ? "This agent can't read messages while it works; it gets this one when it finishes"
                          : STEER_HINT
                      }
                      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 hover:bg-content/10 hover:text-content disabled:opacity-40"
                    >
                      <CornerDownRight className="size-3.5" />
                      Send now
                    </button>
                    <button
                      type="button"
                      title="Edit queued message"
                      aria-label="Edit queued message"
                      onClick={() => startEdit(message)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Remove queued message"
                      aria-label="Remove queued message"
                      onClick={() => onDelete?.(message.id)}
                      className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-content/10 hover:text-content"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </div>
              {attachments.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-1.5 pb-1.5 pl-5.5"
                  aria-label="Queued attachments"
                >
                  {attachments.map((attachment, attachmentIndex) => (
                    <AttachmentChip
                      key={`${attachment.path ?? attachment.name}:${attachmentIndex}`}
                      attachment={attachment}
                      group={attachments}
                      onRemove={
                        editing
                          ? () =>
                              setEditAttachments((current) =>
                                current.filter(
                                  (_, index) => index !== attachmentIndex,
                                ),
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoized: the chat pane re-renders for streamed transcript text, which the
 * composer does not display.
 */
export const Composer = memo(ComposerComponent);

function ComposerComponent({
  enabled = true,
  focused,
  hotkeys = false,
  shell = false,
  harness,
  model,
  modelSettings = NO_MODEL_SETTINGS,
  runtimeMode,
  cwd = "~",
  executionCwd,
  sessionId,
  branch,
  recents = [],
  hideProjectPicker = false,
  hideBranchPicker = false,
  hideTopBar = false,
  placeholder,
  hideAgentPill = false,
  context,
  compactSupported = false,
  quoteRequest,
  initialDraft,
  initialAttachments,
  inboxCard,
  noteCard,
  handoffCard,
  question,
  busy = false,
  queuedMessages = [],
  queueStatus,
  onFocus,
  onCwdChange,
  onBranchChange,
  onNewTerminal,
  onModelChange,
  onModelSettingsChange,
  onRuntimeModeChange,
  onQuoteRequestConsumed,
  onInboxCardDismiss,
  onNoteCardDismiss,
  onHandoffCardDismiss,
  onQuestionReply,
  onSubmit,
  onRace,
  onStop,
  onCompactContext,
  onDeleteQueuedMessage,
  onEditQueuedMessage,
  onQueuedMessageEditingChange,
  onSteerQueuedMessage,
  onResumeQueue,
  onOpenFile,
  onDraftChange,
  onAttachmentsChange,
  discussion,
  teamBar,
  stopInBar = false,
  children,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  // How much the controls row can say: in a narrow chat, chips shorten and
  // the agent pill keeps its mark, never cutting a word off.
  const [controlsRef, controlsWidth] = useWidth<HTMLDivElement>();
  const highlightRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef<Attachment[]>(initialAttachments ?? []);
  const draftCallbacks = useRef({ onDraftChange, onAttachmentsChange });
  draftCallbacks.current = { onDraftChange, onAttachmentsChange };
  const consumedQuoteId = useRef<number | null>(null);
  const slashRef = useRef<SlashToken | null>(null);
  const mentionRef = useRef<MentionToken | null>(null);
  const dismissedTokenRef = useRef<DismissedToken | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  // React rewrites a textarea's text node whenever defaultValue changes, and
  // WebKit then resets the field, committing any IME composition. The pane
  // re-renders with the latest draft (often, while a reply streams), so keep
  // the mount-time value; the initialDraft effect applies later changes.
  const [mountDraft] = useState(initialDraft);
  const [hasValue, setHasValue] = useState(
    () =>
      (initialDraft ?? "").trim().length > 0 ||
      (initialAttachments?.length ?? 0) > 0 ||
      !!inboxCard ||
      !!noteCard ||
      !!handoffCard,
  );
  const [attachments, setAttachments] = useState<Attachment[]>(
    () => initialAttachments ?? [],
  );
  const updateDraft = useCallback((text: string) => {
    setDraft(text);
    draftCallbacks.current.onDraftChange?.(text);
  }, []);
  const updateAttachments = useCallback((next: Attachment[]) => {
    attachmentsRef.current = next;
    setAttachments(next);
    draftCallbacks.current.onAttachmentsChange?.(next);
  }, []);
  const [fileDrag, setFileDrag] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [planSelected, setPlanSelected] = useState(false);
  // Race mode: sending gives the message to the lanes the chip shows.
  const [raceOn, setRaceOn] = useState(false);
  const [raceMenuOpen, setRaceMenuOpen] = useState(false);
  const [raceError, setRaceError] = useState<string | null>(null);
  // This chat's agent races on the chat's model unless the Race chip picks
  // another one for it; changing the chat's model starts over.
  const [raceModel, setRaceModel] = useState<string>();
  useEffect(() => setRaceModel(undefined), [harness, model]);
  const { available: raceAvailable, lanes: raceLanes } = useRaceAgents(
    Boolean(onRace),
    harness,
    raceModel ?? model,
  );
  const raceReady = raceLanes.length >= RACE_MIN_LANES;
  /** Turn Race mode on, with the dropdown open when it can't race yet. */
  const startRaceMode = useCallback(
    (openMenu = false) => {
      // The saved lanes' providers may list their models only once asked.
      const saved = [
        ...new Set(loadRaceLaneChoice().map((lane) => lane.harness)),
      ];
      if (saved.length)
        void refreshHarnessCatalogs(saved).catch(() => undefined);
      setRaceOn(true);
      setPlanSelected(false);
      setOrchestrationSelected(false);
      setDiscussSelected(false);
      setDiscussMenuOpen(false);
      setRaceError(null);
      setRaceMenuOpen(openMenu || !raceReady);
    },
    [raceReady],
  );
  const stopRaceMode = useCallback(() => {
    setRaceOn(false);
    setRaceMenuOpen(false);
    setRaceError(null);
    // "For this race only": the chat's own model next time.
    setRaceModel(undefined);
  }, []);
  // A refusal ("Add another agent…") no longer holds once the lanes change.
  const raceLaneKey = raceLanes
    .map((lane) => `${lane.harness}:${lane.model}`)
    .join(",");
  useEffect(() => setRaceError(null), [raceLaneKey]);
  const [orchestrationSelected, setOrchestrationSelected] = useState(false);
  // Discuss mode: sending starts a discussion with the message as its topic.
  const discussAvailable = Boolean(discussion && sessionId && !hideTopBar);
  // The discussion this chat started: while it runs or is paused, what the
  // user sends goes to both chats with the next replies, not to this agent.
  const jumpInId = useStartedDiscussionId(
    discussAvailable ? sessionId : undefined,
  );
  const [discussSelected, setDiscussSelected] = useState(false);
  const discussActive = discussAvailable && discussSelected;
  // What Aven left for this agent's next turn ("Codex knows which version
  // you kept"), said in the empty field until that turn takes it.
  const noteHint = useTurnNoteHint(sessionId);
  const [discussPick, setDiscussPick] = useState<DiscussionPick | null>(null);
  const [discussRounds, setDiscussRounds] = useState(loadDiscussionRounds);
  // The partner's role is for the next discussion only, never remembered.
  const [discussRole, setDiscussRole] = useState<AgentRoleId>();
  const [discussMenuOpen, setDiscussMenuOpen] = useState(false);
  const [discussError, setDiscussError] = useState<string | null>(null);
  const discussPickRef = useRef(discussPick);
  discussPickRef.current = discussPick;
  /**
   * Turn Discuss mode on, with the partner it had, else a new chat with the
   * best other agent (see `defaultDiscussionPick`).
   */
  const startDiscussMode = useCallback(
    (openMenu = false) => {
      if (!discussion || !sessionId) return;
      const pick = defaultDiscussionPick(
        discussion,
        sessionId,
        discussPickRef.current,
        bestDiscussionAgent(harness),
      );
      setDiscussPick(pick);
      setDiscussSelected(true);
      setPlanSelected(false);
      setOrchestrationSelected(false);
      setRaceOn(false);
      setRaceMenuOpen(false);
      setDiscussError(null);
      // Nobody to talk to yet: the dropdown offers a new chat.
      setDiscussMenuOpen(openMenu || !pick);
    },
    [discussion, sessionId, harness],
  );
  const stopDiscussMode = useCallback(() => {
    setDiscussSelected(false);
    setDiscussMenuOpen(false);
    setDiscussError(null);
    setDiscussRole(undefined);
  }, []);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  // The highlighted `/` row, for the list it was chosen in (see skillActive).
  const [skillCursor, setSkillCursor] = useState<{
    list: string;
    index: number;
  } | null>(null);
  const [recentSkills, setRecentSkills] = useState<readonly string[]>(() =>
    loadRecentSkills(cwd),
  );
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [addingSkill, setAddingSkill] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>(
    () => peekLastProjectFiles(cwd) ?? NO_FILES,
  );
  const notesEnabled = useSyncExternalStore(
    subscribeNotesEnabled,
    loadNotesEnabled,
    () => true,
  );
  const followUpBehavior = useSyncExternalStore(
    subscribeFollowUpBehavior,
    loadFollowUpBehavior,
    () => "queue" as const,
  );
  const draftPlanning = consumePlanCommand(draft).planning;
  // A typed /orchestrator works like choosing Orchestrator, where it exists.
  const draftOrchestrating =
    !hideTopBar && !draftPlanning && consumeOrchestratorCommand(draft).matched;
  // Race, Plan mode, Orchestrator and Discuss are exclusive; a typed /plan
  // or /orchestrator wins over Race.
  // While this chat's discussion runs, what you send goes to both of its
  // chats, so no mode applies and none is offered.
  const raceActive =
    raceOn &&
    !!onRace &&
    !jumpInId &&
    !draftPlanning &&
    !draftOrchestrating &&
    !planSelected &&
    !orchestrationSelected &&
    !discussActive;
  const fit = composerFit(
    controlsWidth,
    !jumpInId &&
      (raceActive || discussActive || planSelected || orchestrationSelected),
  );
  const focusField = useCallback(() => ref.current?.focus(), []);
  const queueSubmission = shouldEnqueueSubmission(
    { harness, busy: Boolean(busy), queuedMessages },
    planSelected || orchestrationSelected || draftPlanning || draftOrchestrating
      ? "queue"
      : followUpBehavior,
  );
  const [notes, setNotes] = useState<Note[]>(() => peekNotes() ?? []);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  const [runnerEnabled, setRunnerEnabled] = useState(loadComposerRunner);
  const [runnerLive, setRunnerLive] = useState(
    () => busy && loadComposerRunner(),
  );
  const groupLogos = useTabGroupLogos();
  const projectLogoPath = resolveTabGroupLogo(projectKey(cwd), groupLogos);

  slashRef.current = slash;
  mentionRef.current = mention;

  attachmentsRef.current = attachments;

  // Files open in tabs (and ones mentioned from them) are offered by `@` and
  // highlighted in the text. Only a box with an `@` follows them, so opening
  // a tab does not re-render every chat.
  const followOpenFiles = mention !== null || draft.includes("@");
  const knownFiles = useSyncExternalStore(
    subscribeOpenFiles,
    () => (followOpenFiles ? openFilesSnapshot() : NO_OPEN_FILES),
    () => NO_OPEN_FILES,
  );
  const mentionOpen =
    mention !== null &&
    (looksLikeProject(cwd) || notesEnabled || knownFiles.open.length > 0);
  const navigationEmpty =
    draft.length === 0 &&
    attachments.length === 0 &&
    !inboxCard &&
    !noteCard &&
    !handoffCard;
  const attachmentsOnly = attachments.length > 0 && draft.trim().length === 0;
  const pickerOpen = creatingSkill || slash !== null;
  const skillCatalog = useComposerSkills({
    harness,
    executionCwd,
    sessionId,
    pickerOpen,
  });
  const skills = skillCatalog.skills;
  const slashItems = useMemo(
    () => [
      PLAN_COMMAND,
      // Orchestrator mode is only offered where its + menu toggle is.
      ...(hideTopBar ? [] : [ORCHESTRATOR_COMMAND]),
      ...(discussAvailable ? [DISCUSS_COMMAND] : []),
      ...(compactSupported ? [COMPACT_COMMAND] : []),
      ...skills.filter(
        (skill) =>
          skill.kind === "native" ||
          (skill.name !== PLAN_COMMAND.name &&
            skill.name !== COMPACT_COMMAND.name &&
            (hideTopBar || skill.name !== ORCHESTRATOR_COMMAND.name) &&
            (!discussAvailable || skill.name !== DISCUSS_COMMAND.name)),
      ),
    ],
    [compactSupported, discussAvailable, hideTopBar, skills],
  );
  const skillLimit = hasNativeCommands(harness)
    ? Number.POSITIVE_INFINITY
    : undefined;
  // Ranking a native command catalog is not free; only do it while `/` is open.
  const slashQuery = slash?.query;
  const rankedSkills = useMemo(
    () =>
      slashQuery === undefined
        ? []
        : rankSkillMatches(slashItems, slashQuery, {
            limit: skillLimit,
            recent: recentSkills,
          }),
    [slashItems, slashQuery, skillLimit, recentSkills],
  );
  // A new query or list starts on the first match, or on no row when nothing
  // matches, so Enter sends the message instead of opening "Create skill".
  const skillList = `${cwd}\0${slashQuery ?? ""}\0${rankedSkills.length}`;
  const skillListRef = useRef(skillList);
  skillListRef.current = skillList;
  const skillActive =
    skillCursor?.list === skillList
      ? skillCursor.index
      : rankedSkills.length > 0
        ? 0
        : -1;
  // Every match, then the closing "Create skill" and "Add a skill" rows.
  const skillRows = rankedSkills.length + SKILL_ACTION_ROWS;
  const setSkillActive = useCallback(
    (index: number) => setSkillCursor({ list: skillListRef.current, index }),
    [],
  );
  const slashOpen = slash !== null;
  useEffect(() => {
    // Each opening starts on the first row.
    if (!slashOpen) setSkillCursor(null);
  }, [cwd, slashOpen]);
  // Follow this project's list as any pane or window uses a skill.
  useEffect(() => {
    const refresh = () => {
      const next = loadRecentSkills(cwd);
      setRecentSkills((current) =>
        sameStrings(current, next) ? current : next,
      );
    };
    refresh();
    return subscribeRecentSkills(refresh);
  }, [cwd]);
  const rememberUsedSkills = useCallback(
    (invocations: string[]) => {
      if (invocations.length === 0) return;
      const next = rememberRecentSkills(cwd, invocations);
      setRecentSkills((current) =>
        sameStrings(current, next) ? current : next,
      );
    },
    [cwd],
  );
  const attachmentsSupported = harnessSupportsAttachments(harness);
  const skillNames = useMemo(
    () => new Set(slashItems.map((skill) => skill.invocation)),
    [slashItems],
  );
  // Recent skills that this chat can still run, most recent first.
  const recentSkillChips = useMemo(() => {
    const byInvocation = new Map(
      slashItems.map((skill) => [skill.invocation, skill]),
    );
    return recentSkills
      .map((invocation) => byInvocation.get(invocation))
      .filter((skill): skill is Skill => skill !== undefined)
      .slice(0, RECENT_SKILL_CHIPS);
  }, [recentSkills, slashItems]);
  const mentionFiles = useMemo(
    () => (notesEnabled ? [...files, ...notesAsProjectFiles(notes)] : files),
    [files, notes, notesEnabled],
  );
  const projectMentionIndex = useMemo(
    () => buildMentionIndex(mentionFiles),
    [mentionFiles],
  );
  const mentionExtras = useMemo(
    () => mentionFilesFor(knownFiles, files, cwd),
    [cwd, files, knownFiles],
  );
  const mentionIndex = useMemo(
    () => withMentionExtras(projectMentionIndex, mentionExtras),
    [mentionExtras, projectMentionIndex],
  );
  const mentionIndexRef = useRef<MentionIndex>(mentionIndex);
  mentionIndexRef.current = mentionIndex;
  const mentionSourcesRef = useRef({ projectMentionIndex, files, cwd });
  mentionSourcesRef.current = { projectMentionIndex, files, cwd };
  const rankedFiles = useMemo(() => {
    if (!mentionOpen) return [];
    const query = mention?.query ?? "";
    // Files open in tabs first, wherever they are, then notes and the project.
    const openHits = rankOpenMentionFiles(mentionExtras, query);
    const fileHits = looksLikeProject(cwd)
      ? rankMentionFiles(files, query, recentOpenedFiles(cwd))
      : [];
    const noteHits = notesEnabled ? rankNoteFiles(notes, query) : [];
    const seen = new Set(openHits.map((file) => file.path));
    const rest = [...noteHits, ...fileHits].filter((file) => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    });
    return [...openHits, ...rest];
  }, [
    cwd,
    files,
    mention?.query,
    mentionExtras,
    mentionOpen,
    notes,
    notesEnabled,
  ]);

  const syncHasValue = useCallback(
    (text: string, files: Attachment[]) => {
      setHasValue(
        text.trim().length > 0 ||
          files.length > 0 ||
          !!inboxCard ||
          !!noteCard ||
          !!handoffCard,
      );
    },
    [inboxCard, noteCard, handoffCard],
  );

  useEffect(() => {
    syncHasValue(ref.current?.value ?? "", attachmentsRef.current);
  }, [inboxCard, noteCard, handoffCard, syncHasValue]);

  const addAttachments = useCallback(
    (incoming: Attachment[]) => {
      if (!harnessSupportsAttachments(harness) || incoming.length === 0) return;
      setAttachmentError(null);
      const next = mergeAttachments(attachmentsRef.current, incoming);
      const rejected = incoming.filter((file) => !next.includes(file));
      const overflow = rejected.some(
        (file) =>
          !next.some(
            (kept) =>
              kept.id === file.id || (kept.path && kept.path === file.path),
          ),
      );
      for (const file of rejected) {
        if (!next.some((kept) => kept.previewUrl === file.previewUrl))
          revokeAttachment(file);
      }
      if (overflow)
        setAttachmentError(
          `You can attach up to ${MAX_ATTACHMENTS} files. Remove a file before adding another.`,
        );
      updateAttachments(next);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [harness, syncHasValue, updateAttachments],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      const removed = attachmentsRef.current.find((file) => file.id === id);
      if (removed) revokeAttachment(removed);
      const next = attachmentsRef.current.filter((file) => file.id !== id);
      updateAttachments(next);
      syncHasValue(ref.current?.value ?? "", next);
      ref.current?.focus();
    },
    [syncHasValue, updateAttachments],
  );

  useEffect(() => {
    return () => {
      for (const file of attachmentsRef.current) revokeAttachment(file);
    };
  }, []);

  useEffect(() => {
    if (harnessSupportsAttachments(harness)) return;
    if (attachmentsRef.current.length === 0) return;
    for (const file of attachmentsRef.current) revokeAttachment(file);
    updateAttachments([]);
    syncHasValue(ref.current?.value ?? "", []);
  }, [harness, syncHasValue, updateAttachments]);

  useEffect(() => {
    const refresh = () => setRunnerEnabled(loadComposerRunner());
    window.addEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
    return () =>
      window.removeEventListener(COMPOSER_RUNNER_CHANGE_EVENT, refresh);
  }, []);

  useEffect(() => {
    if (!runnerEnabled) {
      setRunnerLive(false);
      return;
    }
    if (busy) setRunnerLive(true);
  }, [busy, runnerEnabled]);

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    // A new list rebuilds the `@` index; let typing take priority over it.
    const apply = (next: ProjectFile[]) => {
      if (cancelled) return;
      startTransition(() =>
        setFiles((current) =>
          current.length === 0 && next.length === 0 ? current : next,
        ),
      );
    };
    // Show the last listing at once; rescan only when it is a few seconds
    // old. Directory changes invalidate it and rescan in the background.
    const known = peekLastProjectFiles(cwd);
    if (known) apply(known);
    void loadProjectFilesIfStale(cwd)
      .then(apply)
      .catch(() => undefined);
    const unsub = subscribeProjectFiles(() => {
      const next = peekProjectFiles(cwd);
      if (next) apply(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [cwd, mentionOpen]);

  useEffect(() => {
    if (!mentionOpen || !notesEnabled) return;
    let cancelled = false;
    void loadNotes()
      .then((next) => {
        if (!cancelled) setNotes(next);
      })
      // Suggestions are optional; retain the last list and retry on reopening.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, notesEnabled]);

  useEffect(() => {
    setMentionActive(0);
  }, [mention?.query, cwd]);

  useEffect(() => {
    setMentionActive((index) =>
      rankedFiles.length === 0 ? 0 : Math.min(index, rankedFiles.length - 1),
    );
  }, [rankedFiles.length]);

  useLayoutEffect(() => {
    // Attachment mode changes the field's padding and empty height. Measure
    // after those styles commit, without changing any of the saved draft.
    if (ref.current) resizeComposer(ref.current);
  }, [attachmentsOnly]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !initialDraft) return;
    if (el.value !== initialDraft) el.value = initialDraft;
    resizeComposer(el);
  }, [initialDraft]);

  const syncHighlightScroll = useCallback((el: HTMLTextAreaElement) => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    // The textarea can scroll itself to keep the caret visible before React
    // commits the updated highlight text. Sync again after that commit, when
    // the overlay has enough scrollable content to accept the same offset.
    syncHighlightScroll(el);
    const frame = requestAnimationFrame(() => {
      if (ref.current === el) syncHighlightScroll(el);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft, syncHighlightScroll]);

  // Input, select, keyup and click all land here for one keystroke. Keeping
  // an unchanged token object lets the repeats skip a composer render.
  const syncTokensFromTextarea = (el: HTMLTextAreaElement) => {
    if (creatingSkill) return;
    // What goes to both chats of a discussion is plain text: a skill or a
    // reference would arrive as its literal name.
    if (jumpInId) {
      setSlash(null);
      setMention(null);
      return;
    }
    const text = el.value;
    const cursor = el.selectionStart ?? 0;
    let slashToken = slashTokenAt(text, cursor, hasNativeCommands(harness));
    let mentionToken = slashToken ? null : mentionTokenAt(text, cursor);
    const dismissed = dismissedTokenRef.current;
    if (dismissed) {
      const token = dismissed.kind === "slash" ? slashToken : mentionToken;
      if (
        token?.start === dismissed.start &&
        text.slice(0, token.start) === dismissed.prefix
      ) {
        if (dismissed.kind === "slash") slashToken = null;
        else mentionToken = null;
      } else {
        dismissedTokenRef.current = null;
      }
    }
    setSlash((current) =>
      sameToken(current, slashToken) ? current : slashToken,
    );
    setMention((current) =>
      sameToken(current, mentionToken) ? current : mentionToken,
    );
  };

  const dismissToken = (
    kind: DismissedToken["kind"],
    token: TokenRange,
    text: string,
  ) => {
    dismissedTokenRef.current = {
      kind,
      start: token.start,
      prefix: text.slice(0, token.start),
    };
  };

  useEffect(() => {
    const el = ref.current;
    if (
      !el ||
      !quoteRequest ||
      (consumedQuoteId.current !== null &&
        quoteRequest.id <= consumedQuoteId.current)
    )
      return;

    const result = consumeQuoteRequest(
      el.value,
      consumedQuoteId.current,
      quoteRequest.mention === undefined
        ? quoteRequest
        : mentionInsert(
            quoteRequest,
            quoteRequest.mention,
            mentionSourcesRef.current,
          ),
    );
    consumedQuoteId.current = result.consumedId;
    if (result.changed) {
      el.value = result.draft;
      resizeComposer(el);
      updateDraft(result.draft);
      syncHasValue(result.draft, attachmentsRef.current);
      dismissedTokenRef.current = null;
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      el.setSelectionRange(result.draft.length, result.draft.length);
      el.focus();
    }
    if (quoteRequest.attachments?.length) {
      addAttachments(quoteRequest.attachments);
    }
    onQuoteRequestConsumed?.(quoteRequest.id);
  }, [
    addAttachments,
    onQuoteRequestConsumed,
    quoteRequest,
    syncHasValue,
    updateDraft,
  ]);

  /** Put `skill` in place of `token`, or switch mode for plan/orchestrator. */
  const applySkill = useCallback(
    (el: HTMLTextAreaElement, skill: Skill, token: SlashToken) => {
      const planCommand =
        skill.kind === "builtin" && skill.name === PLAN_COMMAND.name;
      const orchestratorCommand =
        skill.kind === "builtin" && skill.name === ORCHESTRATOR_COMMAND.name;
      const discussCommand =
        skill.kind === "builtin" && skill.name === DISCUSS_COMMAND.name;
      // Mode commands switch the mode and leave only the request in the field.
      const modeCommand = planCommand || orchestratorCommand || discussCommand;
      const next = modeCommand
        ? `${el.value.slice(0, token.start)}${el.value
            .slice(token.end)
            .replace(/^\s/, "")}`
        : replaceSlashToken(el.value, token, skill.invocation);
      el.value = next;
      resizeComposer(el);
      let cursor = modeCommand
        ? token.start
        : token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      updateDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setSlash(null);
      setCreatingSkill(false);
      rememberUsedSkills([skill.invocation]);
      if (planCommand) {
        setPlanSelected(true);
        setOrchestrationSelected(false);
        stopRaceMode();
        setDiscussSelected(false);
      }
      if (orchestratorCommand) {
        setOrchestrationSelected(true);
        setPlanSelected(false);
        stopRaceMode();
        setDiscussSelected(false);
      }
      // The rest of the message becomes the discussion's topic.
      if (discussCommand) startDiscussMode();
      el.focus();
    },
    [
      rememberUsedSkills,
      startDiscussMode,
      stopRaceMode,
      syncHasValue,
      updateDraft,
    ],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      const el = ref.current;
      const token = slashRef.current;
      if (!el || !token) {
        setSlash(null);
        setCreatingSkill(false);
        return;
      }
      applySkill(el, skill, token);
    },
    [applySkill],
  );

  // A recent-skill chip starts the empty message with that skill.
  const pickRecentSkill = useCallback(
    (skill: Skill) => {
      const el = ref.current;
      if (!el) return;
      const text = el.value;
      const blank = text.trim().length === 0;
      if (!blank && !/\s$/.test(text)) {
        el.value = `${text} `;
      }
      const start = blank ? 0 : el.value.length;
      applySkill(el, skill, { start, end: el.value.length, query: "" });
    },
    [applySkill],
  );

  const startCreatingSkill = useCallback(() => {
    setCreatingSkill(true);
    setCreateError(null);
  }, []);

  const startAddingSkill = useCallback(() => setAddingSkill(true), []);

  const pickMention = useCallback(
    (file: MentionFile) => {
      const el = ref.current;
      const token = mentionRef.current;
      if (!el || !token) {
        setMention(null);
        return;
      }
      // Its tab may close before sending; the label must still find it.
      if (file.open || file.unlisted) rememberMentionedFile(file.path);
      const label = isNoteMentionPath(file.path)
        ? file.relative
        : mentionLabel(file, mentionIndexRef.current);
      const next = replaceMentionToken(el.value, token, label);
      el.value = next;
      resizeComposer(el);
      let cursor = token.start + label.length + 1;
      if (next[cursor] === " ") cursor += 1;
      el.setSelectionRange(cursor, cursor);
      updateDraft(next);
      syncHasValue(next, attachmentsRef.current);
      setMention(null);
      el.focus();
    },
    [syncHasValue, updateDraft],
  );

  useEffect(() => {
    if (!focused) return;
    if (
      document.querySelector(
        "[data-model-picker], [data-access-picker], [data-file-picker], [data-branch-picker], [data-cwd-picker], [data-context-actions], [data-skill-picker], [data-mention-picker], [data-composer-plus], [data-discussion-menu]",
      )
    )
      return;
    ref.current?.focus();
  }, [focused]);

  useEffect(() => {
    if (!enabled) {
      setFileDrag(false);
      return;
    }
    // WebKit routes the drop to the actual pane, including app zoom, Retina
    // displays and detached windows. A parallel native path consumes some
    // image drags and reports coordinates in a different space.
    const root =
      boxRef.current?.closest<HTMLElement>("[data-session-drop]") ??
      boxRef.current;
    let cancelled = false;

    const onDragOver = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFileTransfer(data)) return;
      event.preventDefault();
      data.dropEffect = attachmentsSupported ? "copy" : "none";
      if (!attachmentsSupported) return;
      setFileDrag(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!root) return;
      const next = event.relatedTarget as Node | null;
      if (next && root.contains(next)) return;
      setFileDrag(false);
    };
    const onDrop = (event: DragEvent) => {
      const data = event.dataTransfer;
      if (!hasFileTransfer(data)) return;
      event.preventDefault();
      setFileDrag(false);
      if (!attachmentsSupported) return;
      // Read both lists synchronously, before WebKit clears the drag store.
      const files = filesFromClipboard(data);
      if (files.length === 0) {
        setAttachmentError(
          "No file was received. Save the image first, then drag it here.",
        );
        return;
      }
      setAttachmentError(null);
      void attachmentsFromFiles(files)
        .then((incoming) => {
          if (cancelled) {
            incoming.forEach(revokeAttachment);
            return;
          }
          addAttachments(incoming);
          if (incoming.length < files.length) {
            setAttachmentError(
              "Some files couldn't be attached. Try the attachment picker or a smaller file.",
            );
          }
        })
        .catch(() => {
          if (!cancelled)
            setAttachmentError(
              "Couldn't attach these files. Try the attachment picker.",
            );
        });
    };

    root?.addEventListener("dragover", onDragOver);
    root?.addEventListener("dragleave", onDragLeave);
    root?.addEventListener("drop", onDrop);

    return () => {
      cancelled = true;
      root?.removeEventListener("dragover", onDragOver);
      root?.removeEventListener("dragleave", onDragLeave);
      root?.removeEventListener("drop", onDrop);
    };
  }, [addAttachments, attachmentsSupported, enabled]);

  /** Why sending would not start the race, or null. */
  const raceReason = (task: string): string | null => {
    // A card is consumed by a normal send; a race would leave it attached.
    if (inboxCard || noteCard || handoffCard)
      return "Send or remove the attached card before racing.";
    if (raceLanes.length < RACE_MIN_LANES)
      return raceAvailable.some((agent) =>
        nextRaceAgent(raceAvailable, raceLanes, agent.harness),
      )
        ? "Add another agent or model above to race."
        : "Install or enable another agent to race.";
    if (!task.trim()) return "Type the task in the message box, then send.";
    // Every lane gets the attachments: none may race without them.
    if (attachmentsRef.current.length) {
      const without = raceLanes.find(
        (lane) => !harnessSupportsAttachments(lane.harness),
      );
      if (without)
        return `${appName(without.harness)} can't take attachments. Remove them, or leave it out of the race.`;
    }
    return null;
  };

  /** Why sending would not start the discussion yet, or null. */
  const discussReason = (topic: string): string | null =>
    !discussPick
      ? "Choose a chat to discuss with."
      : !topic.trim()
        ? "Type the topic in the message box, then send."
        : attachmentsRef.current.length
          ? "A discussion starts from text only. Remove the attachments to start."
          : null;

  /** Send with Discuss mode on: start it, with the message as the topic. */
  const startDiscussion = (value: string, preview = false) => {
    if (!discussion || !sessionId) return;
    const topic = value.trim();
    const reason = discussReason(preview ? topic || "Preview" : topic);
    if (reason || !discussPick) {
      setDiscussError(reason);
      setDiscussMenuOpen(true);
      return;
    }
    const failure = discussion.start({
      sessionId,
      partner: partnerChoice(discussPick),
      topic: preview ? topic || "Preview" : topic,
      rounds: discussRounds,
      ...(discussRole ? { role: discussRole } : {}),
      ...(preview ? { preview: true } : {}),
    });
    if (failure) {
      setDiscussError(failure);
      setDiscussMenuOpen(true);
      return;
    }
    stopDiscussMode();
    setSlash(null);
    setMention(null);
    // A preview sends nothing, so the draft stays.
    if (!preview) clearField();
  };

  /** Send with this chat's discussion running: add it for both chats. */
  const jumpIn = (discussionId: string, value: string) => {
    if (!value.trim()) return;
    if (attachmentsRef.current.length) {
      setCommandNotice(
        "Messages for both chats are text only. Remove the attachments to send.",
      );
      return;
    }
    // A command would reach both agents as text, not run. A path such as
    // "/Users/me/app.ts" is not a command.
    if (/^\/[A-Za-z][\w:-]*(?:\s|$)/.test(value.trim())) {
      setCommandNotice(
        "Commands aren't sent to both chats. Send it once the discussion ends, or stop it first.",
      );
      return;
    }
    if (value.length > INTERJECTION_CHAR_LIMIT) {
      setCommandNotice(
        `Messages for both chats are limited to ${INTERJECTION_CHAR_LIMIT.toLocaleString("en-US")} characters; this one has ${value.length.toLocaleString("en-US")}. Shorten it to send.`,
      );
      return;
    }
    const refused = discussionStore().interject(discussionId, value);
    if (refused) {
      setCommandNotice(refused);
      return;
    }
    setCommandNotice(null);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    clearField();
  };

  const submit = (value: string) => {
    if (jumpInId) {
      jumpIn(jumpInId, value);
      return;
    }
    if (discussAvailable) {
      // A typed /discuss turns Discuss mode on; the rest is the topic.
      const discussCommand = consumeDiscussCommand(value);
      if (discussCommand.matched) {
        const el = ref.current;
        if (el) {
          el.value = discussCommand.topic;
          resizeComposer(el);
          el.setSelectionRange(el.value.length, el.value.length);
        }
        updateDraft(discussCommand.topic);
        syncHasValue(discussCommand.topic, attachmentsRef.current);
        setSlash(null);
        setMention(null);
        startDiscussMode();
        return;
      }
      if (discussActive) {
        startDiscussion(value);
        return;
      }
    }
    if (isCompactCommand(value)) {
      if (!onCompactContext) return;
      if (!onCompactContext()) {
        setCommandNotice("Wait for the current reply to finish, then compact.");
        return;
      }
      setCommandNotice(null);
      if (!ref.current) return;
      ref.current.value = "";
      ref.current.style.height = "auto";
      dismissedTokenRef.current = null;
      updateDraft("");
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      setCreatingSkill(false);
      setCreateError(null);
      syncHasValue("", attachments);
      return;
    }

    const command = consumePlanCommand(value);
    const orchestratorCommand =
      !hideTopBar && !command.planning
        ? consumeOrchestratorCommand(command.text)
        : { text: command.text, matched: false };
    const orchestrating = orchestrationSelected || orchestratorCommand.matched;
    const text = isNativeCommandPrompt(orchestratorCommand.text, harness)
      ? orchestratorCommand.text
      : composeInboxMessage(inboxCard, orchestratorCommand.text);
    const files = attachments;
    if (!text && files.length === 0 && !noteCard && !handoffCard) return;
    if (
      raceActive &&
      onRace &&
      !command.planning &&
      !orchestratorCommand.matched
    ) {
      // Race mode never sends normally: it says what's missing instead.
      const reason = raceReason(text);
      if (reason) {
        setRaceError(reason);
        setRaceMenuOpen(true);
        return;
      }
      stopRaceMode();
      setPlusOpen(false);
      setSlash(null);
      setMention(null);
      clearField();
      rememberUsedSkills(skillsUsedIn(value));
      // Clear at once so sending feels instant; put the draft back if the
      // race could not start and the field is still empty.
      void Promise.resolve(onRace(text, files, raceLanes)).then((started) => {
        const el = ref.current;
        if (
          started !== false ||
          !el ||
          el.value ||
          attachmentsRef.current.length
        )
          return;
        el.value = value;
        resizeComposer(el);
        updateDraft(value);
        updateAttachments(files);
        syncHasValue(value, files);
        // As it was: the error said why, so sending can race again.
        setRaceOn(true);
      });
      return;
    }
    const accepted = onSubmit(text, files, {
      intent:
        planSelected || command.planning
          ? "plan"
          : orchestrating
            ? "orchestrate"
            : "default",
      ...(busy || queuedMessages.length
        ? {
            followUpBehavior:
              planSelected || orchestrating || command.planning
                ? "queue"
                : followUpBehavior,
          }
        : {}),
    });
    if (accepted === false) return;
    rememberUsedSkills(skillsUsedIn(value));
    if (!ref.current) return;
    clearField();
    setPlanSelected(false);
    setOrchestrationSelected(false);
    setPlusOpen(false);
    setSlash(null);
    setMention(null);
    setCreatingSkill(false);
    setCreateError(null);
  };

  const skillsUsedIn = (text: string) =>
    skillNamesInText(text).filter((name) => skillNames.has(name));

  const clearField = () => {
    if (!ref.current) return;
    ref.current.value = "";
    ref.current.style.height = "auto";
    dismissedTokenRef.current = null;
    updateDraft("");
    updateAttachments([]);
    syncHasValue("", []);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(e.nativeEvent)) return;
    if (creatingSkill) return;

    if (mentionOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive((index) => (index + 1) % rankedFiles.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (rankedFiles.length === 0) return;
        setMentionActive(
          (index) => (index - 1 + rankedFiles.length) % rankedFiles.length,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (mention) dismissToken("mention", mention, e.currentTarget.value);
        setMention(null);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const file = rankedFiles[mentionActive];
        if (file) pickMention(file);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const file = rankedFiles[mentionActive];
        if (file) {
          e.preventDefault();
          pickMention(file);
          return;
        }
        setMention(null);
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      isCompactCommand(e.currentTarget.value)
    ) {
      e.preventDefault();
      submit(e.currentTarget.value);
      return;
    }

    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSkillActive((skillActive + 1) % skillRows);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSkillActive(skillActive <= 0 ? skillRows - 1 : skillActive - 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismissToken("slash", slash, e.currentTarget.value);
        setSlash(null);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        const match = rankedSkills[skillActive];
        if (match) {
          e.preventDefault();
          pickSkill(match.skill);
          return;
        }
        if (skillActive === rankedSkills.length) {
          e.preventDefault();
          startCreatingSkill();
          return;
        }
        if (skillActive === rankedSkills.length + 1) {
          e.preventDefault();
          startAddingSkill();
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          return;
        }
        // Nothing highlighted (no match): Enter sends the message as typed.
        setSlash(null);
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(e.currentTarget.value);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    if (!attachmentsSupported) return;
    void attachmentsFromFiles(files)
      .then((incoming) => {
        addAttachments(incoming);
        if (incoming.length < files.length)
          setAttachmentError(
            "Some files couldn't be saved. Try attaching them again.",
          );
      })
      .catch(() =>
        setAttachmentError("Couldn't save these attachments. Try again."),
      );
  };

  const attachFromPicker = () => {
    if (!attachmentsSupported) return;
    void pickAttachments()
      .then((files) => {
        addAttachments(files);
        ref.current?.focus();
      })
      .catch(() =>
        setAttachmentError("Couldn't attach these files. Try again."),
      );
  };

  return (
    <div
      data-composer
      className={`personal-composer relative shrink-0 ${shell ? "" : "p-1.5 pt-0"}`}
      onMouseDown={onFocus}
    >
      {question && onQuestionReply ? (
        <QuestionForm prompt={question} onReply={onQuestionReply} />
      ) : null}
      {/* The team this chat started or belongs to (see TeamBar). */}
      {teamBar}
      <SharedWorkBar sessionId={sessionId} />
      {children}
      <MessageQueue
        messages={queuedMessages}
        status={queueStatus}
        onDelete={onDeleteQueuedMessage}
        onEdit={onEditQueuedMessage}
        onEditingChange={onQueuedMessageEditingChange}
        onSteer={
          busy && shouldQueueFollowUp(harness, "steer")
            ? undefined
            : onSteerQueuedMessage
        }
        onResume={onResumeQueue}
      />
      <div className="relative overflow-visible">
        {pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <SkillPicker
              skills={rankedSkills}
              query={slash?.query ?? ""}
              active={skillActive}
              creating={creatingSkill}
              cwd={executionCwd}
              error={createError}
              busy={createBusy}
              onActive={setSkillActive}
              onPick={pickSkill}
              onStartCreate={startCreatingSkill}
              onStartAdd={startAddingSkill}
              onCancelCreate={() => {
                setCreatingSkill(false);
                setCreateError(null);
                const el = ref.current;
                if (el) syncTokensFromTextarea(el);
                el?.focus();
              }}
              onCreate={(name, scope) => {
                setCreateBusy(true);
                setCreateError(null);
                // Where the agent runs and the skill list is read: a race
                // lane or worktree chat gets it in its own copy.
                void createBlankSkill({ cwd: executionCwd, name, scope })
                  .then((path) => {
                    const el = ref.current;
                    const token = slashRef.current;
                    if (el && token) {
                      const rest = el.value.slice(token.end).replace(/^\s/, "");
                      const next = `${el.value.slice(0, token.start)}${rest}`;
                      el.value = next;
                      resizeComposer(el);
                      el.setSelectionRange(token.start, token.start);
                      updateDraft(next);
                      syncHasValue(next, attachments);
                    }
                    setCreatingSkill(false);
                    setSlash(null);
                    setCreateError(null);
                    void skillCatalog
                      .refresh({ refresh: true })
                      .catch(() => undefined);
                    onOpenFile?.(path);
                    el?.focus();
                  })
                  .catch((err: unknown) => {
                    setCreateError(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setCreateBusy(false));
              }}
            />
          </div>
        ) : null}
        {addingSkill ? (
          <Suspense fallback={null}>
            <AddSkillDialog
              cwd={executionCwd}
              onClose={() => setAddingSkill(false)}
              // Installed where this chat's agent works, like Create skill.
              onInstalled={() =>
                void skillCatalog
                  .refresh({ refresh: true })
                  .catch(() => undefined)
              }
            />
          </Suspense>
        ) : null}
        {mentionOpen && !pickerOpen ? (
          <div className="absolute inset-x-0 bottom-full z-30 mb-1">
            <FileMentionPicker
              files={rankedFiles}
              query={mention?.query ?? ""}
              active={mentionActive}
              loading={
                looksLikeProject(cwd) && peekLastProjectFiles(cwd) == null
              }
              includeNotes={notesEnabled}
              onActive={setMentionActive}
              onPick={pickMention}
            />
          </div>
        ) : null}
        <div
          ref={boxRef}
          data-composer-box
          data-tour="composer"
          data-file-drag={fileDrag || undefined}
          data-attachments-only={attachmentsOnly || undefined}
          className={`relative z-10 rounded-lg border bg-content/3 ${
            fileDrag
              ? "border-content/40"
              : "border-content/10 has-focus:border-content/20"
          }`}
        >
          {fileDrag ? (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg bg-content/6 text-ui-label text-content/70">
              Drop files to attach
            </div>
          ) : null}
          {attachmentError || commandNotice ? (
            <p role="alert" className="px-3 pt-2 text-ui-label text-content/80">
              {attachmentError ?? commandNotice}
            </p>
          ) : null}
          {hideTopBar ? null : (
            <div className="personal-composer-project flex min-w-0 items-center gap-2.5 px-3 pt-2.5">
              {hideProjectPicker ? null : (
                <CwdPicker
                  cwd={cwd}
                  recents={recents}
                  projectLogoPath={projectLogoPath}
                  enabled={enabled}
                  onCwdChange={onCwdChange}
                  onNewTerminal={onNewTerminal}
                  onClose={() => ref.current?.focus()}
                />
              )}
              {hideBranchPicker ? null : (
                <BranchPicker
                  cwd={cwd}
                  branch={branch}
                  enabled={enabled && !busy}
                  onChange={onBranchChange}
                  onClose={() => ref.current?.focus()}
                />
              )}
            </div>
          )}

          {attachments.length > 0 ? (
            <div className="personal-composer-attachments flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((file) => (
                <AttachmentChip
                  key={file.id}
                  attachment={file}
                  group={attachments}
                  onRemove={() => removeAttachment(file.id)}
                />
              ))}
            </div>
          ) : null}

          {inboxCard ? (
            <InboxMiniCard card={inboxCard} onDismiss={onInboxCardDismiss} />
          ) : null}

          {noteCard ? (
            <NoteMiniCard card={noteCard} onDismiss={onNoteCardDismiss} />
          ) : null}

          {handoffCard ? (
            <HandoffMiniCard
              card={handoffCard}
              onDismiss={onHandoffCardDismiss}
            />
          ) : null}

          <div className="relative">
            <div
              ref={highlightRef}
              aria-hidden
              className={`composer-highlight pointer-events-none absolute inset-0 max-h-40 overflow-hidden whitespace-pre-wrap break-words px-3 text-sm leading-5.5 text-content font-sans ${
                shell ? "py-4" : "py-3"
              }`}
            >
              <ComposerHighlight
                text={draft}
                cwd={cwd}
                names={skillNames}
                mentions={mentionIndex.labels}
              />
            </div>
            <textarea
              ref={ref}
              data-composer-empty={navigationEmpty ? "true" : undefined}
              rows={1}
              spellCheck={false}
              defaultValue={mountDraft}
              placeholder={
                placeholder && !jumpInId && !discussActive
                  ? placeholder
                  : jumpInId
                    ? "Add something for both of them…"
                    : discussActive
                      ? "What should they discuss?"
                      : inboxCard
                        ? "Add a note, or send to start…"
                        : noteCard
                          ? "Add a message, or send…"
                          : handoffCard
                            ? "Add context, or send to continue…"
                            : noteHint
                              ? `${noteHint}. Say what's next…`
                              : composerHint(
                                  hasNativeCommands(harness),
                                  looksLikeProject(cwd)
                                    ? "files"
                                    : notesEnabled
                                      ? "notes"
                                      : null,
                                )
              }
              aria-label="Message"
              title="/ for commands, @ for references"
              className={`composer-field scrollbar-none relative max-h-40 w-full resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent px-3 text-sm leading-5.5 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap font-sans ${
                shell ? "py-4" : "py-3"
              }`}
              onFocus={() => {
                // Going back to the message abandons an unfinished new skill;
                // otherwise Enter and Escape stay ignored here.
                if (creatingSkill && !createBusy) {
                  setCreatingSkill(false);
                  setCreateError(null);
                }
                onFocus();
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onScroll={(e) => syncHighlightScroll(e.currentTarget)}
              onClick={(e) => syncTokensFromTextarea(e.currentTarget)}
              onKeyUp={(e) => {
                // Escape, Enter, Tab and the arrows were handled on keydown;
                // a re-sync here would reopen a picker Escape just closed.
                if (PICKER_KEYS.has(e.key)) return;
                syncTokensFromTextarea(e.currentTarget);
              }}
              onSelect={(e) => syncTokensFromTextarea(e.currentTarget)}
              onInput={(e) => {
                const el = e.currentTarget;
                setCommandNotice(null);
                resizeComposer(el);
                updateDraft(el.value);
                syncHasValue(el.value, attachments);
                syncTokensFromTextarea(el);
              }}
            />
          </div>

          <div
            ref={controlsRef}
            className="personal-composer-controls flex items-center gap-1 px-2 pb-2"
            data-fit={fit === "full" ? undefined : fit}
          >
            <div
              ref={plusRef}
              className="personal-composer-add relative shrink-0"
            >
              <ToolButton
                label="Add files or choose a mode"
                active={plusOpen}
                onClick={() => setPlusOpen((open) => !open)}
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
              </ToolButton>
              {plusOpen ? (
                <Popover
                  anchor={plusRef}
                  side="top"
                  align="start"
                  width={250}
                  autoFocus
                  tabIndex={-1}
                  aria-label="Add to message"
                  onKeyDown={moveMenuFocus}
                  onDismiss={(reason) => {
                    setPlusOpen(false);
                    if (reason === "escape") ref.current?.focus();
                  }}
                  data-composer-plus
                  className="aven-menu"
                >
                  <p className="aven-menu-section">Add to message</p>
                  <button
                    type="button"
                    disabled={!attachmentsSupported}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setPlusOpen(false);
                      attachFromPicker();
                    }}
                    className="aven-menu-item aven-menu-item-rich"
                  >
                    <span aria-hidden="true" className="aven-menu-icon">
                      <FilePlus />
                    </span>
                    <span className="aven-menu-text">
                      <span>Upload file</span>
                      <span className="aven-menu-description">
                        {attachmentsSupported
                          ? "Attach files or images to this message"
                          : `${appName(harness)} can't take attachments`}
                      </span>
                    </span>
                  </button>
                  {jumpInId ? (
                    <p
                      className="aven-menu-note aven-menu-description"
                      data-composer-modes-off
                    >
                      While this chat's discussion runs, what you send goes to
                      both chats. Modes return when it ends.
                    </p>
                  ) : null}
                  {jumpInId ? null : (
                    <button
                      type="button"
                      aria-pressed={planSelected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setPlanSelected((selected) => !selected);
                        setOrchestrationSelected(false);
                        stopRaceMode();
                        stopDiscussMode();
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="aven-menu-item aven-menu-item-rich"
                    >
                      <span aria-hidden="true" className="aven-menu-icon">
                        <AiIdea className="text-yellow-300/80" />
                      </span>
                      <span className="aven-menu-text">
                        <span>Plan mode</span>
                        <span className="aven-menu-description">
                          Plans first; you approve before it changes anything
                        </span>
                      </span>
                      {planSelected ? (
                        <Check aria-hidden="true" className="aven-menu-check" />
                      ) : null}
                    </button>
                  )}
                  {!hideTopBar && !jumpInId ? (
                    <button
                      type="button"
                      aria-pressed={orchestrationSelected}
                      data-composer-orchestrator
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setOrchestrationSelected((selected) => !selected);
                        setPlanSelected(false);
                        stopRaceMode();
                        stopDiscussMode();
                        setPlusOpen(false);
                        ref.current?.focus();
                      }}
                      className="aven-menu-item aven-menu-item-rich"
                    >
                      <span aria-hidden="true" className="aven-menu-icon">
                        <Share />
                      </span>
                      <span className="aven-menu-text">
                        <span>Orchestrator</span>
                        <span className="aven-menu-description">
                          Splits the job into parts and runs an agent on each
                        </span>
                      </span>
                      {orchestrationSelected ? (
                        <Check aria-hidden="true" className="aven-menu-check" />
                      ) : null}
                    </button>
                  ) : null}
                  {discussAvailable && !jumpInId ? (
                    <button
                      type="button"
                      aria-pressed={discussActive}
                      data-composer-discuss
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setPlusOpen(false);
                        if (discussActive) stopDiscussMode();
                        else startDiscussMode();
                        ref.current?.focus();
                      }}
                      className="aven-menu-item aven-menu-item-rich"
                    >
                      <span aria-hidden="true" className="aven-menu-icon">
                        <MessageMultiple />
                      </span>
                      <span className="aven-menu-text">
                        <span>Discuss</span>
                        <span className="aven-menu-description">
                          Another chat talks it over with this one for a few
                          rounds
                        </span>
                      </span>
                      {discussActive ? (
                        <Check aria-hidden="true" className="aven-menu-check" />
                      ) : null}
                    </button>
                  ) : null}
                  {onRace && !jumpInId ? (
                    <button
                      type="button"
                      aria-pressed={raceActive}
                      data-composer-race
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setPlusOpen(false);
                        if (raceActive) stopRaceMode();
                        else startRaceMode();
                        ref.current?.focus();
                      }}
                      className="aven-menu-item aven-menu-item-rich"
                    >
                      <span aria-hidden="true" className="aven-menu-icon">
                        <Race strokeWidth={1.75} />
                      </span>
                      <span className="aven-menu-text">
                        <span>Race</span>
                        <span className="aven-menu-description">
                          Several AIs try it separately; you keep the best one
                        </span>
                      </span>
                      {raceActive ? (
                        <Check aria-hidden="true" className="aven-menu-check" />
                      ) : null}
                    </button>
                  ) : null}
                </Popover>
              ) : null}
            </div>
            {orchestrationSelected && !jumpInId ? (
              <button
                type="button"
                title="Orchestrator: splits the job into parts and runs an agent on each. Click to turn off."
                aria-label="Turn off Orchestrator mode"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOrchestrationSelected(false);
                  ref.current?.focus();
                }}
                className="flex h-6.5 shrink-0 items-center gap-1 rounded-md bg-(--aven-control-bg) px-1.5 text-ui-caption text-content hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
              >
                <Share className="size-3.5" />
                {fit === "narrow" ? null : "Orchestrator"}
                <X className="size-3" />
              </button>
            ) : null}
            {planSelected && !jumpInId ? (
              <button
                type="button"
                title="Plan mode: plans first; you approve before it changes anything. Click to turn off."
                aria-label="Turn off Plan mode"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPlanSelected(false);
                  ref.current?.focus();
                }}
                className="flex h-6.5 shrink-0 items-center gap-1 rounded-md bg-yellow-300/12 px-1.5 text-ui-caption text-yellow-200/90 hover:bg-yellow-300/18"
              >
                <AiIdea className="size-3.5" />
                {fit === "narrow" ? null : "Plan"}
                <X className="size-3" />
              </button>
            ) : null}
            {raceActive ? (
              <RaceChip
                fit={fit}
                available={raceAvailable}
                lanes={raceLanes}
                onFirstModelChange={setRaceModel}
                reason={raceError ?? raceReason(draft)}
                failed={!!raceError}
                open={raceMenuOpen}
                onOpenChange={(open) => {
                  setRaceMenuOpen(open);
                  if (!open) setRaceError(null);
                }}
                onTurnOff={() => {
                  stopRaceMode();
                  ref.current?.focus();
                }}
                onDone={() => ref.current?.focus()}
              />
            ) : null}
            {discussActive && discussion && sessionId ? (
              <DiscussionChip
                fit={fit}
                host={discussion}
                sessionId={sessionId}
                harness={harness}
                model={model}
                pick={discussPick}
                rounds={discussRounds}
                role={discussRole}
                reason={discussError ?? discussReason(draft)}
                open={discussMenuOpen}
                onOpenChange={(open) => {
                  setDiscussMenuOpen(open);
                  if (!open) setDiscussError(null);
                }}
                onPick={(pick) => {
                  setDiscussPick(pick);
                  setDiscussError(null);
                }}
                onRoundsChange={(rounds) => {
                  setDiscussRounds(rounds);
                  saveDiscussionRounds(rounds);
                }}
                onRoleChange={setDiscussRole}
                onTurnOff={() => {
                  stopDiscussMode();
                  ref.current?.focus();
                }}
                onPreview={() =>
                  startDiscussion(ref.current?.value ?? "", true)
                }
                onDone={() => ref.current?.focus()}
              />
            ) : null}
            <div
              className="composer-toolbar flex min-w-0 flex-1 items-center"
              onWheel={(e) => {
                const el = e.currentTarget;
                if (el.scrollWidth <= el.clientWidth) return;
                if (e.deltaX === 0 && e.deltaY !== 0) el.scrollLeft += e.deltaY;
              }}
            >
              {hasValue || busy ? null : (
                <RecentSkillChips
                  skills={recentSkillChips}
                  onPick={pickRecentSkill}
                />
              )}
            </div>
            {hideAgentPill ? null : (
              <div className="personal-composer-agent">
                <AgentPill
                  fit={fit}
                  harness={harness}
                  model={model}
                  modelSettings={modelSettings}
                  runtimeMode={runtimeMode}
                  showAccess={harnessDescriptor(harness).supportsAccessMode}
                  busy={busy}
                  hotkeys={hotkeys && enabled}
                  onModelChange={onModelChange}
                  onModelSettingsChange={onModelSettingsChange}
                  onRuntimeModeChange={onRuntimeModeChange}
                  onClose={focusField}
                />
              </div>
            )}

            {hideTopBar ? null : (
              <div className="personal-composer-context">
                <ContextMeter
                  usage={context}
                  onCompact={compactSupported ? onCompactContext : undefined}
                  compactDisabled={busy}
                />
              </div>
            )}
            <div className="personal-composer-actions flex shrink-0 items-center gap-1">
              <ComposerAction
                busy={busy}
                actionLabel={
                  jumpInId
                    ? "Send to both"
                    : raceActive
                      ? raceReady
                        ? `Race ${raceLanes.length} agents`
                        : "Choose agents to race"
                      : queueSubmission
                        ? "Queue message"
                        : busy
                          ? STEER_HINT
                          : "Send"
                }
                hasValue={hasValue}
                onSend={() => submit(ref.current?.value ?? "")}
                onStop={stopInBar ? undefined : () => onStop?.()}
              />
            </div>
          </div>
        </div>
        {runnerLive && runnerEnabled ? (
          <ComposerRunner
            boxRef={boxRef}
            cwd={cwd}
            busy={busy}
            enabled={enabled}
            onExited={() => setRunnerLive(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The empty field names what `/` and `@` open here. */
function composerHint(
  nativeCommands: boolean,
  mentions: "files" | "notes" | null,
): string {
  return [
    "Ask anything",
    nativeCommands ? "/ for commands" : "/ for skills",
    mentions ? `@ for ${mentions}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function ComposerHighlight({
  text,
  cwd,
  names,
  mentions,
}: {
  text: string;
  cwd?: string;
  names: ReadonlySet<string>;
  mentions: MentionLookup<ProjectFile>;
}) {
  const parts = skillTextParts(text, names);
  return (
    <>
      {parts.map((part, index) =>
        part.skill ? (
          <span key={index} className="text-skill">
            {part.text}
          </span>
        ) : (
          // Skill tokens always end on whitespace, so each remaining run still
          // starts on a boundary `@mention` matching can rely on.
          <MentionRuns
            key={index}
            text={part.text}
            mentions={mentions}
            cwd={cwd}
          />
        ),
      )}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}

function MentionRuns({
  text,
  mentions,
  cwd,
}: {
  text: string;
  mentions: MentionLookup<ProjectFile>;
  cwd?: string;
}) {
  const parts = fileMentionParts(text, mentions);
  return (
    <>
      {parts.map((part, index) =>
        part.file ? (
          <span key={index} className="chat-reference">
            {/* The `@` keeps its width so the textarea underneath stays in
                lockstep; the file icon sits on top of it. */}
            <span className="relative text-transparent">
              {"@"}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                {part.file && isNoteMentionPath(part.file.path) ? (
                  <StickyNote className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <FileTypeIcon
                    name={part.file.name}
                    isDir={Boolean(part.file.isDir)}
                    size={13}
                  />
                )}
              </span>
            </span>
            {part.text.slice(1)}
          </span>
        ) : (
          <ChatReferenceText key={index} text={part.text} cwd={cwd} />
        ),
      )}
    </>
  );
}

function ComposerAction({
  busy,
  actionLabel,
  hasValue,
  onSend,
  onStop,
}: {
  busy: boolean;
  actionLabel: string;
  hasValue: boolean;
  onSend: () => void;
  /** Absent where the team bar's Stop stops the same thing. */
  onStop?: () => void;
}) {
  if (busy) {
    return (
      <>
        {hasValue ? (
          <button
            type="button"
            title={actionLabel}
            aria-label={actionLabel}
            onClick={onSend}
            className="composer-send aven-press grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
          >
            <ArrowUp className="size-3.5" strokeWidth={2.25} />
          </button>
        ) : null}
        {onStop ? (
          <button
            type="button"
            title="Stop"
            aria-label="Stop"
            onClick={onStop}
            className="aven-press grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90"
          >
            <Square className="size-2.5 fill-current" strokeWidth={0} />
          </button>
        ) : null}
      </>
    );
  }

  return (
    <button
      type="button"
      title={actionLabel}
      aria-label={actionLabel}
      disabled={!hasValue}
      onClick={onSend}
      className="composer-send aven-press grid size-6.5 place-items-center rounded-md bg-white text-black hover:bg-white/90 disabled:cursor-default disabled:bg-white/30 disabled:text-black/40 disabled:hover:bg-white/30"
    >
      <ArrowUp className="size-3.5" strokeWidth={2.25} />
    </button>
  );
}
