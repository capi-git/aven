import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { MessageMultiple, Play, Square } from "../chrome/icons";
import { useDiscussionList } from "../hooks/useDiscussions";
import {
  discussionEndNote,
  discussionRound,
  discussionStore,
  type Discussion,
  type DiscussionSide,
} from "../lib/discussions";
import {
  buildDiscussionThread,
  isLongReply,
  lastReplyKeys,
  typingSide,
  type DiscussionThreadItem,
} from "../lib/discussionThread";
import {
  discussionVoices,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import { MASCOT_REACTION_MS } from "../lib/mascotReactions";
import { sessionWorkCwd, type Session } from "../lib/session";
import { AgentMarkdown } from "./AgentMarkdown";
import "./DiscussionView.css";

type Props = {
  discussionId: string;
  /** The two chats, as committed; absent when one is not open here. */
  a?: Session;
  b?: Session;
  /** Its pane is focused: the page takes the keyboard. */
  focused?: boolean;
  onOpenFile?: (path: string) => void;
};

/** Close enough to the end that new messages keep the view at the bottom. */
const STICK_PX = 48;

/**
 * Two chats' discussion as one conversation: the topic first, each side's
 * finished replies as message bubbles (the chat that opened on the left,
 * the one responding on the right), round dividers, the side answering now
 * typing, and the closing note. Stop and Resume act on the discussion; the
 * chats keep relaying as before, and closing this page stops nothing.
 */
export function DiscussionView({
  discussionId,
  a,
  b,
  focused = false,
  onOpenFile,
}: Props) {
  const list = useDiscussionList();
  const discussion = useMemo(
    () => list.find((entry) => entry.id === discussionId),
    [list, discussionId],
  );
  if (!discussion)
    return (
      <div
        className="grid h-full place-items-center px-6 text-center"
        data-discussion-view={discussionId}
      >
        <p className="max-w-sm text-ui-label leading-5 text-content/45">
          This discussion is no longer available. Its messages are still in both
          chats.
        </p>
      </div>
    );
  return (
    <DiscussionPage
      discussion={discussion}
      a={a}
      b={b}
      focused={focused}
      onOpenFile={onOpenFile}
    />
  );
}

function DiscussionPage({
  discussion,
  a,
  b,
  focused,
  onOpenFile,
}: {
  discussion: Discussion;
  a?: Session;
  b?: Session;
  focused: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const { a: partyA, b: partyB } = discussion;
  const voices = useMemo(
    () => discussionVoices({ a: partyA, b: partyB }),
    [partyA, partyB],
  );
  const thread = useRef<readonly DiscussionThreadItem[]>([]);
  const blocksA = a?.blocks;
  const blocksB = b?.blocks;
  const items = useMemo(() => {
    thread.current = buildDiscussionThread(
      discussion,
      { a: blocksA, b: blocksB },
      thread.current,
    );
    return thread.current;
  }, [discussion, blocksA, blocksB]);
  const typing = typingSide(discussion);
  const cheerId = useEndingCheer(discussion);
  const lastKeys = useMemo(() => lastReplyKeys(items), [items]);
  const cwd = {
    a: a ? sessionWorkCwd(a) : partyA.cwd,
    b: b ? sessionWorkCwd(b) : partyB.cwd,
  };

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const paused = discussion.status === "paused";
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [items, typing, paused]);
  // Opened or focused as a pane: take the keyboard from the chat that sent
  // the topic, so scrolling keys and closing the tab act on this page.
  useEffect(() => {
    const element = scroller.current;
    if (!focused || !element) return;
    if (
      element
        .closest("[data-discussion-view]")
        ?.contains(document.activeElement)
    )
      return;
    element.focus({ preventScroll: true });
  }, [focused]);

  return (
    <div
      className="discussion-view"
      data-discussion-view={discussion.id}
      data-status={discussion.status}
    >
      <DiscussionHeader
        discussion={discussion}
        voices={voices}
        typing={typing}
      />
      <div
        ref={scroller}
        tabIndex={-1}
        className="discussion-scroll"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            STICK_PX;
        }}
      >
        <ol className="discussion-thread" aria-label="Discussion">
          {items.map((item) => (
            <ThreadItem
              key={item.key}
              item={item}
              voice={item.kind === "reply" ? voices[item.side] : undefined}
              cwd={item.kind === "reply" ? cwd[item.side] : cwd.a}
              cheerId={
                item.kind === "reply" && lastKeys.has(item.key) ? cheerId : null
              }
              onOpenFile={onOpenFile}
            />
          ))}
          {typing ? <TypingRow voice={voices[typing]} /> : null}
          {paused ? (
            <PausedRow id={discussion.id} reason={discussion.reason} />
          ) : null}
        </ol>
      </div>
    </div>
  );
}

/**
 * A one-shot hop for both sides' last messages when this page sees the
 * discussion finish all its rounds; never on opening a finished one.
 */
function useEndingCheer(discussion: Discussion): string | null {
  const [cheer, setCheer] = useState<string | null>(null);
  const ended = discussion.status === "ended";
  const completed = discussion.ended?.kind === "completed";
  const seen = useRef(ended);
  useEffect(() => {
    const before = seen.current;
    seen.current = ended;
    if (!ended || before || !completed) return;
    setCheer(`${discussion.id}-cheer`);
    const timer = window.setTimeout(
      () => setCheer(null),
      MASCOT_REACTION_MS.cheer + 200,
    );
    return () => window.clearTimeout(timer);
  }, [completed, discussion.id, ended]);
  return cheer;
}

const DiscussionHeader = memo(function DiscussionHeader({
  discussion,
  voices,
  typing,
}: {
  discussion: Discussion;
  voices: Record<DiscussionSide, DiscussionVoice>;
  typing: DiscussionSide | null;
}) {
  const store = discussionStore();
  const paused = discussion.status === "paused";
  const ended = discussion.status === "ended";
  const preview = discussion.preview ? "Preview · " : "";
  const round = `Round ${discussionRound(discussion)} of ${discussion.rounds}`;
  const status = ended
    ? discussionEndNote(discussion)
    : paused
      ? `${round} · Paused`
      : typing
        ? `${round} · ${voices[typing].name} is replying…`
        : round;
  return (
    <header className="discussion-header" data-discussion-header>
      <div className="discussion-cast" data-discussion-cast>
        <Party voice={voices.a} />
        <span className="discussion-cast-link" aria-hidden>
          <MessageMultiple className="size-3.5" />
        </span>
        <Party voice={voices.b} />
      </div>
      <div className="discussion-status">
        <span
          className="min-w-0 flex-1 truncate"
          role="status"
          title={paused ? discussion.reason : undefined}
        >
          {preview}
          {status}
        </span>
        {paused ? (
          <button
            type="button"
            className="discussion-action"
            onClick={() => store.resume(discussion.id)}
          >
            <Play className="size-3" />
            Resume
          </button>
        ) : null}
        {!ended ? (
          <button
            type="button"
            className="discussion-action"
            title="Stop discussion"
            aria-label="Stop discussion"
            onClick={() => store.stop(discussion.id)}
          >
            <Square className="size-2.5" />
            Stop
          </button>
        ) : null}
      </div>
    </header>
  );
});

function Party({ voice }: { voice: DiscussionVoice }) {
  return (
    <div
      className="discussion-party"
      data-side={voice.side}
      title={`${voice.name} in “${voice.title}”`}
    >
      <DiscussionAvatar voice={voice} size="large" />
      <div className="discussion-party-text">
        <span className="discussion-party-name">{voice.name}</span>
        <span className="discussion-party-persona">
          {voice.persona} · “{voice.title}”
        </span>
      </div>
    </div>
  );
}

const ThreadItem = memo(function ThreadItem({
  item,
  voice,
  cwd,
  cheerId,
  onOpenFile,
}: {
  item: DiscussionThreadItem;
  voice?: DiscussionVoice;
  cwd: string;
  cheerId: string | null;
  onOpenFile?: (path: string) => void;
}) {
  switch (item.kind) {
    case "topic":
      return (
        <li className="discussion-topic" data-discussion-topic>
          <span className="discussion-topic-label">Topic from you</span>
          <Foldable
            className="discussion-topic-card"
            text={item.text}
            cwd={cwd}
            onOpenFile={onOpenFile}
          />
        </li>
      );
    case "round":
      return (
        <li className="discussion-round" data-discussion-round={item.round}>
          Round {item.round} of {item.rounds}
        </li>
      );
    case "closing":
      return (
        <li
          className="discussion-closing"
          data-discussion-closing={item.completed ? "completed" : "stopped"}
        >
          {item.text}
        </li>
      );
    case "user":
      // Shown on the page from the next change on.
      return null;
    case "reply":
      return voice ? (
        <li
          className="discussion-message"
          data-side={item.side}
          data-discussion-message={item.turn}
          style={{ "--discussion-voice": voice.color } as CSSProperties}
        >
          <DiscussionAvatar voice={voice} cheerId={cheerId} />
          <div className="discussion-message-body">
            <span className="discussion-message-name">{voice.name}</span>
            {item.text ? (
              <Foldable
                className="discussion-bubble"
                text={item.text}
                cwd={cwd}
                onOpenFile={onOpenFile}
              />
            ) : (
              <p className="discussion-bubble discussion-bubble-missing">
                {item.text === null
                  ? `“${voice.title}” isn't open in this window, so its reply can't be shown here.`
                  : "No reply text."}
              </p>
            )}
          </div>
        </li>
      ) : null;
  }
});

/** Markdown in a bubble, folded behind Show more when it is long. */
function Foldable({
  className,
  text,
  cwd,
  onOpenFile,
}: {
  className: string;
  text: string;
  cwd: string;
  onOpenFile?: (path: string) => void;
}) {
  const long = isLongReply(text);
  const [open, setOpen] = useState(false);
  const folded = long && !open;
  return (
    <>
      <div className={className} data-folded={folded || undefined}>
        <AgentMarkdown text={text} cwd={cwd} onOpenFile={onOpenFile} />
      </div>
      {long ? (
        <button
          type="button"
          className="discussion-more"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

const TypingRow = memo(function TypingRow({
  voice,
}: {
  voice: DiscussionVoice;
}) {
  return (
    <li
      className="discussion-message"
      data-side={voice.side}
      data-discussion-typing={voice.side}
      style={{ "--discussion-voice": voice.color } as CSSProperties}
    >
      <DiscussionAvatar voice={voice} typing />
      <div className="discussion-message-body">
        <span className="discussion-message-name">{voice.name}</span>
        <div
          className="discussion-bubble discussion-typing"
          role="status"
          aria-label={`${voice.name} is replying`}
        >
          <span className="discussion-dot" />
          <span className="discussion-dot" />
          <span className="discussion-dot" />
        </div>
      </div>
    </li>
  );
});

const PausedRow = memo(function PausedRow({
  id,
  reason,
}: {
  id: string;
  reason?: string;
}) {
  return (
    <li className="discussion-paused" data-discussion-paused>
      <span className="min-w-0">Paused{reason ? ` · ${reason}` : ""}</span>
      <button
        type="button"
        className="discussion-action"
        onClick={() => discussionStore().resume(id)}
      >
        <Play className="size-3" />
        Resume
      </button>
    </li>
  );
});
