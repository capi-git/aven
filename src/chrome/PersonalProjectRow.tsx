import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
import {
  describeProjectStatus,
  type ProjectStatus,
} from "../lib/projectStatus";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "./icons";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { ProjectCustomizePopover } from "./ProjectCustomizePopover";
import { ProjectMark } from "./ProjectMark";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

type Props = {
  path: string;
  active: boolean;
  expanded: boolean;
  /** Agents, questions, unread replies and changed files in this project. */
  status?: ProjectStatus;
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
  status,
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
  // The actions button anchors its menu, so pressing it again closes the menu
  // instead of counting as an outside click that the click then reopens.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    anchor?: HTMLElement;
  } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible) return;
    setMenu(null);
    setRemoving(false);
    setCustomizing(false);
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
    { kind: "item", id: "customize", label: "Customize project…" },
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
  const running = (status?.running ?? 0) > 0;
  const summary = describeProjectStatus(status);
  return (
    <>
      <div
        ref={rowRef}
        className="personal-project-row"
        data-active={active || undefined}
      >
        <button
          type="button"
          className="personal-project-open"
          title={summary ? `${summary}\n${path}` : path}
          aria-label={`Open ${label} project${summary ? `, ${summary}` : ""}`}
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={contextKey}
        >
          <ProjectMark
            path={path}
            active={running}
            reacts
            className="personal-project-symbol"
          />
          <span className="personal-project-label">{label}</span>
          <ProjectRowStatus status={status} />
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
          aria-expanded={Boolean(menu?.anchor)}
          onClick={(event) => {
            const anchor = event.currentTarget;
            setMenu((open) =>
              open?.anchor === anchor ? null : { x: 0, y: 0, anchor },
            );
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </div>
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          items={items}
          ariaLabel={`Actions for ${label}`}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onSelect();
            else if (id === "customize") setCustomizing(true);
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
      {customizing ? (
        <ProjectCustomizePopover
          path={path}
          anchor={rowRef}
          onClose={() => setCustomizing(false)}
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

/**
 * Quiet, right-aligned status: an amber dot while something waits for the
 * user, the unread reply count, and the changed-file count. A running agent
 * shows on the mark itself (or as the accent dot beside a logo).
 */
function ProjectRowStatus({ status }: { status?: ProjectStatus }) {
  if (!status) return null;
  const { running, waiting, unread, files } = status;
  if (!running && !waiting && !unread && !files) return null;
  return (
    <span className="personal-project-status" aria-hidden>
      {running ? <span className="personal-project-running" /> : null}
      {waiting ? <span className="personal-project-waiting" /> : null}
      {unread ? (
        <span className="personal-project-unread">{unread}</span>
      ) : null}
      {files ? <span className="personal-project-files">+{files}</span> : null}
    </span>
  );
}
