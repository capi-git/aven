import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  FoldVertical,
  MessageSquarePlus,
  Undo2,
  UnfoldVertical,
} from "../chrome/icons";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MiddleText } from "../chrome/FadeText";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { useColorScheme } from "../hooks/useColorScheme";
import { useNarrow } from "../hooks/useNarrow";
import { useSetting } from "../hooks/useSetting";
import type { ColorScheme } from "../lib/appearance";
import { diffModeSetting, saveDiffMode, type DiffMode } from "../lib/diffMode";
import {
  lineWordChanges,
  markPieces,
  wordPartners,
  type TextRange,
} from "../lib/diffWords";
import { basename } from "../lib/fs";
import { motionReduced } from "../lib/motion";
import { highlightDiffFile, type SyntaxToken } from "./syntaxTokens";
import { DiffCommentComposer } from "./DiffCommentComposer";
import {
  expandFold,
  type FoldReveal,
  type UnifiedBlock,
  type UnifiedLine,
} from "../lib/unifiedDiff";
import {
  changeOffsets,
  flattenVisibleRows,
  layoutRows,
  splitRows,
  UNIFIED_FOLD_PX,
  UNIFIED_HUNK_PX,
  UNIFIED_LINE_PX,
  UNIFIED_OVERSCAN_PX,
  windowRows,
  type DiffViewRow,
  type RowWindow,
} from "../lib/unifiedDiffWindow";

export type UnifiedDiffFileModel = {
  id: string;
  path: string;
  label: string;
  binary?: boolean;
  tooLarge?: boolean;
  emptyMessage?: string;
  additions: number;
  deletions: number;
  blocks: UnifiedBlock[];
  canStage?: boolean;
  canDiscard?: boolean;
  canStageHunk?: boolean;
};

type FileLayout = "stacked" | "cards";
type InitialExpansion = "all" | "first" | "none";

type Props = {
  files: UnifiedDiffFileModel[];
  truncated?: boolean;
  fileCount?: number;
  focusPath?: string;
  focusId?: string;
  busyId?: string | null;
  totals?: { additions: number; deletions: number };
  /** Fill the parent pane and scroll inside. Off when the parent already scrolls. */
  fill?: boolean;
  /** Changes uses a continuous stack; embedded review surfaces can use cards. */
  fileLayout?: FileLayout;
  /** Applied when a new set of files is loaded. */
  initialExpansion?: InitialExpansion;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
};

export function UnifiedDiffView({
  files,
  truncated,
  fileCount,
  focusPath,
  focusId,
  busyId,
  totals,
  fill = true,
  fileLayout = "stacked",
  initialExpansion = "all",
  onStageFile,
  onDiscardFile,
  onStageHunk,
}: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const chosenMode = useSetting(diffModeSetting);
  // Side by side needs room for two columns of code; a narrow pane shows one
  // column and drops the choice until it widens again.
  const [measureRef, narrow] = useNarrow<HTMLDivElement>(SPLIT_MIN_WIDTH);
  const mode: DiffMode =
    chosenMode === "split" && !narrow ? "split" : "unified";
  const [open, setOpen] = useState<Set<string>>(() =>
    initiallyOpenFiles(files, initialExpansion),
  );
  const [reveals, setReveals] = useState<
    Record<string, Record<string, FoldReveal>>
  >({});
  const fileRefs = useRef(new Map<string, HTMLElement>());
  const navTargets = useRef(new Map<string, DiffNavTarget>());
  const lastNav = useRef<{ y: number; scrollTop: number; at: number } | null>(
    null,
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileKey = useMemo(
    () => files.map((file) => file.id).join("\n"),
    [files],
  );
  const resolvedFocusId = useMemo(
    () =>
      focusId ??
      files.find((file) => file.path === focusPath || file.id === focusPath)
        ?.id,
    [fileKey, files, focusId, focusPath],
  );

  useEffect(() => {
    setOpen(initiallyOpenFiles(files, initialExpansion));
    setReveals({});
  }, [fileKey, initialExpansion]);

  useEffect(() => {
    if (!resolvedFocusId) return;
    const node = fileRefs.current.get(resolvedFocusId);
    const scroller = scrollerRef.current;
    if (!node || !scroller) return;
    const top = node.offsetTop - 8;
    scroller.scrollTo({ top: Math.max(0, top) });
  }, [resolvedFocusId, fileKey]);

  const bindRoot = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      measureRef(el);
    },
    [measureRef],
  );

  const bindScroller = useCallback(
    (el: HTMLDivElement | null) => {
      // In embedded mode an ancestor owns vertical scrolling. Leaving this
      // null makes each file discover that real scroll root.
      scrollerRef.current = fill ? el : null;
      lockOverscroll(fill ? el : null);
    },
    [fill, lockOverscroll],
  );

  const toggleFile = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealFold = useCallback(
    (
      fileId: string,
      foldId: string,
      total: number,
      direction: "up" | "down" | "all",
    ) => {
      setReveals((current) => ({
        ...current,
        [fileId]: {
          ...current[fileId],
          [foldId]: expandFold(current[fileId]?.[foldId], total, direction),
        },
      }));
    },
    [],
  );

  const bindFileRef = useCallback((id: string, node: HTMLElement | null) => {
    if (node) fileRefs.current.set(id, node);
    else fileRefs.current.delete(id);
  }, []);

  const registerNav = useCallback((id: string, target: DiffNavTarget) => {
    navTargets.current.set(id, target);
    return () => {
      if (navTargets.current.get(id) === target) navTargets.current.delete(id);
    };
  }, []);

  // j/k move to the next and previous change, ]/[ to the next and previous
  // file, each landing just under the file's pinned header (after Rune's
  // diff view). Keys typed into a field, such as a comment, stay there.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey || isTypingTarget(event.target)) return;
      const key = event.key;
      if (key !== "j" && key !== "k" && key !== "]" && key !== "[") return;
      const root = rootRef.current;
      const scroller =
        scrollerRef.current ?? (root ? verticalScrollParent(root) : null);
      if (!scroller) return;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const topOf = (node: HTMLElement) =>
        node.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
      const header = headerHeight(fileRefs.current);
      const stops: number[] = [];
      for (const file of files) {
        if (key === "]" || key === "[") {
          const section = fileRefs.current.get(file.id);
          if (section) stops.push(topOf(section));
          continue;
        }
        const target = navTargets.current.get(file.id);
        const body = target?.body();
        if (!target || !body) continue;
        const bodyTop = topOf(body);
        // Lines of context above the change stay in view.
        for (const offset of target.changes()) {
          stops.push(bodyTop + offset - header - NAV_CONTEXT_PX);
        }
      }
      if (stops.length === 0) return;
      event.preventDefault();
      const max = scroller.scrollHeight - scroller.clientHeight;
      // Go on from the last move's stop while it is still scrolling there or
      // was reached; one the end of the list cut short counts from where the
      // list stopped.
      const previous = lastNav.current;
      const fresh =
        previous != null &&
        previous.scrollTop === previous.y &&
        (performance.now() - previous.at < NAV_SETTLE_MS ||
          Math.abs(scroller.scrollTop - previous.scrollTop) < 2);
      const position = fresh ? previous.y : scroller.scrollTop;
      const forward = key === "j" || key === "]";
      const next = forward
        ? stops.find((stop) => stop > position + 1)
        : [...stops].reverse().find((stop) => stop < position - 1);
      if (next == null) return;
      const top = Math.max(0, Math.min(max, next));
      lastNav.current = { y: next, scrollTop: top, at: performance.now() };
      scroller.scrollTo({
        top,
        behavior: motionReduced() ? "auto" : "smooth",
      });
    },
    [files],
  );

  if (files.length === 0) {
    return (
      <p className="px-4 py-6 text-ui-body text-content/45">No file changes</p>
    );
  }

  const count = fileCount ?? files.length;
  const fileLabel = count === 1 ? "1 file" : `${count} files`;
  const additions =
    totals?.additions ?? files.reduce((sum, file) => sum + file.additions, 0);
  const deletions =
    totals?.deletions ?? files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div
      ref={bindRoot}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`outline-none ${
        fill
          ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden"
          : "flex flex-col"
      }`}
    >
      <div
        className={`flex h-8 shrink-0 items-center gap-3 border-b border-content/10 px-3 text-ui-label`}
      >
        <span className="text-content/70">{fileLabel}</span>
        <DiffCounts additions={additions} deletions={deletions} />
        <span className="ml-auto flex items-center gap-0.5">
          {narrow ? null : (
            <button
              type="button"
              title="Side by side"
              aria-label="Side by side"
              aria-pressed={mode === "split"}
              onClick={() =>
                saveDiffMode(mode === "split" ? "unified" : "split")
              }
              className={`grid size-7 place-items-center rounded-md hover:bg-content/10 hover:text-content ${
                mode === "split"
                  ? "bg-content/10 text-content"
                  : "text-content/45"
              }`}
            >
              <Columns2 className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            title="Expand all files"
            aria-label="Expand all files"
            onClick={() => setOpen(new Set(files.map((file) => file.id)))}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
          >
            <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title="Collapse all files"
            aria-label="Collapse all files"
            disabled={open.size === 0}
            onClick={() => setOpen(new Set())}
            className="grid size-7 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
          >
            <FoldVertical className="size-3.5" strokeWidth={1.75} />
          </button>
        </span>
      </div>
      <div
        ref={bindScroller}
        className={
          fill
            ? "unified-diff min-h-0 flex-1 overflow-y-auto overscroll-none"
            : "unified-diff"
        }
      >
        {truncated ? (
          <p className="px-3 py-3 text-ui-label text-content/45">
            Diff is too large to display in full. File list is shown without
            patches.
          </p>
        ) : null}
        <div
          className={
            fileLayout === "cards"
              ? "flex flex-col gap-2 pt-2"
              : "flex flex-col"
          }
        >
          {files.map((file) => (
            <FileSection
              key={file.id}
              file={file}
              expanded={open.has(file.id)}
              focused={resolvedFocusId === file.id}
              busy={busyId === file.id}
              reveals={reveals[file.id] ?? EMPTY_REVEALS}
              fileLayout={fileLayout}
              mode={mode}
              colorScheme={colorScheme}
              scrollerRef={scrollerRef}
              onToggle={toggleFile}
              onReveal={revealFold}
              onStageFile={onStageFile}
              onDiscardFile={onDiscardFile}
              onStageHunk={onStageHunk}
              bindRef={bindFileRef}
              registerNav={registerNav}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Below this width a diff shows one column, whatever was chosen. */
const SPLIT_MIN_WIDTH = 640;
/** Context lines kept above a change that `j` or `k` lands on. */
const NAV_CONTEXT_PX = UNIFIED_LINE_PX * 2;
/** While a move is still scrolling, the next press goes on from its target. */
const NAV_SETTLE_MS = 600;

function headerHeight(sections: Map<string, HTMLElement>): number {
  for (const section of sections.values()) {
    const header = section.querySelector<HTMLElement>(":scope > header");
    if (header) return header.offsetHeight;
  }
  return 0;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

type FileSectionProps = {
  file: UnifiedDiffFileModel;
  expanded: boolean;
  focused: boolean;
  busy: boolean;
  reveals: Record<string, FoldReveal>;
  fileLayout: FileLayout;
  mode: DiffMode;
  colorScheme: ColorScheme;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onToggle: (id: string) => void;
  onReveal: (
    fileId: string,
    foldId: string,
    total: number,
    direction: "up" | "down" | "all",
  ) => void;
  onStageFile?: (id: string) => void;
  onDiscardFile?: (id: string) => void;
  onStageHunk?: (id: string, pos: number) => void;
  bindRef: (path: string, node: HTMLElement | null) => void;
  registerNav: RegisterNav;
};

const FileSection = memo(function FileSection({
  file,
  expanded,
  focused,
  busy,
  reveals,
  fileLayout,
  mode,
  colorScheme,
  scrollerRef,
  onToggle,
  onReveal,
  onStageFile,
  onDiscardFile,
  onStageHunk,
  bindRef,
  registerNav,
}: FileSectionProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const name = basename(file.path);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [near, setNear] = useState(false);
  const [tokens, setTokens] = useState<Map<UnifiedLine, SyntaxToken[]> | null>(
    null,
  );

  useEffect(() => {
    if (!expanded || !near) return;
    let cancelled = false;
    void highlightDiffFile(file, colorScheme).then((next) => {
      if (!cancelled) setTokens(next);
    });
    return () => {
      cancelled = true;
    };
  }, [colorScheme, expanded, file, near]);

  const setSection = useCallback(
    (node: HTMLElement | null) => {
      sectionRef.current = node;
      bindRef(file.id, node);
    },
    [bindRef, file.id],
  );

  useLayoutEffect(() => {
    if (!expanded) return;
    const section = sectionRef.current;
    if (!section) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    setNear(isNearViewport(section, root, 800));
  }, [expanded, scrollerRef, file.id]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !expanded) return;
    const root = scrollerRef.current ?? verticalScrollParent(section);
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = entry.isIntersecting;
        setNear((current) => (current === next ? current : next));
      },
      { root, rootMargin: "800px 0px", threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [expanded, scrollerRef]);

  return (
    <section
      ref={setSection}
      data-diff-file={file.path}
      className={`${
        fileLayout === "cards"
          ? // Clip rather than hide, so the header can still stick to the
            // scroller this card sits in.
            "overflow-clip rounded-md border border-content/10"
          : ""
      } ${focused ? "bg-content/[0.03]" : ""}`}
    >
      <header
        className={`${
          fileLayout === "stacked"
            ? // Opaque rather than blurred: a backdrop blur per pinned header
              // re-renders on every scroll frame over the moving diff.
              "bg-[color-mix(in_srgb,var(--color-content)_4%,var(--color-background-base))]"
            : "bg-[color-mix(in_srgb,var(--color-content)_2%,var(--color-background-base))]"
        } sticky top-0 z-30 flex items-center gap-2 px-3 py-1.5 ${
          fileLayout === "stacked" || expanded
            ? "border-b border-content/10"
            : ""
        }`}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggle(file.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron
            className="size-3.5 shrink-0 text-content/45"
            strokeWidth={1.75}
          />
          <FileTypeIcon name={name} isDir={false} size={16} />
          <MiddleText
            text={file.label}
            className="flex-1 font-mono text-ui-label text-content/85"
          />
          <DiffCounts additions={file.additions} deletions={file.deletions} />
        </button>
        {file.canDiscard && onDiscardFile ? (
          <IconButton
            title="Discard file"
            disabled={busy}
            onClick={() => onDiscardFile(file.id)}
          >
            <Undo2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {file.canStage && onStageFile ? (
          <button
            type="button"
            title="Stage file"
            aria-label="Stage file"
            disabled={busy}
            onClick={() => onStageFile(file.id)}
            className="grid size-4 place-items-center rounded-[3px] bg-content text-background-base hover:bg-(--aven-inverse-hover) disabled:opacity-40"
          >
            <Check className="size-2.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </header>
      {expanded ? (
        <FileBody
          file={file}
          reveals={reveals}
          near={near}
          tokens={tokens}
          mode={mode}
          scrollerRef={scrollerRef}
          registerNav={registerNav}
          onReveal={(foldId, direction) => {
            const block = file.blocks.find(
              (entry) => entry.kind === "fold" && entry.id === foldId,
            );
            const total = block?.kind === "fold" ? block.lines.length : 0;
            onReveal(file.id, foldId, total, direction);
          }}
          onStageHunk={onStageHunk}
        />
      ) : null}
    </section>
  );
}, equalFileSectionProps);

const EMPTY_REVEALS: Record<string, FoldReveal> = {};

function equalFileSectionProps(
  previous: FileSectionProps,
  next: FileSectionProps,
): boolean {
  return (
    equalFileModel(previous.file, next.file) &&
    previous.expanded === next.expanded &&
    previous.focused === next.focused &&
    previous.busy === next.busy &&
    previous.reveals === next.reveals &&
    previous.fileLayout === next.fileLayout &&
    previous.mode === next.mode &&
    previous.registerNav === next.registerNav &&
    previous.colorScheme === next.colorScheme &&
    previous.scrollerRef === next.scrollerRef &&
    previous.onToggle === next.onToggle &&
    previous.onReveal === next.onReveal &&
    previous.onStageFile === next.onStageFile &&
    previous.onDiscardFile === next.onDiscardFile &&
    previous.onStageHunk === next.onStageHunk &&
    previous.bindRef === next.bindRef
  );
}

function equalFileModel(
  previous: UnifiedDiffFileModel,
  next: UnifiedDiffFileModel,
): boolean {
  return (
    previous.id === next.id &&
    previous.path === next.path &&
    previous.label === next.label &&
    previous.binary === next.binary &&
    previous.tooLarge === next.tooLarge &&
    previous.emptyMessage === next.emptyMessage &&
    previous.additions === next.additions &&
    previous.deletions === next.deletions &&
    (previous.blocks === next.blocks ||
      (previous.blocks.length === 0 && next.blocks.length === 0)) &&
    previous.canStage === next.canStage &&
    previous.canDiscard === next.canDiscard &&
    previous.canStageHunk === next.canStageHunk
  );
}

function FileBody({
  file,
  reveals,
  near,
  tokens,
  mode,
  scrollerRef,
  registerNav,
  onReveal,
  onStageHunk,
}: {
  file: UnifiedDiffFileModel;
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  mode: DiffMode;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  registerNav: RegisterNav;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
}) {
  if (file.binary) return <EmptyBody>Binary file changed</EmptyBody>;
  if (file.tooLarge) return <EmptyBody>Diff is too large to display</EmptyBody>;
  if (file.emptyMessage) return <EmptyBody>{file.emptyMessage}</EmptyBody>;
  if (file.blocks.length === 0) return <EmptyBody>No textual diff</EmptyBody>;

  return (
    <VirtualRows
      fileId={file.id}
      filePath={file.path}
      blocks={file.blocks}
      reveals={reveals}
      near={near}
      tokens={tokens}
      canStageHunk={file.canStageHunk}
      mode={mode}
      scrollerRef={scrollerRef}
      onReveal={onReveal}
      onStageHunk={onStageHunk}
      registerNav={registerNav}
    />
  );
}

function VirtualRows({
  fileId,
  filePath,
  blocks,
  reveals,
  near,
  tokens,
  canStageHunk,
  mode,
  scrollerRef,
  onReveal,
  onStageHunk,
  registerNav,
}: {
  fileId: string;
  filePath: string;
  blocks: UnifiedBlock[];
  reveals: Record<string, FoldReveal>;
  near: boolean;
  tokens: Map<UnifiedLine, SyntaxToken[]> | null;
  canStageHunk?: boolean;
  mode: DiffMode;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  onReveal: (foldId: string, direction: "up" | "down" | "all") => void;
  onStageHunk?: (id: string, pos: number) => void;
  registerNav: RegisterNav;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const mouseYRef = useRef<number | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverSide, setHoverSide] = useState<Side>("both");
  const [commentTarget, setCommentTarget] = useState<DiffCommentDraft | null>(
    null,
  );
  const unifiedRows = useMemo(
    () =>
      flattenVisibleRows(
        blocks,
        (foldId) => reveals[foldId],
        !!canStageHunk && !!onStageHunk,
      ),
    [blocks, canStageHunk, fileId, onStageHunk, reveals],
  );
  const partners = useMemo(() => {
    const lines: UnifiedLine[] = [];
    for (const row of unifiedRows)
      if (row.type === "line") lines.push(row.line);
    return wordPartners(lines);
  }, [unifiedRows]);
  const rows = useMemo(
    () => (mode === "split" ? splitRows(unifiedRows) : unifiedRows),
    [mode, unifiedRows],
  );
  const rowLayout = useMemo(() => layoutRows(rows), [rows]);
  const totalHeight = rowLayout.totalHeight;
  const widths = useMemo(() => laneWidths(rows), [rows]);
  const [range, setRange] = useState<RowWindow>(() => ({
    start: 0,
    end: 0,
    padTop: 0,
    padBottom: totalHeight,
  }));

  useEffect(
    () =>
      registerNav(fileId, {
        body: () => bodyRef.current,
        changes: () => changeOffsets(rows, rowLayout),
      }),
    [fileId, registerNav, rowLayout, rows],
  );

  const updateWindow = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const root = scrollerRef.current ?? verticalScrollParent(body);
    const rootRect = root
      ? root.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const bodyRect = body.getBoundingClientRect();
    const next = windowRows(
      rows,
      rootRect.top - bodyRect.top,
      rootRect.bottom - bodyRect.top,
      UNIFIED_OVERSCAN_PX,
      rowLayout,
    );
    setRange((current) =>
      current.start === next.start &&
      current.end === next.end &&
      current.padTop === next.padTop &&
      current.padBottom === next.padBottom
        ? current
        : next,
    );
  }, [rowLayout, rows, scrollerRef]);

  const hoverAtY = useCallback(
    (clientY: number | null) => {
      const body = bodyRef.current;
      if (clientY == null || !body) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      let y = clientY - body.getBoundingClientRect().top - range.padTop;
      if (y < 0) {
        setHoverKey((current) => (current == null ? current : null));
        return;
      }
      for (let index = range.start; index < range.end; index += 1) {
        const row = rows[index];
        if (!row) break;
        if (y < row.height) {
          const key = diffRowKey(row, index);
          setHoverKey((current) => (current === key ? current : key));
          return;
        }
        y -= row.height;
      }
      setHoverKey((current) => (current == null ? current : null));
    },
    [range.end, range.padTop, range.start, rows],
  );

  useLayoutEffect(() => {
    if (!near) return;
    updateWindow();
  }, [near, updateWindow, totalHeight]);

  useLayoutEffect(() => {
    if (!near) return;
    hoverAtY(mouseYRef.current);
  }, [hoverAtY, near]);

  useLayoutEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;
    const apply = () => {
      body.style.setProperty("--unified-body-width", `${body.clientWidth}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(body);
    return () => observer.disconnect();
  }, [near, totalHeight]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    const root =
      scrollerRef.current ?? (body ? verticalScrollParent(body) : null);
    const target: HTMLElement | Window = root ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateWindow();
        hoverAtY(mouseYRef.current);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [hoverAtY, near, scrollerRef, updateWindow]);

  useEffect(() => {
    if (!near) return;
    const body = bodyRef.current;
    if (!body) return;

    // WebKit can latch a wheel gesture to a code lane's horizontal scroller
    // instead of chaining its vertical delta to the surrounding diff.
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      const code = (event.target as Element | null)?.closest?.(
        "[data-diff-code]",
      );
      if (!code || !body.contains(code)) return;
      const ownScroller = scrollerRef.current;
      const verticalScroller =
        ownScroller && ownScroller.scrollHeight > ownScroller.clientHeight + 1
          ? ownScroller
          : verticalScrollParent(body, true);
      if (!verticalScroller) return;

      const scale =
        event.deltaMode === 1
          ? UNIFIED_LINE_PX
          : event.deltaMode === 2
            ? verticalScroller.clientHeight
            : 1;
      const before = verticalScroller.scrollTop;
      const max = verticalScroller.scrollHeight - verticalScroller.clientHeight;
      const next = Math.min(max, Math.max(0, before + event.deltaY * scale));
      if (next === before) return;

      event.preventDefault();
      verticalScroller.scrollTop = next;
    };

    body.addEventListener("wheel", onWheel, { passive: false });
    return () => body.removeEventListener("wheel", onWheel);
  }, [near, scrollerRef]);

  if (!near) {
    return <div ref={bodyRef} style={{ height: totalHeight }} />;
  }

  const visible = rows.slice(range.start, range.end);
  const lanePad = {
    paddingTop: range.padTop,
    paddingBottom: range.padBottom,
  };

  const renderLane = (side: Side, part: LanePart) =>
    visible.map((row, index) => {
      const key = diffRowKey(row, range.start + index);
      const line = laneLine(row, side);
      const sideKey = `${side}:${key}`;
      const stagePos = part === "gutter" ? stagePosition(row, side) : null;
      return (
        <DiffLane
          key={`${side}-${part}-${key}`}
          row={row}
          line={line}
          side={side}
          part={part}
          first={side !== "new"}
          hovered={hoverKey === key && (side === "both" || hoverSide === side)}
          commenting={commentTarget?.key === sideKey}
          tokens={line ? tokens?.get(line) : undefined}
          changes={line ? lineWordChanges(line, partners.get(line)) : null}
          onReveal={
            row.type === "fold"
              ? (direction) => onReveal(row.id, direction)
              : undefined
          }
          onStage={
            stagePos != null ? () => onStageHunk?.(fileId, stagePos) : undefined
          }
          onComment={
            part === "gutter" && line && line.kind !== "hunk"
              ? (anchor) => setCommentTarget({ key: sideKey, line, anchor })
              : undefined
          }
        />
      );
    });

  const lane = (side: Side, width: number, divider = false) => (
    <div
      data-diff-side={side === "both" ? undefined : side}
      className={`flex min-w-0 flex-1 ${divider ? "border-l border-content/10" : ""}`}
    >
      <div
        className={`relative w-12 shrink-0 ${side === "new" ? "z-10" : "z-20"}`}
        style={lanePad}
      >
        {renderLane(side, "gutter")}
      </div>
      <div
        data-diff-code=""
        className="min-w-0 flex-1 overflow-x-auto overscroll-x-none"
      >
        <div style={{ ...lanePad, minWidth: `max(100%, ${width + 8}ch)` }}>
          {renderLane(side, "code")}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={bodyRef}
        className="flex"
        onMouseMove={(event) => {
          mouseYRef.current = event.clientY;
          if (mode === "split") {
            const side = (event.target as Element)
              .closest?.("[data-diff-side]")
              ?.getAttribute("data-diff-side");
            const next: Side = side === "new" ? "new" : "old";
            setHoverSide((current) => (current === next ? current : next));
          }
          hoverAtY(event.clientY);
        }}
        onMouseLeave={() => {
          mouseYRef.current = null;
          hoverAtY(null);
        }}
      >
        {mode === "split" ? (
          <>
            {lane("old", widths.old)}
            {lane("new", widths.new, true)}
          </>
        ) : (
          lane("both", widths.both)
        )}
      </div>
      {commentTarget ? (
        <DiffCommentComposer
          path={filePath}
          target={commentTarget}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
    </>
  );
}

/** Which side of a diff a lane draws: one column shows both. */
type Side = "old" | "new" | "both";
type LanePart = "gutter" | "code";

export type DiffNavTarget = {
  body: () => HTMLElement | null;
  changes: () => number[];
};
type RegisterNav = (fileId: string, target: DiffNavTarget) => () => void;

type DiffCommentDraft = {
  key: string;
  line: UnifiedLine;
  anchor: DOMRect;
};

function diffRowKey(row: DiffViewRow, index: number) {
  if (row.type === "fold") return `fold-${row.id}`;
  if (row.type === "pair") {
    return `${index}-pair-${row.left?.oldNumber ?? "x"}-${row.right?.newNumber ?? "x"}`;
  }
  return `${index}-${row.line.kind}-${row.line.oldNumber ?? "x"}-${row.line.newNumber ?? "x"}`;
}

/** The line a lane shows for `row`: a split side shows its half of a pair. */
function laneLine(row: DiffViewRow, side: Side): UnifiedLine | null {
  if (row.type === "fold") return null;
  if (row.type === "line") return row.line;
  return side === "new" ? row.right : row.left;
}

/** Where the stage button goes: beside the changed line, new side first. */
function stagePosition(row: DiffViewRow, side: Side): number | null {
  if (row.type === "line") {
    return side !== "new" && row.stage ? (row.line.pos ?? null) : null;
  }
  if (row.type !== "pair" || !row.stage) return null;
  const right = row.right && row.right.kind === "add" ? row.right : null;
  const left = row.left && row.left.kind === "del" ? row.left : null;
  const owner = right ? "new" : left ? "old" : null;
  if (owner !== side) return null;
  return (right ?? left)?.pos ?? null;
}

function laneWidths(rows: readonly DiffViewRow[]) {
  let both = 40;
  let old = 40;
  let next = 40;
  for (const row of rows) {
    if (row.type === "line") {
      both = Math.max(both, row.line.text.length);
      old = Math.max(old, row.line.text.length);
    } else if (row.type === "pair") {
      if (row.left) old = Math.max(old, row.left.text.length);
      if (row.right) next = Math.max(next, row.right.text.length);
    }
  }
  return { both, old, new: next };
}

function DiffLane({
  row,
  line,
  side,
  part,
  first,
  hovered,
  commenting,
  tokens,
  changes,
  onReveal,
  onStage,
  onComment,
}: {
  row: DiffViewRow;
  line: UnifiedLine | null;
  side: Side;
  part: LanePart;
  /** The leftmost lane, which draws a fold's bar across the whole width. */
  first: boolean;
  hovered: boolean;
  commenting: boolean;
  tokens?: SyntaxToken[];
  changes: TextRange[] | null;
  onReveal?: (direction: "up" | "down" | "all") => void;
  onStage?: () => void;
  onComment?: (anchor: DOMRect) => void;
}) {
  if (row.type === "fold") {
    if (part === "gutter" && first) {
      return (
        <div className="relative z-20" style={{ height: UNIFIED_FOLD_PX }}>
          <div
            className="absolute inset-y-0 left-0"
            style={{ width: "var(--unified-body-width, 100%)" }}
          >
            <FoldBar hidden={row.hidden} onReveal={onReveal!} />
          </div>
        </div>
      );
    }
    return <div style={{ height: UNIFIED_FOLD_PX }} />;
  }
  if (!line) {
    // The other side has more lines here.
    return (
      <div className="bg-content/[0.03]" style={{ height: UNIFIED_LINE_PX }} />
    );
  }
  return (
    <DiffLineRow
      line={line}
      side={side}
      part={part}
      showHunkText={side !== "new"}
      hovered={hovered}
      commenting={commenting}
      tokens={tokens}
      changes={changes}
      onStage={onStage}
      onComment={onComment}
    />
  );
}

function FoldBar({
  hidden,
  onReveal,
}: {
  hidden: number;
  onReveal: (direction: "up" | "down" | "all") => void;
}) {
  return (
    <div
      className="flex items-center gap-1 bg-content/8 px-2"
      style={{ height: UNIFIED_FOLD_PX }}
    >
      <button
        type="button"
        title="Expand upward"
        aria-label="Expand unmodified lines upward"
        onClick={() => onReveal("up")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronUp className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        title="Expand downward"
        aria-label="Expand unmodified lines downward"
        onClick={() => onReveal("down")}
        className="grid size-5 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
      >
        <ChevronDown className="size-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => onReveal("all")}
        className="min-w-0 flex-1 py-1 text-left font-mono text-ui-caption text-content/45 hover:text-content/70"
      >
        {hidden} unmodified {hidden === 1 ? "line" : "lines"}
      </button>
    </div>
  );
}

const DiffLineRow = memo(function DiffLineRow({
  line,
  side,
  part,
  showHunkText,
  hovered,
  commenting,
  tokens,
  changes,
  onStage,
  onComment,
}: {
  line: UnifiedLine;
  side: Side;
  part: LanePart;
  showHunkText: boolean;
  hovered: boolean;
  commenting: boolean;
  tokens?: SyntaxToken[];
  changes: TextRange[] | null;
  onStage?: () => void;
  onComment?: (anchor: DOMRect) => void;
}) {
  if (line.kind === "hunk") {
    return (
      <div
        className="flex items-center bg-content/5"
        style={{ height: UNIFIED_HUNK_PX }}
      >
        {part === "code" && showHunkText ? (
          <span className="px-3 font-mono text-ui-caption leading-none text-content/40">
            {line.text}
          </span>
        ) : null}
      </div>
    );
  }
  const added = line.kind === "add";
  const deleted = line.kind === "del";
  const number =
    side === "old"
      ? line.oldNumber
      : side === "new"
        ? line.newNumber
        : deleted
          ? line.oldNumber
          : line.newNumber;
  const row = added ? "bg-emerald-500/15" : deleted ? "bg-rose-500/15" : "";
  const gutterTint = added
    ? "bg-emerald-500/25"
    : deleted
      ? "bg-rose-500/25"
      : "";
  const gutterText = added
    ? "text-emerald-300"
    : deleted
      ? "text-rose-300"
      : "text-content/35";

  if (part === "gutter") {
    return (
      <div
        className={`relative flex items-center ${row}`}
        style={{ height: UNIFIED_LINE_PX }}
      >
        {gutterTint ? (
          <span
            className={`pointer-events-none absolute inset-0 ${gutterTint}`}
          />
        ) : null}
        <span
          className={`relative block w-full pr-2 text-right font-mono text-ui-caption leading-none tabular-nums ${gutterText}`}
        >
          {number ?? ""}
        </span>
        {onComment ? (
          <button
            type="button"
            title={`Comment on line ${number ?? ""}`.trim()}
            aria-label={`Comment on line ${number ?? ""}`.trim()}
            onClick={(event) =>
              onComment(event.currentTarget.getBoundingClientRect())
            }
            className={`absolute top-0.5 left-0.5 z-10 grid size-4 place-items-center rounded-[3px] bg-content text-background-base outline-none transition-opacity hover:bg-(--aven-inverse-hover) focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-(--aven-focus-ring) ${
              hovered || commenting
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            }`}
          >
            <MessageSquarePlus className="size-2.5" strokeWidth={2} />
          </button>
        ) : null}
        {onStage ? (
          <button
            type="button"
            title="Stage hunk"
            aria-label="Stage hunk"
            onClick={onStage}
            className={`absolute top-0.5 left-full z-10 ml-0.5 grid size-4 place-items-center rounded-[3px] bg-white text-ui-caption font-bold text-black ${
              hovered ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          >
            +
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center ${row}`}
      style={{ height: UNIFIED_LINE_PX }}
    >
      <span
        className={`whitespace-pre px-3 font-mono text-ui-label leading-none text-content/80 ${
          line.kind === "context" ? "opacity-70" : ""
        }`}
      >
        {renderLineText(line, tokens, changes)}
      </span>
    </div>
  );
});

function renderLineText(
  line: UnifiedLine,
  tokens: SyntaxToken[] | undefined,
  changes: TextRange[] | null,
) {
  const pieces = tokens && tokens.length > 0 ? tokens : [{ text: line.text }];
  if (!changes?.length) {
    if (pieces.length === 1 && !pieces[0]?.color) return line.text;
    return (
      <>
        {pieces.map((piece, index) => (
          <span
            key={index}
            style={piece.color ? { color: piece.color } : undefined}
          >
            {piece.text}
          </span>
        ))}
      </>
    );
  }
  const mark = line.kind === "add" ? "bg-emerald-500/30" : "bg-rose-500/30";
  return (
    <>
      {markPieces(pieces, changes).map((piece, index) => (
        <span
          key={index}
          data-word-change={piece.changed ? "" : undefined}
          className={piece.changed ? mark : undefined}
          style={piece.color ? { color: piece.color } : undefined}
        >
          {piece.text}
        </span>
      ))}
    </>
  );
}

function EmptyBody({ children }: { children: string }) {
  return <p className="px-3 py-3 text-ui-label text-content/45">{children}</p>;
}

function DiffCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-ui-caption font-semibold tabular-nums">
      {additions > 0 ? (
        <span className="text-emerald-400">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-400">-{deletions}</span>
      ) : null}
    </span>
  );
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function verticalScrollParent(
  el: HTMLElement,
  requireScrollable = false,
): HTMLElement | null {
  let current = el.parentElement;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      (!requireScrollable || current.scrollHeight > current.clientHeight + 1)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function isNearViewport(
  section: HTMLElement,
  root: HTMLElement | null,
  margin: number,
) {
  const bounds = section.getBoundingClientRect();
  const view = root
    ? root.getBoundingClientRect()
    : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  return bounds.bottom + margin > view.top && bounds.top - margin < view.bottom;
}

function initiallyOpenFiles(
  files: readonly UnifiedDiffFileModel[],
  mode: InitialExpansion,
): Set<string> {
  if (mode === "none" || files.length === 0) return new Set();
  if (mode === "first") return new Set([files[0].id]);
  return new Set(files.map((file) => file.id));
}
