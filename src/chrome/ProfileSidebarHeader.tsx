import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { MOD } from "../lib/platform";
import { ChevronDown, Inbox, Search, StickyNote } from "./icons";
import { WorkspaceProfileIcon } from "./PersonalWorkspaceSwitcher";

type Props = {
  profile: WorkspaceProfile;
  preview?: boolean;
  menuOpen?: boolean;
  onMenuChange?: (anchor: HTMLButtonElement | null) => void;
  showSearch?: boolean;
  searchActive?: boolean;
  onSearch?: () => void;
  showNotes?: boolean;
  notesActive?: boolean;
  onOpenNotes?: () => void;
  showInbox?: boolean;
  inboxActive?: boolean;
  onOpenInbox?: () => void;
};

/** Live and preview pages share geometry; previews never own focus or actions. */
export function ProfileSidebarHeader({
  profile,
  preview = false,
  menuOpen = false,
  onMenuChange,
  showSearch,
  searchActive,
  onSearch,
  showNotes,
  notesActive,
  onOpenNotes,
  showInbox,
  inboxActive,
  onOpenInbox,
}: Props) {
  const heading = (
    <>
      <WorkspaceProfileIcon profile={profile} />
      <span>{profile.name}</span>
      <ChevronDown className="size-3" />
    </>
  );
  return (
    <>
      <div className="personal-profile-header">
        {preview ? (
          <div className="personal-profile-picker">{heading}</div>
        ) : (
          <button
            className="personal-profile-picker"
            type="button"
            aria-label={`Switch workspace, ${profile.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) =>
              onMenuChange?.(menuOpen ? null : event.currentTarget)
            }
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                onMenuChange?.(event.currentTarget);
              }
            }}
          >
            {heading}
          </button>
        )}
        {showSearch ? (
          preview ? (
            <span className="personal-workspace-tool">
              <Search className="size-3.5" />
            </span>
          ) : (
            <button
              type="button"
              className="personal-workspace-tool"
              aria-label={`Search (${MOD}K)`}
              title={`Search (${MOD}K)`}
              aria-pressed={searchActive}
              onClick={onSearch}
            >
              <Search className="size-3.5" />
            </button>
          )
        ) : null}
      </div>
      {showNotes || showInbox ? (
        <nav className="personal-library-nav" aria-label="Library">
          {showNotes ? (
            preview ? (
              <span>
                <StickyNote className="size-3.5" aria-hidden />
                <span>Notes</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={onOpenNotes}
                aria-current={notesActive ? "page" : undefined}
                title="Saved notes and reusable context"
              >
                <StickyNote className="size-3.5" aria-hidden />
                <span>Notes</span>
              </button>
            )
          ) : null}
          {showInbox ? (
            preview ? (
              <span>
                <Inbox className="size-3.5" aria-hidden />
                <span>Inbox</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={onOpenInbox}
                aria-current={inboxActive ? "page" : undefined}
                title="GitHub issues, pull requests, and Linear tasks"
              >
                <Inbox className="size-3.5" aria-hidden />
                <span>Inbox</span>
              </button>
            )
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
