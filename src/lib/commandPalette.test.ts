import { describe, expect, it } from "vitest";
import {
  PALETTE_COMMANDS,
  cycleIndex,
  mergePaletteChats,
  offersNewChat,
  parsePaletteQuery,
  rankPaletteChats,
  rankPaletteCommands,
  recentPaletteChats,
  type PaletteChat,
} from "./commandPalette";

describe("palette queries", () => {
  it.each([
    ["", "all", ""],
    ["  fix the login loop ", "all", "fix the login loop"],
    ["> sidebar", "commands", "sidebar"],
    ["@redirect.ts", "files", "redirect.ts"],
    ["  # pricing", "chats", "pricing"],
  ])("parses %j", (raw, mode, text) => {
    expect(parsePaletteQuery(raw)).toEqual({ mode, text });
  });

  it("offers a new chat only for unprefixed text", () => {
    expect(offersNewChat("all", "fix it")).toBe(true);
    expect(offersNewChat("all", "")).toBe(false);
    expect(offersNewChat("commands", "sidebar")).toBe(false);
  });
});

describe("palette commands", () => {
  it("prefers label matches and finds commands by keyword", () => {
    expect(rankPaletteCommands(PALETTE_COMMANDS, "sidebar")[0].id).toBe(
      "toggle_sidebar",
    );
    expect(rankPaletteCommands(PALETTE_COMMANDS, "localhost")[0].id).toBe(
      "new_browser_tab",
    );
    expect(rankPaletteCommands(PALETTE_COMMANDS, "")).toHaveLength(
      PALETTE_COMMANDS.length,
    );
    expect(rankPaletteCommands(PALETTE_COMMANDS, "zzzq")).toEqual([]);
  });

  it("has unique ids", () => {
    const ids = PALETTE_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("palette chats and agents", () => {
  const chat = (id: string, title: string, updatedAt: number, busy = false) =>
    ({
      id,
      cwd: "/p",
      harness: "claude",
      title,
      updatedAt,
      busy,
    }) as PaletteChat;

  it("lists running chats first, then the most recent", () => {
    const chats = [
      chat("a", "Old", 1),
      chat("b", "New", 3),
      chat("c", "Running", 2, true),
    ];
    expect(recentPaletteChats(chats).map((item) => item.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("ranks matching titles and merges sources without duplicates", () => {
    const chats = [
      chat("a", "Fix login redirect", 1),
      chat("b", "Pricing page", 2),
    ];
    expect(rankPaletteChats(chats, "login").map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(
      mergePaletteChats(
        [chat("a", "Local", 1)],
        [chat("a", "Remote", 9), chat("z", "Z", 1)],
      ).map((item) => `${item.id}:${item.title}`),
    ).toEqual(["a:Local", "z:Z"]);
  });

  it("cycles agents in both directions", () => {
    expect(cycleIndex(3, 2, 1)).toBe(0);
    expect(cycleIndex(3, 0, -1)).toBe(2);
    expect(cycleIndex(0, 0, 1)).toBe(0);
  });
});
