import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MOD } from "../lib/platform";
import type { LiveAgent } from "../lib/liveAgents";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import {
  Briefcase,
  Folder,
  FolderPlus,
  Home,
  MoreHorizontal,
  Plus,
  Settings,
} from "./icons";
import { Popover } from "./Popover";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";

type Props = {
  profiles: readonly WorkspaceProfile[];
  activeProfileId: string;
  onSelectProfile?: (id: string) => void;
  onCreateProfile?: (name: string) => void;
  onAddProject?: (anchor?: HTMLButtonElement) => void;
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
  liveAgents?: LiveAgent[];
  onSelectAgent?: (sessionId: string) => void;
};

export function WorkspaceProfileIcon({
  profile,
  className = "size-3.5",
}: {
  profile: WorkspaceProfile;
  className?: string;
}) {
  if (profile.icon === "folder")
    return <Folder className={className} strokeWidth={1.75} />;
  const Icon = profile.icon === "briefcase" ? Briefcase : Home;
  return <Icon className={className} strokeWidth={1.75} />;
}

/** Workspace switches only change the visible local project collection. */
export function PersonalWorkspaceSwitcher({
  profiles,
  activeProfileId,
  onSelectProfile,
  onCreateProfile,
  onAddProject,
  onOpenSettings,
  settingsOpen,
  liveAgents = [],
  onSelectAgent,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const activeIndex = profiles.findIndex(
    (profile) => profile.id === activeProfileId,
  );
  const onProfileKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next =
      profiles[(activeIndex + step + profiles.length) % profiles.length];
    onSelectProfile?.(next.id);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(
        `[data-profile-index="${(activeIndex + step + profiles.length) % profiles.length}"]`,
      )
      ?.focus();
  };
  const menuItems: ExplorerMenuItem[] = onSelectAgent
    ? liveAgents.map((agent) => ({
        kind: "item",
        id: `agent:${agent.id}`,
        label: `${agent.title} · ${agent.activity}`,
      }))
    : [];
  const tool = (
    label: string,
    child: ReactNode,
    onClick: (button: HTMLButtonElement) => void,
    active?: boolean,
  ) => (
    <button
      type="button"
      className="personal-workspace-tool"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={(event) => onClick(event.currentTarget)}
    >
      {child}
    </button>
  );
  return (
    <div
      className="personal-workspace-switcher"
      role="toolbar"
      aria-label="Workspace controls"
    >
      {onOpenSettings
        ? tool(
            `Settings (${MOD},)`,
            <Settings className="size-3.5" />,
            onOpenSettings,
            settingsOpen,
          )
        : null}
      {onAddProject
        ? tool("Add project", <FolderPlus className="size-3.5" />, onAddProject)
        : null}
      <div
        className="personal-profile-switches"
        role="group"
        aria-label="Workspaces"
      >
        {profiles.map((profile, index) => (
          <button
            key={profile.id}
            type="button"
            className="personal-workspace-tool personal-profile-switch"
            data-profile-index={index}
            aria-label={`${profile.name} workspace`}
            title={profile.name}
            aria-pressed={profile.id === activeProfileId}
            onClick={() => {
              onSelectProfile?.(profile.id);
            }}
            onKeyDown={onProfileKey}
          >
            <WorkspaceProfileIcon profile={profile} />
          </button>
        ))}
      </div>
      {onCreateProfile ? (
        <button
          ref={addRef}
          type="button"
          className="personal-workspace-tool"
          aria-label="Add workspace"
          title="New workspace"
          aria-haspopup="dialog"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <Plus className="size-3.5" />
        </button>
      ) : null}
      {menuItems.length
        ? tool(
            "Working agents",
            <MoreHorizontal className="size-3.5" />,
            (button) => {
              const rect = button.getBoundingClientRect();
              setMenu({ x: rect.left, y: rect.top });
            },
          )
        : null}
      {adding ? (
        <Popover
          anchor={addRef}
          side="top"
          align="start"
          gap={8}
          width={240}
          role="dialog"
          aria-label="Add workspace"
          onDismiss={() => setAdding(false)}
          className="p-3"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              onCreateProfile?.(name.trim());
              setName("");
              setAdding(false);
            }}
          >
            <label
              className="block text-xs text-content/80"
              htmlFor="personal-new-workspace"
            >
              Workspace name
            </label>
            <input
              id="personal-new-workspace"
              autoFocus
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 h-8 w-full rounded-md border border-content/15 bg-content/5 px-2 text-xs text-content outline-none focus:border-accent/60"
              placeholder="Name"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="mt-3 h-7 w-full rounded-md bg-content/10 text-xs text-content hover:bg-content/15 disabled:opacity-40"
            >
              Create workspace
            </button>
          </form>
        </Popover>
      ) : null}
      {menu && menuItems.length ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          ariaLabel="Working agents"
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id.startsWith("agent:")) onSelectAgent?.(id.slice(6));
          }}
        />
      ) : null}
    </div>
  );
}
