import type { AgentModel } from "./models";
import type { HarnessId } from "./session";
import {
  USAGE_WINDOW_KINDS,
  USAGE_WINDOW_NAME,
  type UsageWindowKind,
} from "./usageForecast";
import type {
  ProviderUsageForecast,
  UsageForecastSnapshot,
  UsageWarning,
} from "./usageHistory";

/** Another account counts as having room while every window is below this. */
export const HEADROOM_MAX_USED = 80;

export type UsageAlternative = {
  kind: "provider" | "model";
  harness: HarnessId;
  model: string;
  /** Button text: "Switch to Codex", "Use Claude Sonnet 5". */
  label: string;
  /** What the button does, for its tooltip. */
  detail: string;
};

/**
 * Rough weight from the model's name: 0 for small models (Haiku, mini),
 * 1 for standard ones (Sonnet, most), 2 for the largest (Opus, Fable, Pro).
 */
export function modelWeight(model: Pick<AgentModel, "id" | "name">): number {
  const text = `${model.id} ${model.name}`.toLowerCase();
  if (/\b(haiku|mini|nano|lite|flash|spark|small)\b/.test(text)) return 0;
  if (/\bsonnet\b/.test(text)) return 1;
  if (/\b(opus|fable|pro|max)\b/.test(text)) return 2;
  return 1;
}

/**
 * The next lighter model of the same provider: one step down (Opus to
 * Sonnet, not Haiku), preferring the provider's preferred model and then
 * catalog order, which lists newer models first.
 */
export function lighterModel(
  current: AgentModel,
  catalog: readonly AgentModel[],
  preferredId?: string,
): AgentModel | null {
  const weight = modelWeight(current);
  const lighter = catalog.filter(
    (model) => model.id !== current.id && modelWeight(model) < weight,
  );
  if (!lighter.length) return null;
  const step = Math.max(...lighter.map(modelWeight));
  const candidates = lighter.filter((model) => modelWeight(model) === step);
  return candidates.find((model) => model.id === preferredId) ?? candidates[0];
}

/**
 * The fullest current window of an account, when it has room in every one;
 * null when any window is close to its limit, about to warn, or unknown.
 */
export function accountHeadroom(
  forecast: ProviderUsageForecast | undefined,
  warning: UsageWarning | undefined,
  now: number,
): { kind: UsageWindowKind; used: number } | null {
  if (!forecast || warning) return null;
  let fullest: { kind: UsageWindowKind; used: number } | null = null;
  for (const kind of USAGE_WINDOW_KINDS) {
    const latest = forecast.latest[kind];
    if (!latest) continue;
    // A window that has reset since its last reading starts empty.
    const used =
      latest.resetsAt != null && now >= latest.resetsAt ? 0 : latest.used;
    if (used >= HEADROOM_MAX_USED) return null;
    if (!fullest || used > fullest.used) fullest = { kind, used };
  }
  return fullest;
}

const RATE_LIMIT_HARNESSES = ["claude", "codex"] as const;

/**
 * One-click ways out of a usage warning: another installed account that has
 * room, and a lighter model of the same provider.
 */
export function usageAlternatives(input: {
  harness: HarnessId;
  current: AgentModel;
  forecasts: UsageForecastSnapshot;
  now: number;
  isAvailable: (harness: HarnessId) => boolean;
  catalog: (harness: HarnessId) => readonly AgentModel[];
  preferred: (harness: HarnessId) => string;
  title: (harness: HarnessId) => string;
}): UsageAlternative[] {
  const alternatives: UsageAlternative[] = [];
  for (const other of RATE_LIMIT_HARNESSES) {
    if (other === input.harness || !input.isAvailable(other)) continue;
    const room = accountHeadroom(
      input.forecasts.providers[other],
      input.forecasts.warnings[other],
      input.now,
    );
    if (!room) continue;
    const catalog = input.catalog(other);
    const preferredId = input.preferred(other);
    const model = catalog.find((item) => item.id === preferredId) ?? catalog[0];
    if (!model) continue;
    alternatives.push({
      kind: "provider",
      harness: other,
      model: model.id,
      label: `Switch to ${input.title(other)}`,
      detail: `Continue with ${input.title(other)} · ${model.name} (${Math.round(100 - room.used)}% of its ${USAGE_WINDOW_NAME[room.kind]} limit left)`,
    });
    break;
  }
  const lighter = lighterModel(
    input.current,
    input.catalog(input.harness),
    input.preferred(input.harness),
  );
  if (lighter) {
    alternatives.push({
      kind: "model",
      harness: input.harness,
      model: lighter.id,
      label: `Use ${lighter.name}`,
      detail: `Switch to ${lighter.name}, which uses less of the limit`,
    });
  }
  return alternatives;
}
