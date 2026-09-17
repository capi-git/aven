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

export const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  supervised: "Supervised",
  "auto-accept-edits": "Auto-accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export const RUNTIME_MODE_HINT: Record<RuntimeMode, string> = {
  supervised: "Ask before commands and file changes.",
  "auto-accept-edits": "Auto-approve edits, ask before other actions.",
  auto: "Use the provider's automatic approval policy.",
  "full-access": "Allow commands and edits without prompts.",
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
}
