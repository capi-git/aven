import { memo } from "react";
import { useDevPreviews } from "../hooks/useDevPreviews";
import {
  chipPreview,
  dismissDevPreview,
  openDevPreview,
  type DevPreviewPlacement,
} from "../lib/devPreviews";
import { PanelRight, X } from "./icons";
import "./DevPreviewChip.css";

type Props = {
  project: string;
  placement: DevPreviewPlacement;
  /** The chat to open beside; the active chat when absent. */
  requesterSessionId?: string;
};

/**
 * "Preview ready · localhost:5173 — Open beside chat". Renders only when the
 * project's dev servers change, never for streamed chat text.
 */
export const DevPreviewChip = memo(function DevPreviewChip({
  project,
  placement,
  requesterSessionId,
}: Props) {
  const previews = useDevPreviews();
  const preview = chipPreview(previews, project, placement);
  if (!preview) return null;
  const live = preview.status === "live";
  const state = live ? "Preview ready" : "Preview stopped";
  return (
    <div
      className="dev-preview-chip"
      data-placement={placement}
      data-state={preview.status}
      data-no-drag
    >
      <span className="dev-preview-dot" aria-hidden="true" />
      <span
        className="dev-preview-copy"
        role="status"
        aria-live="polite"
        title={live ? `${state} at ${preview.url}` : `${preview.url} stopped`}
      >
        <span className="dev-preview-state">{state}</span>
        <span className="dev-preview-sep" aria-hidden="true">
          ·
        </span>
        <span className="dev-preview-label">{preview.label}</span>
      </span>
      {live ? (
        <button
          type="button"
          className="dev-preview-open"
          title={`Open ${preview.label} beside the chat`}
          onClick={() => openDevPreview(preview.key, { requesterSessionId })}
        >
          <PanelRight className="size-3" aria-hidden="true" />
          Open beside chat
        </button>
      ) : null}
      <button
        type="button"
        className="dev-preview-dismiss"
        aria-label={`Dismiss preview for ${preview.label}`}
        onClick={() => dismissDevPreview(preview.key)}
      >
        <X className="size-3" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
});
