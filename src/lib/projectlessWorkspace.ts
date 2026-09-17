import { invoke } from "@tauri-apps/api/core";
import { pathKey, slash } from "./paths";

const STORAGE_KEY = "monocode.projectlessWorkspaces.v1";
const pending = new Map<string, Promise<ProjectlessWorkspace>>();
const knownInThisWindow = new Map<string, string>();
let memoryVersion = 0;
let cachedRaw: string | null | undefined;
let cachedVersion = -1;
let cachedProfiles = new Map<string, string>();
let cachedPaths = new Map<string, string>();

export type ProjectlessWorkspace = { profileId: string; cwd: string };

function validProfileId(value: string): boolean {
  return (
    /^[A-Za-z0-9_-]{1,96}$/.test(value) &&
    !["__proto__", "prototype", "constructor"].includes(value)
  );
}

function validCwd(cwd: unknown, profileId: string): cwd is string {
  if (typeof cwd !== "string" || /[\x00-\x1f]/.test(cwd)) return false;
  const normalized = slash(cwd).replace(/\/+$/, "");
  return (
    (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) &&
    normalized.endsWith(`/projectless-workspaces/${profileId}`) &&
    !normalized.split("/").some((part) => part === "." || part === "..")
  );
}

function knownWorkspaces(): Map<string, string> {
  let stored: string | null | undefined;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // This window's fallback remains available when storage is blocked.
  }
  if (stored === cachedRaw && memoryVersion === cachedVersion)
    return cachedProfiles;
  const known = new Map<string, string>();
  try {
    const raw: unknown = JSON.parse(stored ?? "null");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [profileId, cwd] of Object.entries(raw)) {
        if (validProfileId(profileId) && validCwd(cwd, profileId)) {
          known.set(profileId, cwd);
        }
      }
    }
  } catch {
    // Native folder creation and this window still work without local storage.
  }
  for (const [id, cwd] of knownInThisWindow) known.set(id, cwd);
  cachedRaw = stored;
  cachedVersion = memoryVersion;
  cachedProfiles = known;
  cachedPaths = new Map([...known].map(([id, cwd]) => [pathKey(cwd), id]));
  return cachedProfiles;
}

/** Exact persisted paths make restored sessions recognizable before async setup. */
export function projectlessProfileForCwd(cwd: string): string | undefined {
  knownWorkspaces();
  return cachedPaths.get(pathKey(cwd));
}

/** Read-only restoration; this never creates a folder or invokes native code. */
export function projectlessCwdForProfile(
  profileId: string,
): string | undefined {
  return knownWorkspaces().get(profileId);
}

export function isProjectlessCwd(cwd: string): boolean {
  return projectlessProfileForCwd(cwd) !== undefined;
}

/**
 * Prepare a durable scratch cwd on demand. Native code chooses the path; the
 * cache is only UI metadata and never authorizes a caller-supplied folder.
 * Capture profileId before awaiting this function so profile switches cannot
 * retarget an in-flight New session action. This does not start a provider.
 */
export function ensureProjectlessWorkspace(
  profileId: string,
): Promise<ProjectlessWorkspace> {
  if (!validProfileId(profileId)) {
    return Promise.reject(new Error("Invalid workspace identity."));
  }
  const existing = pending.get(profileId);
  if (existing) return existing;
  const request = invoke<string>("projectless_cwd", { profileId }).then(
    (cwd) => {
      if (!validCwd(cwd, profileId)) {
        throw new Error("The app returned an invalid session folder.");
      }
      knownInThisWindow.set(profileId, cwd);
      memoryVersion += 1;
      try {
        const serialized = JSON.stringify(
          Object.fromEntries(knownWorkspaces()),
        );
        localStorage.setItem(STORAGE_KEY, serialized);
        if (localStorage.getItem(STORAGE_KEY) === serialized) {
          knownInThisWindow.delete(profileId);
          memoryVersion += 1;
        }
      } catch {
        // The current window retains the mapping if storage is unavailable.
      }
      return { profileId, cwd };
    },
  );
  pending.set(profileId, request);
  void request.then(
    () => pending.delete(profileId),
    () => pending.delete(profileId),
  );
  return request;
}
