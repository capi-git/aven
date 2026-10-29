import { memo, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CrewCritter,
  CrewCritters,
  CrewRoundDots,
  CrewStatusPill,
} from "../chrome/CrewCritter";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ArrowUp, MoreHorizontal, Pause, Play } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { claudeWeeklyUsed } from "../hooks/useProjectBots";
import {
  allowMoreRunsToday,
  applyCrewCard,
  discardCrewCard,
  refreshCrewFix,
  resumeCrewCard,
  setCrewPaused,
  stopCrewNow,
  tellCrew,
  turnOffCrew,
  useCrewWorkspace,
} from "../lib/crewActions";
import { crewGate, crewLimitsLine } from "../lib/crewLimits";
import {
  CREW_ROLE_INFO,
  cardInCopy,
  crewMembers,
  crewCard,
  queuedCards,
  updateCrew,
  withoutNote,
  type Crew,
  type CrewCard,
  type CrewFeedEntry,
  type CrewRole,
} from "../lib/crews";
import type { CrewBoardInfo, CrewMemberView } from "../lib/crewView";
import { errorText, logError } from "../lib/errors";
import { addFeatureIdea } from "../lib/featureCards";
import { botCopyHost } from "../lib/projectBotCopy";
import { buildUnifiedFile } from "../lib/unifiedDiff";
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

/** The header: critters, "aven-site crew", its limits line, Pause and ⋯. */
export const CrewHeader = memo(function CrewHeader({
  crew,
  now,
  fixerRuns,
}: {
  crew: Crew;
  now: number;
  fixerRuns: number;
}) {
  const labels = useProjectLabels();
  const workspace = useCrewWorkspace();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const name = projectDisplayName(crew.path, labels);
  const roles = crewMembers(crew)
    .filter((member) => member.role !== "fixer" || fixerRuns >= 0)
    .map((member) => member.role);
  const gate = crewGate({
    crew,
    now,
    weeklyUsed: claudeWeeklyUsed(now),
    fixerRuns,
    allRuns: 0,
  });
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "stop", label: "Stop now" },
    ...(!gate.ok && gate.reason === "daily-cap"
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    { kind: "item", id: "settings", label: "Settings…" },
    { kind: "sep" },
    { kind: "item", id: "off", label: "Turn the crew off" },
  ];
  return (
    <header
      className="work-board-header crew-header"
      data-crew-header={crew.path}
    >
      <CrewCritters
        path={crew.path}
        roles={roles}
        max={5}
        className="crew-header-critters"
      />
      <div className="work-board-heading">
        <h1>{name} crew</h1>
        <p className="work-board-today" data-crew-limits>
          {crewLimitsLine(crew, now, fixerRuns)}
        </p>
      </div>
      <div className="crew-header-actions">
        <TeamCardButton
          onClick={() => setCrewPaused(crew.path, !crew.paused)}
          title={crew.paused ? "Resume the crew" : "Pause the crew"}
        >
          {crew.paused ? (
            <Play className="size-3" />
          ) : (
            <Pause className="size-3" />
          )}
          <span>{crew.paused ? "Resume" : "Pause"}</span>
        </TeamCardButton>
        <TeamCardButton
          variant="ghost"
          aria-label="More for the crew"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(event) => setMenu(menu ? null : event.currentTarget)}
        >
          <MoreHorizontal size={14} />
        </TeamCardButton>
      </div>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu}
          align="end"
          gap={4}
          ariaLabel={`${name} crew actions`}
          items={items}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "stop") void stopCrewNow(crew.path);
            else if (id === "more") allowMoreRunsToday(crew.path);
            else if (id === "settings") workspace?.openSettings(crew.path);
            else if (id === "off") void turnOffCrew(crew.path);
          }}
        />
      ) : null}
    </header>
  );
});

/**
 * Why the crew holds, when a limit (or you) holds it and work waits: what
 * holds it, what happens next, what waits, and a way on.
 */
export function CrewHoldLine({
  crew,
  now,
  fixerRuns,
}: {
  crew: Crew;
  now: number;
  fixerRuns: number;
}) {
  const gate = crewGate({
    crew,
    now,
    weeklyUsed: claudeWeeklyUsed(now),
    fixerRuns,
    allRuns: 0,
  });
  if (gate.ok) return null;
  const waiting = cardInCopy(crew) ?? queuedCards(crew)[0];
  if (!waiting && gate.reason !== "paused") return null;
  const waits = waiting
    ? ` ${waiting.title} waits in ${waiting.stage === "ready" ? "Review" : "Building"}.`
    : "";
  return (
    <div className="crew-hold" role="status" data-crew-hold={gate.reason}>
      <Pause className="size-3.5 crew-hold-icon" />
      <div className="crew-hold-text">
        <strong>{gate.title}</strong>
        <span>
          {gate.detail}
          {waits}
        </span>
      </div>
      {gate.reason === "daily-cap" ? (
        <TeamCardButton
          size="compact"
          onClick={() => allowMoreRunsToday(crew.path)}
        >
          Allow 10 more today
        </TeamCardButton>
      ) : gate.reason === "paused" ? (
        <TeamCardButton
          size="compact"
          onClick={() => setCrewPaused(crew.path, false)}
        >
          Resume
        </TeamCardButton>
      ) : null}
    </div>
  );
}

/** The crew's bots, one tile each: critter, name, role, word and one live line. */
export function CrewStrip({
  path,
  members,
}: {
  path: string;
  members: readonly CrewMemberView[];
}) {
  const workspace = useCrewWorkspace();
  return (
    <div className="crew-strip" role="list" aria-label="The crew">
      {members.map((member) => (
        <button
          key={member.role}
          type="button"
          role="listitem"
          className="crew-strip-tile"
          data-crew-tile={member.role}
          data-working={member.active || undefined}
          title={`Open ${member.name}'s chat`}
          onClick={() => workspace?.openChat(path, member.role)}
        >
          <CrewCritter
            path={path}
            role={member.role}
            active={member.active}
            className="crew-strip-critter"
          />
          <span className="crew-strip-text">
            <span className="crew-strip-name">
              <strong>{member.name}</strong>
              <span className="crew-strip-role">{member.roleLabel}</span>
              {member.status ? <CrewStatusPill status={member.status} /> : null}
            </span>
            <span className="crew-strip-line">
              {member.line ?? CREW_ROLE_INFO[member.role].job}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
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

function whoName(
  entry: CrewFeedEntry,
  name: (role: CrewRole) => string,
): string {
  if (entry.who === "you") return "You";
  if (entry.who === "aven" || !entry.who) return "Aven";
  return name(entry.who);
}

function FeedMark({ path, entry }: { path: string; entry: CrewFeedEntry }) {
  if (entry.who && entry.who !== "you" && entry.who !== "aven")
    return <CrewCritter path={path} role={entry.who} badge={false} />;
  return (
    <span className="crew-feed-you" aria-hidden="true">
      {entry.who === "you" ? "Y" : "A"}
    </span>
  );
}

const QUOTED = new Set(["handoff", "verdict", "note", "stuck"]);

/**
 * The crew's feed: handoffs, verdicts, new ideas, holds and your notes, the
 * newest last, and the Tell the crew box. What you tell the crew is kept as
 * standing guidance every bot reads at its next turn.
 */
export function CrewFeed({
  crew,
  name,
}: {
  crew: Crew;
  name: (role: CrewRole) => string;
}) {
  const [text, setText] = useState("");
  const entries = crew.feed.slice(-40);
  const standing = new Set(crew.notes.map((note) => note.text));
  const today = new Date().toDateString();
  let lastDay = "";
  return (
    <section
      className="work-board-column crew-feed"
      aria-label="Feed"
      data-crew-feed
    >
      <h2 className="work-board-column-title">
        <span>Feed</span>
      </h2>
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
              entry.kind === "note" &&
              entry.who === "you" &&
              standing.has(entry.text)
                ? crew.notes.find((item) => item.text === entry.text)
                : undefined;
            return (
              <FeedRow
                key={entry.id}
                divider={divider}
                path={crew.path}
                entry={entry}
                who={whoName(entry, name)}
                to={entry.to ? name(entry.to) : undefined}
                pinned={!!note}
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
      <form
        className="crew-tell"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          tellCrew(crew.path, text);
          setText("");
        }}
      >
        <input
          className="work-board-input crew-tell-input"
          type="text"
          placeholder="Tell the crew…"
          aria-label="Tell the crew"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          className="crew-tell-send"
          aria-label="Send to the crew"
          disabled={!text.trim()}
        >
          <ArrowUp className="size-3.5" />
        </button>
      </form>
    </section>
  );
}

function FeedRow({
  divider,
  path,
  entry,
  who,
  to,
  pinned,
  onUnpin,
}: {
  divider: React.ReactNode;
  path: string;
  entry: CrewFeedEntry;
  who: string;
  to?: string;
  pinned: boolean;
  onUnpin?: () => void;
}) {
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
        <FeedMark path={path} entry={entry} />
        <div className="crew-feed-body">
          <p className="crew-feed-head">
            <span className="crew-feed-who">{headline}</span>
            <time className="crew-feed-time">{clock(entry.at)}</time>
          </p>
          {entry.kind === "ready" ? (
            <p className="crew-feed-ready">Ready for you</p>
          ) : quoted ? (
            <p className="crew-feed-quote">{entry.text}</p>
          ) : (
            <p className="crew-feed-text">{entry.text}</p>
          )}
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
      // The copy moved since the card was made: record what is there now.
      if (diff.hash !== fix.hash) {
        await refreshCrewFix(path, card.id);
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
  names: { builder: string; checker: string };
  onClose: () => void;
}) {
  const card = crewCard(crew, cardId);
  const appearance = useProjectAppearance(crew.path);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<HTMLElement | null>(null);
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
  if (!card || card.stage !== "ready") return null;
  const minutes =
    card.startedAt && card.endedAt
      ? Math.max(1, Math.round((card.endedAt - card.startedAt) / 60_000))
      : null;
  const apply = async () => {
    setBusy(true);
    setProblem(null);
    const error = await applyCrewCard(crew.path, card.id).catch((reason) =>
      errorText(reason),
    );
    setBusy(false);
    if (error) setProblem(error);
    else onClose();
  };
  return (
    <Modal
      onClose={onClose}
      title={card.title}
      description={[
        `Passed ${names.checker}'s check in round ${card.round}`,
        minutes ? `${minutes} min` : "",
        plural(card.runs, "run"),
      ]
        .filter(Boolean)
        .join(" · ")}
      className="crew-sheet"
      leading={<CrewCritters path={crew.path} roles={["builder", "checker"]} />}
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
              disabled={busy}
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
            { kind: "item", id: "ideas", label: "Back to Ideas" },
            { kind: "item", id: "throw", label: "Throw away", danger: true },
          ]}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            void discardCrewCard(
              crew.path,
              card.id,
              id === "ideas" ? "ideas" : "delete",
            );
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}
