import { useSyncExternalStore } from "react";
import {
  getUsageForecasts,
  isRateLimitProvider,
  subscribeUsageForecasts,
  type UsageForecastSnapshot,
  type UsageWarning,
} from "../lib/usageHistory";

/** Every account's paces; changes only when usage is checked or a warning lapses. */
export function useUsageForecasts(): UsageForecastSnapshot {
  return useSyncExternalStore(
    subscribeUsageForecasts,
    getUsageForecasts,
    getUsageForecasts,
  );
}

/**
 * The active usage warning for a provider, or null. Providers that do not
 * report usage never have one. Stable between usage checks, so a component
 * using it does not render while the user types or an agent streams.
 */
export function useUsageWarning(harness: string): UsageWarning | null {
  const select = () =>
    isRateLimitProvider(harness)
      ? (getUsageForecasts().warnings[harness] ?? null)
      : null;
  return useSyncExternalStore(subscribeUsageForecasts, select, select);
}
