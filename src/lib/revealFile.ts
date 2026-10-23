import { message } from "@tauri-apps/plugin-dialog";
import { errorText, logError } from "./errors";
import { revealPath } from "./fs";

/** Show `path` in Finder or File Explorer, and say so when that fails. */
export function revealFile(path: string, context = "reveal file"): void {
  void revealPath(path).catch((error: unknown) => {
    logError(context, error);
    void message(errorText(error), {
      title: "Could not show the file",
      kind: "error",
    }).catch(() => {});
  });
}
