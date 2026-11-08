import { harnessDescriptor } from "../lib/harness/descriptors";
import { AiIdea, Gauge, Zap } from "./icons";
import "./ModelControls.css";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  getModelSnapshot,
  resolveModel,
  subscribeModels,
  type ModelSetting,
} from "../lib/models";
import type { HarnessId } from "../lib/session";
import { moveRadioFocus, PanelSection } from "./PanelSection";

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onChange: (settings: Record<string, string>) => void;
};

const SETTING_ORDER = [
  "variant",
  "agent",
  "effort",
  "reasoning",
  "thinking",
  "fast",
  "context",
];

/** Settings that pick how hard the model thinks; shown as effort tiles. */
const EFFORT_SETTINGS = new Set([
  "effort",
  "reasoning",
  "reasoningEffort",
  "thinking",
]);

/** The model's own settings, in a stable order, as provider catalogs load. */
export function useModelSettingList(
  harness: HarnessId,
  model: string,
): ModelSetting[] {
  const catalog = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  return useMemo(() => {
    void catalog;
    const list = (resolveModel(harness, model).settings ?? []).filter(
      (setting) =>
        !harnessDescriptor(harness).hiddenModelSettings?.includes(setting.id),
    );
    return [...list].sort((a, b) => {
      const ai = SETTING_ORDER.indexOf(a.id);
      const bi = SETTING_ORDER.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [catalog, harness, model]);
}

const SHORT_LABELS: Record<string, string> = {
  "Extra High": "X-High",
  Minimal: "Min",
};

/**
 * What the agent pill shows next to the model: the effort in short form and
 * whether a fast mode is on. A value the provider does not list is shown as
 * it is, rather than as the default.
 */
export function modelSettingsSummary(
  settings: readonly ModelSetting[],
  values: Record<string, string>,
): { effort: string | null; fast: boolean } {
  let effort: string | null = null;
  let fast = false;
  for (const setting of settings) {
    const value = values[setting.id] ?? setting.value;
    if (setting.kind === "toggle") {
      if (value !== "true") continue;
      if (setting.id === "fast") fast = true;
      else if (setting.id === "thinking") effort ??= setting.label;
      continue;
    }
    if (setting.id === "serviceTier" && value === "fast") fast = true;
    // Thinking switched off says nothing worth a place in the pill.
    if (
      effort === null &&
      EFFORT_SETTINGS.has(setting.id) &&
      value !== "off" &&
      value !== "none"
    ) {
      const label =
        setting.options.find((option) => option.value === value)?.label ??
        value;
      effort = SHORT_LABELS[label] ?? label;
    }
  }
  return { effort, fast };
}

/** Effort levels from weakest to strongest, by their usual names. */
function effortRank(value: string): number | undefined {
  const normalized = value.toLowerCase();
  const ranks: Readonly<Record<string, number>> = {
    none: 0,
    minimal: 1,
    low: 2,
    medium: 3,
    high: 4,
    xhigh: 5,
    "extra-high": 5,
    max: 6,
  };
  if (normalized in ranks) return ranks[normalized];
  if (normalized.startsWith("ultra")) return 7;
  return undefined;
}

/**
 * A model's effort levels, weakest first, so the dots fill left to right.
 * Providers don't all list them that way (Grok lists the highest first);
 * a list with a level we can't place keeps the provider's order.
 */
export function effortOrder<T extends { value: string }>(
  options: readonly T[],
): T[] {
  const ranked = options.map((option, index) => ({
    option,
    index,
    rank: effortRank(option.value),
  }));
  if (ranked.some((item) => item.rank === undefined)) return [...options];
  return ranked
    .sort((a, b) => a.rank! - b.rank! || a.index - b.index)
    .map((item) => item.option);
}

/**
 * A hover tip for the levels where the choice is easy to get wrong: the quick
 * one, and the ones that cost much more time. Only shown, never chosen for
 * you.
 */
const EFFORT_HINTS: Readonly<Record<string, string>> = {
  low: "Quickest replies. Good for small, clear changes.",
  xhigh: "Very thorough. Noticeably slower.",
  "extra-high": "Very thorough. Noticeably slower.",
  max: "Most thorough. Often several times slower.",
};

/** The hint for an effort value, if it has one. */
export function effortHint(value: string): string | undefined {
  return EFFORT_HINTS[value.toLowerCase()];
}

/**
 * The model's settings as sections of the agent panel: effort levels as a
 * row of dots, other choices as segmented buttons and on/off settings as switches.
 * A change applies at once and the panel stays open.
 */
export function ModelSettingsSections({
  harness,
  model,
  values,
  onChange,
}: Props) {
  const settings = useModelSettingList(harness, model);
  if (settings.length === 0) return null;

  const setValue = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <>
      {settings.map((setting) => {
        const value = values[setting.id] ?? setting.value;
        const change = (next: string) => setValue(setting.id, next);
        if (setting.kind === "toggle") {
          return (
            <ToggleSetting
              key={setting.id}
              setting={setting}
              value={value}
              onChange={change}
            />
          );
        }
        return (
          <PanelSection
            key={setting.id}
            title={setting.label}
            data-model-setting={setting.id}
          >
            {EFFORT_SETTINGS.has(setting.id) ? (
              <EffortChoices
                setting={setting}
                value={value}
                onChange={change}
              />
            ) : (
              <SegmentedChoices
                setting={setting}
                value={value}
                onChange={change}
              />
            )}
          </PanelSection>
        );
      })}
    </>
  );
}

function EffortChoices({
  setting,
  value,
  onChange,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  // The level under the pointer or keyboard: the dots light up to it, and
  // the line under them names it. Only a click or Enter chooses it.
  const [pointed, setPointed] = useState<number | null>(null);
  const options = useMemo(
    () => effortOrder(setting.options),
    [setting.options],
  );
  const selected = options.findIndex((option) => option.value === value);
  const shown = pointed ?? selected;
  const named = shown >= 0 ? options[shown] : undefined;
  const hint = named ? effortHint(named.value) : undefined;
  return (
    <div
      className="agent-effort"
      data-preview={(pointed !== null && pointed !== selected) || undefined}
    >
      <div
        role="radiogroup"
        aria-label={setting.label}
        className="agent-effort-dots"
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
          moveRadioFocus(event)
        }
        onMouseLeave={() => setPointed(null)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setPointed(null);
        }}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={index === selected}
            aria-label={option.label}
            title={effortHint(option.value)}
            tabIndex={
              index === selected || (selected < 0 && index === 0) ? 0 : -1
            }
            data-lit={index <= shown || undefined}
            onMouseEnter={() => setPointed(index)}
            onFocus={() => setPointed(index)}
            onClick={() => onChange(option.value)}
            className="model-control-option agent-effort-step"
          >
            <span className="agent-effort-pip" aria-hidden="true" />
          </button>
        ))}
      </div>
      {named ? (
        <p className="agent-effort-value" aria-hidden="true">
          {named.label}
          {hint ? ` · ${hint}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function SegmentedChoices({
  setting,
  value,
  onChange,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  const known = setting.options.some((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={setting.label}
      title={setting.description}
      className="agent-segmented"
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
        moveRadioFocus(event)
      }
    >
      {setting.options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected || (!known && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            className="model-control-option agent-segment"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleSetting({
  setting,
  value,
  onChange,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  const on = value === "true";
  const Icon =
    setting.id === "fast" ? Zap : setting.id === "thinking" ? AiIdea : Gauge;
  return (
    <div className="agent-panel-section" data-model-setting={setting.id}>
      <button
        type="button"
        role="switch"
        title={setting.description ?? setting.label}
        aria-label={setting.label}
        aria-checked={on}
        onClick={() => onChange(on ? "false" : "true")}
        className="model-control-option agent-switch-row"
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{setting.label}</span>
        <span className="aven-switch-mini" aria-hidden="true" />
      </button>
    </div>
  );
}
