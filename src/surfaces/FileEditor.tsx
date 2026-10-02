import "./UtilityViews.css";
import { retainEditorDraft } from "../lib/workspaceTransfers";
import { readEditorDraft, recordEditorDraft } from "../lib/workspaceTransfers";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import { indentLess, indentMore } from "@codemirror/commands";
import {
  foldGutter,
  foldKeymap,
  getIndentUnit,
  indentUnit,
} from "@codemirror/language";
import {
  Annotation,
  Compartment,
  countColumn,
  EditorSelection,
  Prec,
  StateField,
  Transaction,
  type EditorState,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "../chrome/icons";
import { minimalSetup } from "codemirror";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MarkdownViewShell,
  useMarkdownMode,
} from "../chrome/MarkdownModeToggle";
import { useColorScheme } from "../hooks/useColorScheme";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { isLightScheme } from "../lib/appearance";
import { formatText } from "../lib/format";
import { loadAutosave } from "../lib/settings";
import {
  basename,
  gitDiffFiles,
  gitFileDiff,
  gitStageContents,
  homeDir,
  inspectPaths,
  notifyGitChanged,
  readTextFile,
  subscribeGitChanged,
  writeTextFile,
  type GitFileDiffKind,
} from "../lib/fs";
import { syncWatchedMtime, watchFile } from "../lib/fileWatch";
import { displayPath, joinPath, parentPath } from "../lib/paths";
import { IS_WIN } from "../lib/platform";
import type { EditorNavigation } from "../lib/search";
import { MarkdownPreview } from "./AgentMarkdown";
import {
  DiffCommentComposer,
  type DiffCommentComposerTarget,
} from "./DiffCommentComposer";
import { editorAutocomplete } from "./editorAutocomplete";
import { languageForPath, schemeExtensions } from "./editorChrome";
import {
  detectLineEnding,
  type LineEnding,
  normalizeLineBreaks,
  preserveEditorViewport,
  replaceEditorDoc,
  restoreLineEnding,
} from "./editorDoc";
import { editorMatching, editorTyping, tryExpandEmmet } from "./editorEditing";
import {
  diffActiveChunkIndex,
  diffLineStatsForView,
  diffNavigablePositions,
  diffNavUpdateRelevant,
  diffScrollToChunk,
  editorGit,
  setGitOriginal,
} from "./editorGit";
import { editorLint } from "./editorLint";
import { editorSearch } from "./editorSearch";
import { DirectoryView } from "./DirectoryView";

type EditorNavigationRequest = EditorNavigation & { token: number };

export const FILE_EDITOR_AUTOSAVE_DELAY_MS = 1_000;

const editorScheme = new Compartment();
const editorGitConfig = new Compartment();

type Props = {
  path: string;
  cwd: string;
  active: boolean;
  showDiff?: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (path: string, dirty: boolean) => void;
  onErrorCountChange?: (path: string, count: number) => void;
  onOpenFile?: (path: string) => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "directory"; path: string }
  | { status: "error"; message: string };

type SaveState =
  | { status: "idle" | "saving" | "saved" }
  | { status: "error"; message: string };

export function FileEditor({
  path,
  cwd,
  active,
  showDiff = false,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onOpenFile,
}: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState("");
  const [gitBase, setGitBase] = useState<{
    path: string;
    original: string;
    kind: GitFileDiffKind;
    lineEnding: LineEnding;
    eolOnly: boolean;
  } | null>(null);
  const markdown = isMarkdownPath(path);
  const svg = isSvgPath(path);
  const [mode, setMode] = useMarkdownMode(path);
  const revealedNavigation = useRef<{ path: string; token: number } | null>(
    null,
  );
  useEffect(() => {
    if ((!markdown && !svg) || !navigation) return;
    if (
      revealedNavigation.current?.path === path &&
      revealedNavigation.current.token === navigation.token
    )
      return;
    revealedNavigation.current = { path, token: navigation.token };
    // Explicit source locations should be visible, while a user's later switch
    // back to Preview remains in effect until a new navigation request arrives.
    setMode("source");
  }, [markdown, svg, path, navigation?.token, setMode]);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveGeneration = useRef(0);
  const loadGeneration = useRef(0);
  const dirtyRef = useRef(false);
  const pendingDiskRef = useRef(false);
  const eolRef = useRef<LineEnding>("\n");
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const applyDiskContent = useCallback((raw: string) => {
    // CodeMirror documents are LF-only; keep the editor in that convention
    // and restore the file's own line endings on save. Feeding CRLF text
    // into the LF document doubles every line (see editorDoc.ts).
    eolRef.current = detectLineEnding(raw);
    const content = normalizeLineBreaks(raw);
    setLoadState((current) => {
      if (current.status === "ready" && current.content === content) {
        return current;
      }
      return { status: "ready", content };
    });
    setDraft(content);
  }, []);

  const reloadFromDisk = useCallback(
    async (force = false) => {
      const generation = ++loadGeneration.current;
      try {
        const content = await readTextFile(path);
        if (generation !== loadGeneration.current) return;
        if (dirtyRef.current && !force) {
          pendingDiskRef.current = true;
          return;
        }
        pendingDiskRef.current = false;
        if (force && dirtyRef.current) {
          dirtyRef.current = false;
          onDirtyChangeRef.current(path, false);
        }
        applyDiskContent(content);
      } catch (error: unknown) {
        if (generation !== loadGeneration.current) return;
        if (dirtyRef.current && !force) {
          pendingDiskRef.current = true;
          return;
        }
        setLoadState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [applyDiskContent, path],
  );

  useEffect(() => {
    dirtyRef.current = false;
    pendingDiskRef.current = false;
    let cancelled = false;
    setLoadState({ status: "loading" });
    setSaveState({ status: "idle" });
    const generation = ++loadGeneration.current;
    void readTextFile(path)
      .then((raw) => {
        if (cancelled || generation !== loadGeneration.current) return;
        eolRef.current = detectLineEnding(raw);
        const content = normalizeLineBreaks(raw);
        setLoadState({ status: "ready", content });
        setDraft(readEditorDraft(path)?.text ?? content);
      })
      .catch(async (error: unknown) => {
        if (cancelled || generation !== loadGeneration.current) return;
        const readError =
          error instanceof Error ? error.message : String(error);
        try {
          const [info] = await inspectPaths([path]);
          if (cancelled || generation !== loadGeneration.current) return;
          if (info?.isDir) {
            setLoadState({ status: "directory", path: info.path });
            return;
          }
          // Older versions saved home links beneath the current project.
          // Prefer any real literal `~/` entry; recover only a missing path
          // with that exact project prefix, and only to an existing folder.
          const legacyPrefix = `${cwd}/~/`;
          const missingPath =
            readError.endsWith("(os error 2)") ||
            (IS_WIN && readError.endsWith("(os error 3)"));
          if (!info && missingPath && cwd && path.startsWith(legacyPrefix)) {
            const home = await homeDir();
            if (cancelled || generation !== loadGeneration.current) return;
            const recovered = joinPath(home, path.slice(legacyPrefix.length));
            const [folder] = await inspectPaths([recovered]);
            if (cancelled || generation !== loadGeneration.current) return;
            if (folder?.isDir) {
              setLoadState({ status: "directory", path: folder.path });
              return;
            }
          }
        } catch {
          // Metadata is optional recovery. Retain the original read error.
        }
        if (cancelled || generation !== loadGeneration.current) return;
        setLoadState({
          status: "error",
          message: readError,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, cwd, reloadKey]);

  useEffect(() => {
    if (!showDiff || loadState.status !== "ready") {
      setGitBase(null);
      return;
    }
    const relative = displayPath(path, cwd);
    if (!cwd || cwd === "~" || !relative || relative === path) {
      setGitBase(null);
      return;
    }
    let cancelled = false;
    let generation = 0;
    setGitBase(null);

    const load = () => {
      const request = ++generation;
      void (async () => {
        const { files } = await gitDiffFiles(cwd);
        const file = files.find((entry) => entry.relative === relative);
        // A review tab opened from a staged-only file has no index-to-disk
        // delta, so show HEAD-to-index instead. Use Git's file status rather
        // than comparing contents: under core.autocrlf the raw sides differ
        // even when the normalized text is identical.
        const kind: GitFileDiffKind =
          file?.staged && !file.unstaged ? "staged" : "unstaged";
        const diff = await gitFileDiff(cwd, relative, kind);
        if (cancelled || request !== generation) return;
        if (diff.binary || diff.tooLarge) {
          setGitBase(null);
          return;
        }
        const original = normalizeLineBreaks(diff.original);
        setGitBase({
          path,
          original,
          kind,
          lineEnding: detectLineEnding(diff.original || diff.current),
          eolOnly:
            !!(file?.staged || file?.unstaged) &&
            diff.original !== diff.current &&
            original === normalizeLineBreaks(diff.current),
        });
      })().catch(() => {
        if (!cancelled && request === generation) setGitBase(null);
      });
    };

    load();
    const onFocus = () => {
      if (!document.hidden) load();
    };
    const onGit = () => {
      if (!document.hidden) load();
    };
    let timer = 0;
    const onDisk = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        load();
        void reloadFromDisk();
      }, 50);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const unsubGit = subscribeGitChanged(onGit);
    const unsubWatch = watchFile(path, onDisk);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      unsubGit();
      unsubWatch();
    };
  }, [cwd, path, reloadFromDisk, showDiff, loadState.status]);

  const gitDiff = gitBase?.path === path ? gitBase : null;
  const gitOriginal = gitDiff?.original ?? null;

  useEffect(() => {
    if (loadState.status !== "ready") return;
    let timer = 0;
    const stop = watchFile(path, () => {
      if (dirtyRef.current) {
        pendingDiskRef.current = true;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reloadFromDisk();
      }, 50);
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [loadState.status, path, reloadFromDisk]);

  const save = useCallback(
    async (content: string) => {
      const generation = ++saveGeneration.current;
      setSaveState({ status: "saving" });
      // Capture the file's convention now, before the save is queued.
      const serializedContent = restoreLineEnding(content, eolRef.current);
      const operation = saveQueue.current.then(() =>
        writeTextFile(path, serializedContent),
      );
      saveQueue.current = operation.catch(() => {});
      try {
        await operation;
        await syncWatchedMtime(path);
        notifyGitChanged();
        if (generation === saveGeneration.current) {
          setSaveState({ status: "saved" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (generation === saveGeneration.current) {
          setSaveState({ status: "error", message });
        }
        throw error;
      }
    },
    [path],
  );

  const stageGit = useCallback(
    async (contents: string) => {
      const relative = displayPath(path, cwd);
      if (!cwd || cwd === "~" || !relative || relative === path) {
        throw new Error("Can't stage this file");
      }
      if (!gitDiff || gitDiff.kind !== "unstaged") {
        throw new Error("Only unstaged changes can be staged");
      }
      try {
        // Keep the index convention outside the selected text hunk.
        await gitStageContents(
          cwd,
          relative,
          restoreLineEnding(contents, gitDiff.lineEnding),
        );
        notifyGitChanged();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSaveState({ status: "error", message });
        throw error;
      }
    },
    [cwd, path, gitDiff],
  );

  const canStageGit = showDiff && gitDiff?.kind === "unstaged";
  // Never autosave over a disk change that arrived while the editor was dirty.
  const canAutosave = useCallback(() => !pendingDiskRef.current, []);

  const dirtyChange = useCallback(
    (dirty: boolean) => {
      dirtyRef.current = dirty;
      onDirtyChange(path, dirty);
      if (dirty) {
        setSaveState((current) =>
          current.status === "saving" ? current : { status: "idle" },
        );
        return;
      }
      if (pendingDiskRef.current) {
        pendingDiskRef.current = false;
        void reloadFromDisk();
      }
    },
    [onDirtyChange, path, reloadFromDisk],
  );

  const errorCountChange = useCallback(
    (count: number) => onErrorCountChange?.(path, count),
    [onErrorCountChange, path],
  );

  const relativePath = path.startsWith(`${cwd}/`)
    ? path.slice(cwd.length + 1)
    : path;

  if (loadState.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-[12px] text-content/45">
        Opening {basename(path)}…
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md text-center">
          <AlertCircle className="mx-auto mb-3 size-5 text-red-400" />
          <p className="text-[13px] text-content">
            Couldn’t open {basename(path)}
          </p>
          <p className="mt-1 text-[12px] leading-5 text-content/50">
            {loadState.message}
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="mx-auto mt-4 flex h-7 items-center gap-1.5 rounded-md bg-content/10 px-2.5 text-[12px] text-content hover:bg-content/15"
          >
            <RotateCcw className="size-3" strokeWidth={1.75} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loadState.status === "directory") {
    return (
      <DirectoryView
        key={loadState.path}
        path={loadState.path}
        onOpenFile={onOpenFile}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {showDiff && gitDiff?.eolOnly ? (
        <p
          role="status"
          className="shrink-0 border-b border-content/10 px-3 py-1 text-[12px] text-content/60"
        >
          {gitDiff.kind === "staged" ? "Staged" : "Unstaged"} line-ending
          changes. Line breaks are normalized in this view.
        </p>
      ) : null}
      {markdown || svg ? (
        <MarkdownViewShell
          mode={mode}
          onModeChange={setMode}
          preview={
            markdown ? (
              <MarkdownPreview
                text={draft}
                cwd={parentPath(path)}
                onOpenFile={onOpenFile}
                hardBreaks
              />
            ) : (
              <SvgPreview source={draft} />
            )
          }
          source={
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <CodeMirrorEditor
                key={`${path}:${reloadKey}`}
                path={path}
                commentPath={relativePath}
                value={loadState.content}
                showDiff={showDiff}
                gitOriginal={gitOriginal}
                active={active && mode === "source"}
                navigation={navigation}
                onDirtyChange={dirtyChange}
                onErrorCountChange={errorCountChange}
                onSave={save}
                canAutosave={canAutosave}
                onStageGit={canStageGit ? stageGit : undefined}
                onDocChange={setDraft}
              />
            </div>
          }
        />
      ) : (
        <CodeMirrorEditor
          key={`${path}:${reloadKey}`}
          path={path}
          commentPath={relativePath}
          value={loadState.content}
          showDiff={showDiff}
          gitOriginal={gitOriginal}
          active={active}
          navigation={navigation}
          onDirtyChange={dirtyChange}
          onErrorCountChange={errorCountChange}
          onSave={save}
          canAutosave={canAutosave}
          onStageGit={canStageGit ? stageGit : undefined}
        />
      )}
      <footer className="file-editor-status flex h-6 shrink-0 items-center border-t border-content/10 px-2.5 font-mono text-[10.5px] text-content/40">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {relativePath}
        </span>
        {saveState.status === "saving" ? (
          <span>Saving…</span>
        ) : saveState.status === "saved" ? (
          <span>Saved</span>
        ) : saveState.status === "error" ? (
          <span
            className="max-w-64 truncate text-red-400"
            title={saveState.message}
          >
            Save failed: {saveState.message}
          </span>
        ) : null}
      </footer>
    </div>
  );
}

function CodeMirrorEditor({
  path,
  commentPath,
  value,
  showDiff,
  gitOriginal,
  active,
  navigation,
  onDirtyChange,
  onErrorCountChange,
  onSave,
  canAutosave,
  onStageGit,
  onDocChange,
}: {
  path: string;
  commentPath: string;
  value: string;
  showDiff: boolean;
  gitOriginal: string | null;
  active: boolean;
  navigation?: EditorNavigationRequest | null;
  onDirtyChange: (dirty: boolean) => void;
  onErrorCountChange: (count: number) => void;
  onSave: (content: string) => Promise<void>;
  canAutosave: () => boolean;
  onStageGit?: (contents: string) => Promise<void>;
  onDocChange?: (content: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const savedDocumentRef = useRef<Text | null>(null);
  const dirtyRef = useRef(false);
  const activeRef = useRef(active);
  const onDirtyChangeRef = useRef(onDirtyChange);
  const onErrorCountChangeRef = useRef(onErrorCountChange);
  const onSaveRef = useRef(onSave);
  const canAutosaveRef = useRef(canAutosave);
  const onStageGitRef = useRef(onStageGit);
  const canStage = onStageGit !== undefined;
  const onDocChangeRef = useRef(onDocChange);
  const valueRef = useRef(value);
  const gitOriginalRef = useRef(gitOriginal);
  const chunkNavPinnedRef = useRef<number | null>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const colorScheme = useColorScheme();
  const [chunkNav, setChunkNav] = useState<{
    positions: number[];
    index: number;
    additions: number;
    deletions: number;
  } | null>(null);
  const [commentTarget, setCommentTarget] =
    useState<DiffCommentComposerTarget | null>(null);
  const gitOptions = {
    onStage: canStage
      ? (contents: string) => onStageGitRef.current?.(contents)
      : undefined,
    onComment: setCommentTarget,
  };
  activeRef.current = active;
  onDirtyChangeRef.current = onDirtyChange;
  onErrorCountChangeRef.current = onErrorCountChange;
  onSaveRef.current = onSave;
  canAutosaveRef.current = canAutosave;
  onStageGitRef.current = onStageGit;
  onDocChangeRef.current = onDocChange;
  valueRef.current = value;
  gitOriginalRef.current = gitOriginal;

  const syncChunkNav = useCallback((view: EditorView, fromScroll = true) => {
    const positions = diffNavigablePositions(view);
    const { additions, deletions } = diffLineStatsForView(view);
    if (positions.length === 0) {
      setChunkNav((current) =>
        current && current.positions.length === 0
          ? current
          : {
              positions: [],
              index: 0,
              additions: 0,
              deletions: 0,
            },
      );
      chunkNavPinnedRef.current = null;
      return;
    }
    let index = chunkNavPinnedRef.current;
    if (
      fromScroll ||
      index === null ||
      index < 0 ||
      index >= positions.length
    ) {
      index = diffActiveChunkIndex(view, positions);
    }
    chunkNavPinnedRef.current = index;
    setChunkNav((current) => {
      if (
        current &&
        current.index === index &&
        current.additions === additions &&
        current.deletions === deletions &&
        current.positions.length === positions.length &&
        current.positions.every((pos, i) => pos === positions[i])
      ) {
        return current;
      }
      return { positions, index, additions, deletions };
    });
  }, []);

  const stepChunkNav = useCallback(
    (delta: number) => {
      const view = viewRef.current;
      if (!view || !chunkNav || chunkNav.positions.length === 0) return;
      const next = Math.min(
        chunkNav.positions.length - 1,
        Math.max(0, chunkNav.index + delta),
      );
      if (next === chunkNav.index) return;
      chunkNavPinnedRef.current = next;
      diffScrollToChunk(view, chunkNav.positions[next]);
      setChunkNav({
        positions: chunkNav.positions,
        index: next,
        additions: chunkNav.additions,
        deletions: chunkNav.deletions,
      });
    },
    [chunkNav],
  );

  const setDirty = (nextDirty: boolean) => {
    if (dirtyRef.current === nextDirty) return;
    dirtyRef.current = nextDirty;
    onDirtyChangeRef.current(nextDirty);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const releaseDraft = retainEditorDraft(path);
    const language = new Compartment();
    let disposed = false;
    let saveGeneration = 0;
    let autosaveTimer = 0;
    let view: EditorView;

    const markDirty = () => {
      const saved = savedDocumentRef.current;
      setDirty(saved ? !view.state.doc.eq(saved) : false);
      recordEditorDraft(
        path,
        view.state.doc.toString(),
        saved?.toString() ?? valueRef.current,
      );
    };

    const save = (automatic = false) => {
      const retryPendingAutosave = autosaveTimer !== 0 && loadAutosave();
      window.clearTimeout(autosaveTimer);
      autosaveTimer = 0;
      const generation = ++saveGeneration;
      void (async () => {
        const before = view.state.doc.toString();
        const result = await formatText(
          path,
          before,
          view.state.selection.main.head,
        );
        if (disposed || generation !== saveGeneration) return;

        if (
          result &&
          result.formatted !== before &&
          view.state.doc.toString() === before
        ) {
          replaceEditorDoc(view, result.formatted, {
            selection: {
              anchor: Math.min(
                Math.max(0, result.cursorOffset),
                result.formatted.length,
              ),
            },
          });
        }

        const document = view.state.doc;
        // A disk change may have arrived while formatting.
        if (automatic && !canAutosaveRef.current()) return;
        try {
          await onSaveRef.current(document.toString());
        } catch {
          if (
            retryPendingAutosave &&
            !disposed &&
            generation === saveGeneration &&
            dirtyRef.current
          ) {
            scheduleAutosave();
          }
          return;
        }
        if (disposed || generation !== saveGeneration) return;
        savedDocumentRef.current = document;
        markDirty();
      })();
      return true;
    };

    function scheduleAutosave() {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = 0;
      if (!loadAutosave()) return;
      autosaveTimer = window.setTimeout(() => {
        autosaveTimer = 0;
        if (dirtyRef.current && loadAutosave() && canAutosaveRef.current()) {
          save(true);
        }
      }, FILE_EDITOR_AUTOSAVE_DELAY_MS);
    }

    const transferred = readEditorDraft(path);
    const initialDraft =
      transferred && transferred.text !== transferred.baseline
        ? transferred
        : undefined;
    view = new EditorView({
      doc: initialDraft?.text ?? valueRef.current,
      parent: host,
      extensions: [
        minimalSetup,
        showDiff ? editorGitConfig.of(editorGit(gitOptions)) : [],
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        EditorView.lineWrapping,
        wrappedLineIndent,
        language.of([]),
        editorScheme.of(schemeExtensions(isLightScheme() ? "light" : "dark")),
        editorMatching,
        editorTyping(path),
        editorAutocomplete,
        editorLint(path, (count) => onErrorCountChangeRef.current(count)),
        editorSearch,
        Prec.high(
          keymap.of([
            ...foldKeymap,
            { key: "Mod-s", run: () => save(), preventDefault: true },
            {
              key: "Tab",
              run: (view) => {
                if (
                  completionStatus(view.state) === "active" &&
                  acceptCompletion(view)
                ) {
                  return true;
                }
                return tryExpandEmmet(view) || indentOrInsertTab(view);
              },
              shift: indentLess,
              preventDefault: true,
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          onDocChangeRef.current?.(update.state.doc.toString());
          if (update.transactions.some((tr) => tr.annotation(diskReload))) {
            return;
          }
          markDirty();
          scheduleAutosave();
        }),
        showDiff
          ? EditorView.updateListener.of((update) => {
              if (!diffNavUpdateRelevant(update)) return;
              chunkNavPinnedRef.current = null;
              syncChunkNav(update.view);
            })
          : [],
      ],
    });
    savedDocumentRef.current = initialDraft
      ? Text.of(initialDraft.baseline.split("\n"))
      : view.state.doc;
    dirtyRef.current = false;
    markDirty();
    viewRef.current = view;
    lockOverscroll(view.scrollDOM as HTMLDivElement);
    if (showDiff) {
      if (gitOriginalRef.current) {
        setGitOriginal(view, gitOriginalRef.current);
      }
      syncChunkNav(view);
    } else {
      setChunkNav({
        positions: [],
        index: 0,
        additions: 0,
        deletions: 0,
      });
    }
    if (activeRef.current) view.focus();

    void languageForPath(path).then((extension) => {
      if (!disposed && extension) {
        view.dispatch({ effects: language.reconfigure(extension) });
      }
    });

    return () => {
      disposed = true;
      window.clearTimeout(autosaveTimer);
      onErrorCountChangeRef.current(0);
      lockOverscroll(null);
      viewRef.current = null;
      savedDocumentRef.current = null;
      setChunkNav(null);
      view.destroy();
      releaseDraft();
    };
  }, [lockOverscroll, path, showDiff, syncChunkNav]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editorScheme.reconfigure(schemeExtensions(colorScheme)),
    });
  }, [colorScheme]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    view.dispatch({
      effects: editorGitConfig.reconfigure(editorGit(gitOptions)),
    });
    // gitOptions only changes meaningfully with canStage; handlers read refs.
  }, [canStage, showDiff]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    let changed = false;
    preserveEditorViewport(view, () => {
      changed = setGitOriginal(view, gitOriginal);
    });
    if (!changed) return;
    chunkNavPinnedRef.current = null;
    syncChunkNav(view);
  }, [gitOriginal, showDiff, syncChunkNav]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !showDiff) return;
    const onScroll = () => {
      chunkNavPinnedRef.current = null;
      syncChunkNav(view);
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => view.scrollDOM.removeEventListener("scroll", onScroll);
  }, [showDiff, syncChunkNav, path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || dirtyRef.current) return;
    if (view.state.doc.toString() === value) return;
    replaceEditorDoc(view, value, {
      annotations: [Transaction.addToHistory.of(false), diskReload.of(true)],
    });
    savedDocumentRef.current = view.state.doc;
    setDirty(false);
    recordEditorDraft(path, value, value);
    if (showDiff) {
      chunkNavPinnedRef.current = null;
      syncChunkNav(view);
    }
  }, [showDiff, syncChunkNav, value]);

  useEffect(() => {
    if (!navigation) return;
    const view = viewRef.current;
    if (!view) return;
    return scheduleEditorNavigation(view, navigation);
  }, [navigation]);

  useEffect(() => {
    if (!active) return;
    const view = viewRef.current;
    if (!view) return;
    view.requestMeasure();
    const activeEl = document.activeElement;
    if (
      activeEl &&
      view.dom.contains(activeEl) &&
      activeEl !== view.contentDOM
    ) {
      return;
    }
    view.focus();
  }, [active, path]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {showDiff ? (
          <DiffChunkNav
            index={chunkNav?.index ?? 0}
            total={chunkNav?.positions.length ?? 0}
            additions={chunkNav?.additions ?? 0}
            deletions={chunkNav?.deletions ?? 0}
            onPrev={() => stepChunkNav(-1)}
            onNext={() => stepChunkNav(1)}
          />
        ) : null}
        <div ref={hostRef} className="min-h-0 flex-1" />
      </div>
      {commentTarget ? (
        <DiffCommentComposer
          path={commentPath}
          target={commentTarget}
          onDismiss={() => setCommentTarget(null)}
        />
      ) : null}
    </>
  );
}

function DiffChunkNav({
  index,
  total,
  additions,
  deletions,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  additions: number;
  deletions: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-content/10 px-3 pr-1"
      role="toolbar"
      aria-label="Jump between changes"
    >
      <DiffChunkStat additions={additions} deletions={deletions} />
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Previous change"
          aria-label="Previous change"
          disabled={total === 0 || index <= 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPrev}
          className="grid size-6 place-items-center rounded text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35"
        >
          <ChevronUp className="size-3.5" strokeWidth={1.75} />
        </button>
        <span className="min-w-10 px-0.5 text-center font-mono text-[10.5px] font-medium tabular-nums text-content/55 select-none">
          {total === 0 ? "0/0" : `${index + 1}/${total}`}
        </span>
        <button
          type="button"
          title="Next change"
          aria-label="Next change"
          disabled={total === 0 || index >= total - 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNext}
          className="grid size-6 place-items-center rounded text-content/70 hover:bg-content/10 hover:text-content disabled:opacity-35"
        >
          <ChevronDown className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}

function DiffChunkStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions <= 0 && deletions <= 0) {
    return <span className="min-w-0 flex-1" />;
  }
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold tabular-nums">
      {additions > 0 ? (
        <span className="text-emerald-400">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-red-400">-{deletions}</span>
      ) : null}
    </span>
  );
}

function revealNavigation(view: EditorView, target: EditorNavigation) {
  const lineNumber = Math.min(Math.max(1, target.line), view.state.doc.lines);
  const line = view.state.doc.line(lineNumber);
  const column = Math.max(1, target.column ?? 1);
  const anchor = Math.min(line.from + column - 1, line.to);
  view.dispatch({
    selection: { anchor },
    effects: EditorView.scrollIntoView(anchor, { y: "center" }),
  });
  view.focus();
}

/** The loaded editor is ready here; revealNavigation clamps stale search lines. */
export function scheduleEditorNavigation(
  view: EditorView,
  target: EditorNavigation,
): () => void {
  let cancelled = false;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (!cancelled) revealNavigation(view, target);
    });
  });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
}

const diskReload = Annotation.define<boolean>();

function indentOrInsertTab(view: EditorView): boolean {
  const { state, dispatch } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore(view);
  }

  const unit = state.facet(indentUnit);
  if (unit === "\t") {
    dispatch(
      state.update(state.replaceSelection("\t"), {
        scrollIntoView: true,
        userEvent: "input",
      }),
    );
    return true;
  }

  const width = getIndentUnit(state);
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.head);
        const column = countColumn(
          line.text.slice(0, range.head - line.from),
          state.tabSize,
        );
        const insert = " ".repeat(width - (column % width) || width);
        return {
          changes: { from: range.head, insert },
          range: EditorSelection.cursor(range.head + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
}

type LineRange = { from: number; to: number };

const wrappedLineIndent = StateField.define<DecorationSet>({
  create(state) {
    return Decoration.set(
      indentDecorations(state, [{ from: 0, to: state.doc.length }]),
      true,
    );
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) return decorations;
    const ranges: LineRange[] = [];
    transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const from = transaction.state.doc.lineAt(fromB).from;
      const to = transaction.state.doc.lineAt(toB).to;
      ranges.push({ from, to });
    });
    const changedLines = mergeLineRanges(ranges);
    return decorations.map(transaction.changes).update({
      filter: (from) =>
        !changedLines.some((range) => from >= range.from && from <= range.to),
      add: indentDecorations(transaction.state, changedLines),
      sort: true,
    });
  },
  provide: (field) => EditorView.decorations.from(field),
});

function indentDecorations(state: EditorState, ranges: LineRange[]) {
  const decorations = [];
  for (const range of ranges) {
    let line = state.doc.lineAt(range.from);
    while (line.from <= range.to) {
      const columns = leadingIndentColumns(line.text, state.tabSize);
      if (columns > 0) {
        const indent = Math.min(columns, 40);
        decorations.push(
          Decoration.line({
            attributes: {
              class: "cm-wrapped-indent",
              style: `padding-left: calc(${indent}ch + 6px); text-indent: -${indent}ch`,
            },
          }).range(line.from),
        );
      }
      if (line.number >= state.doc.lines) break;
      line = state.doc.line(line.number + 1);
    }
  }
  return decorations;
}

function leadingIndentColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") {
      columns += 1;
    } else if (character === "\t") {
      columns += tabSize - (columns % tabSize);
    } else {
      break;
    }
  }
  return columns;
}

function mergeLineRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * SVG is text, so it stays editable in CodeMirror and renders through an
 * `<img>` rather than inline. In that context the webview runs no script and
 * fetches no external reference the document asks for, which is what makes it
 * safe to preview a file the agent may have just written.
 */
function SvgPreview({ source }: { source: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml" }),
    );
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);

  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <img src={url} alt="" className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function isSvgPath(path: string): boolean {
  return basename(path).toLowerCase().endsWith(".svg");
}

function isMarkdownPath(path: string): boolean {
  const name = basename(path).toLowerCase();
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return [".md", ".mdx", ".markdown"].includes(extension);
}
