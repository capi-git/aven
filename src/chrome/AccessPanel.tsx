import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Check, Lock, LockOpen, Pencil, Sparkles } from "./icons";
import {
  RUNTIME_MODE_HINT,
  RUNTIME_MODE_LABEL,
  RUNTIME_MODES,
  type RuntimeMode,
} from "../lib/session";
import type { AccessPanelSnapshot } from "../lib/accessPanel";
import { ToolbarPanel, ToolbarPanelHeader } from "./ToolbarPanel";
import "./Menu.css";
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
  return (
    <ToolbarPanel
      role="dialog"
      aria-labelledby={title}
      className="access-panel"
      data-access-picker
      theme={snapshot.theme}
    >
      <ToolbarPanelHeader
        title="Access"
        titleId={title}
        onClose={onClose}
        closeLabel="Close access options"
      />
      <p className="access-panel-note">
        {snapshot.busy
          ? "Applies from your next message, and to new chats."
          : "Your choice is remembered for new chats."}
      </p>
      <AccessModeOptions value={snapshot.value} onSelect={onSelect} autoFocus />
      {error ? (
        <p role="alert" className="access-panel-error">
          {error}
        </p>
      ) : null}
    </ToolbarPanel>
  );
}

/**
 * The access modes as a menu of choices. Arrow keys, Home and End move
 * between them. `compact` leaves each mode's explanation to its tooltip.
 */
export function AccessModeOptions({
  value,
  onSelect,
  autoFocus = false,
  compact = false,
}: {
  value: RuntimeMode;
  onSelect: (mode: RuntimeMode) => void;
  /** Focus the chosen mode once mounted. */
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const autoFocusRef = useRef(autoFocus);
  useEffect(() => {
    if (!autoFocusRef.current) return;
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
    <div
      ref={menu}
      role="menu"
      aria-label="Access mode"
      data-compact={compact || undefined}
      onKeyDown={navigate}
      className="aven-menu access-panel-options"
    >
      {RUNTIME_MODES.map((mode) => {
        const Icon = ACCESS_ICONS[mode];
        return (
          <button
            key={mode}
            type="button"
            role="menuitemradio"
            aria-checked={mode === value}
            tabIndex={mode === value ? 0 : -1}
            data-mode={mode}
            title={compact ? RUNTIME_MODE_HINT[mode] : undefined}
            onClick={() => onSelect(mode)}
            className={`aven-menu-item access-panel-option${compact ? "" : " aven-menu-item-rich"}`}
          >
            <span aria-hidden="true" className="aven-menu-icon">
              <Icon />
            </span>
            {compact ? (
              <span className="aven-menu-label">
                {RUNTIME_MODE_LABEL[mode]}
              </span>
            ) : (
              <span className="aven-menu-text">
                <span>{RUNTIME_MODE_LABEL[mode]}</span>
                <span className="aven-menu-description">
                  {RUNTIME_MODE_HINT[mode]}
                </span>
              </span>
            )}
            <Check
              className="aven-menu-check access-panel-check"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}
