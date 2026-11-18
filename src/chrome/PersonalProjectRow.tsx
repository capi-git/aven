import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { isTextTruncated } from "../lib/truncatedTitle";
import { basename, revealPath } from "../lib/fs";
import { projectName } from "../lib/paths";
import { REVEAL_LABEL } from "../lib/platform";
import {
  loadPinnedProjects,
  sameProjectPath,
  savePinnedProjects,
} from "../lib/recents";
import { useMemoryKeeperProject } from "../hooks/useMemoryKeeperProject";
import {
  projectDisplayName,
  useProjectLabels,
} from "../hooks/useProjectLabels";
import { keeperRowNote, unseenKeeperChange } from "../lib/memoryKeeper";
import {
  describeProjectStatus,
  type ProjectStatus,
} from "../lib/projectStatus";
import type { WorkspaceProfile } from "../lib/workspaceProfiles";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
} from "./icons";
import {
  ExplorerMenu,
  pageOrInline,
  type ExplorerMenuItem,
} from "./ExplorerMenu";
import { ProjectCustomizePopover } from "./ProjectCustomizePopover";
import { ProjectMark } from "./ProjectMark";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useSetting } from "../hooks/useSetting";
import { SETTINGS } from "../lib/settingDefinitions";
import { ProjectMemoryDialog } from "./ProjectMemoryDialog";
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import { CrewCritter } from "./CrewCritter";
import { useHoverCard } from "./HoverCard";
import { ProjectPeekCard } from "./HoverPeeks";

/** A chat in its own copy: its own folder and branch, beside the others. */
export const NEW_CHAT_IN_COPY_LABEL = "New chat in a copy";

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
  /** A new chat in its own copy (git worktree) of the project. */
  onNewInCopy?: () => void;
  /** Open the project's board, from the ··· menu. */
  onOpenBoard?: () => void;
  onMove?: (path: string, profileId: string) => void;
  onRemove?: (path: string, options: { purgeData: boolean }) => void;
  onPinnedChange?: () => void;
  visible?: boolean;
  /** The project's bot is on: the menu offers its settings instead. */
  botOn?: boolean;
  /** Turn the project's bot on, or open its settings. */
  onBotSettings?: () => void;
  /** Its chats, counted on its hover card only once the card opens. */
  chats?: readonly { updatedAt: number; archived?: boolean }[];
  /** No hover card, as in the floating sidebar's own window. */
  peekDisabled?: boolean;
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
  onNewInCopy,
  onOpenBoard,
  onMove,
  onRemove,
  onPinnedChange,
  visible = true,
  botOn = false,
  onBotSettings,
  chats,
  peekDisabled = false,
}: Props) {
  const labels = useProjectLabels();
  const tiles = useSetting(SETTINGS.sidebarStyle) === "tiles";
  const appearance = useProjectAppearance(tiles ? path : null);
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
  const [editingMemory, setEditingMemory] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  // The full name joins the tooltip only while the row cuts it off.
  const [nameCut, setNameCut] = useState(false);
  useEffect(() => {
    if (visible) return;
    setMenu(null);
    setRemoving(false);
    setCustomizing(false);
    setEditingMemory(false);
  }, [visible]);
  const label = projectDisplayName(
    path,
    labels,
    basename(path) || projectName(path),
  );
  const isPinned = pinned.some((item) => sameProjectPath(item, path));
  // Short on purpose: the row itself opens the project, and Project memory
  // is in Customise project.
  const moveRows: ExplorerMenuItem[] = onMove
    ? profiles
        .filter((profile) => profile.id !== activeProfileId)
        .map((profile) => ({
          kind: "item" as const,
          id: `move:${profile.id}`,
          label: `Move to ${profile.name}`,
        }))
    : [];
  const items: ExplorerMenuItem[] = [
    {
      kind: "item",
      id: "pin",
      label: isPinned ? "Unpin project" : "Pin project",
    },
    ...(onNewInCopy
      ? [
          {
            kind: "item" as const,
            id: "new-copy",
            label: NEW_CHAT_IN_COPY_LABEL,
          },
        ]
      : []),
    { kind: "item", id: "customize", label: "Customise project…" },
    ...(onOpenBoard
      ? [{ kind: "item" as const, id: "board", label: "Open board" }]
      : []),
    // A bot already here keeps its settings; the menu offers no "Add a bot".
    ...(onBotSettings && botOn
      ? [{ kind: "item" as const, id: "bot", label: "Bot settings…" }]
      : []),
    { kind: "sep" },
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
    ...pageOrInline("move", "Move to workspace", moveRows),
    ...(onRemove
      ? [
          { kind: "sep" as const },
          { kind: "item" as const, id: "archive", label: "Archive project" },
          {
            kind: "item" as const,
            id: "delete",
            label: "Delete project and its chats…",
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
  const keeper = useMemoryKeeperProject(path);
  const now = Date.now();
  // Aven updated the project's memory: a line in the tooltip for a day, and
  // a quiet mark until the memory is opened.
  const memoryNote = keeperRowNote(keeper, now);
  const memoryUnseen = unseenKeeperChange(keeper, now) != null;
  const summary = [
    describeProjectStatus(status),
    memoryUnseen ? "memory updated" : "",
  ]
    .filter(Boolean)
    .join(", ");
  // The hover card says all of this for a mouse: while it shows, the
  // tooltip steps aside so the two never stack.
  const peek = useHoverCard({
    disabled: peekDisabled || !visible || !!menu || customizing,
  });
  const tooltip = [
    nameCut ? label : "",
    describeProjectStatus(status),
    memoryNote,
    path,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <>
      <div
        ref={rowRef}
        className="personal-project-row"
        data-project-path={path}
        data-active={active || undefined}
        data-tour={active ? "project-active" : "project"}
      >
        <button
          ref={openRef}
          type="button"
          className="personal-project-open"
          title={peek.open ? undefined : tooltip}
          aria-label={`Open ${label} project${summary ? `, ${summary}` : ""}`}
          onClick={onSelect}
          onPointerEnter={(event) => {
            setNameCut(isTextTruncated(labelRef.current));
            peek.triggerProps.onPointerEnter(event);
          }}
          onPointerLeave={peek.triggerProps.onPointerLeave}
          onPointerDown={peek.close}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={contextKey}
        >
          {tiles ? (
            // Tiles style, as in Super: the project's logo, or the first
            // letter of its name on a tile in its colour.
            <span
              className="personal-project-tile"
              style={
                appearance
                  ? ({
                      "--project-tile-color": appearance.color,
                    } as CSSProperties)
                  : undefined
              }
              aria-hidden
            >
              <ProjectMark path={path} logoOnly />
              <span className="personal-project-tile-letter">
                {Array.from(label.trim())[0]?.toUpperCase() ?? ""}
              </span>
            </span>
          ) : (
            <ProjectMark
              path={path}
              logoOnly
              className="personal-project-symbol"
            />
          )}
          <span ref={labelRef} className="personal-project-label">
            {label}
          </span>
          <ProjectRowStatus
            path={path}
            folded={!expanded}
            status={status}
            memoryUpdated={memoryUnseen}
          />
        </button>
        <button
          type="button"
          className="personal-project-row-action personal-project-disclosure"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label} chats`}
          title={`${expanded ? "Hide" : "Show"} ${label}'s chats`}
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
            aria-label={`New chat in ${label}`}
            title={`New chat in ${label}`}
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
      <ProjectPeekCard
        state={peek}
        anchor={openRef}
        path={path}
        name={label}
        status={status}
        chats={chats}
        note={memoryNote || undefined}
      />
      {menu ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          items={items}
          pages={{ move: moveRows }}
          ariaLabel={`Actions for ${label}`}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            if (id === "open") onSelect();
            else if (id === "new-copy") onNewInCopy?.();
            else if (id === "board") onOpenBoard?.();
            else if (id === "customize") setCustomizing(true);
            else if (id === "memory") setEditingMemory(true);
            else if (id === "bot") onBotSettings?.();
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
      {editingMemory ? (
        <ProjectMemoryDialog
          path={path}
          onClose={() => setEditingMemory(false)}
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
 * Quiet, right-aligned status: a small brain after Aven updated the
 * project's memory (until it is opened), an amber dot while something waits
 * for the user, the unread reply count, and the changed-file count. A running
 * agent is its little working screen: the project's mark stays still.
 */
function ProjectRowStatus({
  path,
  folded,
  status,
  memoryUpdated = false,
}: {
  /** Its project: an agent at work there wears its colour. */
  path: string;
  /**
   * Folded, its row is the only place to say an agent works there; open,
   * the agent's own row says it, once.
   */
  folded: boolean;
  status?: ProjectStatus;
  memoryUpdated?: boolean;
}) {
  const { waiting, unread, files } = status ?? {};
  const running = folded && status?.running;
  if (!running && !waiting && !unread && !files && !memoryUpdated) return null;
  return (
    <span className="personal-project-status" aria-hidden>
      {memoryUpdated ? (
        <Brain
          className="personal-project-memory size-3"
          strokeWidth={1.75}
          data-memory-updated
        />
      ) : null}
      {running ? (
        // An agent at work: its little screen, in the project's colour.
        <span className="personal-project-running">
          <CrewCritter
            path={path}
            role="lead"
            state="working"
            className="personal-project-running-mark"
          />
        </span>
      ) : null}
      {waiting ? <span className="personal-project-waiting" /> : null}
      {unread ? (
        <span className="personal-project-unread">{unread}</span>
      ) : null}
      {files ? (
        // A dot at rest; the stylesheet shows the count on hover or focus.
        <span className="personal-project-files" data-count={files}>
          <span className="personal-project-files-count">+{files}</span>
        </span>
      ) : null}
    </span>
  );
}
