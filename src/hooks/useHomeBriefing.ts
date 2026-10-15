import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  arriveHome,
  dismissHomeBriefing,
  leaveHome,
  loadHomeVisit,
  parseHomeVisit,
  readHomeVisitRaw,
  saveHomeVisit,
  type HomeBriefingWindow,
} from "../lib/homeBriefing";

/**
 * When the user was last in Aven, for Home's "While you were away" card.
 * Focus, showing the window and the first input after a pause count as being
 * here; blur, hiding and closing count as leaving. Only events drive it:
 * nothing polls, and input writes at most once a minute.
 */
const TOUCH_MS = 60_000;
const listeners = new Set<() => void>();
let present = false;
let touchedAt = 0;
let snapshotRaw: string | null | undefined;
let snapshot: HomeBriefingWindow | null = null;

function publish() {
  for (const listener of listeners) listener();
}

/** The stored briefing, keeping its identity while only `seenAt` changes. */
function getSnapshot(): HomeBriefingWindow | null {
  const raw = readHomeVisitRaw();
  if (raw === snapshotRaw) return snapshot;
  snapshotRaw = raw;
  const next = parseHomeVisit(raw)?.briefing ?? null;
  if (next?.since !== snapshot?.since || next?.at !== snapshot?.at)
    snapshot = next;
  return snapshot;
}

/** Here now: opens a briefing when the user is back from being away. */
export function arrive(now = Date.now()) {
  saveHomeVisit(arriveHome(loadHomeVisit(), now));
  present = true;
  touchedAt = now;
  publish();
}

export function leave(now = Date.now()) {
  saveHomeVisit(leaveHome(loadHomeVisit(), now));
  present = false;
  publish();
}

function touch() {
  const now = Date.now();
  if (present && now - touchedAt < TOUCH_MS) return;
  arrive(now);
}

export function dismissBriefing(now = Date.now()) {
  saveHomeVisit(dismissHomeBriefing(loadHomeVisit(), now));
  publish();
}

/** Installs the presence listeners for the main window; returns cleanup. */
export function trackPresence(): () => void {
  const onVisibility = () =>
    document.visibilityState === "hidden" ? leave() : arrive();
  const onLeave = () => leave();
  const onArrive = () => arrive();
  const input = { capture: true, passive: true } as const;
  window.addEventListener("focus", onArrive);
  window.addEventListener("blur", onLeave);
  window.addEventListener("pagehide", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointerdown", touch, input);
  window.addEventListener("keydown", touch, input);
  if (document.visibilityState !== "hidden") arrive();
  return () => {
    window.removeEventListener("focus", onArrive);
    window.removeEventListener("blur", onLeave);
    window.removeEventListener("pagehide", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pointerdown", touch, input);
    window.removeEventListener("keydown", touch, input);
    if (present) leave();
  };
}

/** Call once from the main window so time away is known before Home opens. */
export function usePresenceTracking() {
  useEffect(() => trackPresence(), []);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The briefing Home should show, if any, and how to dismiss it. Opening Home
 * counts as being here, so a return Aven did not see still opens one.
 */
export function useHomeBriefing(): {
  briefing: HomeBriefingWindow | null;
  dismiss: () => void;
} {
  useEffect(() => arrive(), []);
  const briefing = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const dismiss = useCallback(() => dismissBriefing(), []);
  return { briefing, dismiss };
}
