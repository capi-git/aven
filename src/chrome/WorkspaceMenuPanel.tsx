import {
  Fragment,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { ToolbarPanel, ToolbarPanelHeader } from "./ToolbarPanel";
import { Check } from "./icons";
import "./WorkspaceMenuPanel.css";

/** Identical content in the web popover and the owned native popup. */
export function WorkspaceMenuPanelContent({
  snapshot,
  onSelect,
  onClose,
  header,
  error,
}: {
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  /** Arbitrary local content is supported by the HTML menu surface. */
  header?: ReactNode;
  error?: string | null;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = menu.current;
    const first = target?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    (first ?? target)?.focus();
  }, []);
  const navigate = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : index < 0
            ? event.key === "ArrowDown"
              ? 0
              : items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
    items[next]?.focus();
  };
  return (
    <ToolbarPanel
      theme={snapshot.theme}
      className={`workspace-menu-panel${snapshot.compact ? " workspace-menu-panel-compact" : ""}`}
    >
      {header ? (
        <div className="workspace-menu-panel-custom-header">{header}</div>
      ) : !snapshot.compact ? (
        <ToolbarPanelHeader
          title={snapshot.title}
          onClose={onClose}
          closeLabel="Close open options"
        />
      ) : null}
      <div
        ref={menu}
        role="menu"
        tabIndex={-1}
        aria-label={snapshot.title}
        className="workspace-menu-panel-items"
        onKeyDown={navigate}
      >
        {snapshot.items.map((item) => (
          <Fragment key={item.id}>
            {item.separatorBefore ? (
              <div
                role="separator"
                className="workspace-menu-panel-separator"
              />
            ) : null}
            <button
              type="button"
              title={snapshot.compact ? item.label : undefined}
              role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={`toolbar-panel-row workspace-menu-panel-item${item.danger ? " workspace-menu-panel-item-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) onSelect(item.id);
              }}
            >
              <span className="workspace-menu-panel-item-line">
                <span className="workspace-menu-panel-item-label">
                  {item.label}
                </span>
                {item.checked ? (
                  <Check
                    aria-hidden="true"
                    className="workspace-menu-panel-check"
                    size={14}
                  />
                ) : null}
                {item.shortcut ? (
                  <span className="workspace-menu-panel-shortcut">
                    {item.shortcut}
                  </span>
                ) : null}
              </span>
              {item.description ? (
                <small className="toolbar-panel-secondary">
                  {item.description}
                </small>
              ) : null}
            </button>
          </Fragment>
        ))}
      </div>
      {error ? (
        <p role="alert" className="workspace-menu-panel-error">
          {error}
        </p>
      ) : null}
    </ToolbarPanel>
  );
}
