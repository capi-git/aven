import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useProjectAppearance } from "../hooks/useProjectAppearance";
import { useProjectMemory } from "../hooks/useProjectMemory";
import { copyText } from "../lib/clipboard";
import { errorText } from "../lib/errors";
import {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
} from "../lib/harness/availability";
import { HARNESS_IDS } from "../lib/harness/descriptors";
import {
  PROJECT_MEMORY_CHANNEL_LABELS,
  projectMemoryRecipients,
} from "../lib/harness/projectMemoryDelivery";
import { LAYER } from "../lib/layers";
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
import { HARNESS_TITLE } from "../lib/session";
import { HarnessIcon } from "./HarnessIcon";
import { Check, Copy } from "./icons";
import { ProjectMark } from "./ProjectMark";

type Props = {
  path: string;
  onClose: () => void;
};

const PLACEHOLDER = `Decisions, conventions, work in progress and gotchas. For example:
- Use pnpm, not npm.
- The payments refactor is half done on feat/payments.
- Run the API tests with \`make test-api\`; they need Docker.`;

/** Installed providers once they are known, otherwise every provider. */
function recipientIds() {
  // Reading the snapshot keeps this in step without starting a probe.
  void getHarnessAvailabilitySnapshot();
  if (!hasProbedHarnessAvailability()) return HARNESS_IDS;
  const installed = HARNESS_IDS.filter((id) => isHarnessAvailable(id));
  return installed.length > 0 ? installed : HARNESS_IDS;
}

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

  const recipients = projectMemoryRecipients(recipientIds());
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
        </header>

        <p className="text-ui-label leading-snug text-content/55">
          Every agent working in this project receives this as background
          context, whichever model runs it. It stays in Aven and is never
          written to the project's files.
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

        <div className="flex flex-col gap-1">
          <p className="text-ui-caption text-content/45">Received by</p>
          <ul className="flex flex-col gap-1">
            {recipients.map((group) => (
              <li
                key={group.channel}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-label text-content/70"
              >
                <span className="w-36 shrink-0 text-content/45">
                  {PROJECT_MEMORY_CHANNEL_LABELS[group.channel]}
                </span>
                {group.harnesses.map((id) => (
                  <span key={id} className="flex items-center gap-1">
                    <HarnessIcon harness={id} className="size-3.5 shrink-0" />
                    {HARNESS_TITLE[id]}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-ui-caption leading-snug text-content/40">
            Changes reach new chats right away, and chats already open with
            their next message.
          </p>
        </div>

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
              Remember this in a chat.
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
            title="Copy as Markdown, for example to paste into AGENTS.md"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-ui-label text-content/60 hover:bg-content/8 hover:text-content disabled:opacity-40"
          >
            {copied ? (
              <Check className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Copy className="size-3.5" strokeWidth={1.75} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="flex-1" />
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
            title={`Save (${MOD}↩)`}
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
