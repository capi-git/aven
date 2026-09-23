import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { playCue } from "../lib/sounds";
import { Popover } from "../chrome/Popover";
import { ToolbarPanel } from "../chrome/ToolbarPanel";
import { Check, ChevronDown } from "../chrome/icons";
import { LAYER } from "../lib/layers";
import { useUsagePanelTheme } from "../lib/usagePanel";
import { settingSearchAnchor as settingAnchor } from "../lib/settingsSearch";
export { settingSearchAnchor as settingAnchor } from "../lib/settingsSearch";
import "./SettingsControls.css";

const RowDescription = createContext<string | undefined>(undefined);

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="settings-page-header">
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

export function Heading({
  title,
  first = false,
}: {
  title: string;
  first?: boolean;
}) {
  return (
    <h2 className={`settings-heading${first ? " settings-heading-first" : ""}`}>
      {title}
    </h2>
  );
}

export function SettingsGroup({
  title,
  description,
  scope,
  children,
  id,
}: {
  title: string;
  description?: string;
  scope?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const generatedId = useId();
  const titleId = `${id ?? generatedId}-title`;
  return (
    <section
      className="settings-group"
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-labelledby={titleId}
    >
      <header className="settings-group-header">
        <div className="settings-group-intro">
          <h2 id={titleId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {scope ? <span className="settings-group-scope">{scope}</span> : null}
      </header>
      <div className="settings-group-surface">{children}</div>
    </section>
  );
}

export function Row({
  label,
  description,
  children,
  id,
}: {
  label: ReactNode;
  description?: string;
  children?: ReactNode;
  id?: string;
}) {
  const generatedId = useId();
  const anchor =
    id ??
    (typeof label === "string"
      ? settingAnchor(label)
      : `setting-${generatedId}`);
  const labelId = `${anchor}-label`;
  const descriptionId = description ? `${anchor}-description` : undefined;
  return (
    <div
      className="settings-row"
      id={anchor}
      tabIndex={-1}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <div className="settings-row-copy">
        <div className="settings-row-label" id={labelId}>
          {label}
        </div>
        {description ? (
          <p className="settings-row-description" id={descriptionId}>
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <RowDescription.Provider value={descriptionId}>
          <div className="settings-row-control">{children}</div>
        </RowDescription.Provider>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const descriptionId = useContext(RowDescription);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      className="settings-segmented"
      role="radiogroup"
      aria-label={label}
      aria-describedby={descriptionId}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            buttons.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={selectedIndex === index ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight" || event.key === "ArrowDown")
              next = (index + 1) % options.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
              next = (index - 1 + options.length) % options.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = options.length - 1;
            else return;
            event.preventDefault();
            onChange(options[next]!.value);
            buttons.current[next]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const descriptionId = useContext(RowDescription);
  const inputId = useId();
  const fill =
    max > min
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : 0;
  return (
    <div className="settings-slider" data-disabled={disabled || undefined}>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-describedby={descriptionId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        disabled={disabled}
        style={{ "--settings-slider-fill": `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={inputId} aria-hidden="true">
        {display}
      </output>
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const descriptionId = useContext(RowDescription);
  return (
    <button
      className="settings-toggle"
      type="button"
      role="switch"
      aria-label={label}
      aria-describedby={descriptionId}
      aria-checked={on}
      disabled={disabled}
      onClick={() => {
        onChange(!on);
        playCue("switch");
      }}
    >
      <span className="settings-toggle-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
  disabled = false,
  fullWidth = false,
}: {
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const descriptionId = useContext(RowDescription);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [width, setWidth] = useState(240);
  const [layer, setLayer] = useState<number>(LAYER.popover);
  const typeahead = useRef({ text: "", time: 0 });
  const theme = useUsagePanelTheme(open);
  const enabled = options.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value);
  const unavailable = disabled || !enabled.length;
  const expanded = open && !unavailable;
  const activeValue = enabled.some((option) => option.value === active)
    ? active
    : (enabled.find((option) => option.value === value)?.value ??
      enabled[0]?.value);
  const activeIndex = options.findIndex(
    (option) => option.value === activeValue,
  );
  const dismiss = (restoreFocus: boolean) => {
    setOpen(false);
    typeahead.current = { text: "", time: 0 };
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const show = (next?: string) => {
    if (unavailable) return;
    const element = trigger.current;
    element?.focus({ preventScroll: true });
    setWidth(
      Math.max(
        220,
        Math.min(340, element?.getBoundingClientRect().width ?? 240),
      ),
    );
    setLayer(
      element?.closest('[role="dialog"], [role="alertdialog"]')
        ? LAYER.dialog + 1
        : LAYER.popover,
    );
    setActive(
      next ??
        enabled.find((option) => option.value === value)?.value ??
        enabled[0]?.value ??
        null,
    );
    setOpen(true);
  };
  const choose = (next: string) => {
    if (unavailable || !enabled.some((option) => option.value === next)) return;
    dismiss(true);
    if (next !== value) onChange(next);
  };
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const option = list.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    option?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, activeValue]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className={`settings-select${fullWidth ? " settings-select-full-width" : ""}`}
        aria-label={label}
        aria-describedby={descriptionId}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={
          expanded && activeIndex >= 0
            ? `${listId}-option-${activeIndex}`
            : undefined
        }
        disabled={unavailable}
        onClick={() => (expanded ? dismiss(false) : show())}
        onBlur={() => dismiss(false)}
        onKeyDown={(event) => {
          if (
            unavailable ||
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          const key = event.key;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
            event.preventDefault();
            let next = activeValue;
            if (key === "Home") next = enabled[0]?.value;
            else if (key === "End") next = enabled[enabled.length - 1]?.value;
            else if (expanded) {
              const index = enabled.findIndex(
                (option) => option.value === activeValue,
              );
              next =
                enabled[
                  (index + (key === "ArrowDown" ? 1 : -1) + enabled.length) %
                    enabled.length
                ]?.value;
            }
            if (expanded) setActive(next ?? null);
            else show(next ?? undefined);
          } else if (key === "Enter" || key === " ") {
            event.preventDefault();
            if (expanded && activeValue != null) choose(activeValue);
            else show();
          } else if (key === "Escape" && expanded) {
            event.preventDefault();
            event.stopPropagation();
            dismiss(true);
          } else if (key === "Tab") dismiss(false);
          else if (key.length === 1 && key.trim()) {
            const now = Date.now();
            const text =
              (now - typeahead.current.time < 600
                ? typeahead.current.text
                : "") + key.toLocaleLowerCase();
            typeahead.current = { text, time: now };
            const next = enabled.find((option) =>
              option.label.toLocaleLowerCase().startsWith(text),
            );
            if (next) {
              event.preventDefault();
              if (expanded) setActive(next.value);
              else show(next.value);
            }
          }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {expanded ? (
        <Popover
          anchor={trigger}
          align="end"
          gap={5}
          width={width}
          maxHeight={320}
          layer={layer}
          panel
          onDismiss={(reason) => dismiss(reason === "escape")}
        >
          <ToolbarPanel theme={theme} className="settings-select-panel">
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-label={label}
              aria-describedby={descriptionId}
              className="settings-select-options"
            >
              {options.map((option, index) => (
                <button
                  key={option.value}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  data-active={option.value === activeValue || undefined}
                  className="toolbar-panel-row settings-select-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) setActive(option.value);
                  }}
                  onClick={() => choose(option.value)}
                >
                  <span className="settings-select-option-copy">
                    <span>{option.label}</span>
                    {option.description ? (
                      <small className="toolbar-panel-secondary">
                        {option.description}
                      </small>
                    ) : null}
                  </span>
                  {option.value === value ? (
                    <Check aria-hidden="true" size={14} />
                  ) : null}
                </button>
              ))}
            </div>
          </ToolbarPanel>
        </Popover>
      ) : null}
    </>
  );
}

export function SecondaryButton({
  onClick,
  label,
  disabled = false,
  danger = false,
  children,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const descriptionId = useContext(RowDescription);
  return (
    <button
      className={`settings-button${danger ? " settings-button-danger" : ""}`}
      type="button"
      aria-label={label}
      aria-describedby={descriptionId}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
