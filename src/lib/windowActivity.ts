import { getCurrentWindow } from "@tauri-apps/api/window";

const listeners = new Set<() => void>();
let focused = true;
let generation = 0;
let stop: (() => void) | undefined;

/** Native window focus includes an embedded browser owning keyboard focus. */
export function isWindowActive() {
  return !document.hidden && focused;
}

/** On screen, focused or not: behind another app or on a second screen. */
export function isWindowVisible() {
  return !document.hidden;
}

/**
 * Why a Git-backed reader wants to read again: `event` when something said
 * Git changed (a turn ended, Ship it, Keep, a commit) or the reader just
 * opened, `poll` for its own periodic check.
 */
export type RefreshReason = "event" | "poll";

/**
 * The one rule for Git-backed readers: an event refreshes once whenever the
 * window is on screen, focused or not, so a window watched from a second
 * screen never goes stale; polling waits for focus, so a window at rest
 * stays quiet.
 */
export function mayRefresh(reason: RefreshReason): boolean {
  return reason === "event" ? isWindowVisible() : isWindowActive();
}

/** Share one native focus listener across pollers; web previews use DOM focus. */
export function subscribeWindowActivity(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    const current = ++generation;
    const native = "__TAURI_INTERNALS__" in window;
    focused = document.hasFocus();
    let focusRevision = 0;
    let unlisten: (() => void) | undefined;
    const notify = () => {
      for (const subscriber of listeners) subscriber();
    };
    const acceptFocus = (value: boolean) => {
      if (current !== generation) return;
      focusRevision += 1;
      focused = value;
      notify();
    };
    const onFocus = () => {
      if (!native) acceptFocus(true);
    };
    const onBlur = () => {
      if (!native) acceptFocus(false);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", notify);
    if (native) {
      const nativeWindow = getCurrentWindow();
      void nativeWindow
        .onFocusChanged(({ payload }) => acceptFocus(payload))
        .then((off) => {
          if (current !== generation) off();
          else unlisten = off;
        })
        .catch(() => {});
      const revision = focusRevision;
      void nativeWindow
        .isFocused()
        .then((value) => {
          if (revision === focusRevision) acceptFocus(value);
        })
        .catch(() => {});
    }
    stop = () => {
      generation += 1;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", notify);
    };
  }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = undefined;
    }
  };
}
