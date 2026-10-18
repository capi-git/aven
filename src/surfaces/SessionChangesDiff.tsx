import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader } from "../chrome/icons";
import { useChatReviews } from "../lib/chatReview";
import { changesShipped } from "../lib/chatStatus";
import {
  sessionCheckpointFileDiff,
  sessionCheckpointStatus,
  subscribeReviewChanged,
  type CheckpointFile,
} from "../lib/checkpoint";
import { forEachConcurrent } from "../lib/concurrent";
import { subscribeGitChanged } from "../lib/fs";
import { useShippedChats } from "../lib/shippedChats";
import { isWindowVisible } from "../lib/windowActivity";
import { buildUnifiedFile, type UnifiedFileDiff } from "../lib/unifiedDiff";
import { UnifiedDiffView, type UnifiedDiffFileModel } from "./UnifiedDiffView";

type Props = {
  cwd: string;
  sessionId: string;
  focusPath?: string;
  /** Close this review's tab. */
  onClose?: () => void;
};

type LoadedDiff = {
  binary: boolean;
  tooLarge: boolean;
  unified: UnifiedFileDiff | null;
  error?: string;
};

const DIFF_LOAD_CONCURRENCY = 4;

/**
 * Read-only review of the exact before/after snapshots owned by one session.
 * Once its changes ship, or go away, it says so calmly instead of showing
 * what is no longer waiting for review.
 */
export function SessionChangesDiff({
  cwd,
  sessionId,
  focusPath,
  onClose,
}: Props) {
  const [files, setFiles] = useState<CheckpointFile[] | null>(null);
  const [diffs, setDiffs] = useState<Map<string, LoadedDiff>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const ship = useShippedChats()[sessionId];
  const review = useChatReviews()[sessionId];
  const shipped = changesShipped(review?.at, ship?.at);

  useEffect(() => {
    if (!cwd || cwd === "~" || !sessionId) {
      setFiles([]);
      setDiffs(new Map());
      return;
    }

    let disposed = false;
    let generation = 0;
    // The changes on screen, to tell whether a re-read found anything new.
    let shown: string | null = null;
    const run = () => {
      const current = ++generation;
      shown = null;
      setFiles(null);
      setDiffs(new Map());
      void sessionCheckpointStatus(sessionId, cwd)
        .then(async (status) => {
          if (disposed || current !== generation) return;
          shown = filesKey(status.files);
          setFiles(status.files);
          setError(null);
          await forEachConcurrent(
            prioritizeFile(status.files, focusPath),
            DIFF_LOAD_CONCURRENCY,
            async (file) => {
              let loaded: LoadedDiff;
              try {
                const diff = await sessionCheckpointFileDiff(
                  sessionId,
                  cwd,
                  file.relative,
                );
                loaded = {
                  binary: diff.binary,
                  tooLarge: diff.tooLarge,
                  unified:
                    !diff.binary && !diff.tooLarge
                      ? buildUnifiedFile(diff.original, diff.current)
                      : null,
                };
              } catch (caught: unknown) {
                loaded = {
                  binary: false,
                  tooLarge: false,
                  unified: null,
                  error:
                    caught instanceof Error ? caught.message : String(caught),
                };
              }
              if (disposed || current !== generation) return;
              setDiffs((existing) => {
                const next = new Map(existing);
                next.set(file.relative, loaded);
                return next;
              });
            },
            () => !disposed && current === generation,
          );
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setFiles([]);
        });
    };

    run();
    const unsubscribe = subscribeReviewChanged((changedSessionId) => {
      if (!changedSessionId || changedSessionId === sessionId) run();
    });
    // Keep, Undo, a commit or a checkout here: read again while on screen,
    // and show it afresh only if the changes are not what is shown.
    const recheck = () => {
      const base = generation;
      void sessionCheckpointStatus(sessionId, cwd)
        .then((status) => {
          if (disposed || base !== generation || shown === null) return;
          if (filesKey(status.files) !== shown) run();
        })
        .catch(() => {});
    };
    const unsubscribeGit = subscribeGitChanged(() => {
      if (isWindowVisible()) recheck();
    });
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeGit();
    };
  }, [cwd, focusPath, sessionId]);

  const models = useMemo<UnifiedDiffFileModel[]>(() => {
    if (!files) return [];
    return files.map((file) => {
      const loaded = diffs.get(file.relative);
      const unified = loaded?.unified ?? null;
      return {
        id: file.relative,
        path: file.path,
        label: file.relative,
        binary: loaded?.binary,
        tooLarge: loaded?.tooLarge,
        emptyMessage:
          loaded == null
            ? "Loading…"
            : loaded.error
              ? loaded.error
              : unified != null &&
                  unified.additions === 0 &&
                  unified.deletions === 0 &&
                  !loaded.binary
                ? "No textual diff"
                : undefined,
        additions: unified?.additions ?? file.additions,
        deletions: unified?.deletions ?? file.deletions,
        blocks: unified?.blocks ?? [],
      };
    });
  }, [diffs, files]);

  const totals = useMemo(
    () =>
      models.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [models],
  );

  if (!cwd || cwd === "~") {
    return (
      <p className="grid h-full place-items-center text-ui-body text-content/45">
        No project folder
      </p>
    );
  }
  if (error) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <AlertCircle className="mx-auto mb-3 size-5 text-red-400" />
        <p className="text-ui-body text-content">
          Couldn’t load this chat’s changes
        </p>
        <p className="mt-1 text-ui-label text-content/50">{error}</p>
      </div>
    );
  }
  if (files == null) {
    return (
      <div className="grid h-full place-items-center text-content/40">
        <Loader className="size-4 animate-spin" strokeWidth={1.75} />
      </div>
    );
  }
  if (shipped || files.length === 0) {
    return (
      <div
        className="grid h-full place-items-center p-6 text-center"
        data-session-changes-done={shipped ? "shipped" : "empty"}
      >
        <div>
          {shipped ? (
            <Check
              className="mx-auto mb-2 size-5 text-emerald-400"
              strokeWidth={1.75}
              aria-hidden
            />
          ) : null}
          <p className="text-ui-body text-content/70" role="status">
            {shipped
              ? shippedLine(ship?.commit?.shortSha)
              : "No changes in this chat"}
          </p>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="mt-3 h-7 rounded-md bg-content/10 px-3 text-ui-label text-content/80 hover:bg-content/15 hover:text-content"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <UnifiedDiffView files={models} focusPath={focusPath} totals={totals} />
  );
}

/** "Shipped · 1a2b3c4 · nothing left to review". */
export function shippedLine(shortSha: string | undefined): string {
  return ["Shipped", shortSha, "nothing left to review"]
    .filter(Boolean)
    .join(" · ");
}

/** The changes a status lists, to tell whether a re-read found anything new. */
function filesKey(files: readonly CheckpointFile[]): string {
  return files
    .map((file) => `${file.relative}:${file.additions}:${file.deletions}`)
    .join("\n");
}

function prioritizeFile(
  files: readonly CheckpointFile[],
  focusPath: string | undefined,
): CheckpointFile[] {
  if (!focusPath) return [...files];
  const focused = files.find(
    (file) => file.path === focusPath || file.relative === focusPath,
  );
  if (!focused) return [...files];
  return [focused, ...files.filter((file) => file !== focused)];
}
