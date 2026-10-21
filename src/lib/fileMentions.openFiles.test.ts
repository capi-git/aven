import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "./fs";
import { loadProjectFiles } from "./fileIndex";
import {
  applyFileMentionsToTurn,
  buildMentionIndex,
  fileMentionParts,
  mentionFilesFor,
  mentionLabel,
  rankOpenMentionFiles,
  resetStableMentionLabels,
  withMentionExtras,
} from "./fileMentions";
import type { OpenFilesSnapshot } from "./openFiles";

vi.mock("./fileIndex", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fileIndex")>();
  return { ...actual, loadProjectFiles: vi.fn(actual.loadProjectFiles) };
});

const list = vi.mocked(loadProjectFiles);

const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/p/apps/web/App.tsx",
    relative: "apps/web/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/p/apps/cli/App.tsx",
    relative: "apps/cli/App.tsx",
  },
  { name: "README.md", path: "/p/README.md", relative: "README.md" },
];
const outside = "/Users/me/Documents/Stanislaus impressions.md";
const known = (
  open: string[],
  remembered: string[] = [],
): OpenFilesSnapshot => ({
  open,
  known: [...open, ...remembered],
});

beforeEach(() => {
  resetStableMentionLabels();
  list.mockReset();
  list.mockResolvedValue(files);
});

describe("mentionFilesFor", () => {
  it("keeps a listed file's own entry and shows an outside file by its folder", () => {
    const extras = mentionFilesFor(
      known(["/p/README.md", outside], ["/Users/me/old.md"]),
      files,
      "/p",
    );
    expect(extras).toEqual([
      { ...files[2], open: true },
      {
        name: "Stanislaus impressions.md",
        path: outside,
        relative: "~/Documents/Stanislaus impressions.md",
        unlisted: true,
        open: true,
      },
      {
        name: "old.md",
        path: "/Users/me/old.md",
        relative: "~/old.md",
        unlisted: true,
      },
    ]);
  });

  it("shows an unlisted file inside the project by its project path", () => {
    expect(
      mentionFilesFor(known(["/p/build/new notes.md"]), files, "/p")[0],
    ).toMatchObject({
      relative: "build/new notes.md",
      unlisted: true,
    });
  });
});

describe("rankOpenMentionFiles", () => {
  it("offers every open file without a query, and matches with one", () => {
    const extras = mentionFilesFor(
      known(["/p/README.md", outside], ["/Users/me/old.md"]),
      files,
      "/p",
    );
    expect(rankOpenMentionFiles(extras, "").map((file) => file.path)).toEqual([
      "/p/README.md",
      outside,
    ]);
    expect(
      rankOpenMentionFiles(extras, "stan").map((file) => file.path),
    ).toEqual([outside]);
    expect(rankOpenMentionFiles(extras, "old.md")).toEqual([]);
  });
});

describe("withMentionExtras", () => {
  it("names an outside file by its name, with dashes for spaces", () => {
    const extras = mentionFilesFor(known([outside]), files, "/p");
    const index = withMentionExtras(buildMentionIndex(files), extras);
    expect(mentionLabel(extras[0]!, index)).toBe("Stanislaus-impressions.md");
    expect(
      fileMentionParts("see @Stanislaus-impressions.md, then", index.labels),
    ).toEqual([
      { text: "see " },
      { text: "@Stanislaus-impressions.md", file: extras[0] },
      { text: ", then" },
    ]);
  });

  it("leaves project labels alone and numbers an outside namesake", () => {
    const other = "/Users/me/README.md";
    const extras = mentionFilesFor(known([other]), files, "/p");
    const index = withMentionExtras(buildMentionIndex(files), extras);
    expect(index.labels.get("README.md")).toBe(files[2]);
    expect(mentionLabel(extras[0]!, index)).toBe("README.md~2");
  });

  it("lets an open file answer to its name where the project's is ambiguous", () => {
    const extras = mentionFilesFor(known(["/p/apps/cli/App.tsx"]), files, "/p");
    const index = withMentionExtras(buildMentionIndex(files), extras);
    expect(index.labels.get("App.tsx")?.path).toBe("/p/apps/cli/App.tsx");
    // Its own label stays the project's.
    expect(mentionLabel(extras[0]!, index)).toBe("apps/cli/App.tsx");
  });

  it("keeps each file's label as other files open and close", () => {
    const first = "/Users/me/a/notes.md";
    const second = "/Users/me/b/notes.md";
    const both = withMentionExtras(
      buildMentionIndex(files),
      mentionFilesFor(known([first, second]), files, "/p"),
    );
    expect(both.labelOf.get(first)).toBe("notes.md");
    expect(both.labelOf.get(second)).toBe("notes.md~2");
    const reordered = withMentionExtras(
      buildMentionIndex(files),
      mentionFilesFor(known([second]), files, "/p"),
    );
    expect(reordered.labelOf.get(second)).toBe("notes.md~2");
    expect(reordered.labels.get("notes.md")).toBeUndefined();
  });
});

describe("applyFileMentionsToTurn with open files", () => {
  it("gives the agent an outside file's full path", async () => {
    const out = await applyFileMentionsToTurn(
      "summarise @Stanislaus-impressions.md",
      "/p",
      known([outside]),
    );
    expect(out).toContain("summarise @Stanislaus-impressions.md");
    expect(out).toContain(`- @Stanislaus-impressions.md → ${outside}`);
  });

  it("still sends the path after the file's tab has closed", async () => {
    const out = await applyFileMentionsToTurn(
      "summarise @Stanislaus-impressions.md",
      "/p",
      known([], [outside]),
    );
    expect(out).toContain(`- @Stanislaus-impressions.md → ${outside}`);
  });

  it("sends an outside file from a chat with no project", async () => {
    list.mockResolvedValue([]);
    const out = await applyFileMentionsToTurn(
      "@Stanislaus-impressions.md please",
      "~",
      known([outside]),
    );
    expect(out).toContain(`- @Stanislaus-impressions.md → ${outside}`);
  });

  it("resolves a name written before the project listing loaded", async () => {
    const out = await applyFileMentionsToTurn(
      "fix @App.tsx",
      "/p",
      known(["/p/apps/cli/App.tsx"]),
    );
    expect(out).toContain("- @App.tsx → apps/cli/App.tsx");
  });

  it("leaves text alone when nothing it mentions is known", async () => {
    expect(
      await applyFileMentionsToTurn("ask @someone", "/p", known([outside])),
    ).toBe("ask @someone");
  });
});
