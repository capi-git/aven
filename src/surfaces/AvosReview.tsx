import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { ChevronDown, MoreHorizontal, X } from "../chrome/icons";
import { TeamCardButton } from "../chrome/TeamCard";
import {
  previewedFiles,
  useCrewBatchReview,
} from "../hooks/useCrewBatchReview";
import { useReviewPictures } from "../hooks/useReviewPictures";
import { reviewChecks, reviewPages, reviewRows } from "../lib/avosReview";
import {
  applyCrewBatch,
  askAvosForChanges,
  dropStackedCard,
  openCrewBatchPr,
  stopCrewTry,
  tryCrewBatch,
} from "../lib/crewActions";
import { reviewFileNotes } from "../lib/crewPipeline";
import { cardInCopy, type Crew } from "../lib/crews";
import { errorText } from "../lib/errors";
import { gitDiffIndex } from "../lib/fs";
import type { BotDiff } from "../lib/projectBotCopy";
import { openInAppUrl } from "../lib/inAppLinks";
import {
  pageAddress,
  type PagePicture,
  type PictureSize,
} from "../lib/pagePictures";
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
    const words = ask.trim();
    if (!words || busy) return;
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
                  page={pages.length > 1 ? page : undefined}
                  size={size}
                  pair={pictures.pairs[page]}
                  noBefore={!!pictures.noBefore}
                />
              ))
            )}
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
      ) : null}
      <footer className="avos-review-foot">
        <form className="avos-review-ask" onSubmit={askForChanges}>
          <input
            type="text"
            value={ask}
            maxLength={2000}
            disabled={busy === "ask"}
            placeholder="Ask Avos for changes…"
            aria-label="Ask Avos for changes"
            onChange={(event) => setAsk(event.target.value)}
          />
        </form>
        {IS_MAC ? (
          <TeamCardButton
            className="avos-review-try"
            disabled={!!busy || !shown}
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
            disabled={!!busy || !shown}
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
              disabled={!!busy}
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

/** One page's before and after, at the chosen size, side by side. */
function ReviewPairView({
  page,
  size,
  pair,
  noBefore,
}: {
  /** The page's path, when there's more than one. */
  page?: string;
  size: PictureSize;
  pair: { before: PagePicture | null; after: PagePicture | null } | undefined;
  noBefore: boolean;
}) {
  const picture = (shot: PagePicture | null | undefined, label: string) => (
    <figure className="avos-review-figure" data-size={size}>
      {shot ? (
        <img src={shot.src} alt={`${label}${page ? ` of ${page}` : ""}`} />
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
      {page ? <h3>{page}</h3> : null}
      <div className="avos-review-pair">
        {noBefore ? null : picture(pair?.before, "Before")}
        {picture(pair?.after, noBefore ? "Avos's version" : "After")}
      </div>
    </div>
  );
}
