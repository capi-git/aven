import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, logError } from "../lib/errors";
import {
  gitDiffIndex,
  gitPrStatus,
  subscribeGitChanged,
  type GitDiffIndex,
  type GitPr,
} from "../lib/fs";
import { MERGE_PATH_REFRESH_S } from "../lib/mergePath";

export type MergePathState = {
  index: GitDiffIndex | null;
  pr: GitPr | null;
  error: string | null;
  loading: boolean;
  /** Whole seconds until the next read; null while paused or reading. */
  nextIn: number | null;
  refresh: () => void;
};

/**
 * The copy's Git state and its pull request for the Checks tab. Reads when
 * shown, when Git changes, and every `refreshS` seconds (MERGE_PATH_REFRESH_S
 * by default) while `enabled` and the window is visible. A hidden window
 * pauses the countdown. Without `countdown`, `nextIn` stays null, so a caller
 * that shows no "Refreshing in" does not draw again every second.
 */
export function useMergePath(
  cwd: string,
  enabled: boolean,
  {
    refreshS = MERGE_PATH_REFRESH_S,
    countdown = true,
  }: { refreshS?: number; countdown?: boolean } = {},
): MergePathState {
  const [index, setIndex] = useState<GitDiffIndex | null>(null);
  const [pr, setPr] = useState<GitPr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nextIn, setNextIn] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;

  useEffect(() => {
    setIndex(null);
    setPr(null);
    setError(null);
  }, [cwd]);

  useEffect(() => {
    if (!enabled || !cwd || cwd === "~") {
      setNextIn(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let left = refreshS;
    const load = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      setLoading(true);
      setNextIn(null);
      try {
        const [nextIndex, nextPr] = await Promise.all([
          gitDiffIndex(cwd),
          // No remote means no pull request to look for.
          gitPrStatus(cwd).catch((cause) => {
            logError("pull request status", cause);
            return null;
          }),
        ]);
        if (cancelled || cwdRef.current !== cwd) return;
        setIndex(nextIndex);
        setPr(nextPr);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(errorText(cause));
      } finally {
        inFlight = false;
        if (!cancelled) {
          setLoading(false);
          left = refreshS;
          setNextIn(document.hidden || !countdown ? null : left);
        }
      }
    };
    const tick = window.setInterval(() => {
      if (document.hidden || inFlight) return;
      left -= 1;
      if (left <= 0) void load();
      else if (countdown) setNextIn(left);
    }, 1000);
    const onVisibility = () => {
      if (document.hidden) setNextIn(null);
      else void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = subscribeGitChanged(() => void load());
    void load();
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
    };
  }, [cwd, enabled, nonce, refreshS, countdown]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return { index, pr, error, loading, nextIn, refresh };
}
