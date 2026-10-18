export type RuntimeMode =
  "supervised" | "auto-accept-edits" | "auto" | "full-access";

export const RUNTIME_MODES: RuntimeMode[] = [
  "supervised",
  "auto-accept-edits",
  "auto",
  "full-access",
];

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "supervised";
export const DEFAULT_RUNTIME_MODE_KEY = "monocode.defaultRuntimeMode";
const DEFAULT_RUNTIME_MODE_CHANGE = "aven:default-runtime-mode-change";

export const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  supervised: "Ask first",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export const RUNTIME_MODE_HINT: Record<RuntimeMode, string> = {
  supervised: "Asks before running commands or changing files.",
  "auto-accept-edits":
    "Edits files without asking; asks before riskier actions.",
  auto: "Safe actions run without asking; riskier ones are checked first.",
  "full-access": "Never asks. Use with care.",
};

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return (
    typeof value === "string" && RUNTIME_MODES.includes(value as RuntimeMode)
  );
}

/** Only an explicit access selection changes the default for new tasks. */
export function loadDefaultRuntimeMode(): RuntimeMode {
  try {
    const saved = localStorage.getItem(DEFAULT_RUNTIME_MODE_KEY);
    return isRuntimeMode(saved) ? saved : DEFAULT_RUNTIME_MODE;
  } catch {
    return DEFAULT_RUNTIME_MODE;
  }
}

/** This is an app preference; provider-global configuration is never changed. */
export function saveDefaultRuntimeMode(mode: RuntimeMode): void {
  if (!isRuntimeMode(mode)) return;
  try {
    localStorage.setItem(DEFAULT_RUNTIME_MODE_KEY, mode);
  } catch {
    // The current task can still use the selected mode if storage is unavailable.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(DEFAULT_RUNTIME_MODE_CHANGE));
  }
}

/** Keep Settings and every workspace header on the same saved preference. */
export function subscribeDefaultRuntimeMode(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEFAULT_RUNTIME_MODE_KEY || event.key === null)
      listener();
  };
  window.addEventListener(DEFAULT_RUNTIME_MODE_CHANGE, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(DEFAULT_RUNTIME_MODE_CHANGE, listener);
    window.removeEventListener("storage", onStorage);
  };
}
