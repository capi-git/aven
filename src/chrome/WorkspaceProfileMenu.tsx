import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { Check } from "./icons";
import { WorkspaceProfileIcon } from "./PersonalWorkspaceSwitcher";
import { Popover } from "./Popover";

type Props = {
  profiles: readonly WorkspaceProfile[];
  activeProfileId: string;
  anchor: HTMLButtonElement;
  onSelect: (id: string) => void;
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
        '[role="menuitemradio"]',
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
      className="overflow-y-auto overscroll-none p-1 text-content"
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
            className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-content/8 focus:bg-content/10 focus:outline-none"
            onFocus={() => setFocusedId(profile.id)}
            onClick={() => {
              onSelect(profile.id);
              close(true);
            }}
          >
            <span aria-hidden="true" className="shrink-0 text-content/65">
              <WorkspaceProfileIcon profile={profile} />
            </span>
            <span className="min-w-0 flex-1 truncate">{profile.name}</span>
            {selected ? (
              <Check
                aria-hidden="true"
                className="size-3.5 shrink-0 text-accent"
              />
            ) : null}
          </button>
        );
      })}
    </Popover>
  );
}
