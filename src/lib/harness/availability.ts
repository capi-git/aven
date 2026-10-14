import type { HarnessId } from "../session";
import { HARNESSES } from "../session";
import * as binaryResolvers from "./child";
import { harnessDescriptor } from "./descriptors";
import { isLiveHarness } from "./registry";

export type HarnessAvailability = Record<HarnessId, boolean>;

let availability: HarnessAvailability = {
  claude: false,
  codex: false,
  cursor: false,
  grok: false,
  opencode: false,
  pi: false,
  omp: false,
  fx: false,
};
let version = 0;
let inflight: Promise<void> | null = null;
let probedAt = 0;
// A selected-provider setup check is newer evidence than a full probe that
// started before it. Revisions keep that older probe from undoing the result.
const observations = new Map<HarnessId, number>();
const listeners = new Set<() => void>();

/**
 * A probe stats ~100 paths across eight resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeHarnessAvailability(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getHarnessAvailabilitySnapshot(): number {
  return version;
}

export function hasProbedHarnessAvailability(): boolean {
  return probedAt > 0;
}

export function isHarnessAvailable(id: HarnessId): boolean {
  return availability[id];
}

/** Record binary presence discovered by a selected-provider setup check.
 * This neither probes other providers nor makes the full-store cache fresh. */
export function recordHarnessAvailability(
  id: HarnessId,
  available: boolean,
): void {
  observations.set(id, (observations.get(id) ?? 0) + 1);
  if (availability[id] === available) return;
  availability = { ...availability, [id]: available };
  emit();
}

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = harnessDescriptor(id).cli;
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart Aven if it is already installed.`;
}

export function probeHarnessAvailability(options?: {
  force?: boolean;
}): Promise<void> {
  if (inflight) return inflight;
  if (!options?.force && probedAt > 0 && Date.now() - probedAt < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  const startingObservations = new Map(observations);
  inflight = Promise.all(
    HARNESSES.map(async (id) => {
      if (!isLiveHarness(id)) return [id, false] as const;
      try {
        await binaryResolvers[harnessDescriptor(id).cli.resolve]();
        return [id, true] as const;
      } catch {
        return [id, false] as const;
      }
    }),
  )
    .then((entries) => {
      const next = { ...availability };
      for (const [id, ok] of entries) {
        if ((observations.get(id) ?? 0) === (startingObservations.get(id) ?? 0))
          next[id] = ok;
      }
      availability = next;
      emit();
    })
    .finally(() => {
      probedAt = Date.now();
      inflight = null;
    });
  return inflight;
}
