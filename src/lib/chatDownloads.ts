import { invoke, isTauri } from "@tauri-apps/api/core";
import { failureText, logError } from "./errors";
import { pathKey, slash } from "./paths";
import { revealFile } from "./revealFile";

/** What a click on a download link has done so far, per agent file. */
export type ChatDownload =
  | { state: "saving" }
  | {
      state: "saved";
      /** The copy in Downloads. */
      path: string;
      /** Its name there: the agent's, or with " (1)" when that was taken. */
      name: string;
      /** False for a program or script, which opening would run. */
      openable: boolean;
    }
  | { state: "failed"; error: string };

type SavedCopy = { path: string; name: string; openable: boolean };

/** Where `.aven` starts in a path's parts, before its `files`; -1 when none. */
function avenFilesAt(parts: readonly string[]): number {
  return parts.findIndex(
    (part, index) => part === ".aven" && parts[index + 1] === "files",
  );
}

/** True for a file inside a `.aven/files` folder (or a folder under it). */
export function isAgentMadeFile(path: string): boolean {
  const parts = slash(path).split("/");
  const at = avenFilesAt(parts);
  return (
    at >= 0 &&
    parts.length > at + 2 &&
    !!parts[parts.length - 1] &&
    !parts.some((part) => part === "." || part === "..")
  );
}

/**
 * Where this chat's agent saves files for the user. Nothing is made: once
 * the folder is there, the app keeps the ignore file beside it. Undefined
 * outside the desktop app or when the project folder is gone.
 */
export async function agentFilesFolder(
  cwd: string | undefined,
): Promise<string | undefined> {
  if (!cwd || !isTauri()) return undefined;
  try {
    return await invoke<string>("agent_files_folder", { cwd });
  } catch (error) {
    logError("prepare agent files folder", error);
    return undefined;
  }
}

/** The per-turn note telling an agent where made files go and how to link them. */
export function agentFilesInstructions(folder: string): string {
  const sample = `${folder.replace(/[\\/]+$/, "")}${folder.includes("\\") && !folder.includes("/") ? "\\" : "/"}Report.pdf`;
  return `<aven-files>When you make a file for the user to keep (an export, PDF, image, spreadsheet, archive and so on), save it in ${folder} unless they name another place, not in Downloads or on the Desktop. If that folder isn't there yet, make it, with a .gitignore file in it that holds just *, so Git leaves it alone. Zip a folder first. Then link it in your reply as a Markdown link with its absolute path, such as [Report.pdf](<${sample}>). Aven shows it as a link that saves a copy to their Downloads folder when they click it, so don't say where the file is or offer to open it.</aven-files>`;
}

/** Projects whose agent files folder was checked for its ignore file. */
const keptOut = new Set<string>();

/**
 * Once an agent hands over a file (its link shows in the chat), make sure
 * Git leaves its folder alone: the app adds the folder's ignore file if the
 * agent didn't. Once per project per run; quiet when it can't.
 */
export function keepAgentFilesOutOfGit(path: string): void {
  if (!isTauri() || !isAgentMadeFile(path)) return;
  const parts = slash(path).split("/");
  const cwd = parts.slice(0, avenFilesAt(parts)).join("/");
  if (!cwd || keptOut.has(pathKey(cwd))) return;
  keptOut.add(pathKey(cwd));
  void agentFilesFolder(cwd);
}

const downloads = new Map<string, ChatDownload>();
const listeners = new Set<() => void>();

function key(path: string): string {
  return pathKey(path);
}

function set(path: string, next: ChatDownload | undefined) {
  if (next) downloads.set(key(path), next);
  else downloads.delete(key(path));
  for (const listener of listeners) listener();
}

/** The latest download of the agent file at `path` in this run of Aven. */
export function chatDownload(path: string): ChatDownload | undefined {
  return downloads.get(key(path));
}

export function subscribeChatDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Save a copy of the agent's file at `path` into Downloads. Clicking again
 * once it is saved saves another copy, as a browser does; a click while one
 * is still saving does nothing.
 */
export async function downloadAgentFile(path: string): Promise<void> {
  if (chatDownload(path)?.state === "saving") return;
  set(path, { state: "saving" });
  try {
    const saved = await invoke<SavedCopy>("agent_file_download", { path });
    set(path, { state: "saved", ...saved });
  } catch (error) {
    set(path, {
      state: "failed",
      error: failureText(error, "The download didn't finish. Try again."),
    });
  }
}

/**
 * Open the saved copy in its usual app. False when it couldn't: the reason
 * then replaces the download, for the link's popup to say.
 */
export async function openChatDownload(source: string): Promise<boolean> {
  const current = chatDownload(source);
  if (current?.state !== "saved" || !current.openable) return false;
  try {
    await invoke<void>("agent_download_open", { path: current.path });
    return true;
  } catch (error) {
    set(source, {
      state: "failed",
      error: failureText(error, `Couldn't open ${current.name}.`),
    });
    return false;
  }
}

/** Show the saved copy in Finder or File Explorer. */
export function revealChatDownload(source: string): void {
  const current = chatDownload(source);
  if (current?.state === "saved")
    revealFile(current.path, "reveal chat download");
}

/** Forget every download (tests only). */
export function resetChatDownloadsForTests(): void {
  downloads.clear();
  keptOut.clear();
  for (const listener of listeners) listener();
}
