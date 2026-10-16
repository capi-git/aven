/**
 * Development builds only: show the restart-to-update screens with made-up
 * work, to check how they look without a real update. Every action in a
 * preview only closes it; nothing stops, quits or restarts. Release builds
 * compile `import.meta.env.DEV` to false, so each entry point does nothing.
 */
import { lockUpdateInput, setUpdateLockStatus } from "./updateInputLock";
import { previewUpdateWaiting } from "./updater";
import {
  getRestartDecision,
  requestRestartDecision,
  restartWaitReason,
  type RestartWork,
} from "./updateRestartWork";

export type UpdateRestartPreview = "question" | "waiting" | "overlay";

/** Two agents (one waiting for an answer), a terminal command and a file. */
export const PREVIEW_RESTART_WORK: RestartWork = {
  agents: [
    {
      id: "preview-agent-working",
      title: "Fix login",
      project: "Aven",
      state: "working",
    },
    {
      id: "preview-agent-waiting",
      title: "Review PR",
      project: "Cadence",
      state: "waiting",
    },
  ],
  terminals: [{ id: "preview-terminal", command: "npm" }],
  files: [{ id: "preview-file", name: "App.tsx", project: "Aven" }],
};

export const PREVIEW_OVERLAY_STATUS =
  "Waiting for Aven to finish updating Claude Code…";

/** Whether this build offers the previews at all. */
export function updateRestartPreviewsAvailable(): boolean {
  return import.meta.env.DEV;
}

/**
 * Open one preview. False when this build has none, or when a real restart
 * question or wait is already on screen and must not be covered.
 */
export function previewUpdateRestart(kind: UpdateRestartPreview): boolean {
  if (!import.meta.env.DEV) return false;
  if (kind === "question") {
    if (getRestartDecision()) return false;
    // The answer is ignored: every button only closes the preview.
    void requestRestartDecision(PREVIEW_RESTART_WORK);
    return true;
  }
  if (kind === "waiting")
    // Agents only, as most often: "Restarting when your agents finish".
    return previewUpdateWaiting(
      restartWaitReason({ ...PREVIEW_RESTART_WORK, terminals: [], files: [] }),
    );
  if (typeof document === "undefined") return false;
  let release = () => {};
  release = lockUpdateInput({ onPreviewDismiss: () => release() });
  setUpdateLockStatus(PREVIEW_OVERLAY_STATUS);
  return true;
}
