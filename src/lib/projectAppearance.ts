import { projectKey, projectName } from "./paths";
import { projectLogoSrc } from "./projectLogos";
import { currentMascotName, projectMascot } from "./projectMascots";
import { isProjectlessCwd } from "./projectlessWorkspace";
import {
  PROJECT_APPEARANCE_CHANGED,
  PROJECT_APPEARANCE_STORAGE_KEYS,
  TAB_GROUP_COLORS,
  TAB_GROUP_LABELS_CHANGED,
  TAB_GROUP_LOGOS_CHANGED,
  TAB_GROUP_LOGO_STORAGE_KEY,
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupLogos,
  loadTabGroupMascots,
  notifyTabGroupLogosChanged,
  resolveTabGroupColor,
  resolveTabGroupColorIndex,
  resolveTabGroupCustomColor,
  tabGroupColor,
} from "./tabGroups";

/** How one project looks wherever Aven shows it: sidebar, tabs, browser. */
export type ProjectAppearance = {
  /** Saved-appearance key, `projectKey(path)`. */
  key: string;
  /** Display name: the saved label, or the folder name. */
  label: string;
  /** The saved label alone, for editing; null shows the folder name. */
  customLabel: string | null;
  /** Resolved colour: custom hex, palette pick, or the one hashed from the name. */
  color: string;
  /** Palette pick, or null for a custom or automatic colour. */
  colorIndex: number | null;
  customColor: string | null;
  /** Palette index of the colour shown when nothing is picked. */
  automaticColorIndex: number;
  logoPath: string | null;
  /** Image URL for `logoPath`, refreshed when the logo file is replaced. */
  logoSrc: string | null;
  /** Mascot shown: the saved pick, or the one hashed from the name. */
  mascot: string;
  /** The saved pick, an old sprite's name read as today's critter. */
  mascotOverride: string | null;
};

type Records = {
  colors: Record<string, number>;
  customColors: Record<string, string>;
  labels: Record<string, string>;
  logos: Record<string, string>;
  mascots: Record<string, string>;
};

let revision = 0;
let records: Records | null = null;
let recordsStore: unknown = null;
let resolved = new Map<string, ProjectAppearance>();
let previous = new Map<string, ProjectAppearance>();
const listeners = new Set<() => void>();
let watching = false;

function currentStore(): unknown {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function invalidate() {
  revision += 1;
  records = null;
  // Keep the last values so an unchanged project keeps its object, and with it
  // every mark that shows it skips the re-render.
  for (const [path, value] of resolved) previous.set(path, value);
  resolved = new Map();
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  const key = event.key;
  if (key !== null && !PROJECT_APPEARANCE_STORAGE_KEYS.includes(key)) return;
  // Another window replaced a logo: bump the image revision here too, so a file
  // saved at the same path is not served from cache. That event invalidates.
  if (key === null || key === TAB_GROUP_LOGO_STORAGE_KEY)
    notifyTabGroupLogosChanged();
  else invalidate();
}

function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener(PROJECT_APPEARANCE_CHANGED, invalidate);
  window.addEventListener(TAB_GROUP_LABELS_CHANGED, invalidate);
  window.addEventListener(TAB_GROUP_LOGOS_CHANGED, invalidate);
  window.addEventListener("storage", onStorage);
}

/** The cache is trusted only while change events are heard, and per storage. */
function ready() {
  watch();
  if (records === null || recordsStore === currentStore()) return;
  // A replaced storage object (tests, or storage lost) cannot share a cache.
  records = null;
  resolved = new Map();
  previous = new Map();
}

function sameRecord(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

let lastLabels: Record<string, string> = {};

function loadRecords(): Records {
  if (records) return records;
  const store = currentStore();
  const labels = loadTabGroupLabels();
  // Label readers (tab titles, rows) only re-render when a label changed.
  if (recordsStore !== store || !sameRecord(labels, lastLabels))
    lastLabels = labels;
  recordsStore = store;
  records = {
    colors: loadTabGroupColors(),
    customColors: loadTabGroupCustomColors(),
    labels: lastLabels,
    logos: loadTabGroupLogos(),
    mascots: loadTabGroupMascots(),
  };
  return records;
}

function sameAppearance(a: ProjectAppearance, b: ProjectAppearance): boolean {
  return (
    a.key === b.key &&
    a.label === b.label &&
    a.customLabel === b.customLabel &&
    a.color === b.color &&
    a.colorIndex === b.colorIndex &&
    a.customColor === b.customColor &&
    a.automaticColorIndex === b.automaticColorIndex &&
    a.logoPath === b.logoPath &&
    a.logoSrc === b.logoSrc &&
    a.mascot === b.mascot &&
    a.mascotOverride === b.mascotOverride
  );
}

/** Pure resolution from saved records; exported for tests and previews. */
export function resolveProjectAppearance(
  path: string,
  saved: Records,
): ProjectAppearance {
  const key = projectKey(path);
  const name = projectName(path);
  const customLabel = saved.labels[key]?.trim() || null;
  const savedMascot = saved.mascots[key];
  const mascotOverride =
    savedMascot == null ? null : currentMascotName(savedMascot);
  const logoPath = saved.logos[key] ?? null;
  const automatic = tabGroupColor(name);
  return {
    key,
    label: customLabel ?? name,
    customLabel,
    color: resolveTabGroupColor(key, saved.colors, saved.customColors, name),
    colorIndex: resolveTabGroupColorIndex(
      key,
      saved.colors,
      saved.customColors,
    ),
    customColor: resolveTabGroupCustomColor(key, saved.customColors),
    automaticColorIndex: Math.max(
      0,
      (TAB_GROUP_COLORS as readonly string[]).indexOf(automatic),
    ),
    logoPath,
    logoSrc: projectLogoSrc(logoPath),
    mascot: projectMascot(name, mascotOverride).name,
    mascotOverride,
  };
}

/** Whether a folder has a project identity at all (home and scratch do not). */
export function hasProjectAppearance(
  path: string | null | undefined,
): path is string {
  return !!path && path !== "~" && !isProjectlessCwd(path);
}

/**
 * The project's resolved appearance. Saved records are parsed once per change,
 * and an unchanged project returns the same object, so this is cheap to call on
 * every render and safe as a `useSyncExternalStore` snapshot.
 */
export function projectAppearance(path: string): ProjectAppearance {
  ready();
  const cached = resolved.get(path);
  if (cached) return cached;
  let next = resolveProjectAppearance(path, loadRecords());
  const before = previous.get(path);
  if (before && sameAppearance(before, next)) next = before;
  previous.delete(path);
  resolved.set(path, next);
  return next;
}

/** Changes whenever saved appearance may have changed, in this or another window. */
export function projectAppearanceRevision(): number {
  return revision;
}

export function subscribeProjectAppearance(listener: () => void): () => void {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Saved labels, shared with `useProjectLabels`; identity changes only with them. */
export function projectLabelRecords(): Record<string, string> {
  ready();
  return loadRecords().labels;
}
