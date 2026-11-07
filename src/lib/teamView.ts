import { projectKey } from "./paths";
import { normalizeProjectPath } from "./recents";

/**
 * What each project's Avos screen shows: its chat, always, with its profile
 * beside it. The old Board is kept only for the real-app check to read
 * cards off, for this session (`setTeamView`); remembered in every window.
 */
export const TEAM_VIEWS = ["chat", "board"] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

/**
 * Saved views from before that open on the chat now: the tabs (Changes,
 * Notes, Sub agents) went into Avos's chat and profile, the Board's work
 * into Avos's message on what needs you, the Schedule into a sheet, and
 * Overview and Teammates went long before.
 */
const RETIRED_VIEWS: Readonly<Record<string, TeamView>> = {
  overview: "chat",
  teammates: "chat",
  changes: "chat",
  notes: "chat",
  agents: "chat",
  board: "chat",
  schedule: "chat",
};

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
        if (typeof value === "string" && RETIRED_VIEWS[value])
          next[key] = RETIRED_VIEWS[value]!;
        else if (TEAM_VIEWS.includes(value as TeamView))
          next[key] = value as TeamView;
  } catch {
    // An unreadable entry opens every Avos on its Chat.
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
