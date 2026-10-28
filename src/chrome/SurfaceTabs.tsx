import {
  GitCompare,
  GripVertical,
  Kanban,
  Smartphone,
  Terminal,
  X,
} from "./icons";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { logError } from "../lib/errors";
import { basename } from "../lib/fs";
import {
  BOARD_TAB_TITLE,
  isAgentTab,
  isBoardTab,
  isChangesTab,
  isCommitTab,
  isDiskFileTab,
  isPlanTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isSimulatorTab,
  isTerminalTab,
  SIMULATOR_TAB_TITLE,
  type FilePaneTab,
} from "../lib/layout";
import { REVEAL_LABEL } from "../lib/platform";
import { releaseNotesTitle } from "../lib/releaseNotes";
import { revealFile } from "../lib/revealFile";
import { terminalTabLabel } from "../lib/terminalTab";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useSortable } from "../hooks/useSortable";
import {
  TAB_TRACK_ID_ATTRIBUTE,
  useTabHighlight,
} from "../hooks/useTabHighlight";
import { trackSeparators } from "../lib/tabTrack";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { FileTypeIcon } from "./FileTypeIcon";
import { HarnessIcon } from "./HarnessIcon";

type Props = {
  files: FilePaneTab[];
  activeFileId: string;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onReorder: (ids: string[]) => void;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  /**
   * Puts a file tab's file in a chat. A file on disk always has a right-click
   * menu (show in Finder, copy its path, close); this adds "Add to chat".
   */
  onAddToChat?: (fileId: string) => void;
  label?: string;
  trailing?: ReactNode;
  /** False dims the active tab's fill while another pane has focus. */
  paneFocused?: boolean;
};

type TabMenu = { fileId: string; x: number; y: number; anchor?: HTMLElement };

/** A file tab's right-click menu. */
export function fileTabMenuItems(canAddToChat: boolean): ExplorerMenuItem[] {
  return [
    ...(canAddToChat
      ? [
          { kind: "item", id: "add-to-chat", label: "Add to chat" } as const,
          { kind: "sep" } as const,
        ]
      : []),
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
    { kind: "item", id: "copy-path", label: "Copy path" },
    { kind: "sep" },
    { kind: "item", id: "close", label: "Close" },
  ];
}

export type SurfaceTabPresentation = {
  name: string;
  label: string;
  iconName: string;
  tooltip: string;
};

export function surfaceTabPresentation(
  file: FilePaneTab,
): SurfaceTabPresentation {
  if (isReleaseNotesTab(file)) {
    const title = releaseNotesTitle(file.releaseNotes.version);
    return {
      name: title,
      label: title,
      iconName: "CHANGELOG.md",
      tooltip: title,
    };
  }

  if (isChangesTab(file)) {
    const staged = file.changeKind === "staged";
    return {
      name: staged ? "Staged Changes" : "Changes",
      label: staged ? "Staged Changes" : "Changes",
      iconName: "CHANGES",
      tooltip: staged ? "Staged changes" : "Working tree changes",
    };
  }

  if (isSessionChangesTab(file)) {
    return {
      name: "Chat Changes",
      label: "Chat Changes",
      iconName: "CHANGES",
      tooltip: "Changes made in this chat",
    };
  }

  if (isBoardTab(file)) {
    return {
      name: BOARD_TAB_TITLE,
      label: BOARD_TAB_TITLE,
      iconName: "BOARD",
      tooltip: `Board · ${file.board.project}`,
    };
  }

  if (isSimulatorTab(file)) {
    return {
      name: SIMULATOR_TAB_TITLE,
      label: SIMULATOR_TAB_TITLE,
      iconName: "IPHONE",
      tooltip: `iPhone simulator · ${file.simulator.project}`,
    };
  }

  if (isAgentTab(file)) {
    const name = file.path.trim() || "Agent";
    return {
      name,
      label: name,
      iconName: "AGENT",
      tooltip: `${name} — orchestration agent`,
    };
  }

  if (isCommitTab(file)) {
    const name = file.commit.subject.trim() || file.commit.shortSha;
    return {
      name,
      label: name,
      iconName: "CHANGES",
      tooltip: `${file.commit.shortSha} — ${file.commit.subject}`,
    };
  }

  const review = isReviewTab(file);
  const terminal = isTerminalTab(file);
  const name = isPlanTab(file)
    ? file.plan.title.trim() || "Plan"
    : terminal
      ? terminalTabLabel(file)
      : basename(file.path);
  return {
    name,
    label: review ? `${name} (Working Tree)` : name,
    iconName: isPlanTab(file) ? "plan.md" : name,
    tooltip: isPlanTab(file)
      ? name
      : terminal
        ? `${name} — ${file.cwd}`
        : review
          ? `${file.path} (Working Tree)`
          : file.path,
  };
}

/** Tab tooltip: the path, then what is wrong with it. */
export function appendProblems(title: string, errors: number): string {
  if (!errors) return title;
  return `${title} — ${errors} ${errors === 1 ? "problem" : "problems"}`;
}

export function SurfaceTabs({
  files,
  activeFileId,
  dirtyFileIds,
  fileErrorCounts,
  onSelectFile,
  onCloseFile,
  onReorder,
  onPaneDragStart,
  onAddToChat,
  label = "Open files",
  trailing,
  paneFocused,
}: Props) {
  const [menu, setMenu] = useState<TabMenu | null>(null);
  const menuFile = menu
    ? files.find((file) => file.id === menu.fileId)
    : undefined;
  const pickMenu = (id: string) => {
    setMenu(null);
    if (!menuFile) return;
    if (id === "add-to-chat") onAddToChat?.(menuFile.id);
    else if (id === "reveal") revealFile(menuFile.path, "reveal file tab");
    else if (id === "copy-path")
      void copyText(menuFile.path).catch((error: unknown) =>
        logError("copy file tab path", error),
      );
    else if (id === "close") onCloseFile(menuFile.id);
  };
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusedTabControlRef = useRef<HTMLElement | null>(null);
  const visibleIds = files.map((file) => file.id);
  const tabStopId = visibleIds.includes(activeFileId)
    ? activeFileId
    : visibleIds[0];
  // Every open file keeps its own tab; there is no replaceable preview.
  const sortable = useSortable(visibleIds, onReorder, { animate: true });
  const setTabStripRef = useCallback(
    (element: HTMLDivElement | null) => {
      tabStripRef.current = element;
      sortable.setContainerRef(element);
      lockOverscroll(element);
    },
    [sortable.setContainerRef, lockOverscroll],
  );
  const canDrag = files.length > 1;
  // Two tabs or more stand on a track: equal shares, one sliding highlight
  // and a hairline between resting neighbours (see tabTrack.ts).
  const track = files.length > 1;
  const separators = track
    ? trackSeparators(
        visibleIds.map((id) => ({ id, tab: true })),
        activeFileId,
      )
    : null;
  const highlightRef = useTabHighlight(
    tabStripRef,
    track ? activeFileId : null,
    {
      enabled: track && !sortable.draggingId,
      layoutKey: visibleIds.join("\n"),
    },
  );
  useLayoutEffect(() => {
    if (sortable.draggingId) return;
    tabButtonsRef.current.get(activeFileId)?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
    });
  }, [activeFileId, sortable.draggingId]);

  useLayoutEffect(() => {
    const focusedControl = focusedTabControlRef.current;
    if (!focusedControl || focusedControl.isConnected) return;
    focusedTabControlRef.current = null;
    // A close can be asynchronous (for example an unsaved-file dialog). Only
    // recover focus when removing the control left it on the document itself.
    if (document.activeElement !== document.body) return;
    const next = tabStopId ? tabButtonsRef.current.get(tabStopId) : null;
    (next ?? tabStripRef.current)?.focus();
  });

  return (
    <div
      className="aven-surface-tabs aven-tab-bar flex min-w-0 shrink-0"
      data-pane-focused={paneFocused}
    >
      <div
        ref={setTabStripRef}
        data-sortable-scroll-container
        role="tablist"
        tabIndex={visibleIds.length ? -1 : 0}
        aria-label={label}
        aria-orientation="horizontal"
        data-tab-track={track || undefined}
        className="aven-surface-tab-strip aven-tab-strip scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto overscroll-none"
        onBlurCapture={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            focusedTabControlRef.current = null;
          }
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            !(event.target instanceof HTMLButtonElement) ||
            event.target.getAttribute("role") !== "tab"
          ) {
            return;
          }
          const index = visibleIds.findIndex(
            (id) => tabButtonsRef.current.get(id) === event.target,
          );
          if (index < 0) return;
          const nextIndex =
            event.key === "ArrowRight"
              ? (index + 1) % visibleIds.length
              : event.key === "ArrowLeft"
                ? (index - 1 + visibleIds.length) % visibleIds.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? visibleIds.length - 1
                    : -1;
          if (nextIndex < 0) return;
          event.preventDefault();
          const nextId = visibleIds[nextIndex];
          tabButtonsRef.current.get(nextId)?.focus();
          onSelectFile(nextId);
        }}
      >
        {track ? (
          <span ref={highlightRef} className="aven-tab-highlight" aria-hidden />
        ) : null}
        {onPaneDragStart ? (
          <div
            role="button"
            title="Drag to reorder pane"
            aria-label="Drag to reorder pane"
            tabIndex={-1}
            className="grid h-full w-5 shrink-0 cursor-grab place-items-center text-content/35 hover:bg-content/5 hover:text-content/70 active:cursor-grabbing touch-none"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              onPaneDragStart(event);
            }}
          >
            <GripVertical className="size-3.5" strokeWidth={1.75} />
          </div>
        ) : null}
        {files.map((file, index) => {
          const active = file.id === activeFileId;
          const dirty = dirtyFileIds.has(file.id);
          const errors = fileErrorCounts.get(file.id) ?? 0;
          const changes = isChangesTab(file);
          const commit = isCommitTab(file);
          const review = isReviewTab(file) && !changes;
          const terminal = isTerminalTab(file);
          const agent = isAgentTab(file) ? file.agent : null;
          const board = isBoardTab(file);
          const simulator = isSimulatorTab(file);
          const { label, iconName, tooltip } = surfaceTabPresentation(file);
          const onDisk = isDiskFileTab(file);
          const showStart =
            sortable.draggingId &&
            sortable.toIndex === index &&
            sortable.fromIndex !== null &&
            sortable.toIndex < sortable.fromIndex;
          const showEnd =
            sortable.draggingId &&
            sortable.toIndex === index &&
            sortable.fromIndex !== null &&
            sortable.toIndex > sortable.fromIndex;
          return (
            <div
              key={file.id}
              ref={(el) => {
                sortable.setItemRef(file.id, el);
              }}
              data-active={active}
              data-closable
              data-draggable={canDrag || undefined}
              // A lone file names its pane's tab: lent its pane's header,
              // it moves that tab, as the tab's own chip would.
              data-pane-grab={files.length === 1 ? "face" : undefined}
              // Its right-click opens the file's menu, not its pane's.
              data-own-menu={onDisk || undefined}
              {...{ [TAB_TRACK_ID_ATTRIBUTE]: file.id }}
              data-tab-separator={separators?.has(file.id) || undefined}
              onFocusCapture={(event) => {
                focusedTabControlRef.current = event.target as HTMLElement;
              }}
              className="aven-surface-tab-slot aven-tab aven-tab-slot group relative flex h-full shrink touch-none items-center"
              onContextMenu={(event) => {
                if (!onDisk) return;
                event.preventDefault();
                event.stopPropagation();
                setMenu({
                  fileId: file.id,
                  x: event.clientX,
                  y: event.clientY,
                  anchor: tabButtonsRef.current.get(file.id),
                });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (
                  (event.target as HTMLElement | null)?.closest(
                    "[data-no-drag]",
                  )
                ) {
                  return;
                }
                onSelectFile(file.id);
                sortable.onItemPointerDown(file.id, event);
              }}
            >
              {showStart ? (
                <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 left-0 z-20 rounded-full" />
              ) : null}
              {showEnd ? (
                <div className="personal-tab-insertion pointer-events-none absolute inset-y-1.5 right-0 z-20 rounded-full" />
              ) : null}
              <div
                className="aven-tab-motion"
                data-sortable-motion
                data-sortable-glass
              >
                <button
                  ref={(element) => {
                    if (element) tabButtonsRef.current.set(file.id, element);
                    else tabButtonsRef.current.delete(file.id);
                  }}
                  type="button"
                  role="tab"
                  tabIndex={file.id === tabStopId ? 0 : -1}
                  aria-selected={active}
                  title={appendProblems(tooltip, errors)}
                  aria-haspopup={onDisk ? "menu" : undefined}
                  onClick={() => {
                    if (sortable.consumeClick()) return;
                    onSelectFile(file.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !onDisk ||
                      (event.key !== "ContextMenu" &&
                        !(event.shiftKey && event.key === "F10"))
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({
                      fileId: file.id,
                      x: rect.left,
                      y: rect.bottom,
                      anchor: event.currentTarget,
                    });
                  }}
                  // Its icon and name are the dragged tab's compact chip.
                  data-sortable-chip
                  className="aven-surface-tab-button aven-tab-button flex min-w-0 flex-1 items-center text-left"
                >
                  {terminal ? (
                    <Terminal
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : agent ? (
                    <HarnessIcon
                      harness={agent.harness}
                      className="size-3.5 shrink-0"
                    />
                  ) : board ? (
                    <Kanban className="size-3.5 shrink-0" strokeWidth={1.75} />
                  ) : simulator ? (
                    <Smartphone
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : changes || commit ? (
                    <GitCompare
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <FileTypeIcon name={iconName} isDir={false} size={14} />
                  )}
                  <span
                    className={`aven-surface-tab-label aven-tab-label min-w-0 flex-1 truncate ${review ? "italic" : ""} ${
                      errors
                        ? active
                          ? "text-red-400"
                          : "text-red-400/75 group-hover:text-red-400"
                        : ""
                    }`}
                  >
                    {label}
                  </span>
                  {dirty ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-content/75"
                      title="Unsaved changes"
                      aria-label="Unsaved changes"
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  tabIndex={file.id === tabStopId ? 0 : -1}
                  title={`Close ${label}`}
                  aria-label={`Close ${label}`}
                  data-no-drag
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseFile(file.id);
                  }}
                  className="aven-surface-tab-close aven-tab-close"
                >
                  <X className="size-3" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          );
        })}
        {onPaneDragStart ? (
          <div
            className={`${
              track ? "w-8 shrink-0" : "min-w-4 flex-1"
            } cursor-grab active:cursor-grabbing`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              onPaneDragStart(event);
            }}
          />
        ) : null}
      </div>
      {trailing}
      {menu && menuFile ? (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          anchor={menu.anchor}
          align="start"
          gap={menu.anchor ? 4 : 0}
          width={220}
          items={fileTabMenuItems(Boolean(onAddToChat))}
          ariaLabel={`Actions for ${basename(menuFile.path)}`}
          onPick={pickMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
