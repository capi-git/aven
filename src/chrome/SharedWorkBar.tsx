import { memo } from "react";
import { useSessionOverlap } from "../hooks/useSharedWork";
import { overlapSentence } from "../lib/sharedWork";
import "./SharedWork.css";

/**
 * "Codex is also editing src/App.tsx": one amber line above the message box
 * while another working chat in the project edits the same files. It reads
 * the shared-work store directly, so streaming never renders it, and it goes
 * when either turn ends.
 */
export const SharedWorkBar = memo(function SharedWorkBar({
  sessionId,
}: {
  sessionId?: string;
}) {
  const overlap = useSessionOverlap(sessionId);
  if (!overlap?.length || !sessionId) return null;
  const files = [...new Set(overlap.flatMap((entry) => entry.files))];
  return (
    <div className="px-2 pb-1" data-shared-work-bar={sessionId}>
      <div className="shared-work-bar" role="status" aria-live="polite">
        <span className="shared-work-mark" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={files.join("\n")}>
          {overlapSentence(overlap)}
        </span>
      </div>
    </div>
  );
});
