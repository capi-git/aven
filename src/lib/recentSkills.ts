import { projectKey } from "./paths";

/**
 * Skills the user invoked recently, per project, so the `/` picker can offer
 * them first. Stored as `{ [project]: invocation[] }`, most recent first; the
 * least recently used projects are dropped once there are too many.
 */
const KEY = "aven.recentSkills.v1";
/** Fired in this window after a skill is used, so every pane can refresh. */
export const RECENT_SKILLS_CHANGE_EVENT = "aven:recent-skills-change";
export const MAX_RECENT_SKILLS = 8;
const MAX_PROJECTS = 40;
const MAX_INVOCATION = 200;

type Stored = Record<string, string[]>;

function read(): Stored {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const out: Stored = {};
    for (const [project, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const invocations = list
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= MAX_INVOCATION,
        )
        .slice(0, MAX_RECENT_SKILLS);
      if (invocations.length > 0) out[project] = invocations;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadRecentSkills(project: string): string[] {
  return read()[projectKey(project)] ?? [];
}

/** Move `invocations` to the front of the project's list and return it. */
export function rememberRecentSkills(
  project: string,
  invocations: readonly string[],
): string[] {
  const used = invocations.filter(
    (value) => value.length > 0 && value.length <= MAX_INVOCATION,
  );
  if (used.length === 0) return loadRecentSkills(project);
  const key = projectKey(project);
  const stored = read();
  const next = [...new Set([...used, ...(stored[key] ?? [])])].slice(
    0,
    MAX_RECENT_SKILLS,
  );
  // Re-insert so key order doubles as project recency for trimming.
  delete stored[key];
  stored[key] = next;
  const projects = Object.keys(stored);
  for (const old of projects.slice(
    0,
    Math.max(0, projects.length - MAX_PROJECTS),
  )) {
    delete stored[old];
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Best effort: the order still applies in this window until it closes.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(RECENT_SKILLS_CHANGE_EVENT));
  }
  return next;
}

/**
 * Call `listener` when any project's recent skills change: in this window
 * (another pane used a skill) or in another window sharing the storage.
 */
export function subscribeRecentSkills(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener(RECENT_SKILLS_CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RECENT_SKILLS_CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
