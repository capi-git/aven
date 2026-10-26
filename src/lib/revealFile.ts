import { message } from "@tauri-apps/plugin-dialog";
import { errorText, logError } from "./errors";
import { basename, inspectPaths, revealPath } from "./fs";

/**
 * Show `path` in Finder or File Explorer, and say so when that fails. A file
 * that is no longer there (moved, deleted, or a tab saved with a wrong path)
 * gets a plain sentence instead of the system's error.
 */
export function revealFile(path: string, context = "reveal file"): void {
  void revealPath(path).catch(async (error: unknown) => {
    const missing = await isMissing(path);
    if (!missing) logError(context, error);
    void message(
      missing
        ? `${basename(path)} isn't at that location anymore.`
        : errorText(error),
      { title: "Could not show the file", kind: missing ? "info" : "error" },
    ).catch(() => {});
  });
}

/** Known to be gone. False when the disk cannot be asked. */
async function isMissing(path: string): Promise<boolean> {
  try {
    return (await inspectPaths([path])).length === 0;
  } catch {
    return false;
  }
}
