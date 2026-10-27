import { describe, expect, it } from "vitest";
import {
  filePaneHeader,
  paneTitleRow,
  workspaceTabOwnHeader,
} from "./filePaneHeader";
import type { FilePaneTab, WorkspaceTab } from "./layout";

const file = (id: string, extra: Partial<FilePaneTab> = {}): FilePaneTab => ({
  id,
  path: `/p/${id}.ts`,
  cwd: "/p",
  ...extra,
});
const iphone = file("iphone", {
  path: "iPhone",
  simulator: { project: "/p" },
});
const board = file("board", { path: "Board", board: { project: "/p" } });

function tabOf(files: FilePaneTab[]): WorkspaceTab {
  return {
    kind: "session",
    id: "tab",
    layout: { type: "leaf", id: "pane" },
    focusedId: "pane",
    editorPanes: [{ id: "pane", files, activeFileId: files[0]?.id ?? "" }],
    terminalPanes: [],
  };
}

describe("a file pane's one header row", () => {
  it("is a lone iPhone's pickers, not a tab named iPhone above them", () => {
    for (const inner of [false, true])
      expect(filePaneHeader([iphone], { inner, namedAbove: false })).toEqual({
        tabs: false,
        soloSimulator: true,
      });
  });

  it("keeps file tabs for several files, and for a lone file nothing else names", () => {
    expect(
      filePaneHeader([file("a"), iphone], { inner: false, namedAbove: true }),
    ).toEqual({ tabs: true, soloSimulator: false });
    expect(
      filePaneHeader([file("a")], { inner: false, namedAbove: false }).tabs,
    ).toBe(true);
    // Beside a chat in its tab, a file pane names its file.
    expect(
      filePaneHeader([file("a")], { inner: true, namedAbove: true }).tabs,
    ).toBe(true);
  });

  it("draws no name row for a lone file a tab row above already names", () => {
    expect(
      filePaneHeader([file("a")], { inner: false, namedAbove: true }).tabs,
    ).toBe(false);
  });

  it("leaves a board alone in its tab to the tab's name", () => {
    expect(
      filePaneHeader([board], { inner: false, namedAbove: false }).tabs,
    ).toBe(false);
    expect(
      filePaneHeader([board], { inner: true, namedAbove: false }).tabs,
    ).toBe(true);
  });
});

describe("a workspace tab's own header", () => {
  it("belongs to a tab of files or an iPhone, not to a chat or a board", () => {
    expect(workspaceTabOwnHeader(tabOf([iphone]), true)).toBe(true);
    expect(workspaceTabOwnHeader(tabOf([file("a")]), false)).toBe(true);
    expect(workspaceTabOwnHeader(tabOf([file("a")]), true)).toBe(false);
    expect(workspaceTabOwnHeader(tabOf([board]), false)).toBe(false);
    const chat: WorkspaceTab = {
      ...tabOf([]),
      layout: { type: "leaf", id: "session" },
      editorPanes: [],
    };
    expect(workspaceTabOwnHeader(chat, false)).toBe(false);
  });
});

describe("a pane's title row names its tab once", () => {
  const chat = () => false;
  const page = () => true;

  it("is left out of a single pane whose tabs the window's strip names", () => {
    // Three chats: the strip names them; a title row would name the front
    // one again.
    expect(
      paneTitleRow({ space: false, tabs: 3, split: false, ownHeader: chat }),
    ).toEqual({ row: false, lend: false });
    // One chat: the strip shows no lone tab, so the title row names it.
    expect(
      paneTitleRow({ space: false, tabs: 1, split: false, ownHeader: chat }),
    ).toEqual({ row: true, lend: false });
  });

  it("is lent to a page, whose address names it only when nothing else does", () => {
    const asked: boolean[] = [];
    const ownHeader = (namedAbove: boolean) => {
      asked.push(namedAbove);
      return page();
    };
    expect(
      paneTitleRow({ space: false, tabs: 3, split: false, ownHeader }),
    ).toEqual({ row: true, lend: true });
    // Told that the window strip names it.
    expect(asked).toContain(true);
  });

  it("is always there in a space, and never above a single pane's split tab", () => {
    expect(
      paneTitleRow({ space: true, tabs: 3, split: false, ownHeader: chat }).row,
    ).toBe(true);
    expect(
      paneTitleRow({ space: false, tabs: 1, split: true, ownHeader: chat }).row,
    ).toBe(false);
  });
});
