import { projectKey, projectName } from "./paths";
import { isProjectlessCwd } from "./projectlessWorkspace";
import {
  describeSchedule,
  formatRunTime,
  type ScheduledAgent,
  type ScheduledRun,
  type ScheduledRunStatus,
} from "./scheduledAgents";

/**
 * The Automations section lists one folder per project, named and marked as
 * the sidebar shows the project, then "No project" for automations that run
 * outside one. A folder holds its automations, each with its runs; the runs
 * of a deleted automation stay in its folder, under its old name, so their
 * conversations can still be opened.
 */

export const NO_PROJECT_FOLDER = "no-project";
export const NO_PROJECT_NAME = "No project";

export type AutomationItem = {
  /** The automation's id, which its runs carry as `scheduleId`. */
  id: string;
  name: string;
  /** Absent once the automation is deleted; its runs stay. */
  agent?: ScheduledAgent;
  /** Newest first. */
  runs: ScheduledRun[];
};

export type AutomationFolder = {
  key: string;
  /** The project folder, or null for "No project". */
  project: string | null;
  name: string;
  items: AutomationItem[];
};

export type FolderOptions = {
  isProjectless?: (path: string) => boolean;
  /** The project's display name (its label in Aven, else its folder). */
  nameOf?: (path: string) => string;
};

/** True for an automation that runs outside every project. */
export function isNoProject(
  project: string,
  isProjectless: (path: string) => boolean = isProjectlessCwd,
): boolean {
  return !project.trim() || isProjectless(project);
}

export function automationFolderKey(
  project: string,
  isProjectless?: (path: string) => boolean,
): string {
  return isNoProject(project, isProjectless)
    ? NO_PROJECT_FOLDER
    : projectKey(project);
}

/**
 * Automations, and the runs of deleted ones, grouped into a folder per
 * project. Folders are in name order with "No project" last; automations in
 * name order with deleted ones after them.
 */
export function groupAutomationsByProject(
  agents: readonly ScheduledAgent[],
  runs: readonly ScheduledRun[],
  options: FolderOptions = {},
): AutomationFolder[] {
  const isProjectless = options.isProjectless ?? isProjectlessCwd;
  const nameOf = options.nameOf ?? projectName;
  const byAutomation = new Map<string, ScheduledRun[]>();
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const list = byAutomation.get(run.scheduleId);
    if (list) list.push(run);
    else byAutomation.set(run.scheduleId, [run]);
  }
  const folders = new Map<string, AutomationFolder>();
  const add = (project: string, item: AutomationItem) => {
    const none = isNoProject(project, isProjectless);
    const key = none ? NO_PROJECT_FOLDER : projectKey(project);
    let folder = folders.get(key);
    if (!folder) {
      folder = {
        key,
        project: none ? null : project,
        name: none ? NO_PROJECT_NAME : nameOf(project),
        items: [],
      };
      folders.set(key, folder);
    }
    folder.items.push(item);
  };
  const known = new Set<string>();
  for (const agent of agents) {
    known.add(agent.id);
    add(agent.project, {
      id: agent.id,
      name: agent.name,
      agent,
      runs: byAutomation.get(agent.id) ?? [],
    });
  }
  for (const [id, list] of byAutomation) {
    if (known.has(id)) continue;
    const newest = list[0]!;
    add(newest.project, { id, name: newest.name, runs: list });
  }
  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  for (const folder of folders.values())
    folder.items.sort(
      (a, b) =>
        Number(!a.agent) - Number(!b.agent) ||
        byName(a.name, b.name) ||
        a.id.localeCompare(b.id),
    );
  return [...folders.values()].sort(
    (a, b) =>
      Number(a.project == null) - Number(b.project == null) ||
      byName(a.name, b.name) ||
      a.key.localeCompare(b.key),
  );
}

/** The folder an automation (or a deleted one's runs) is in. */
export function folderOfAutomation(
  folders: readonly AutomationFolder[],
  id: string,
): AutomationFolder | undefined {
  return folders.find((folder) => folder.items.some((item) => item.id === id));
}

export type AutomationTone = ScheduledRunStatus | "never" | "off" | "deleted";

/**
 * The status dot before an automation's name: how its last run went, or
 * that it has not run yet.
 */
export function automationTone(item: AutomationItem): AutomationTone {
  const last = item.runs[0];
  if (last?.status === "running") return "running";
  if (last) return last.status;
  if (!item.agent) return "deleted";
  return item.agent.enabled ? "never" : "off";
}

const TONE_WORDS: Record<ScheduledRunStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Stopped",
};

export function runStatusWord(status: ScheduledRunStatus): string {
  return TONE_WORDS[status];
}

/** "2h", "3d": how long ago, as short as the sidebar puts it. */
export function shortAgo(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/**
 * The line under an automation's name: when it runs and when it runs next,
 * or that it is off. "Weekdays at 08:30 · Next Tomorrow 08:30".
 */
export function automationTiming(item: AutomationItem, now = Date.now()) {
  const agent = item.agent;
  if (!agent) return "Deleted";
  const when = describeSchedule(agent.schedule);
  if (!agent.enabled) return `${when} · Off`;
  if (agent.nextRunAt == null) return `${when} · Never runs`;
  return `${when} · Next ${formatRunTime(agent.nextRunAt, now)}`;
}

/** "Last run failed 8 hours ago", for the row's dot and screen readers. */
export function lastRunLabel(item: AutomationItem, now = Date.now()): string {
  const last = item.runs[0];
  if (!last) return item.agent ? "Not run yet" : "Deleted";
  if (last.status === "running") return "Running now";
  const at = last.finishedAt ?? last.startedAt;
  return `Last run ${runStatusWord(last.status).toLowerCase()} ${shortAgo(at, now)} ago`;
}

// ---------------------------------------------------------------------------
// Folded folders, remembered across launches and windows.

const COLLAPSED_KEY = "aven.automations.collapsedFolders.v1";
const COLLAPSED_EVENT = "aven:automation-folders-changed";
let collapsedCache: { raw: string | null; keys: ReadonlySet<string> } | null =
  null;

export function loadCollapsedFolders(): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(COLLAPSED_KEY);
  } catch {
    raw = null;
  }
  if (collapsedCache?.raw === raw) return collapsedCache.keys;
  let keys: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      keys = parsed.filter(
        (key): key is string => typeof key === "string" && key.length <= 4096,
      );
  } catch {
    keys = [];
  }
  collapsedCache = { raw, keys: new Set(keys) };
  return collapsedCache.keys;
}

export function setFolderCollapsed(key: string, collapsed: boolean) {
  const next = new Set(loadCollapsedFolders());
  if (collapsed) next.add(key);
  else next.delete(key);
  try {
    if (next.size)
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    else localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Storage unavailable: folders open again next time.
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT));
}

export function subscribeCollapsedFolders(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === COLLAPSED_KEY) listener();
  };
  window.addEventListener(COLLAPSED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
