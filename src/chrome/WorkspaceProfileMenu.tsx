import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { Check, Trash2 } from "./icons";
import { WorkspaceProfileIcon } from "./PersonalWorkspaceSwitcher";
import { Popover } from "./Popover";
import "./Menu.css";

type Props = {
  profiles: readonly WorkspaceProfile[];
  activeProfileId: string;
  anchor: HTMLButtonElement;
  onSelect: (id: string) => void;
  onDelete?: (profile: WorkspaceProfile) => void;
  /** Right-click on a row opens that workspace's actions instead. */
  onWorkspaceMenu?: (profile: WorkspaceProfile, x: number, y: number) => void;
  onDismiss: () => void;
};

function menuWidth(anchor: HTMLButtonElement): number {
  const sidebarWidth = anchor.closest("aside")?.clientWidth ?? 0;
  return sidebarWidth > 24 ? Math.min(224, sidebarWidth - 24) : 224;
}

/** Switch local workspaces without mixing navigation with appearance settings. */
export function WorkspaceProfileMenu({
  profiles,
  activeProfileId,
  anchor,
  onSelect,
  onDelete,
  onWorkspaceMenu,
  onDismiss,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dismissedRef = useRef(false);
  const [width, setWidth] = useState(() => menuWidth(anchor));
  const [focusedId, setFocusedId] = useState(activeProfileId);

  useLayoutEffect(() => {
    const measure = () => setWidth(menuWidth(anchor));
    measure();
    const sidebar = anchor.closest("aside");
    const observer = new ResizeObserver(measure);
    if (sidebar) observer.observe(sidebar);
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    const menu = menuRef.current;
    const initialFocus = document.activeElement;
    const focusSelection = () => {
      if (
        dismissedRef.current ||
        !menu?.isConnected ||
        menu.contains(document.activeElement)
      ) {
        return;
      }
      const selected = menu.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      );
      (selected ?? menu.querySelector<HTMLButtonElement>("button"))?.focus({
        preventScroll: true,
      });
    };
    focusSelection();
    if (!menu || menu.contains(document.activeElement)) return;
    // Popover measures its first frame with visibility:hidden. WebKit can
    // reject the effect's focus attempt before that placement update paints.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === initialFocus) focusSelection();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeProfileId, anchor]);

  const close = (restoreFocus: boolean) => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss();
    if (restoreFocus && anchor.isConnected)
      anchor.focus({ preventScroll: true });
  };

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"], [role="menuitem"]',
      ) ?? []),
    ];
    if (!buttons.length) return;
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = (current + 1) % buttons.length;
        break;
      case "ArrowUp":
        next = (current - 1 + buttons.length) % buttons.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <Popover
      ref={menuRef}
      anchor={anchor}
      side="bottom"
      align="start"
      gap={6}
      width={width}
      role="menu"
      aria-label="Switch workspace"
      onDismiss={(reason) => close(reason === "escape")}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !anchor.contains(event.relatedTarget)
        ) {
          close(false);
        }
      }}
      onKeyDown={navigate}
      className="aven-menu overflow-y-auto overscroll-none"
    >
      {profiles.map((profile) => {
        const selected = profile.id === activeProfileId;
        return (
          <button
            key={profile.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={profile.id === focusedId ? 0 : -1}
            className="aven-menu-item"
            onFocus={() => setFocusedId(profile.id)}
            onClick={() => {
              onSelect(profile.id);
              close(true);
            }}
            onContextMenu={
              onWorkspaceMenu
                ? (event) => {
                    event.preventDefault();
                    close(false);
                    onWorkspaceMenu(profile, event.clientX, event.clientY);
                  }
                : undefined
            }
          >
            <span aria-hidden="true" className="aven-menu-icon">
              <WorkspaceProfileIcon profile={profile} className="" />
            </span>
            <span className="aven-menu-label">{profile.name}</span>
            {selected ? (
              <Check aria-hidden="true" className="aven-menu-check" />
            ) : null}
          </button>
        );
      })}
      {onDelete &&
      activeProfileId !== "personal" &&
      profiles.some((profile) => profile.id === activeProfileId) ? (
        <>
          <div role="separator" className="aven-menu-separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={focusedId === "delete" ? 0 : -1}
            onFocus={() => setFocusedId("delete")}
            className="aven-menu-item aven-menu-item-danger"
            onClick={() => {
              const profile = profiles.find(
                (item) => item.id === activeProfileId,
              );
              close(true);
              if (profile) onDelete(profile);
            }}
          >
            <span aria-hidden="true" className="aven-menu-icon">
              <Trash2 />
            </span>
            <span className="aven-menu-label">Delete workspace…</span>
          </button>
        </>
      ) : null}
    </Popover>
  );
}
