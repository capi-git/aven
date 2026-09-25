import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  appendNoteReference,
  composeNoteMessage,
  injectNotePrompt,
  isNoteMentionPath,
  deleteNote,
  invalidateNotes,
  loadNotes,
  noteCardMeta,
  noteMentionLabel,
  notePreview,
  noteSourceProject,
  noteSlugsInText,
  notesAsProjectFiles,
  noteTitle,
  peekNotes,
  rankNoteFiles,
  upsertNote,
  type Note,
} from "./notes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("notes storage cache", () => {
  const saved = note({ id: "n", slug: "saved", title: "Saved" });
  const newer = { ...saved, title: "New title", updatedAt: 2 };
  const call = vi.mocked(invoke);

  beforeEach(() => {
    invalidateNotes();
    call.mockReset();
  });

  it("reports a failed list and retries instead of caching empty success", async () => {
    call.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(loadNotes()).rejects.toThrow("Storage unavailable");
    expect(peekNotes()).toBeNull();
    call.mockResolvedValueOnce([saved]);
    await expect(loadNotes()).resolves.toEqual([saved]);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("returns the newer refresh even when an older list finishes last", async () => {
    let finishOld!: (value: (typeof saved)[]) => void;
    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    const old = loadNotes();
    call.mockResolvedValueOnce([newer]);
    await expect(loadNotes(true)).resolves.toEqual([newer]);
    finishOld([saved]);
    await expect(old).resolves.toEqual([newer]);
    expect(peekNotes()).toEqual([newer]);
  });

  it("joins an in-flight newer refresh even when an old cache exists", async () => {
    call.mockResolvedValueOnce([saved]);
    await loadNotes();
    let finishOld!: (value: (typeof saved)[]) => void;
    let finishNew!: (value: (typeof saved)[]) => void;
    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    const old = loadNotes(true);
    call.mockReturnValueOnce(
      new Promise((resolve) => {
        finishNew = resolve;
      }),
    );
    const latest = loadNotes(true);
    finishOld([saved]);
    await Promise.resolve();
    finishNew([newer]);
    await expect(latest).resolves.toEqual([newer]);
    await expect(old).resolves.toEqual([newer]);
  });

  it.each(["upsert", "delete"] as const)(
    "does not reuse or cache a list that preceded a successful %s",
    async (mutation) => {
      let finishOld!: (value: (typeof saved)[]) => void;
      call.mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      );
      const old = loadNotes();
      call.mockResolvedValueOnce(mutation === "upsert" ? newer : undefined);
      if (mutation === "upsert") await upsertNote(newer);
      else await deleteNote(saved.id);
      const expected = mutation === "upsert" ? [newer] : [];
      call.mockResolvedValueOnce(expected);
      const current = loadNotes();
      finishOld([saved]);
      await expect(current).resolves.toEqual(expected);
      await expect(old).resolves.toEqual(expected);
      expect(peekNotes()).toEqual(expected);
      expect(call).toHaveBeenCalledTimes(3);
    },
  );
});

function note(
  partial: Partial<Note> & Pick<Note, "id" | "slug" | "title">,
): Note {
  return {
    body: "",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("noteTitle", () => {
  it("uses the first heading", () => {
    expect(noteTitle("intro\n# Auth approach\n\nbody")).toBe("Auth approach");
  });

  it("falls back to the first prose line", () => {
    expect(noteTitle("Ship the notes overlay first.")).toBe(
      "Ship the notes overlay first.",
    );
  });

  it("returns Untitled when empty", () => {
    expect(noteTitle("   \n```\ncode\n```\n")).toBe("Untitled");
  });
});

describe("notePreview", () => {
  it("skips the title heading", () => {
    expect(notePreview("# Auth\n\nKeep it global.", "Auth")).toBe(
      "Keep it global.",
    );
  });
});

describe("noteSourceProject", () => {
  it("uses the folder name", () => {
    expect(noteSourceProject("/Users/me/code/agent-terminal")).toBe(
      "agent-terminal",
    );
  });

  it("returns null when there is no project", () => {
    expect(noteSourceProject(undefined)).toBeNull();
    expect(noteSourceProject("~")).toBeNull();
    expect(noteSourceProject("/")).toBeNull();
  });
});

describe("note mentions", () => {
  it("collects unique @note/slug tokens", () => {
    expect(
      noteSlugsInText("See @note/auth and @note/auth plus @note/plan-2."),
    ).toEqual(["auth", "plan-2"]);
  });

  it("injects referenced bodies after the prompt", () => {
    expect(
      injectNotePrompt("Use this.", [
        note({
          id: "n1",
          slug: "auth",
          title: "Auth",
          body: "Use a cookie.",
        }),
      ]),
    ).toBe('Use this.\n\n---\nReferenced note "Auth":\n\nUse a cookie.');
  });

  it("maps notes to mention files", () => {
    const files = notesAsProjectFiles([
      note({ id: "abc", slug: "auth", title: "Auth" }),
    ]);
    expect(files[0]).toEqual({
      name: "Auth",
      path: "note:abc",
      relative: "note/auth",
    });
    expect(isNoteMentionPath(files[0]!.path)).toBe(true);
    expect(
      noteMentionLabel(note({ id: "abc", slug: "auth", title: "Auth" })),
    ).toBe("note/auth");
  });
});

describe("composeNoteMessage", () => {
  const card = {
    id: "n1",
    slug: "auth",
    title: "Auth",
    body: "Use a cookie.",
  };

  it("sends a lead-in plus the note when the textarea is empty", () => {
    expect(composeNoteMessage(card, "  ")).toBe(
      'Use this note.\n\n---\nReferenced note "Auth":\n\nUse a cookie.',
    );
  });

  it("keeps the user's message and appends the note", () => {
    expect(composeNoteMessage(card, "Start with the cookie.")).toBe(
      'Start with the cookie.\n\n---\nReferenced note "Auth":\n\nUse a cookie.',
    );
  });

  it("passes the draft through when there is no card", () => {
    expect(composeNoteMessage(undefined, " hello ")).toBe("hello");
  });
});

describe("noteCardMeta", () => {
  it("drops the body so the thread chip can persist without the prompt dump", () => {
    expect(
      noteCardMeta({
        id: "n1",
        slug: "overview",
        title: "Overview",
        body: "long secret body",
        sourceCwd: "/tmp/project",
      }),
    ).toEqual({
      id: "n1",
      slug: "overview",
      title: "Overview",
      sourceCwd: "/tmp/project",
    });
  });
});

describe("appendNoteReference", () => {
  it("separates from existing draft text", () => {
    expect(appendNoteReference("hello", "Auth", "Use a cookie.")).toBe(
      "hello\n\nNote: Auth\n\nUse a cookie.\n\n",
    );
    expect(appendNoteReference("", "Auth", "Use a cookie.")).toBe(
      "Note: Auth\n\nUse a cookie.\n\n",
    );
  });
});

describe("rankNoteFiles", () => {
  const notes = [
    note({ id: "a", slug: "alpha", title: "Alpha", updatedAt: 2 }),
    note({ id: "b", slug: "beta", title: "Beta plan", updatedAt: 3 }),
  ];

  it("keeps recency order without a query", () => {
    expect(rankNoteFiles(notes, "").map((file) => file.path)).toEqual([
      "note:b",
      "note:a",
    ]);
  });

  it("fuzzy-matches titles", () => {
    expect(rankNoteFiles(notes, "plan").map((file) => file.path)).toEqual([
      "note:b",
    ]);
  });
});

describe("noteMentionLabel", () => {
  it("prefixes the slug", () => {
    expect(
      noteMentionLabel(note({ id: "n", slug: "auth", title: "Auth" })),
    ).toBe("note/auth");
  });
});
