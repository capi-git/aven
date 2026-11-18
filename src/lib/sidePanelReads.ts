import { subscribeGitChanged } from "./fs";
import { afterSidePanelOpens, SIDE_PANEL_FRESH_MS } from "./sidePanel";

/**
 * Reads the side panel makes as it shows (Git status and history, the pull
 * request, script hints). One that finished in the last 30 seconds, with no
 * Git change reported since, is not made again; the rest wait until the
 * panel has slid in (`afterSidePanelOpens`).
 */

const readAt = new Map<string, number>();
let watching = false;

/** A read for `key` finished: it is fresh for a while. */
export function noteSidePanelRead(key: string) {
  if (!watching) {
    watching = true;
    // Any Git change may make any of them out of date.
    subscribeGitChanged(() => readAt.clear());
  }
  readAt.set(key, Date.now());
}

/** True when a read for `key` finished recently and nothing has changed since. */
export function sidePanelReadFresh(key: string): boolean {
  const at = readAt.get(key);
  return at !== undefined && Date.now() - at < SIDE_PANEL_FRESH_MS;
}

/**
 * Run `read` as the panel shows: not at all when its last result is fresh,
 * otherwise once the panel has slid in. Returns a function that cancels a
 * read still waiting.
 */
export function readAsSidePanelShows(
  key: string,
  read: () => void,
): () => void {
  if (sidePanelReadFresh(key)) return () => undefined;
  return afterSidePanelOpens(read);
}

/** Only for tests: every read is due again. */
export function resetSidePanelReadsForTest() {
  readAt.clear();
}
