import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { CrewCritter, crewMarkState } from "../chrome/CrewCritter";
import { DotMark } from "../chrome/DotMark";
import { ExplorerMenu } from "../chrome/ExplorerMenu";
import { ArrowRight, ChevronDown, MoveUp, X } from "../chrome/icons";
import { ProjectMark } from "../chrome/ProjectMark";
import { TeamCardButton } from "../chrome/TeamCard";
import type { BatchRange } from "../hooks/useTeamPipeline";
import {
  TOO_LONG_FOR_A_GOAL,
  TOO_LONG_FOR_EVERYONE,
  firstCardChatText,
  subscribeCrewTell,
  takeCrewTell,
  takeCrewTellTo,
  tellTeam,
  teammateChatReady,
  tellTeammate,
  useCrewWorkspace,
} from "../lib/crewActions";
import type { Pipeline, PipelineRow } from "../lib/crewPipeline";
import {
  CREW_GOAL_MAX,
  CREW_MESSAGE_MAX,
  CREW_NOTE_MAX,
  CREW_ROLE_INFO,
  crewMemberById,
  crewMemberName,
  getCrew,
  isTime,
  memberCritter,
  stackedCards,
  type Crew,
  type CrewMessageKind,
} from "../lib/crews";
import {
  crewMemberViews,
  titleBeside,
  type CrewBoardActionId,
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
  latestPosts,
  postIsMember,
  teamPosts,
  teamThread,
  type TeamAuthor,
  type TeamPost,
} from "../lib/teamThread";
import type { BoardCard } from "../lib/workBoard";
import { plural } from "../lib/words";
import { BatchButtons } from "./TeamBatch";
import "./TeamChat.css";

/**
 * The team as a chat: a roster you read like a messenger (Everyone, then
 * each teammate with what it's doing), the team thread (its handoffs and
 * verdicts as short posts, your messages among them) with Ready for you
 * pinned on top, and one box to write to everyone or @ one teammate.
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

/** A roster time: "now" while it works, its last post's time today, else its day. */
function rosterWhen(at: number | undefined, now: number): string {
  if (!at || !isTime(at)) return "";
  const date = new Date(at);
  if (date.toDateString() === new Date(now).toDateString())
    return clock(at).replace(/\s?[AP]\.?M\.?$/i, "");
  try {
    return date.toLocaleDateString(undefined, { weekday: "short" });
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
};

type Mode = CrewMessageKind;

/** The teammate the box writes to: its id, and its name when you picked it. */
type Addressee = { id: string; name: string };

const MODES: readonly { id: Mode; label: string; word: string }[] = [
  { id: "card", label: "Build it", word: "Card" },
  { id: "rule", label: "Remember for every card", word: "Rule" },
  { id: "goal", label: "Make it a goal", word: "Goal" },
];

const EMPTY_MARK = { key: "empty", label: "", rows: [] } as const;

export function TeamChat({
  project,
  crew,
  view,
  range,
  now,
  name,
  fixer,
  cards,
  problems,
  onCrewAction,
  onReview,
  onCards,
  control,
}: {
  project: string;
  crew: Crew;
  view: Pipeline;
  range: BatchRange | null;
  now: number;
  name: (who: string) => string;
  /** The Fixer (the project bot), while it is on. */
  fixer?: { status: BotStatus; sessionId?: string };
  /** The Board's cards, for an older Ready card's own buttons. */
  cards: readonly BoardCard[];
  problems: Readonly<Record<string, string>>;
  onCrewAction: (card: BoardCard, id: CrewBoardActionId) => void;
  onReview: () => void;
  /** Show the Cards (a card that waits on you is answered there). */
  onCards: () => void;
  /** ⋯ → Set a goal…: the box turns to the goal. */
  control: { current: { goal: () => void } | null };
}) {
  const workspace = useCrewWorkspace();
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
  const posts = useMemo(() => teamPosts(crew, name), [crew, name]);
  const latest = useMemo(() => latestPosts(posts), [posts]);
  const [selected, setSelected] = useState<string | null>(null);
  // Who the box writes to, as you picked them: kept even if they leave the
  // team, so a message for them never goes to everyone instead.
  const [to, setTo] = useState<Addressee | null>(null);
  const [mode, setMode] = useState<Mode>("card");
  // Why a teammate's chat didn't open, under its name.
  const [openProblem, setOpenProblem] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const filter =
    selected && members.some((member) => member.id === selected)
      ? selected
      : null;
  const select = (id: string | null) => {
    setSelected(id);
    setTo(id ? { id, name: name(id) } : null);
  };
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
  useEffect(() => {
    control.current = {
      goal: () => {
        setSelected(null);
        setTo(null);
        setMode("goal");
        requestAnimationFrame(() => input.current?.focus());
      },
    };
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
  const ready = view.ready.filter((row) => !row.boardActions);
  return (
    <div className="team-chat" data-team-chat={project}>
      <Roster
        project={project}
        crew={crew}
        members={members}
        latest={latest}
        now={now}
        selected={filter}
        onSelect={select}
        openProblem={openProblem}
        onOpenChat={(id) => {
          setOpenProblem(null);
          void Promise.resolve(workspace?.openChat(project, id)).then((why) =>
            setOpenProblem(why ? { id, text: why } : null),
          );
        }}
        onSettings={(id) => workspace?.openSettings(project, id)}
        onAdd={() => workspace?.openSettings(project, "add")}
      />
      <div className="team-thread">
        {view.batch || ready.length ? (
          <div className="team-ready-list">
            {view.batch ? (
              <ReadyBatch
                project={project}
                crew={crew}
                view={view}
                range={range}
                name={name}
                onReview={onReview}
              />
            ) : null}
            {ready.map((row) => (
              <ReadyCard
                key={row.id}
                project={project}
                crew={crew}
                row={row}
                problem={problems[row.id]}
                onAction={(id) => {
                  const card = cards.find((item) => item.id === row.id);
                  if (card) onCrewAction(card, id);
                }}
              />
            ))}
          </div>
        ) : null}
        <Thread
          key={filter ?? "everyone"}
          project={project}
          posts={posts}
          filter={filter}
          filterName={filter ? name(filter) : undefined}
          working={working}
          now={now}
          onCards={onCards}
        />
        <Composer
          project={project}
          members={members}
          to={to}
          mode={mode}
          input={input}
          onTo={setTo}
          onMode={setMode}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The roster

function Roster({
  project,
  crew,
  members,
  latest,
  now,
  selected,
  onSelect,
  openProblem,
  onOpenChat,
  onSettings,
  onAdd,
}: {
  project: string;
  crew: Crew;
  members: readonly CrewMemberView[];
  latest: ReadonlyMap<string, number>;
  now: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  openProblem: { id: string; text: string } | null;
  onOpenChat: (id: string) => void;
  onSettings: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="team-roster" aria-label="Teammates">
      <ul role="list">
        <li className="team-roster-item" data-selected={!selected || undefined}>
          <button
            type="button"
            className="team-roster-row"
            aria-pressed={!selected}
            onClick={() => onSelect(null)}
          >
            <ProjectMark path={project} className="team-roster-mark" />
            <span className="team-roster-text">
              <span className="team-roster-name">Everyone</span>
              <span className="team-roster-line">Team thread</span>
            </span>
          </button>
        </li>
        {members.map((member) => {
          const paused = !!crewMemberById(crew, member.id)?.paused;
          const needs = member.status === "needs-you";
          const line =
            member.line ??
            (needs
              ? "Needs you"
              : member.status === "paused" || paused
                ? "Off"
                : member.status === "working"
                  ? "Working"
                  : "Free");
          // Its line, said once: "Needs you · Settings page".
          const said = needs && member.line ? `Needs you · ${line}` : line;
          const when =
            member.status === "working"
              ? "now"
              : rosterWhen(latest.get(member.id), now);
          const isSelected = selected === member.id;
          return (
            <li
              key={member.id}
              className="team-roster-item"
              data-selected={isSelected || undefined}
              data-team-member={member.id}
            >
              <button
                type="button"
                className="team-roster-row"
                aria-pressed={isSelected}
                aria-label={`${member.name}: ${said}`}
                onClick={() => onSelect(isSelected ? null : member.id)}
              >
                <CrewCritter
                  path={project}
                  role={member.role}
                  {...(member.critter ? { critter: member.critter } : {})}
                  state={crewMarkState(
                    member.status,
                    member.active,
                    paused ? "idle" : "still",
                  )}
                  className="team-roster-mark"
                />
                <span className="team-roster-text">
                  <span className="team-roster-name">{member.name}</span>
                  <span
                    className="team-roster-line"
                    data-live={
                      member.status === "working" || needs || undefined
                    }
                    title={said}
                  >
                    {said}
                  </span>
                </span>
                {when ? (
                  <span className="team-roster-when" aria-hidden="true">
                    {when}
                  </span>
                ) : null}
              </button>
              {isSelected ? (
                <span className="team-roster-tools">
                  <button
                    type="button"
                    className="team-roster-tool"
                    data-team-open-chat
                    // Its chat starts with the team's first card.
                    disabled={!teammateChatReady(crew, member.id)}
                    title={
                      teammateChatReady(crew, member.id)
                        ? undefined
                        : firstCardChatText(member.name)
                    }
                    onClick={() => onOpenChat(member.id)}
                  >
                    Open chat
                  </button>
                  <button
                    type="button"
                    className="team-roster-tool"
                    onClick={() => onSettings(member.id)}
                  >
                    Settings
                  </button>
                </span>
              ) : null}
              {isSelected &&
              (openProblem?.id === member.id ||
                !teammateChatReady(crew, member.id)) ? (
                <p
                  className="team-roster-note"
                  role="status"
                  data-team-open-note
                >
                  {openProblem?.id === member.id
                    ? openProblem.text
                    : firstCardChatText(member.name)}
                </p>
              ) : null}
            </li>
          );
        })}
        <li className="team-roster-item" data-add>
          <button
            type="button"
            className="team-roster-row"
            data-team-add
            onClick={onAdd}
          >
            <DotMark sigil={EMPTY_MARK} className="team-roster-mark" />
            <span className="team-roster-text">
              <span className="team-roster-name">Add teammate</span>
            </span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Ready for you, pinned on top

function ReadyBatch({
  project,
  crew,
  view,
  range,
  name,
  onReview,
}: {
  project: string;
  crew: Crew;
  view: Pipeline;
  range: BatchRange | null;
  name: (who: string) => string;
  onReview: () => void;
}) {
  const batch = view.batch!;
  const last = stackedCards(crew).at(-1);
  const builder = crewMemberById(crew, last?.builderId);
  const single = batch.cards.length === 1 ? batch.cards[0]! : undefined;
  const title = single ? single.title : plural(batch.cards.length, "card");
  const status = single
    ? [
        builder ? name(builder.id) : "",
        batch.status.startsWith(`${single.title} · `)
          ? batch.status.slice(single.title.length + 3)
          : batch.status,
      ]
        .filter(Boolean)
        .join(" · ")
    : batch.status;
  return (
    <section
      className="team-ready"
      aria-label="Ready for you"
      data-team-ready="batch"
    >
      <CrewCritter
        path={project}
        role={builder?.role ?? "builder"}
        {...(builder?.critter ? { critter: memberCritter(builder) } : {})}
        className="team-ready-mark"
      />
      <span className="team-ready-text">
        <span className="team-ready-tag">
          <i aria-hidden="true" />
          Ready for you
        </span>
        <span className="team-ready-line">
          <b>{title}</b>
          <span title={status}>{status}</span>
        </span>
      </span>
      <BatchButtons
        crew={crew}
        batch={batch}
        range={range}
        onReview={onReview}
        className="team-ready-actions"
        problemClass="team-ready-problem"
      />
    </section>
  );
}

/** An older Ready card that isn't on the branch: its own Review and Apply. */
function ReadyCard({
  project,
  crew,
  row,
  problem,
  onAction,
}: {
  project: string;
  crew: Crew;
  row: PipelineRow;
  problem?: string;
  onAction: (id: CrewBoardActionId) => void;
}) {
  const card = crew.cards.find((item) => item.id === row.id);
  const builder = crewMemberById(crew, card?.builderId);
  return (
    <section
      className="team-ready"
      aria-label={`Ready for you: ${row.title}`}
      data-team-ready={row.id}
    >
      <CrewCritter
        path={project}
        role={builder?.role ?? "builder"}
        {...(builder?.critter ? { critter: memberCritter(builder) } : {})}
        className="team-ready-mark"
      />
      <span className="team-ready-text">
        <span className="team-ready-tag">
          <i aria-hidden="true" />
          Ready for you
        </span>
        <span className="team-ready-line">
          <b>{row.title}</b>
          <span title={row.status}>{row.status}</span>
        </span>
      </span>
      <span className="team-ready-actions">
        {row.actions.map((action) => (
          <TeamCardButton
            key={action.id}
            size="compact"
            variant={action.primary ? "primary" : "default"}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </TeamCardButton>
        ))}
      </span>
      {problem ? (
        <p className="team-ready-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The thread

function Thread({
  project,
  posts,
  filter,
  filterName,
  working,
  now,
  onCards,
}: {
  project: string;
  posts: readonly TeamPost[];
  filter: string | null;
  filterName?: string;
  working: readonly CrewMemberView[];
  now: number;
  onCards: () => void;
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
  // Someone starts or stops working: the live line stays in view.
  useLayoutEffect(() => {
    if (followRef.current.following) toBottom();
  }, [liveKey]);
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
        aria-label={filterName ? `${filterName}'s posts` : "Team thread"}
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
        {empty ? (
          <p className="team-thread-empty">
            {filterName
              ? `Nothing from ${filterName} yet. Write to it below; its handoffs show here.`
              : "Nothing here yet. Write to the team below, and its handoffs show here."}
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
                  onCards={onCards}
                />
              ))}
            </ol>
          </section>
        ))}
        {working.length ? (
          <ol className="team-posts" aria-label="Working now">
            {working.map((member) => (
              <li
                key={`live:${member.id}`}
                className="team-post"
                data-live
                data-team-live={member.id}
              >
                <CrewCritter
                  path={project}
                  role={member.role}
                  {...(member.critter ? { critter: member.critter } : {})}
                  state="working"
                  className="team-post-mark"
                />
                <div className="team-post-body">
                  <p className="team-post-head">
                    <b>{member.name}</b>
                    <time>now</time>
                  </p>
                  <p className="team-post-text">{member.line}…</p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
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

function PostView({
  project,
  post,
  onCards,
}: {
  project: string;
  post: TeamPost;
  onCards: () => void;
}) {
  if (post.kind === "you")
    return (
      <li className="team-you" data-team-post="you">
        <p className="team-you-bubble">{post.text}</p>
        <p className="team-you-meta">
          <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
          {post.to
            ? ` · to ${post.to.name}`
            : post.as
              ? ` · ${BECAME[post.as]}`
              : ""}
        </p>
      </li>
    );
  if (post.kind === "event")
    return (
      <li
        className="team-event"
        data-team-post="event"
        data-needs-you={post.needsYou || undefined}
      >
        {post.needsYou ? <i className="team-event-dot" aria-hidden /> : null}
        {post.text} <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
        {post.needsYou ? (
          <>
            {" "}
            <button type="button" className="team-post-link" onClick={onCards}>
              See it on the board
            </button>
          </>
        ) : null}
      </li>
    );
  return (
    <li
      className="team-post"
      data-team-post={post.author.id}
      data-needs-you={post.needsYou || undefined}
    >
      <AuthorMark
        project={project}
        author={post.author}
        className="team-post-mark"
      />
      <div className="team-post-body">
        <p className="team-post-head">
          <b>{post.author.name}</b>
          <time dateTime={isoTime(post.at)}>{clock(post.at)}</time>
          {post.card ? (
            <span className="team-post-card">{post.card}</span>
          ) : null}
        </p>
        <p className="team-post-text">{post.text}</p>
        {post.handoff ? (
          <span className="team-handoff" data-team-handoff>
            <AuthorMark
              project={project}
              author={post.handoff.from}
              className="team-handoff-mark"
            />
            <ArrowRight className="team-handoff-arrow" aria-hidden />
            {post.handoff.to === "you" ? (
              <i className="team-handoff-you" aria-hidden />
            ) : (
              <AuthorMark
                project={project}
                author={post.handoff.to}
                className="team-handoff-mark"
              />
            )}
            <span>{post.handoff.label}</span>
          </span>
        ) : null}
        {post.needsYou ? (
          <button type="button" className="team-post-link" onClick={onCards}>
            Answer on its card
          </button>
        ) : null}
      </div>
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
  members,
  to,
  mode,
  input,
  onTo,
  onMode,
}: {
  project: string;
  members: readonly CrewMemberView[];
  /** The teammate it writes to, as you picked them; none for everyone. */
  to: Addressee | null;
  mode: Mode;
  input: RefObject<HTMLTextAreaElement | null>;
  onTo: (to: Addressee | null) => void;
  onMode: (mode: Mode) => void;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  // What the box holds now, for a send that ends after you typed more.
  const typed = useRef(text);
  typed.current = text;
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
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
        { id: null as string | null, name: "Everyone", role: undefined },
        ...members.map((member) => ({
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
    onTo(option.id ? { id: option.id, name: option.name } : null);
    requestAnimationFrame(() => element?.focus());
  };
  // How long it may be: a chat message, a goal, or a card's words.
  const limit = to
    ? CREW_MESSAGE_MAX
    : mode === "goal"
      ? CREW_GOAL_MAX
      : CREW_NOTE_MAX;
  const send = async () => {
    const words = text.trim();
    if (!words || sending) return;
    // Never to everyone instead: a teammate who left is said, and you
    // choose again.
    if (to && toGone) {
      setProblem(
        `${toName} isn't in the team any more. Pick someone else or write to everyone.`,
      );
      return;
    }
    if (!to && words.length > limit) {
      setProblem(mode === "goal" ? TOO_LONG_FOR_A_GOAL : TOO_LONG_FOR_EVERYONE);
      return;
    }
    // Who it went to, so a message that fails comes back to them.
    const sentTo = to;
    setSending(true);
    setProblem(null);
    // The box is free at once: what you start typing now stays.
    setText("");
    const why = sentTo
      ? await tellTeammate(project, sentTo.id, words)
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
    onMode("card");
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
      to &&
      !sending &&
      !text &&
      event.currentTarget.selectionStart === 0
    ) {
      event.preventDefault();
      onTo(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const placeholder = toName
    ? `Write to ${toName}…`
    : mode === "rule"
      ? "A rule for every card, like “Use pnpm”…"
      : mode === "goal"
        ? "A goal the team keeps going towards…"
        : "Write to the team, or @ one teammate…";
  const current = MODES.find((item) => item.id === mode)!;
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
                <ProjectMark path={project} className="team-mention-mark" />
              )}
              <span className="team-mention-name">{option.name}</span>
              <span className="team-mention-role">
                {option.role
                  ? titleBeside(
                      option.name,
                      CREW_ROLE_INFO[option.role.role].label,
                    )
                  : "The whole team"}
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
        ) : null}
        <textarea
          ref={input}
          className="team-compose-input"
          rows={1}
          role="combobox"
          aria-label={toName ? `Write to ${toName}` : "Write to the team"}
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
        {!to ? (
          <button
            type="button"
            className="team-compose-mode"
            data-mode={mode}
            aria-label={`How the team takes this: ${current.label}`}
            title="A card to build, a rule for every card, or a goal"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(event) => setMenu(menu ? null : event.currentTarget)}
          >
            {current.word}
            <ChevronDown size={11} />
          </button>
        ) : null}
        <button
          type="button"
          className="team-compose-at"
          aria-label="Write to one teammate"
          title="Write to one teammate"
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
          aria-label={toName ? `Send to ${toName}` : "Send to the team"}
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
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="How the team takes this"
          items={MODES.map((item) => ({
            kind: "item" as const,
            id: item.id,
            label: item.label,
            ...(item.id === mode ? { checked: true } : {}),
          }))}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            onMode(id as Mode);
            input.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
