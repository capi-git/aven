import { serverIdentity, type DevPreview } from "./devPreviews";
import { isEqualOrInside } from "./paths";
import type { RaceRecord } from "./race";
import { raceLaneName } from "./raceLanes";
import { possessive } from "./words";

/**
 * Whose version of a running race a page shows: "Codex's version" when the
 * dev server serving `url` was started by a race agent or runs in its own
 * copy of the project. Undefined for any other page, and once the race is
 * over (its copies are gone).
 */
export function racePreviewLabel(
  url: string,
  previews: readonly DevPreview[],
  races: readonly RaceRecord[],
): string | undefined {
  const server = serverIdentity(url);
  if (!server) return undefined;
  const preview = previews.find(
    (entry) => entry.status === "live" && serverIdentity(entry.url) === server,
  );
  if (!preview) return undefined;
  for (const race of races) {
    if (race.state !== "running") continue;
    const lane = race.lanes.findIndex(
      (entry) =>
        (!!preview.sessionId && entry.sessionId === preview.sessionId) ||
        isEqualOrInside(preview.folder || preview.cwd, entry.path),
    );
    if (lane >= 0) return `${possessive(raceLaneName(race, lane))} version`;
  }
  return undefined;
}

/** A page's tab title with whose race version it shows, when it does. */
export function racePreviewTitle(title: string, label?: string): string {
  return label ? `${title} · ${label}` : title;
}
