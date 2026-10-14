import { SETTINGS } from "./settingDefinitions";
import { HAS_NATIVE_GLASS } from "./platform";
import type { SettingsSectionId } from "./settings";

export type SettingsSearchResult = {
  id: string;
  label: string;
  description: string;
  section: SettingsSectionId;
};

export { settingSearchAnchor } from "./settingsRegistry";

// Index actual controls and stable page/card anchors, never hidden child controls.
const SETTINGS_SEARCH_ENTRIES = Object.values(SETTINGS);

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Empty or unrelated queries have no results; every search term must match. */
export function searchSettings(query: string): SettingsSearchResult[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(/\s+/);

  return SETTINGS_SEARCH_ENTRIES.flatMap((entry) => {
    if (entry.nativeGlass && !HAS_NATIVE_GLASS) return [];
    const label = normalize(entry.label);
    const description = normalize(entry.description);
    const words = normalize(
      `${entry.label} ${entry.description} ${entry.keywords}`,
    ).split(" ");
    if (!terms.every((term) => words.some((word) => word.startsWith(term))))
      return [];

    const score =
      (label === normalized ? 100 : 0) +
      (label.startsWith(normalized) ? 40 : 0) +
      terms.reduce(
        (total, term) =>
          total +
          (label.includes(term) ? 10 : description.includes(term) ? 3 : 1),
        0,
      );
    const { id, description: resultDescription, section } = entry;
    return [
      {
        result: {
          id,
          label: entry.label,
          description: resultDescription,
          section,
        },
        score,
      },
    ];
  })
    .sort(
      (a, b) =>
        b.score - a.score || a.result.label.localeCompare(b.result.label),
    )
    .map(({ result }) => result);
}

type AnchorListener = (id: string, section: SettingsSectionId) => void;
const anchorListeners = new Set<AnchorListener>();

/** The sidebar search asks the open settings page to reveal a result. */
export function requestSettingsAnchor(id: string, section: SettingsSectionId) {
  for (const listener of anchorListeners) listener(id, section);
}

export function subscribeSettingsAnchor(listener: AnchorListener) {
  anchorListeners.add(listener);
  return () => {
    anchorListeners.delete(listener);
  };
}
