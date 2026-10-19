import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useMemoryKeeperProject } from "../hooks/useMemoryKeeperProject";
import { useProjectMemory } from "../hooks/useProjectMemory";
import { copyText } from "../lib/clipboard";
import { errorText } from "../lib/errors";
import { LAYER } from "../lib/layers";
import { markKeeperChangeSeen } from "../lib/memoryKeeper";
import { projectName } from "../lib/paths";
import { MOD } from "../lib/platform";
import {
  PROJECT_MEMORY_MAX_CHARS,
  isProjectMemoryConflict,
  loadProjectMemory,
  projectMemoryEdited,
  projectMemorySize,
  saveProjectMemory,
} from "../lib/projectMemory";
import { Check, Copy } from "./icons";
import { MemoryKeeperChangeNote, MemoryKeeperSwitch } from "./MemoryKeeper";
import { ProjectMark } from "./ProjectMark";

type Props = {
  path: string;
  onClose: () => void;
};

const PLACEHOLDER = `Decisions, conventions, work in progress and gotchas. For example:
- Use pnpm, not npm.
- The payments refactor is half done on feat/payments.
- Run the API tests with \`make test-api\`; they need Docker.`;

/**
 * Edit the memory every agent in a project receives. Plain Markdown, kept in
 * Aven's data rather than the project's files. Saving takes effect for new
 * chats, and for open chats with their next message.
 */
export function ProjectMemoryDialog({ path, onClose }: Props) {
  const appearance = useProjectAppearance(path);
  const {
    memory,
    loading,
    error,
    reload: reloadMemory,
  } = useProjectMemory(path);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // The version this edit started from; a newer stored copy refuses the save.
  const base = useRef(0);
  const keeper = useMemoryKeeperProject(path);
  const keeperChangeAt = keeper.change?.at;

  // Opening the memory, or having it open when Aven updates it, is seeing it.
  useEffect(() => {
    markKeeperChangeSeen(path);
  }, [path, keeperChangeAt]);

  const stored = memory?.body ?? "";
  const text = draft ?? stored;
  const dirty = draft != null && draft.trimEnd() !== stored;
  const over = text.length > PROJECT_MEMORY_MAX_CHARS;
  const name = appearance?.label ?? projectName(path);

  useEffect(() => {
    const element = field.current;
    if (loading || !element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [loading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = async (replace = false) => {
    if (saving || over || (!dirty && !replace)) return;
    setSaving(true);
    setSaveError(null);
    try {
      let from = base.current;
      if (replace) from = (await loadProjectMemory(path))?.updatedAt ?? 0;
      await saveProjectMemory(path, text, from);
      onClose();
    } catch (failure) {
      if (isProjectMemoryConflict(failure)) setConflict(true);
      else setSaveError(errorText(failure));
      setSaving(false);
    }
  };

  const showLatest = () => {
    setDraft(null);
    setConflict(false);
    reloadMemory();
  };

  const copy = () => {
    void copyText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => undefined,
    );
  };

  // Disabled buttons give no feedback of their own; say why in plain words.
  const saveHint = loading
    ? ""
    : saving
      ? "Saving…"
      : over
        ? "Too long to save"
        : dirty
          ? ""
          : text.trim()
            ? "No changes to save"
            : "Nothing to save yet";
  const edited = memory
    ? projectMemoryEdited(memory.updatedAt, Date.now())
    : "";

  return createPortal(
    // React events bubble out of portals to whatever opened this (a sidebar
    // row, a dashboard tile); keep typing and right-clicks in here.
    <div
      className="fixed inset-0"
      style={{ zIndex: LAYER.dialog }}
      onKeyDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/30" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Project memory for ${name}`}
        aria-busy={loading || saving}
        onMouseDown={(event) => event.stopPropagation()}
        className="project-memory-dialog absolute left-1/2 top-[12%] flex max-h-[80vh] w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 aven-glass-overlay p-4"
      >
        <header className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-content/5">
            <ProjectMark
              appearance={appearance}
              className="project-mark-large"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-ui-body font-medium leading-tight text-content">
              Project memory
            </h2>
            <p className="truncate text-ui-caption leading-tight text-content/50">
              {name}
            </p>
          </div>
          <MemoryKeeperChangeNote path={path} editing={dirty} />
        </header>

        <p className="text-ui-label leading-snug text-content/55">
          Every agent in this project gets this, whichever app runs it. It stays
          in Aven and is never written to the project's files.
        </p>

        <textarea
          ref={field}
          value={text}
          placeholder={loading ? "" : PLACEHOLDER}
          disabled={loading || saving}
          spellCheck
          aria-label="Project memory"
          aria-invalid={over || undefined}
          aria-describedby="project-memory-status"
          onChange={(event) => {
            if (draft == null) base.current = memory?.updatedAt ?? 0;
            setDraft(event.target.value);
            setSaveError(null);
          }}
          onKeyDown={(event) => {
            const mod = event.metaKey || event.ctrlKey;
            if (mod && (event.key === "Enter" || event.key === "s")) {
              event.preventDefault();
              void save();
            }
          }}
          className="min-h-56 w-full flex-1 resize-none rounded-md bg-content/8 px-2.5 py-2 text-ui-body leading-relaxed text-content outline-none placeholder:text-content/30 disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
        />

        <p
          id="project-memory-status"
          className="flex flex-wrap items-center gap-x-2 text-ui-caption text-content/45"
        >
          <span className={over ? "text-red-300" : undefined}>
            {projectMemorySize(text.length)}
          </span>
          {edited ? (
            <>
              <span aria-hidden>·</span>
              <span>{edited}</span>
            </>
          ) : null}
        </p>

        <MemoryKeeperSwitch path={path} details />

        <p className="text-ui-caption leading-snug text-content/40">
          Changes reach new chats right away, and chats already open with their
          next message.
        </p>

        {error ? (
          <p role="alert" className="text-ui-label leading-snug text-red-300">
            Could not load this project's memory. {error}
          </p>
        ) : null}
        {saveError ? (
          <p role="alert" className="text-ui-label leading-snug text-red-300">
            {saveError}
          </p>
        ) : null}
        {conflict ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 rounded-md bg-content/6 px-2.5 py-2 text-ui-label text-content/70"
          >
            <span className="min-w-0 flex-1">
              The memory changed while you were editing, for example from
              Remember this in a chat or an update by Aven.
            </span>
            <button
              type="button"
              onClick={showLatest}
              className="rounded-md px-2 py-1 text-content/70 hover:bg-content/8 hover:text-content"
            >
              Show latest
            </button>
            <button
              type="button"
              onClick={() => void save(true)}
              className="rounded-md bg-content/10 px-2 py-1 text-content hover:bg-content/15"
            >
              Keep mine
            </button>
          </div>
        ) : null}

        <footer className="flex items-center gap-2">
          <button
            type="button"
            disabled={!text.trim()}
            onClick={copy}
            title={
              text.trim()
                ? "Copy as Markdown, for example to paste into AGENTS.md"
                : "Nothing to copy yet"
            }
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-ui-label text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            {copied ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <span
            id="project-memory-save-hint"
            className="min-w-0 flex-1 truncate text-right text-ui-caption text-content/40"
          >
            {saveHint}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-ui-label text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty || over || saving || loading}
            onClick={() => void save()}
            title={saveHint || `Save (${MOD}↩)`}
            aria-describedby={saveHint ? "project-memory-save-hint" : undefined}
            className="rounded-md bg-content/12 px-3 py-1.5 text-ui-label font-medium text-content hover:bg-content/18 disabled:opacity-40"
          >
            Save
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
