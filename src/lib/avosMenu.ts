import type { ExplorerMenuItem } from "../chrome/ExplorerMenu";
import {
  allowMoreRunsToday,
  setCrewPaused,
  stopCrewNow,
  type CrewWorkspace,
} from "./crewActions";

/** What Avos's menu offers, from its ⋯ or its sidebar row. */
export function avosMenuItems({
  paused,
  working,
  dailyCap,
  open,
}: {
  paused: boolean;
  working: boolean;
  dailyCap: boolean;
  /** Lead with Open Avos (its sidebar row, where it isn't open yet). */
  open?: boolean;
}): ExplorerMenuItem[] {
  return [
    ...(open
      ? [
          { kind: "item" as const, id: "open", label: "Open Avos" },
          { kind: "sep" as const },
        ]
      : []),
    ...(working
      ? [{ kind: "item" as const, id: "stop", label: "Stop now" }]
      : []),
    ...(dailyCap
      ? [{ kind: "item" as const, id: "more", label: "Allow 10 more today" }]
      : []),
    ...(working || dailyCap ? [{ kind: "sep" as const }] : []),
    { kind: "item", id: "notes", label: "What Avos remembers" },
    paused
      ? { kind: "item", id: "resume", label: "Resume Avos" }
      : { kind: "item", id: "pause", label: "Pause Avos" },
    { kind: "item", id: "settings", label: "Settings…" },
  ];
}

/** Does what an item of `avosMenuItems` says, for the project at `path`. */
export function runAvosMenu(
  id: string,
  path: string,
  workspace: CrewWorkspace | null | undefined,
): void {
  if (id === "stop") void stopCrewNow(path);
  else if (id === "more") allowMoreRunsToday(path);
  // What it remembers: its Memory page in Settings.
  else if (id === "notes") workspace?.openSettings(path, "memory");
  else if (id === "pause" || id === "resume")
    setCrewPaused(path, id === "pause");
  else if (id === "settings") workspace?.openSettings(path);
}
