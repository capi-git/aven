import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn(), tauri: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: core.invoke,
  isTauri: () => core.tauri,
}));

const downloads = await import("./chatDownloads");
const {
  agentFilesFolder,
  agentFilesInstructions,
  chatDownload,
  downloadAgentFile,
  isAgentMadeFile,
  openChatDownload,
  keepAgentFilesOutOfGit,
  resetChatDownloadsForTests,
} = downloads;

describe("chat downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.tauri = false;
    resetChatDownloadsForTests();
  });

  it("counts only files under a .aven/files folder", () => {
    expect(isAgentMadeFile("/p/.aven/files/Report.pdf")).toBe(true);
    expect(isAgentMadeFile("/p/.aven/files/charts/a.png")).toBe(true);
    expect(isAgentMadeFile("C:\\p\\.aven\\files\\table.csv")).toBe(true);
    expect(isAgentMadeFile("/p/.aven/files")).toBe(false);
    expect(isAgentMadeFile("/p/.aven/files/")).toBe(false);
    expect(isAgentMadeFile("/p/.aven/Report.pdf")).toBe(false);
    expect(isAgentMadeFile("/p/docs/files/Report.pdf")).toBe(false);
    expect(isAgentMadeFile("/p/.aven/files/../src/App.tsx")).toBe(false);
  });

  it("tells the agent where made files go and how to link them", () => {
    const note = agentFilesInstructions("/Users/me/p/.aven/files");
    expect(note.startsWith("<aven-files>")).toBe(true);
    expect(note).toContain("save it in /Users/me/p/.aven/files");
    expect(note).toContain("not in Downloads");
    expect(note).toContain(
      "[Report.pdf](</Users/me/p/.aven/files/Report.pdf>)",
    );
    expect(agentFilesInstructions("C:\\p\\.aven\\files")).toContain(
      "(<C:\\p\\.aven\\files\\Report.pdf>)",
    );
    // Aven makes no folder up front: the agent makes it with its first
    // file, with an ignore file so Git leaves it alone.
    expect(note).toContain("If that folder isn't there yet, make it");
    expect(note).toContain("a .gitignore file in it that holds just *");
  });

  it("checks a handed-over file's folder for its ignore file, once per project", () => {
    keepAgentFilesOutOfGit("/p/.aven/files/Report.pdf");
    expect(core.invoke).not.toHaveBeenCalled();

    core.tauri = true;
    core.invoke.mockResolvedValue("/p/.aven/files");
    keepAgentFilesOutOfGit("/p/.aven/files/Report.pdf");
    keepAgentFilesOutOfGit("/p/.aven/files/charts/a.png");
    expect(core.invoke).toHaveBeenCalledTimes(1);
    expect(core.invoke).toHaveBeenCalledWith("agent_files_folder", {
      cwd: "/p",
    });
    keepAgentFilesOutOfGit("C:\\q\\.aven\\files\\t.csv");
    expect(core.invoke).toHaveBeenLastCalledWith("agent_files_folder", {
      cwd: "C:/q",
    });
    // A file elsewhere isn't one an agent handed over.
    keepAgentFilesOutOfGit("/p/src/App.tsx");
    expect(core.invoke).toHaveBeenCalledTimes(2);
  });

  it("asks the app for the folder only inside the desktop app", async () => {
    expect(await agentFilesFolder("/p")).toBeUndefined();
    expect(core.invoke).not.toHaveBeenCalled();

    core.tauri = true;
    core.invoke.mockResolvedValueOnce("/p/.aven/files");
    expect(await agentFilesFolder("/p")).toBe("/p/.aven/files");
    expect(core.invoke).toHaveBeenCalledWith("agent_files_folder", {
      cwd: "/p",
    });

    vi.spyOn(console, "error").mockImplementation(() => {});
    core.invoke.mockRejectedValueOnce("The project folder isn't there.");
    expect(await agentFilesFolder("/gone")).toBeUndefined();
  });

  it("adds the note to every turn, beside the Git preference", async () => {
    core.tauri = true;
    core.invoke.mockResolvedValue("/repo/.aven/files");
    const { prepareAgentBrowserPrompt } = await import("./agentBrowser");
    const prompt = await prepareAgentBrowserPrompt(
      "Make the PDF",
      { sessionId: "s1", cwd: "/repo" },
      { noBrowser: true },
    );
    expect(prompt).toBe(
      `${agentFilesInstructions("/repo/.aven/files")}\n\nMake the PDF`,
    );
  });

  it("ignores a second click while the first copy is still saving", async () => {
    let finish: (value: unknown) => void = () => {};
    core.invoke.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const first = downloadAgentFile("/p/.aven/files/a.zip");
    expect(chatDownload("/p/.aven/files/a.zip")).toEqual({ state: "saving" });
    await downloadAgentFile("/p/.aven/files/a.zip");
    expect(core.invoke).toHaveBeenCalledTimes(1);

    finish({ path: "/d/a.zip", name: "a.zip", openable: true });
    await first;
    expect(chatDownload("/p/.aven/files/a.zip")).toEqual({
      state: "saved",
      path: "/d/a.zip",
      name: "a.zip",
      openable: true,
    });
  });

  it("shows a refused Open on the link", async () => {
    core.invoke.mockResolvedValueOnce({
      path: "/d/a.png",
      name: "a.png",
      openable: true,
    });
    await downloadAgentFile("/p/.aven/files/a.png");
    core.invoke.mockRejectedValueOnce(
      "a.png was moved or deleted from Downloads.",
    );
    await openChatDownload("/p/.aven/files/a.png");
    expect(chatDownload("/p/.aven/files/a.png")).toEqual({
      state: "failed",
      error: "a.png was moved or deleted from Downloads.",
    });
  });
});
