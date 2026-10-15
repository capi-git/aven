import { useEffect, useRef, useState } from "react";
import { errorText } from "../lib/errors";
import { MOD } from "../lib/platform";
import {
  PROJECT_MEMORY_MAX_CHARS,
  appendProjectMemory,
  memoryItemFromReply,
} from "../lib/projectMemory";
import { Brain, Check } from "./icons";
import { Popover } from "./Popover";

type Props = {
  /** The project whose memory receives the item. */
  project: string;
  /** The reply, used as the starting point for the item. */
  text: string;
};

/**
 * "Remember this" on a finished reply: a short item, edited before saving,
 * added to the project's memory so every agent in the project receives it.
 */
export function RememberButton({ project, text }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const remembered = () => {
    setOpen(false);
    setSaved(true);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 2000);
  };

  const label = saved ? "Remembered for this project" : "Remember this";
  return (
    <>
      <button
        ref={button}
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md p-1 text-content/40 hover:bg-content/8 hover:text-content/70"
        onClick={() => setOpen((value) => !value)}
      >
        {saved ? (
          <Check className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Brain className="size-3.5" strokeWidth={1.75} />
        )}
      </button>
      {open ? (
        <RememberPopover
          anchor={button}
          project={project}
          initial={memoryItemFromReply(text)}
          onCancel={() => setOpen(false)}
          onSaved={remembered}
        />
      ) : null}
    </>
  );
}

function RememberPopover({
  anchor,
  project,
  initial,
  onCancel,
  onSaved,
}: {
  anchor: { current: HTMLElement | null };
  project: string;
  initial: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [item, setItem] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = item.length > PROJECT_MEMORY_MAX_CHARS;

  const save = async () => {
    if (saving || !item.trim() || tooLong) return;
    setSaving(true);
    setError(null);
    try {
      await appendProjectMemory(project, item);
      onSaved();
    } catch (failure) {
      setError(errorText(failure));
      setSaving(false);
    }
  };

  return (
    <Popover
      anchor={anchor}
      side="top"
      align="start"
      gap={6}
      width={340}
      role="dialog"
      aria-label="Remember this for the project"
      autoFocus
      initialFocus="textarea"
      onDismiss={onCancel}
      className="p-3"
    >
      <div onKeyDown={(event) => event.stopPropagation()}>
        <p className="mb-1.5 text-ui-caption text-content/50">
          Remember for this project
        </p>
        <textarea
          value={item}
          rows={4}
          disabled={saving}
          aria-label="Item to remember"
          placeholder="- What every agent here should know"
          onChange={(event) => {
            setItem(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          className="max-h-48 w-full resize-none rounded-md bg-content/8 px-2 py-1.5 text-ui-label leading-relaxed text-content outline-none placeholder:text-content/30 disabled:opacity-50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/60"
        />
        <p className="mt-1.5 text-ui-caption leading-snug text-content/40">
          Added to the project memory every agent here receives, from their next
          message.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-1.5 text-ui-caption leading-snug text-red-300"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-2.5 flex justify-end gap-1.5">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onCancel}
            className="h-7 rounded-md px-2.5 text-ui-label text-content/60 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !item.trim() || tooLong}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void save()}
            title={`Remember (${MOD}↩)`}
            className="h-7 rounded-md bg-content/12 px-3 text-ui-label font-medium text-content hover:bg-content/18 disabled:opacity-40"
          >
            Remember
          </button>
        </div>
      </div>
    </Popover>
  );
}
