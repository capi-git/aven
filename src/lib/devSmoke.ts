import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Aven Dev's real-app check (`scripts/dev-aven.py --smoke`). The native side
 * only enables it in debug builds, inside a throwaway folder the runner
 * created; everywhere else `loadDevSmoke` resolves to null and nothing here
 * runs.
 */
export type DevSmokeConfig = {
  /** An existing project folder for the check's task. */
  projectPath: string;
  /** Where the stand-in provider lives. */
  binDir: string;
  /** Present when this run is the speed test (`dev-aven.py --perf`). */
  perf?: Record<string, unknown>;
};

/** What the stand-in provider answers. */
export const SMOKE_REPLY = "AVEN_SMOKE_OK";
/** In the memory the stand-in writes when Aven's memory keeper calls it. */
export const SMOKE_KEEPER_WORD = "AVEN_KEEPER_OK";
/** In the Agreed list the stand-in writes when it sums up a discussion. */
export const SMOKE_WRAP_UP_WORD = "AVEN_WRAP_UP_OK";
/** In a message added to a discussion: the stand-in agrees and says it heard. */
export const SMOKE_JUMP_IN_WORD = "AVEN_SMOKE_JUMP_IN";
/** In the stand-in's reply when a relay carried the user's added message. */
export const SMOKE_HEARD_WORD = "AVEN_SMOKE_HEARD";
/** Workspace → floating sidebar: drive Settings and Back. */
export const SMOKE_OVERLAY_EVENT = "aven-dev-smoke-overlay";
/** Floating sidebar → workspace: how that went. */
export const SMOKE_OVERLAY_RESULT_EVENT = "aven-dev-smoke-overlay-result";

let config: DevSmokeConfig | null = null;

export function devSmokeConfig(): DevSmokeConfig | null {
  return config;
}

/**
 * Ask whether this run is the check. When it is, this page keeps its storage
 * in memory, so the run neither reads nor changes Aven Dev's saved choices,
 * and it starts from a finished setup with the stand-in Claude as default.
 */
export async function loadDevSmoke(): Promise<DevSmokeConfig | null> {
  // The speed test runs a production build made with VITE_AVEN_PERF=1;
  // release builds have neither flag and drop this code.
  if (
    !(import.meta.env.DEV || import.meta.env.VITE_AVEN_PERF === "1") ||
    !isTauri()
  )
    return null;
  try {
    config = (await invoke<DevSmokeConfig | null>("dev_smoke_config")) ?? null;
  } catch {
    config = null;
  }
  if (config) isolateStorage();
  return config;
}

export function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, String(value));
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

/** Starting choices for the check: no setup dialog, no tool updates. */
export const SMOKE_SEED: Record<string, string> = {
  "aven.providerSetup.v1": JSON.stringify({
    selected: ["claude"],
    finished: true,
  }),
  "monocode.lastModel": JSON.stringify({
    harness: "claude",
    model: "claude:sonnet-5",
  }),
  "aven.autoUpdateProviderTools": "false",
};

function isolateStorage() {
  for (const [name, seed] of [
    ["localStorage", SMOKE_SEED],
    ["sessionStorage", {}],
  ] as const) {
    Object.defineProperty(window, name, {
      configurable: true,
      value: memoryStorage(seed),
    });
  }
}

/** Resolve once `read` returns a value, or fail after `timeoutMs`. */
export function waitFor<T>(
  read: () => T | null | undefined | false,
  timeoutMs: number,
  what: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      let value: T | null | undefined | false;
      try {
        value = read();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${what}`));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

export type SmokeStep = { name: string; passed: boolean; detail?: string };

/** Report to the runner and quit the app. */
export function finishDevSmoke(
  steps: SmokeStep[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  return invoke("dev_smoke_finish", {
    result: { passed: steps.every((step) => step.passed), steps, ...extra },
  });
}
