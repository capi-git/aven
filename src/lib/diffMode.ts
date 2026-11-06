/** How a diff lays out its two sides: one column, or old beside new. */
export type DiffMode = "unified" | "split";

const KEY = "aven.diff.layout";
const EVENT = "aven:diff-layout-changed";

export function loadDiffMode(): DiffMode {
  try {
    return localStorage.getItem(KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

export function saveDiffMode(mode: DiffMode) {
  try {
    if (mode === "split") localStorage.setItem(KEY, "split");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the choice lasts until the view closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeDiffMode(listener: () => void) {
  const onStorage = (storage: StorageEvent) => {
    if (!storage.key || storage.key === KEY) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const diffModeSetting = {
  load: loadDiffMode,
  subscribe: subscribeDiffMode,
  getServerSnapshot: (): DiffMode => "unified",
};
