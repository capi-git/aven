import { visibleInterval } from "../lib/visibleInterval";
import {
  Check,
  ChevronRight,
  CircleDashed,
  Copy,
  FilePlusCorner,
  Minus,
  Bot,
  PenLine,
  Search,
  Terminal,
  Wrench,
  X,
} from "../chrome/icons";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { AttachmentChip } from "../chrome/AttachmentChip";
import { ChatReferenceText } from "../chrome/ChatReferenceText";
import { FilePreview } from "../chrome/FilePreview";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { PlanPreview } from "../chrome/PlanPreview";
import { OrchestrationPreview } from "../chrome/OrchestrationPreview";
import { TaskListPreview } from "../chrome/TaskListPreview";
import {
  HandoffButton,
  SecondOpinionButton,
} from "../chrome/SecondOpinionButton";
import { RememberButton } from "../chrome/RememberButton";
import { SecondOpinionCard } from "../chrome/SecondOpinionCard";
import { DiscussionRelayCard } from "../chrome/DiscussionRelayCard";
import { DiscussionWrapUpNote } from "../chrome/DiscussionWrapUpNote";
import { NoteMiniCard } from "../chrome/NoteMiniCard";
import { TerminalSpinner } from "../chrome/TerminalSpinner";
import type { ApprovalDecision } from "../lib/harness";
import {
  isEditTool,
  isReadTool,
  isSearchTool,
  stubFilePreview,
} from "../lib/harness/preview";
import { copyText } from "../lib/clipboard";
import { visibleUserPrompt } from "../lib/orchestration";
import {
  hideProposalMarkup,
  lateProposalCardIndex,
  latestProposalId,
} from "../lib/orchestrationPlan";
import { playCue } from "../lib/sounds";
import { legacyTaskListFromText } from "../lib/taskList";
import {
  displayAppData,
  displayPath,
  resolveWorkspacePath,
} from "../lib/paths";
import { getModelSnapshot, resolveModel, subscribeModels } from "../lib/models";
import { harnessForTurn } from "../lib/secondOpinion";
import { turnModelLabel } from "../lib/sessionLabels";
import { Shimmer } from "./Shimmer";
import {
  hasPendingApproval,
  HARNESS_TITLE,
  type Block,
  type DiscussionRelayMeta,
  type DiscussionWrapUpMeta,
  type HarnessId,
  type PlanBuildTarget,
  type ToolPreview,
} from "../lib/session";
import { holdUpAt, type SessionHoldUp } from "../lib/sessionHoldUp";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { useTranscriptLayout } from "../hooks/useTranscriptLayout";
import { useTranscriptAnchor } from "../hooks/useTranscriptAnchor";
import {
  captureScrollAnchor,
  restoreScrollAnchor,
  type ScrollAnchor,
} from "../lib/scrollAnchor";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import {
  ChatFileReferencesContext,
  useChatFileReferences,
} from "../hooks/useFileReferences";
import { useMotionOnAttach } from "../hooks/useMotionOnAttach";
import type { MotionName } from "../lib/motion";
import { TurnEntrances } from "../lib/transcriptMotion";
import {
  followsAfterScroll,
  isAtEnd,
  readerScrolled,
  TRANSCRIPT_SCROLL_DRAG_EVENT,
  type ScrollExtent,
} from "../lib/transcriptScrollIntent";
import type { TranscriptLayout } from "../lib/appearance";
import { BotCheckedRow, BotFixCard, BotWakeTag } from "./BotChat";
import { botProgressLine, isNothingToReport } from "../lib/projectBotWake";
import { useBotTurnOwnsFix } from "../lib/projectBots";
import { AgentMarkdown } from "./AgentMarkdown";
import { DiscussionCard, DiscussionPartnerReply } from "./DiscussionInChat";
import { RaceCard } from "./RaceCard";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";
import { discussionSpans, isDiscussionAside } from "../lib/discussionChat";
import "./AgentTranscript.css";
import {
  activityPhaseTitle,
  activityStillRunning,
  buildActivityPhases,
  editVerb,
  firstFoldableIndex,
  foldableWork,
  foldedBlocks,
  groupTurnItems,
  groupTurns,
  hasRunningSubagent,
  initialThinkingIndex,
  isFoldableWorkItem,
  isIncompleteTool,
  isThinkingBlock,
  lastActivityIndex,
  isProseBlock,
  needsApproval,
  nestedScrollAbsorbsWheel,
  proseSummary,
  toolCallLabel,
  toolCallState,
  turnCopyText,
  workKind,
  workSummaryLine,
  type ActivityPhase,
  type ActivityPhaseKind,
  type ToolCallState,
  type TurnItem,
  type WorkFold,
} from "./transcriptActivity";

const NEAR_BOTTOM_PX = 16;
/** How long a trackpad gesture with no direction yet holds the bottom pin. */
const WHEEL_HOLD_MS = 150;
/** How long after the reader's own scroll input a move up counts as theirs. */
const READER_INPUT_MS = 800;
/** Keys that scroll a focused transcript. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);
const INITIAL_TURNS = 20;
const TURN_PAGE_SIZE = 20;

type Props = {
  blocks: Block[];
  busy?: boolean;
  cwd?: string;
  harness?: HarnessId;
  model?: string;
  pendingQuestion?: boolean;
  /**
   * What holds the running turn up (see `sessionHoldUps`): its working line
   * names it in place of the clock. Keeps its identity while unchanged.
   */
  holdUps?: readonly SessionHoldUp[];
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onAddToChat?: (text: string) => void;
  onSaveNote?: (text: string) => void;
  /** Project whose memory "Remember this" adds to; omitted hides it. */
  memoryProject?: string;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  onSecondOpinion?: (harness: HarnessId, turn: Block[], model: string) => void;
  onHandoff?: (harness: HarnessId, turn: Block[], model: string) => void;
  onJumpToBottomChange?: (show: boolean) => void;
  onJumpToBottomReady?: (jump: () => void) => void;
  /** Passes a function that renders the turn that holds a block. The render completes before the function returns. */
  onRevealReady?: (reveal: (blockId: string) => boolean) => void;
  /** False while another tab is in front; local transcript state is retained. */
  visible?: boolean;
  /** A worker's transcript: show the orchestrator's turns instead of hiding them. */
  managed?: boolean;
  /**
   * The project whose bot this chat is: wake-ups show as tags, a check with
   * nothing to report folds to one line, and a turn's fix gets its card.
   */
  botProject?: string;
};

const NO_PROPOSAL_REPLIES: ReadonlySet<string> = new Set();

/**
 * Turns as `groupTurns` makes them, but a turn whose blocks are all unchanged
 * keeps the array it had last render, so its memoized row can skip rendering.
 */
function useStableTurns(turns: Block[][]): Block[][] {
  const previous = useRef(new Map<string, Block[]>());
  const stable = turns.map((turn) => {
    const before = previous.current.get(turn[0].id);
    return before &&
      before.length === turn.length &&
      before.every((block, index) => block === turn[index])
      ? before
      : turn;
  });
  previous.current = new Map(stable.map((turn) => [turn[0].id, turn]));
  return stable;
}

function AgentTranscriptComponent({
  blocks,
  busy,
  cwd,
  harness,
  model,
  pendingQuestion = false,
  holdUps,
  onApproval,
  onAddToChat,
  onSaveNote,
  memoryProject,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSecondOpinion,
  onHandoff,
  onJumpToBottomChange,
  onJumpToBottomReady,
  onRevealReady,
  visible = true,
  managed = false,
  botProject,
}: Props) {
  const scrollerId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const scrollbarDragging = useRef(false);
  const stickToBottom = useRef(true);
  const showJumpRef = useRef(false);
  // The offset as of the last scroll this component saw or wrote. Comparing
  // against it tells the reader moving apart from content growing under them.
  const lastScrollTop = useRef(0);
  // The content and viewport heights at that offset, to tell content folding
  // away under the reader from a taller viewport clamping them.
  const lastScrollExtent = useRef<ScrollExtent | undefined>(undefined);
  // Until this time, a trackpad gesture with no direction yet owns the pin.
  const wheelHold = useRef(0);
  // When the reader last used a wheel, trackpad, scroll key or the scrollbar
  // here, to tell their scrolling from the browser moving the offset.
  const readerInputAt = useRef(Number.NEGATIVE_INFINITY);
  // A layout move undone while following, still to be pinned back.
  const repinAfterLayout = useRef(false);
  const prependHeight = useRef<number | null>(null);
  // What the reader sees at the top edge while scrolled up. WebKit has no CSS
  // scroll anchoring, so a rewrap would otherwise slide it away.
  const readingAnchor = useRef<ScrollAnchor | null>(null);
  const wasVisible = useRef(false);
  // Set when the tab is shown; the ResizeObserver settles it after layout.
  const openedPending = useRef(false);
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_TURNS);
  // Turns whose folded work the reader has opened, by turn id.
  const [openWork, setOpenWork] = useState<Record<string, boolean>>({});
  const toggleWork = useCallback((turnId: string) => {
    setOpenWork((open) => ({ ...open, [turnId]: !open[turnId] }));
  }, []);
  // Stretch the last turn after a send while this tab stays open. Closing
  // the tab is a new visit: the remount uses the true transcript height so
  // the latest reply sits on the composer instead of a hole of empty space.
  const [anchorTurn, setAnchorTurn] = useState(!!busy);
  const { selection, dismissSelection } = useTranscriptSelection(
    scrollerEl,
    onAddToChat !== undefined,
  );
  const transcriptLayout = useTranscriptLayout();
  const promptAnchor = useTranscriptAnchor();
  const lastUserId = lastUserBlockId(blocks, managed);
  const seenUserId = useRef(lastUserId);
  if (lastUserId !== seenUserId.current) {
    seenUserId.current = lastUserId;
    if (lastUserId && !anchorTurn) setAnchorTurn(true);
  }
  const modelName = harness ? resolveModel(harness, model).name : undefined;
  // Finished turns name the model they ran on; when a provider's live list
  // arrives, a name that was only an id can become a real one.
  const modelCatalog = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  const waitingForApproval = hasPendingApproval(blocks) || pendingQuestion;
  const preparingHandoff = blocks.some(
    (block) =>
      block.role === "handoff" && block.handoff?.status === "preparing",
  );
  // Only the newest proposal can start; older cards read as replaced.
  const newestProposalId = useMemo(() => latestProposalId(blocks), [blocks]);
  const proposalReplyIds = useMemo<ReadonlySet<string>>(() => {
    const cardIndex = busy ? lateProposalCardIndex(blocks) : -1;
    if (cardIndex < 0) return NO_PROPOSAL_REPLIES;
    const ids = new Set<string>();
    for (let index = blocks.length - 1; index > cardIndex; index--) {
      const block = blocks[index];
      if (block.role === "user") break;
      if (block.role === "assistant" || block.role === "plan")
        ids.add(block.id);
    }
    return ids;
  }, [blocks, busy]);

  const setShowJump = useCallback(
    (show: boolean) => {
      if (showJumpRef.current === show) return;
      showJumpRef.current = show;
      onJumpToBottomChange?.(show);
    },
    [onJumpToBottomChange],
  );

  /** Record an offset this component wrote, so its event is not the reader. */
  const rememberScroll = useCallback((el: HTMLElement) => {
    lastScrollTop.current = el.scrollTop;
    lastScrollExtent.current = {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  }, []);

  const pinTranscript = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      pinToBottom(el);
      rememberScroll(el);
    },
    [rememberScroll],
  );

  /**
   * Reconcile following with how the offset changed since we last saw it.
   * Returns true when the reader moved it, rather than nothing or a layout
   * clamp. Content growth changes the distance to the end without moving the
   * reader, so a queued event from an earlier pin keeps following.
   */
  const syncPinned = useCallback(
    (el: HTMLElement): boolean => {
      const previousTop = lastScrollTop.current;
      const previous = lastScrollExtent.current;
      const moved = readerScrolled(el, previousTop, previous);
      // When the viewport changes height while the content briefly shortens,
      // as the rows over the message box change when a run starts, the
      // browser can clamp the offset well above the end. Without scroll
      // input from the reader at that moment, it is layout: keep following.
      const layoutOnly =
        moved &&
        stickToBottom.current &&
        !scrollbarDragging.current &&
        !!previous &&
        el.clientHeight !== previous.clientHeight &&
        performance.now() - readerInputAt.current > READER_INPUT_MS;
      stickToBottom.current =
        !scrollbarDragging.current &&
        (layoutOnly ||
          followsAfterScroll(el, previousTop, stickToBottom.current, previous));
      if (layoutOnly) repinAfterLayout.current = true;
      rememberScroll(el);
      setShowJump(!stickToBottom.current && el.scrollHeight > el.clientHeight);
      return moved && !layoutOnly;
    },
    [rememberScroll, setShowJump],
  );

  /** `moved` is false when the offset changed only by layout, not the reader. */
  const rememberReadingPosition = useCallback(
    (el: HTMLElement, moved = true) => {
      if (stickToBottom.current) {
        readingAnchor.current = null;
        return;
      }
      const anchor = readingAnchor.current;
      // The scroll event that follows our own restore describes the same
      // view, and a clamp is not the reader choosing a new line.
      if (
        anchor?.element.isConnected &&
        (!moved || anchor.scrollTop === el.scrollTop)
      )
        return;
      readingAnchor.current = captureScrollAnchor(el);
    },
    [],
  );

  /**
   * Pin for streamed output or a resize, unless the reader has scrolled. The
   * browser can apply a manual scroll before dispatching its event, so read
   * the offset first. Returns whether the reader moved it.
   */
  const followTranscript = useCallback(
    (el: HTMLElement): boolean => {
      const moved = syncPinned(el);
      // A gesture whose direction is not known yet may already be scrolling
      // off the main thread. Pinning now would snap it back to the end.
      if (stickToBottom.current && performance.now() >= wheelHold.current)
        pinTranscript(el);
      return moved;
    },
    [pinTranscript, syncPinned],
  );

  const jumpToBottom = useCallback(() => {
    stickToBottom.current = true;
    wheelHold.current = 0;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinTranscript(el);
  }, [pinTranscript, setShowJump]);

  const setScroller = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    setScrollerEl(el);
  }, []);

  useEffect(() => {
    onJumpToBottomReady?.(jumpToBottom);
  }, [jumpToBottom, onJumpToBottomReady]);

  useEffect(() => {
    if (!visible || !scrollerEl) return;
    // A just-shown tab may report the offset hiding reset; the observer
    // settles it after layout first (see settleOpened), then syncs.
    if (!openedPending.current)
      rememberReadingPosition(scrollerEl, syncPinned(scrollerEl));
    const onScroll = () => {
      // A hidden or detached scroller reports a reset offset, not the reader.
      if (!scrollerEl.isConnected || scrollerEl.clientHeight <= 0) return;
      rememberReadingPosition(scrollerEl, syncPinned(scrollerEl));
      if (repinAfterLayout.current) {
        repinAfterLayout.current = false;
        if (stickToBottom.current) pinTranscript(scrollerEl);
      }
    };
    const markReaderInput = () => {
      readerInputAt.current = performance.now();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) markReaderInput();
    };
    // The scrollbar is part of the scroller itself, and a selection dragged
    // past an edge scrolls it with a button held.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === scrollerEl) markReaderInput();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons) markReaderInput();
    };
    const onScrollbarDrag = (event: Event) => {
      markReaderInput();
      const dragging = (event as CustomEvent<boolean>).detail;
      scrollbarDragging.current = dragging;
      syncPinned(scrollerEl);
      // Releasing the thumb at the end follows again, even when its last
      // move was already reported while the drag held the pin.
      if (!dragging && isAtEnd(scrollerEl)) {
        stickToBottom.current = true;
        setShowJump(false);
      }
      rememberReadingPosition(scrollerEl);
    };
    let release: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      markReaderInput();
      if (e.deltaY < 0) {
        // Upward input that cannot move the transcript, at its top or with
        // nothing to scroll, is not the reader leaving the end.
        if (
          scrollerEl.scrollTop <= 0 ||
          scrollerEl.scrollHeight <= scrollerEl.clientHeight
        )
          return;
        stickToBottom.current = false;
        wheelHold.current = 0;
        setShowJump(true);
      } else if (e.deltaY === 0 && stickToBottom.current) {
        // A trackpad gesture can open with an event that carries no
        // direction, and the rest of it may reach us after the scroll has
        // moved. Hold the pin until its upward events can release it.
        wheelHold.current = performance.now() + WHEEL_HOLD_MS;
        clearTimeout(release);
        release = setTimeout(() => {
          if (!scrollerEl.isConnected || scrollerEl.clientHeight <= 0) return;
          rememberReadingPosition(scrollerEl, followTranscript(scrollerEl));
        }, WHEEL_HOLD_MS);
      }
    };
    scrollerEl.addEventListener("scroll", onScroll, { passive: true });
    scrollerEl.addEventListener("wheel", onWheel, { passive: true });
    scrollerEl.addEventListener("keydown", onKeyDown);
    scrollerEl.addEventListener("pointerdown", onPointerDown, {
      passive: true,
    });
    scrollerEl.addEventListener("pointermove", onPointerMove, {
      passive: true,
    });
    scrollerEl.addEventListener(TRANSCRIPT_SCROLL_DRAG_EVENT, onScrollbarDrag);
    return () => {
      clearTimeout(release);
      wheelHold.current = 0;
      scrollerEl.removeEventListener("scroll", onScroll);
      scrollerEl.removeEventListener("wheel", onWheel);
      scrollerEl.removeEventListener("keydown", onKeyDown);
      scrollerEl.removeEventListener("pointerdown", onPointerDown);
      scrollerEl.removeEventListener("pointermove", onPointerMove);
      scrollerEl.removeEventListener(
        TRANSCRIPT_SCROLL_DRAG_EVENT,
        onScrollbarDrag,
      );
      scrollbarDragging.current = false;
    };
  }, [
    followTranscript,
    pinTranscript,
    rememberReadingPosition,
    scrollerEl,
    setShowJump,
    syncPinned,
    visible,
  ]);

  useLayoutEffect(() => {
    stickToBottom.current = true;
    wheelHold.current = 0;
    setShowJump(false);
    const el = scroller.current;
    syncTranscriptViewport(el);
    pinTranscript(el);
  }, [lastUserId, pinTranscript, setShowJump]);

  // A tab that was just shown is settled by the ResizeObserver below, whose
  // first report arrives after this frame's layout and before paint.
  // Measuring here made WebKit lay out the window mid-commit (~10 ms/switch).
  useLayoutEffect(() => {
    const opened = visible && !wasVisible.current;
    wasVisible.current = visible;
    if (opened) openedPending.current = true;
  }, [visible]);
  const settleOpened = useCallback(
    (el: HTMLElement) => {
      // Previously opened tabs normally retain their scroll position. Only pin
      // when the scroller looks empty after being hidden with `display: none`.
      if (el.scrollHeight <= el.clientHeight + NEAR_BOTTOM_PX) {
        stickToBottom.current = true;
        setShowJump(false);
        pinTranscript(el);
      } else if (stickToBottom.current) {
        // Output may have arrived while hidden, and showing the pane can reset
        // its offset. Pin before a follow reads that as the reader leaving.
        pinTranscript(el);
      } else {
        // A reader keeps their place through the anchor, not this offset.
        rememberScroll(el);
      }
    },
    [pinTranscript, rememberScroll, setShowJump],
  );

  // Becoming visible is handled by the ResizeObserver below, whose first
  // report arrives after the frame's layout. Doing it here as well made
  // WebKit lay out the window mid-commit on every tab switch (~10 ms).
  const followedVisible = useRef(visible);
  useLayoutEffect(() => {
    const shown = visible && !followedVisible.current;
    followedVisible.current = visible;
    if (shown || !visible || !stickToBottom.current) return;
    const el = scroller.current;
    if (!el) return;
    syncTranscriptViewport(el);
    rememberReadingPosition(el, followTranscript(el));
  }, [blocks, busy, followTranscript, rememberReadingPosition, visible]);

  useLayoutEffect(() => {
    const el = scrollerEl;
    const inner = el?.firstElementChild;
    if (!visible || !el || !inner) return;
    // Runs after layout and before paint, so a rewrap from a window, sidebar
    // or pane resize is corrected in the frame that produced it.
    const onResize = () => {
      if (!el.isConnected) return;
      // As before, a just-shown tab settles even before it has a height.
      if (openedPending.current) {
        openedPending.current = false;
        syncTranscriptViewport(el);
        settleOpened(el);
      }
      if (el.clientHeight <= 0) return;
      syncTranscriptViewport(el);
      const moved = followTranscript(el);
      if (stickToBottom.current) {
        readingAnchor.current = null;
        return;
      }
      const anchor = readingAnchor.current;
      // A gesture owns scrollTop until it ends. Growth or rewrap must not
      // restore an anchor captured before the latest pointer movement, nor
      // one from before a scroll whose event has not arrived yet.
      if (
        scrollbarDragging.current ||
        moved ||
        !anchor ||
        !restoreScrollAnchor(el, anchor)
      )
        readingAnchor.current = captureScrollAnchor(el);
      rememberScroll(el);
    };
    // The observer reports both elements once it starts watching.
    const observer = new ResizeObserver(onResize);
    observer.observe(inner);
    observer.observe(el);
    return () => observer.disconnect();
  }, [followTranscript, rememberScroll, scrollerEl, settleOpened, visible]);

  const turns = useStableTurns(groupTurns(blocks, managed));
  // File names in a reply resolve to what this chat's agent touched.
  const chatFiles = useChatFileReferences(turns, cwd);
  // In the chat that started a discussion, its turns fold into one card
  // after the topic; "Show in chat" unfolds them.
  const spans = discussionSpans(turns, (turn) => turnUserBlock(turn, managed));
  const [shownSpans, setShownSpans] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // A folded discussion opens by itself while this chat waits on an
  // approval inside it: its Allow and Deny would otherwise be out of reach.
  const askingSpans = useMemo(() => {
    const asking = new Set<string>();
    for (const [index, span] of spans)
      if (!asking.has(span.key) && hasPendingApproval(turns[index]))
        asking.add(span.key);
    return asking;
  }, [spans, turns]);
  /** Spans you folded while they were open for an approval. */
  const [foldedAsking, setFoldedAsking] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const spanShownFor = (key: string) =>
    shownSpans.has(key) || (askingSpans.has(key) && !foldedAsking.has(key));
  const shownRef = useRef(spanShownFor);
  shownRef.current = spanShownFor;
  // "Hide in chat" folds a span even while it is open for an approval, and
  // one opened only for an approval folds again once it is decided.
  const toggleSpan = useCallback((key: string) => {
    const shown = shownRef.current(key);
    setShownSpans((current) => {
      const next = new Set(current);
      if (shown) next.delete(key);
      else next.add(key);
      return next;
    });
    setFoldedAsking((current) => {
      const next = new Set(current);
      if (shown) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const spansRef = useRef(spans);
  spansRef.current = spans;
  const firstVisibleTurn = Math.max(0, turns.length - visibleTurnCount);
  const visibleTurns = turns.slice(firstVisibleTurn);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  // A turn that arrives while this transcript is on screen rises in, and the
  // reply under it fades in as it starts (motion.css). Nothing waits for it.
  const entrances = useRef<TurnEntrances | null>(null);
  entrances.current ??= new TurnEntrances();
  const lastTurnId = turns.at(-1)?.[0].id;
  entrances.current.observe(lastTurnId, visible);
  const fadeReplies = entrances.current.started;
  useLayoutEffect(() => {
    entrances.current?.commit(
      turnsRef.current.map((turn) => turn[0].id),
      visible,
    );
  }, [lastTurnId, turns.length, visible]);
  const visibleTurnCountRef = useRef(visibleTurnCount);
  visibleTurnCountRef.current = visibleTurnCount;

  useLayoutEffect(() => {
    const previousHeight = prependHeight.current;
    const el = scroller.current;
    if (previousHeight == null || !el) return;
    prependHeight.current = null;
    el.scrollTop += el.scrollHeight - previousHeight;
    rememberScroll(el);
    // The earlier anchor may sit above the inserted turns now.
    readingAnchor.current = captureScrollAnchor(el);
  }, [rememberScroll, visibleTurnCount]);

  const prepareToPrepend = useCallback(() => {
    const el = scroller.current;
    if (el) prependHeight.current = el.scrollHeight;
    stickToBottom.current = false;
  }, []);

  const loadEarlier = () => {
    prepareToPrepend();
    setVisibleTurnCount((count) =>
      Math.min(turns.length, count + TURN_PAGE_SIZE),
    );
  };

  const revealBlock = useCallback(
    (blockId: string): boolean => {
      const all = turnsRef.current;
      const index = all.findIndex((turn) =>
        turn.some((block) => block.id === blockId),
      );
      if (index < 0) return false;
      // Inside a folded discussion the turn draws nothing: unfold it first.
      const span = spansRef.current.get(index);
      if (span)
        flushSync(() =>
          setShownSpans((current) =>
            current.has(span.key) ? current : new Set([...current, span.key]),
          ),
        );
      const needed = all.length - index;
      if (needed <= visibleTurnCountRef.current) return true;
      prepareToPrepend();
      // Synchronous. The caller finds the turn in the DOM after this call.
      flushSync(() => setVisibleTurnCount(needed));
      return true;
    },
    [prepareToPrepend],
  );

  useEffect(() => {
    onRevealReady?.(revealBlock);
  }, [revealBlock, onRevealReady]);

  return (
    <ApprovalWords.Provider value={botProject ? BOT_APPROVAL : PLAIN_APPROVAL}>
      <div
        id={scrollerId}
        ref={setScroller}
        data-transcript-layout={transcriptLayout}
        className="agent-transcript h-full overflow-y-auto overscroll-none [overflow-anchor:none] font-mono text-ui-body leading-5"
      >
        <div className="personal-transcript-content mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-1 pb-1">
          {firstVisibleTurn > 0 ? (
            <div className="flex justify-center px-4 py-3">
              <button
                type="button"
                className="rounded-md bg-(--aven-control-bg) px-2.5 py-1.5 font-sans text-ui-label text-content/60 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed) hover:text-content"
                onClick={loadEarlier}
              >
                Load earlier messages
              </button>
            </div>
          ) : null}
          {visibleTurns.map((turn, turnIndex) => {
            const turnAt = firstVisibleTurn + turnIndex;
            const isLastTurn = turnAt === turns.length - 1;
            const span = spans.get(turnAt);
            const spanShown = !!span && spanShownFor(span.key);
            // A folded discussion shows once, at the start of its span.
            if (span && !spanShown && turnAt !== span.start) return null;
            const spanStart = span && turnAt === span.start ? span : undefined;
            const spanLive = !!spanStart && spanStart.end === turns.length - 1;
            return (
              <ChatFileReferencesContext.Provider
                key={turn[0].id}
                value={chatFiles.forTurn(turnAt)}
              >
                <TranscriptTurn
                  turn={turn}
                  isLastTurn={isLastTurn}
                  stickyIndex={turnAt + 1}
                  entering={entrances.current?.rises(turn[0].id) ?? false}
                  fadeReplies={isLastTurn && fadeReplies}
                  managed={managed}
                  botProject={botProject}
                  busy={busy}
                  visible={visible}
                  preparingHandoff={preparingHandoff}
                  waitingForApproval={waitingForApproval}
                  pendingQuestion={pendingQuestion}
                  holdUps={isLastTurn ? holdUps : undefined}
                  harness={harness}
                  model={model}
                  turnHarness={
                    harness ? harnessForTurn(blocks, turn, harness) : undefined
                  }
                  modelName={modelName}
                  modelCatalog={modelCatalog}
                  transcriptLayout={transcriptLayout}
                  anchored={
                    promptAnchor &&
                    anchorTurn &&
                    (spanStart && !spanShown ? spanLive : isLastTurn)
                  }
                  workOpen={!!openWork[turn[0].id]}
                  toggleWork={toggleWork}
                  proposalReplyIds={proposalReplyIds}
                  newestProposalId={newestProposalId}
                  discussionId={spanStart?.id}
                  discussionMeta={spanStart?.meta}
                  discussionKey={spanStart?.key}
                  discussionTopic={spanStart?.topic}
                  discussionClosing={spanStart?.closing}
                  discussionExpanded={spanStart ? spanShown : undefined}
                  discussionAsking={
                    spanStart ? askingSpans.has(spanStart.key) : undefined
                  }
                  discussionLive={spanLive}
                  onToggleDiscussion={toggleSpan}
                  cwd={cwd}
                  onApproval={onApproval}
                  onOpenFile={onOpenFile}
                  onOpenDiff={onOpenDiff}
                  onOpenPlan={onOpenPlan}
                  onBuildPlan={onBuildPlan}
                  onSaveNote={onSaveNote}
                  memoryProject={memoryProject}
                  onSecondOpinion={onSecondOpinion}
                  onHandoff={onHandoff}
                />
              </ChatFileReferencesContext.Provider>
            );
          })}
        </div>
        {onAddToChat ? (
          <TranscriptSelectionMenu
            selection={selection}
            onAddToChat={onAddToChat}
            onDismiss={dismissSelection}
          />
        ) : null}
      </div>
    </ApprovalWords.Provider>
  );
}

/** What a request's two buttons say: a bot asks to be allowed once. */
type ApprovalWording = { allow: string; deny: string };
const PLAIN_APPROVAL: ApprovalWording = { allow: "Allow", deny: "Deny" };
const BOT_APPROVAL: ApprovalWording = {
  allow: "Allow once",
  deny: "Don't allow",
};
const ApprovalWords = createContext<ApprovalWording>(PLAIN_APPROVAL);

// Keep hidden panes' local state, and catch up with current props on activation.
export const AgentTranscript = memo(
  AgentTranscriptComponent,
  (previous, next) => previous.visible === false && next.visible === false,
);

type TranscriptTurnProps = Pick<
  Props,
  | "botProject"
  | "cwd"
  | "harness"
  | "model"
  | "onApproval"
  | "onOpenFile"
  | "onOpenDiff"
  | "onOpenPlan"
  | "onBuildPlan"
  | "onSaveNote"
  | "memoryProject"
  | "onSecondOpinion"
  | "onHandoff"
> & {
  turn: Block[];
  isLastTurn: boolean;
  stickyIndex: number;
  /** Arrived while the transcript was on screen: your message rises in. */
  entering: boolean;
  /** Replies that start while this turn is live fade in. */
  fadeReplies: boolean;
  managed: boolean;
  busy?: boolean;
  visible: boolean;
  preparingHandoff: boolean;
  waitingForApproval: boolean;
  pendingQuestion: boolean;
  /** The live turn's hold-ups; undefined on every other turn. */
  holdUps?: readonly SessionHoldUp[];
  /** The provider that produced this turn. */
  turnHarness?: HarnessId;
  /** The chat's current model, which a second opinion should not offer. */
  modelName?: string;
  /** The model catalog's version: a turn names its model from it. */
  modelCatalog: number;
  transcriptLayout: TranscriptLayout;
  /** The live turn is stretched to the viewport after a send. */
  anchored: boolean;
  workOpen: boolean;
  toggleWork: (turnId: string) => void;
  proposalReplyIds: ReadonlySet<string>;
  /** Only the newest proposal can start; older cards read as replaced. */
  newestProposalId?: string;
  /**
   * Set on the turn that starts a discussion's span in the chat that began
   * it: its card goes here, and folded, it stands for the whole span.
   */
  discussionId?: string;
  discussionMeta?: DiscussionRelayMeta;
  discussionKey?: string;
  /** The span opens with the topic, shown as the user's message. */
  discussionTopic?: boolean;
  discussionClosing?: DiscussionWrapUpMeta;
  /** "Show in chat" unfolded the span's turns. */
  discussionExpanded?: boolean;
  /** This chat waits on an approval inside the span. */
  discussionAsking?: boolean;
  /** The span runs to the chat's last turn. */
  discussionLive?: boolean;
  onToggleDiscussion: (spanKey: string) => void;
};

/**
 * One turn of the transcript. Memoized: a streamed update re-renders the live
 * turn, while finished turns keep their block arrays (see `useStableTurns`)
 * and skip rendering.
 */
const TranscriptTurn = memo(function TranscriptTurn({
  turn,
  isLastTurn,
  stickyIndex,
  entering,
  fadeReplies,
  managed,
  botProject,
  busy,
  visible,
  preparingHandoff,
  waitingForApproval,
  pendingQuestion,
  holdUps,
  harness,
  model,
  turnHarness,
  modelName,
  transcriptLayout,
  anchored,
  workOpen,
  toggleWork,
  proposalReplyIds,
  newestProposalId,
  discussionId,
  discussionMeta,
  discussionKey,
  discussionTopic,
  discussionClosing,
  discussionExpanded,
  discussionAsking,
  discussionLive,
  onToggleDiscussion,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  onSaveNote,
  memoryProject,
  onSecondOpinion,
  onHandoff,
}: TranscriptTurnProps) {
  // A bot's turn that owns its fix is never folded away: its card shows.
  const ownsBotFix = useBotTurnOwnsFix(
    botProject,
    botProject ? turnUserBlock(turn, managed)?.id : undefined,
  );
  // Your message that started a team here: it stays as you sent it.
  const teamStart = turn.length === 1 ? turn[0] : undefined;
  if (teamStart?.team)
    return (
      <div
        data-team-origin={teamStart.team.id}
        className={`transcript-turn flex min-w-0 flex-col${
          isLastTurn ? " transcript-turn-live" : ""
        }`}
      >
        <div className="flow-root pb-1">
          <TranscriptBlock
            block={{ ...teamStart, role: "user" }}
            motion={entering ? "rise" : undefined}
            layout={transcriptLayout}
            stickyIndex={stickyIndex}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
        <RaceCard raceId={teamStart.team.id} />
      </div>
    );
  const userBlock = turnUserBlock(turn, managed);
  // A discussion's span starts here: its card, and folded, the whole span.
  const card =
    discussionId && discussionMeta && discussionKey ? (
      <DiscussionCard
        key="discussion-card"
        id={discussionId}
        meta={discussionMeta}
        spanKey={discussionKey}
        expanded={!!discussionExpanded}
        approvalPending={!!discussionAsking}
        onToggle={onToggleDiscussion}
        harness={harness}
        model={model}
      />
    ) : null;
  if (card && !discussionExpanded) {
    // Folded: the topic, the card, and where they landed.
    return (
      <div
        data-discussion-span={discussionId}
        className={`transcript-turn flex min-w-0 flex-col${
          discussionLive ? " transcript-turn-live" : ""
        }${anchored ? " transcript-turn-anchor" : ""}`}
      >
        {discussionTopic && userBlock ? (
          <div className="flow-root pb-1">
            <TranscriptBlock
              block={userBlock}
              motion={entering ? "rise" : undefined}
              layout={transcriptLayout}
              stickyIndex={stickyIndex}
              cwd={cwd}
              onOpenFile={onOpenFile}
              planHarness={harness}
              planModel={model}
            />
          </div>
        ) : null}
        {card}
        {discussionClosing ? (
          <DiscussionWrapUpNote meta={discussionClosing} />
        ) : null}
      </div>
    );
  }
  const durationMs = userBlock?.durationMs;
  const settled = !(busy && isLastTurn);
  // A bot's wake-up that found nothing folds into one quiet line.
  if (
    userBlock?.botWake &&
    settled &&
    !ownsBotFix &&
    !turn.some((block) => block.approval) &&
    isNothingToReport(lastProseText(turn))
  )
    return (
      <div className="transcript-turn flex min-w-0 flex-col">
        <BotCheckedRow
          label={userBlock.botWake.label}
          at={userBlock.startedAt}
        />
      </div>
    );
  // A plan's card waits for the turn that writes it to end. Once its run
  // starts, the run drives the lead's next turns inside this one (their
  // messages are the app's), so the card stays: hiding it while the lead
  // works would collapse the turn under the reader each time.
  const proposals = turn.filter((block) => {
    const status = block.orchestration?.status;
    if (!status || status === "planning") return false;
    return settled || status === "starting" || status === "approved";
  });
  // The other agent's last reply and the closing note end a
  // discussion after the turn's own footer.
  const asides = turn.filter(isDiscussionAside);
  // Proposals are turn results, like the changes card. Keep them out
  // of the live work and append them after all of the lead's output.
  const items = groupTurnItems(
    turn.filter((block) => !block.orchestration && !isDiscussionAside(block)),
  );
  // Earlier activity groups have already been followed by prose or
  // more work. Only the last one can still be the live group.
  const foldedAt = lastActivityIndex(items);
  const initialThinkingAt = initialThinkingIndex(items);
  const startedAt = userBlock?.startedAt;
  // The agent starting its answer is the end of the work: fold the
  // groups then, not when the turn finally settles, so the collapse
  // never lands under the text you have already started reading.
  const answering =
    foldedAt >= 0 &&
    items
      .slice(foldedAt + 1)
      .some((item) => item.type === "block" && isProseBlock(item.block));
  const workStillRunning = activityStillRunning(turn);
  // The composer's pill names the chat's model. A turn names its own
  // only when it ran on a different one.
  const turnModelName = harness
    ? turnModelLabel(userBlock?.turnModel, {
        harness,
        model: model ?? "",
      })
    : undefined;
  // Work the turn has already answered for folds away behind one line,
  // leaving the prompt and the answer to it.
  const turnId = turn[0].id;
  // A bot works out of sight: while it works, all it has done so far sits
  // behind one line saying what it is doing now; its last message is the
  // result.
  const botLive = !!botProject && !settled;
  const fold = botLive ? liveWorkFold(items) : foldableWork(items);
  const folded = fold ? foldedBlocks(items, fold) : [];
  // The fold line is the turn's status line from the first token to
  // the last: the mark, and the clock beside it. It never moves, so a
  // turn settling does not shuffle the layout around the answer.
  const live = visible && !settled && !preparingHandoff;
  const replyMotion: MotionName | undefined =
    fadeReplies && live ? "fade" : undefined;
  const foldTitle: ReactNode = live ? (
    botLive && !waitingForApproval && !pendingQuestion ? (
      <Shimmer className="min-w-0 truncate font-sans text-sm" duration={1}>
        {botProgressLine(turn)}
      </Shimmer>
    ) : (
      <LiveFoldTitle
        startedAt={startedAt}
        paused={waitingForApproval}
        waitingLabel={
          pendingQuestion ? "Needs you · Answer the question below" : undefined
        }
        subagent={hasRunningSubagent(turn)}
        modelName={turnModelName}
        holdUps={holdUps}
      />
    )
  ) : durationMs != null ? (
    formatWorkingDuration(durationMs, true, false, turnModelName)
  ) : (
    workSummaryLine(folded)
  );
  const showFoldLine = live || durationMs != null || !!fold;
  // It sits where the work starts, from before there is any: the row
  // is there from the first token, so nothing shoves the answer down
  // when the turn folds.
  const firstWork = firstFoldableIndex(items);
  const foldLineAt = fold
    ? fold.start
    : firstWork >= 0
      ? firstWork
      : items.length;
  const renderItem = (item: TurnItem, itemIndex: number) =>
    item.type === "activity" ? (
      itemIndex === initialThinkingAt ? (
        <InitialThinking
          key={item.blocks[0].id}
          live={visible && !settled}
          motion={replyMotion}
        />
      ) : (
        <ActivityPhases
          key={item.blocks[0].id}
          blocks={item.blocks}
          cwd={cwd}
          done={
            !visible ||
            settled ||
            itemIndex < foldedAt ||
            (answering && !workStillRunning)
          }
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      )
    ) : (
      <TranscriptBlock
        key={item.block.id}
        block={item.block}
        motion={
          item.block.role === "user"
            ? entering
              ? "rise"
              : undefined
            : isProseBlock(item.block)
              ? replyMotion
              : undefined
        }
        proposalReply={proposalReplyIds.has(item.block.id)}
        layout={transcriptLayout}
        stickyIndex={stickyIndex}
        // Prose reads the same wherever it lands: under the fold
        // line at the top of the turn, or under the work it follows.
        underLine={
          isProseBlock(item.block) &&
          itemIndex > 0 &&
          (items[itemIndex - 1]?.type === "activity" ||
            (itemIndex === foldLineAt && showFoldLine))
        }
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
        onOpenPlan={onOpenPlan}
        onBuildPlan={onBuildPlan}
        planBusy={!!busy}
        planHarness={harness}
        planModel={model}
        cwd={cwd}
      />
    );
  const foldLineRow = (
    <TurnRow key="work-fold" folded={!showFoldLine}>
      <WorkFoldLine
        title={foldTitle}
        kind={workKind(folded)}
        harness={turnHarness}
        live={live}
        expandable={!!fold}
        open={workOpen && !!fold}
        onToggle={() => toggleWork(turnId)}
      />
    </TurnRow>
  );
  const rows = items.flatMap((item, itemIndex) => {
    const inFold =
      !!fold &&
      itemIndex >= fold.start &&
      itemIndex <= fold.end &&
      isFoldableWorkItem(item);
    if (inFold) {
      if (itemIndex !== fold.start) return [];
      return [
        foldLineRow,
        <TurnRow key="work-details" folded={!workOpen}>
          {() =>
            items.slice(fold.start, fold.end + 1).map((entry, offset) =>
              isFoldableWorkItem(entry) ? (
                <div
                  key={turnItemKey(entry)}
                  className={`flow-root pb-1 last:pb-0 pl-5 zen-fold-rail ${
                    fold.start + offset === fold.end ? "zen-fold-tail" : ""
                  }`}
                >
                  {renderItem(entry, fold.start + offset)}
                </div>
              ) : null,
            )
          }
        </TurnRow>,
      ];
    }
    const row = (
      <div key={turnItemKey(item)} className="flow-root pb-1">
        {renderItem(item, itemIndex)}
      </div>
    );
    if (itemIndex !== foldLineAt) return row;
    return [foldLineRow, row];
  });
  const footer = (
    <>
      {foldLineAt >= items.length ? foldLineRow : null}
      {proposals.map((block) => (
        <div
          key={block.id}
          className="px-4 pt-1 pb-2"
          data-orchestration-result
        >
          <OrchestrationPreview
            block={block}
            busy={!!busy}
            superseded={block.id !== newestProposalId}
          />
        </div>
      ))}
      {durationMs != null && settled ? (
        <TurnDuration
          elapsedMs={durationMs}
          labelHidden={showFoldLine}
          modelName={turnModelName}
          currentModelName={modelName}
          completedAt={startedAt != null ? startedAt + durationMs : undefined}
          copyText={turnCopyText(turn)}
          onSaveNote={onSaveNote}
          memoryProject={memoryProject}
          harness={turnHarness}
          fromHarness={turnHarness}
          onSecondOpinion={
            onSecondOpinion
              ? (target, model) => onSecondOpinion(target, turn, model)
              : undefined
          }
          onHandoff={
            onHandoff
              ? (target, model) => onHandoff(target, turn, model)
              : undefined
          }
        />
      ) : null}
    </>
  );
  return (
    <div
      className={`transcript-turn flex min-w-0 flex-col${
        isLastTurn ? " transcript-turn-live" : ""
      }${anchored && userBlock ? " transcript-turn-anchor" : ""}`}
    >
      {card
        ? discussionTopic
          ? [rows[0], card, ...rows.slice(1)]
          : [card, ...rows]
        : rows}
      {footer}
      {botProject && userBlock && settled ? (
        <BotFixCard path={botProject} turnId={userBlock.id} />
      ) : null}
      {asides.map((block) => (
        <div key={block.id} className="flow-root pb-1" data-discussion-aside>
          <TranscriptBlock
            block={block}
            layout={transcriptLayout}
            stickyIndex={stickyIndex}
            cwd={cwd}
            onOpenFile={onOpenFile}
            planHarness={harness}
            planModel={model}
          />
        </div>
      ))}
    </div>
  );
});

/** Placeholder for private reasoning before the first assistant text arrives. */
function InitialThinking({
  live,
  motion,
}: {
  live: boolean;
  motion?: MotionName;
}) {
  const motionRef = useMotionOnAttach<HTMLDivElement>(motion);
  return (
    <div
      ref={motionRef}
      className="min-w-0 px-4 pt-3 pb-1 font-sans text-sm text-content/50"
    >
      {live ? <Shimmer duration={1.6}>Thinking…</Shimmer> : "Thinking…"}
    </div>
  );
}

/**
 * The clock on a turn's fold line: how long the agent has been at it, or what
 * it is waiting on. The band that sweeps the text is sized off this element,
 * so it shrinks to the words — stretched across the row, the sweep spends its
 * time on empty space and the line just sits there looking dim.
 */
function LiveFoldTitle({
  startedAt,
  paused,
  waitingLabel,
  subagent = false,
  modelName,
  holdUps,
}: {
  startedAt?: number;
  paused: boolean;
  waitingLabel?: string;
  subagent?: boolean;
  modelName?: string;
  holdUps?: readonly SessionHoldUp[];
}) {
  const elapsedMs = useElapsedFrom(startedAt, paused);
  // The line ticks every second already; a hold-up reads the same clock.
  const holdUp = holdUps?.length
    ? holdUpAt(holdUps, Date.now()).words?.line
    : undefined;
  const text = paused
    ? (waitingLabel ?? "Needs you · Approve or deny below")
    : (holdUp ?? formatWorkingDuration(elapsedMs, false, subagent, modelName));
  return (
    <Shimmer className="min-w-0 truncate font-sans text-sm" duration={1}>
      {text}
    </Shimmer>
  );
}

/**
 * What a finished turn leaves under the answer: what you can do with it, and
 * when it landed. The clock lives on the fold line above, from the first token
 * to the last, so it is not repeated here.
 */
function TurnDuration({
  elapsedMs,
  labelHidden = false,
  modelName,
  currentModelName,
  harness,
  completedAt,
  copyText: output,
  onSaveNote,
  memoryProject,
  fromHarness,
  onSecondOpinion,
  onHandoff,
}: {
  elapsedMs: number | null;
  /** True when the fold line above already keeps the time for this turn. */
  labelHidden?: boolean;
  /** The turn's model, only when it differs from the chat's current one. */
  modelName?: string;
  /** The chat's model, which a second opinion should not offer again. */
  currentModelName?: string;
  harness?: HarnessId;
  completedAt?: number;
  copyText?: string;
  onSaveNote?: (text: string) => void;
  memoryProject?: string;
  fromHarness?: HarnessId;
  onSecondOpinion?: (harness: HarnessId, model: string) => void;
  onHandoff?: (harness: HarnessId, model: string) => void;
}) {
  const label = formatWorkingDuration(elapsedMs, true, false, modelName);
  const dot = (
    <span
      aria-hidden
      className="size-[3px] shrink-0 rounded-full bg-content/25"
    />
  );
  return (
    <div
      aria-label={label}
      className="personal-turn-receipt flex min-w-0 items-center gap-2.5 px-4 pt-1 pb-3 font-sans text-sm text-content/40"
    >
      <span className="flex shrink-0 items-center gap-1">
        {output ? (
          <>
            <CopyTurnButton text={output} />
            {onSaveNote ? (
              <SaveNoteButton text={output} onSave={onSaveNote} />
            ) : null}
            {memoryProject ? (
              <RememberButton project={memoryProject} text={output} />
            ) : null}
          </>
        ) : (
          <Check className="size-3.5" strokeWidth={1.75} />
        )}
        {fromHarness && onHandoff ? (
          <HandoffButton from={fromHarness} onPick={onHandoff} />
        ) : null}
        {fromHarness && onSecondOpinion ? (
          <SecondOpinionButton
            from={fromHarness}
            onPick={onSecondOpinion}
            hint="Ask another AI to check this reply"
            includeCurrent
            excludeModelName={currentModelName}
          />
        ) : null}
      </span>

      {labelHidden ? null : (
        <>
          {dot}
          <span className="flex min-w-0 items-center gap-1.5">
            {harness ? (
              <HarnessIcon harness={harness} className="size-3.5 shrink-0" />
            ) : null}
            <span className="min-w-0 truncate" title={label}>
              {label}
            </span>
          </span>
        </>
      )}

      {completedAt != null ? (
        <>
          {dot}
          <span className="shrink-0 text-content/35">
            {formatClockTime(completedAt)}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** Wall-clock stamp for a finished turn, in the reader's own locale. */
function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CopyTurnButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <button
      type="button"
      title={copied ? "Copied" : "Copy response"}
      aria-label={copied ? "Copied" : "Copy response"}
      className="-ml-1 rounded-md p-1 text-content/40 hover:bg-content/8 hover:text-content/70"
      onClick={() => {
        playCue("copy");
        void copyText(text).then(
          () => {
            setCopied(true);
            if (timer.current != null) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 2000);
          },
          () => {},
        );
      }}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={1.75} />
      ) : (
        <Copy className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

function SaveNoteButton({
  text,
  onSave,
}: {
  text: string;
  onSave: (text: string) => void;
}) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setSaved(false);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    };
  }, [text]);

  return (
    <button
      type="button"
      title={saved ? "Saved to Notes" : "Save to Notes"}
      aria-label={saved ? "Saved to Notes" : "Save to Notes"}
      className="rounded-md p-1 text-content/40 hover:bg-content/8 hover:text-content/70"
      onClick={() => {
        playCue("copy");
        onSave(text);
        setSaved(true);
        if (timer.current != null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSaved(false), 2000);
      }}
    >
      {saved ? (
        <Check className="size-3.5" strokeWidth={1.75} />
      ) : (
        <FilePlusCorner className="size-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

const TranscriptBlock = memo(function TranscriptBlock({
  block,
  motion,
  proposalReply = false,
  layout,
  stickyIndex,
  underLine = false,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  onOpenPlan,
  onBuildPlan,
  planBusy,
  planHarness,
  planModel,
}: {
  block: Block;
  /** Played once, when the block first shows: a sent message rises, a reply fades. */
  motion?: MotionName;
  proposalReply?: boolean;
  layout: TranscriptLayout;
  stickyIndex: number;
  /** True when something already sits directly above this in the turn. */
  underLine?: boolean;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  onOpenPlan?: (blockId: string) => void;
  onBuildPlan?: (blockId: string, target?: PlanBuildTarget) => void;
  planBusy?: boolean;
  planHarness?: HarnessId;
  planModel?: string;
}) {
  const replyRef = useMotionOnAttach<HTMLDivElement>(
    block.role === "user" ? undefined : motion,
  );
  if (block.role === "user") {
    if (block.botWake)
      return <BotWakeTag label={block.botWake.label} at={block.startedAt} />;
    return (
      <UserMessageBlock
        block={block}
        motion={motion}
        layout={layout}
        stickyIndex={stickyIndex}
        cwd={cwd}
      />
    );
  }

  if (block.role === "tool") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "reasoning") {
    return null;
  }

  if (block.role === "tasks") {
    if (!block.taskList?.items.length) return null;
    return (
      <div className="px-4 py-1">
        <TaskListPreview
          items={block.taskList.items}
          explanation={block.taskList.explanation}
        />
      </div>
    );
  }

  const text = proposalReply ? hideProposalMarkup(block.text) : block.text;

  if (block.role === "plan" && text === block.text) {
    if (block.orchestration) return null;
    const legacyTasks = legacyTaskListFromText(block.text);
    if (legacyTasks) {
      return (
        <div className="px-4 py-1">
          <TaskListPreview items={legacyTasks} />
        </div>
      );
    }
    return (
      <div className="px-4 py-1">
        <PlanPreview
          text={block.text}
          streaming={block.streaming}
          busy={planBusy}
          plan={block.plan}
          harness={planHarness}
          model={planModel}
          onOpen={onOpenPlan ? () => onOpenPlan(block.id) : undefined}
          onBuild={
            onBuildPlan ? (target) => onBuildPlan(block.id, target) : undefined
          }
        />
      </div>
    );
  }

  if (block.role === "approval") {
    return (
      <ToolCall
        block={block}
        cwd={cwd}
        onApproval={onApproval}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
    );
  }

  if (block.role === "handoff") {
    return <HandoffDivider block={block} />;
  }

  if (block.role === "system") {
    const notice = (
      <div className="personal-transcript-notice px-4 py-2 text-content/50">
        <pre className="min-w-0 whitespace-pre-wrap break-words">
          {block.text}
        </pre>
      </div>
    );
    // The other agent's last reply, in the chat that started the discussion.
    if (block.discussionReply)
      return (
        <DiscussionPartnerReply
          meta={block.discussionReply}
          text={block.text}
          arrivedAt={block.discussionReply.at}
          harness={planHarness}
          model={planModel}
          cwd={cwd ?? ""}
          onOpenFile={onOpenFile}
        />
      );
    // A finished discussion's closing note, in the chat that started it.
    if (block.discussionEnd)
      return (
        <>
          {notice}
          <DiscussionWrapUpNote meta={block.discussionEnd} />
        </>
      );
    return notice;
  }

  if (!text) return null;

  return (
    <div
      ref={replyRef}
      data-selectable-agent-response={block.streaming ? undefined : block.id}
      className={`personal-transcript-response min-w-0 px-4 pb-1 text-content ${underLine ? "pt-1" : "pt-3"}`}
    >
      <AgentMarkdown
        text={text}
        streaming={block.streaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
      />
    </div>
  );
});

function UserMessageBlock({
  block,
  motion,
  layout,
  stickyIndex,
  cwd,
}: {
  block: Block;
  motion?: MotionName;
  layout: TranscriptLayout;
  stickyIndex: number;
  cwd?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [singleLine, setSingleLine] = useState(false);
  const textRef = useRef<HTMLPreElement>(null);
  const bubbleRef = useMotionOnAttach<HTMLDivElement>(motion);
  const card = block.secondOpinion;
  const note = block.noteCard;
  const relay = block.discussion;
  const text =
    card && card.kind !== "handoff"
      ? ""
      : visibleUserPrompt(
          relay?.added ? withAdded(block.text, relay) : block.text,
        );
  const chat = layout === "chat";
  const textOnly =
    Boolean(text) && !block.attachments?.length && !card && !note && !relay;

  // Only the chat layout rounds a single line; the document layout always uses
  // the square corners, so it never needs the measurement at all.
  const roundsSingleLine = chat && textOnly;

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !text) {
      setOverflows(false);
      setSingleLine(false);
      return;
    }

    // Every user message carries one of these observers, so the callback runs
    // once per message whenever the transcript reflows. `getComputedStyle`
    // forces a style recalculation on each call and the line height only moves
    // with the font or the UI scale — never with a resize — so it is resolved
    // once here rather than on every delivery.
    let lineHeight = 0;
    const measure = () => {
      if (!expanded) {
        setOverflows(el.scrollHeight > el.clientHeight + 1);
      }
      if (!roundsSingleLine) {
        setSingleLine(false);
        return;
      }
      if (!lineHeight) {
        lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      }
      setSingleLine(
        Number.isFinite(lineHeight) && el.scrollHeight <= lineHeight + 1,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, roundsSingleLine, expanded]);

  const toggle = () => {
    if (overflows) setExpanded((value) => !value);
  };

  return (
    <div
      data-prompt-anchor={block.id}
      data-message-layout={layout}
      className={`personal-user-message ${
        chat ? "flex justify-end pt-1.5 pr-4 pb-4 pl-14" : "p-1.5 pb-3"
      }`}
    >
      <div
        ref={bubbleRef}
        className={`personal-user-bubble min-w-0 bg-content/10 px-3 py-2 font-sans text-content ${
          chat
            ? `w-fit max-w-xl ${singleLine ? "rounded-full" : "rounded-xl"}`
            : "rounded-lg border border-content/10"
        }`}
        style={{ zIndex: stickyIndex }}
        onClick={
          overflows
            ? (event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("a, button, [role='link']")
                )
                  return;
                toggle();
              }
            : undefined
        }
      >
        {block.attachments?.length ? (
          <div
            className={`personal-message-attachments flex flex-wrap gap-1.5 ${text || card || note ? "mb-2" : ""}`}
          >
            {block.attachments.map((file) => (
              <AttachmentChip
                key={file.id}
                attachment={file}
                group={block.attachments}
              />
            ))}
          </div>
        ) : null}
        {note ? (
          <div className={text || card ? "mb-2" : ""}>
            <NoteMiniCard card={note} embedded />
          </div>
        ) : null}
        {card ? (
          <div className={text ? "mb-1.5" : undefined}>
            <SecondOpinionCard card={card} />
          </div>
        ) : null}
        {relay ? (
          <div className={text ? "mb-1.5" : undefined}>
            <DiscussionRelayCard meta={relay} />
          </div>
        ) : null}
        {text ? (
          <pre
            ref={textRef}
            className={`min-w-0 whitespace-pre-wrap break-words font-sans text-sm ${expanded ? "" : "line-clamp-4"}`}
          >
            <ChatReferenceText text={text} cwd={cwd} interactive />
          </pre>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A relayed message in the chat that started a discussion keeps the reply
 * alone, with what the user added beside it: shown together, in the order
 * the agent read them.
 */
function withAdded(text: string, relay: DiscussionRelayMeta): string {
  const added = (entry: string) => `You added: ${entry}`;
  return [
    ...(relay.added?.before ?? []).map(added),
    ...(text ? [text] : []),
    ...(relay.added?.after ?? []).map(added),
  ].join("\n\n");
}

/**
 * Animate one fold, then release its contents. Closed work must not retain
 * a component and DOM tree for every tool; only expansion builds those rows.
 * Visible rows stay out of Grid so they rewrap when their pane changes width.
 */
function TurnRow({
  folded,
  children,
}: {
  folded: boolean;
  children: ReactNode | (() => ReactNode);
}) {
  const [foldState, setFoldState] = useState<
    "open" | "opening" | "closing" | "closed"
  >(folded ? "closed" : "open");

  useLayoutEffect(() => {
    setFoldState((current) => {
      if (folded) {
        return current === "closed" || current === "closing"
          ? current
          : "closing";
      }
      return current === "open" || current === "opening" ? current : "opening";
    });
  }, [folded]);

  useEffect(() => {
    if (foldState !== "opening" && foldState !== "closing") return;
    // Hidden tabs and reduced-motion styles may never fire animationend.
    const timer = window.setTimeout(() => {
      setFoldState(folded ? "closed" : "open");
    }, 350);
    return () => window.clearTimeout(timer);
  }, [foldState, folded]);

  if (folded && foldState === "closed") return null;

  return (
    // `inert` keeps folded work out of tab order and off the screen reader.
    <div
      className="zen-fold-item"
      data-fold-state={foldState}
      inert={folded}
      onAnimationEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        setFoldState(folded ? "closed" : "open");
      }}
    >
      {/* Keep padding off the Grid item itself. Otherwise its 4px bottom
       * padding survives a 0fr track and every folded row leaves a gap. */}
      <div>
        <div className="pb-1">
          {typeof children === "function" ? children() : children}
        </div>
      </div>
    </div>
  );
}

/** A turn item's identity, stable as the group it names grows. */
function turnItemKey(item: TurnItem): string {
  return item.type === "activity" ? item.blocks[0].id : item.block.id;
}

/**
 * The line a turn's work folds behind: the harness mark, and the clock —
 * ticking while the agent works, how long it took once it is done. Everything
 * the fold holds stays one click away, so the settled transcript reads as
 * prompt, answer, and a receipt for the work in between.
 */
function WorkFoldLine({
  title,
  kind,
  harness,
  live = false,
  expandable,
  open,
  onToggle,
}: {
  title: ReactNode;
  kind: ActivityPhaseKind;
  harness?: HarnessId;
  live?: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const icon = (
    <span className="personal-work-mark relative flex size-3.5 shrink-0 items-center justify-center">
      {open ? (
        // Open, the chevron stays put: it is the way back, and hunting for it
        // under the cursor is no way to close what you opened.
        <ChevronRight
          className="size-3.5 rotate-90 text-content/45"
          strokeWidth={1.75}
        />
      ) : (
        <>
          {harness ? (
            <HarnessIcon
              harness={harness}
              className={`size-3.5 shrink-0 ${expandable ? "group-hover:opacity-0" : ""}`}
            />
          ) : (
            <ActivityPhaseIcon
              kind={kind}
              className={expandable ? "group-hover:opacity-0" : ""}
            />
          )}
          {expandable ? (
            <ChevronRight
              className="absolute size-3.5 text-content/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              strokeWidth={1.75}
            />
          ) : null}
        </>
      )}
    </span>
  );
  // While the agent runs, the clock shimmers here rather than at the bottom,
  // which is now bare.
  const label = live ? (
    title
  ) : (
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/50 transition-colors duration-200 group-hover:text-content/80">
      {title}
    </span>
  );
  const row = `personal-work-fold flex w-full min-w-0 items-center gap-1.5 px-4 py-1 text-left${
    open ? " zen-fold-drop" : ""
  }`;

  if (!expandable) {
    return (
      <div
        className={`group ${row}`}
        role={live ? "status" : undefined}
        aria-live={live ? "polite" : undefined}
      >
        {icon}
        {label}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Hide the work" : "Show the work"}
      aria-live={live ? "polite" : undefined}
      onClick={onToggle}
      className={`group ${row}`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The turn's work as phases. Related reasoning and calls stay together while
 * assistant prose remains outside as full-size transcript text. The phase the
 * agent is in stays open, with new steps scrolling inside a short window; the
 * moment it moves on the phase folds back to its header.
 */
type ActivityPhasesProps = {
  blocks: Block[];
  cwd?: string;
  done?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
};

const ActivityPhases = memo(function ActivityPhases({
  blocks,
  cwd,
  done,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: ActivityPhasesProps) {
  const phases = useMemo(() => buildActivityPhases(blocks), [blocks]);

  return (
    <div className="personal-activity-phases flex min-w-0 flex-col gap-1 px-4">
      {phases.map((phase, index) => (
        <ActivityPhaseGroup
          key={phase.id}
          phase={phase}
          cwd={cwd}
          active={!done && index === phases.length - 1}
          onApproval={onApproval}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      ))}
    </div>
  );
}, sameActivity);

/**
 * A settled group is the same calls it was on the last token. Comparing the
 * blocks themselves keeps every earlier turn out of the streaming re-render,
 * which is most of what makes a long transcript stutter while the agent works.
 */
function sameActivity(a: ActivityPhasesProps, b: ActivityPhasesProps): boolean {
  return (
    a.cwd === b.cwd &&
    a.done === b.done &&
    a.onApproval === b.onApproval &&
    a.onOpenFile === b.onOpenFile &&
    a.onOpenDiff === b.onOpenDiff &&
    a.blocks.length === b.blocks.length &&
    a.blocks.every((block, index) => block === b.blocks[index])
  );
}

/**
 * Keep a live phase body on its newest step. Pinning happens in layout
 * before paint so the window follows without a visible hitch; scrolling up,
 * by wheel or otherwise, pauses that until the reader returns to the end.
 */
function useLivePhaseScroll(
  el: HTMLDivElement | null,
  enabled: boolean,
  steps: Block[],
) {
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const wasEnabled = useRef(false);

  // Growth is not the reader moving. Reconcile a scroll whose event has not
  // arrived yet, then pin only if still following.
  const pin = useCallback(() => {
    if (!el) return;
    stickToBottom.current = followsAfterScroll(
      el,
      lastScrollTop.current,
      stickToBottom.current,
    );
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
  }, [el]);

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) {
      stickToBottom.current = true;
      lastScrollTop.current = el?.scrollTop ?? 0;
      wasEnabled.current = true;
    }
    pin();
  }, [el, enabled, pin, steps]);

  useEffect(() => {
    if (!el || !enabled) return;

    const onScroll = () => {
      stickToBottom.current = followsAfterScroll(
        el,
        lastScrollTop.current,
        stickToBottom.current,
      );
      lastScrollTop.current = el.scrollTop;
    };
    const onWheel = (e: WheelEvent) => {
      if (!nestedScrollAbsorbsWheel(el, e.deltaY)) return;
      if (e.deltaY < 0) stickToBottom.current = false;
      e.stopPropagation();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    const inner = el.firstElementChild;
    const observer = new ResizeObserver(pin);
    if (inner) observer.observe(inner);
    pin();
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  }, [el, enabled, pin]);
}

/**
 * One phase: a header the whole group hangs off, and the steps under it on a
 * rail. Folding is automatic — the group opens while it is the live one and
 * closes when the agent moves on — until you click, after which it stays where
 * you put it. A step still waiting on you keeps the group open regardless.
 * While live, the open body stays a short scrolling window pinned to the
 * newest step; after the turn settles an opened group is full height again.
 */
function ActivityPhaseGroup({
  phase,
  cwd,
  active,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  phase: ActivityPhase;
  cwd?: string;
  active: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const waiting = phase.steps.some(needsApproval);
  const open = waiting || (override ?? active);
  const [liveScroller, setLiveScroller] = useState<HTMLDivElement | null>(null);
  useLivePhaseScroll(liveScroller, active && open, phase.steps);
  const title = activityPhaseTitle(phase, active);
  // Opening a group on purpose is also how you read the line that titled it,
  // whole. The auto-open while it runs is a live view, not a reading one, and
  // a one-line note the header already shows in full has nothing to add.
  const headline =
    override === true && phase.headline && headlineHasMore(phase.headline)
      ? phase.headline
      : undefined;
  const inert = phase.steps.length === 0 && !headlineHasMore(phase.headline);

  // A lone call the agent never introduced is not a group: a header repeating
  // the single row under it says nothing twice.
  if (!phase.headline && phase.steps.length === 1) {
    return (
      <div className="personal-activity-line flex min-w-0 items-start gap-1.5">
        <ActivityPhaseIcon kind={phase.kind} className="mt-[7px]" />
        <div className="min-w-0 flex-1">
          <ActivityRow
            block={phase.steps[0]}
            cwd={cwd}
            live={active}
            onApproval={onApproval}
            onOpenFile={onOpenFile}
            onOpenDiff={onOpenDiff}
          />
        </div>
      </div>
    );
  }

  const label = active ? (
    <Shimmer className="min-w-0 truncate font-sans text-sm" duration={1.6}>
      {title}
    </Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and
    // only the answer reads at full strength.
    <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/50 transition-colors duration-200 group-hover:text-content/80">
      {title}
    </span>
  );

  // A line the agent wrote with nothing under it is just that line.
  if (inert) {
    return (
      <div className="personal-activity-line flex min-w-0 items-center gap-1.5 py-1">
        <ActivityPhaseIcon kind={phase.kind} />
        {label}
      </div>
    );
  }

  return (
    <div className="personal-activity-phase flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          open ? `Hide the steps for ${title}` : `Show the steps for ${title}`
        }
        onClick={() => setOverride(!open)}
        className="group flex w-full min-w-0 items-center gap-1.5 py-1 text-left"
      >
        {/*
         * The two icons share one 14px box, so the swap is instant: fading
         * between them leaves both half-drawn on top of each other.
         */}
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <ActivityPhaseIcon
            kind={phase.kind}
            className="group-hover:opacity-0"
          />
          <ChevronRight
            className={`absolute size-3.5 text-content/45 opacity-0 transition-transform duration-200 group-hover:opacity-100 ${
              open ? "rotate-90" : ""
            }`}
            strokeWidth={1.75}
          />
        </span>
        {label}
      </button>
      <div className="zen-phase-body" data-open={open}>
        {open ? (
          <div
            ref={setLiveScroller}
            className={active || !open ? "zen-phase-live" : undefined}
          >
            <div className="flex min-w-0 flex-col">
              {headline ? (
                <div className="zen-phase-step py-1">
                  <AgentMarkdown
                    className={
                      headline.role === "reasoning"
                        ? "agent-reasoning"
                        : undefined
                    }
                    text={headline.text}
                    cwd={cwd}
                    onOpenFile={onOpenFile}
                  />
                </div>
              ) : null}
              {phase.steps.map((block) => (
                <div
                  key={block.id}
                  className={`zen-phase-step${active ? " zen-step-in" : ""}`}
                >
                  <ActivityRow
                    block={block}
                    cwd={cwd}
                    live={active}
                    onApproval={onApproval}
                    onOpenFile={onOpenFile}
                    onOpenDiff={onOpenDiff}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Whether the line that titled a group has more in it than the header shows. */
function headlineHasMore(block?: Block): boolean {
  if (!block) return false;
  return block.role === "reasoning" || /\n\s*\n/.test(block.text.trim());
}

/** What the group was for, at a glance: look, change, run, think. */
function ActivityPhaseIcon({
  kind,
  className = "",
}: {
  kind: ActivityPhaseKind;
  className?: string;
}) {
  const props = {
    className: `size-3.5 shrink-0 text-content/45 ${className}`,
    strokeWidth: 1.75,
  };
  if (kind === "edit") return <PenLine {...props} />;
  if (kind === "research") return <Search {...props} />;
  if (kind === "run") return <Terminal {...props} />;
  if (kind === "agent") return <Bot {...props} />;
  if (kind === "think") return null;
  if (kind === "other") return <Wrench {...props} />;
  return <Minus {...props} />;
}

/**
 * One step of the agent's work, whatever that step was: a tool call, a thought,
 * a paragraph. In a phase the rail draws the bullet, so the row drops its own
 * leading icon and leans on the rail instead.
 */
function ActivityRow({
  block,
  cwd,
  live = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  if (isThinkingBlock(block)) {
    return (
      <ActivityThinkingRow
        block={block}
        cwd={cwd}
        expandable
        bare
        onOpenFile={onOpenFile}
      />
    );
  }
  if (isProseBlock(block)) {
    return (
      <ActivityNoteRow
        block={block}
        cwd={cwd}
        bare
        expandable
        onOpenFile={onOpenFile}
      />
    );
  }
  return (
    <ActivityToolRow
      block={block}
      cwd={cwd}
      live={live}
      bare
      onApproval={onApproval}
      onOpenFile={onOpenFile}
      onOpenDiff={onOpenDiff}
    />
  );
}

/**
 * The line that keeps a long think from reading as a stall. Opening the fold
 * around it does not open the thought itself — reasoning is only ever read on
 * purpose, one line until you ask for it.
 */
function ActivityThinkingRow({
  block,
  cwd,
  expandable = false,
  bare = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  expandable?: boolean;
  bare?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = proseSummary(block.text) || "Thinking";
  // In a group the rail is the bullet, so there is nothing to breathe while
  // reasoning streams in — the line itself does.
  const pulse = block.streaming ? "zen-thinking-pulse" : "";
  const icon = bare ? null : (
    <Minus
      className={`size-3.5 shrink-0 text-content/40 ${pulse}`}
      strokeWidth={1.75}
    />
  );
  const label = (
    <span
      className={`min-w-0 flex-1 truncate font-sans text-sm text-content/50 ${
        bare ? pulse : ""
      }`}
    >
      {text}
    </span>
  );

  if (!expandable) {
    return (
      <div
        aria-label={`Thinking: ${text}`}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        {label}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Hide thinking" : `Show thinking: ${text}`}
        onClick={() => setOpen((value) => !value)}
        className="group flex min-w-0 items-center gap-1.5 py-1 text-left"
      >
        {icon}
        <span
          className={`min-w-0 flex-1 truncate font-sans text-sm text-content/50 transition-colors duration-200 group-hover:text-content/75 ${
            bare ? pulse : ""
          }`}
        >
          {text}
        </span>
      </button>
      {open ? (
        <div className={`min-w-0 pb-2 ${bare ? "" : "pl-5"}`}>
          <AgentMarkdown
            className="agent-reasoning"
            text={block.text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A line the agent wrote mid-run, kept to one line. It opens on click, so
 * folding the work never costs you a paragraph you wanted to read.
 */
function ActivityNoteRow({
  block,
  cwd,
  bare = false,
  expandable = false,
  onOpenFile,
}: {
  block: Block;
  cwd?: string;
  bare?: boolean;
  expandable?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = proseSummary(block.text);
  const icon = bare ? null : (
    <Minus className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
  );

  if (!expandable) {
    return (
      <div
        aria-label={`Agent said: ${text}`}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/70">
          {text}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Hide the full note" : `Agent said: ${text}`}
        onClick={() => setOpen((value) => !value)}
        className="group flex min-w-0 items-center gap-1.5 py-1 text-left"
      >
        {icon}
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-content/70 transition-colors duration-200 group-hover:text-content">
          {text}
        </span>
      </button>
      {open ? (
        <div className="min-w-0 pb-2">
          <AgentMarkdown text={block.text} cwd={cwd} onOpenFile={onOpenFile} />
        </div>
      ) : null}
    </div>
  );
}

function ActivityToolRow({
  block,
  cwd,
  live = false,
  bare = false,
  onApproval,
  onOpenFile,
  onOpenDiff,
}: {
  block: Block;
  cwd?: string;
  live?: boolean;
  bare?: boolean;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
}) {
  const label = toolCallLabel(block, cwd);
  const state = toolCallState(block);
  const pending = needsApproval(block);
  const openFile = isEditTool(
    block.tool?.kind,
    block.text || block.tool?.title,
    block.tool?.preview,
  )
    ? (onOpenDiff ?? onOpenFile)
    : onOpenFile;

  return (
    <div className="flex min-w-0 flex-col">
      <div
        aria-label={`Tool call: ${displayAppData(label)}`}
        className="flex min-w-0 items-center gap-1.5 py-1"
      >
        {bare ? null : <ActivityToolIcon state={state} live={live} />}
        <ToolCallSummary
          label={label}
          preview={block.tool?.preview}
          cwd={cwd}
          chip={bare}
          failed={state === "rejected"}
          onOpenFile={openFile}
        />
        {pending ? null : <ToolCallStatusIcon state={state} />}
      </div>
      {pending ? (
        <ApprovalControls block={block} onApproval={onApproval} />
      ) : null}
    </div>
  );
}

function ActivityToolIcon({
  state,
  live = false,
}: {
  state: ToolCallState;
  live?: boolean;
}) {
  if (state === "pending") {
    return (
      <CircleDashed
        className={`size-3.5 shrink-0 text-content/40 ${live ? "zen-tool-spin" : ""}`}
        strokeWidth={1.75}
      />
    );
  }

  return (
    <Minus className="size-3.5 shrink-0 text-content/50" strokeWidth={1.75} />
  );
}

/** Failure stays marked. Running and success do not get a trailing icon. */
function ToolCallStatusIcon({ state }: { state: ToolCallState }) {
  if (state === "rejected") {
    return <X className="size-3.5 shrink-0 text-red-400" strokeWidth={2} />;
  }
  return null;
}

function useElapsedFrom(
  startedAt: number | undefined,
  paused: boolean,
): number | null {
  const fallback = useRef<number | null>(null);
  const pausedMs = useRef(0);
  const pauseStarted = useRef<number | null>(null);
  const seenStartedAt = useRef(startedAt);

  if (seenStartedAt.current !== startedAt) {
    seenStartedAt.current = startedAt;
    fallback.current = null;
    pausedMs.current = 0;
    pauseStarted.current = paused ? Date.now() : null;
  }

  const origin = startedAt ?? (fallback.current ??= Date.now());
  const [elapsedMs, setElapsedMs] = useState(() =>
    Math.max(0, Date.now() - origin),
  );

  useEffect(() => {
    const start = startedAt ?? (fallback.current ??= Date.now());
    if (paused) {
      if (pauseStarted.current == null) pauseStarted.current = Date.now();
      return;
    }
    if (pauseStarted.current != null) {
      pausedMs.current += Date.now() - pauseStarted.current;
      pauseStarted.current = null;
    }
    const tick = () =>
      setElapsedMs(Math.max(0, Date.now() - start - pausedMs.current));
    return visibleInterval(tick, 1000);
  }, [startedAt, paused]);

  return elapsedMs;
}

function formatWorkingDuration(
  elapsedMs: number | null,
  done = false,
  subagent = false,
  modelName?: string,
): string {
  const who = modelName?.trim();
  const elapsed = formatElapsed(elapsedMs);
  const verb = workingVerb(done, subagent, !who);
  if (elapsed == null) {
    if (done) return who ? `${who} ${verb}` : verb;
    return who ? `${who} ${verb}…` : `${verb}…`;
  }
  return who ? `${who} ${verb} for ${elapsed}` : `${verb} for ${elapsed}`;
}

function workingVerb(
  done: boolean,
  subagent: boolean,
  capitalized: boolean,
): string {
  if (done) return capitalized ? "Worked" : "worked";
  if (subagent) return capitalized ? "Subagent running" : "subagent running";
  return capitalized ? "Working" : "working";
}

function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs == null) return null;
  const totalSec = Math.max(1, Math.round(elapsedMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function ToolCall({
  block,
  cwd,
  onApproval,
  onOpenFile,
  onOpenDiff,
  embedded,
}: {
  block: Block;
  cwd?: string;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
  onOpenFile?: (path: string) => void;
  onOpenDiff?: (path: string) => void;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = block.tool?.preview;
  const label = toolCallLabel(block, cwd);
  const detail = block.tool?.detail?.trim();
  const expanded = detail && detail !== label ? detail : label;
  const state = toolCallState(block);
  const stateLabel =
    state === "accepted"
      ? "Accepted"
      : state === "rejected"
        ? "Rejected"
        : "Pending";
  const editTool = isEditTool(
    block.tool?.kind,
    block.text || block.tool?.title,
    preview,
  );
  const compact =
    isReadTool(block.tool?.kind, label, preview) ||
    isSearchTool(block.tool?.kind, label, preview);
  const expandable = !compact && !!detail && detail !== label;

  const frame = `personal-tool-call ${embedded ? "py-0.5" : "px-4 py-1"}`;

  if (editTool) {
    return (
      <div className={frame}>
        <FilePreview
          preview={preview ?? stubFilePreview(block.tool?.kind, label)}
          status={state}
          cwd={cwd}
          onOpenFile={onOpenDiff ?? onOpenFile}
        />
        <ApprovalControls block={block} onApproval={onApproval} />
      </div>
    );
  }

  if (isIncompleteTool(block, label, state)) return null;

  return (
    <div className={frame}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${stateLabel} tool call: ${displayAppData(label)}`}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 text-left"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
          <ChevronRight
            className={`size-3.5 shrink-0 text-content/35 transition-transform ${open ? "rotate-90" : ""}`}
            strokeWidth={1.75}
          />
        </button>
      ) : (
        <div
          aria-label={`${stateLabel} tool call: ${displayAppData(label)}`}
          className="flex w-full min-w-0 items-center gap-2"
        >
          <ToolCallIcon state={state} />
          <ToolCallSummary
            label={label}
            preview={preview}
            cwd={cwd}
            failed={state === "rejected"}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
      {open && expandable ? (
        <pre className="mt-1.5 min-w-0 whitespace-pre-wrap break-words px-2.5 font-mono text-[12px] leading-5 text-content/55">
          {displayAppData(expanded)}
        </pre>
      ) : null}
      <ApprovalControls block={block} onApproval={onApproval} />
    </div>
  );
}

function ToolCallSummary({
  label,
  preview,
  cwd,
  onOpenFile,
  interactive = true,
  chip = false,
  failed = false,
}: {
  label: string;
  preview?: ToolPreview;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  interactive?: boolean;
  /** Sets the file off in a chip, for rows that lean on a rail for structure. */
  chip?: boolean;
  failed?: boolean;
}) {
  const parts = label.match(/^(Read|Find|Skill|List|Edit|Write)\s+(.+)$/);
  // A write preview carries the path itself, so edits get the same verb + file
  // chip as reads rather than falling through to a raw label.
  const writeTarget =
    preview?.kind === "write"
      ? preview.path
        ? displayPath(preview.path, cwd)
        : preview.fileName
      : undefined;
  const action =
    parts?.[1] ??
    (writeTarget ? editVerb(label) : undefined) ??
    (/^read$/i.test(label.trim()) && (preview?.path || preview?.fileName)
      ? "Read"
      : /^find$/i.test(label.trim()) && preview?.query
        ? "Find"
        : /^list$/i.test(label.trim()) && (preview?.path || preview?.fileName)
          ? "List"
          : /^skill$/i.test(label.trim())
            ? "Skill"
            : undefined);
  const target =
    parts?.[2] ??
    writeTarget ??
    (action === "Read" ||
    action === "List" ||
    action === "Edit" ||
    action === "Write"
      ? preview?.path
        ? displayPath(preview.path, cwd)
        : preview?.fileName
      : action === "Find"
        ? preview?.query
        : undefined);
  if (!action || !target) {
    const shownLabel = displayAppData(label);
    return (
      <span
        className={`min-w-0 flex-1 truncate font-mono text-ui-body ${
          failed ? "text-red-400" : chip ? "text-content/65" : "text-content/80"
        }`}
        title={shownLabel}
      >
        {shownLabel}
      </span>
    );
  }
  const isFile = action !== "Find" && action !== "Skill";
  const fileName =
    preview?.fileName ||
    target
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() ||
    "file";
  const filePath = resolveWorkspacePath(preview?.path || target, cwd);
  // What the row shows; opening still goes by the real path above.
  const shownTarget = displayAppData(target);
  const shownPath = displayAppData(preview?.path || target);
  const canOpen = interactive && !!onOpenFile && !!filePath;
  const actionTone = failed ? "text-red-400" : "text-content/50";
  const targetTone = failed
    ? "text-red-400"
    : chip
      ? "text-content/70"
      : "text-content/85";

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-ui-body">
      <span className={`shrink-0 font-sans text-sm ${actionTone}`}>
        {action}
      </span>
      {isFile ? (
        canOpen ? (
          <button
            type="button"
            className={`-my-0.5 flex min-w-0 cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left hover:text-sky-300 ${
              chip
                ? `max-w-full bg-content/6 hover:bg-content/10 ${targetTone}`
                : `flex-1 hover:underline ${targetTone}`
            }`}
            title={shownPath}
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile?.(filePath);
            }}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{shownTarget}</span>
          </button>
        ) : (
          <span
            className={`flex min-w-0 items-center gap-1 rounded px-1 ${
              chip
                ? `max-w-full bg-content/6 ${targetTone}`
                : `flex-1 ${targetTone}`
            }`}
            title={shownPath}
          >
            <FileTypeIcon name={fileName} isDir={action === "List"} />
            <span className="min-w-0 truncate">{shownTarget}</span>
          </span>
        )
      ) : (
        <span
          className={`flex min-w-0 flex-1 items-center gap-1.5 pl-1 ${targetTone}`}
          title={shownTarget}
        >
          <span className="min-w-0 truncate">{shownTarget}</span>
        </span>
      )}
    </span>
  );
}

function ToolCallIcon({ state }: { state: ToolCallState }) {
  if (state === "rejected") {
    return <X className="size-3.5 shrink-0 text-red-400" strokeWidth={2} />;
  }
  if (state === "pending") {
    return (
      <CircleDashed
        className="size-3.5 shrink-0 text-content/40"
        strokeWidth={1.75}
      />
    );
  }
  return null;
}

function ApprovalControls({
  block,
  onApproval,
}: {
  block: Block;
  onApproval?: (requestId: number, decision: ApprovalDecision) => void;
}) {
  const approval = block.approval;
  const words = useContext(ApprovalWords);
  if (!approval || approval.decided) return null;
  return (
    <div
      className="personal-tool-approval mt-1.5 flex gap-2"
      data-approval-pending
    >
      <button
        type="button"
        className="rounded-md bg-content px-2.5 py-0.5 text-ui-caption hover:bg-content/80     text-background-base"
        onClick={() => onApproval?.(approval.requestId, "allow")}
      >
        {words.allow}
      </button>
      <button
        type="button"
        className="rounded-md bg-(--aven-control-bg) px-2.5 py-0.5 text-ui-caption text-content/70 hover:bg-(--aven-control-hover) active:bg-(--aven-control-pressed)"
        onClick={() => onApproval?.(approval.requestId, "deny")}
      >
        {words.deny}
      </button>
    </div>
  );
}

function HandoffDivider({ block }: { block: Block }) {
  const meta = block.handoff;
  if (!meta) return null;

  const preparing = meta.status === "preparing";
  const label = preparing ? "Preparing a handoff" : HARNESS_TITLE[meta.to];

  return (
    <div className="px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="h-px min-w-4 flex-1 bg-content/12" />
        <div
          role="separator"
          aria-label={
            preparing
              ? `Preparing a handoff to ${HARNESS_TITLE[meta.to]}`
              : `Continued with ${label}`
          }
          className="flex max-w-[min(100%,20rem)] items-center gap-1.5 px-1.5 font-sans text-ui-label text-content/55"
        >
          {preparing ? (
            <>
              <TerminalSpinner className="inline-block w-3.5 shrink-0 select-none text-center text-ui-caption leading-none text-content/45" />
              <Shimmer duration={1.4}>{label}</Shimmer>
            </>
          ) : (
            <>
              <HarnessIcon harness={meta.to} className="size-3.5 shrink-0" />
            </>
          )}
        </div>
        <div className="h-px min-w-4 flex-1 bg-content/12" />
      </div>
    </div>
  );
}

function lastUserBlockId(blocks: Block[], managed = false): string | undefined {
  return turnUserBlock(blocks, managed)?.id;
}

/** All of a working turn's steps so far, from its first, as one fold. */
function liveWorkFold(items: TurnItem[]): WorkFold | undefined {
  const start = firstFoldableIndex(items);
  if (start < 0) return undefined;
  let end = -1;
  for (let index = items.length - 1; index >= start; index -= 1)
    if (isFoldableWorkItem(items[index])) {
      end = index;
      break;
    }
  return end >= start ? { start, end } : undefined;
}

/** The turn's last reply text, for telling a bot's "Nothing to report." */
function lastProseText(turn: readonly Block[]): string {
  for (let i = turn.length - 1; i >= 0; i--) {
    const block = turn[i];
    if (block.role === "assistant" && block.text.trim()) return block.text;
  }
  return "";
}

function turnUserBlock(
  blocks: readonly Block[],
  managed = false,
): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.role === "user" && (managed || !block.internal)) return block;
  }
  return undefined;
}

function pinToBottom(el: HTMLElement | null) {
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

/** Keep the live turn's min-height in lockstep with the visible transcript. */
function syncTranscriptViewport(el: HTMLElement | null) {
  if (!el || el.clientHeight <= 0) return;
  const inner = el.firstElementChild as HTMLElement | null;
  const pad = inner
    ? Number.parseFloat(getComputedStyle(inner).paddingBottom) || 0
    : 0;
  const next = `${Math.max(0, el.clientHeight - pad)}px`;
  if (el.style.getPropertyValue("--transcript-viewport") === next) return;
  el.style.setProperty("--transcript-viewport", next);
}
