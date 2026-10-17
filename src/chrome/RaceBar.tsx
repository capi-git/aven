import { memo, useCallback, useSyncExternalStore } from "react";
import { useRaceLaneStates } from "../hooks/useRaceLaneStates";
import { raceLaneFor, raceWorkspace, subscribeRaces } from "../lib/race";
import { raceProgress } from "../lib/raceLanes";
import { Race } from "./icons";

/**
 * The slim bar above a race lane's message box: how far the race is, and
 * Compare, which opens the overview from any lane chat, even after its tab
 * closed or it left the race's tab.
 */
export const RaceBar = memo(function RaceBar({
  sessionId,
}: {
  sessionId?: string;
}) {
  const read = useCallback(
    () => (sessionId ? raceLaneFor(sessionId)?.race : undefined),
    [sessionId],
  );
  const race = useSyncExternalStore(subscribeRaces, read, () => undefined);
  const running = race?.state === "running" ? race : undefined;
  const lanes = useRaceLaneStates(running);
  if (!running) return null;
  const workspace = raceWorkspace();
  return (
    <div className="px-2 pb-1" data-race-bar={running.id}>
      <div className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-content/10 bg-content/3 pl-2 pr-0.5 text-ui-label text-content/60">
        <Race className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate" role="status">
          Racing · {raceProgress(lanes)}
        </span>
        {workspace ? (
          <button
            type="button"
            data-race-compare
            title="Compare the agents' changes and keep one"
            onClick={() => workspace.compare(running.id)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-content/70 hover:bg-content/10 hover:text-content"
          >
            Compare
          </button>
        ) : null}
      </div>
    </div>
  );
});
