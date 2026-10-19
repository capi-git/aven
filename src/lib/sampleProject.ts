import { invoke } from "@tauri-apps/api/core";

/** Where Aven keeps the walkthrough's sample, inside its own data folder. */
const SAMPLE_SUFFIX = "/sample-projects/sample-site";

/** What the sample's first message suggests. */
export const SAMPLE_FIRST_MESSAGE = "Make the heading bigger";

/**
 * Make the tiny sample website (index.html, style.css and a README, with one
 * first commit) in Aven's own data folder, or reuse the one already there.
 * Resolves to its folder; nothing else on the computer is touched.
 */
export function createSampleProject(): Promise<string> {
  return invoke<string>("create_sample_project");
}

/** Is `path` the walkthrough's sample? */
export function isSampleProject(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.endsWith(SAMPLE_SUFFIX);
}

/** What Getting started's "Preview it" asks the agent. */
export const PREVIEW_MESSAGE = "Open a preview beside the chat";
