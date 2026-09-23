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
              className="toolbar-panel-row access-panel-option"
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
    </ToolbarPanel>
  );
}
