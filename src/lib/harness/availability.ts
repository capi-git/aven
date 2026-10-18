import type { HarnessId } from "../session";
import { HARNESSES } from "../session";
import * as binaryResolvers from "./child";
import { harnessDescriptor } from "./descriptors";
import { getHarness } from "./registry";

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
/** Providers a lookup has answered for in this window. */
const answered = new Set<HarnessId>();
/** One native lookup per provider at a time, however many probes ask. */
const lookups = new Map<HarnessId, Promise<void>>();
const listeners = new Set<() => void>();

/**
 * A probe stats ~100 paths across eight resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

/**
 * How long one provider's lookup may hold up a probe. The native lookup reads
 * the login shell first (up to 5 s), so allow a little more. A lookup that
 * answers later still counts; it just no longer keeps every other provider,
 * and every later probe, waiting.
 */
export const HARNESS_LOOKUP_TIMEOUT_MS = 6_000;

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

/**
 * Still finding out whether this provider is installed: nothing has answered
 * for it yet, and a probe is under way or has yet to run in this window.
 */
export function isCheckingHarnessAvailability(id: HarnessId): boolean {
  if (answered.has(id) || observations.has(id)) return false;
  return inflight != null || probedAt === 0;
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

async function findBinary(id: HarnessId): Promise<boolean> {
  try {
    // This asks whether the CLI is on disk. A webview that never registers
    // the adapters (the hover sidebar) must still look, not report none.
    if (getHarness(id)?.live === false) return false;
    await binaryResolvers[harnessDescriptor(id).cli.resolve]();
    return true;
  } catch {
    return false;
  }
}

/** Look one provider up and record the answer whenever it arrives. */
function lookUp(id: HarnessId): Promise<void> {
  const running = lookups.get(id);
  if (running) return running;
  const revision = observations.get(id) ?? 0;
  const lookup = findBinary(id).then((found) => {
    lookups.delete(id);
    // A setup check that answered meanwhile is newer evidence.
    if ((observations.get(id) ?? 0) !== revision) return;
    const first = !answered.has(id);
    answered.add(id);
    if (availability[id] === found && !first) return;
    availability = { ...availability, [id]: found };
    emit();
  });
  lookups.set(id, lookup);
  return lookup;
}

/** Resolves when `work` does, or after `ms`, whichever comes first. */
function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((done) => {
    timer = setTimeout(done, ms);
  });
  return Promise.race([work, timeout])
    .then(() => undefined)
    .finally(() => clearTimeout(timer));
}

/**
 * Find out which providers are installed. Each provider is recorded as soon
 * as its own lookup answers, and none waits longer than
 * `HARNESS_LOOKUP_TIMEOUT_MS` for another, so one slow or stuck CLI never
 * leaves every provider looking uninstalled. Never rejects.
 */
export function probeHarnessAvailability(options?: {
  force?: boolean;
}): Promise<void> {
  if (inflight) return inflight;
  if (!options?.force && probedAt > 0 && Date.now() - probedAt < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  inflight = Promise.allSettled(
    HARNESSES.map((id) => settledWithin(lookUp(id), HARNESS_LOOKUP_TIMEOUT_MS)),
  )
    .then(() => undefined)
    .finally(() => {
      probedAt = Date.now();
      inflight = null;
      emit();
    });
  return inflight;
}
