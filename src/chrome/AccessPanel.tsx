import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Check, Lock, LockOpen, Pencil, Sparkles, X } from "./icons";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/session";
import type { AccessPanelSnapshot } from "../lib/accessPanel";
import "./AccessPanel.css";

export const ACCESS_ICONS: Record<RuntimeMode, typeof Lock> = {
  supervised: Lock,
  "auto-accept-edits": Pencil,
  auto: Sparkles,
  "full-access": LockOpen,
};

export function AccessPanelContent({
  snapshot,
  onSelect,
  onClose,
  error,
}: {
  snapshot: AccessPanelSnapshot;
  onSelect: (mode: RuntimeMode) => void;
  onClose: () => void;
  error?: string | null;
}) {
  const title = useId();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true });
  }, []);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    );
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length;
    options[next]?.focus();
  };
  return (
    <section
      role="dialog"
      aria-labelledby={title}
      className="access-panel"
      data-access-picker
      data-theme={snapshot.theme.mode}
      style={
        {
          "--access-bg": snapshot.theme.background,
          "--access-text": snapshot.theme.text,
          "--access-accent": snapshot.theme.accent,
        } as CSSProperties
      }
    >
      <header className="access-panel-header">
        <h2 id={title}>Access</h2>
        <button
          type="button"
          className="access-panel-close"
          aria-label="Close access options"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <p className="access-panel-note">
        {snapshot.busy
          ? "Changes apply to the next turn and new tasks."
          : "Your choice is remembered for new tasks."}
      </p>
      <div
        ref={menu}
        role="menu"
        aria-label="Access mode"
        onKeyDown={navigate}
        className="access-panel-options"
      >
        {RUNTIME_MODES.map((mode) => {
          const Icon = ACCESS_ICONS[mode];
          return (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={mode === snapshot.value}
              tabIndex={mode === snapshot.value ? 0 : -1}
              onClick={() => onSelect(mode)}
              className="access-panel-option"
            >
              <Icon className="access-panel-icon" size={16} />
              <span className="access-panel-copy">
                <strong>{RUNTIME_MODE_LABEL[mode]}</strong>
                <span>{RUNTIME_MODE_HINT[mode]}</span>
              </span>
              <Check
                className="access-panel-check"
                size={15}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="access-panel-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
