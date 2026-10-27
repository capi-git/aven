import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { isImeComposition } from "../lib/keyboard";
import type { WorkspaceMenuPanelSnapshot } from "../lib/workspaceMenuPanel";
import { ToolbarPanel, ToolbarPanelHeader } from "./ToolbarPanel";
import { Check, Search } from "./icons";
import "./Menu.css";
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
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const items =
    snapshot.searchable && terms.length
      ? snapshot.items.filter((item) => {
          const text =
            `${item.label} ${item.description ?? ""}`.toLocaleLowerCase();
          return terms.every((term) => text.includes(term));
        })
      : snapshot.items;
  useEffect(() => {
    const target = menu.current;
    const first = target?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    (search.current ?? first ?? target)?.focus();
  }, []);
  const navigate = (event: KeyboardEvent) => {
    const inSearch = event.target === search.current;
    if (inSearch && isImeComposition(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // Home/End belong to the text caret, and composition must keep owning its
    // Enter/arrows. The input's arrows intentionally enter the result list.
    if (
      inSearch &&
      (event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        ["Home", "End"].includes(event.key))
    )
      return;
    if (inSearch && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const first = items.find((item) => !item.disabled);
      if (first) onSelect(first.id);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (snapshot.searchable && index === 0 && event.key === "ArrowUp") {
      search.current?.focus();
      return;
    }
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index < 0
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
    buttons[next]?.focus();
  };
  return (
    <ToolbarPanel
      theme={snapshot.theme}
      className={`workspace-menu-panel${snapshot.compact ? " workspace-menu-panel-compact" : ""}${snapshot.searchable ? " workspace-menu-panel-searchable" : ""}`}
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
      {snapshot.searchable ? (
        <div className="aven-menu aven-menu-search-bar">
          <label className="aven-menu-search">
            <Search aria-hidden="true" />
            <input
              ref={search}
              type="search"
              aria-label={`Search ${snapshot.title}`}
              placeholder="Search…"
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={navigate}
            />
          </label>
          <div
            className="workspace-menu-panel-count"
            role="status"
            aria-live="polite"
          >
            {terms.length
              ? `${items.length} of ${snapshot.items.length}`
              : `${items.length} ${items.length === 1 ? "item" : "items"}`}
          </div>
        </div>
      ) : null}
      <div
        ref={menu}
        role="menu"
        tabIndex={-1}
        aria-label={snapshot.title}
        className="workspace-menu-panel-items aven-menu"
        onKeyDown={navigate}
      >
        {items.map((item, index) => (
          <Fragment key={item.id}>
            {item.separatorBefore && (!snapshot.searchable || index > 0) ? (
              <div role="separator" className="aven-menu-separator" />
            ) : null}
            <button
              type="button"
              // A system tooltip that repeats a fully visible label only adds a
              // second copy, and can linger after the menu closes. Offer it
              // just for compact labels that are actually cut off.
              onPointerEnter={
                snapshot.compact
                  ? (event) => {
                      const label =
                        event.currentTarget.querySelector(".aven-menu-label");
                      const clipped =
                        !!label && label.scrollWidth > label.clientWidth;
                      if (clipped) event.currentTarget.title = item.label;
                      else event.currentTarget.removeAttribute("title");
                    }
                  : undefined
              }
              role={item.checked == null ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={`aven-menu-item${item.description ? " aven-menu-item-rich" : ""}${item.danger ? " aven-menu-item-danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) onSelect(item.id);
              }}
            >
              {item.description ? (
                <span className="aven-menu-text">
                  <span className="aven-menu-label">{item.label}</span>
                  <small className="aven-menu-description">
                    {item.description}
                  </small>
                </span>
              ) : (
                <span className="aven-menu-label">{item.label}</span>
              )}
              {item.checked ? (
                <Check aria-hidden="true" className="aven-menu-check" />
              ) : null}
              {item.shortcut ? (
                <span className="aven-menu-shortcut">{item.shortcut}</span>
              ) : null}
            </button>
          </Fragment>
        ))}
        {snapshot.searchable && !items.length ? (
          <p className="aven-menu-note workspace-menu-panel-empty">
            {terms.length ? "No matches" : "No recent tabs"}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="workspace-menu-panel-error">
          {error}
        </p>
      ) : null}
    </ToolbarPanel>
  );
}
