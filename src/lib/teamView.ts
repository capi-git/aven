import { projectKey } from "./paths";
import { normalizeProjectPath } from "./recents";

/**
 * How each project's team screen opens: its Chat or its Cards. Chat unless
 * you chose Cards for that project; remembered in every window.
 */
export type TeamView = "chat" | "cards";

export const TEAM_VIEW_KEY = "aven.teamView.v1";
/** Projects remembered: the most recently switched. */
const KEPT = 60;

const listeners = new Set<() => void>();
let cacheRaw: string | null | undefined;
let cache: Readonly<Record<string, TeamView>> = {};

function read(): Readonly<Record<string, TeamView>> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(TEAM_VIEW_KEY);
  } catch {
    return cache;
  }
  if (raw === cacheRaw) return cache;
  cacheRaw = raw;
  const next: Record<string, TeamView> = {};
  try {
    const saved = JSON.parse(raw ?? "{}") as unknown;
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      for (const [key, value] of Object.entries(saved))
        if (value === "chat" || value === "cards") next[key] = value;
  } catch {
    // An unreadable entry opens every team on its Chat.
  }
  cache = next;
  return cache;
}

const keyFor = (path: string) => projectKey(normalizeProjectPath(path));

export function teamView(path: string): TeamView {
  return read()[keyFor(path)] ?? "chat";
}

export function setTeamView(path: string, view: TeamView) {
  const key = keyFor(path);
  const current = read();
  if ((current[key] ?? "chat") === view) return;
  const rest = Object.entries(current).filter(([item]) => item !== key);
  const next = Object.fromEntries([...rest, [key, view]].slice(-KEPT));
  cache = next;
  try {
    const raw = JSON.stringify(next);
    localStorage.setItem(TEAM_VIEW_KEY, raw);
    cacheRaw = raw;
  } catch {
    // Without storage the choice lasts as long as the window.
  }
  for (const listener of [...listeners]) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== TEAM_VIEW_KEY) return;
  for (const listener of [...listeners]) listener();
}

export function subscribeTeamView(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

/** Test seam. */
export function resetTeamViewCache() {
  cacheRaw = undefined;
  cache = {};
}
