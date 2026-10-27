import { invoke } from "@tauri-apps/api/core";
import { IS_MAC } from "./platform";

/**
 * Turning Git on for a project so it can have a bot (see
 * src-tauri/src/project_git_setup.rs): `git init` when needed, a small
 * .gitignore when it has none, and one first commit of its files, all on
 * this computer. Nothing is uploaded.
 */
export type GitSetupResult = {
  /** Git was turned on for the folder. */
  started: boolean;
  /** The folder had no .gitignore, so one was written. */
  wroteIgnore: boolean;
  /** Files in the first commit; 0 when it already had one. */
  files: number;
};

export function setUpProjectGit(path: string): Promise<GitSetupResult> {
  return invoke<GitSetupResult>("project_git_setup", { path });
}

/** Why a project can't have a bot yet, when setting up Git would fix it. */
export type GitSetupNeed = "no-git" | "no-commit";

/** What a project's row says and offers, by what it needs. */
export const GIT_SETUP_WORDS: Record<
  GitSetupNeed,
  { note: string; action: string; busy: string }
> = {
  "no-git": {
    note: "Not using Git yet",
    action: "Set up Git",
    busy: "Setting up Git…",
  },
  "no-commit": {
    note: "Nothing saved in Git yet",
    action: "Make a first save",
    busy: "Making a first save…",
  },
};

/** The one line under the projects that need Git. */
export function botGitNote(mac = IS_MAC): string {
  return `Bots need Git to keep their own copy of your project. Set up Git turns it on for that project on ${mac ? "this Mac" : "this computer"}. Nothing is uploaded.`;
}

/** The host's reason, as one plain sentence. */
export function gitSetupError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error).trim();
  const line = text.split("\n")[0]?.trim() || "Couldn't set up Git.";
  return line.length > 240 ? `${line.slice(0, 239)}…` : line;
}
