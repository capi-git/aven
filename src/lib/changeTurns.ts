import type { GitChangedFile } from "./fs";
import { isEditTool } from "./harness/preview";
import { isEqualOrInside, pathKey, resolveWorkspacePath } from "./paths";
import { sessionWorkCwd, type Block, type Session } from "./session";
import { sessionForShip } from "./turnTests";

/** One message you sent, and the changed files its turn edited last. */
export type ChangeTurn = {
  id: string;
  /** The message's first line. */
  label: string;
  /** When the turn started (epoch ms), if known. */
  at?: number;
  files: GitChangedFile[];
};

export type ChangeTurns = {
  /** Newest first; turns with no changed file left are not listed. */
  turns: ChangeTurn[];
  /** Changed files no turn of the chat edited. */
  other: GitChangedFile[];
};

const EDIT_TITLE = /^(?:edit|write|update|create|delete)\s+(.+)$/i;

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** The file a tool block edited, as an absolute path or one relative to `cwd`. */
function editedPath(block: Block): string | null {
  const tool = block.tool;
  if (!tool || !isEditTool(tool.kind, tool.title, tool.preview)) return null;
  const raw =
    tool.preview?.path?.trim() ||
    EDIT_TITLE.exec(tool.title?.trim() ?? "")?.[1]?.trim() ||
    "";
  return raw || null;
}

/**
 * Groups changed files under the turn of `blocks` that edited each one last.
 * A file edited in several turns sits under the newest of them; a file no
 * edit reached goes to `other`.
 */
export function groupChangesByTurn(
  blocks: readonly Block[],
  cwd: string,
  files: readonly GitChangedFile[],
): ChangeTurns {
  type Turn = { id: string; label: string; at?: number };
  const turns: Turn[] = [];
  /** Path key (absolute) or relative path -> index into `turns`. */
  const lastTurn = new Map<string, number>();
  for (const block of blocks) {
    if (block.role === "user" && !block.internal) {
      turns.push({
        id: block.id,
        label: firstLine(block.text) || "Your message",
        at: block.startedAt,
      });
      continue;
    }
    if (block.role !== "tool" || turns.length === 0) continue;
    const raw = editedPath(block);
    if (!raw) continue;
    const absolute = resolveWorkspacePath(raw, cwd);
    if (absolute) lastTurn.set(pathKey(absolute), turns.length - 1);
    else lastTurn.set(raw.replace(/^\.\//, ""), turns.length - 1);
  }
  const byTurn = new Map<number, GitChangedFile[]>();
  const other: GitChangedFile[] = [];
  for (const file of files) {
    const at =
      lastTurn.get(pathKey(file.path)) ?? lastTurn.get(file.relative) ?? -1;
    if (at < 0) {
      other.push(file);
      continue;
    }
    const list = byTurn.get(at);
    if (list) list.push(file);
    else byTurn.set(at, [file]);
  }
  const listed = [...byTurn.keys()].sort((a, b) => b - a);
  return {
    turns: listed.map((at) => ({ ...turns[at]!, files: byTurn.get(at)! })),
    other,
  };
}

/**
 * The chat whose turns group a folder's changes: the one asked for when it
 * works in that folder, otherwise the folder's latest.
 */
export function chatForChanges(
  sessions: readonly Session[],
  cwd: string,
  preferredId?: string,
): Session | null {
  if (preferredId) {
    const named = sessions.find((session) => session.id === preferredId);
    const where = named ? sessionWorkCwd(named) : "";
    if (
      named &&
      where &&
      (isEqualOrInside(where, cwd) || isEqualOrInside(cwd, where))
    )
      return named;
  }
  return sessionForShip(sessions, cwd);
}
