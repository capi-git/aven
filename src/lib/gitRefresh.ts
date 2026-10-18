import { subscribeGitChanged } from "./fs";
import {
  isWindowActive,
  isWindowVisible,
  mayRefresh,
  subscribeWindowActivity,
  type RefreshReason,
} from "./windowActivity";

/**
 * Keep a Git-backed reader current by the one rule (see `mayRefresh`). It
 * reads once now if the window is on screen, then `refresh("event")` when
 * Git changes, when the window comes back on screen and when it gets focus
 * again, all whether it has focus or not; and `refresh("poll")` every
 * `pollMs`, only while it has focus. Returns a function that stops it.
 */
export function watchGitReader(
  refresh: (reason: RefreshReason) => void,
  pollMs: number,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let visible = isWindowVisible();
  let active = isWindowActive();
  const read = (reason: RefreshReason) => {
    if (!stopped && mayRefresh(reason)) refresh(reason);
  };
  const poll = () => {
    if (active) timer ??= setInterval(() => read("poll"), pollMs);
    else if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const onActivity = () => {
    const wasVisible = visible;
    const wasActive = active;
    visible = isWindowVisible();
    active = isWindowActive();
    poll();
    if ((visible && !wasVisible) || (active && !wasActive)) read("event");
  };
  const stopActivity = subscribeWindowActivity(onActivity);
  const stopGit = subscribeGitChanged(() => read("event"));
  // Subscribing reads the window's focus afresh.
  visible = isWindowVisible();
  active = isWindowActive();
  poll();
  read("event");
  return () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    stopActivity();
    stopGit();
  };
}
