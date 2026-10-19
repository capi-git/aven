import { useEffect, useRef, useState } from "react";
import { Popover } from "../chrome/Popover";
import { TeamCardButton } from "../chrome/TeamCard";
import { useFeatureCards } from "../hooks/useFeatureCards";
import { useGithubRepo } from "../hooks/useGithubRepo";
import { errorText } from "../lib/errors";
import { addFeatureCards } from "../lib/featureCards";
import { listGithubWorkItems, type GithubWorkItem } from "../lib/githubTasks";
import { plural } from "../lib/words";

/**
 * Ideas' "Import issues", for a project on GitHub: pick open issues to add
 * as ideas, each linked to its issue. It asks GitHub the way the Inbox
 * does, and only once the list is opened.
 */
export function BoardIssueImport({
  project,
  visible,
}: {
  project: string;
  visible: boolean;
}) {
  const repo = useGithubRepo(project, visible);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!repo) return null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="work-board-import"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Add open issues from ${repo} as ideas`}
        onClick={() => setOpen((shown) => !shown)}
      >
        Import issues
      </button>
      {open ? (
        <IssuePicker
          project={project}
          repo={repo}
          anchor={anchor}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) anchor.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

type Loaded = { items: GithubWorkItem[] } | { error: string } | null;

function IssuePicker({
  project,
  repo,
  anchor,
  onClose,
}: {
  project: string;
  repo: string;
  anchor: { current: HTMLButtonElement | null };
  onClose: (refocus: boolean) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const { cards } = useFeatureCards(project);
  const onBoard = new Set(cards.map((card) => card.sourceUrl).filter(Boolean));
  useEffect(() => {
    let current = true;
    listGithubWorkItems(project, {
      kind: "issue",
      assignedToMe: false,
      state: "open",
      search: "",
    }).then(
      (items) => {
        if (current) setLoaded({ items });
      },
      (error) => {
        if (current) setLoaded({ error: errorText(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [project]);
  const items = loaded && "items" in loaded ? loaded.items : [];
  const toggle = (url: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  const add = () => {
    void addFeatureCards(
      project,
      items
        .filter((item) => picked.has(item.url) && !onBoard.has(item.url))
        .map((item) => ({ title: item.title, sourceUrl: item.url })),
    );
    onClose(true);
  };
  return (
    <Popover
      anchor={anchor}
      align="start"
      gap={6}
      width={320}
      maxHeight={420}
      autoFocus
      tabIndex={-1}
      role="dialog"
      aria-label="Import issues"
      onDismiss={(reason) => onClose(reason === "escape")}
      className="work-board-import-panel"
      data-board-import
    >
      <p className="work-board-import-hint">
        Open issues on {repo} become ideas, linked to the issue.
      </p>
      {loaded === null ? (
        <p className="work-board-import-note">Loading issues…</p>
      ) : "error" in loaded ? (
        <p className="work-board-import-note" role="alert">
          Couldn't load issues: {loaded.error}
        </p>
      ) : !items.length ? (
        <p className="work-board-import-note">No open issues.</p>
      ) : (
        <ul className="work-board-import-list" role="list">
          {items.map((item) => {
            const added = onBoard.has(item.url);
            return (
              <li key={item.url}>
                <label
                  className="work-board-import-item"
                  data-added={added || undefined}
                >
                  <input
                    type="checkbox"
                    checked={added || picked.has(item.url)}
                    disabled={added}
                    onChange={() => toggle(item.url)}
                  />
                  <span className="work-board-import-number">
                    #{item.number}
                  </span>
                  <span className="work-board-import-title" title={item.title}>
                    {item.title}
                  </span>
                  {added ? (
                    <span className="work-board-import-added">
                      On the board
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="work-board-import-actions">
        <TeamCardButton
          size="compact"
          variant="ghost"
          onClick={() => onClose(true)}
        >
          Cancel
        </TeamCardButton>
        <TeamCardButton
          size="compact"
          variant="primary"
          disabled={!picked.size}
          onClick={add}
        >
          {picked.size ? `Add ${plural(picked.size, "idea")}` : "Add"}
        </TeamCardButton>
      </div>
    </Popover>
  );
}
