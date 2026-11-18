import { invoke } from "@tauri-apps/api/core";

/**
 * Apps the bottom bar's Open in button can open a folder in: Finder,
 * terminals and editors that are installed, each with its own icon.
 */

export type OpenInApp = {
  id: string;
  name: string;
  /** A small PNG data URL, when macOS gave one. */
  icon: string | null;
};

/** The app chosen last, which the split button opens with one click. */
export const OPEN_IN_APP_KEY = "aven.openInApp";
export const DEFAULT_OPEN_IN_APP = "finder";

let listing: Promise<OpenInApp[]> | null = null;

/** Installed apps, asked once per window: icons take a moment to draw. */
export function openInApps(): Promise<OpenInApp[]> {
  listing ??= invoke<unknown>("open_in_apps").then(
    parseOpenInApps,
    (error: unknown) => {
      listing = null;
      throw error;
    },
  );
  return listing;
}

/** Keeps only well-formed rows, so an odd reply can never break the footer. */
export function parseOpenInApps(value: unknown): OpenInApp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { id, name, icon } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string") return [];
    return [{ id, name, icon: typeof icon === "string" ? icon : null }];
  });
}

export function openInApp(app: string, path: string): Promise<void> {
  return invoke<void>("open_in_app", { app, path });
}

export function loadOpenInApp(): string {
  try {
    return localStorage.getItem(OPEN_IN_APP_KEY) || DEFAULT_OPEN_IN_APP;
  } catch {
    return DEFAULT_OPEN_IN_APP;
  }
}

export function saveOpenInApp(app: string) {
  try {
    localStorage.setItem(OPEN_IN_APP_KEY, app);
  } catch {
    /* Only a default. */
  }
}

/** The remembered app if it is still installed, else the first (Finder). */
export function defaultOpenInApp(
  apps: readonly OpenInApp[],
  saved: string,
): OpenInApp | null {
  return apps.find((app) => app.id === saved) ?? apps[0] ?? null;
}
