import { describe, expect, it } from "vitest";
import { chatForChanges, groupChangesByTurn } from "./changeTurns";
import type { GitChangedFile } from "./fs";
import { newDefaultSession, type Block, type Session } from "./session";

function file(relative: string): GitChangedFile {
  return {
    path: `/p/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
  };
}

const user = (id: string, text: string, internal = false): Block => ({
  id,
  role: "user",
  text,
  ...(internal ? { internal: true } : {}),
});
const edit = (id: string, path: string, kind = "edit"): Block => ({
  id,
  role: "tool",
  text: "",
  tool: { kind, title: `Edit ${path}`, preview: { kind: "write", path } },
});

describe("groupChangesByTurn", () => {
  it("files each change under the newest turn that edited it, newest turn first", () => {
    const blocks = [
      user("u1", "Add a header"),
      edit("e1", "/p/a.ts"),
      edit("e2", "b.ts"),
      user("u2", "Now the footer\nwith links"),
      edit("e3", "./a.ts"),
      // Reads do not count as changes.
      {
        id: "r1",
        role: "tool",
        text: "",
        tool: { kind: "read", preview: { kind: "read", path: "/p/c.ts" } },
      } as Block,
    ];
    const grouped = groupChangesByTurn(blocks, "/p", [
      file("a.ts"),
      file("b.ts"),
      file("c.ts"),
    ]);
    expect(
      grouped.turns.map((turn) => [
        turn.label,
        turn.files.map((f) => f.relative),
      ]),
    ).toEqual([
      ["Now the footer", ["a.ts"]],
      ["Add a header", ["b.ts"]],
    ]);
    expect(grouped.other.map((f) => f.relative)).toEqual(["c.ts"]);
  });

  it("ignores Aven's own hidden messages and edits before any message", () => {
    const blocks = [
      edit("e0", "/p/a.ts"),
      user("u1", "Do it"),
      user("i1", "continue", true),
      edit("e1", "/p/b.ts"),
    ];
    const grouped = groupChangesByTurn(blocks, "/p", [
      file("a.ts"),
      file("b.ts"),
    ]);
    expect(grouped.turns).toHaveLength(1);
    expect(grouped.turns[0]).toMatchObject({ id: "u1", label: "Do it" });
    expect(grouped.turns[0]!.files.map((f) => f.relative)).toEqual(["b.ts"]);
    expect(grouped.other.map((f) => f.relative)).toEqual(["a.ts"]);
  });

  it("reads the path from an edit's title when it has no preview", () => {
    const blocks: Block[] = [
      user("u1", "Rename"),
      {
        id: "t",
        role: "tool",
        text: "",
        tool: { kind: "edit", title: "Write src/x.ts" },
      },
    ];
    const grouped = groupChangesByTurn(blocks, "/p", [file("src/x.ts")]);
    expect(grouped.turns[0]!.files).toHaveLength(1);
  });
});

describe("chatForChanges", () => {
  const chat = (id: string, cwd: string): Session => ({
    ...newDefaultSession(cwd),
    id,
  });

  it("uses the chat in front when it works in the folder, else the folder's latest", () => {
    const here = chat("here", "/p");
    const elsewhere = chat("elsewhere", "/q");
    expect(chatForChanges([here, elsewhere], "/p", "here")?.id).toBe("here");
    expect(chatForChanges([here, elsewhere], "/p", "elsewhere")?.id).not.toBe(
      "elsewhere",
    );
  });
});
