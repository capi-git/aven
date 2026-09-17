import { useEffect, useState, type CSSProperties } from "react";
import { formatTokens } from "../lib/contextUsage";
import {
  formatResetCountdown,
  type ProviderRateLimits,
  type RateLimitWindow,
} from "../lib/rateLimits";
import type { UsagePanelSnapshot } from "../lib/usagePanel";
import { ProviderMarks } from "./ProviderMarks";
import { RefreshCw, X } from "./icons";
import "./UsagePanel.css";

export type UsagePanelContentProps = {
  snapshot: UsagePanelSnapshot;
  onRefresh: () => void;
  onClose: () => void;
};

function remainingPercent(used: number): number | null {
  return Number.isFinite(used)
    ? Math.round(100 - Math.min(100, Math.max(0, used)))
    : null;
}

function RemainingBar({
  label,
  remaining,
  loading = false,
}: {
  label: string;
  remaining: number | null;
  loading?: boolean;
}) {
  return (
    <div
      className="usage-panel-track"
      role="progressbar"
      aria-label={`${label} remaining`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={remaining ?? undefined}
      aria-valuetext={
        remaining == null
          ? loading
            ? "Checking usage"
            : "Unknown"
          : `${remaining}% remaining`
      }
      data-unknown={remaining == null || undefined}
      data-loading={loading || undefined}
      data-low={(remaining != null && remaining <= 10) || undefined}
    >
      {remaining != null && (
        <span className="usage-panel-fill" style={{ width: `${remaining}%` }} />
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
}: {
  provider: string;
  label: string;
  window: RateLimitWindow | null;
  status: ProviderRateLimits["status"];
  now: number;
}) {
  const remaining = window ? remainingPercent(window.usedPercent) : null;
  const loading = status === "fetching";
  const reset = window?.resetsAt;
  const hasReset = reset != null && Number.isFinite(reset);
  const detail =
    remaining == null
      ? loading
        ? "Checking usage…"
        : status === "idle"
          ? "Not checked yet"
          : status === "error" || status === "unavailable"
            ? "Usage unavailable"
            : "Not reported by provider"
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
          {remaining == null ? (
            "—"
          ) : (
            <>
              <strong>{remaining}%</strong> left
            </>
          )}
        </span>
      </div>
      <RemainingBar
        label={`${provider} ${label}`}
        remaining={remaining}
        loading={loading}
      />
      <div
        className="usage-panel-detail"
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
}: {
  limits: ProviderRateLimits;
  now: number;
}) {
  const name = limits.provider === "claude" ? "Claude Code" : "Codex";
  const cached = Boolean(limits.session || limits.weekly);
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
      />
      <RateWindow
        provider={name}
        label="Weekly"
        window={limits.weekly}
        status={limits.status}
        now={now}
      />
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const context = snapshot.context;
  const hasUsed =
    context != null && Number.isFinite(context.used) && context.used >= 0;
  const hasCapacity =
    context?.window != null &&
    Number.isFinite(context.window) &&
    context.window > 0;
  const remaining =
    hasUsed && hasCapacity
      ? remainingPercent((context.used / context.window!) * 100)
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
    <div
      className="usage-panel"
      data-theme={snapshot.theme.mode}
      style={
        {
          "--usage-accent": snapshot.theme.accent,
          "--usage-bg": snapshot.theme.background,
          "--usage-text": snapshot.theme.text,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="usage-panel-header">
        <h2>Usage</h2>
        <div className="usage-panel-actions">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh provider usage"
            title={refreshing ? "Refreshing usage…" : "Refresh provider usage"}
          >
            <RefreshCw size={16} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close usage"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="usage-panel-body">
        <section
          className="usage-panel-context"
          aria-label="Selected task context"
        >
          <div className="usage-panel-row">
            <h3>Context</h3>
            <span className="usage-panel-remaining">
              {remaining == null ? (
                "—"
              ) : (
                <>
                  <strong>{remaining}%</strong> left
                </>
              )}
            </span>
          </div>
          <RemainingBar label="Selected task context" remaining={remaining} />
          <div className="usage-panel-detail">
            {hasUsed ? (
              <>
                {remaining != null && `${100 - remaining}% used · `}
                {formatTokens(context.used)}
                {hasCapacity && ` / ${formatTokens(context.window!)}`} tokens
                {!hasCapacity && " used · capacity unavailable"}
              </>
            ) : (
              "Available after the task reports usage"
            )}
          </div>
        </section>
        {snapshot.providers.map((provider) => (
          <ProviderUsage key={provider.provider} limits={provider} now={now} />
        ))}
        {!snapshot.providers.length && (
          <p className="usage-panel-empty">
            Provider usage is not available for this task.
          </p>
        )}
      </div>
      <footer className="usage-panel-footer">
        <span>Provider limits apply across tasks.</span>
        {cost != null && (
          <span title="Provider-reported cost for the selected task">
            Task cost <strong>${cost.toFixed(2)}</strong>
          </span>
        )}
      </footer>
    </div>
  );
}
