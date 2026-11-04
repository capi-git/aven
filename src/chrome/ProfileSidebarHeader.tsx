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
  /** Cards automations left for you to review or publish. */
  inboxCount?: number;
  showAutomations?: boolean;
  automationsActive?: boolean;
  onOpenAutomations?: () => void;
  /** Failed automation runs nobody has opened yet. */
  automationsUnread?: number;
};

type Tile = {
  id: string;
  label: string;
  icon: IconComponent;
  title: string;
  active?: boolean;
  onClick?: () => void;
  count?: number;
};

/**
 * The top of the sidebar: the workspace's row (its Home, with its menu and
 * New chat beside it), Search as a field, then Notes, Inbox and Automations
 * as a row of pinned tiles, as Arc pins its favourites. Live and preview
 * pages share geometry; previews never own focus or actions.
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
  inboxCount = 0,
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
  const tiles: Tile[] = [
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
            count: inboxCount,
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
  // A tile is its icon; its name is the tooltip and what a screen reader
  // says, and a small count sits in its corner.
  const tileBody = (tile: Tile): ReactNode => (
    <>
      <tile.icon className="personal-library-icon" aria-hidden />
      <span className="sr-only">{tile.label}</span>
      {tile.count ? (
        <>
          <span className="personal-library-count" aria-hidden>
            {tile.count > 99 ? "99+" : tile.count}
          </span>
          <span className="sr-only">, {tile.count} new</span>
        </>
      ) : null}
    </>
  );
  const searchBody = (
    <>
      <Search className="personal-library-icon" aria-hidden />
      <span className="personal-search-label">Search</span>
      <kbd className="personal-search-keys" aria-hidden>
        {SEARCH_KEYS}
      </kbd>
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
      {showSearch ? (
        preview ? (
          <div className="personal-search-field">{searchBody}</div>
        ) : (
          <button
            type="button"
            className="personal-search-field"
            aria-label="Search"
            title={`Search chats, files and projects (${SEARCH_KEYS})`}
            aria-current={searchActive ? "page" : undefined}
            aria-keyshortcuts={
              SEARCH_KEYS === "⇧⌘K" ? "Shift+Meta+K" : "Control+Shift+K"
            }
            onClick={onSearch}
          >
            {searchBody}
          </button>
        )
      ) : null}
      {tiles.length ? (
        <nav className="personal-library-nav" aria-label="Library">
          {tiles.map((tile) =>
            preview ? (
              <span
                key={tile.id}
                className="personal-library-tile"
                data-library={tile.id}
              >
                {tileBody(tile)}
              </span>
            ) : (
              <button
                key={tile.id}
                type="button"
                className="personal-library-tile"
                data-library={tile.id}
                onClick={tile.onClick}
                aria-current={tile.active ? "page" : undefined}
                title={tile.title}
              >
                {tileBody(tile)}
              </button>
            ),
          )}
        </nav>
      ) : null}
    </>
  );
}
