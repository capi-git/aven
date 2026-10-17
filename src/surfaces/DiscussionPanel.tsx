import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DiscussionAvatar } from "../chrome/DiscussionAvatar";
import { DiscussionWrapUpCard } from "../chrome/DiscussionWrapUp";
import { ArrowUp, Play, Square } from "../chrome/icons";
import { useDiscussionList } from "../hooks/useDiscussions";
import {
  discussionRound,
  completedRounds,
  discussionStore,
  INTERJECTION_CHAR_LIMIT,
  jumpInPlan,
  type Discussion,
  type DiscussionHost,
  type DiscussionSide,
} from "../lib/discussions";
import {
  firstNewReply,
  foldedRoundCount,
  foldLabel,
  newSinceLabel,
  replyCount,
  threadRounds,
} from "../lib/discussionPanel";
import {
  arrivedReplies,
  buildDiscussionThread,
  lastReplyKeys,
  replyKeys,
  typingSide,
  waitsForNextTurn,
  type DiscussionThreadItem,
} from "../lib/discussionThread";
import {
  discussionVoices,
  providerShortName,
  type DiscussionVoice,
} from "../lib/discussionVoices";
import {
  MASCOT_REACTION_MS,
  type MascotReactionKind,
} from "../lib/mascotReactions";
import { sessionWorkCwd, type Session } from "../lib/session";
import type { TeamWatchAct, TeamWatchAction } from "../lib/teamWatch";
import {
  DiscussionMessage,
  DiscussionRound,
  DiscussionTyping,
  Foldable,
  StanceMark,
  STANCE_REACTION,
} from "./DiscussionMessages";
import { TeamPanelBar, type TeamPanelControls } from "./TeamPanelBar";
import "./DiscussionPanel.css";

/** Close enough to the end that new messages keep the view at the bottom. */
const STICK_PX = 48;
/** The message box grows to this height, then scrolls. */
const JUMP_IN_MAX_PX = 120;
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The topic's first line, for the panel's header. */
function topicLine(topic: string): string {
  const line = topic.trim().split(/\r?\n/)[0]?.trim() ?? "";
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/** "Codex is replying…", "Needs you", "Done": what a discussion is doing. */
export function discussionStatus(
  discussion: Pick<Discussion, "status" | "settled" | "ended" | "a" | "b">,
): { state: "replying" | "needs-you" | "done" | "stopped"; text: string } {
  if (discussion.status === "paused")
    return { state: "needs-you", text: "Needs you" };
  if (discussion.status === "ended")
    return discussion.ended?.kind === "completed"
      ? { state: "done", text: "Done" }
      : { state: "stopped", text: "Stopped" };
  const party = discussion.settled % 2 === 0 ? discussion.a : discussion.b;
  return {
    state: "replying",
    text: `${providerShortName(party.harness)} is replying…`,
  };
}

/**
 * What the discussion's panel asks for, done in the window that drives it:
 * stop, resume, add something for both, open a side's chat, have a side
 * build the plan. Returns why it could not, or null.
 */
export function performDiscussionAction(
  discussion: Pick<Discussion, "id" | "a" | "b">,
  host: DiscussionHost | undefined,
  action: TeamWatchAction,
): string | null {
  const store = discussionStore();
  switch (action.kind) {
    case "stop":
      store.stop(discussion.id);
      return null;
    case "resume":
      store.resume(discussion.id);
      return null;
    case "jump-in":
      return store.interject(discussion.id, action.text);
    case "build":
      return host?.build
        ? host.build(discussion.id, action.side)
        : "This window can't send the plan.";
    case "open-chat": {
      const side =
        discussion.a.sessionId === action.sessionId
          ? "a"
          : discussion.b.sessionId === action.sessionId
            ? "b"
            : null;
      if (!side || !host?.show) return "This window can't open that chat.";
      host.show(discussion.id, side);
      return null;
    }
    default:
      return null;
  }
}

/**
 * One discussion in the panel: its header with shrink and close, the two
 * agents facing each other with the round and its track, the thread, and
 * the box that adds something for both. Long threads fold their older
 * rounds and have a rail to jump between rounds; replies that arrived
 * since the user last looked are marked. Built here from the two chats'
 * transcripts; `act` does what its buttons ask (by default, right here).
 */
export function DiscussionPanelContent({
  discussionId,
  a,
  b,
  host,
  act,
  onOpenFile,
  seen,
  onSeen,
  controls,
}: {
  discussionId: string;
  /** The two chats, as committed; absent when one is not loaded here. */
  a?: Session;
  b?: Session;
  host?: DiscussionHost;
  /** Performs the panel's actions; the store and `host` by default. */
  act?: TeamWatchAct;
  onOpenFile?: (path: string) => void;
  /** Replies the user had seen when this opened. */
  seen?: number;
  onSeen?: (id: string, count: number) => void;
  /** The header's shrink, pop-out and close. */
  controls?: TeamPanelControls;
}) {
  const list = useDiscussionList();
  const full = useMemo(
    () => list.find((entry) => entry.id === discussionId),
    [list, discussionId],
  );
  if (!full)
    return (
      <div className="discussion-view" data-discussion-view={discussionId}>
        <div className="discussion-float-head">
          <TeamPanelBar title="Discussion" controls={controls} />
        </div>
        <p className="px-6 py-10 text-center text-ui-label leading-5 text-content/45">
          This discussion is no longer available.
        </p>
      </div>
    );
  return (
    <PanelBody
      discussion={full}
      a={a}
      b={b}
      host={host}
      act={act}
      onOpenFile={onOpenFile}
      seen={seen}
      onSeen={onSeen}
      controls={controls}
    />
  );
}

function PanelBody({
  discussion,
  a,
  b,
  host,
  act,
  onOpenFile,
  seen,
  onSeen,
  controls,
}: {
  discussion: Discussion;
  a?: Session;
  b?: Session;
  host?: DiscussionHost;
  act?: TeamWatchAct;
  onOpenFile?: (path: string) => void;
  seen?: number;
  onSeen?: (id: string, count: number) => void;
  controls?: TeamPanelControls;
}) {
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
  const cwdA = a ? sessionWorkCwd(a) : discussion.a.cwd;
  const cwdB = b ? sessionWorkCwd(b) : discussion.b.cwd;
  const cwd = useMemo(() => ({ a: cwdA, b: cwdB }), [cwdA, cwdB]);
  const hostRef = useRef(host);
  hostRef.current = host;
  const ownAct = useCallback<TeamWatchAct>(
    (action) => performDiscussionAction(discussion, hostRef.current, action),
    [discussion],
  );
  return (
    <DiscussionThreadPanel
      discussion={discussion}
      items={items}
      cwd={cwd}
      act={act ?? ownAct}
      can={{
        // Only a window that drives discussions can pass the message on.
        jumpIn: !!host,
        build: !!host?.build,
        openChat: !!host?.show,
      }}
      onOpenFile={onOpenFile}
      seen={seen}
      onSeen={onSeen}
      controls={controls}
    />
  );
}

/**
 * The panel itself, from a discussion and its thread as built: the same
 * in the window that drives the discussion and in a window of its own,
 * where `act` sends each press back to that window.
 */
export function DiscussionThreadPanel({
  discussion,
  items,
  cwd,
  act,
  can,
  onOpenFile,
  seen,
  onSeen,
  controls,
}: {
  discussion: Discussion;
  items: readonly DiscussionThreadItem[];
  cwd: Record<DiscussionSide, string>;
  act: TeamWatchAct;
  can: { jumpIn: boolean; build: boolean; openChat: boolean };
  onOpenFile?: (path: string) => void;
  seen?: number;
  onSeen?: (id: string, count: number) => void;
  controls?: TeamPanelControls;
}) {
  const { a: partyA, b: partyB } = discussion;
  const voices = useMemo(
    () => discussionVoices({ a: partyA, b: partyB }),
    [partyA, partyB],
  );
  const typing = typingSide(discussion);
  const cheerId = useEndingCheer(discussion);
  const reactions = useArrivalReactions(items);
  const lastKeys = useMemo(() => lastReplyKeys(items), [items]);
  const total = replyCount(items);
  // Where "N new since you looked" goes: fixed when the panel opened.
  const [mark] = useState(() => {
    const first = firstNewReply(total, seen);
    return first === null ? null : { first, count: total - first };
  });
  useEffect(() => {
    onSeen?.(discussion.id, total);
  }, [discussion.id, onSeen, total]);

  const { head, rounds } = useMemo(() => threadRounds(items), [items]);
  const [showAll, setShowAll] = useState(false);
  const folded = showAll ? 0 : foldedRoundCount(rounds, mark?.first ?? null);
  const [jumpTo, setJumpTo] = useState<number | null>(null);

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
    if (!element) return;
    if (jumpTo !== null) {
      element
        .querySelector<HTMLElement>(`[data-discussion-round="${jumpTo}"]`)
        ?.scrollIntoView({ block: "start" });
      setJumpTo(null);
      stick.current = false;
      return;
    }
    if (stick.current) element.scrollTop = element.scrollHeight;
  }, [items, typing, paused, discussion.summary, jumpTo, folded]);
  const build = useMemo(
    () =>
      can.build
        ? (_id: string, side: DiscussionSide) => act({ kind: "build", side })
        : undefined,
    [act, can.build],
  );
  const show = (side: DiscussionSide) =>
    void act({ kind: "open-chat", sessionId: discussion[side].sessionId });

  let replyIndex = 0;
  const renderItem = (item: DiscussionThreadItem): ReactNode => {
    if (waitsForNextTurn(discussion, item)) return null;
    const reply = item.kind === "reply";
    const marked = reply && mark !== null && replyIndex === mark.first;
    if (reply) replyIndex += 1;
    const cheering = reply && cheerId !== null && lastKeys.has(item.key);
    const arrival = reply ? reactions.get(item.key) : undefined;
    const row = (
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
    return marked
      ? [
          <li key="new" className="discussion-new" data-discussion-new>
            {newSinceLabel(mark!.count)}
          </li>,
          row,
        ]
      : row;
  };
  // Folded rounds still count their replies, so the mark lands right.
  for (const round of rounds.slice(0, folded))
    replyIndex += round.items.filter((item) => item.kind === "reply").length;
  const waiting = items.filter((item) => waitsForNextTurn(discussion, item));

  const status = discussionStatus(discussion);
  const round = discussionRound(discussion);
  const done = ended ? completedRounds(discussion) : round - 1;
  const speaking = typing;
  const blocked = discussion.blockedBy
    ? discussion.a.sessionId === discussion.blockedBy
      ? "a"
      : discussion.b.sessionId === discussion.blockedBy
        ? "b"
        : null
    : null;

  return (
    <div
      className="discussion-view"
      data-discussion-view={discussion.id}
      data-status={discussion.status}
    >
      <div className="discussion-float-head">
        <TeamPanelBar
          title={`Discussion · “${topicLine(discussion.topic)}”`}
          fullTitle={discussion.topic}
          controls={controls}
          closeTitle="Close (the discussion goes on)"
        />
        <div className="discussion-faceoff" data-discussion-cast>
          <Side
            voice={voices.a}
            role={speaking === "a" ? "Replying…" : "Opened the topic"}
            speaking={speaking === "a"}
            onShow={can.openChat ? () => show("a") : undefined}
          />
          <div
            className="discussion-versus"
            data-state={status.state}
            role="status"
          >
            <span>
              {ended
                ? `${status.text} · ${plural(completedRounds(discussion), "round")}`
                : paused
                  ? `Round ${round} of ${discussion.rounds} · Needs you`
                  : `Round ${round} of ${discussion.rounds}`}
            </span>
            <span
              className="discussion-track"
              aria-hidden
              style={
                speaking
                  ? ({
                      "--discussion-voice": voices[speaking].color,
                    } as CSSProperties)
                  : undefined
              }
            >
              {Array.from({ length: discussion.rounds }, (_, index) => (
                <i
                  key={index}
                  data-state={
                    index < done
                      ? "done"
                      : index === done && !ended
                        ? "now"
                        : undefined
                  }
                />
              ))}
            </span>
          </div>
          <Side
            voice={voices.b}
            role={speaking === "b" ? "Replying…" : "Responding"}
            speaking={speaking === "b"}
            onShow={can.openChat ? () => show("b") : undefined}
          />
        </div>
        {!ended ? (
          <div className="discussion-float-actions">
            {paused && blocked && can.openChat ? (
              <button
                type="button"
                className="discussion-action"
                onClick={() => show(blocked)}
              >
                Go to {voices[blocked].name}
              </button>
            ) : null}
            {paused ? (
              <button
                type="button"
                className="discussion-action"
                onClick={() => void act({ kind: "resume" })}
              >
                <Play className="size-3" />
                Resume
              </button>
            ) : null}
            <button
              type="button"
              className="discussion-action"
              title="Stop discussion"
              aria-label="Stop discussion"
              onClick={() => void act({ kind: "stop" })}
            >
              <Square className="size-2.5" />
              Stop
            </button>
          </div>
        ) : null}
      </div>
      <div className="discussion-float-body">
        {rounds.length > 1 ? (
          <nav
            className="discussion-rail"
            aria-label="Rounds"
            data-discussion-rail
          >
            {rounds.map((entry, index) => (
              <button
                key={entry.round}
                type="button"
                data-discussion-rail-round={entry.round}
                title={`Round ${entry.round}`}
                onClick={() => {
                  if (index < folded) setShowAll(true);
                  setJumpTo(entry.round);
                }}
              >
                {entry.round}
                {entry.stance ? (
                  <span className="discussion-rail-mark">
                    <StanceMark stance={entry.stance} />
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        ) : null}
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
            {head.map(renderItem)}
            {folded > 0 ? (
              <li className="discussion-fold" data-discussion-fold={folded}>
                <button type="button" onClick={() => setShowAll(true)}>
                  {foldLabel(folded)}
                </button>
              </li>
            ) : null}
            {rounds
              .slice(folded)
              .flatMap((entry) => entry.items.map(renderItem))}
            {typing ? <DiscussionTyping voice={voices[typing]} /> : null}
            {waiting.map((item) => (
              <ThreadItem
                key={item.key}
                item={item}
                cwd={cwd.a}
                reaction={null}
                note={
                  item.kind === "user"
                    ? userNote(discussion, item.turn, item.state)
                    : undefined
                }
                onOpenFile={onOpenFile}
              />
            ))}
            {paused ? <PausedRow reason={discussion.reason} act={act} /> : null}
            {ended ? (
              <DiscussionWrapUpCard
                discussion={discussion}
                voices={voices}
                build={build}
              />
            ) : null}
          </ol>
        </div>
      </div>
      {discussion.preview || !can.jumpIn ? null : (
        <JumpInBox
          discussion={discussion}
          act={act}
          onSent={onSent}
          onEscape={onEscape}
        />
      )}
    </div>
  );
}

/** One side of the face-off: its mascot, large, its name and its part. */
function Side({
  voice,
  role,
  speaking,
  onShow,
}: {
  voice: DiscussionVoice;
  role: string;
  speaking: boolean;
  onShow?: () => void;
}) {
  const content = (
    <>
      <DiscussionAvatar voice={voice} size="large" typing={speaking} />
      <span className="discussion-side-name">{voice.name}</span>
      <span className="discussion-side-role">{role}</span>
    </>
  );
  const props = {
    className: "discussion-side",
    "data-side": voice.side,
    "data-speaking": speaking || undefined,
    style: { "--discussion-voice": voice.color } as CSSProperties,
  };
  return onShow ? (
    <button
      type="button"
      {...props}
      data-discussion-party={voice.side}
      title={`Open “${voice.title}”`}
      aria-label={`Open “${voice.title}”, ${voice.name}`}
      onClick={onShow}
    >
      {content}
    </button>
  ) : (
    <div {...props} title={`${voice.name} in “${voice.title}”`}>
      {content}
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
      return <DiscussionRound round={item.round} rounds={item.rounds} />;
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
        <DiscussionMessage
          voice={voice}
          turn={item.turn}
          text={item.text}
          stance={item.stance}
          reaction={reaction}
          reactionId={reactionId}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      ) : null;
  }
});

const PausedRow = memo(function PausedRow({
  reason,
  act,
}: {
  reason?: string;
  act: TeamWatchAct;
}) {
  return (
    <li className="discussion-paused" data-discussion-paused>
      <span className="min-w-0">Paused{reason ? ` · ${reason}` : ""}</span>
      <button
        type="button"
        className="discussion-action"
        onClick={() => void act({ kind: "resume" })}
      >
        <Play className="size-3" />
        Resume
      </button>
    </li>
  );
});

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
  act,
  onSent,
  onEscape,
}: {
  discussion: Discussion;
  act: TeamWatchAct;
  onSent: () => void;
  onEscape: () => void;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
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
  const settle = (refused: string | null) => {
    setProblem(refused);
    if (refused) return;
    setText("");
    onSent();
  };
  const send = () => {
    if (!text.trim() || blocked || sending) return;
    const result = act({ kind: "jump-in", text });
    if (!(result instanceof Promise)) return settle(result);
    // From a window of its own: wait for the window that drives it.
    setSending(true);
    void result.then((refused) => {
      setSending(false);
      settle(refused);
    });
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
          disabled={!text.trim() || !!blocked || sending}
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
