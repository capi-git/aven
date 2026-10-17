import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ProjectMark } from "../chrome/ProjectMark";
import { equalChromeData } from "../hooks/useChromeProps";
import { TeamMiniFaces } from "../chrome/TeamCard";
import { useCardGlide } from "../hooks/useCardGlide";
import { useDevPreviews } from "../hooks/useDevPreviews";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useChatReviews } from "../lib/chatReview";
import { minuteClockNow, subscribeMinuteClock } from "../lib/minuteClock";
import { useShippedChats } from "../lib/shippedChats";
import {
  BOARD_COLUMNS,
  boardTodayText,
  workBoard,
  type BoardAction,
  type BoardCard,
  type BoardColumnId,
} from "../lib/workBoard";
import { useWorkBoardFeed, workBoardActions } from "../lib/workBoardFeed";
import { homeElapsed } from "../lib/workspaceHome";
import "./WorkBoard.css";

const noSubscription = () => () => {};

/** The minute clock while `live`; a hidden board does not tick. */
function useClock(live: boolean): number {
  return useSyncExternalStore(
    live ? subscribeMinuteClock : noSubscription,
    minuteClockNow,
    minuteClockNow,
  );
}

/**
 * One project's board, opened like a browser tab: every chat in four
 * columns by its one-word status. It renders summary data only and reads
 * the workspace's published feed (see `workBoardFeed`) plus the review, ship
 * and dev-preview stores, so a streamed reply re-renders nothing here. A
 * hidden board stops following the workspace and the clock, and catches up
 * when it is shown again.
 */
export function WorkBoard({
  project,
  visible = true,
}: {
  project: string;
  visible?: boolean;
}) {
  const feed = useWorkBoardFeed(visible);
  const reviews = useChatReviews();
  const shipped = useShippedChats();
  const previews = useDevPreviews();
  const now = useClock(visible);
  const [showOlder, setShowOlder] = useState(false);
  const toggleOlder = useCallback(() => setShowOlder((shown) => !shown), []);
  const model = useMemo(
    () =>
      workBoard({
        project,
        chats: feed.chats,
        statuses: feed.statuses,
        teams: feed.teams,
        reviews,
        shipped,
        previews,
        now,
        showOlder,
      }),
    [project, feed, reviews, shipped, previews, now, showOlder],
  );
  // A minute's tick or a change elsewhere that leaves every card the same
  // keeps the drawn board as it is.
  const stable = useRef(model);
  if (stable.current !== model && !equalChromeData(stable.current, model))
    stable.current = model;
  const shown = stable.current;
  return (
    <WorkBoardView
      project={project}
      columns={shown.columns}
      olderShipped={shown.olderShipped}
      today={boardTodayText(shown.today)}
      live={visible}
      showOlder={showOlder}
      onShowOlder={toggleOlder}
    />
  );
}

/** The board as drawn, from its model; memoized so equal lines skip work. */
export const WorkBoardView = memo(function WorkBoardView({
  project,
  columns,
  olderShipped,
  today,
  live,
  showOlder,
  onShowOlder,
}: {
  project: string;
  columns: Readonly<Record<BoardColumnId, BoardCard[]>>;
  olderShipped: number;
  today: string;
  live: boolean;
  showOlder: boolean;
  onShowOlder: () => void;
}) {
  const labels = useProjectLabels();
  const name = projectDisplayName(project, labels);
  const scroller = useRef<HTMLDivElement>(null);
  const layoutKey = BOARD_COLUMNS.map(
    (column) =>
      `${column.id}:${columns[column.id].map((card) => card.id).join(",")}`,
  ).join("|");
  useCardGlide(scroller, layoutKey);
  return (
    <div
      ref={scroller}
      className="work-board"
      data-work-board={project}
      aria-label={`${name} board`}
    >
      <header className="work-board-header">
        <ProjectMark path={project} className="work-board-mark" />
        <div className="work-board-heading">
          <h1>{name}</h1>
          <p className="work-board-today">{today}</p>
        </div>
      </header>
      <div className="work-board-columns">
        {BOARD_COLUMNS.map((column) => {
          const cards = columns[column.id];
          const older = column.id === "shipped" ? olderShipped : 0;
          return (
            <section
              key={column.id}
              className="work-board-column"
              data-board-column={column.id}
              aria-label={column.title}
            >
              <h2 className="work-board-column-title">
                <span>{column.title}</span>
                <span className="work-board-count">{cards.length}</span>
              </h2>
              {cards.length ? (
                <ul className="work-board-list" role="list">
                  {cards.map((card) => (
                    <li key={card.id} className="work-board-item">
                      <BoardCardView card={card} live={live} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="work-board-empty">{column.empty}</p>
              )}
              {older || (column.id === "shipped" && showOlder) ? (
                <button
                  type="button"
                  className="work-board-older"
                  onClick={onShowOlder}
                >
                  {showOlder ? "Show this week only" : `Show older (${older})`}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
});

const ACTION_LABEL: Record<BoardAction["kind"], string> = {
  allow: "Allow",
  open: "Open chat",
  answer: "Answer",
  watch: "Watch",
  compare: "Compare",
  preview: "Preview",
  review: "Review",
  ship: "Ship it",
  commit: "Open commit",
  pr: "Open pull request",
};

/** The action a card leads with. */
const PRIMARY = new Set<BoardAction["kind"]>(["allow", "ship", "compare"]);

function runAction(card: BoardCard, action: BoardAction) {
  const actions = workBoardActions();
  if (!actions) return;
  switch (action.kind) {
    case "allow":
      actions.allow(card.sessionId, action.requestId);
      return;
    case "open":
    case "answer":
      actions.openChat(card.sessionId);
      return;
    case "watch":
      actions.watch(action.teamId);
      return;
    case "compare":
      actions.compare(action.raceId);
      return;
    case "preview":
      actions.preview(action.previewKey);
      return;
    case "review":
      actions.review(card.sessionId, card.cwd);
      return;
    case "ship":
      actions.ship(card.sessionId, card.cwd);
      return;
    case "commit":
      actions.openCommit(card.sessionId, card.cwd, action.commit);
      return;
    case "pr":
      actions.openUrl(action.url);
  }
}

const BoardCardView = memo(function BoardCardView({
  card,
  live,
}: {
  card: BoardCard;
  live: boolean;
}) {
  const label = (action: BoardAction) =>
    action.kind === "pr"
      ? `Open PR #${action.number}`
      : ACTION_LABEL[action.kind];
  return (
    <article
      className="work-board-card"
      data-board-card={card.id}
      data-glide-key={card.id}
      data-session-id={card.sessionId}
      data-column={card.column}
      data-team={card.team}
    >
      <button
        type="button"
        className="work-board-card-open"
        title={`Open ${card.title}`}
        onClick={() => workBoardActions()?.openChat(card.sessionId)}
      >
        <span className="work-board-card-title">
          {card.faces.length ? (
            <TeamMiniFaces
              members={card.faces}
              active={card.column === "working" && live}
            />
          ) : null}
          <span className="work-board-card-name">{card.title}</span>
        </span>
        <span className="work-board-card-line">
          {card.line}
          {card.since !== undefined ? (
            <Elapsed since={card.since} live={live} />
          ) : null}
        </span>
      </button>
      {card.actions.length ? (
        <div className="work-board-card-actions">
          {card.actions.map((action) => (
            <BoardButton
              key={action.kind}
              primary={PRIMARY.has(action.kind)}
              onClick={() => runAction(card, action)}
            >
              {label(action)}
            </BoardButton>
          ))}
        </div>
      ) : null}
    </article>
  );
});

function BoardButton({
  primary,
  onClick,
  children,
}: {
  primary: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="work-board-action"
      data-primary={primary || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** " · 2m", ticking once a minute while the board is on screen. */
function Elapsed({ since, live }: { since: number; live: boolean }) {
  const now = useClock(live);
  return <> · {homeElapsed(since, Math.max(now, since))}</>;
}
