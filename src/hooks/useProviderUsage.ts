import { useCallback, useEffect, useRef, useState } from "react";
import {
  errorRateLimits,
  fetchingRateLimits,
  idleRateLimits,
  RATE_LIMIT_POLL_MS,
  shouldFetchProvider,
  type ProviderRateLimits,
  type RateLimitProvider,
} from "../lib/rateLimits";

const documentVisible = () => document.visibilityState !== "hidden";

export type ProviderUsage = {
  limits: Partial<Record<RateLimitProvider, ProviderRateLimits>>;
  /** Loads a provider unless a fresh snapshot exists; `force` always reloads. */
  request: (provider: RateLimitProvider, force?: boolean) => Promise<void>;
};

/**
 * Account usage for the footer. Only `watched` providers load in the
 * background: once when shown, then on the shared poll interval while the
 * window is visible. Others load when the usage panel asks for them.
 */
export function useProviderUsage(
  watched: readonly RateLimitProvider[],
): ProviderUsage {
  const alive = useRef(true);
  const api = useRef<Promise<typeof import("../lib/rateLimitsFetch")> | null>(
    null,
  );
  const inflight = useRef(new Map<RateLimitProvider, Promise<void>>());
  const [limits, setLimits] = useState<ProviderUsage["limits"]>({});
  const limitsRef = useRef(limits);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const request = useCallback(
    (provider: RateLimitProvider, force = false): Promise<void> => {
      const pending = inflight.current.get(provider);
      if (pending) return pending;
      if (!documentVisible()) return Promise.resolve();
      const current = limitsRef.current[provider] ?? idleRateLimits(provider);
      if (!shouldFetchProvider(current, { force, visible: true }))
        return Promise.resolve();
      const publish = (value: ProviderRateLimits) => {
        if (!alive.current) return;
        limitsRef.current = { ...limitsRef.current, [provider]: value };
        setLimits(limitsRef.current);
      };
      const work = async () => {
        publish(fetchingRateLimits(provider, current));
        try {
          api.current ??= import("../lib/rateLimitsFetch").catch((error) => {
            api.current = null;
            throw error;
          });
          const fetchers = await api.current;
          if (!alive.current) return;
          const value = await (provider === "claude"
            ? fetchers.fetchClaudeRateLimits()
            : fetchers.fetchCodexRateLimits());
          publish(value);
        } catch (error) {
          publish(
            errorRateLimits(
              provider,
              error instanceof Error ? error.message : "Usage unavailable",
              current,
            ),
          );
        } finally {
          inflight.current.delete(provider);
        }
      };
      const promise = work();
      inflight.current.set(provider, promise);
      return promise;
    },
    [],
  );

  const watchedKey = [...new Set(watched)].sort().join(",");
  useEffect(() => {
    if (!watchedKey) return;
    const providers = watchedKey.split(",") as RateLimitProvider[];
    // Stale checks keep focus changes and remounts from refetching early.
    const load = () => {
      for (const provider of providers) void request(provider);
    };
    load();
    const timer = window.setInterval(load, RATE_LIMIT_POLL_MS);
    const onVisible = () => {
      if (documentVisible()) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watchedKey, request]);

  return { limits, request };
}
