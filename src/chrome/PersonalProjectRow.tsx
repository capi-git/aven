import { useEffect, useState, type KeyboardEvent } from "react";
import { basename, revealPath } from "../lib/fs";
import { projectName } from "../lib/paths";
import {
  loadPinnedProjects,
  sameProjectPath,
  savePinnedProjects,
} from "../lib/recents";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MoreHorizontal,
  Plus,
} from "./icons";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

type Props = {
  path: string;
  active: boolean;
  expanded: boolean;
  busy?: boolean;
  profiles: readonly WorkspaceProfile[];
  activeProfileId: string;
  onSelect: () => void;
  onToggle: () => void;
  onNew?: () => void;
  onMove?: (path: string, profileId: string) => void;
  onRemove?: (path: string, options: { purgeData: boolean }) => void;
  onPinnedChange?: () => void;
  visible?: boolean;
};

export function PersonalProjectRow({
  path,
  active,
  expanded,
  busy,
  profiles,
  activeProfileId,
  onSelect,
  onToggle,
  onNew,
  onMove,
  onRemove,
  onPinnedChange,
  visible = true,
}: Props) {
  const labels = useProjectLabels();
  const [pinned, setPinned] = useState(loadPinnedProjects);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (visible) return;
    setMenu(null);
    setRemoving(false);
  }, [visible]);
  const label = projectDisplayName(
    path,
    labels,
    basename(path) || projectName(path),
  );
  const isPinned = pinned.some((item) => sameProjectPath(item, path));
  const items: ExplorerMenuItem[] = [
    { kind: "item", id: "open", label: "Open project" },
    {
      kind: "item",
      id: "pin",
      label: isPinned ? "Unpin project" : "Pin project",
    },
    { kind: "item", id: "reveal", label: "Reveal in Finder" },
    ...(onMove
      ? profiles
          .filter((profile) => profile.id !== activeProfileId)
          .map((profile) => ({
            kind: "item" as const,
            id: `move:${profile.id}`,
            label: `Move to ${profile.name}`,
          }))
      : []),
    ...(onRemove
      ? [
          { kind: "sep" as const },
          { kind: "item" as const, id: "archive", label: "Archive project" },
          {
            kind: "item" as const,
            id: "delete",
            label: "Delete project conversations…",
            danger: true,
          },
        ]
      : []),
  ];
  const contextKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom });
  };
  return (
    <>
      <div className="personal-project-row" data-active={active || undefined}>
        <button
          type="button"
          className="personal-project-open"
          title={path}
          aria-label={`Open ${label} project`}
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={contextKey}
        >
          <Folder
            className="personal-project-symbol size-3.5"
            strokeWidth={1.75}
          />
          <span>{label}</span>
          {busy ? (
            <span
              className="personal-task-working-dot"
              aria-label="Task running"
            />
          ) : null}
        </button>
        <button
          type="button"
          className="personal-project-row-action personal-project-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label} tasks`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
        {onNew ? (
          <button
            type="button"
            className="personal-project-row-action"
            aria-label={`New task in ${label}`}
            title={`New task in ${label}`}
            onClick={onNew}
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          className="personal-project-row-action personal-project-more"
          aria-label={`Actions for ${label}`}
          title={`Actions for ${label}`}
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.bottom });
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={items}
          ariaLabel={`Actions for ${label}`}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onSelect();
            else if (id === "reveal") void revealPath(path);
            else if (id === "archive") onRemove?.(path, { purgeData: false });
            else if (id === "delete") setRemoving(true);
            else if (id.startsWith("move:")) onMove?.(path, id.slice(5));
            else if (id === "pin") {
              const next = isPinned
                ? pinned.filter((item) => !sameProjectPath(item, path))
                : [...pinned, path];
              savePinnedProjects(next);
              setPinned(next);
              onPinnedChange?.();
            }
          }}
        />
      ) : null}
      {removing ? (
        <RemoveProjectDialog
          name={label}
          path={path}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            onRemove?.(path, { purgeData: true });
            setRemoving(false);
          }}
        />
      ) : null}
    </>
  );
}
