import { memo, useState } from "react";
import { useDevPreviews } from "../hooks/useDevPreviews";
import {
  duplicateStop,
  duplicateSummary,
  duplicatesFor,
  keepDuplicateServer,
  stopDuplicateServer,
} from "../lib/devServerDuplicates";
import { X } from "./icons";
import "./SharedWork.css";

type Props =
  | { placement: "chat"; sessionId: string; project?: undefined }
  | { placement: "terminal"; project: string; sessionId?: undefined };

/**
 * "Codex started a second dev server on :5174 while :5173 is running ·
 * Ask Codex to stop it · Keep both". Shown in the chat that started the
 * copy, or in the terminal panel when a terminal did. Renders only when the
 * project's dev servers change.
 */
export const DuplicateServerChip = memo(function DuplicateServerChip(
  props: Props,
) {
  const previews = useDevPreviews();
  const [failed, setFailed] = useState<string | null>(null);
  const [duplicate] = duplicatesFor(
    previews,
    props.placement === "chat"
      ? { placement: "chat", sessionId: props.sessionId }
      : { placement: "terminal", project: props.project },
  );
  if (!duplicate) return null;
  const { preview, original } = duplicate;
  const stop = duplicateStop(preview);
  const handled = preview.duplicateHandled;
  const summary = duplicateSummary(duplicate);
  const copy =
    handled === "stopping"
      ? `Stopping the server on :${preview.port}…`
      : handled === "asked" && stop.kind === "ask"
        ? `Asked ${stop.agent} to stop the server on :${preview.port}`
        : props.placement === "terminal"
          ? `Second dev server on :${preview.port} while :${original.port} is running`
          : summary;
  const onStop = () => {
    setFailed(null);
    void stopDuplicateServer(preview.key).then((done) => {
      if (!done) setFailed(preview.key);
    });
  };
  const stopLabel =
    stop.kind === "terminal"
      ? "Stop the new one"
      : stop.kind === "ask"
        ? `Ask ${stop.agent} to stop it`
        : null;
  const stopHint =
    stop.kind === "ask"
      ? `Aven can't stop a server an agent started. This sends ${stop.agent} a message asking it to stop the server on :${preview.port}.`
      : `Press Ctrl+C in that terminal to stop the server on :${preview.port}.`;
  return (
    <div
      className="duplicate-server-chip"
      data-placement={props.placement}
      data-state={handled ? "handled" : "open"}
      data-duplicate-server={preview.port}
      data-no-drag
    >
      <span className="shared-work-mark" aria-hidden="true" />
      <span
        className="duplicate-server-copy"
        role="status"
        aria-live="polite"
        title={summary}
      >
        {copy}
        {failed === preview.key ? " · couldn't stop it" : null}
      </span>
      {!handled && stopLabel ? (
        <button
          type="button"
          className="duplicate-server-action"
          title={stopHint}
          onClick={onStop}
        >
          {stopLabel}
        </button>
      ) : null}
      {handled ? (
        <button
          type="button"
          className="duplicate-server-dismiss"
          aria-label={`Dismiss the note about :${preview.port}`}
          onClick={() => keepDuplicateServer(preview.key)}
        >
          <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="duplicate-server-action"
          data-quiet
          title="Keep both servers running; agents are told about both."
          onClick={() => keepDuplicateServer(preview.key)}
        >
          Keep both
        </button>
      )}
    </div>
  );
});
