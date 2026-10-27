import type { MouseEvent, ReactNode } from "react";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { MOD } from "../lib/platform";
import {
  ChevronDown,
  Clock,
  Inbox,
  Plus,
  Search,
  StickyNote,
  type IconComponent,
} from "./icons";
import { WorkspaceProfileIcon } from "./PersonalWorkspaceSwitcher";

/** Search everything (the palette is ⌘K; Search is ⇧⌘K). */
export const SEARCH_KEYS = MOD === "⌘" ? "⇧⌘K" : "Ctrl+Shift+K";

type Props = {
  profile: WorkspaceProfile;
  preview?: boolean;
  menuOpen?: boolean;
  onMenuChange?: (anchor: HTMLButtonElement | null) => void;
  /** Right-click on the workspace name, at a window point. */
  onWorkspaceMenu?: (x: number, y: number) => void;
  /** The workspace's row opens its Home. */
  onOpenHome?: () => void;
  homeActive?: boolean;
  /** New chat without a project, beside the workspace's name. */
  showNewSession?: boolean;
  startingNewSession?: boolean;
  onNewSession?: () => void;
  showSearch?: boolean;
  searchActive?: boolean;
  onSearch?: () => void;
  showNotes?: boolean;
  notesActive?: boolean;
  onOpenNotes?: () => void;
  showInbox?: boolean;
  inboxActive?: boolean;
  onOpenInbox?: () => void;
  showAutomations?: boolean;
  automationsActive?: boolean;
  onOpenAutomations?: () => void;
  /** Finished automation runs nobody has opened yet. */
  automationsUnread?: number;
};

type Row = {
  id: string;
  label: string;
  icon: IconComponent;
  title: string;
  active?: boolean;
  onClick?: () => void;
  keys?: string;
  count?: number;
};

/**
 * The top of the sidebar, as in Cydonia: the workspace's row (its Home, with
 * its menu and New chat beside it), then Search, Notes, Inbox and Automations
 * as labelled rows. Live and preview pages share geometry; previews never own
 * focus or actions.
 */
export function ProfileSidebarHeader({
  profile,
  preview = false,
  menuOpen = false,
  onMenuChange,
  onWorkspaceMenu,
  onOpenHome,
  homeActive = false,
  showNewSession,
  startingNewSession = false,
  onNewSession,
  showSearch,
  searchActive,
  onSearch,
  showNotes,
  notesActive,
  onOpenNotes,
  showInbox,
  inboxActive,
  onOpenInbox,
  showAutomations,
  automationsActive,
  onOpenAutomations,
  automationsUnread = 0,
}: Props) {
  const name = (
    <>
      <WorkspaceProfileIcon profile={profile} className="size-4" />
      <span>{profile.name}</span>
    </>
  );
  const rows: Row[] = [
    ...(showSearch
      ? [
          {
            id: "search",
            label: "Search",
            icon: Search,
            title: `Search chats, files and projects (${SEARCH_KEYS})`,
            active: searchActive,
            onClick: onSearch,
            keys: SEARCH_KEYS,
          },
        ]
      : []),
    ...(showNotes
      ? [
          {
            id: "notes",
            label: "Notes",
            icon: StickyNote,
            title: "Notes: saved notes and reusable context",
            active: notesActive,
            onClick: onOpenNotes,
          },
        ]
      : []),
    ...(showInbox
      ? [
          {
            id: "inbox",
            label: "Inbox",
            icon: Inbox,
            title: "Inbox: your GitHub issues and pull requests",
            active: inboxActive,
            onClick: onOpenInbox,
          },
        ]
      : []),
    ...(showAutomations
      ? [
          {
            id: "automations",
            label: "Automations",
            icon: Clock,
            title: "Automations: agents that run on a schedule",
            active: automationsActive,
            onClick: onOpenAutomations,
            count: automationsUnread,
          },
        ]
      : []),
  ];
  // Right-click on the name or its chevron: the workspace's own actions.
  const contextMenu = onWorkspaceMenu
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onMenuChange?.(null);
        onWorkspaceMenu(event.clientX, event.clientY);
      }
    : undefined;
  const rowBody = (row: Row): ReactNode => (
    <>
      <row.icon className="personal-library-icon" aria-hidden />
      <span className="personal-library-label">{row.label}</span>
      {row.count ? (
        <>
          <span className="personal-library-count" aria-hidden>
            {row.count > 99 ? "99+" : row.count}
          </span>
          <span className="sr-only">, {row.count} new</span>
        </>
      ) : row.keys ? (
        <kbd className="personal-library-keys" aria-hidden>
          {row.keys}
        </kbd>
      ) : null}
    </>
  );
  return (
    <>
      <div className="personal-profile-header">
        {preview ? (
          <div className="personal-profile-name">{name}</div>
        ) : (
          <button
            className="personal-profile-name"
            type="button"
            aria-label={`Home, ${profile.name} workspace`}
            title={`${profile.name} · Home`}
            aria-current={homeActive ? "page" : undefined}
            onClick={onOpenHome}
            onContextMenu={contextMenu}
            onKeyDown={(event) => {
              // The workspace menu also opens from its name, as a menu
              // button's would.
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              const picker =
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
                  ".personal-profile-picker",
                );
              if (!picker) return;
              event.preventDefault();
              onMenuChange?.(picker);
            }}
          >
            {name}
          </button>
        )}
        {preview ? (
          <span className="personal-profile-picker">
            <ChevronDown className="size-3" />
          </span>
        ) : (
          <button
            className="personal-profile-picker"
            type="button"
            aria-label={`Switch workspace, ${profile.name}`}
            title="Switch workspace"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) =>
              onMenuChange?.(menuOpen ? null : event.currentTarget)
            }
            onContextMenu={contextMenu}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                onMenuChange?.(event.currentTarget);
              }
            }}
          >
            <ChevronDown className="size-3" />
          </button>
        )}
        {showNewSession ? (
          preview ? (
            <span className="personal-profile-new">
              <Plus className="size-4" />
            </span>
          ) : (
            <button
              type="button"
              className="personal-profile-new"
              aria-label="New chat without a project"
              title={startingNewSession ? "Starting…" : "New chat"}
              disabled={startingNewSession}
              onClick={onNewSession}
            >
              <Plus className="size-4" />
            </button>
          )
        ) : null}
      </div>
      {rows.length ? (
        <nav className="personal-library-nav" aria-label="Library">
          {rows.map((row) =>
            preview ? (
              <span
                key={row.id}
                className="personal-library-row"
                data-library={row.id}
              >
                {rowBody(row)}
              </span>
            ) : (
              <button
                key={row.id}
                type="button"
                className="personal-library-row"
                data-library={row.id}
                onClick={row.onClick}
                aria-current={row.active ? "page" : undefined}
                aria-keyshortcuts={
                  row.keys
                    ? row.keys === "⇧⌘K"
                      ? "Shift+Meta+K"
                      : "Control+Shift+K"
                    : undefined
                }
                title={row.title}
              >
                {rowBody(row)}
              </button>
            ),
          )}
        </nav>
      ) : null}
    </>
  );
}
