/**
 * Which project's page Settings shows under Projects. Kept for the next time
 * Settings opens; any window's change reaches the others.
 */
const KEY = "aven.settingsProject";
const EVENT = "aven:settings-project-change";

export function loadSettingsProject(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveSettingsProject(path: string) {
  try {
    localStorage.setItem(KEY, path);
  } catch {
    /* private mode: this window only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSettingsProject(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === KEY) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
