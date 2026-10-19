import { harnessDescriptor } from "../lib/harness/descriptors";
import { visibleInterval } from "../lib/visibleInterval";
import { useEffect, useState } from "react";
import { formatTokens } from "../lib/contextUsage";
import {
  formatResetCountdown,
  hasRateLimitWindows,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../lib/rateLimits";
import {
  formatForecastDetail,
  usageOutlook,
  type UsagePace,
  type UsageWindowKind,
} from "../lib/usageForecast";
import type { UsagePanelSnapshot } from "../lib/usagePanel";
import { ProviderMarks } from "./ProviderMarks";
import { RefreshCw } from "./icons";
import { ToolbarPanel, ToolbarPanelHeader } from "./ToolbarPanel";
import "./UsagePanel.css";

export type UsagePanelContentProps = {
  snapshot: UsagePanelSnapshot;
  onRefresh: () => void;
  onClose: () => void;
};

/**
 * Whole percent used, as the footer rounds it, so the two always agree.
 */
function usedPercent(used: number): number | null {
  return Number.isFinite(used)
    ? Math.round(Math.min(100, Math.max(0, used)))
    : null;
}

/** How much is used, filling up as the footer's meter does. */
function UsedBar({
  label,
  used,
  loading = false,
}: {
  label: string;
  used: number | null;
  loading?: boolean;
}) {
  return (
    <div
      className="usage-panel-track"
      role="progressbar"
      aria-label={`${label} used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={used ?? undefined}
      aria-valuetext={
        used == null
          ? loading
            ? "Checking usage"
            : "Unknown"
          : `${used}% used`
      }
      data-unknown={used == null || undefined}
      data-loading={loading || undefined}
      data-low={(used != null && used >= 90) || undefined}
    >
      {used != null && (
        <span className="usage-panel-fill" style={{ width: `${used}%` }} />
      )}
    </div>
  );
}

function RateWindow({
  provider,
  label,
  window,
  status,
  now,
  pace,
}: {
  provider: string;
  label: string;
  window: RateLimitWindow | null;
  status: ProviderRateLimits["status"];
  now: number;
  /** How fast this window is filling, when there is enough to tell. */
  pace?: UsagePace;
}) {
  const used = window ? usedPercent(window.usedPercent) : null;
  const loading = status === "fetching";
  const reset = window?.resetsAt;
  const hasReset = reset != null && Number.isFinite(reset);
  const outlook = window ? usageOutlook(pace, now) : null;
  // Only a limit that comes before the reset is worth a line.
  const forecast = outlook?.state === "clear" ? null : outlook;
  const detail =
    used == null
      ? loading
        ? "Checking usage…"
        : status === "idle"
          ? "Not checked yet"
          : status === "error" || status === "unavailable"
            ? "Usage unavailable"
            : "Not reported by provider"
      : forecast
        ? formatForecastDetail(forecast)
        : hasReset
          ? reset <= now
            ? "Reset due · refresh usage"
            : formatResetCountdown(reset - now)
          : "Reset time not reported";
  return (
    <div className="usage-panel-window">
      <div className="usage-panel-row">
        <span className="usage-panel-label">{label}</span>
        <span className="usage-panel-remaining">
          {used == null ? (
            "—"
          ) : (
            <>
              <strong>{used}%</strong> used
            </>
          )}
        </span>
      </div>
      <UsedBar label={`${provider} ${label}`} used={used} loading={loading} />
      <div
        className="usage-panel-detail"
        data-warning={forecast?.state === "warning" || undefined}
        title={
          hasReset ? `Resets ${new Date(reset).toLocaleString()}` : undefined
        }
      >
        {detail}
      </div>
    </div>
  );
}

function ProviderUsage({
  limits,
  now,
  paces,
}: {
  limits: ProviderRateLimits;
  now: number;
  paces?: Partial<Record<UsageWindowKind, UsagePace>>;
}) {
  const name = harnessDescriptor(limits.provider).title;
  const cached = hasRateLimitWindows(limits);
  const failed = limits.status === "error" || limits.status === "unavailable";
  const status =
    limits.status === "fetching"
      ? cached
        ? "Refreshing…"
        : "Checking…"
      : failed
        ? cached
          ? "Last known usage"
          : "Unavailable"
        : limits.status === "idle"
          ? "Not checked"
          : null;
  return (
    <section className="usage-panel-section" aria-label={`${name} usage`}>
      <div className="usage-panel-provider-heading">
        <h3>
          <ProviderMarks harnesses={[limits.provider]} />
          {name}
        </h3>
        {status && (
          <span
            className="usage-panel-provider-status"
            data-warning={failed || undefined}
          >
            {status}
          </span>
        )}
      </div>
      <RateWindow
        provider={name}
        label="5-hour"
        window={limits.session}
        status={limits.status}
        now={now}
        pace={paces?.session}
      />
      <RateWindow
        provider={name}
        label="Weekly"
        window={limits.weekly}
        status={limits.status}
        now={now}
        pace={paces?.weekly}
      />
      {harnessDescriptor(limits.provider).usage?.scopedWeekly &&
        limits.scopedWeekly?.map((limit, index) => (
          <RateWindow
            key={`${limit.model}-${index}`}
            provider={name}
            label={`${limit.model} weekly`}
            window={limit.window}
            status={limits.status}
            now={now}
          />
        ))}
      {limits.monthly && (
        <RateWindow
          provider={name}
          label="Monthly"
          window={limits.monthly}
          status={limits.status}
          now={now}
          pace={paces?.monthly}
        />
      )}
      {failed && limits.error && (
        <p className="usage-panel-error" role="status" title={limits.error}>
          {limits.error}
        </p>
      )}
    </section>
  );
}

/** Rendered in its own native panel so the embedded browser stays visible. */
export function UsagePanelContent({
  snapshot,
  onRefresh,
  onClose,
}: UsagePanelContentProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => visibleInterval(() => setNow(Date.now()), 30_000), []);
  const context = snapshot.context;
  const hasUsed =
    context != null && Number.isFinite(context.used) && context.used >= 0;
  const hasCapacity =
    context?.window != null &&
    Number.isFinite(context.window) &&
    context.window > 0;
  const used =
    hasUsed && hasCapacity
      ? usedPercent((context.used / context.window!) * 100)
      : null;
  const refreshing = snapshot.providers.some(
    (provider) => provider.status === "fetching",
  );
  const cost =
    snapshot.costUsd != null &&
    Number.isFinite(snapshot.costUsd) &&
    snapshot.costUsd >= 0
      ? snapshot.costUsd
      : null;
  return (
    <ToolbarPanel
      className="usage-panel"
      theme={snapshot.theme}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <ToolbarPanelHeader
        title="Usage"
        onClose={onClose}
        closeLabel="Close usage"
        actions={
          <button
            type="button"
            className="toolbar-panel-icon-button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh provider usage"
            title={refreshing ? "Refreshing usage…" : "Refresh provider usage"}
          >
            <RefreshCw size={16} />
          </button>
        }
      />
      <div className="usage-panel-body">
        <section
          className="usage-panel-context"
          aria-label="This chat's context"
        >
          <div className="usage-panel-row">
            <h3>Context</h3>
            <span className="usage-panel-remaining">
              {used == null ? (
                "—"
              ) : (
                <>
                  <strong>{used}%</strong> used
                </>
              )}
            </span>
          </div>
          <UsedBar label="This chat's context" used={used} />
          <div className="usage-panel-detail">
            {hasUsed ? (
              <>
                {formatTokens(context.used)}
                {hasCapacity && ` of ${formatTokens(context.window!)}`} tokens
                {!hasCapacity && " used · capacity unavailable"}
              </>
            ) : (
              "Shows after the agent's next reply"
            )}
          </div>
        </section>
        {snapshot.providers.map((provider) => (
          <ProviderUsage
            key={provider.provider}
            limits={provider}
            now={now}
            paces={snapshot.forecasts?.[provider.provider]}
          />
        ))}
        {!snapshot.providers.length && (
          <p className="usage-panel-empty">
            Provider usage is not available for this chat.
          </p>
        )}
      </div>
      <footer className="usage-panel-footer">
        <span>Provider limits apply across all your chats.</span>
        {cost != null && (
          <span title="What the provider reports this chat has cost">
            Chat cost <strong>${cost.toFixed(2)}</strong>
          </span>
        )}
      </footer>
    </ToolbarPanel>
  );
}
