import { memo, useState } from "react";
import {
  useKeeperModel,
  useMemoryKeeperProject,
} from "../hooks/useMemoryKeeperProject";
import { errorText } from "../lib/errors";
import {
  keeperAgo,
  keeperChangeText,
  keeperOfferShownIn,
  requestKeeperRefresh,
  setMemoryKeeper,
} from "../lib/memoryKeeper";
import { undoKeeperChange } from "../lib/memoryKeeperRun";
import { Brain, RefreshCw, Undo2 } from "./icons";
import "./MemoryKeeper.css";

/** Short enough for a narrow chat; it wraps to a second line before it is cut. */
export const MEMORY_KEEPER_OFFER = "Keep this project's memory up to date?";

/**
 * Asked once per project, above the message box of the chat whose finished
 * turn brought it (the first in a project whose memory is empty), until it
 * is answered. Not now is for good.
 */
export const MemoryKeeperOffer = memo(function MemoryKeeperOffer({
  project,
  sessionId,
  focused,
}: {
  project: string;
  /** The chat this box belongs to. */
  sessionId: string;
  /** Its pane has focus: an older offer, made in no chat, shows there. */
  focused: boolean;
}) {
  const state = useMemoryKeeperProject(project);
  const model = useKeeperModel();
  if (!keeperOfferShownIn(state, sessionId) || !model) return null;
  if (!state.offeredIn && !focused) return null;
  return (
    <div
      className="memory-keeper-offer"
      role="group"
      aria-label="Project memory"
      data-memory-keeper-offer
      data-no-drag
    >
      <Brain
        className="memory-keeper-offer-icon size-3.5"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span
        className="memory-keeper-offer-copy"
        title={`Aven fills this project's memory once and keeps its own sections current with ${model.label}, which reads a summary and cannot change anything. Your own lines are never changed.`}
      >
        {MEMORY_KEEPER_OFFER}
      </span>
      <button
        type="button"
        className="memory-keeper-offer-on"
        onClick={() => setMemoryKeeper(project, true)}
      >
        Turn on
      </button>
      <button
        type="button"
        className="memory-keeper-offer-later"
        onClick={() => setMemoryKeeper(project, false)}
      >
        Not now
      </button>
    </div>
  );
});

/**
 * "Kept up to date by Aven". The editor shows which model keeps it, when it
 * last ran and Refresh now; Customize project shows the switch alone.
 */
export function MemoryKeeperSwitch({
  path,
  details = false,
}: {
  path: string;
  details?: boolean;
}) {
  const state = useMemoryKeeperProject(path);
  const model = useKeeperModel();
  const on = state.consent === "on";
  const working = on && (state.running != null || state.requested != null);
  const now = Date.now();
  const description = !model
    ? "Needs Claude Code or Codex installed."
    : on
      ? [
          state.model ?? model.label,
          working
            ? "updating…"
            : state.lastRunAt
              ? `last ran ${keeperAgo(state.lastRunAt, now)}`
              : "has not run yet",
        ].join(" · ")
      : "Aven fills this memory and keeps its own sections current. Your lines stay yours.";
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={!model && !on}
      title={
        details
          ? undefined
          : "Aven fills this memory and keeps its own sections current"
      }
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setMemoryKeeper(path, !on)}
      className="memory-keeper-switch"
      data-memory-keeper-switch
    >
      <span className="memory-keeper-track" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Kept up to date by Aven</span>
    </button>
  );
  if (!details) return toggle;
  return (
    <div className="memory-keeper-panel">
      {toggle}
      <div className="memory-keeper-details" data-memory-keeper-details>
        <span className="memory-keeper-details-text">{description}</span>
        {on && model ? (
          <button
            type="button"
            className="memory-keeper-action"
            disabled={working}
            onClick={() => requestKeeperRefresh(path)}
            title="Read the project again and rewrite Aven's sections"
          >
            <RefreshCw className="size-3" strokeWidth={1.75} aria-hidden />
            Refresh now
          </button>
        ) : null}
        {on && state.lastError && !working ? (
          <span className="memory-keeper-error" role="status">
            Last update didn't finish: {state.lastError}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Updated by Aven 2 h ago · +2 −1 lines · Undo" for the editor's header.
 * Undo waits while the editor holds unsaved text, so it never discards it.
 */
export function MemoryKeeperChangeNote({
  path,
  editing,
}: {
  path: string;
  editing: boolean;
}) {
  const state = useMemoryKeeperProject(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = state.change;
  if (!change) return null;
  const now = Date.now();
  if (change.undone)
    return (
      <span className="memory-keeper-note" data-memory-keeper-note>
        <span className="memory-keeper-note-text">
          Aven's last update was undone
        </span>
      </span>
    );
  const undo = () => {
    setBusy(true);
    setError(null);
    void undoKeeperChange(path)
      .catch((failure) => setError(errorText(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <span className="memory-keeper-note" data-memory-keeper-note>
      <span
        className="memory-keeper-note-text"
        title={error ?? new Date(change.at).toLocaleString()}
        role={error ? "alert" : undefined}
      >
        {error ? "Couldn't undo" : keeperChangeText(change, now)}
      </span>
      <button
        type="button"
        className="memory-keeper-action"
        disabled={busy || editing}
        onClick={undo}
        title={
          editing
            ? "Save or cancel your edit first"
            : "Put back the memory as it was before this update"
        }
      >
        <Undo2 className="size-3" strokeWidth={1.75} aria-hidden />
        Undo
      </button>
    </span>
  );
}
