import { invoke } from "@tauri-apps/api/core";

export type PrCheckState = "pass" | "fail" | "pending" | "skipped";

export type PrCheck = {
  name: string;
  state: PrCheckState | string;
  url: string;
};

export type PrChecks = {
  number: number;
  url: string;
  /** Pull request state, lower case: open, merged or closed. */
  state: string;
  checks: PrCheck[];
};

/** CI checks GitHub reports on a pull request, through the project's routed account. */
export function gitPrChecks(cwd: string, number: number): Promise<PrChecks> {
  return invoke<PrChecks>("git_pr_checks", { cwd, number });
}

export type PrChecksSummary = {
  /** `none` while GitHub has not reported any check yet. */
  state: "passing" | "failing" | "pending" | "none";
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  total: number;
  label: string;
};

/** One line for a pull request's checks: failures first, then what is still running. */
export function summarizePrChecks(checks: readonly PrCheck[]): PrChecksSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let skipped = 0;
  for (const check of checks) {
    if (check.state === "pass") passed += 1;
    else if (check.state === "fail") failed += 1;
    else if (check.state === "skipped") skipped += 1;
    else pending += 1;
  }
  const total = checks.length;
  const counts = { passed, failed, pending, skipped, total };
  if (total === 0)
    return { ...counts, state: "none", label: "No checks reported yet" };
  if (failed > 0)
    return {
      ...counts,
      state: "failing",
      label:
        pending > 0
          ? `${failed} failed · ${pending} still running`
          : `${failed} of ${total} ${total === 1 ? "check" : "checks"} failed`,
    };
  if (pending > 0)
    return {
      ...counts,
      state: "pending",
      label: `${pending} of ${total} ${total === 1 ? "check" : "checks"} running`,
    };
  return {
    ...counts,
    state: "passing",
    label:
      total === 1
        ? "Check passed"
        : `All ${passed} checks passed${skipped ? ` · ${skipped} skipped` : ""}`,
  };
}

/**
 * Checks GitHub has not registered yet look like "no checks". Keep looking for
 * this many reads after a push before deciding the repository has none.
 */
export const PR_CHECKS_EMPTY_READS = 4;
const PR_CHECKS_FIRST_MS = 8_000;
const PR_CHECKS_MAX_MS = 60_000;

/** Delay before the next read: 8 s, then 1.5x each time, at most a minute. */
export function prChecksDelay(attempt: number): number {
  return Math.min(
    PR_CHECKS_FIRST_MS * 1.5 ** Math.max(0, attempt),
    PR_CHECKS_MAX_MS,
  );
}

/** Whether another read is worth scheduling after `reads` reads ended in `summary`. */
export function prChecksNeedPolling(
  summary: PrChecksSummary | null,
  prState: string | undefined,
  reads: number,
): boolean {
  if (prState && prState !== "open") return false;
  if (!summary) return reads < PR_CHECKS_EMPTY_READS;
  if (summary.state === "pending") return true;
  return summary.state === "none" && reads < PR_CHECKS_EMPTY_READS;
}

/** The pull request number in a GitHub URL such as `…/pull/42`. */
export function prNumberFromUrl(url: string): number | null {
  const match = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url.trim());
  const number = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
