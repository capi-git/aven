import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Undo2,
  type IconComponent,
} from "./icons";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import { useNarrow } from "../hooks/useNarrow";
import {
  keepSessionChanges,
  sessionCheckpointMissed,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  undoSessionChanges,
  type CheckpointFile,
} from "../lib/checkpoint";
import { invalidateProjectFiles } from "../lib/fileIndex";
import { invalidateWatchedFiles } from "../lib/fileWatch";
import { basename, notifyGitChanged, subscribeGitChanged } from "../lib/fs";
import { requestShip } from "../lib/shipRequest";
import { FileTypeIcon } from "./FileTypeIcon";

/** Below this width the bar's buttons keep their icons and tooltips only. */
export const REVIEW_BAR_NARROW_PX = 400;

type Props = {
  sessionId: string;
  cwd: string;
  enabled?: boolean;
  busy?: boolean;
  undoLocked?: boolean;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
};

export function SessionReview({
  sessionId,
  cwd,
  enabled = true,
  busy = false,
  undoLocked = false,
  onOpenDiff,
}: Props) {
  const [files, setFiles] = useState<CheckpointFile[]>([]);
  const [missed, setMissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<"keep" | "undo" | null>(null);
  const [barRef, narrow] = useNarrow<HTMLDivElement>(REVIEW_BAR_NARROW_PX);
  const filesRef = useRef(files);
  filesRef.current = files;

  const load = useCallback(() => {
    if (!cwd || cwd === "~") {
      setFiles([]);
      setMissed(false);
      return;
    }
    setMissed(sessionCheckpointMissed(sessionId));
    void sessionCheckpointStatus(sessionId, cwd)
      .then((status) => setFiles(status.files))
      .catch(() => setFiles([]));
  }, [sessionId, cwd]);

  useEffect(() => {
    if (!enabled || busy) return;
    load();
    let timer: number | null = null;
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        load();
      }, 200);
    };
    const unsubReview = subscribeReviewChanged((id) => {
      if (!id || id === sessionId) schedule();
    });
    const unsubGit = subscribeGitChanged(() => {
      if (filesRef.current.length > 0) schedule();
    });
    const onResume = () => {
      if (filesRef.current.length > 0) schedule();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      unsubReview();
      unsubGit();
    };
  }, [enabled, load, sessionId, busy]);

  useEffect(() => {
    if (files.length <= 1) setExpanded(false);
  }, [files.length]);

  if (files.length === 0)
    return missed && !busy ? (
      <div className="px-2" data-session-review-shell>
        <div
          role="status"
          className="flex min-w-0 items-center gap-2 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1.5 text-ui-label text-content/60"
          data-session-review-missed
        >
          <Undo2 className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0">
            Undo isn't available for this reply. Aven couldn't save a checkpoint
            in time.
          </span>
        </div>
      </div>
    ) : null;

  const disabled = busy || acting != null;
  const many = files.length > 1;
  const first = files[0];
  if (!first) return null;
  const canUndoAll = !undoLocked && files.every((file) => file.undoable);

  const run = (action: "keep" | "undo") => {
    if (disabled) return;
    setActing(action);
    const op =
      action === "keep"
        ? keepSessionChanges(sessionId, cwd)
        : undoSessionChanges(sessionId, cwd);
    const previous = filesRef.current.map((file) => file.path);
    void op
      .then((status) => {
        setFiles(status.files);
        notifyGitChanged(cwd);
        invalidateWatchedFiles(previous);
        invalidateProjectFiles(cwd);
      })
      .catch(() => load())
      .finally(() => setActing(null));
  };

  return (
    <div className="px-2" data-session-review-shell>
      <div
        ref={barRef}
        className="relative z-0 rounded-t-[10px] border border-b-0 border-content/10 bg-content/3 px-2 py-1"
        data-session-review
        data-narrow={narrow || undefined}
      >
        <div className="flex min-w-0 items-center gap-2">
          {many ? (
            <button
              type="button"
              title={expanded ? "Collapse files" : "Expand files"}
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
              className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-content/70 hover:text-content"
            >
              {expanded ? (
                <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
              ) : (
                <ChevronRight
                  className="size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
              )}
              <span className="truncate text-ui-label">
                {files.length} Files
              </span>
            </button>
          ) : (
            <FileLabel
              file={first}
              sessionId={sessionId}
              cwd={cwd}
              onOpenDiff={onOpenDiff}
            />
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <BarButton
              narrow={narrow}
              icon={Undo2}
              label="Undo All"
              title={
                canUndoAll
                  ? "Put these files back the way they were before this chat changed them"
                  : undoLocked
                    ? "Undo is unavailable while another chat is running in this project"
                    : "Undo is unavailable because a file changed outside this chat"
              }
              disabled={disabled || !canUndoAll}
              onClick={() => run("undo")}
            />
            <BarButton
              narrow={narrow}
              icon={Check}
              label="Keep All"
              title="Keep these changes and hide this bar"
              disabled={disabled}
              onClick={() => run("keep")}
            />
            <BarButton
              narrow={narrow}
              primary
              icon={FileDiff}
              label="Review"
              title="Review changes"
              onClick={() => onOpenDiff(undefined, { sessionId, cwd })}
            />
            <BarButton
              narrow={narrow}
              primary
              icon={ArrowUp}
              iconAlways
              label="Ship it"
              title="Commit, push and open a pull request from the Changes panel"
              disabled={busy}
              onClick={() => requestShip(cwd, sessionId)}
            />
          </div>
        </div>
        {many && expanded ? (
          <ul className="scrollbar-none mt-1 max-h-40 overflow-y-auto">
            {files.map((file) => (
              <li key={file.relative}>
                <FileRow
                  file={file}
                  sessionId={sessionId}
                  cwd={cwd}
                  onOpenDiff={onOpenDiff}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One of the bar's buttons: its word, or in a narrow chat its icon alone,
 * named by its tooltip and accessible name, so nothing is ever cut off.
 */
function BarButton({
  narrow,
  icon: Icon,
  iconAlways = false,
  label,
  title,
  primary = false,
  ...button
}: {
  narrow: boolean;
  icon: IconComponent;
  /** Shown beside the word too, not only when narrow. */
  iconAlways?: boolean;
  label: string;
  title: string;
  primary?: boolean;
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "onClick">) {
  return (
    <button
      type="button"
      title={narrow && title !== label ? `${label}: ${title}` : title}
      aria-label={label}
      data-review-action={label}
      className={`flex h-6 shrink-0 items-center justify-center gap-1 rounded-md text-ui-caption disabled:opacity-40 ${
        narrow ? "w-6" : primary ? "px-2" : "px-1.5"
      } ${
        primary
          ? "bg-content/15 text-content/80 hover:bg-content/20 hover:text-content"
          : "text-content/55 hover:bg-content/10 hover:text-content"
      }`}
      {...button}
    >
      {narrow || iconAlways ? (
        <Icon
          className="size-3 shrink-0"
          strokeWidth={iconAlways ? 2 : 1.75}
          aria-hidden
        />
      ) : null}
      {narrow ? null : <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

function FileLabel({
  file,
  sessionId,
  cwd,
  onOpenDiff,
}: {
  file: CheckpointFile;
  sessionId: string;
  cwd: string;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
}) {
  const name = basename(file.relative);
  return (
    <button
      type="button"
      title={file.relative}
      onClick={() => onOpenDiff(file.path, { sessionId, cwd })}
      className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-content/80 hover:text-content"
    >
      <FileTypeIcon name={name} isDir={false} size={14} />
      <span className="min-w-0 truncate font-mono text-ui-label">{name}</span>
      <DiffCounts file={file} />
    </button>
  );
}

function FileRow({
  file,
  sessionId,
  cwd,
  onOpenDiff,
}: {
  file: CheckpointFile;
  sessionId: string;
  cwd: string;
  onOpenDiff: (
    path?: string,
    session?: { sessionId: string; cwd: string },
  ) => void;
}) {
  const name = basename(file.relative);
  return (
    <button
      type="button"
      title={file.relative}
      onClick={() => onOpenDiff(file.path, { sessionId, cwd })}
      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-content/80 hover:bg-content/10 hover:text-content"
    >
      <FileTypeIcon name={name} isDir={false} size={16} />
      <span className="min-w-0 flex-1 truncate font-mono text-ui-label">
        {name}
      </span>
      <DiffCounts file={file} />
    </button>
  );
}

function DiffCounts({ file }: { file: CheckpointFile }) {
  if (!file.exact) {
    return (
      <span className="shrink-0 text-ui-caption font-medium text-amber-300/80">
        Shared file
      </span>
    );
  }
  if (file.additions <= 0 && file.deletions <= 0) return null;
  return (
    <span className="shrink-0 font-mono text-ui-caption font-semibold">
      {file.additions > 0 ? (
        <span className="text-emerald-400">+{file.additions}</span>
      ) : null}
      {file.additions > 0 && file.deletions > 0 ? " " : null}
      {file.deletions > 0 ? (
        <span className="text-red-400">-{file.deletions}</span>
      ) : null}
    </span>
  );
}
