import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../lib/layers";
import { displayAppData, prettyCwd } from "../lib/paths";
import { projectSessionCount } from "../lib/projectData";

type Props = {
  name: string;
  path: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Delete drops the project from the sidebar and its saved chats. The folder on
 * disk is left alone; opening it again brings the project back empty.
 */
export function RemoveProjectDialog({
  name,
  path,
  onCancel,
  onConfirm,
}: Props) {
  const [sessions, setSessions] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessions(null);
    setCountError(false);
    void projectSessionCount(path)
      .then((count) => {
        if (!cancelled) setSessions(count);
      })
      .catch(() => {
        if (!cancelled) setCountError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div
        className="modal-backdrop absolute inset-0 bg-black/40"
        onMouseDown={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${name} and its chats`}
        onMouseDown={(event) => event.stopPropagation()}
        className="absolute left-1/2 top-[22%] flex w-[min(420px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 aven-sheet p-4"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-ui-sheet font-semibold leading-tight tracking-[-0.01em] text-content">
            Delete “{name}” and its chats?
          </h2>
          <p className="text-ui-label leading-snug text-content/55">
            All chats in this project, including ones agents started, will be
            deleted. It also leaves the sidebar. The folder on disk stays put,
            and opening it again brings the project back empty.
          </p>
          {sessions != null && sessions > 0 ? (
            <p className="text-ui-label leading-snug text-content/45">
              {sessions === 1
                ? "1 saved chat will be removed."
                : `${sessions} saved chats will be removed.`}
            </p>
          ) : null}
          {countError ? (
            <p
              role="alert"
              className="text-ui-label leading-snug text-(--aven-danger-text)"
            >
              Could not load this project's chats. Cancel and try again.
            </p>
          ) : null}
          <p className="truncate text-ui-caption leading-tight text-content/40">
            {displayAppData(prettyCwd(path))}
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-ui-label text-content/70 hover:bg-(--aven-control-bg) hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={sessions == null || countError}
            className="rounded-md px-3 py-1.5 text-ui-label font-medium bg-(--aven-danger-fill) text-(--aven-danger-text) hover:bg-(--aven-danger-fill-hover) disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
