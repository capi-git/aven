import { localDevAddress } from "./devServerUrls";

/** How long a page may load before Aven says it is slow. */
export const SLOW_PAGE_MS = 20_000;

/**
 * Past this share of its load the page is showing: what still loads is
 * video, live data or trackers, which some sites never finish.
 */
const SHOWING_PROGRESS = 0.5;

/**
 * What to say when a page has loaded for `SLOW_PAGE_MS`, or null when it is
 * already showing and only background requests keep it "loading".
 */
export function slowPageNotice(
  url: string,
  progress: number | null,
): string | null {
  if (progress != null && progress >= SHOWING_PROGRESS) return null;
  return localDevAddress(url)
    ? "This page is taking longer to load. Check that the local server is running; the preview will keep loading."
    : "This page is taking longer to load. It will keep loading.";
}
