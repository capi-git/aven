import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import type { UsagePanelSnapshot } from "../lib/usagePanel";
import { X } from "./icons";
import "./ToolbarPanel.css";

export type ToolbarPanelTheme = UsagePanelSnapshot["theme"];

/** Carry the owning workspace's material through portals and native panels. */
export function toolbarPanelStyle(theme?: ToolbarPanelTheme): CSSProperties {
  return {
    "--toolbar-panel-bg": theme?.background,
    "--toolbar-panel-text": theme?.text,
    "--toolbar-panel-accent": theme?.accent,
  } as CSSProperties;
}

export function ToolbarPanel({
  theme,
  className,
  style,
  ...props
}: ComponentPropsWithoutRef<"div"> & { theme?: ToolbarPanelTheme }) {
  return (
    <div
      {...props}
      className={`toolbar-panel${className ? ` ${className}` : ""}`}
      data-theme={theme?.mode}
      style={{ ...toolbarPanelStyle(theme), ...style }}
    />
  );
}

export function ToolbarPanelHeader({
  title,
  titleId,
  actions,
  onClose,
  closeLabel = "Close panel",
  className,
}: {
  title: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}) {
  return (
    <header
      className={`toolbar-panel-header${className ? ` ${className}` : ""}`}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="toolbar-panel-header-actions">
        {actions}
        {onClose ? (
          <button
            type="button"
            className="toolbar-panel-icon-button"
            onClick={onClose}
            aria-label={closeLabel}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
