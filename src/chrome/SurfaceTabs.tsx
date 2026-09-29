import {
  ChevronDown,
  GitCompare,
  GripVertical,
  Pin,
  Terminal,
  X,
} from "./icons";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { basename } from "../lib/fs";
import {
  isAgentTab,
  isChangesTab,
  isCommitTab,
  isPlanTab,
  isPreviewFileTab,
  isReleaseNotesTab,
  isReviewTab,
  isSessionChangesTab,
  isTerminalTab,
  type FilePaneTab,
} from "../lib/layout";
import { releaseNotesTitle } from "../lib/releaseNotes";
import { terminalTabLabel } from "../lib/terminalTab";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useSortable } from "../hooks/useSortable";
import { FileTypeIcon } from "./FileTypeIcon";
import { HarnessIcon } from "./HarnessIcon";
import { ExplorerMenu, type ExplorerMenuItem } from "./ExplorerMenu";
import { mergePreviewTabOrder, previewTabIds } from "../lib/previewTabs";
import "./PreviewTabs.css";

type Props = {
  files: FilePaneTab[];
  activeFileId: string;
  dirtyFileIds: Set<string>;
  fileErrorCounts: Map<string, number>;
  onSelectFile: (fileId: string) => void;
  onCloseFile: (fileId: string) => void;
  onKeepFile?: (fileId: string) => void;
  onReorder: (ids: string[]) => void;
  onPaneDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  label?: string;
  trailing?: ReactNode;
};

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
    return {
      name: "Changes",
      label: "Changes",
      iconName: "CHANGES",
      tooltip: "Working tree changes",
    };
  }

  if (isSessionChangesTab(file)) {
    return {
      name: "Session Changes",
      label: "Session Changes",
      iconName: "CHANGES",
      tooltip: "Changes captured for this session only",
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
  onKeepFile,
  onReorder,
  onPaneDragStart,
  label = "Open files",
  trailing,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusedTabControlRef = useRef<HTMLElement | null>(null);
  const [recentAnchor, setRecentAnchor] = useState<HTMLElement | null>(null);
  const fileIds = files.map((file) => file.id);
  const retainedIds = new Set(
    files
      .filter(
        (file) =>
          file.kept || dirtyFileIds.has(file.id) || !isPreviewFileTab(file),
      )
      .map((file) => file.id),
  );
  const { visibleIds, previewId } = previewTabIds(
    fileIds,
    retainedIds,
    activeFileId,
    null,
  );
  const visibleIdSet = new Set(visibleIds);
  const visibleFiles = files.filter((file) => visibleIdSet.has(file.id));
  const tabStopId = visibleIdSet.has(activeFileId)
    ? activeFileId
    : visibleIds[0];
  const hasPreviewFiles = files.some(isPreviewFileTab);
  const activePreview = previewId === activeFileId;
  const sortable = useSortable(
    visibleIds,
    (ids) => {
      onReorder(mergePreviewTabOrder(fileIds, ids));
    },
    { animate: true },
  );
  const setTabStripRef = useCallback(
    (element: HTMLDivElement | null) => {
      tabStripRef.current = element;
      sortable.setContainerRef(element);
      lockOverscroll(element);
    },
    [sortable.setContainerRef, lockOverscroll],
  );
  const canDrag = visibleFiles.length > 1;
  const recentItems: ExplorerMenuItem[] = [...files].reverse().map((file) => {
    const { label, tooltip } = surfaceTabPresentation(file);
    return {
      kind: "item",
      id: file.id,
      label,
      description: isPreviewFileTab(file) ? tooltip : undefined,
      checked: file.id === activeFileId,
      shortcut: dirtyFileIds.has(file.id)
        ? "Edited"
        : file.kept
          ? "Kept"
          : undefined,
    };
  });

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
      className={`aven-surface-tabs flex h-9 min-w-0 shrink-0 border-b border-content/10 bg-content/2${hasPreviewFiles ? " aven-preview-tabs" : ""}`}
    >
      <div
        ref={setTabStripRef}
        data-sortable-scroll-container
        role="tablist"
        tabIndex={visibleIds.length ? -1 : 0}
        aria-label={label}
        aria-orientation="horizontal"
        className="aven-surface-tab-strip scrollbar-none flex min-w-0 flex-1 overflow-x-auto overscroll-none"
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
        {visibleFiles.map((file, index) => {
          const active = file.id === activeFileId;
          const preview = file.id === previewId;
          const dirty = dirtyFileIds.has(file.id);
          const errors = fileErrorCounts.get(file.id) ?? 0;
          const changes = isChangesTab(file);
          const commit = isCommitTab(file);
          const review = isReviewTab(file) && !changes;
          const terminal = isTerminalTab(file);
          const agent = isAgentTab(file) ? file.agent : null;
          const { label, iconName, tooltip } = surfaceTabPresentation(file);
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
              data-preview={preview || undefined}
              onFocusCapture={(event) => {
                focusedTabControlRef.current = event.target as HTMLElement;
              }}
              className={`aven-surface-tab-slot group relative flex w-52 min-w-28 shrink touch-none items-stretch border-r border-content/10 ${
                active ? "bg-content/8" : "hover:bg-content/5"
              } ${canDrag ? "cursor-grab active:cursor-grabbing" : ""}`}
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
              <div className="aven-tab-motion" data-sortable-motion>
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
                  onClick={() => {
                    if (sortable.consumeClick()) return;
                    onSelectFile(file.id);
                  }}
                  onDoubleClick={() => {
                    if (isPreviewFileTab(file)) onKeepFile?.(file.id);
                  }}
                  className={`aven-surface-tab-button flex min-w-0 flex-1 items-center gap-1.5 px-3 pr-8 text-left text-[12px] ${
                    canDrag ? "cursor-grab active:cursor-grabbing" : ""
                  } ${
                    active
                      ? "text-content"
                      : "text-content/55 hover:text-content"
                  }`}
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
                  ) : changes || commit ? (
                    <GitCompare
                      className="size-3.5 shrink-0"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <FileTypeIcon name={iconName} isDir={false} size={15} />
                  )}
                  <span
                    className={`aven-preview-tab-label min-w-0 flex-1 truncate ${review || preview ? "italic" : ""} ${
                      errors
                        ? active
                          ? "text-red-400"
                          : "text-red-400/75 group-hover:text-red-400"
                        : ""
                    }`}
                  >
                    {label}
                  </span>
                  {preview ? (
                    <span className="aven-preview-badge">Preview</span>
                  ) : null}
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
                  className={`aven-surface-tab-close absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-content/50 hover:bg-content/10 hover:text-content ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <X className="size-3" strokeWidth={1.75} />
                </button>
              </div>
            </div>
          );
        })}
        {onPaneDragStart ? (
          <div
            className="min-w-4 flex-1 cursor-grab active:cursor-grabbing"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              onPaneDragStart(event);
            }}
          />
        ) : null}
      </div>
      {activePreview && onKeepFile ? (
        <button
          type="button"
          className="aven-preview-action"
          title="Keep this file open"
          onClick={() => onKeepFile(activeFileId)}
        >
          <Pin className="size-3" />
          <span>Keep open</span>
        </button>
      ) : null}
      {hasPreviewFiles && files.length > 1 ? (
        <button
          type="button"
          className="aven-preview-recent"
          aria-label="Recent files"
          aria-haspopup="menu"
          aria-expanded={recentAnchor != null}
          onClick={(event) =>
            setRecentAnchor(recentAnchor ? null : event.currentTarget)
          }
        >
          Recent <span>{files.length}</span>
          <ChevronDown className="size-3" />
        </button>
      ) : null}
      {trailing}
      {recentAnchor ? (
        <ExplorerMenu
          x={0}
          y={0}
          anchor={recentAnchor}
          align="end"
          gap={4}
          width={320}
          native
          searchable
          ariaLabel="Recent files"
          items={recentItems}
          onPick={(id) => {
            onSelectFile(id);
            setRecentAnchor(null);
          }}
          onClose={() => setRecentAnchor(null)}
        />
      ) : null}
    </div>
  );
}
