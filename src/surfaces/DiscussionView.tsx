import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { ArrowUp, Check, MessageMultiple, Play, Square } from "../chrome/icons";
import { ProjectMascot } from "../chrome/ProjectMascot";
import { useDiscussionList } from "../hooks/useDiscussions";
import {
  discussionEndNote,
  discussionParty,
  discussionRound,
  discussionStore,
  INTERJECTION_CHAR_LIMIT,
  jumpInPlan,
  type Discussion,
  type DiscussionHost,
  type DiscussionSide,
} from "../lib/discussions";
import type { DiscussionStance } from "../lib/discussionStance";
import {
  arrivedReplies,
  buildDiscussionThread,
  isLongReply,
  lastReplyKeys,
  replyKeys,
  typingSide,
  waitsForNextTurn,
  type DiscussionThreadItem,
} from "../lib/discussionThread";
import {
  discussionVoices,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import { spokenName } from "../lib/discussionWrapUp";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
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
  /** The window that drives discussions; its build buttons need it. */
  host?: DiscussionHost;
};

/** Close enough to the end that new messages keep the view at the bottom. */
const STICK_PX = 48;
/** The message box grows to this height, then scrolls. */
const JUMP_IN_MAX_PX = 120;

/**
 * Two chats' discussion as one conversation: the topic first, each side's
 * finished replies as message bubbles (the chat that opened on the left,
 * the one responding on the right), what the user added in the middle,
 * round dividers, the side answering now typing, the closing note and,
 * once it has ended, where they landed with a button to build it. Stop and
 * Resume act on the discussion; the message box at the bottom adds
 * something for both chats. Closing this page stops nothing.
 */
export function DiscussionView({
  discussionId,
  a,
  b,
  focused = false,
  onOpenFile,
  host,
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
      host={host}
    />
  );
}

function DiscussionPage({
  discussion,
  a,
  b,
  focused,
  onOpenFile,
  host,
}: {
  discussion: Discussion;
  a?: Session;
  b?: Session;
  focused: boolean;
  onOpenFile?: (path: string) => void;
  host?: DiscussionHost;
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
  const reactions = useArrivalReactions(items);
  const lastKeys = useMemo(() => lastReplyKeys(items), [items]);
  const cwd = {
    a: a ? sessionWorkCwd(a) : partyA.cwd,
    b: b ? sessionWorkCwd(b) : partyB.cwd,
  };
  // What the user added while a turn is under way waits below its typing.
  const split = items.findIndex((item) => waitsForNextTurn(discussion, item));
  const before = split < 0 ? items : items.slice(0, split);
  const waiting = split < 0 ? [] : items.slice(split);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const onSent = useCallback(() => {
    stick.current = true;
  }, []);
  const onEscape = useCallback(
    () => scroller.current?.focus({ preventScroll: true }),
    [],
  );
  const paused = discussion.status === "paused";
  const ended = discussion.status === "ended";
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [items, typing, paused, discussion.summary]);
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

  const renderItem = (item: DiscussionThreadItem) => {
    const reply = item.kind === "reply";
    const cheering = reply && cheerId !== null && lastKeys.has(item.key);
    const arrival = reply ? reactions.get(item.key) : undefined;
    return (
      <ThreadItem
        key={item.key}
        item={item}
        voice={reply ? voices[item.side] : undefined}
        cwd={reply ? cwd[item.side] : cwd.a}
        reaction={cheering ? "cheer" : (arrival?.kind ?? null)}
        reactionId={cheering ? (cheerId ?? undefined) : arrival?.id}
        note={
          item.kind === "user"
            ? userNote(discussion, item.turn, item.state)
            : undefined
        }
        onOpenFile={onOpenFile}
      />
    );
  };

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
          {before.map(renderItem)}
          {typing ? <TypingRow voice={voices[typing]} /> : null}
          {waiting.map(renderItem)}
          {paused ? (
            <PausedRow id={discussion.id} reason={discussion.reason} />
          ) : null}
          {ended ? (
            <WrapUpCard
              discussion={discussion}
              voices={voices}
              build={host?.build}
            />
          ) : null}
        </ol>
      </div>
      {/* Only a window that drives discussions can pass the message on. */}
      {discussion.preview || !host ? null : (
        <JumpInBox
          discussion={discussion}
          onSent={onSent}
          onEscape={onEscape}
        />
      )}
    </div>
  );
}

/** The quiet line under something the user added that has not gone yet. */
function userNote(
  discussion: Discussion,
  turn: number,
  state: "sent" | "queued" | "unsent",
): string | undefined {
  if (state === "unsent") return "Not passed on: the discussion ended first";
  if (state !== "queued") return undefined;
  if (turn > discussion.settled) return "Goes with the next reply";
  return discussion.status === "paused" ? "Sends when it resumes" : undefined;
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
    setCheer(`${discussion.id}-cheer-${discussion.settled}`);
    const timer = window.setTimeout(
      () => setCheer(null),
      MASCOT_REACTION_MS.cheer + 200,
    );
    return () => window.clearTimeout(timer);
  }, [completed, discussion.id, discussion.settled, ended]);
  return cheer;
}

const STANCE_REACTION: Record<DiscussionStance, MascotReactionKind> = {
  agree: "nod",
  pushback: "tilt",
};

type Arrival = { kind: MascotReactionKind; id: string };
const NO_ARRIVALS: ReadonlyMap<string, Arrival> = new Map();

/**
 * The reaction each reply plays as it lands while this page is open: a nod
 * when it agrees with the reply before it, a head-tilt when it pushes back,
 * nothing when it is neutral. Replies already there when the page opened
 * never react, and a reply reacts once, however often the page renders, is
 * hidden behind another tab or is rebuilt.
 */
function useArrivalReactions(
  items: readonly DiscussionThreadItem[],
): ReadonlyMap<string, Arrival> {
  const known = useRef<Set<string> | null>(null);
  known.current ??= replyKeys(items);
  const [playing, setPlaying] = useState(NO_ARRIVALS);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const landed = arrivedReplies(items, known.current!).filter(
      (item) => item.stance,
    );
    if (!landed.length) return;
    const started = landed.map((item) => ({
      key: item.key,
      kind: STANCE_REACTION[item.stance!],
    }));
    setPlaying((current) => {
      const next = new Map(current);
      for (const { key, kind } of started)
        next.set(key, { kind, id: `${key}-${kind}` });
      return next;
    });
    const longest = Math.max(
      ...started.map(({ kind }) => MASCOT_REACTION_MS[kind]),
    );
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setPlaying((current) => {
        const next = new Map(current);
        for (const { key } of started) next.delete(key);
        return next.size ? next : NO_ARRIVALS;
      });
    }, longest + 200);
    timers.current.add(timer);
  }, [items]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);
  return playing;
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

const STANCE_LABEL: Record<DiscussionStance, string> = {
  agree: "Agrees",
  pushback: "Pushes back",
};

/** A tiny mark beside a reply's name: a check when it agrees, ↔ when not. */
function StanceMark({ stance }: { stance: DiscussionStance }) {
  return (
    <span
      className="discussion-stance"
      data-discussion-stance={stance}
      title={STANCE_LABEL[stance]}
      aria-label={STANCE_LABEL[stance]}
      role="img"
    >
      {stance === "agree" ? (
        <Check className="size-2.5" strokeWidth={2.5} />
      ) : (
        "↔"
      )}
    </span>
  );
}

const ThreadItem = memo(function ThreadItem({
  item,
  voice,
  cwd,
  reaction,
  reactionId,
  note,
  onOpenFile,
}: {
  item: DiscussionThreadItem;
  voice?: DiscussionVoice;
  cwd: string;
  reaction: MascotReactionKind | null;
  reactionId?: string;
  /** Under a message the user added: why it has not gone yet. */
  note?: string;
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
      return (
        <li
          className="discussion-you"
          data-discussion-you={item.turn}
          data-state={item.state}
        >
          <span className="discussion-you-label">You</span>
          <p className="discussion-you-bubble">{item.text}</p>
          {note ? <span className="discussion-you-note">{note}</span> : null}
        </li>
      );
    case "reply":
      return voice ? (
        <li
          className="discussion-message"
          data-side={item.side}
          data-discussion-message={item.turn}
          data-stance={item.stance ?? undefined}
          style={{ "--discussion-voice": voice.color } as CSSProperties}
        >
          <DiscussionAvatar
            voice={voice}
            reaction={reaction}
            reactionId={reactionId}
          />
          <div className="discussion-message-body">
            <span className="discussion-message-name">
              {voice.name}
              {item.stance ? <StanceMark stance={item.stance} /> : null}
            </span>
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

/**
 * After the closing note: where the two chats landed and a button to have
 * either one build it. Only a discussion that used up its rounds is summed
 * up; a stopped one shows just the buttons.
 */
const WrapUpCard = memo(function WrapUpCard({
  discussion,
  voices,
  build,
}: {
  discussion: Discussion;
  voices: Record<DiscussionSide, DiscussionVoice>;
  build?: DiscussionHost["build"];
}) {
  const [sent, setSent] = useState<DiscussionSide | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const completed = discussion.ended?.kind === "completed";
  if (!completed && !build) return null;
  const { summary } = discussion;
  const summing =
    summary?.status === "pending" || summary?.status === "running";
  const done = summary?.status === "done" ? summary : null;
  const state = !completed
    ? "stopped"
    : summing
      ? "summing"
      : done
        ? "done"
        : "plain";
  return (
    <li
      className="discussion-wrapup"
      data-discussion-wrapup={state}
      aria-label="Where they landed"
    >
      {completed ? (
        <div className="discussion-wrapup-head">
          <h3 className="discussion-wrapup-title">Where they landed</h3>
          {done?.model ? (
            <span className="discussion-wrapup-model">
              Summed up by {done.model}
            </span>
          ) : null}
        </div>
      ) : null}
      {summing ? (
        <p className="discussion-wrapup-wait" role="status">
          Summing up…
        </p>
      ) : null}
      {done ? (
        <div className="discussion-wrapup-lists">
          <WrapUpList
            kind="agreed"
            title="Agreed"
            items={done.agreed}
            empty="Nothing settled."
          />
          <WrapUpList
            kind="open"
            title="Still open"
            items={done.open}
            empty="Nothing left open."
          />
        </div>
      ) : null}
      {build ? (
        <div className="discussion-wrapup-actions">
          {(["a", "b"] as const).map((side) => {
            const voice = voices[side];
            const party = discussionParty(discussion, side);
            return (
              <button
                key={side}
                type="button"
                className="discussion-build"
                data-discussion-build={side}
                data-sent={sent === side || undefined}
                style={{ "--discussion-voice": voice.color } as CSSProperties}
                title={`Send the plan to “${voice.title}”`}
                onClick={() => {
                  const refused = build(discussion.id, side);
                  setProblem(refused);
                  setSent(refused ? null : side);
                }}
              >
                {sent === side ? (
                  <Check className="size-3 shrink-0" strokeWidth={2.5} />
                ) : (
                  <ProjectMascot
                    project={voice.sessionId}
                    name={voice.mascot}
                    color={voice.color}
                    className="discussion-build-sprite"
                  />
                )}
                <span className="truncate">
                  Have {spokenName(party)} build it
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {problem ? (
        <p className="discussion-wrapup-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </li>
  );
});

function WrapUpList({
  kind,
  title,
  items,
  empty,
}: {
  kind: "agreed" | "open";
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <section className="discussion-wrapup-list" data-discussion-list={kind}>
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="discussion-wrapup-empty">{empty}</p>
      )}
    </section>
  );
}

const JUMP_IN_HINT: Record<string, string | undefined> = {
  resume: "Resumes the discussion",
  extend: "Adds one more round",
  continue: "Continues for one more round",
};

const JUMP_IN_SEND: Record<string, string> = {
  queue: "Send to both",
  resume: "Send to both and resume",
  extend: "Send to both and add one more round",
  continue: "Send to both and continue for one more round",
};

/**
 * The message box under the thread: something the user adds for both
 * chats. While they talk it goes with the next relay, never interrupting a
 * turn; while paused, sending resumes; once ended, it continues the
 * discussion for one more round. Enter sends, Shift+Enter adds a line and
 * Escape leaves the box.
 */
const JumpInBox = memo(function JumpInBox({
  discussion,
  onSent,
  onEscape,
}: {
  discussion: Discussion;
  onSent: () => void;
  onEscape: () => void;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const plan = jumpInPlan(discussion);
  const blocked = plan.kind === "blocked" ? plan.reason : null;
  const hint = blocked ? null : JUMP_IN_HINT[plan.kind];
  const label = JUMP_IN_SEND[plan.kind] ?? "Send to both";
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, JUMP_IN_MAX_PX)}px`;
  }, [text]);
  const send = () => {
    if (!text.trim() || blocked) return;
    const refused = discussionStore().interject(discussion.id, text);
    setProblem(refused);
    if (refused) return;
    setText("");
    onSent();
  };
  return (
    <form
      className="discussion-jump"
      data-discussion-jump={plan.kind}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <div className="discussion-jump-box">
        <textarea
          ref={field}
          rows={1}
          value={text}
          maxLength={INTERJECTION_CHAR_LIMIT}
          disabled={!!blocked}
          placeholder={blocked ?? "Add something for both of them…"}
          aria-label="Add something for both of them"
          className="discussion-jump-field"
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
              onEscape();
              return;
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        {hint ? <span className="discussion-jump-hint">{hint}</span> : null}
        <button
          type="submit"
          className="discussion-jump-send"
          disabled={!text.trim() || !!blocked}
          title={label}
          aria-label={label}
        >
          <ArrowUp className="size-3.5" strokeWidth={2.25} />
        </button>
      </div>
      {problem ? (
        <p className="discussion-jump-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
});
