import { visibleInterval } from "../lib/visibleInterval";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMotionOnChange } from "../hooks/useMotionOnChange";
import { useProviderUsage } from "../hooks/useProviderUsage";
import { useUsageForecasts } from "../hooks/useUsageForecasts";
import { OPEN_USAGE_EVENT } from "../lib/composerHelm";
import { contextPercent, formatTokens } from "../lib/contextUsage";
import {
  formatUsagePercent,
  idleRateLimits,
  type RateLimitProvider,
} from "../lib/rateLimits";
import {
  USAGE_WINDOW_KINDS,
  usageOutlook,
  type UsageOutlook,
  type UsageWindowKind,
} from "../lib/usageForecast";
import {
  closestUsageReading,
  contextMeterTitle,
  usageMeterFill,
  usageMeterTitle,
} from "../lib/usageMeter";
import type { ProviderUsageForecast } from "../lib/usageHistory";
import { useUsagePanelTheme, type UsagePanelSnapshot } from "../lib/usagePanel";
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

/** Windows whose limit comes before their reset at the current pace. */
function accountForecasts(
  forecast: ProviderUsageForecast | undefined,
  now: number,
): { kind: UsageWindowKind; outlook: UsageOutlook }[] {
  return USAGE_WINDOW_KINDS.flatMap((kind) => {
    const outlook = usageOutlook(forecast?.paces[kind], now);
    return outlook && outlook.state !== "clear" ? [{ kind, outlook }] : [];
  });
}

/** A fixed order, so the footer does not reshuffle as tasks change. */
const FOOTER_ORDER: readonly RateLimitProvider[] = ["claude", "codex"];

/** A small bar: the same mark for the chat's context and each account. */
function UsageMeter({
  fill,
  warning = false,
}: {
  fill: number | null;
  warning?: boolean;
}) {
  return (
    <span
      className="footer-usage-meter"
      data-unknown={fill == null || undefined}
      data-high={(fill != null && fill >= 80) || undefined}
      data-forecast={warning ? "warning" : undefined}
      aria-hidden
    >
      <span
        style={{ transform: `translateX(${Math.max(fill ?? 0, 4) - 100}%)` }}
      />
    </span>
  );
}

/** A reading that rolls into its new value when it changes. */
function UsagePercent({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useMotionOnChange(ref, children);
  return (
    <span ref={ref} className="footer-usage-percent">
      {children}
    </span>
  );
}

/**
 * Account usage in the footer: one compact meter per account for the limit
 * it is closest to, with every window and forecast in plain words on hover
 * and the full details on click.
 */
export function FooterUsage({ providers, context }: FooterUsageProps) {
  const { limits, request } = useProviderUsage(providers);
  // Changes only when usage is checked, never while an agent streams.
  const forecasts = useUsageForecasts();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => visibleInterval(() => setNow(Date.now()), 30_000), []);
  // The message box's helm offers usage as a fix when a turn fails.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_USAGE_EVENT, show);
    return () => window.removeEventListener(OPEN_USAGE_EVENT, show);
  }, []);

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
      forecasts: Object.fromEntries(
        providers.map((provider) => [
          provider,
          forecasts.providers[provider]?.paces ?? {},
        ]),
      ),
      theme,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      taskContext?.used,
      taskContext?.window,
      limits,
      providers,
      theme,
      forecasts,
    ],
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
  const outlooks = new Map(
    accounts.map((account) => [
      account.provider,
      accountForecasts(forecasts.providers[account.provider], now),
    ]),
  );
  const contextTitle = taskContext ? contextMeterTitle(taskContext) : null;
  const titles = new Map(
    accounts.map((account) => [
      account.provider,
      usageMeterTitle(account, now, outlooks.get(account.provider)),
    ]),
  );
  // The same plain words as the hover text, read as sentences.
  const label = [contextTitle, ...titles.values()]
    .flatMap((title) => title?.split("\n") ?? [])
    .map((line) => line.replace(/\.$/, ""))
    .join(". ");

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
          <span
            className="footer-usage-context"
            title={contextTitle ?? undefined}
          >
            <span className="footer-usage-muted">Context</span>
            <UsageMeter fill={contextShare} />
            <UsagePercent>{contextLabel}</UsagePercent>
          </span>
        ) : null}
        {accounts.map((account, index) => {
          const closest = closestUsageReading(account);
          const warning = (outlooks.get(account.provider) ?? []).some(
            ({ outlook }) => outlook.state === "warning",
          );
          return (
            <span
              className="footer-usage-account"
              key={account.provider}
              data-provider={account.provider}
              title={titles.get(account.provider)}
            >
              {index > 0 || contextLabel ? (
                <span className="footer-usage-divider" aria-hidden />
              ) : null}
              <ProviderMarks harnesses={[account.provider]} />
              {closest ? (
                <>
                  <UsageMeter
                    fill={usageMeterFill(closest)}
                    warning={warning}
                  />
                  <UsagePercent>
                    {formatUsagePercent(closest.window.usedPercent)}
                  </UsagePercent>
                </>
              ) : (
                <span className="footer-usage-muted">
                  {account.status === "fetching" || account.status === "idle"
                    ? "Checking usage…"
                    : "Usage unavailable"}
                </span>
              )}
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
