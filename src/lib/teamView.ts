import { projectKey } from "./paths";
import { normalizeProjectPath } from "./recents";

/**
 * How each project's team screen opens: its Board or its Chat. The Board
 * unless you chose the Chat for that project; remembered in every window.
 * (The v1 key held Chat or Cards, from before the Board came back.)
 */
export type TeamView = "board" | "chat";

export const TEAM_VIEW_KEY = "aven.teamView.v2";
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
  // The v1 key (Chat or Cards) has nothing left to say.
  try {
    localStorage.removeItem("aven.teamView.v1");
  } catch {
    // Quietly left behind; nothing reads it.
  }
  const next: Record<string, TeamView> = {};
  try {
    const saved = JSON.parse(raw ?? "{}") as unknown;
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      for (const [key, value] of Object.entries(saved))
        if (value === "board" || value === "chat") next[key] = value;
  } catch {
    // An unreadable entry opens every team on its Board.
  }
  cache = next;
  return cache;
}

const keyFor = (path: string) => projectKey(normalizeProjectPath(path));

export function teamView(path: string): TeamView {
  return read()[keyFor(path)] ?? "board";
}

export function setTeamView(path: string, view: TeamView) {
  const key = keyFor(path);
  const current = read();
  if ((current[key] ?? "board") === view) return;
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
