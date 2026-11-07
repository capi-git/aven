import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ChevronDown, MoreHorizontal, X } from "../chrome/icons";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  previewedFiles,
  useCrewBatchReview,
} from "../hooks/useCrewBatchReview";
import { useReviewPictures } from "../hooks/useReviewPictures";
import {
  askWithNotes,
  PICTURE_NOTES_MAX,
  reviewChecks,
  reviewPages,
  reviewRows,
  reviewSpots,
  type PictureNote,
} from "../lib/avosReview";
import {
  applyCrewBatch,
  askAvosForChanges,
  dropStackedCard,
  openCrewBatchPr,
  stopCrewTry,
  tryCrewBatch,
} from "../lib/crewActions";
import { reviewFileNotes } from "../lib/crewPipeline";
import { cardInCopy, type Crew, type CrewSpot } from "../lib/crews";
import { errorText } from "../lib/errors";
import { gitDiffIndex } from "../lib/fs";
import type { BotDiff } from "../lib/projectBotCopy";
import { openInAppUrl } from "../lib/inAppLinks";
import {
  pageAddress,
  partAt,
  type PagePicture,
  type PictureBox,
  type PictureSize,
} from "../lib/pagePictures";
import { pictureChanges } from "../lib/pictureChanges";
import { IS_MAC } from "../lib/platform";
import { plural } from "../lib/words";
import { UnifiedDiffView } from "./UnifiedDiffView";
import "./AvosReview.css";

/**
 * Avos's finished work, reviewed beside its chat (14A of the Avos mocks):
 * one header naming the work, then What changed (a row for each card, in
 * the order it was built, with what its checks did) and the code. At the
 * bottom you ask Avos for changes in your own words, or Apply, whose ⌄
 * sends it as a pull request instead. Both land exactly the change shown.
 */
export function AvosReview({
  crew,
  project,
  onClose,
}: {
  crew: Crew;
  project: string;
  onClose: () => void;
}) {
  const [upTo, setUpTo] = useState<string | undefined>();
  const { review, files, problem, setProblem, rereading, shown, order } =
    useCrewBatchReview(crew, project, upTo);
  const [busy, setBusy] = useState<
    "apply" | "pr" | "ask" | "drop" | "try" | null
  >(null);
  const [ask, setAsk] = useState("");
  const [menu, setMenu] = useState<{
    which: "more" | "apply";
    at: HTMLElement;
  } | null>(null);
  // A pull request needs somewhere to go: offered only with a remote.
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    let live = true;
    void gitDiffIndex(project)
      .then((index) => {
        if (live) setRemote(!!index.remote);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project]);
  const close = useRef(onClose);
  close.current = onClose;
  // Escape closes the Review, as it would a sheet.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role='menu']")) return;
      close.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const included = upTo
    ? order.slice(0, order.findIndex((card) => card.id === upTo) + 1)
    : order;
  // A change to what people see is pictured: Look first, then the code.
  // Picturing runs Avos's version, which only a Mac can do for now.
  const pages = IS_MAC ? reviewPages(included) : [];
  const [tab, setTab] = useState<"look" | "code">("look");
  const look = tab === "look" && pages.length > 0;
  const [size, setSize] = useState<PictureSize>("phone");
  // What each page's Builder said it changed, numbered on its pictures.
  const spots = Object.fromEntries(
    pages.map((page) => [page, reviewSpots(included, page)]),
  );
  const marks = Object.fromEntries(
    pages.map((page) => [page, spots[page].map((spot) => spot.element)]),
  );
  // Notes you left by clicking Avos's version, sent when you ask.
  const [notes, setNotes] = useState<PictureNote[]>([]);
  // The change you asked to run Avos's version of (Run, or Try it): it
  // never starts by itself.
  const [ranFor, setRanFor] = useState<string | undefined>();
  const pictures = useReviewPictures({
    project,
    active: look && shown,
    run: !!review && ranFor === review.to,
    to: shown ? review?.to : undefined,
    hash: shown ? review?.diff.hash : undefined,
    pages,
    marks,
    size,
  });
  // Avos's copy runs only once you ask: for pictures while this is open,
  // or after Try it until its change lands or Avos works again.
  const tried = useRef(false);
  useEffect(
    () => () => {
      if (!tried.current) void stopCrewTry(project);
    },
    [project],
  );
  const rows = reviewRows(order);
  const single = order.length === 1 ? order[0] : undefined;
  const title = single ? single.title : plural(order.length, "change");
  const last = order.at(-1);
  const building = cardInCopy(crew);
  // A job still being built or checked in Avos's copy: running or taking
  // its work waits until that's checked, so the buttons wait too.
  const copyBusy =
    building?.stage === "building" || building?.stage === "checking";

  const apply = async () => {
    if (!review || !shown) return;
    setBusy("apply");
    setProblem(null);
    // Exactly the change shown here: its last commit and fingerprint.
    const why = await applyCrewBatch(project, {
      to: review.to,
      hash: review.diff.hash,
      reviewed: true,
    }).catch((error) => errorText(error));
    setBusy(null);
    if (why) return setProblem(why);
    void stopCrewTry(project);
    onClose();
  };
  const tryIt = async () => {
    if (!review || !shown) return;
    setBusy("try");
    setProblem(null);
    const run = await tryCrewBatch(project, {
      to: review.to,
      hash: review.diff.hash,
    }).catch((error) => ({ error: errorText(error) }));
    setBusy(null);
    if ("error" in run) return setProblem(run.error);
    tried.current = true;
    setRanFor(review.to);
    void openInAppUrl(pageAddress(run.url, pages[0] ?? "/")).catch(() => {});
  };
  const sendPr = async () => {
    if (!review || !shown) return;
    setBusy("pr");
    setProblem(null);
    const sent = await openCrewBatchPr(project, {
      to: review.to,
      hash: review.diff.hash,
    }).catch((error) => ({ error: errorText(error) }));
    setBusy(null);
    if ("error" in sent) return setProblem(sent.error);
    void stopCrewTry(project);
    onClose();
    void openInAppUrl(sent.url).catch(() => {});
  };
  const askForChanges = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!ask.trim() && !notes.length)) return;
    const words = askWithNotes(ask, notes);
    if (!words)
      return setProblem(
        notes.length
          ? "That's too much for one ask: remove a note or say it in fewer words."
          : "That's too much for one ask: say it in fewer words.",
      );
    setBusy("ask");
    setProblem(null);
    const why = await askAvosForChanges(
      project,
      words,
      included.map((card) => card.title),
    ).catch((error) => errorText(error));
    setBusy(null);
    if (why) return setProblem(why);
    setAsk("");
    setNotes([]);
    onClose();
  };
  const drop = async () => {
    if (!last) return;
    setBusy("drop");
    setProblem(null);
    const why = await dropStackedCard(project, last.id, "ideas").catch(
      (error) => errorText(error),
    );
    setBusy(null);
    if (why) setProblem(why);
    else if (order.length <= 1) onClose();
    else setUpTo(undefined);
  };

  const moreItems: ExplorerMenuItem[] = last
    ? [
        {
          kind: "item",
          id: "drop",
          label: single ? "Take it off the branch" : `Take “${last.title}” off`,
          disabled: !!busy || !!building,
          ...(building
            ? { description: `“${building.title}” builds on top of it` }
            : {}),
        },
      ]
    : [];
  const applyItems: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "pr",
      label: "Open a pull request",
      description: "Your files stay as they are",
      disabled: !!busy || !shown,
    },
  ];
  const applyLabel =
    busy === "apply"
      ? "Applying…"
      : busy === "pr"
        ? "Opening…"
        : upTo
          ? `Apply ${included.length} of ${order.length}`
          : "Apply";

  return (
    <aside
      className="avos-review"
      aria-label={`Review: ${title}`}
      data-avos-review
      data-crew-batch-review
    >
      <header className="avos-review-head">
        <h2 className="avos-review-title" title={title}>
          {title}
        </h2>
        {moreItems.length ? (
          <button
            type="button"
            className="avos-review-icon"
            aria-label="More for this review"
            aria-haspopup="menu"
            aria-expanded={menu?.which === "more"}
            onClick={(event) =>
              setMenu(
                menu?.which === "more"
                  ? null
                  : { which: "more", at: event.currentTarget },
              )
            }
          >
            <MoreHorizontal size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="avos-review-icon"
          aria-label="Close the review"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </header>
      {pages.length ? (
        <div className="avos-review-tabs" role="tablist">
          {(["look", "code"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="avos-review-tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {id === "look" ? "Look" : "Code"}
            </button>
          ))}
          {look ? (
            <div className="avos-review-sizes" aria-label="Picture size">
              {(["phone", "desktop"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={size === id}
                  onClick={() => setSize(id)}
                >
                  {id === "phone" ? "Phone" : "Desktop"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="avos-review-body">
        <section className="avos-review-section" data-avos-review-changes>
          <h3>What changed</h3>
          <ol className="avos-review-rows">
            {rows.map((row, index) => {
              const shownRow =
                !upTo || order.findIndex((card) => card.id === upTo) >= index;
              return (
                <li
                  key={row.id}
                  className="avos-review-row"
                  data-left-out={!shownRow || undefined}
                >
                  {rows.length > 1 ? (
                    <span className="avos-review-num" aria-hidden="true">
                      {index + 1}
                    </span>
                  ) : null}
                  <span className="avos-review-row-text">
                    <span className="avos-review-row-title">{row.title}</span>
                    {row.line ? (
                      <span className="avos-review-row-line">{row.line}</span>
                    ) : null}
                  </span>
                  {order.length > 1 && index < order.length - 1 ? (
                    <button
                      type="button"
                      className="avos-review-upto"
                      aria-pressed={upTo === row.id}
                      onClick={() =>
                        setUpTo(upTo === row.id ? undefined : row.id)
                      }
                    >
                      {upTo === row.id ? "All of them" : "Only up to here"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className="avos-review-checks">{reviewChecks(included)}</p>
        </section>
        {look ? (
          <section className="avos-review-section" data-avos-review-look>
            {pictures.status === "idle" ? (
              <div className="avos-review-run">
                <TeamCardButton
                  data-avos-review-run
                  disabled={!!busy || !shown}
                  title="Run Avos's version here to picture the pages it changed"
                  onClick={() => setRanFor(review?.to)}
                >
                  Run Avos's version
                </TeamCardButton>
              </div>
            ) : pictures.status === "starting" ? (
              <p className="avos-review-note" role="status">
                Starting Avos's version…
              </p>
            ) : pictures.status === "failed" ? (
              <p className="avos-review-note" role="status">
                No pictures: {pictures.problem}
              </p>
            ) : (
              pages.map((page) => (
                <ReviewPairView
                  key={page}
                  page={page}
                  named={pages.length > 1}
                  size={size}
                  pair={pictures.pairs[page]}
                  noBefore={!!pictures.noBefore}
                  spots={spots[page]}
                  notes={notes.filter(
                    (note) => note.page === page && note.size === size,
                  )}
                  canNote={notes.length < PICTURE_NOTES_MAX}
                  onNote={(note) => setNotes((all) => [...all, note])}
                />
              ))
            )}
            {notes.length ? (
              <div className="avos-review-notes" data-avos-review-notes>
                <h3>Your notes</h3>
                <ol>
                  {notes.map((note, index) => (
                    <li key={index}>
                      <span className="avos-review-note-text">
                        <span>{note.text}</span>
                        <span className="avos-review-row-line">
                          {[
                            note.page,
                            note.size === "phone" ? "Phone" : "Desktop",
                            note.what,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="avos-review-icon"
                        aria-label={`Remove the note “${note.text}”`}
                        onClick={() =>
                          setNotes((all) => all.filter((n) => n !== note))
                        }
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {pictures.noBefore &&
            (pictures.status === "working" || pictures.status === "ready") ? (
              <p className="avos-review-note">
                Start your app to see how it looked before.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="avos-review-section" data-avos-review-code>
            <h3>Code</h3>
            {review &&
            review.diff.files.some((file) => notListed(file, review.diff)) ? (
              <ul className="avos-review-files" data-crew-batch-files>
                {review.diff.files
                  .filter((file) => notListed(file, review.diff))
                  .map((file) => {
                    const notes = reviewFileNotes(file);
                    return (
                      <li
                        key={file.path}
                        data-flagged={notes.length || undefined}
                      >
                        <span className="avos-review-file">{file.path}</span>
                        <span className="avos-review-file-meta">
                          {[file.status, ...notes].join(" · ")}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            ) : null}
            {files ? (
              files.length ? (
                <UnifiedDiffView
                  files={files}
                  fill={false}
                  fileLayout="cards"
                  initialExpansion="all"
                />
              ) : (
                <p className="avos-review-note">Couldn't read the change.</p>
              )
            ) : (
              <p className="avos-review-note" role="status">
                {rereading
                  ? "Avos's branch changed: reading it again"
                  : "Reading the change…"}
              </p>
            )}
          </section>
        )}
      </div>
      {problem ? (
        <p className="avos-review-problem" role="alert">
          {problem}
        </p>
      ) : copyBusy ? (
        <p className="avos-review-wait" role="status" data-avos-review-wait>
          Avos is still working in its copy. You can try or apply this once
          that's checked.
        </p>
      ) : null}
      <footer className="avos-review-foot">
        <form className="avos-review-ask" onSubmit={askForChanges}>
          <input
            type="text"
            value={ask}
            maxLength={2000}
            disabled={busy === "ask"}
            placeholder={
              notes.length
                ? `Send ${plural(notes.length, "note")} to Avos, or add more…`
                : "Ask Avos for changes…"
            }
            aria-label="Ask Avos for changes"
            onChange={(event) => setAsk(event.target.value)}
          />
        </form>
        {IS_MAC ? (
          <TeamCardButton
            className="avos-review-try"
            disabled={!!busy || !shown || copyBusy}
            title="Run Avos's version and open it in a browser tab"
            onClick={() => void tryIt()}
          >
            {busy === "try" ? "Starting…" : "Try it"}
          </TeamCardButton>
        ) : null}
        <div className="avos-review-apply">
          <TeamCardButton
            variant="primary"
            className="avos-review-apply-main"
            data-avos-review-apply
            disabled={!!busy || !shown || copyBusy}
            onClick={() => void apply()}
          >
            {applyLabel}
          </TeamCardButton>
          {remote ? (
            <TeamCardButton
              variant="primary"
              className="avos-review-apply-more"
              aria-label="Other ways to take it"
              aria-haspopup="menu"
              aria-expanded={menu?.which === "apply"}
              disabled={!!busy || copyBusy}
              onClick={(event) =>
                setMenu(
                  menu?.which === "apply"
                    ? null
                    : { which: "apply", at: event.currentTarget },
                )
              }
            >
              <ChevronDown size={12} />
            </TeamCardButton>
          ) : null}
        </div>
      </footer>
      {menu ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={menu.at}
          side={menu.which === "apply" ? "top" : "bottom"}
          align="end"
          gap={4}
          ariaLabel={
            menu.which === "apply" ? "Other ways to take it" : "Review"
          }
          items={menu.which === "apply" ? applyItems : moreItems}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "pr") void sendPr();
            else if (id === "drop") void drop();
          }}
        />
      ) : null}
    </aside>
  );
}

/**
 * A file the code below doesn't show line by line (a binary file, a link,
 * one past the first few dozen), or one to look out for (a link, a file
 * that becomes a program): it's named on its own, with what it is.
 */
function notListed(file: BotDiff["files"][number], diff: BotDiff): boolean {
  if (reviewFileNotes(file).length) return true;
  return !previewedFiles(diff).includes(file);
}

/** A spot on a picture: its number and where it is. */
type ShownSpot = { number: number; box: PictureBox };

/**
 * One page's before and after, at the chosen size, side by side. What
 * changed is numbered on Avos's version: the spots its Builder named,
 * listed underneath, or else where it looks different from before.
 * Clicking Avos's version leaves Avos a note about what's there.
 */
function ReviewPairView({
  page,
  named,
  size,
  pair,
  noBefore,
  spots,
  notes,
  canNote,
  onNote,
}: {
  page: string;
  /** Name the page: there's more than one. */
  named: boolean;
  size: PictureSize;
  pair: { before: PagePicture | null; after: PagePicture | null } | undefined;
  noBefore: boolean;
  spots: readonly CrewSpot[];
  notes: readonly PictureNote[];
  canNote: boolean;
  onNote: (note: PictureNote) => void;
}) {
  const after = pair?.after;
  const before = pair?.before;
  // With no spots named, where it looks different (when there's a before).
  const [changes, setChanges] = useState<PictureBox[]>([]);
  useEffect(() => {
    setChanges([]);
    if (spots.length || !before || !after) return;
    let live = true;
    void pictureChanges(before, after)
      .then((boxes) => {
        if (live) setChanges(boxes);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [before, after, spots.length]);
  const shownSpots: ShownSpot[] = spots.length
    ? spots.flatMap((_, index) => {
        const box = after?.spots?.[index];
        return box ? [{ number: index + 1, box }] : [];
      })
    : changes.map((box, index) => ({ number: index + 1, box }));
  const [draft, setDraft] = useState<{
    at: [number, number];
    what?: string;
    element?: string;
  } | null>(null);
  const [text, setText] = useState("");
  useEffect(() => setDraft(null), [size, after]);
  const saveNote = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!draft || !words) return;
    onNote({
      page,
      size,
      text: words.slice(0, 500),
      at: draft.at,
      ...(draft.what ? { what: draft.what } : {}),
      ...(draft.element ? { element: draft.element } : {}),
    });
    setDraft(null);
    setText("");
  };
  const place = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!after || !canNote) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // From the keyboard there's no point: the middle, and nothing named.
    const keyboard = event.detail === 0;
    const x = keyboard ? 0.5 : (event.clientX - rect.left) / rect.width;
    const y = keyboard ? 0.5 : (event.clientY - rect.top) / rect.height;
    const part = keyboard ? undefined : partAt(after.parts, x, y);
    setDraft({
      at: [x, y],
      ...(part ? { what: part.what, element: part.element } : {}),
    });
    setText("");
  };
  const picture = (
    shot: PagePicture | null | undefined,
    label: string,
    mine: boolean,
  ) => (
    <figure className="avos-review-figure" data-size={size}>
      {shot ? (
        <div className="avos-review-shot">
          <img src={shot.src} alt={`${label}${named ? ` of ${page}` : ""}`} />
          {mine ? (
            <>
              {shownSpots.map((spot) => (
                <span
                  key={spot.number}
                  className="avos-review-spot"
                  data-avos-review-spot={spot.number}
                  style={boxStyle(spot.box)}
                  aria-hidden="true"
                >
                  <span className="avos-review-spot-num">{spot.number}</span>
                </span>
              ))}
              {[
                ...notes.map((note) => note.at),
                ...(draft ? [draft.at] : []),
              ].map((at, index) =>
                at ? (
                  <span
                    key={index}
                    className="avos-review-pin"
                    data-draft={(draft && index === notes.length) || undefined}
                    style={{ left: `${at[0] * 100}%`, top: `${at[1] * 100}%` }}
                    aria-hidden="true"
                  />
                ) : null,
              )}
              <button
                type="button"
                className="avos-review-shot-hit"
                data-avos-review-note-here
                disabled={!canNote}
                aria-label={`Leave Avos a note on ${label}`}
                title={canNote ? "Click to leave Avos a note here" : undefined}
                onClick={place}
              />
            </>
          ) : null}
        </div>
      ) : (
        <span className="avos-review-shot-wait" role="status">
          {shot === null ? "No picture" : "Taking the picture…"}
        </span>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
  return (
    <div className="avos-review-page">
      {named ? <h3>{page}</h3> : null}
      <div className="avos-review-pair">
        {noBefore ? null : picture(before, "Before", false)}
        {picture(after, noBefore ? "Avos's version" : "After", true)}
      </div>
      {draft ? (
        <form className="avos-review-draft" onSubmit={saveNote}>
          <input
            type="text"
            autoFocus
            value={text}
            maxLength={200}
            placeholder={
              draft.what ? `Note on the ${draft.what}…` : "Note for Avos…"
            }
            aria-label="Note for Avos"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Escape puts the note away, not the Review.
              event.preventDefault();
              setDraft(null);
            }}
          />
        </form>
      ) : null}
      {spots.length ? (
        <ol className="avos-review-spots" data-avos-review-spots>
          {spots.map((spot, index) => (
            <li
              key={index}
              data-missing={(after && !after.spots?.[index]) || undefined}
            >
              <span className="avos-review-num" aria-hidden="true">
                {index + 1}
              </span>
              <span>{spot.note}</span>
            </li>
          ))}
        </ol>
      ) : shownSpots.length ? (
        <p className="avos-review-note">
          Numbers mark where it looks different.
        </p>
      ) : null}
      {after && canNote && !draft ? (
        <p className="avos-review-note">
          Click {noBefore ? "the picture" : "After"} to leave Avos a note.
        </p>
      ) : null}
    </div>
  );
}

function boxStyle([left, top, width, height]: PictureBox) {
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}
