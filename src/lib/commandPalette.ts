import { fuzzyMatch } from "./fuzzy";
import { MOD } from "./platform";
import type { HarnessId } from "./session";

/**
 * The command palette's query model. A leading character narrows the list:
 * `>` commands and settings, `@` files in the current project, `#` chats in
 * every project. Anything else searches everything and offers a new chat.
 */
export type PaletteMode = "all" | "commands" | "files" | "chats";

export function parsePaletteQuery(raw: string): {
  mode: PaletteMode;
  text: string;
} {
  const prefix = raw.trimStart()[0];
  const mode: PaletteMode =
    prefix === ">"
      ? "commands"
      : prefix === "@"
        ? "files"
        : prefix === "#"
          ? "chats"
          : "all";
  const text = mode === "all" ? raw.trim() : raw.trimStart().slice(1).trim();
  return { mode, text };
}

/** Typed words become a new chat only in the unprefixed mode. */
export function offersNewChat(mode: PaletteMode, text: string): boolean {
  return mode === "all" && text.length > 0;
}

/** App actions the palette can run, keyed by the global shortcut names. */
export type PaletteCommandId =
  | "new_chat"
  | "new_terminal"
  | "new_browser_tab"
  | "open_search"
  | "go_to_file"
  | "find_in_project"
  | "toggle_sidebar"
  | "toggle_inspector"
  | "toggle_terminal"
  | "split_right"
  | "split_down"
  | "reopen_closed_tab"
  | "close_pane"
  | "open_inbox"
  | "open_notes"
  | "add_project"
  | "open_settings";

export type PaletteCommand = {
  id: PaletteCommandId;
  label: string;
  keys?: string;
  keywords?: string;
};

const SHIFT = MOD === "⌘" ? "⇧⌘" : "Ctrl+Shift+";

export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "new_chat",
    label: "New chat",
    keys: `${MOD}T`,
    keywords: "task session conversation ask",
  },
  {
    id: "new_terminal",
    label: "New terminal",
    keys: `${MOD}\``,
    keywords: "shell console",
  },
  {
    id: "new_browser_tab",
    label: "Open browser tab",
    keywords: "web preview localhost page",
  },
  {
    id: "open_search",
    label: "Search everything",
    keys: `${SHIFT}K`,
    keywords: "find conversations files projects",
  },
  {
    id: "go_to_file",
    label: "Go to file",
    keys: `${MOD}P`,
    keywords: "open quick",
  },
  {
    id: "find_in_project",
    label: "Find in project",
    keys: `${SHIFT}F`,
    keywords: "grep text search content",
  },
  {
    id: "toggle_sidebar",
    label: "Toggle sidebar",
    keys: `${MOD}B`,
    keywords: "navigation hide show pin",
  },
  {
    id: "toggle_inspector",
    label: "Toggle inspector",
    keys: `${SHIFT}B`,
    keywords: "right panel",
  },
  {
    id: "toggle_terminal",
    label: "Toggle terminal",
    keys: `${MOD}J`,
    keywords: "dock shell",
  },
  {
    id: "split_right",
    label: "Split right",
    keys: `${MOD}D`,
    keywords: "pane side by side",
  },
  {
    id: "split_down",
    label: "Split down",
    keys: `${SHIFT}D`,
    keywords: "pane below",
  },
  {
    id: "reopen_closed_tab",
    label: "Reopen closed tab",
    keys: `${SHIFT}T`,
    keywords: "restore undo",
  },
  { id: "close_pane", label: "Close tab", keys: `${MOD}W`, keywords: "pane" },
  {
    id: "open_inbox",
    label: "Open Inbox",
    keywords: "github linear issues pull requests",
  },
  { id: "open_notes", label: "Open Notes", keywords: "notebook" },
  {
    id: "add_project",
    label: "Add project",
    keywords: "folder open repository",
  },
  {
    id: "open_settings",
    label: "Settings",
    keys: `${MOD},`,
    keywords: "preferences options",
  },
];

/** Commands shown before anything is typed. */
export const PALETTE_START: readonly PaletteCommandId[] = [
  "new_chat",
  "new_terminal",
  "new_browser_tab",
  "open_search",
];

export function rankPaletteCommands(
  commands: readonly PaletteCommand[],
  text: string,
): PaletteCommand[] {
  if (!text) return [...commands];
  return commands
    .flatMap((command) => {
      const label = fuzzyMatch(text, command.label);
      const keywords = label
        ? null
        : fuzzyMatch(text, `${command.label} ${command.keywords ?? ""}`);
      const hit = label ?? keywords;
      return hit ? [{ command, score: hit.score + (label ? 50 : 0) }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ command }) => command);
}

/** An agent the palette can start a chat with. */
export type PaletteAgent = {
  harness: HarnessId;
  model: string;
  label: string;
};

/** Tab moves to the next agent, Shift-Tab to the previous one. */
export function cycleIndex(length: number, current: number, step: 1 | -1) {
  if (length <= 0) return 0;
  return (((current + step) % length) + length) % length;
}

export type PaletteChat = {
  id: string;
  cwd: string;
  harness: HarnessId;
  title: string;
  updatedAt: number;
  busy?: boolean;
};

/** Running chats first, then the most recently active. */
export function recentPaletteChats(
  chats: readonly PaletteChat[],
  limit = 5,
): PaletteChat[] {
  return [...chats]
    .sort(
      (a, b) =>
        Number(!!b.busy) - Number(!!a.busy) || b.updatedAt - a.updatedAt,
    )
    .slice(0, limit);
}

export function rankPaletteChats(
  chats: readonly PaletteChat[],
  text: string,
  limit = 6,
): PaletteChat[] {
  if (!text) return recentPaletteChats(chats, limit);
  return chats
    .flatMap((chat) => {
      const hit = fuzzyMatch(text, chat.title);
      return hit ? [{ chat, score: hit.score }] : [];
    })
    .sort((a, b) => b.score - a.score || b.chat.updatedAt - a.chat.updatedAt)
    .slice(0, limit)
    .map(({ chat }) => chat);
}

/** Merge chats from several sources, keeping the first occurrence of each id. */
export function mergePaletteChats(
  ...lists: ReadonlyArray<readonly PaletteChat[]>
): PaletteChat[] {
  const seen = new Set<string>();
  const merged: PaletteChat[] = [];
  for (const list of lists)
    for (const chat of list) {
      if (seen.has(chat.id)) continue;
      seen.add(chat.id);
      merged.push(chat);
    }
  return merged;
}
