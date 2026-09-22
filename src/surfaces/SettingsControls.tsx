import {
  createContext,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { playCue } from "../lib/sounds";
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
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const descriptionId = useContext(RowDescription);
  return (
    <select
      className="settings-select"
      aria-label={label}
      aria-describedby={descriptionId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
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
