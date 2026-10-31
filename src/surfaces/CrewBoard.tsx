import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CrewCritter,
  CrewCritters,
  CrewRoundDots,
  CrewStatusPill,
} from "../chrome/CrewCritter";
import { ExplorerMenu } from "../chrome/ExplorerMenu";
import { MoreHorizontal } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import {
  applyCrewCard,
  requestCrewReview,
  discardCrewCard,
  markCrewFixChanged,
  resumeCrewCard,
  useCrewWorkspace,
} from "../lib/crewActions";
import {
  crewMemberById,
  memberCritter,
  crewCard,
  securityReviewBy,
  updateCrew,
  withoutNote,
  type Crew,
  type CrewCard,
  type CrewFeedEntry,
} from "../lib/crews";
import type { CrewBoardInfo } from "../lib/crewView";
import { errorText, logError } from "../lib/errors";
import { addFeatureIdea } from "../lib/featureCards";
import { botCopyHost } from "../lib/projectBotCopy";
import { buildUnifiedFile } from "../lib/unifiedDiff";
import {
  FEED_FOLLOW_START,
  feedEntryFolds,
  feedGrew,
  feedScrolled,
  unseenLabel,
  type FeedFollow,
} from "../lib/feedFollow";
import { plural } from "../lib/words";
import { homeElapsed } from "../lib/workspaceHome";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";
import "../chrome/TeamCard.css";
import "./CrewBoard.css";

/**
 * The crew on its project's Board (the crew view): one header with its
 * limits as plain counts and Pause, a strip of its bots, crew cards with
 * who holds them, their stage and round dots, and the Feed with "Tell the
 * crew…". Every button here says Aven's words; a bot's words only ever show
 * as quoted text.
 */

function clock(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** A crew card's face on the Board: its stage, round dots and what it waits for. */
export function CrewCardFace({
  info,
  now,
}: {
  info: CrewBoardInfo;
  now: number;
}) {
  const tone =
    info.label === "Ready" ? "ready" : info.needsYou ? "needs-you" : undefined;
  return (
    <>
      {info.label ? (
        <span className="crew-card-stage" data-tone={tone}>
          <strong>{info.label}</strong>
          {info.detail ? <span> · {info.detail}</span> : null}
          {info.rounds && !info.needsYou ? (
            <CrewRoundDots
              current={info.rounds.current}
              total={info.rounds.total}
            />
          ) : null}
        </span>
      ) : null}
      {info.line || info.since !== undefined ? (
        <span className="crew-card-line">
          {info.line}
          {info.line && info.since !== undefined ? " · " : ""}
          {info.since !== undefined
            ? homeElapsed(info.since, Math.max(now, info.since))
            : null}
        </span>
      ) : null}
      {info.assigned ? (
        <span className="crew-card-assigned" data-crew-assigned>
          {info.assigned}
        </span>
      ) : null}
      {info.change ? (
        <span className="crew-card-change">
          {plural(info.change.files, "file")}{" "}
          <span className="crew-plus">+{info.change.additions}</span>{" "}
          <span className="crew-minus">−{info.change.deletions}</span>
        </span>
      ) : null}
    </>
  );
}

/** Answer the Builder's question, on the card: your words go to it as the next turn. */
export function CrewAnswerBox({
  path,
  cardId,
  onDone,
}: {
  path: string;
  cardId: string;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    resumeCrewCard(path, cardId, text);
    onDone();
  };
  return (
    <form className="crew-answer" data-no-drag onSubmit={send}>
      <textarea
        className="work-board-input"
        aria-label="Your answer"
        placeholder="Your answer…"
        rows={2}
        autoFocus
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
            send(event);
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
          disabled={!text.trim()}
        >
          Send
        </TeamCardButton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The Feed

function whoName(entry: CrewFeedEntry, name: (who: string) => string): string {
  if (entry.who === "you") return "You";
  if (entry.who === "aven" || !entry.who) return "Aven";
  return name(entry.member ?? entry.who);
}

function FeedMark({
  path,
  entry,
  critter,
}: {
  path: string;
  entry: CrewFeedEntry;
  critter?: string;
}) {
  if (entry.who && entry.who !== "you" && entry.who !== "aven")
    return (
      <CrewCritter
        path={path}
        role={entry.who}
        {...(critter ? { critter } : {})}
      />
    );
  return (
    <span className="crew-feed-you" aria-hidden="true">
      {entry.who === "you" ? "Y" : "A"}
    </span>
  );
}

const QUOTED = new Set(["handoff", "verdict", "note", "stuck"]);

/** Entries the Feed shows at first, and adds with each Show earlier. */
const FEED_SHOWN = 40;

/** The mark a line's member wears, when you chose one. */
function feedCritter(crew: Crew, entry: CrewFeedEntry): { critter?: string } {
  const member = entry.member ? crewMemberById(crew, entry.member) : undefined;
  return member?.critter ? { critter: memberCritter(member) } : {};
}

/** Who a handoff or verdict went to: its card's Checker or Builder. */
function feedTo(crew: Crew, entry: CrewFeedEntry): string | undefined {
  const card = entry.cardId ? crewCard(crew, entry.cardId) : undefined;
  return entry.to === "checker" ? card?.checkerId : card?.builderId;
}

/**
 * The crew's feed: handoffs, verdicts, new ideas, holds and your notes, the
 * newest last, and the Tell the crew box. What you tell the crew becomes a
 * card it builds; with Remember for every card, standing guidance every bot
 * reads at its next turn.
 */
export function CrewFeed({
  crew,
  name,
}: {
  crew: Crew;
  /** A member's name, by its id or its role. */
  name: (who: string) => string;
}) {
  // The newest entries, and more on Show earlier: the store keeps the rest.
  const [shown, setShown] = useState(FEED_SHOWN);
  const [follow, setFollow] = useState<FeedFollow>(FEED_FOLLOW_START);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const newest = crew.feed.at(-1)?.id;
  const seenNewest = useRef(newest);
  const keepFromBottom = useRef<number | null>(null);
  const entries = crew.feed.slice(-shown);
  // A standing note is the entry it was told in (the same words, the same
  // moment), not every later message with those words, like a second "go".
  const standing = new Map(
    crew.notes.map((note) => [`${note.at}\n${note.text}`, note]),
  );
  const today = new Date().toDateString();
  let lastDay = "";
  const toBottom = () => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  };
  // It opens at the newest entry.
  useLayoutEffect(() => {
    toBottom();
  }, []);
  // New entries: followed at the bottom, counted while you read further up.
  useLayoutEffect(() => {
    if (newest === seenNewest.current) return;
    const at = seenNewest.current
      ? crew.feed.findIndex((entry) => entry.id === seenNewest.current)
      : -1;
    const added = at >= 0 ? crew.feed.length - 1 - at : 1;
    seenNewest.current = newest;
    const step = feedGrew(followRef.current, added);
    if (step.scrollToBottom) toBottom();
    else {
      setFollow(step.state);
      // Nothing above what you're reading drops off while you read.
      setShown((count) => count + added);
    }
  }, [newest, crew.feed]);
  // Show earlier keeps what you were reading where it was.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || keepFromBottom.current === null) return;
    element.scrollTop = element.scrollHeight - keepFromBottom.current;
    keepFromBottom.current = null;
  }, [shown]);
  const jumpToNewest = () => {
    toBottom();
    setFollow(FEED_FOLLOW_START);
  };
  return (
    <section
      className="work-board-column crew-feed"
      aria-label="Feed"
      data-crew-feed
    >
      <h2 className="work-board-column-title">
        <span>Feed</span>
      </h2>
      <div className="crew-feed-scroll-wrap">
        <div
          ref={scroller}
          className="crew-feed-scroll"
          data-crew-feed-scroll
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
          {crew.feed.length > shown ? (
            <button
              type="button"
              className="crew-feed-earlier"
              data-crew-feed-earlier
              onClick={() => {
                const element = scroller.current;
                if (element)
                  keepFromBottom.current =
                    element.scrollHeight - element.scrollTop;
                setShown((count) => count + FEED_SHOWN);
              }}
            >
              Show earlier
            </button>
          ) : null}
          {entries.length ? (
            <ol className="crew-feed-list">
              {entries.map((entry) => {
                const day = new Date(entry.at).toDateString();
                const divider =
                  day !== lastDay && lastDay !== "" ? (
                    <li className="crew-feed-day" aria-hidden="true">
                      <span>{day === today ? "Today" : day}</span>
                    </li>
                  ) : null;
                lastDay = day;
                const note =
                  entry.kind === "note" && entry.who === "you"
                    ? standing.get(`${entry.at}\n${entry.text}`)
                    : undefined;
                return (
                  <FeedRow
                    key={entry.id}
                    divider={divider}
                    path={crew.path}
                    entry={entry}
                    {...feedCritter(crew, entry)}
                    who={whoName(entry, name)}
                    to={
                      entry.to
                        ? name(feedTo(crew, entry) ?? entry.to)
                        : undefined
                    }
                    pinned={!!note}
                    open={open.has(entry.id)}
                    onToggle={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(entry.id)) next.delete(entry.id);
                        else next.add(entry.id);
                        return next;
                      })
                    }
                    onUnpin={
                      note
                        ? () =>
                            updateCrew(crew.path, (current) =>
                              withoutNote(current, note.id),
                            )
                        : undefined
                    }
                  />
                );
              })}
            </ol>
          ) : (
            <p className="work-board-empty">Handoffs and verdicts show here.</p>
          )}
        </div>
        {follow.unseen > 0 ? (
          <button
            type="button"
            className="crew-feed-new"
            data-crew-feed-new
            onClick={jumpToNewest}
          >
            {unseenLabel(follow.unseen)}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FeedRow({
  divider,
  path,
  entry,
  critter,
  who,
  to,
  pinned,
  open,
  onToggle,
  onUnpin,
}: {
  divider: React.ReactNode;
  path: string;
  entry: CrewFeedEntry;
  /** The critter its member was drawn as, when you chose one. */
  critter?: string;
  who: string;
  to?: string;
  pinned: boolean;
  /** A long entry is shown whole (else folded to about four lines). */
  open: boolean;
  onToggle: () => void;
  onUnpin?: () => void;
}) {
  const folds = entry.kind !== "ready" && feedEntryFolds(entry.text);
  const folded = folds && !open ? "" : undefined;
  const headline =
    entry.kind === "handoff" || entry.kind === "verdict" ? (
      <>
        <strong>{who}</strong> → <strong>{to}</strong>
        <span className="crew-feed-meta">
          {" "}
          · {entry.kind === "verdict" ? "not yet" : `round ${entry.round ?? 1}`}
        </span>
      </>
    ) : entry.kind === "ready" ? (
      <>
        <strong>{who}</strong> passed <strong>{entry.title}</strong>
      </>
    ) : entry.kind === "note" && entry.who === "you" && !entry.cardId ? (
      <>
        <strong>You</strong> told the crew
        {pinned ? <span className="crew-feed-meta"> · standing</span> : null}
      </>
    ) : (
      <>
        <strong>{who}</strong>
        {entry.title && entry.kind !== "note" ? (
          <span className="crew-feed-meta"> · {entry.title}</span>
        ) : null}
      </>
    );
  const quoted =
    QUOTED.has(entry.kind) && !(entry.kind === "note" && entry.cardId);
  return (
    <>
      {divider}
      <li className="crew-feed-entry" data-feed-kind={entry.kind}>
        <FeedMark path={path} entry={entry} {...(critter ? { critter } : {})} />
        <div className="crew-feed-body">
          <p className="crew-feed-head">
            <span className="crew-feed-who">{headline}</span>
            <time className="crew-feed-time">{clock(entry.at)}</time>
          </p>
          {entry.kind === "ready" ? (
            <p className="crew-feed-ready">Ready for you</p>
          ) : quoted ? (
            <p className="crew-feed-quote">
              <span className="crew-feed-words" data-folded={folded}>
                {entry.text}
              </span>
            </p>
          ) : (
            <p className="crew-feed-text">
              <span className="crew-feed-words" data-folded={folded}>
                {entry.text}
              </span>
            </p>
          )}
          {folds ? (
            <button
              type="button"
              className="crew-feed-more"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? "Show less" : "Show more"}
            </button>
          ) : null}
          {onUnpin ? (
            <button type="button" className="crew-feed-unpin" onClick={onUnpin}>
              Stop telling the crew this
            </button>
          ) : null}
        </div>
      </li>
    </>
  );
}

// ---------------------------------------------------------------------------
// The Ready card, opened with Review

/** The change, read from the crew's copy: what Apply lands is what this shows. */
function CrewDiff({
  path,
  crew,
  card,
}: {
  path: string;
  crew: Crew;
  card: CrewCard;
}) {
  const copy = crew.copy?.path;
  const fix = card.fix;
  const [files, setFiles] = useState<UnifiedDiffFileModel[] | null>(null);
  useEffect(() => {
    if (!copy || !fix) return;
    let live = true;
    void (async () => {
      const diff = await botCopyHost.diff(copy, fix.base);
      // The copy moved since its check: it is never shown as this card's
      // change. The card asks for another check instead.
      if (diff.hash !== fix.hash) {
        await markCrewFixChanged(path, card.id);
        return;
      }
      const models = await Promise.all(
        diff.files.slice(0, 30).map(async (file) => {
          const texts = await botCopyHost
            .fileDiff(copy, fix.base, file.path)
            .catch(() => null);
          const unreadable =
            !texts ||
            file.binary ||
            (texts.original == null && file.status !== "added") ||
            (texts.current == null && file.status !== "deleted");
          const unified = unreadable
            ? null
            : buildUnifiedFile(texts.original ?? "", texts.current ?? "");
          return {
            id: file.path,
            path: file.path,
            label: file.path,
            binary: file.binary,
            emptyMessage: unreadable
              ? "No text preview for this file."
              : undefined,
            additions: unified?.additions ?? file.additions,
            deletions: unified?.deletions ?? file.deletions,
            blocks: unified?.blocks ?? [],
          } satisfies UnifiedDiffFileModel;
        }),
      );
      if (live) setFiles(models);
    })().catch((error) => {
      logError("Crew review", error);
      if (live) setFiles([]);
    });
    return () => {
      live = false;
    };
  }, [path, copy, card.id, fix]);
  if (!files) return <p className="crew-sheet-note">Reading the change…</p>;
  if (!files.length)
    return <p className="crew-sheet-note">Couldn't read the change.</p>;
  return (
    <div className="crew-sheet-diff">
      <UnifiedDiffView
        files={files}
        fill={false}
        fileLayout="cards"
        initialExpansion="all"
      />
    </div>
  );
}

/**
 * The Ready card: what changed, what the Checker checked, notes for later
 * (each can become an idea), and Review, Apply and Send back. Your files
 * change only when you press Apply.
 */
export function CrewReadySheet({
  crew,
  cardId,
  names,
  onClose,
}: {
  crew: Crew;
  cardId: string;
  names: { builder: string; checker: string; security?: string };
  onClose: () => void;
}) {
  const card = crewCard(crew, cardId);
  const appearance = useProjectAppearance(crew.path);
  const workspace = useCrewWorkspace();
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [throwing, setThrowing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const checked = useMemo(() => {
    if (!card) return [];
    const last = card.rounds.find((round) => round.n === card.round)?.verdict;
    const earlier = card.rounds.find((round) => round.n === card.round - 1)
      ?.verdict?.mustFix.length;
    return [
      ...(last?.ran ?? []),
      ...(earlier
        ? [
            {
              command:
                earlier === 1
                  ? `The must-fix from round ${card.round - 1}`
                  : `${earlier === 2 ? "Both" : `All ${earlier}`} must-fixes from round ${card.round - 1}`,
              ok: true,
            },
          ]
        : []),
    ];
  }, [card]);
  /** Security's review of the same change, when the crew has Security. */
  const secured = useMemo(() => {
    if (!card) return null;
    const verdict = card.rounds.find(
      (round) => round.n === card.round,
    )?.security;
    if (!verdict) return null;
    const earlier = [...card.rounds]
      .filter((round) => round.n < card.round)
      .reverse()
      .find((round) => round.security?.mustFix.length)?.security
      ?.mustFix.length;
    return {
      verdict,
      ran: [
        ...verdict.ran,
        ...(earlier
          ? [
              {
                command:
                  earlier === 1
                    ? "Its earlier security must-fix"
                    : `All ${earlier} of its earlier security must-fixes`,
                ok: true,
              },
            ]
          : []),
      ],
    };
  }, [card]);
  if (!card || card.stage !== "ready") return null;
  const security = names.security ?? "Security";
  const minutes =
    card.startedAt && card.endedAt
      ? Math.max(1, Math.round((card.endedAt - card.startedAt) / 60_000))
      : null;
  const apply = async () => {
    // On the crew's branch: it lands from the batch's Review.
    if (card.stacked) {
      requestCrewReview(crew.path);
      onClose();
      return;
    }
    setBusy(true);
    setProblem(null);
    const error = await applyCrewCard(crew.path, card.id).catch((reason) =>
      errorText(reason),
    );
    setBusy(false);
    if (error) setProblem(error);
    else onClose();
  };
  /** Back to Ideas or Throw away: the sheet closes once it's done, or says why not. */
  const discard = async (then: "ideas" | "delete") => {
    setThrowing(false);
    setDiscarding(true);
    setProblem(null);
    const error = await discardCrewCard(crew.path, card.id, then).catch(
      (reason) => errorText(reason),
    );
    setDiscarding(false);
    if (error) setProblem(error);
    else onClose();
  };
  return (
    <Modal
      onClose={onClose}
      title={card.title}
      description={[
        secured
          ? `Passed ${names.checker}'s check and ${securityReviewBy(security)} in round ${card.round}`
          : `Passed ${names.checker}'s check in round ${card.round}`,
        minutes ? `${minutes} min` : "",
        plural(card.runs, "run"),
      ]
        .filter(Boolean)
        .join(" · ")}
      className="crew-sheet"
      leading={
        <CrewCritters
          path={crew.path}
          roles={
            secured
              ? ["builder", "checker", "security"]
              : ["builder", "checker"]
          }
        />
      }
      trailing={<CrewStatusPill status="ready" />}
    >
      <div className="crew-sheet-body" data-crew-ready={card.id}>
        {card.fix ? (
          <section className="crew-sheet-section">
            <h3>
              What changed · {plural(card.fix.files, "file")}{" "}
              <span className="crew-plus">+{card.fix.additions}</span>{" "}
              <span className="crew-minus">−{card.fix.deletions}</span>
            </h3>
            <ul className="crew-sheet-files">
              {card.fix.paths.map((entry) => (
                <li key={entry.path}>
                  <code>{entry.path}</code>
                  <span>
                    <span className="crew-plus">+{entry.additions}</span>{" "}
                    <span className="crew-minus">−{entry.deletions}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {checked.length ? (
          <section className="crew-sheet-section">
            <h3>What {names.checker} checked</h3>
            <ul className="crew-sheet-checks">
              {checked.map((ran, index) => (
                <li key={index} data-ok={ran.ok || undefined}>
                  <span className="crew-check-mark" aria-hidden="true">
                    {ran.ok ? "✓" : "×"}
                  </span>
                  <span>
                    {ran.command}
                    {"note" in ran && ran.note ? ` · ${ran.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {secured ? (
          <section className="crew-sheet-section" data-crew-security-check>
            <h3>Security: passed · what {security} checked</h3>
            <ul className="crew-sheet-checks">
              {(secured.ran.length
                ? secured.ran
                : [{ command: "Read the change", ok: true }]
              ).map((ran, index) => (
                <li key={index} data-ok={ran.ok || undefined}>
                  <span className="crew-check-mark" aria-hidden="true">
                    {ran.ok ? "✓" : "×"}
                  </span>
                  <span>
                    {ran.command}
                    {"note" in ran && ran.note ? ` · ${ran.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {card.later.length ? (
          <section className="crew-sheet-section">
            <h3>For later</h3>
            <ul className="crew-sheet-later">
              {card.later.map((note) => (
                <li key={note}>
                  <span>{note}</span>
                  <TeamCardButton
                    size="compact"
                    disabled={added.has(note)}
                    onClick={() => {
                      void addFeatureIdea(crew.path, { title: note });
                      setAdded((current) => new Set([...current, note]));
                    }}
                  >
                    {added.has(note) ? "Added" : "Add as idea"}
                  </TeamCardButton>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {reviewing ? (
          <CrewDiff path={crew.path} crew={crew} card={card} />
        ) : null}
        {sending !== null ? (
          <form
            className="crew-sheet-send"
            onSubmit={(event) => {
              event.preventDefault();
              resumeCrewCard(crew.path, card.id, sending);
              onClose();
            }}
          >
            <textarea
              className="work-board-input"
              aria-label={`What should ${names.builder} change?`}
              placeholder={`What should ${names.builder} change?`}
              rows={2}
              autoFocus
              maxLength={500}
              value={sending}
              onChange={(event) => setSending(event.target.value)}
            />
            <div className="work-board-edit-actions">
              <TeamCardButton
                size="compact"
                variant="ghost"
                onClick={() => setSending(null)}
              >
                Cancel
              </TeamCardButton>
              <TeamCardButton
                size="compact"
                variant="primary"
                type="submit"
                disabled={!sending.trim()}
              >
                Send back
              </TeamCardButton>
            </div>
          </form>
        ) : null}
        {throwing ? (
          <div
            className="crew-sheet-send"
            role="group"
            aria-label="Throw this card away?"
            data-crew-throw-confirm
          >
            <p className="crew-sheet-small">
              The crew's work on “{card.title}” is thrown away and the card
              leaves the board. Your files stay as they are.
            </p>
            <div className="work-board-edit-actions">
              <TeamCardButton
                size="compact"
                variant="ghost"
                onClick={() => setThrowing(false)}
              >
                Keep it
              </TeamCardButton>
              <TeamCardButton
                size="compact"
                variant="primary"
                disabled={discarding}
                onClick={() => void discard("delete")}
              >
                Throw away
              </TeamCardButton>
            </div>
          </div>
        ) : null}
        {problem || card.error ? (
          <p className="crew-sheet-problem" role="alert">
            {problem ?? card.error}
          </p>
        ) : null}
        <footer className="crew-sheet-foot">
          <span className="crew-sheet-small">
            Applies to your files only when you press Apply.{" "}
            {appearance?.label
              ? `Shipping ${appearance.label} stays yours.`
              : ""}
          </span>
          <div className="crew-sheet-actions">
            <TeamCardButton
              onClick={() => setSending(sending === null ? "" : null)}
            >
              Send back…
            </TeamCardButton>
            <TeamCardButton
              variant="ghost"
              aria-label="More for this card"
              aria-haspopup="menu"
              onClick={(event) => setMenu(menu ? null : event.currentTarget)}
            >
              <MoreHorizontal size={14} />
            </TeamCardButton>
            <TeamCardButton
              aria-expanded={reviewing}
              onClick={() => setReviewing((open) => !open)}
            >
              {reviewing ? "Hide" : "Review"}
            </TeamCardButton>
            <TeamCardButton
              variant="primary"
              disabled={busy || discarding}
              onClick={() => void apply()}
            >
              {busy ? "Applying…" : "Apply"}
            </TeamCardButton>
          </div>
        </footer>
      </div>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel="More for this card"
          items={[
            { kind: "item", id: "take-over", label: "Take over in a chat" },
            { kind: "item", id: "ideas", label: "Back to Ideas" },
            { kind: "item", id: "throw", label: "Throw away", danger: true },
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "take-over") {
              // Its Builder's chat, in the crew's copy, where you can finish it yourself.
              workspace?.openChat(crew.path, card.builderId ?? "builder");
              onClose();
              return;
            }
            // Throwing the work away asks first, as on the Board.
            if (id === "throw") setThrowing(true);
            else void discard("ideas");
          }}
        />
      ) : null}
    </Modal>
  );
}
