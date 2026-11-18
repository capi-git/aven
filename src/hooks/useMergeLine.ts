import { useCallback, useEffect, useRef, useState } from "react";
import { logError } from "../lib/errors";
import { githubWorkItemThread } from "../lib/githubTasks";
import { gitPrChecks, type PrChecks } from "../lib/prChecks";
import { mergeLineState, type MergeLineDetails } from "../lib/mergeLine";
import { useMergePath, type MergePathState } from "./useMergePath";

/** Review threads cost a GraphQL read: once a minute is plenty. */
const THREADS_TTL_MS = 60_000;

export type MergeLineData = Pick<MergePathState, "index" | "pr" | "refresh"> & {
  details: MergeLineDetails | null;
  /**
   * The copy's local Git state already shows the line applies, but nothing
   * has been read to fill it yet: the line holds its place, empty.
   */
  reserve: boolean;
  /** Shown from the copy's last read while it is read again: look, don't act. */
  stale: boolean;
};

type LastLine = {
  index: NonNullable<MergePathState["index"]>;
  pr: MergePathState["pr"];
  details: MergeLineDetails | null;
};

/**
 * The last line shown for each copy, so a chat opened again on that copy
 * shows it at once while Git and GitHub are read again, instead of
 * inserting the line under the message box a moment later.
 */
const lastLines = new Map<string, LastLine>();
const LAST_LINES_MAX = 32;

function rememberLine(cwd: string, line: LastLine) {
  lastLines.delete(cwd);
  lastLines.set(cwd, line);
  if (lastLines.size > LAST_LINES_MAX)
    lastLines.delete(lastLines.keys().next().value!);
}

/** For tests: forget every remembered line. */
export function clearMergeLineMemory() {
  lastLines.clear();
}

const openNumber = (pr: MergePathState["pr"]) =>
  pr?.state === "open" ? pr.number : null;

/**
 * What the merge line needs: the branch's Git state and pull request (read
 * as the Checks tab does, every MERGE_PATH_REFRESH_S while shown), and for
 * an open pull request its checks, merge state and unresolved threads.
 * Nothing reads while `enabled` is false.
 */
export function useMergeLine(cwd: string, enabled: boolean): MergeLineData {
  const {
    index,
    localIndex,
    pr,
    refresh: refreshPath,
  } = useMergePath(cwd, enabled);
  const number = openNumber(pr);
  const [details, setDetails] = useState<MergeLineDetails | null>(null);
  const threadsRef = useRef<{ key: string; at: number; count: number } | null>(
    null,
  );
  const forceRef = useRef(false);
  const key = `${cwd}#${number ?? ""}`;
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    threadsRef.current = null;
  }

  useEffect(() => {
    setDetails(null);
  }, [key]);

  // Each read of the branch (a new `index`) reads the pull request again.
  useEffect(() => {
    if (!enabled || !number || !index) return;
    let cancelled = false;
    const force = forceRef.current;
    forceRef.current = false;
    void (async () => {
      let checks: PrChecks | null = null;
      try {
        checks = await gitPrChecks(cwd, number);
      } catch (cause) {
        logError("merge line: pull request", cause);
        return;
      }
      if (cancelled) return;
      const cached = threadsRef.current;
      const fresh =
        !force &&
        cached?.key === key &&
        Date.now() - cached.at < THREADS_TTL_MS;
      setDetails((current) => ({
        checks,
        unresolvedThreads: fresh
          ? cached.count
          : (current?.unresolvedThreads ?? null),
      }));
      if (fresh) return;
      try {
        const thread = await githubWorkItemThread(cwd, "pr", number, {
          force: true,
        });
        if (cancelled) return;
        const count = thread.comments.filter(
          (comment) => comment.kind === "review_comment" && !comment.resolved,
        ).length;
        threadsRef.current = { key, at: Date.now(), count };
        setDetails((current) =>
          current ? { ...current, unresolvedThreads: count } : current,
        );
      } catch (cause) {
        // No thread access: the review decision alone decides.
        logError("merge line: review threads", cause);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, enabled, index, key, number]);

  // Remember what was read for this copy, details only once they belong to
  // this pull request.
  useEffect(() => {
    if (!index) return;
    const last = lastLines.get(cwd);
    rememberLine(cwd, {
      index,
      pr,
      details:
        details ??
        (last && openNumber(last.pr) === number ? last.details : null),
    });
  }, [cwd, index, pr, details, number]);

  const refresh = useCallback(() => {
    forceRef.current = true;
    refreshPath();
  }, [refreshPath]);

  if (index) {
    // A new pull request number clears `details` until its checks are read:
    // keep the copy's last details for that same number meanwhile.
    const last = details ? null : lastLines.get(cwd);
    const kept =
      last && number !== null && openNumber(last.pr) === number
        ? last.details
        : null;
    return {
      index,
      pr,
      details: details ?? kept,
      refresh,
      reserve: false,
      stale: false,
    };
  }
  const last = lastLines.get(cwd);
  if (last)
    return {
      index: last.index,
      pr: last.pr,
      details: last.details,
      refresh,
      reserve: false,
      stale: true,
    };
  return {
    index: null,
    pr: null,
    details: null,
    refresh,
    reserve: !!localIndex && mergeLineState(localIndex, null, null) !== null,
    stale: false,
  };
}
