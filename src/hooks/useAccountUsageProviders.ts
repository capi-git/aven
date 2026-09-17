import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "../lib/harness/availability";
import type { RateLimitProvider } from "../lib/rateLimits";
import type { Session } from "../lib/session";

const SUPPORTED_PROVIDERS = ["codex", "claude"] as const;
const availableProviderKey = () =>
  SUPPORTED_PROVIDERS.filter(isHarnessAvailable).join(",");

/** Account limits are independent of the selected project or model picker. */
export function useAccountUsageProviders(
  sessions: readonly Pick<Session, "harness">[],
): readonly RateLimitProvider[] {
  const availableKey = useSyncExternalStore(
    subscribeHarnessAvailability,
    availableProviderKey,
    availableProviderKey,
  );
  // Keep open sessions represented during discovery or a failed CLI lookup.
  // Fetch failures belong inside their provider section, never in this filter.
  const sessionKey = SUPPORTED_PROVIDERS.filter((provider) =>
    sessions.some((session) => session.harness === provider),
  ).join(",");
  const observedKey = `${availableKey},${sessionKey}`;
  const [knownKey, setKnownKey] = useState(observedKey);
  useEffect(() => {
    setKnownKey((previous) => {
      const known = new Set(`${previous},${observedKey}`.split(","));
      return SUPPORTED_PROVIDERS.filter((provider) => known.has(provider)).join(
        ",",
      );
    });
  }, [observedKey]);
  return useMemo(() => {
    // A transient availability failure must not remove an account we already
    // displayed. Its next explicit usage refresh can explain any error.
    const known = new Set(`${knownKey},${observedKey}`.split(","));
    return SUPPORTED_PROVIDERS.filter((provider) => known.has(provider));
  }, [knownKey, observedKey]);
}
