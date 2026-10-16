import { invoke } from "@tauri-apps/api/core";

/**
 * Workspace windows open concealed (`window_reveal.rs`) and appear once this
 * page reports a frame drawn in its saved theme, so a launch goes straight to
 * the workspace instead of an empty window, a default colour, or the desktop
 * through empty glass. The native side shows the window anyway after a few
 * seconds, so a page that never gets this far still shows its error.
 */

/** When this page committed, drew and asked to be shown (epoch ms). */
export type RevealTiming = {
  committedAtEpochMs?: number;
  drawnAtEpochMs?: number;
  requestedAtEpochMs?: number;
  /** Whether WebKit treated the page as visible when it drew: false for a
   *  window that was covered or on another Space. */
  visibleWhenDrawn?: boolean;
};

const timing: RevealTiming = {};
let requested = false;

/** What this page reported, for Aven Dev's real-app check and speed test. */
export function windowRevealTiming(): RevealTiming {
  return { ...timing };
}

/** Ask once for this window to be shown now, such as for a startup error. */
export function revealWindow() {
  if (requested) return;
  requested = true;
  timing.requestedAtEpochMs = Date.now();
  void invoke("window_reveal").catch(() => {
    // A browser preview has no native window, and the native timeout shows
    // a window whose host cannot answer.
  });
}

/**
 * Resolve once the frame holding the current document has been drawn. The
 * second animation frame starts only after the first one's frame is drawn.
 * A hidden document gets no animation frames (such as a window that is still
 * hidden elsewhere than macOS), so it does not wait for them; `fallbackMs`
 * bounds the wait if frames stop for another reason.
 */
export function afterDrawnFrame(fallbackMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    if (
      typeof requestAnimationFrame !== "function" ||
      document.visibilityState === "hidden"
    ) {
      setTimeout(resolve, 0);
      return;
    }
    const fallback = setTimeout(resolve, fallbackMs);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        resolve();
      }),
    );
  });
}

/**
 * Show this window once its native appearance (glass tint or opaque colour)
 * is in place and a frame with the themed workspace has been drawn. Call in
 * the workspace's first commit.
 */
export function revealWhenDrawn(appearance: unknown): Promise<void> {
  timing.committedAtEpochMs ??= Date.now();
  return Promise.resolve(appearance)
    .catch(() => undefined)
    .then(() => afterDrawnFrame())
    .then(() => {
      timing.drawnAtEpochMs ??= Date.now();
      timing.visibleWhenDrawn ??= document.visibilityState === "visible";
      revealWindow();
    });
}
