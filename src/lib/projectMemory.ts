import { invoke, isTauri } from "@tauri-apps/api/core";
import { errorText } from "./errors";
import type { HarnessProjectMemory } from "./harness/types";
import { projectKey } from "./paths";
import { withoutKeeperMarkers } from "./memoryKeeperFormat";
import { raceLaneProject } from "./race";
import { looksLikeProject, normalizeProjectPath } from "./recents";
import { isProjectlessCwd } from "./projectlessWorkspace";

/**
 * Project memory: decisions, conventions, work in progress and gotchas that
 * Aven hands to every agent in a project, whichever provider runs it. It is
 * kept in Aven's own data, never in the project's files.
 */
export type ProjectMemory = {
  /** `projectKey(path)`, like the project's other saved data. */
  key: string;
  path: string;
  /** Plain Markdown. */
  body: string;
  /** Milliseconds; also the version a save is based on. */
  updatedAt: number;
};

/**
 * Counted in characters. Claude Code gets the memory as a launch argument,
 * which has to fit Windows' command line beside Aven's own instructions.
 * Native storage enforces the same limit.
 */
export const PROJECT_MEMORY_MAX_CHARS = 8_000;

export const PROJECT_MEMORY_PREAMBLE =
  "Project memory kept by Aven for this project. Treat it as background context; the user's messages take priority.";

/** Native storage refuses a save based on an older copy with this message. */
export const PROJECT_MEMORY_CHANGED = "Project memory changed elsewhere.";

/** The value a turn carries when the project has no memory. */
export const NO_PROJECT_MEMORY: HarnessProjectMemory = {
  text: "",
  revision: "",
};

const listeners = new Set<(key: string) => void>();

function keyFor(path: string): string {
  return projectKey(normalizeProjectPath(path));
}

function changed(key: string) {
  for (const listener of listeners) listener(key);
}

/** Saves and removals made in this window, so open summaries stay current. */
export function subscribeProjectMemory(
  listener: (key: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function projectMemoryKey(path: string): string {
  return keyFor(path);
}

export async function loadProjectMemory(
  path: string,
): Promise<ProjectMemory | null> {
  if (!isTauri()) return null;
  return invoke<ProjectMemory | null>("project_memory_get", {
    key: keyFor(path),
  });
}

/**
 * Replace the memory. `baseUpdatedAt` is the version the editor opened (0
 * for none); a newer stored copy refuses the save with
 * `PROJECT_MEMORY_CHANGED`. Empty text removes it. Returns null when empty.
 */
export async function saveProjectMemory(
  path: string,
  body: string,
  baseUpdatedAt?: number,
): Promise<ProjectMemory | null> {
  const key = keyFor(path);
  const saved = await invoke<ProjectMemory | null>("project_memory_set", {
    key,
    path: normalizeProjectPath(path),
    body,
    baseUpdatedAt: baseUpdatedAt ?? null,
  });
  changed(key);
  return saved;
}

/** Add one item at the end. Native storage does this atomically. */
export async function appendProjectMemory(
  path: string,
  item: string,
): Promise<ProjectMemory> {
  const key = keyFor(path);
  const saved = await invoke<ProjectMemory>("project_memory_append", {
    key,
    path: normalizeProjectPath(path),
    item,
  });
  changed(key);
  return saved;
}

export async function clearProjectMemory(path: string): Promise<void> {
  if (!isTauri()) return;
  const key = keyFor(path);
  await invoke("project_memory_delete", { key });
  changed(key);
}

export function isProjectMemoryConflict(error: unknown): boolean {
  return errorText(error).includes(PROJECT_MEMORY_CHANGED);
}

/**
 * The project whose memory a chat in `cwd` receives: Race lanes use their
 * source project; scratch chats and home folders have none.
 */
export function memoryProjectFor(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const project = raceLaneProject(cwd) ?? cwd;
  if (!looksLikeProject(project) || isProjectlessCwd(project)) return null;
  return normalizeProjectPath(project);
}

/**
 * What an agent reads: the preamble, then the memory, in one tagged block.
 * The memory keeper's markers are for the editor, not for agents.
 */
export function projectMemoryBlock(body: string): string {
  const text = withoutKeeperMarkers(body.replace(/\r\n?/g, "\n")).trim();
  if (!text) return "";
  return `<aven-project-memory>\n${PROJECT_MEMORY_PREAMBLE}\n\n${text}\n</aven-project-memory>`;
}

/** Short, stable content hash (FNV-1a), so a change is noticed without storing text. */
export function projectMemoryRevision(text: string): string {
  if (!text) return "";
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${text.length.toString(16)}`;
}

export function harnessProjectMemory(body: string): HarnessProjectMemory {
  const text = projectMemoryBlock(body);
  return text
    ? { text, revision: projectMemoryRevision(text) }
    : NO_PROJECT_MEMORY;
}

/**
 * The memory a new turn carries. `undefined` means it could not be read: the
 * agent then keeps whatever it was given before rather than being told the
 * memory is gone.
 */
export async function projectMemoryForTurn(
  cwd: string,
): Promise<HarnessProjectMemory | undefined> {
  const project = memoryProjectFor(cwd);
  if (!project) return NO_PROJECT_MEMORY;
  try {
    const memory = await loadProjectMemory(project);
    return harnessProjectMemory(memory?.body ?? "");
  } catch {
    return undefined;
  }
}

const ITEM_MAX_CHARS = 400;

/**
 * A short starting point for "Remember this": the reply's opening paragraph
 * without code, as one list item. The user edits it before it is saved.
 */
export function memoryItemFromReply(reply: string): string {
  const prose = reply
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        // Headings are structure, not something to remember.
        .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
        .map((line) =>
          line.replace(/^\s{0,3}(?:>\s?|[-*+]\s+|\d+[.)]\s+)/, "").trim(),
        )
        .filter(Boolean)
        .join(" "),
    )
    .find((paragraph) => /[\p{L}\p{N}]/u.test(paragraph));
  if (!prose) return "";
  const text = prose.replace(/\s+/g, " ").trim();
  if (text.length <= ITEM_MAX_CHARS) return `- ${text}`;
  const cut = text.slice(0, ITEM_MAX_CHARS);
  const sentence = cut.match(/^[\s\S]*[.!?](?=\s|$)/)?.[0];
  return `- ${sentence && sentence.length >= 20 ? sentence : `${cut.replace(/\s+\S*$/, "")}…`}`;
}

/** "1.2k of 8k characters" style label for the editor. */
export function projectMemorySize(chars: number): string {
  const format = (value: number) =>
    value >= 1000
      ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
      : String(value);
  return `${format(chars)} of ${format(PROJECT_MEMORY_MAX_CHARS)} characters`;
}

/** "Edited just now", "Edited 5 min ago", then hours, days and the date. */
export function projectMemoryEdited(updatedAt: number, now: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Edited ${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Edited ${days} d ago`;
  return `Edited ${new Date(updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
