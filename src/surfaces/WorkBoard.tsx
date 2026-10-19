import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ConfirmDialog } from "../chrome/ConfirmDialog";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { MoreHorizontal } from "../chrome/icons";
import { TeamCardButton, TeamMiniFaces } from "../chrome/TeamCard";
import { useBoardDrag } from "../hooks/useBoardDrag";
import { useCardGlide } from "../hooks/useCardGlide";
import { equalChromeData } from "../hooks/useChromeProps";
import { useDevPreviews } from "../hooks/useDevPreviews";
import { useFeatureCards } from "../hooks/useFeatureCards";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useChatReviews } from "../lib/chatReview";
import {
  addFeatureCards,
  addFeatureIdea,
  deleteFeatureCard,
  editFeatureCard,
  featureBrief,
  linkFeatureChat,
  moveFeatureCard,
  settleFeatureCards,
  FEATURE_COLUMNS,
  FEATURE_NOTE_MAX,
  FEATURE_TITLE_MAX,
  type FeatureColumn,
} from "../lib/featureCards";
import { minuteClockNow, subscribeMinuteClock } from "../lib/minuteClock";
import { useShippedChats } from "../lib/shippedChats";
import {
  BOARD_COLUMNS,
  BOARD_EMPTY_INVITATION,
  boardTodayText,
  outsideText,
  workBoard,
  type BoardAction,
  type BoardCard,
  type BoardColumnId,
  type OutsideWork,
} from "../lib/workBoard";
import {
  useWorkBoardFeed,
  workBoardActions,
  workBoardFeedLoaded,
} from "../lib/workBoardFeed";
import { homeElapsed } from "../lib/workspaceHome";
import { BoardIssueImport } from "./BoardIssueImport";
// The frame brings the board's styles, loaded with the workspace.
import { WorkBoardHeading } from "./WorkBoardFrame";

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
 * One project's board, opened like a browser tab: the features you want
 * built, in Ideas, Building, Review and Shipped. Build sends a card to an
 * agent; cards then move by themselves from their chats' real state (see
 * `workBoard`). It renders summary data only and reads the workspace's
 * published feed (see `workBoardFeed`), the saved cards and the review, ship
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
  const board = useFeatureCards(project, visible);
  const reviews = useChatReviews();
  const shipped = useShippedChats();
  const previews = useDevPreviews();
  const now = useClock(visible);
  const [showOlder, setShowOlder] = useState(false);
  const toggleOlder = useCallback(() => setShowOlder((shown) => !shown), []);
  const live = workBoardFeedLoaded(feed);
  const model = useMemo(
    () =>
      workBoard({
        project,
        cards: board.cards,
        chats: feed.chats,
        statuses: feed.statuses,
        teams: feed.teams,
        reviews,
        shipped,
        previews,
        now,
        showOlder,
        live,
      }),
    [
      project,
      board.cards,
      feed,
      reviews,
      shipped,
      previews,
      now,
      showOlder,
      live,
    ],
  );
  // A minute's tick or a change elsewhere that leaves every card the same
  // keeps the drawn board as it is.
  const stable = useRef(model);
  if (stable.current !== model && !equalChromeData(stable.current, model))
    stable.current = model;
  const shown = stable.current;
  // Cards whose chats changed moved by themselves: save where they went,
  // once for each change, so a save that fails is not retried in a loop.
  const settles = shown.settles;
  const settled = useRef("");
  useEffect(() => {
    if (!visible || !board.loaded || !settles.length) return;
    const key = JSON.stringify(settles);
    if (key === settled.current) return;
    settled.current = key;
    void settleFeatureCards(project, settles);
  }, [visible, board.loaded, project, settles]);
  const loading = !live || !board.loaded;
  return (
    <WorkBoardView
      project={project}
      columns={shown.columns}
      olderShipped={shown.olderShipped}
      today={loading ? "Loading…" : boardTodayText(shown.today)}
      outside={shown.outside}
      empty={shown.empty}
      error={board.error}
      loading={loading}
      live={visible}
      showOlder={showOlder}
      onShowOlder={toggleOlder}
    />
  );
}

const STAGE_LABEL: Record<OutsideWork["stage"], string> = {
  "needs-you": "Needs you",
  working: "Working",
  review: "Changes to review",
};

/** The board as drawn, from its model; memoized so equal lines skip work. */
export const WorkBoardView = memo(function WorkBoardView({
  project,
  columns,
  olderShipped,
  today,
  outside = NO_OUTSIDE,
  empty = false,
  error,
  loading = false,
  live,
  showOlder,
  onShowOlder,
}: {
  project: string;
  columns: Readonly<Record<BoardColumnId, BoardCard[]>>;
  olderShipped: number;
  today: string;
  outside?: readonly OutsideWork[];
  /** No cards at all yet: Ideas invites the first. */
  empty?: boolean;
  /** A failed read or save, in plain words. */
  error?: string;
  /** The workspace or the saved cards are not read yet. */
  loading?: boolean;
  live: boolean;
  showOlder: boolean;
  onShowOlder: () => void;
}) {
  const labels = useProjectLabels();
  const scroller = useRef<HTMLDivElement>(null);
  const layoutKey = BOARD_COLUMNS.map(
    (column) =>
      `${column.id}:${columns[column.id].map((card) => card.id).join(",")}`,
  ).join("|");
  const { remember } = useCardGlide(scroller, layoutKey);
  const [menu, setMenu] = useState<{
    cardId: string;
    anchor: HTMLElement;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BoardCard | null>(null);
  const latest = useRef(columns);
  latest.current = columns;
  const cardById = useCallback(
    (id: string) =>
      FEATURE_COLUMNS.flatMap((column) => latest.current[column]).find(
        (card) => card.id === id,
      ),
    [],
  );
  const move = useCallback(
    (id: string, column: FeatureColumn) => {
      const card = cardById(id);
      if (card && card.column !== column)
        void moveFeatureCard(project, id, column, card.basis);
    },
    [cardById, project],
  );
  const onDrop = useCallback(
    (id: string, column: string) => {
      if (!FEATURE_COLUMNS.includes(column as FeatureColumn)) return;
      // The card glides on from where it was let go.
      remember(id);
      move(id, column as FeatureColumn);
    },
    [move, remember],
  );
  const startDrag = useBoardDrag(scroller, onDrop);
  const openMenu = useCallback(
    (cardId: string, anchor: HTMLElement) =>
      setMenu((open) => (open?.cardId === cardId ? null : { cardId, anchor })),
    [],
  );
  const stopEditing = useCallback(() => setEditing(null), []);
  const menuCard = menu ? cardById(menu.cardId) : undefined;
  const pick = (id: string) => {
    const card = menuCard;
    setMenu(null);
    if (!card) return;
    if (id === "draft") void openDraft(project, card);
    else if (id === "edit") setEditing(card.id);
    else if (id === "delete") setDeleting(card);
    else if (id.startsWith("move:"))
      move(card.id, id.slice("move:".length) as FeatureColumn);
  };
  return (
    <div
      ref={scroller}
      className="work-board"
      data-work-board={project}
      aria-busy={loading || undefined}
      aria-label={`${projectDisplayName(project, labels)} board`}
    >
      <WorkBoardHeading project={project} line={today} />
      {error ? (
        <p className="work-board-error" role="alert">
          {error}
        </p>
      ) : null}
      {outside.length && !loading ? (
        <OutsideLine project={project} outside={outside} />
      ) : null}
      <div className="work-board-columns">
        {BOARD_COLUMNS.map((column) => {
          const cards = columns[column.id];
          const older = column.id === "shipped" ? olderShipped : 0;
          const ideas = column.id === "idea";
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
                {ideas && !loading ? (
                  <BoardIssueImport project={project} visible={live} />
                ) : null}
              </h2>
              {cards.length ? (
                <ul className="work-board-list" role="list">
                  {cards.map((card) => (
                    <li key={card.id} className="work-board-item">
                      <BoardCardView
                        project={project}
                        card={card}
                        live={live}
                        editing={editing === card.id}
                        menuOpen={menu?.cardId === card.id}
                        onMenu={openMenu}
                        onEdit={setEditing}
                        onEditDone={stopEditing}
                        onPointerDown={startDrag}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className="work-board-empty"
                  data-invite={(ideas && empty && !loading) || undefined}
                >
                  {loading
                    ? "Loading…"
                    : ideas && empty
                      ? BOARD_EMPTY_INVITATION
                      : column.empty}
                </p>
              )}
              {older || (column.id === "shipped" && showOlder) ? (
                <button
                  type="button"
                  className="work-board-older"
                  onClick={onShowOlder}
                >
                  {showOlder ? "Show this week only" : `${older} older`}
                </button>
              ) : null}
              {ideas && !loading ? <AddIdea project={project} /> : null}
            </section>
          );
        })}
      </div>
      {menu && menuCard ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu.anchor}
          align="end"
          gap={4}
          ariaLabel={`Actions for “${menuCard.title}”`}
          items={cardMenuItems(menuCard)}
          onPick={pick}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title="Delete this card?"
          body={`“${deleting.title}” leaves the board. Its chats stay in the sidebar.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void deleteFeatureCard(project, id);
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
});

const NO_OUTSIDE: readonly OutsideWork[] = Object.freeze([]);

/** A card's ⋯ menu: a draft of it, its words, where it goes, and Delete. */
export function cardMenuItems(card: BoardCard): ExplorerMenuItem[] {
  return [
    {
      kind: "item",
      id: "draft",
      label: "Open as draft",
      description: "A new chat with this typed in, not sent",
    },
    { kind: "item", id: "edit", label: "Edit" },
    { kind: "sep" },
    ...BOARD_COLUMNS.filter((column) => column.id !== card.column).map(
      (column): ExplorerMenuItem => ({
        kind: "item",
        id: `move:${column.id}`,
        label: `Move to ${column.title}`,
      }),
    ),
    { kind: "sep" },
    { kind: "item", id: "delete", label: "Delete", danger: true },
  ];
}

const brief = (card: BoardCard) =>
  featureBrief({
    title: card.title,
    note: card.note,
    sourceUrl: card.source?.url,
  });

/**
 * Build: a new chat with the default agent sends the card's title and note
 * at once, and the card moves to Building, linked to it.
 */
async function buildCard(project: string, card: BoardCard) {
  const sessionId = workBoardActions()?.build(project, brief(card));
  if (sessionId)
    await linkFeatureChat(project, card.id, sessionId, { column: "building" });
}

/** Open as draft: a new chat with the brief typed in, linked to the card. */
async function openDraft(project: string, card: BoardCard) {
  const sessionId = workBoardActions()?.draft(project, brief(card));
  if (sessionId) await linkFeatureChat(project, card.id, sessionId);
}

const ACTION_LABEL: Record<BoardAction["kind"], string> = {
  build: "Build",
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
const PRIMARY = new Set<BoardAction["kind"]>([
  "build",
  "allow",
  "ship",
  "compare",
]);

function runAction(project: string, card: BoardCard, action: BoardAction) {
  const actions = workBoardActions();
  if (!actions) return;
  switch (action.kind) {
    case "build":
      void buildCard(project, card);
      return;
    case "allow":
      actions.allow(action.sessionId, action.requestId);
      return;
    case "open":
    case "answer":
      actions.openChat(action.sessionId);
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
      actions.review(action.sessionId, action.cwd);
      return;
    case "ship":
      actions.ship(action.sessionId, action.cwd);
      return;
    case "commit":
      actions.openCommit(action.sessionId, action.cwd, action.commit);
      return;
    case "pr":
      actions.openUrl(action.url);
  }
}

const BoardCardView = memo(function BoardCardView({
  project,
  card,
  live,
  editing,
  menuOpen,
  onMenu,
  onEdit,
  onEditDone,
  onPointerDown,
}: {
  project: string;
  card: BoardCard;
  live: boolean;
  editing: boolean;
  menuOpen: boolean;
  onMenu: (cardId: string, anchor: HTMLElement) => void;
  onEdit: (cardId: string) => void;
  onEditDone: () => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    cardId: string,
  ) => void;
}) {
  const label = (action: BoardAction) =>
    action.kind === "pr"
      ? `Open PR #${action.number}`
      : ACTION_LABEL[action.kind];
  const open = () => {
    if (card.sessionId) workBoardActions()?.openChat(card.sessionId);
    else onEdit(card.id);
  };
  const detail = card.line ?? (card.column === "idea" ? card.note : undefined);
  const source = card.source;
  return (
    <article
      className="work-board-card"
      data-board-card={card.id}
      data-glide-key={card.id}
      data-board-chats={card.chatIds.join(" ") || undefined}
      data-column={card.column}
      data-team={card.team}
      data-needs-you={card.needsYou ? "" : undefined}
      data-editing={editing || undefined}
      onPointerDown={
        editing ? undefined : (event) => onPointerDown(event, card.id)
      }
    >
      {editing ? (
        <CardEditor project={project} card={card} onDone={onEditDone} />
      ) : (
        <>
          <button
            type="button"
            className="work-board-card-open"
            title={
              card.sessionId ? `Open “${card.title}”` : `Edit “${card.title}”`
            }
            onClick={open}
          >
            <span className="work-board-card-title">
              {card.faces.length ? (
                <TeamMiniFaces
                  members={card.faces}
                  active={card.working && live}
                />
              ) : null}
              <span className="work-board-card-name">{card.title}</span>
            </span>
            {detail ? (
              <span className="work-board-card-line" title={detail}>
                {detail}
                {card.since !== undefined ? (
                  <Elapsed since={card.since} live={live} />
                ) : null}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="work-board-card-more"
            aria-label={`More for “${card.title}”`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Open as draft, edit, move or delete"
            data-no-drag
            onClick={(event) => onMenu(card.id, event.currentTarget)}
          >
            <MoreHorizontal size={14} />
          </button>
          {card.needsYou ? (
            <p className="work-board-needs-you" title={card.needsYou}>
              <span className="work-board-needs-you-label">Needs you</span>
              {` · ${card.needsYou}`}
            </p>
          ) : null}
          {card.actions.length || source ? (
            <div className="work-board-card-actions" data-no-drag>
              {card.actions.map((action) => (
                <BoardButton
                  key={action.kind}
                  primary={PRIMARY.has(action.kind)}
                  onClick={() => runAction(project, card, action)}
                >
                  {label(action)}
                </BoardButton>
              ))}
              {source ? (
                <TeamCardButton
                  size="compact"
                  variant="ghost"
                  className="work-board-source"
                  title={source.url}
                  onClick={() => workBoardActions()?.openUrl(source.url)}
                >
                  {source.label}
                </TeamCardButton>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
});

/** A card's title and note, edited in place. Enter saves, Escape cancels. */
function CardEditor({
  project,
  card,
  onDone,
}: {
  project: string;
  card: BoardCard;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [note, setNote] = useState(card.note ?? "");
  const save = () => {
    if (!title.trim()) return;
    void editFeatureCard(project, card.id, { title, note });
    onDone();
  };
  return (
    <form
      className="work-board-edit"
      data-no-drag
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDone();
      }}
    >
      <input
        className="work-board-input"
        aria-label="Title"
        value={title}
        maxLength={FEATURE_TITLE_MAX}
        autoFocus
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="work-board-input work-board-note-input"
        aria-label="Note"
        placeholder="Add a note for the agent (optional)"
        rows={3}
        value={note}
        maxLength={FEATURE_NOTE_MAX}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="work-board-edit-actions">
        <TeamCardButton size="compact" variant="ghost" onClick={onDone}>
          Cancel
        </TeamCardButton>
        <TeamCardButton
          size="compact"
          variant="primary"
          type="submit"
          disabled={!title.trim()}
        >
          Save
        </TeamCardButton>
      </div>
    </form>
  );
}

/** Ideas' foot: write one down. Enter adds it, Escape clears it. */
function AddIdea({ project }: { project: string }) {
  const [text, setText] = useState("");
  return (
    <form
      className="work-board-add"
      onSubmit={(event) => {
        event.preventDefault();
        const title = text.trim();
        if (!title) return;
        setText("");
        void addFeatureIdea(project, { title });
      }}
    >
      <input
        className="work-board-input work-board-add-input"
        type="text"
        placeholder="Add an idea"
        aria-label="Add an idea"
        value={text}
        maxLength={FEATURE_TITLE_MAX}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setText("");
          event.currentTarget.blur();
        }}
      />
    </form>
  );
}

/**
 * Work in the project that no card links to, on one slim line: what it is,
 * the chats themselves when opened, and Add them.
 */
function OutsideLine({
  project,
  outside,
}: {
  project: string;
  outside: readonly OutsideWork[];
}) {
  const [open, setOpen] = useState(false);
  const add = (entries: readonly OutsideWork[]) =>
    void addFeatureCards(
      project,
      entries.map((entry) => ({
        title: entry.title,
        chatIds: [entry.sessionId],
        column: entry.column,
      })),
    );
  const waiting = outside.some((entry) => entry.stage === "needs-you");
  return (
    <div
      className="work-board-outside"
      data-board-outside
      data-needs-you={waiting || undefined}
    >
      <div className="work-board-outside-line">
        <button
          type="button"
          className="work-board-outside-toggle"
          aria-expanded={open}
          title={open ? "Hide these chats" : "Show these chats"}
          onClick={() => setOpen((shown) => !shown)}
        >
          {outsideText(outside)}
        </button>
        <span aria-hidden>·</span>
        <button
          type="button"
          className="work-board-outside-add"
          onClick={() => add(outside)}
        >
          {outside.length === 1 ? "Add it" : "Add them"}
        </button>
      </div>
      {open ? (
        <ul className="work-board-outside-list" role="list">
          {outside.map((entry) => (
            <li
              key={entry.id}
              className="work-board-outside-item"
              data-outside-chat={entry.sessionId}
            >
              <button
                type="button"
                className="work-board-outside-chat"
                title={`Open “${entry.title}”`}
                onClick={() => workBoardActions()?.openChat(entry.sessionId)}
              >
                {entry.faces.length ? (
                  <TeamMiniFaces members={entry.faces} />
                ) : null}
                <span className="work-board-card-name">{entry.title}</span>
                <span
                  className="work-board-outside-stage"
                  data-stage={entry.stage}
                >
                  {STAGE_LABEL[entry.stage]}
                </span>
              </button>
              <TeamCardButton
                size="compact"
                className="work-board-action"
                onClick={() => add([entry])}
              >
                Add
              </TeamCardButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The team family's one button, compact, on a board card. */
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
    <TeamCardButton
      size="compact"
      variant={primary ? "primary" : "default"}
      className="work-board-action"
      data-primary={primary || undefined}
      onClick={onClick}
    >
      {children}
    </TeamCardButton>
  );
}

/** " · 2m", ticking once a minute while the board is on screen. */
function Elapsed({ since, live }: { since: number; live: boolean }) {
  const now = useClock(live);
  return <> · {homeElapsed(since, Math.max(now, since))}</>;
}
