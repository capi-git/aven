import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown, ChevronRight, GitBranch } from "./icons";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useGitHistory } from "../hooks/useGitHistory";
import { suppressTextSelection } from "../lib/drag";
import type { GitHistoryCommit } from "../lib/fs";
import { shortTimeAgo } from "../lib/gitChangesView";
import {
  historyItemGraph,
  layoutGitGraph,
  SWIMLANE_WIDTH,
  type GraphPath,
  type GraphRef,
  type HistoryItemGraph,
  type HistoryItemViewModel,
} from "../lib/gitGraph";
import "./GitHistoryGraph.css";

type Props = {
  cwd: string;
  enabled: boolean;
  expanded: boolean;
  selectedSha?: string;
  /** The checked-out branch; null when the folder is not a Git repository. */
  branch?: string | null;
  onToggleExpanded: () => void;
  onOpenCommit: (commit: GitHistoryCommit) => void;
};

/** Two lines per commit: its message, then refs, short sha, author and age. */
export const HISTORY_ROW_PX = 38;
/** Chips shown on a row before the rest collapse into "+n". */
const REFS_SHOWN = 2;

export function GitHistoryGraph({
  cwd,
  enabled,
  expanded,
  selectedSha,
  branch,
  onToggleExpanded,
  onOpenCommit,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const { commits, loaded } = useGitHistory(cwd, enabled && expanded);
  const rows = useMemo(() => layoutGitGraph(commits), [commits]);
  const showAuthors =
    new Set(commits.map((commit) => commit.author).filter(Boolean)).size > 1;
  // Ages are worked out when the panel renders; nothing ticks on a clock.
  const now = Date.now();

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse graph" : "Expand graph"}
        className={`flex w-full shrink-0 items-center gap-1.5 px-3 text-left leading-none hover:bg-(--aven-hover) ${
          expanded ? "h-7" : "h-full"
        }`}
      >
        <span className="text-ui-micro font-semibold tracking-[0.04em] text-content/55 uppercase">
          History
        </span>
        {commits.length > 0 ? (
          <span className="text-ui-micro tabular-nums text-content/35">
            {commits.length >= 200 ? "200+" : commits.length}
          </span>
        ) : null}
        {expanded ? (
          <ChevronDown
            className="ml-auto size-3.5 shrink-0 text-content/50"
            strokeWidth={1.75}
          />
        ) : (
          <ChevronRight
            className="ml-auto size-3.5 shrink-0 text-content/50"
            strokeWidth={1.75}
          />
        )}
      </button>
      {expanded ? (
        <div
          ref={lockOverscroll}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-none"
        >
          {!cwd || cwd === "~" ? (
            <p className="px-3 py-2 text-ui-label text-content/45">
              No project folder
            </p>
          ) : commits.length === 0 ? (
            <HistoryEmpty loaded={loaded} branch={branch} />
          ) : (
            <ul className="min-w-0 max-w-full">
              {commits.map((commit, index) => {
                const row = rows[index];
                if (!row) return null;
                return (
                  <HistoryRow
                    key={commit.sha}
                    commit={commit}
                    showAuthor={showAuthors}
                    row={row}
                    now={now}
                    active={selectedSha === commit.sha}
                    onOpen={() => onOpenCommit(commit)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function HistoryEmpty({
  loaded,
  branch,
}: {
  loaded: boolean;
  branch?: string | null;
}) {
  if (!loaded)
    return (
      <p className="px-3 py-2 text-ui-label text-content/45" role="status">
        Loading history…
      </p>
    );
  const noGit = branch === null;
  return (
    <div className="git-history-empty" role="status">
      <svg aria-hidden viewBox="0 0 48 20" className="git-history-empty-art">
        <path d="M6 10 H42" />
        <circle cx="6" cy="10" r="3" />
        <circle cx="24" cy="10" r="3" data-faint />
        <circle cx="42" cy="10" r="3" data-faint />
      </svg>
      <p className="git-history-empty-title">
        {noGit ? "Not a Git repository" : "No commits yet"}
      </p>
      <p className="git-history-empty-detail">
        {noGit
          ? "Changes and history appear once this folder uses Git."
          : `Your first commit${branch ? ` on ${branch}` : ""} will start the history here.`}
      </p>
    </div>
  );
}

/**
 * Rows are taller than the 22 px graph cell. The node sits in the middle and
 * the lanes it passes through are drawn on to the row's top and bottom edges.
 */
export function historyGraphExtensions(
  graph: HistoryItemGraph,
  row: HistoryItemViewModel,
  height: number,
): { offset: number; paths: GraphPath[] } {
  const offset = Math.max(0, Math.round((height - graph.height) / 2));
  const paths: GraphPath[] = [];
  if (offset === 0) return { offset, paths };
  const top = new Set<string>();
  for (const path of graph.paths) {
    const x = /^M (\S+) 0(?:\s|$)/.exec(path.d)?.[1];
    if (!x || top.has(x)) continue;
    top.add(x);
    paths.push({
      d: `M ${x} 0 V ${offset}`,
      color: path.color,
      strokeWidth: 1,
    });
  }
  row.outputSwimlanes.forEach((lane, index) => {
    paths.push({
      d: `M ${SWIMLANE_WIDTH * (index + 1)} ${offset + graph.height} V ${height}`,
      color: lane.color,
      strokeWidth: 1,
    });
  });
  return { offset, paths };
}

function HistoryRow({
  commit,
  showAuthor,
  row,
  now,
  active,
  onOpen,
}: {
  commit: GitHistoryCommit;
  showAuthor: boolean;
  row: HistoryItemViewModel;
  now: number;
  active: boolean;
  onOpen: () => void;
}) {
  const graph = historyItemGraph(row);
  const { offset, paths: lanes } = historyGraphExtensions(
    graph,
    row,
    HISTORY_ROW_PX,
  );
  const refs = row.refs.slice(0, REFS_SHOWN);
  const hidden = row.refs.length - refs.length;
  const age = shortTimeAgo(commit.timestamp * 1000, now);
  return (
    <li className="min-w-0 overflow-visible" style={{ height: HISTORY_ROW_PX }}>
      <button
        type="button"
        title={`${commit.shortSha} ${commit.subject}${commit.author ? ` — ${commit.author}` : ""}`}
        onClick={onOpen}
        aria-pressed={active}
        className={`git-history-item flex min-w-0 w-full items-stretch overflow-visible pr-2 text-left ${
          row.kind === "HEAD" ? "is-head" : ""
        } ${
          active
            ? "is-selected bg-(--aven-selected) text-content"
            : "text-content hover:bg-(--aven-hover)"
        }`}
        style={{ height: HISTORY_ROW_PX }}
      >
        <svg
          aria-hidden
          className="git-history-graph pointer-events-none block shrink-0 overflow-visible"
          width={graph.width}
          height={HISTORY_ROW_PX}
          overflow="visible"
        >
          {lanes.map((path, index) => (
            <path
              key={`lane-${index}`}
              d={path.d}
              fill="none"
              stroke={path.color}
              strokeWidth={path.strokeWidth}
              strokeLinecap="round"
            />
          ))}
          <g transform={`translate(0 ${offset})`}>
            {graph.paths.map((path, pathIndex) => (
              <path
                key={pathIndex}
                d={path.d}
                fill="none"
                stroke={path.color}
                strokeWidth={path.strokeWidth}
                strokeLinecap="round"
              />
            ))}
            {graph.circles.map((circle, circleIndex) => (
              <circle
                key={circleIndex}
                cx={circle.cx}
                cy={circle.cy}
                r={circle.r}
                fill={circle.fill ?? "none"}
                strokeWidth={circle.strokeWidth}
              />
            ))}
          </g>
        </svg>
        <span className="git-history-text">
          <span
            className={`git-history-subject ${
              row.kind === "HEAD" ? "font-semibold" : ""
            }`}
          >
            {commit.subject || commit.shortSha}
          </span>
          <span className="git-history-meta">
            {refs.map((ref) => (
              <RefPill key={`${ref.kind}:${ref.name}`} refInfo={ref} />
            ))}
            {hidden > 0 ? (
              <span className="git-history-more">+{hidden}</span>
            ) : null}
            <span className="git-history-sha">{commit.shortSha}</span>
            {showAuthor && commit.author ? (
              <span className="git-history-author">{commit.author}</span>
            ) : null}
            {age ? <span className="git-history-age">{age}</span> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function RefPill({ refInfo }: { refInfo: GraphRef }) {
  const local = refInfo.kind === "local";
  return (
    <span
      className="git-history-ref"
      data-kind={refInfo.kind}
      data-colored={refInfo.color ? true : undefined}
      style={
        refInfo.color
          ? ({ "--git-ref-color": refInfo.color } as CSSProperties)
          : undefined
      }
      title={refInfo.name}
    >
      {local ? (
        <GitBranch className="size-2.5 shrink-0" strokeWidth={2} />
      ) : null}
      <span className="min-w-0 truncate">{refInfo.name}</span>
    </span>
  );
}

export const GRAPH_PANEL_MIN = 120;
export const GRAPH_PANEL_DEFAULT = 240;

let graphPanelHeight = GRAPH_PANEL_DEFAULT;

export function loadGraphPanelHeight(): number {
  return graphPanelHeight;
}

export function saveGraphPanelHeight(height: number) {
  graphPanelHeight = height;
}

export function GraphResizeSash({
  height,
  onHeightPaint,
  onHeightCommit,
  maxHeight,
}: {
  height: number;
  onHeightPaint: (height: number) => void;
  onHeightCommit: (height: number) => void;
  maxHeight: () => number;
}) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const paintedRef = useRef(height);
  paintedRef.current = height;
  const paintRef = useRef(onHeightPaint);
  paintRef.current = onHeightPaint;
  const commitRef = useRef(onHeightCommit);
  commitRef.current = onHeightCommit;
  const maxRef = useRef(maxHeight);
  maxRef.current = maxHeight;

  const clamp = (value: number) =>
    Math.min(maxRef.current(), Math.max(GRAPH_PANEL_MIN, Math.round(value)));

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    drag.current = { start: event.clientY, size: paintedRef.current };
    setDragging(true);
    const restoreSelection = suppressTextSelection();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "row-resize";
    document.documentElement.classList.add("is-resizing");

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId || !drag.current) return;
      const next = clamp(drag.current.size - (ev.clientY - drag.current.start));
      paintedRef.current = next;
      paintRef.current(next);
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      restoreSelection();
      document.body.style.cursor = previousCursor;
      document.documentElement.classList.remove("is-resizing");
      setDragging(false);
      drag.current = null;
      try {
        handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      commitRef.current(clamp(paintedRef.current));
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize graph"
      aria-valuenow={height}
      className={`z-10 h-1.5 shrink-0 cursor-row-resize touch-none ${
        dragging ? "bg-content/15" : "hover:bg-content/10"
      }`}
      onPointerDown={onPointerDown}
      onDoubleClick={() => commitRef.current(clamp(GRAPH_PANEL_DEFAULT))}
    />
  );
}
