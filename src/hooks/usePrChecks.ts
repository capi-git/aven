import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, logError } from "../lib/errors";
import {
  gitPrChecks,
  prChecksDelay,
  prChecksNeedPolling,
  summarizePrChecks,
  type PrChecks,
  type PrChecksSummary,
} from "../lib/prChecks";

export type PrChecksState = {
  checks: PrChecks | null;
  summary: PrChecksSummary | null;
  error: string | null;
  /** True while a read is in flight. */
  loading: boolean;
  refresh: () => void;
};

/**
 * A pull request's CI checks. Reads once, then again with backoff only while
 * `enabled`, the window is visible, and checks are still running (or have not
 * registered yet). Stops for good when they finish; `refresh` reads again.
 */
export function usePrChecks(
  cwd: string,
  number: number | null,
  enabled: boolean,
): PrChecksState {
  const [checks, setChecks] = useState<PrChecks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const handledNonce = useRef(0);
  // Reads of this pull request so far, kept across hide and show.
  const reads = useRef(0);
  const latest = useRef<{ checks: PrChecks | null; failed: boolean }>({
    checks: null,
    failed: false,
  });
  const key = `${cwd}#${number ?? ""}`;
  const keyRef = useRef(key);
  if (keyRef.current !== key) {
    keyRef.current = key;
    reads.current = 0;
    latest.current = { checks: null, failed: false };
  }

  useEffect(() => {
    setChecks(null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!enabled || !number || !cwd || cwd === "~") return;
    let cancelled = false;
    let timer: number | null = null;
    let inFlight = false;
    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const wanted = () => {
      const { checks: current, failed } = latest.current;
      if (failed) return false;
      return prChecksNeedPolling(
        current ? summarizePrChecks(current.checks) : null,
        current?.state,
        reads.current,
      );
    };
    const schedule = () => {
      clear();
      if (cancelled || document.hidden || !wanted()) return;
      timer = window.setTimeout(
        () => {
          timer = null;
          void load();
        },
        prChecksDelay(Math.max(0, reads.current - 1)),
      );
    };
    const load = async () => {
      if (cancelled || document.hidden || inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        const next = await gitPrChecks(cwd, number);
        if (cancelled) return;
        reads.current += 1;
        latest.current = { checks: next, failed: false };
        setChecks(next);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        latest.current = { ...latest.current, failed: true };
        logError("pull request checks", cause);
        setError(errorText(cause));
      } finally {
        inFlight = false;
        if (!cancelled) {
          setLoading(false);
          schedule();
        }
      }
    };
    const onVisibility = () => {
      if (document.hidden) clear();
      else if (timer === null && wanted()) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A manual refresh reads straight away, even after the checks finished.
    const manual = nonce !== handledNonce.current;
    handledNonce.current = nonce;
    if (manual) latest.current = { ...latest.current, failed: false };
    if (reads.current === 0 || manual || wanted()) void load();
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cwd, number, enabled, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  return {
    checks,
    summary: checks ? summarizePrChecks(checks.checks) : null,
    error,
    loading,
    refresh,
  };
}
