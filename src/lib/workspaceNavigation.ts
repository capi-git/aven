/** Places in the app. Webpage history stays in the browser toolbar. */
export type WorkspaceLocation = {
  kind: "workspace" | "home" | "settings" | "search" | "inbox" | "notes";
  cwd: string;
  profileId: string;
  surfaceId?: string;
  tabId?: string;
  paneId?: string;
  fileId?: string;
  settingsSection?: string;
};

export type WorkspaceNavigation = {
  back: WorkspaceLocation[];
  current: WorkspaceLocation;
  forward: WorkspaceLocation[];
};

export function locationKey(place: WorkspaceLocation): string {
  return JSON.stringify([
    place.kind,
    place.profileId,
    place.cwd,
    ...(place.kind === "workspace"
      ? [place.surfaceId, place.tabId, place.paneId, place.fileId]
      : place.kind === "settings"
        ? [place.settingsSection]
        : []),
  ]);
}

export function createWorkspaceNavigation(
  current: WorkspaceLocation,
): WorkspaceNavigation {
  return { back: [], current, forward: [] };
}

export function recordWorkspaceLocation(
  history: WorkspaceNavigation,
  place: WorkspaceLocation,
): WorkspaceNavigation {
  if (locationKey(history.current) === locationKey(place)) return history;
  return {
    back: [...history.back, history.current].slice(-50),
    current: place,
    forward: [],
  };
}

export function visitWorkspaceLocation(
  history: WorkspaceNavigation,
  direction: "back" | "forward",
  available: (place: WorkspaceLocation) => boolean,
): WorkspaceNavigation | null {
  const pending = [...history[direction]];
  while (pending.length) {
    const next = direction === "back" ? pending.pop()! : pending.shift()!;
    if (!available(next) || locationKey(next) === locationKey(history.current))
      continue;
    return direction === "back"
      ? {
          back: pending,
          current: next,
          forward: [history.current, ...history.forward].slice(0, 50),
        }
      : {
          back: [...history.back, history.current].slice(-50),
          current: next,
          forward: pending,
        };
  }
  return null;
}
