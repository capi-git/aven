import { harnessDescriptor } from "../lib/harness/descriptors";
import { AiIdea, Check, Gauge, Zap } from "./icons";
import "./ModelControls.css";
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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

// Tile shimmer ported from MonoCode 43aac9d2 / 1e97594d, extended to the
// standard effort levels. Provider order is not a strength ranking (Grok lists
// the highest first), so match values without changing what the provider gets.
type EffortTone = "low" | "medium" | "high" | "xhigh" | "ultra" | "max";

function effortTileTone(value: string): EffortTone | undefined {
  const normalized = value.toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high"
  ) {
    return normalized;
  }
  if (normalized === "xhigh" || normalized === "extra-high") return "xhigh";
  if (normalized === "max") return "max";
  if (normalized.startsWith("ultra")) return "ultra";
  return undefined;
}

/**
 * A hover tip for the levels where the choice is easy to get wrong: the quick
 * one, and the ones that cost much more time. Only shown, never chosen for
 * you.
 */
const EFFORT_HINTS: Partial<Record<EffortTone, string>> = {
  low: "Quickest replies. Good for small, clear changes.",
  xhigh: "Very thorough. Noticeably slower.",
  max: "Most thorough. Often several times slower.",
};

/** The hint for an effort value, if it has one. */
export function effortHint(value: string): string | undefined {
  const tone = effortTileTone(value);
  return tone ? EFFORT_HINTS[tone] : undefined;
}

const EFFORT_TILE_COLUMNS = 32;
const EFFORT_TILE_ROWS = 5;

function EffortTileShimmer() {
  const centerColumn = (EFFORT_TILE_COLUMNS - 1) / 2;
  const centerRow = (EFFORT_TILE_ROWS - 1) / 2;
  return (
    <span className="model-effort-tiles" aria-hidden="true">
      {Array.from(
        { length: EFFORT_TILE_COLUMNS * EFFORT_TILE_ROWS },
        (_, index) => {
          const column = index % EFFORT_TILE_COLUMNS;
          const row = Math.floor(index / EFFORT_TILE_COLUMNS);
          const distance = Math.hypot(
            (column - centerColumn) / centerColumn,
            (row - centerRow) / centerRow,
          );
          const filled = (index * 73 + index * index * 19 + 23) % 101 < 65;
          return (
            <span
              key={index}
              className={`model-effort-tile${filled ? " model-effort-tile-filled" : ""}`}
              style={{ "--tile-distance": distance } as CSSProperties}
            />
          );
        },
      )}
    </span>
  );
}

/**
 * The model's settings as sections of the agent panel: effort levels as
 * tiles, other choices as segmented buttons and on/off settings as switches.
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
  // The row under the pointer or keyboard plays the tile ripple; only that
  // row mounts its tiles.
  const [active, setActive] = useState<number | null>(null);
  const known = setting.options.some((option) => option.value === value);
  return (
    <div
      role="radiogroup"
      aria-label={setting.label}
      className="agent-effort-list"
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
        moveRadioFocus(event)
      }
      onMouseLeave={() => setActive(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setActive(null);
      }}
    >
      {setting.options.map((option, index) => {
        const selected = option.value === value;
        const tone = effortTileTone(option.value);
        const highlighted = index === active;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={effortHint(option.value)}
            tabIndex={selected || (!known && index === 0) ? 0 : -1}
            data-effort-tone={tone}
            data-effort-active={tone && highlighted ? true : undefined}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => onChange(option.value)}
            className={`model-control-option agent-choice-row${tone ? " model-effort-option" : ""}`}
          >
            {tone && highlighted ? <EffortTileShimmer /> : null}
            <span className="model-effort-dot" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {selected ? (
              <Check className="agent-choice-check" strokeWidth={2} />
            ) : null}
          </button>
        );
      })}
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
        <span className="agent-switch" aria-hidden="true" />
      </button>
    </div>
  );
}
