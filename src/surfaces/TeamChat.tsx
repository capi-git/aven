import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CrewCritter } from "../chrome/CrewCritter";
import { CornerDownRight, MoveUp, X } from "../chrome/icons";
import { useCrewLiveReply } from "../hooks/useCrewLiveReply";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { avosIntro, avosUnmet } from "../lib/avos";
import {
  questionToAnswer,
  waitingQuestions,
  type WaitingQuestion,
} from "../lib/avosAnswer";
import {
  TOO_LONG_FOR_EVERYONE,
  answerCrewCard,
  firstCardChatText,
  subscribeCrewTell,
  takeCrewTell,
  takeCrewTellTo,
  tellTeam,
  teammateChatReady,
  tellTeammate,
  useCrewWorkspace,
} from "../lib/crewActions";
import {
  CREW_MESSAGE_MAX,
  CREW_NOTE_MAX,
  CREW_ROLE_INFO,
  crewLead,
  crewMemberById,
  crewMemberName,
  getCrew,
  isTime,
  updateCrew,
  withoutNote,
  type Crew,
  type CrewMessageKind,
} from "../lib/crews";
import {
  crewMemberViews,
  titleBeside,
  type CrewMemberView,
} from "../lib/crewView";
import { isImeComposition } from "../lib/keyboard";
import {
  FEED_FOLLOW_START,
  feedGrew,
  feedScrolled,
  unseenLabel,
  type FeedFollow,
} from "../lib/feedFollow";
import type { BotStatus } from "../lib/projectBots";
import {
  listScheduledAgents,
  listScheduledRuns,
  openAutomation,
  subscribeScheduledAgents,
  subscribeScheduledRuns,
} from "../lib/scheduledAgents";
import { useTeamWorkspace } from "../lib/teamWorkspace";
import {
  postIsMember,
  teamPosts,
  teamThread,
  type TeamAuthor,
  type TeamPost,
} from "../lib/teamThread";
import { AutomationReviewCard } from "./AutomationReviewCard";
import "./TeamChat.css";

/**
 * Avos's chat: the thread (its helpers' handoffs and verdicts as short
 * posts, your messages among them, who's working now, and last Avos's
 * message on what needs you), and one box to write to Avos or @ a helper.
 * While a helper's question waits on you, the box answers it (see
 * `questionToAnswer` for which one, and when a message goes elsewhere).
 */

/** Posts the thread shows at first, and adds with each Show earlier. */
const SHOWN = 60;

function clock(at: number): string {
  if (!isTime(at)) return "";
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** A time for a <time> element; none for one a Date can't show. */
function isoTime(at: number): string | undefined {
  return isTime(at) ? new Date(at).toISOString() : undefined;
}

/** What a message to everyone became, in a few words. */
const BECAME: Readonly<Record<CrewMessageKind, string>> = {
  card: "a card",
  rule: "a rule for every card",
  goal: "the goal",
  lead: "a question for Avos",
};

/**
 * What the box does with a message: it goes to Avos, which works out what
 * it is (an answer, work to build, a rule, the goal, a job). A team from
 * before Avos, with no Lead, takes it as a card.
 */
type Mode = Extract<CrewMessageKind, "lead" | "card">;

/** The teammate the box writes to: its id, and its name when you picked it. */
type Addressee = { id: string; name: string };

export function TeamChat({
  project,
  crew,
  now,
  name,
  fixer,
  forYou,
  forYouKey = "",
  onSelected,
  control,
}: {
  project: string;
  crew: Crew;
  now: number;
  name: (who: string) => string;
  /** The Fixer (the project bot), while it is on. */
  fixer?: { status: BotStatus; sessionId?: string };
  /** What needs you, as Avos's message at the end of the thread. */
  forYou?: ReactNode;
  /** What that message holds, so a new ask comes into view. */
  forYouKey?: string;
  /** The teammate the thread shows, for the panel to mark. */
  onSelected: (id: string | null) => void;
  /**
   * A helper in Avos's profile filters the thread to it; Answer on a card
   * that waits on you writes the box's next message to it.
   */
  control: {
    current: {
      select: (id: string | null) => void;
      answer: (cardId: string) => void;
    } | null;
  };
}) {
  const members = useMemo(
    () =>
      crewMemberViews(crew, {
        name,
        ...(fixer
          ? {
              fixer: {
                status: fixer.status,
                ...(fixer.sessionId ? { sessionId: fixer.sessionId } : {}),
              },
            }
          : {}),
      }),
    [crew, name, fixer],
  );
  // The team's jobs and what their runs left for you, in the thread.
  const agents = useSyncExternalStore(
    subscribeScheduledAgents,
    listScheduledAgents,
  );
  const runs = useSyncExternalStore(subscribeScheduledRuns, listScheduledRuns);
  const posts = useMemo(
    () => teamPosts(crew, name, { agents, runs }),
    [crew, name, agents, runs],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const workspace = useCrewWorkspace();
  // Why a helper's own chat didn't open, under the Showing line.
  const [openProblem, setOpenProblem] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // Who the box writes to, as you picked them: kept even if they leave the
  // team, so a message for them never goes to everyone instead.
  const [to, setTo] = useState<Addressee | null>(null);
  const meeting = avosUnmet(crew);
  const mode: Mode = crewLead(crew) ? "lead" : "card";
  const input = useRef<HTMLTextAreaElement>(null);
  // The helpers' questions that wait on you: the box answers one of them.
  const waiting = useMemo(() => waitingQuestions(crew, name), [crew, name]);
  // The one you picked with Answer, and those you set aside from the box.
  const [picked, setPicked] = useState<string | null>(null);
  const [passed, setPassed] = useState<readonly string[]>([]);
  const answering = questionToAnswer(waiting, {
    to: to?.id ?? null,
    picked,
    passed,
  });
  const filter =
    selected && members.some((member) => member.id === selected)
      ? selected
      : null;
  const select = (id: string | null) => {
    setSelected(id);
    setTo(id ? { id, name: name(id) } : null);
  };
  useEffect(() => onSelected(filter), [filter, onSelected]);
  useEffect(() => {
    // Tell the team… from the sidebar: the cursor goes in the box. A
    // follow-up for the Researcher (from its Findings) writes to it.
    const take = () => {
      if (!takeCrewTell(project)) return;
      const toId = takeCrewTellTo();
      const known = getCrew(project);
      const member = toId && known ? crewMemberById(known, toId) : undefined;
      setSelected(null);
      setTo(
        member && known
          ? { id: member.id, name: crewMemberName(known, member.id) }
          : null,
      );
      requestAnimationFrame(() => input.current?.focus());
    };
    take();
    return subscribeCrewTell(take);
  }, [project]);
  const answer = (cardId: string) => {
    setSelected(null);
    setTo(null);
    setPicked(cardId);
    requestAnimationFrame(() => input.current?.focus());
  };
  useEffect(() => {
    control.current = { select, answer };
    return () => {
      control.current = null;
    };
  }, [control]);
  const working = members.filter(
    (member) =>
      member.status === "working" &&
      !!member.line &&
      (!filter || member.id === filter),
  );
  return (
    <div className="team-chat" data-team-chat={project}>
      <div className="team-thread">
        {filter ? (
          <div className="team-thread-showing" data-team-showing={filter}>
            <span>Showing {name(filter)}</span>
            <span className="team-thread-showing-tools">
              <button
                type="button"
                data-team-open-chat
                // Its chat starts with Avos's first card.
                disabled={!teammateChatReady(crew, filter)}
                title={
                  teammateChatReady(crew, filter)
                    ? undefined
                    : firstCardChatText(name(filter))
                }
                onClick={() => {
                  setOpenProblem(null);
                  void Promise.resolve(
                    workspace?.openChat(project, filter),
                  ).then((why) =>
                    setOpenProblem(why ? { id: filter, text: why } : null),
                  );
                }}
              >
                Open chat
              </button>
              <button
                type="button"
                onClick={() => workspace?.openSettings(project, filter)}
              >
                Settings
              </button>
              <button type="button" onClick={() => select(null)}>
                Show all
              </button>
            </span>
          </div>
        ) : null}
        {filter &&
        (openProblem?.id === filter || !teammateChatReady(crew, filter)) ? (
          <p
            className="team-thread-showing-note"
            role="status"
            data-team-open-note
          >
            {openProblem?.id === filter
              ? openProblem.text
              : firstCardChatText(name(filter))}
          </p>
        ) : null}
        <Thread
          key={filter ?? "everyone"}
          project={project}
          meeting={meeting}
          posts={posts}
          filter={filter}
          filterName={filter ? name(filter) : undefined}
          working={working}
          now={now}
          onAnswer={answer}
          forYou={filter ? null : forYou}
          forYouKey={filter ? "" : forYouKey}
        />
        <Composer
          project={project}
          meeting={meeting}
          members={members}
          to={to}
          mode={mode}
          answering={answering}
          input={input}
          onTo={setTo}
          onPass={(key) => {
            setPassed((keys) => [...keys, key]);
            setPicked(null);
          }}
        />
      </div>
    </div>
  );
}

// The thread

function Thread({
  project,
  posts,
  filter,
  filterName,
  working,
  now,
  meeting,
  onAnswer,
  forYou,
  forYouKey,
}: {
  project: string;
  posts: readonly TeamPost[];
  filter: string | null;
  filterName?: string;
  working: readonly CrewMemberView[];
  now: number;
  /** Meeting Avos: its chat opens on its introduction. */
  meeting?: boolean;
  /** Answer a card's question: the box writes to it. */
  onAnswer: (cardId: string) => void;
  /** Avos's message on what needs you, after everything else. */
  forYou: ReactNode;
  forYouKey: string;
}) {
  const [shown, setShown] = useState(SHOWN);
  const [follow, setFollow] = useState<FeedFollow>(FEED_FOLLOW_START);
  const scroller = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const keepFromBottom = useRef<number | null>(null);
  // Only what this view shows counts as new: one teammate's posts, or all.
  const kept = useMemo(
    () => (filter ? posts.filter((post) => postIsMember(post, filter)) : posts),
    [posts, filter],
  );
  const thread = useMemo(
    () => teamThread(kept, { now, shown }),
    [kept, now, shown],
  );
  const newest = kept.at(-1)?.id;
  // Your newest message: it can land before lines it led to ("You resumed
  // the team" shares its moment), so it is watched apart from the newest.
  const newestYou = kept.findLast((post) => post.kind === "you")?.id;
  const seen = useRef({ newest, newestYou });
  const liveKey = working.map((member) => member.id).join(",");
  const toBottom = () => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  // It opens at the newest post.
  useLayoutEffect(() => {
    toBottom();
  }, []);
  // New posts: followed at the bottom, counted while you read further up.
  useLayoutEffect(() => {
    const before = seen.current;
    if (before.newest === newest && before.newestYou === newestYou) return;
    seen.current = { newest, newestYou };
    // What you just wrote is always shown, wherever you were reading. The
    // window slides to it (no older post is added above, which would push
    // the bottom out of view), and nothing counts as unseen.
    if (newestYou && newestYou !== before.newestYou) {
      setFollow(FEED_FOLLOW_START);
      toBottom();
      return;
    }
    if (newest === before.newest) return;
    const at = before.newest
      ? kept.findIndex((post) => post.id === before.newest)
      : -1;
    const added = at >= 0 ? kept.length - 1 - at : 1;
    const step = feedGrew(followRef.current, added);
    if (step.scrollToBottom) toBottom();
    else {
      setFollow(step.state);
      // Nothing above what you're reading drops off while you read.
      setShown((count) => count + added);
    }
  }, [newest, newestYou, kept]);
  // Someone starts or stops working, or something new waits for you: the
  // end of the thread stays in view.
  useLayoutEffect(() => {
    if (followRef.current.following) toBottom();
  }, [liveKey, forYouKey]);
  // Show earlier keeps what you were reading where it was.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || keepFromBottom.current === null) return;
    element.scrollTop = element.scrollHeight - keepFromBottom.current;
    keepFromBottom.current = null;
  }, [shown]);
  const empty = !thread.total && !working.length;
  return (
    <div className="team-thread-wrap">
      <div
        ref={scroller}
        className="team-thread-scroll"
        role="log"
        aria-label={filterName ? `${filterName}'s posts` : "Avos thread"}
        data-team-thread
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollow((current) =>
            feedScrolled(current, {
              scrollTop: element.scrollTop,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
            }),
          );
        }}
      >
        {thread.earlier > 0 ? (
          <button
            type="button"
            className="team-thread-earlier"
            onClick={() => {
              const element = scroller.current;
              if (element)
                keepFromBottom.current =
                  element.scrollHeight - element.scrollTop;
              setShown((count) => count + SHOWN);
            }}
          >
            Show earlier
          </button>
        ) : null}
        {empty && meeting ? (
          <AvosMeet project={project} />
        ) : empty ? (
          <p className="team-thread-empty">
            {filterName
              ? `Nothing from ${filterName} yet. Write to it below; its handoffs show here.`
              : "Nothing here yet. Write to Avos below."}
          </p>
        ) : null}
        {thread.days.map((day) => (
          <section key={day.key} className="team-day" aria-label={day.label}>
            <h3 className="team-day-label">{day.label}</h3>
            <ol className="team-posts">
              {day.posts.map((post) => (
                <PostView
                  key={post.id}
                  project={project}
                  post={post}
                  onAnswer={onAnswer}
                />
              ))}
            </ol>
          </section>
        ))}
        {working.length ? (
          <ol className="team-posts" aria-label="Working now">
            {working.map((member) =>
              member.role === "lead" ? (
                // Avos writing: its words as they come, then its dots.
                <li
                  key={`live:${member.id}`}
                  className="team-reply"
                  data-live
                  data-team-live={member.id}
                >
                  <LiveText
                    project={project}
                    memberId={member.id}
                    line={member.line ?? ""}
                    dots="think"
                  />
                </li>
              ) : (
                <li
                  key={`live:${member.id}`}
                  className="team-work"
                  data-live
                  data-team-live={member.id}
                >
                  <CrewCritter
                    path={project}
                    role={member.role}
                    {...(member.critter ? { critter: member.critter } : {})}
                    state="working"
                    className="team-work-mark"
                  />
                  <b className="team-work-name">{member.name}</b>
                  <LiveText
                    project={project}
                    memberId={member.id}
                    line={member.line ?? ""}
                    dots="tool"
                  />
                </li>
              ),
            )}
          </ol>
        ) : null}
        {forYou}
      </div>
      {follow.unseen > 0 ? (
        <button
          type="button"
          className="team-thread-new"
          onClick={() => {
            toBottom();
            setFollow(FEED_FOLLOW_START);
          }}
        >
          {unseenLabel(follow.unseen)}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A working teammate's line: what it's writing to you, as it's written,
 * or what it's doing until its first words come.
 */
function LiveText({
  project,
  memberId,
  line,
  dots,
}: {
  project: string;
  memberId: string;
  line: string;
  /** The work dots after it, as the message box draws them. */
  dots: "think" | "tool";
}) {
  const writing = useCrewLiveReply(project, memberId);
  // Avos's own line wears its little working screen (its reply has no
  // mark); a helper's row has its mark already.
  const status = (
    <span className="team-live-status">
      {dots === "think" ? (
        <CrewCritter
          path={project}
          role="lead"
          state="working"
          className="team-live-mark"
        />
      ) : null}
      {writing ? null : <span>{line || "Thinking"}</span>}
    </span>
  );
  return writing ? (
    <>
      <p className="team-post-text" data-team-live-reply>
        {writing}
      </p>
      {status}
    </>
  ) : (
    <span className="team-post-text team-work-text">{status}</span>
  );
}

function AuthorMark({
  project,
  author,
  className,
}: {
  project: string;
  author: TeamAuthor;
  className: string;
}) {
  return (
    <CrewCritter
      path={project}
      role={author.role}
      {...(author.critter ? { critter: author.critter } : {})}
      className={className}
    />
  );
}

/**
 * Meeting Avos: its Bot, who it is, and its question, centred where the
 * chat will start. Your answer wakes it, and these lines stay as its first.
 */
function AvosMeet({ project }: { project: string }) {
  const labels = useProjectLabels();
  const intro = avosIntro(projectDisplayName(project, labels));
  return (
    <div className="avos-meet" data-avos-meet>
      <CrewCritter
        path={project}
        role="lead"
        state="watching"
        className="avos-meet-mark"
      />
      <h2 className="avos-meet-hello">{intro.hello}</h2>
      <p className="avos-meet-ask">{intro.ask}</p>
    </div>
  );
}

function PostView({
  project,
  post,
  onAnswer,
}: {
  project: string;
  post: TeamPost;
  onAnswer: (cardId: string) => void;
}) {
  const workspace = useCrewWorkspace();
  if (post.kind === "you")
    return (
      <li className="team-you" data-team-post="you">
        <p className="team-you-bubble">{post.text}</p>
        <p className="team-you-meta">
          <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
          {post.to
            ? ` · to ${post.to.name}`
            : post.answers
              ? ` · answers “${post.answers}”`
              : // Written to Avos, it needs no word; what else it became does.
                post.as && post.as !== "lead"
                ? ` · ${BECAME[post.as]}`
                : ""}
          {post.from ? (
            <>
              {" · "}
              <button
                type="button"
                className="team-post-link"
                data-team-from={post.from.sessionId}
                title="Open that chat"
                disabled={!workspace?.openSession}
                onClick={() => workspace?.openSession?.(post.from!.sessionId)}
              >
                from “{post.from.title || "Untitled"}”
              </button>
            </>
          ) : null}
        </p>
      </li>
    );
  if (post.kind === "job")
    return (
      <li className="team-job" data-team-post="job" data-team-job={post.jobId}>
        <p className="team-job-line" title={post.name}>
          Keeping an eye on <b>{post.name}</b>
        </p>
        <span className="team-job-when">{post.schedule}</span>
        <button
          type="button"
          className="team-job-change"
          onClick={() => openAutomation(post.jobId)}
        >
          Change
        </button>
      </li>
    );
  if (post.kind === "run") return <RunPost post={post} />;
  if (post.kind === "event")
    return (
      <li
        className="team-event"
        data-team-post="event"
        data-needs-you={post.needsYou || undefined}
      >
        {post.needsYou ? <i className="team-event-dot" aria-hidden /> : null}
        {post.text} <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
        {post.forget ? (
          <>
            {" · "}
            <button
              type="button"
              className="team-post-link"
              data-avos-undo-rule
              onClick={() =>
                updateCrew(project, (crew) => withoutNote(crew, post.forget!))
              }
            >
              Undo
            </button>
          </>
        ) : null}
        {post.asks ? (
          <>
            {" "}
            <AnswerLink cardId={post.asks} onAnswer={onAnswer} />
          </>
        ) : null}
      </li>
    );
  const links = (
    <>
      {post.asks ? <AnswerLink cardId={post.asks} onAnswer={onAnswer} /> : null}
      {post.action === "set-up-git" && workspace?.setUpGit ? (
        <button
          type="button"
          className="team-post-link"
          data-avos-set-up-git
          onClick={() => workspace.setUpGit?.(project)}
        >
          Set up Git
        </button>
      ) : null}
    </>
  );
  // Avos answers as any chat's agent does: its words, no mark or name.
  if (post.author.role === "lead" && !post.work && !post.handoff)
    return (
      <li
        className="team-reply"
        data-team-post={post.author.id}
        data-needs-you={post.needsYou || undefined}
        title={clock(post.at)}
      >
        <p className="team-post-text">{post.text}</p>
        {links}
      </li>
    );
  // The work behind its answers: a helper started or done, a teammate
  // passing work on. One line each, under its name; the whole of it on hover.
  const label = post.handoff ? post.handoff.label : undefined;
  return (
    <li
      className="team-work"
      data-team-post={post.author.id}
      data-needs-you={post.needsYou || undefined}
      title={[post.card, post.text].filter(Boolean).join(": ")}
    >
      <AuthorMark
        project={project}
        author={post.author}
        className="team-work-mark"
      />
      <b className="team-work-name">{post.author.name}</b>
      <span className="team-post-text team-work-text">{post.text}</span>
      {label ? (
        <span className="team-work-label" data-team-handoff>
          {label}
        </span>
      ) : null}
      {links}
    </li>
  );
}

/** Answer a question in the thread: the box below writes to its card. */
function AnswerLink({
  cardId,
  onAnswer,
}: {
  cardId: string;
  onAnswer: (cardId: string) => void;
}) {
  return (
    <button
      type="button"
      className="team-post-link"
      data-team-answer={cardId}
      onClick={() => onAnswer(cardId)}
    >
      Answer
    </button>
  );
}

/**
 * What a job's run left for you: its card (a draft to publish, a page to
 * look at), answered here as from the Inbox, or a line when it failed.
 */
function RunPost({ post }: { post: Extract<TeamPost, { kind: "run" }> }) {
  const workspace = useTeamWorkspace();
  const openRun = workspace?.openRun;
  if (post.failed)
    return (
      <li
        className="team-event"
        data-team-post="run"
        data-team-run={post.run.id}
        data-needs-you
      >
        <i className="team-event-dot" aria-hidden />
        {post.text} <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
        {openRun ? (
          <>
            {" "}
            <button
              type="button"
              className="team-post-link"
              onClick={() => openRun(post.run.id)}
            >
              Open run
            </button>
          </>
        ) : null}
      </li>
    );
  return (
    <li className="team-run" data-team-post="run" data-team-run={post.run.id}>
      <AutomationReviewCard
        run={post.run}
        showProject={false}
        {...(workspace?.answerRunCard
          ? { onAction: workspace.answerRunCard }
          : {})}
        {...(openRun ? { onOpenRun: (run) => openRun(run.id) } : {})}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// The box

/** The "@word" being typed just before the cursor, if any. */
/**
 * The "@word" the caret is in, if any: where its @ is, and the whole word
 * after it (also the part after the caret, when the caret is mid-word).
 */
export function mentionAt(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const match = /(^|\s)@([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const rest = /^[\p{L}\p{N}_-]*/u.exec(text.slice(caret))?.[0] ?? "";
  return {
    start: caret - match[2]!.length - 1,
    query: `${match[2]!}${rest}`,
  };
}

function Composer({
  project,
  meeting = false,
  members,
  to,
  mode,
  answering,
  input,
  onTo,
  onPass,
}: {
  project: string;
  /** Meeting Avos: the box asks what to keep an eye on, and has the cursor. */
  meeting?: boolean;
  members: readonly CrewMemberView[];
  /** The teammate it writes to, as you picked them; none for everyone. */
  to: Addressee | null;
  mode: Mode;
  /** The question a plain message answers now; none for Avos. */
  answering: WaitingQuestion | null;
  input: RefObject<HTMLTextAreaElement | null>;
  onTo: (to: Addressee | null) => void;
  /** Set a question aside (its key): the box writes to Avos instead. */
  onPass: (key: string) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  // What the box holds now, for a send that ends after you typed more.
  const typed = useRef(text);
  typed.current = text;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The @ list: the word typed after @ (start -1 when opened from @). */
  const [picker, setPicker] = useState<{
    start: number;
    query: string;
    active: number;
  } | null>(null);
  // Its name as the team has it now, or as you picked it if it has left.
  const toName = to
    ? (members.find((member) => member.id === to.id)?.name ?? to.name)
    : null;
  const toGone = !!to && !members.some((member) => member.id === to.id);
  const options = picker
    ? [
        // Avos itself, then its helpers: writing to Avos is the default.
        { id: null as string | null, name: "Avos", role: undefined },
        ...members
          .filter((member) => member.role !== "lead")
          .map((member) => ({
            id: member.id as string | null,
            name: member.name,
            role: member,
          })),
      ].filter((option) =>
        option.name.toLowerCase().startsWith(picker.query.toLowerCase()),
      )
    : [];
  const active = picker
    ? Math.min(picker.active, Math.max(0, options.length - 1))
    : 0;
  useLayoutEffect(() => {
    // The box grows with what you write, up to a few lines.
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [text, input]);
  // Meeting Avos: its question waits for your answer, so the box has the
  // cursor.
  useEffect(() => {
    if (meeting) input.current?.focus();
  }, [meeting, input]);
  /** The typed "@word" the list is for, if the caret is still in it. */
  const mentionStill = (value: string, caret: number) => {
    if (!picker || picker.start < 0) return null;
    const found = mentionAt(value, caret);
    return found?.start === picker.start ? found : null;
  };
  /** The caret moved: the list follows the "@word" it's in, or closes. */
  const follow = (element: HTMLTextAreaElement) => {
    const value = element.value;
    const caret = element.selectionStart ?? 0;
    setPicker((current) => {
      if (!current || current.start < 0) return current;
      const found = mentionAt(value, caret);
      if (found?.start !== current.start) return null;
      return found.query === current.query
        ? current
        : { ...current, query: found.query, active: 0 };
    });
  };
  const pick = (option: { id: string | null; name: string }) => {
    const element = input.current;
    if (picker && picker.start >= 0) {
      // Exactly the "@word": from its @ to the end of the word, wherever
      // the caret is in it.
      const end = picker.start + 1 + picker.query.length;
      const next = `${text.slice(0, picker.start)}${text.slice(end)}`
        .replace(/ {2,}/g, " ")
        .replace(/^ /, "");
      setText(next);
    }
    setPicker(null);
    // @Avos while a question waits: this message goes to Avos instead.
    if (!option.id && answering) onPass(answering.key);
    onTo(option.id ? { id: option.id, name: option.name } : null);
    requestAnimationFrame(() => element?.focus());
  };
  // How long it may be: a chat message, or a card's words (an answer too).
  const limit =
    !answering && (to || mode === "lead") ? CREW_MESSAGE_MAX : CREW_NOTE_MAX;
  const send = async () => {
    const words = text.trim();
    if (!words || sending) return;
    // Never to everyone instead: a teammate who left is said, and you
    // choose again.
    if (to && toGone) {
      setProblem(
        `${toName} isn't helping Avos any more. Pick someone else or write to Avos.`,
      );
      return;
    }
    if (!to && !answering && words.length > limit) {
      setProblem(TOO_LONG_FOR_EVERYONE);
      return;
    }
    // Who it went to, so a message that fails comes back to them.
    const sentTo = to;
    setSending(true);
    setProblem(null);
    // The box is free at once: what you start typing now stays.
    setText("");
    // An answer goes to the card it answers. Otherwise Avos works out what
    // it is: work, a rule, the goal, a job, or a question or mock-up for
    // its Researcher or Designer.
    const why = sentTo
      ? await tellTeammate(project, sentTo.id, words)
      : answering
        ? answerCrewCard(project, answering.cardId, words)
        : await tellTeam(project, words, mode);
    setSending(false);
    if (why) {
      setProblem(why);
      // Back in the box with whoever it was for, unless you've started
      // something else.
      if (!typed.current) {
        setText(words);
        onTo(sentTo);
      }
      return;
    }
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    // A caret that left the "@word" (arrow keys, a click) ends the list.
    const element = event.currentTarget;
    const stale =
      !!picker &&
      picker.start >= 0 &&
      !mentionStill(element.value, element.selectionStart ?? 0);
    if (stale) setPicker(null);
    if (picker && !stale && options.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const by = event.key === "ArrowDown" ? 1 : -1;
        setPicker({
          ...picker,
          active: (active + by + options.length) % options.length,
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[active]!);
        return;
      }
    }
    if (picker && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setPicker(null);
      return;
    }
    if (
      event.key === "Backspace" &&
      (to || answering) &&
      !sending &&
      !text &&
      event.currentTarget.selectionStart === 0
    ) {
      event.preventDefault();
      if (to) onTo(null);
      else if (answering) onPass(answering.key);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const placeholder = toName
    ? `Write to ${toName}…`
    : answering
      ? `Your answer to ${answering.who}…`
      : meeting
        ? "Something to keep an eye on, or what's coming up…"
        : mode === "lead"
          ? "Ask Avos anything, or @ a helper…"
          : "Write to Avos, or @ a helper…";
  return (
    <div className="team-compose-wrap">
      {picker && options.length ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Write to"
          className="team-mention"
          data-team-mention
        >
          {options.map((option, index) => (
            <li
              key={option.id ?? "everyone"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="team-mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setPicker({ ...picker, active: index })}
              onClick={() => pick(option)}
            >
              {option.role ? (
                <CrewCritter
                  path={project}
                  role={option.role.role}
                  {...(option.role.critter
                    ? { critter: option.role.critter }
                    : {})}
                  className="team-mention-mark"
                />
              ) : (
                <CrewCritter
                  path={project}
                  role="lead"
                  state="watching"
                  className="team-mention-mark"
                />
              )}
              <span className="team-mention-name">{option.name}</span>
              <span className="team-mention-role">
                {option.role
                  ? titleBeside(
                      option.name,
                      CREW_ROLE_INFO[option.role.role].label,
                    )
                  : "Looks after this project"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="team-compose"
        data-team-compose
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {toName ? (
          <button
            type="button"
            className="team-compose-to"
            // Kept while a message is on its way to them.
            disabled={sending}
            aria-label={`Writing to ${toName}. Write to everyone instead`}
            title="Write to everyone instead"
            onClick={() => {
              onTo(null);
              input.current?.focus();
            }}
          >
            @{toName}
            <X className="size-3" aria-hidden />
          </button>
        ) : answering ? (
          <button
            type="button"
            className="team-compose-to team-compose-answer"
            data-team-answering={answering.cardId}
            disabled={sending}
            aria-label={`Answering “${answering.title}”. Write to Avos instead`}
            title={`Answering “${answering.title}”. Write to Avos instead`}
            onClick={() => {
              onPass(answering.key);
              input.current?.focus();
            }}
          >
            <CornerDownRight className="size-3 flex-none" aria-hidden />
            <span className="team-compose-answer-title">{answering.title}</span>
            <X className="size-3 flex-none" aria-hidden />
          </button>
        ) : null}
        <textarea
          ref={input}
          className="team-compose-input"
          rows={1}
          role="combobox"
          aria-label={
            toName
              ? `Write to ${toName}`
              : answering
                ? `Answer ${answering.who}`
                : "Write to Avos"
          }
          aria-autocomplete="list"
          aria-expanded={!!picker && options.length > 0}
          aria-controls={picker ? listId : undefined}
          aria-activedescendant={
            picker && options.length ? `${listId}-${active}` : undefined
          }
          placeholder={placeholder}
          value={text}
          maxLength={limit}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setProblem(null);
            const found = mentionAt(
              value,
              event.target.selectionStart ?? value.length,
            );
            setPicker(found ? { ...found, active: 0 } : null);
          }}
          onBlur={() => setPicker(null)}
          onSelect={(event) => follow(event.currentTarget)}
          onClick={(event) => follow(event.currentTarget)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="team-compose-at"
          aria-label="Write to one helper"
          title="Write to one helper"
          aria-expanded={!!picker && picker.start < 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setPicker(picker ? null : { start: -1, query: "", active: 0 });
            input.current?.focus();
          }}
        >
          @
        </button>
        <button
          type="submit"
          className="team-compose-send"
          aria-label={
            toName
              ? `Send to ${toName}`
              : answering
                ? "Send answer"
                : "Send to Avos"
          }
          disabled={!text.trim() || sending}
        >
          <MoveUp className="size-3.5" />
        </button>
      </form>
      {problem ? (
        <p className="team-compose-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
