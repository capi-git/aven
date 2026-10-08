import { visibleInterval } from "../lib/visibleInterval";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProviderUsage } from "../hooks/useProviderUsage";
import { contextPercent, formatTokens } from "../lib/contextUsage";
import {
  formatResetDuration,
  formatUsagePercent,
  idleRateLimits,
  type ProviderRateLimits,
  type RateLimitProvider,
  type RateLimitWindow,
} from "../lib/rateLimits";
import { useUsagePanelTheme, type UsagePanelSnapshot } from "../lib/usagePanel";
import { HARNESS_TITLE } from "../lib/session";
import { Popover } from "./Popover";
import { ProviderMarks } from "./ProviderMarks";
import { RefreshCw } from "./icons";
import { UsagePanelContent } from "./UsagePanel";
import "./FooterUsage.css";

export type FooterUsageProps = {
  /** Accounts that can report usage; the footer and panel show each one. */
  providers: readonly RateLimitProvider[];
  /** The open task's reported context, if any. */
  context?: { used: number; window?: number | null } | null;
};

/** "2% 3h 57m": how much of a window is used and when it resets. */
export function usageWindowLabel(window: RateLimitWindow, now: number) {
  const used = formatUsagePercent(window.usedPercent);
  return window.resetsAt != null && Number.isFinite(window.resetsAt)
    ? `${used} ${formatResetDuration(window.resetsAt - now)}`
    : used;
}

function summary(limits: ProviderRateLimits, now: number) {
  const windows = [limits.session, limits.weekly, limits.monthly].filter(
    (window): window is RateLimitWindow => !!window,
  );
  if (windows.length) return windows.map((w) => usageWindowLabel(w, now));
  if (limits.status === "fetching" || limits.status === "idle")
    return ["Checking usage…"];
  return ["Usage unavailable"];
}

function validContext(context: FooterUsageProps["context"]) {
  if (!context || !Number.isFinite(context.used) || context.used < 0)
    return null;
  const window =
    context.window != null &&
    Number.isFinite(context.window) &&
    context.window > 0
      ? context.window
      : undefined;
  return { used: context.used, window };
}

/** A fixed order, so the footer does not reshuffle as tasks change. */
const FOOTER_ORDER: readonly RateLimitProvider[] = ["claude", "codex"];

function meterFill(limits: ProviderRateLimits) {
  const window = limits.session ?? limits.monthly ?? limits.weekly;
  return window
    ? Math.round(Math.min(100, Math.max(0, window.usedPercent)))
    : null;
}

/** Account usage in the footer: one quiet line, with details on click. */
export function FooterUsage({ providers, context }: FooterUsageProps) {
  const { limits, request } = useProviderUsage(providers);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => visibleInterval(() => setNow(Date.now()), 30_000), []);

  // Opening the details is an explicit request for every account.
  useEffect(() => {
    if (!open) return;
    for (const provider of providers) void request(provider);
  }, [open, providers, request]);

  const theme = useUsagePanelTheme(open);
  const taskContext = validContext(context);
  const snapshot = useMemo<UsagePanelSnapshot>(
    () => ({
      context: taskContext,
      costUsd: null,
      providers: providers.map(
        (provider) => limits[provider] ?? idleRateLimits(provider),
      ),
      theme,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskContext?.used, taskContext?.window, limits, providers, theme],
  );

  // An account that is not installed or signed in stays out of the footer;
  // the details panel still explains it.
  const accounts = FOOTER_ORDER.filter((provider) =>
    providers.includes(provider),
  )
    .map((provider) => limits[provider] ?? idleRateLimits(provider))
    .filter((account) => account.status !== "unavailable");
  const contextShare = contextPercent(taskContext ?? undefined);
  const contextLabel = taskContext
    ? contextShare != null
      ? `${contextShare}%`
      : formatTokens(taskContext.used)
    : null;
  const refreshing = providers.some(
    (provider) => limits[provider]?.status === "fetching",
  );
  if (!accounts.length && !contextLabel) return null;
  const label = [
    contextLabel ? `Context ${contextLabel}` : null,
    ...accounts.map(
      (account) =>
        `${HARNESS_TITLE[account.provider]} usage ${summary(account, now).join(", ")}`,
    ),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="footer-usage">
      <button
        ref={anchor}
        type="button"
        className="footer-usage-summary"
        aria-label={`${label}. Show usage details`}
        title="Usage details"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {contextLabel ? (
          <span className="footer-usage-context">
            <span className="footer-usage-muted">Context</span> {contextLabel}
          </span>
        ) : null}
        {accounts.map((account, index) => {
          const fill = meterFill(account);
          return (
            <span className="footer-usage-account" key={account.provider}>
              {index > 0 || contextLabel ? (
                <span className="footer-usage-divider" aria-hidden />
              ) : null}
              <ProviderMarks harnesses={[account.provider]} />
              <span
                className="footer-usage-meter"
                data-unknown={fill == null || undefined}
                data-high={(fill != null && fill >= 80) || undefined}
                aria-hidden
              >
                <span style={{ width: `${Math.max(fill ?? 0, 4)}%` }} />
              </span>
              <span className="footer-usage-windows">
                {summary(account, now).map((part, partIndex) => (
                  <span key={partIndex} className="footer-usage-part">
                    {partIndex > 0 ? (
                      <span className="footer-usage-muted"> · </span>
                    ) : null}
                    {part}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </button>
      {accounts.length ? (
        <button
          type="button"
          className="footer-usage-refresh"
          aria-label="Refresh usage"
          title={refreshing ? "Refreshing usage…" : "Refresh usage"}
          disabled={refreshing}
          data-spinning={refreshing || undefined}
          onClick={() => {
            for (const provider of providers) void request(provider, true);
          }}
        >
          <RefreshCw size={11} aria-hidden />
        </button>
      ) : null}
      {open ? (
        <Popover
          anchor={anchor}
          side="top"
          align="end"
          width={320}
          autoFocus
          tabIndex={-1}
          role="dialog"
          aria-label="Task and provider usage"
          panel
          onDismiss={(reason) => {
            setOpen(false);
            if (reason === "escape") anchor.current?.focus();
          }}
        >
          <UsagePanelContent
            snapshot={snapshot}
            onRefresh={() => {
              for (const provider of providers) void request(provider, true);
            }}
            onClose={() => {
              setOpen(false);
              anchor.current?.focus();
            }}
          />
        </Popover>
      ) : null}
    </div>
  );
}
