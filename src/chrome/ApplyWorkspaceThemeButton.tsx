import { useState } from "react";
import { loadWorkspaceProfiles } from "../lib/workspaceProfiles";
import { copyWorkspaceTheme, useWorkspaceTheme } from "../lib/workspaceThemes";
import { Check, Copy } from "./icons";

export function ApplyWorkspaceThemeButton({
  profileId,
  compact = false,
}: {
  profileId: string;
  compact?: boolean;
}) {
  const theme = useWorkspaceTheme(profileId);
  const fingerprint = `${profileId}:${JSON.stringify(theme)}`;
  const [result, setResult] = useState<{
    fingerprint: string;
    saved: boolean;
  }>();
  const currentResult =
    result?.fingerprint === fingerprint ? result : undefined;
  return (
    <div className={compact ? "my-2" : "flex flex-col items-end gap-1"}>
      <button
        type="button"
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-content/15 bg-content/5 px-3 py-2 text-content hover:bg-content/10 ${compact ? "w-full text-[11px]" : "text-xs"}`}
        onClick={() => {
          const ids = loadWorkspaceProfiles().profiles.map(
            (profile) => profile.id,
          );
          setResult({ fingerprint, saved: copyWorkspaceTheme(profileId, ids) });
        }}
      >
        {currentResult?.saved ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        Use for all workspaces
      </button>
      <div
        role="status"
        className={
          compact
            ? "mt-1 text-[10px] text-content/70"
            : "text-[11px] text-content/70"
        }
      >
        {currentResult
          ? currentResult.saved
            ? "Appearance applied to all workspaces."
            : "Couldn’t save appearance. Please try again."
          : null}
      </div>
    </div>
  );
}
