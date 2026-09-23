import { useEffect, useRef, type KeyboardEvent } from "react";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { ToolbarPanel, ToolbarPanelHeader } from "./ToolbarPanel";
import "./WorkspaceMenuPanel.css";

/** Identical content in the web popover and the owned native popup. */
export function WorkspaceMenuPanelContent({
  snapshot,
  onSelect,
  onClose,
  error,
}: {
  snapshot: WorkspaceMenuPanelSnapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  error?: string | null;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);
  const navigate = (event: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ??
        []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  };
  return (
    <ToolbarPanel theme={snapshot.theme} className="workspace-menu-panel">
      <ToolbarPanelHeader
        title={snapshot.title}
        onClose={onClose}
        closeLabel="Close open options"
      />
      <div
        ref={menu}
        role="menu"
        aria-label={snapshot.title}
        className="workspace-menu-panel-items"
        onKeyDown={navigate}
      >
        {snapshot.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="toolbar-panel-row workspace-menu-panel-item"
            disabled={item.disabled}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.label}</span>
            {item.description ? (
              <small className="toolbar-panel-secondary">
                {item.description}
              </small>
            ) : null}
          </button>
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
