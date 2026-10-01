import { HARNESSES, type HarnessId } from "./session";

export type ProviderSetupPlatform = "macos" | "windows" | "linux";
export type ProviderSetupStatus =
  "missing" | "installed" | "signInRequired" | "ready" | "error";

export type ProviderSetupCheck = {
  harness: HarnessId;
  platform: ProviderSetupPlatform;
  status: ProviderSetupStatus;
  version: string | null;
  message: string;
};

export type ProviderSetupPlan = {
  harness: HarnessId;
  platform: ProviderSetupPlatform;
  action: "install" | "signIn";
  command: string | null;
  displayCommand?: string | null;
  docsUrl: string;
  message: string;
};

export type ProviderSetupState = {
  /** Provider choices are explicit, including when a CLI is already installed. */
  selected: HarnessId[];
  /** Completed or deferred; Settings can always open setup again. */
  finished: boolean;
};

export const PROVIDER_SETUP_KEY = "aven.providerSetup.v1";
const PROVIDER_SETUP_CHANGED = "aven:provider-setup-changed";
const knownHarnesses: ReadonlySet<string> = new Set(HARNESSES);

function normalizeProviderSetup(value: unknown): ProviderSetupState {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const selected = Array.isArray(record.selected)
    ? record.selected.filter(
        (harness): harness is HarnessId =>
          typeof harness === "string" && knownHarnesses.has(harness),
      )
    : [];
  return {
    selected: [...new Set(selected)],
    finished: record.finished === true,
  };
}

/** Only choices and deferral survive restart. Readiness is checked each visit. */
export function loadProviderSetup(): ProviderSetupState {
  try {
    const saved = localStorage.getItem(PROVIDER_SETUP_KEY);
    return normalizeProviderSetup(saved ? JSON.parse(saved) : null);
  } catch {
    return normalizeProviderSetup(null);
  }
}

/** Never stores authentication, CLI output, or the last readiness check. */
export function saveProviderSetup(state: ProviderSetupState): boolean {
  try {
    localStorage.setItem(
      PROVIDER_SETUP_KEY,
      JSON.stringify(normalizeProviderSetup(state)),
    );
  } catch {
    return false;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROVIDER_SETUP_CHANGED));
  }
  return true;
}

/** Existing workspaces keep their launch flow; fresh installs can defer setup. */
export function shouldOfferProviderSetup(hasExistingWork: boolean): boolean {
  return !hasExistingWork && !loadProviderSetup().finished;
}

/** Synchronize Settings and setup, including separate Aven windows. */
export function subscribeProviderSetup(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROVIDER_SETUP_KEY || event.key === null) listener();
  };
  window.addEventListener(PROVIDER_SETUP_CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PROVIDER_SETUP_CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}
