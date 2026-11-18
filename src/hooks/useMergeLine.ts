import { useCallback, useEffect, useRef, useState } from "react";
import { logError } from "../lib/errors";
import { githubWorkItemThread } from "../lib/githubTasks";
import { gitPrChecks, type PrChecks } from "../lib/prChecks";
import type { MergeLineDetails } from "../lib/mergeLine";
import { useMergePath, type MergePathState } from "./useMergePath";

/**
 * Every visible chat shows a merge line, so it reads GitHub far less often
 * than the Checks tab: once a minute, and at once when Git changes here.
 */
const MERGE_LINE_REFRESH_S = 60;

/** Review threads cost a GraphQL read: once a minute is plenty. */
const THREADS_TTL_MS = 60_000;

export type MergeLineData = Pick<MergePathState, "index" | "pr" | "refresh"> & {
  details: MergeLineDetails | null;
};

/**
 * What the merge line needs: the branch's Git state and pull request (read
 * as the Checks tab does, but once a minute and with no countdown), and for
 * an open pull request its checks, merge state and unresolved threads.
 * Nothing reads while `enabled` is false.
 */
export function useMergeLine(cwd: string, enabled: boolean): MergeLineData {
  const {
    index,
    pr,
    refresh: refreshPath,
  } = useMergePath(cwd, enabled, {
    refreshS: MERGE_LINE_REFRESH_S,
    countdown: false,
  });
  const number = pr?.state === "open" ? pr.number : null;
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

  const refresh = useCallback(() => {
    forceRef.current = true;
    refreshPath();
  }, [refreshPath]);
  return { index, pr, details, refresh };
}
