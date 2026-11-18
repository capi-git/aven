import { useEffect, useState } from "react";
import {
  machineStats,
  MACHINE_STATS_POLL_MS,
  type MachineStats,
} from "../lib/machineStats";
import { runningScriptPtys } from "../lib/projectScripts";

/** Reads this Mac's CPU and memory every 2 seconds, only while `open`. */
export function useMachineStats(open: boolean): MachineStats | null {
  const [stats, setStats] = useState<MachineStats | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: number | undefined;
    const read = () => {
      machineStats(runningScriptPtys())
        .then((next) => {
          if (alive && next) setStats(next);
        })
        .catch(() => {
          /* Best effort: the card keeps its last reading. */
        })
        .finally(() => {
          if (alive) timer = window.setTimeout(read, MACHINE_STATS_POLL_MS);
        });
    };
    read();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open]);
  return stats;
}
