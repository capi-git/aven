import { AiIdea, ChevronDown, Gauge, Maximize2, Zap } from "./icons";
import "./ModelControls.css";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Popover } from "./Popover";
import {
  getModelSnapshot,
  resolveModel,
  subscribeModels,
  type ModelSetting,
} from "../lib/models";
import type { HarnessId } from "../lib/session";

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  onChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
};

const MENU_WIDTH = 220;

// Decorative intensity only. Provider option order is not a strength ranking
// (Grok, for example, lists the highest effort first). Keep raw values intact.
const STRENGTH_PIXELS: Record<string, number> = {
  off: 0,
  none: 0,
  minimal: 2,
  low: 4,
  medium: 8,
  high: 11,
  xhigh: 13,
  max: 16,
  ultra: 16,
  ultracode: 16,
  ultrathink: 16,
};

function StrengthPixels({
  value,
  pulse = false,
  compact = false,
}: {
  value: string;
  pulse?: boolean;
  compact?: boolean;
}) {
  const count = Object.prototype.hasOwnProperty.call(STRENGTH_PIXELS, value)
    ? STRENGTH_PIXELS[value]
    : undefined;
  // Future provider modes (such as adaptive) have no known intensity. Retain
  // their neutral icon rather than making them look like disabled reasoning.
  if (count === undefined) {
    return (
      <Gauge
        aria-hidden="true"
        className={`${compact ? "size-3.5" : "ml-3 size-4.5"} shrink-0 text-content/50`}
        strokeWidth={1.75}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`model-strength-pixels ${compact ? "model-strength-pixels-compact" : ""}`}
      data-pulse={pulse || undefined}
    >
      {Array.from({ length: 16 }, (_, index) => {
        const row = Math.floor(index / 4);
        const column = index % 4;
        const order = (3 - row) * 4 + column;
        return (
          <span
            key={index}
            className={`model-strength-pixel ${order < count ? "model-strength-pixel-lit" : ""}`}
            style={{ animationDelay: `${(3 - row) * 35 + column * 22}ms` }}
          />
        );
      })}
    </span>
  );
}

export function ModelSettings({
  harness,
  model,
  values,
  onChange,
  onClose,
}: Props) {
  const catalog = useSyncCatalog();
  const settings = useMemo(() => {
    void catalog;
    const list = (resolveModel(harness, model).settings ?? []).filter(
      (setting) => !(harness === "opencode" && setting.id === "agent"),
    );
    const order = [
      "variant",
      "agent",
      "effort",
      "reasoning",
      "thinking",
      "fast",
      "context",
    ];
    return [...list].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [catalog, harness, model]);

  if (settings.length === 0) return null;

  const setValue = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <>
      {settings.map((setting) =>
        setting.kind === "toggle" ? (
          <ToggleSetting
            key={setting.id}
            setting={setting}
            value={values[setting.id] ?? setting.value}
            onChange={(value) => setValue(setting.id, value)}
          />
        ) : (
          <SelectSetting
            key={setting.id}
            setting={setting}
            value={values[setting.id] ?? setting.value}
            onChange={(value) => setValue(setting.id, value)}
            onClose={onClose}
          />
        ),
      )}
    </>
  );
}

function useSyncCatalog(): number {
  const [version, setVersion] = useState(getModelSnapshot);
  useEffect(() => subscribeModels(() => setVersion(getModelSnapshot())), []);
  return version;
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
    <button
      type="button"
      title={setting.description ?? setting.label}
      aria-label={setting.label}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onChange(on ? "false" : "true")}
      className={`model-control flex h-6.5 items-center gap-1 rounded-md px-1.5 ${
        on
          ? "bg-content/20 text-content"
          : "bg-content/10 text-content/50 hover:bg-content/15 hover:text-content"
      }`}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span key={value} className="model-control-value text-[11px]">
        {setting.label}
      </span>
    </button>
  );
}

function SelectSetting({
  setting,
  value,
  onChange,
  onClose,
}: {
  setting: ModelSetting;
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectionPulse, setSelectionPulse] = useState(0);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      setting.options.findIndex((option) => option.value === value),
    ),
  );
  const root = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const current =
    setting.options.find((option) => option.value === value) ??
    setting.options[0];
  const Icon = setting.id === "context" ? Maximize2 : Gauge;
  const strength = [
    "effort",
    "reasoning",
    "reasoningEffort",
    "thinking",
  ].includes(setting.id);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    if (restore) onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        setting.options.findIndex((option) => option.value === value),
      ),
    );
  }, [open, setting.options, value]);

  const pick = (next: string) => {
    if (strength) setSelectionPulse((pulse) => pulse + 1);
    onChange(next);
    dismiss(true);
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(setting.options.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = setting.options[active];
      if (option) pick(option.value);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        title={setting.description ?? setting.label}
        aria-label={`${setting.label}: ${current?.label ?? value}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            dismiss(true);
            return;
          }
          setOpen(true);
        }}
        className={`model-control flex h-6.5 max-w-36 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-content/10 text-content"
            : "bg-content/10 text-content hover:bg-content/15"
        }`}
      >
        {strength ? (
          <StrengthPixels
            key={`${value}:${selectionPulse}`}
            value={current?.value ?? value}
            pulse={selectionPulse > 0}
            compact
          />
        ) : (
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
        )}
        <span
          key={value}
          className="model-control-value min-w-0 truncate text-[11px]"
        >
          {current?.label ?? setting.label}
        </span>
        <ChevronDown
          className={`model-control-chevron size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>
      {open ? (
        <Popover
          anchor={root}
          side="top"
          width={MENU_WIDTH}
          autoFocus
          onDismiss={(reason) => dismiss(reason === "escape")}
          role="listbox"
          aria-label={setting.label}
          data-model-settings
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="p-1"
        >
          {setting.options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === active;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-strength-active={
                  strength && highlighted ? true : undefined
                }
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option.value)}
                className={`model-control-option flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] ${
                  highlighted || selected
                    ? "bg-content/10 text-content"
                    : "text-content hover:bg-content/5"
                }`}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {strength ? (
                  <StrengthPixels value={option.value} pulse={highlighted} />
                ) : null}
              </button>
            );
          })}
        </Popover>
      ) : null}
    </div>
  );
}
