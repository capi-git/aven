import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectSessionCount, removeProjectData } from "./projectData";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  logo: vi.fn(),
  background: vi.fn(),
  backgroundSetting: vi.fn(),
  tabs: vi.fn(),
}));
vi.mock("./sessionStore", () => ({ listProjectSessionIds: mocks.list }));
vi.mock("./projectLogos", () => ({ clearProjectLogo: mocks.logo }));
vi.mock("./chatBackground", () => ({
  clearProjectChatBackground: mocks.background,
}));
vi.mock("./projectChatBackground", () => ({
  clearProjectChatBackgroundSetting: mocks.backgroundSetting,
}));
vi.mock("./tabGroups", () => ({ clearTabGroupSettings: mocks.tabs }));

describe("project data removal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue(["saved"]);
    mocks.logo.mockResolvedValue(undefined);
    mocks.background.mockResolvedValue(undefined);
  });

  function options() {
    return {
      openSessionIds: ["saved", "pending-first-save"],
      removeSession: vi.fn().mockResolvedValue(true),
      assertWorkspaceReady: vi.fn(),
    };
  }

  it("does not report zero conversations or delete anything after a failed list", async () => {
    mocks.list.mockRejectedValue(new Error("database unavailable"));
    await expect(projectSessionCount("/project")).rejects.toThrow(
      "database unavailable",
    );
    const lifecycle = options();
    await expect(removeProjectData("/project", lifecycle)).rejects.toThrow(
      "The project remains available",
    );
    expect(lifecycle.removeSession).not.toHaveBeenCalled();
    expect(mocks.logo).not.toHaveBeenCalled();
  });

  it("awaits the live-session lifecycle and includes a chat whose first save is pending", async () => {
    let finish!: (result: boolean) => void;
    const lifecycle = options();
    lifecycle.removeSession.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const removing = removeProjectData("/project/", lifecycle);
    await vi.waitFor(() =>
      expect(lifecycle.removeSession).toHaveBeenCalledExactlyOnceWith("saved"),
    );
    expect(mocks.logo).not.toHaveBeenCalled();
    finish(true);
    await removing;
    expect(mocks.list).toHaveBeenCalledWith("/project");
    expect(lifecycle.removeSession.mock.calls).toEqual([
      ["saved"],
      ["pending-first-save"],
    ]);
    expect(lifecycle.assertWorkspaceReady).toHaveBeenCalledTimes(2);
    expect(mocks.logo).toHaveBeenCalledOnce();
    expect(mocks.backgroundSetting).toHaveBeenCalledOnce();
    expect(mocks.tabs).toHaveBeenCalledOnce();
  });

  it("stops after cancellation and reports any completed deletions", async () => {
    const lifecycle = options();
    lifecycle.removeSession
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(removeProjectData("/project", lifecycle)).rejects.toThrow(
      "1 conversation has already been deleted",
    );
    expect(mocks.logo).not.toHaveBeenCalled();
    expect(mocks.tabs).not.toHaveBeenCalled();
  });

  it("counts and deletes closed workers captured before their lead is removed", async () => {
    mocks.list.mockResolvedValue(["lead", "worker", "empty", "inbox"]);
    expect(await projectSessionCount("/project")).toBe(4);
    const stored = new Set(["lead", "worker", "empty", "inbox"]);
    const lifecycle = { ...options(), openSessionIds: [] };
    lifecycle.removeSession.mockImplementation(async (id: string) => {
      stored.delete(id);
      return true;
    });
    await removeProjectData("/project", lifecycle);
    expect(lifecycle.removeSession.mock.calls).toEqual([
      ["lead"],
      ["worker"],
      ["empty"],
      ["inbox"],
    ]);
    expect(stored.size).toBe(0);
  });

  it("retains the project on the first failed delete without claiming progress", async () => {
    const lifecycle = options();
    lifecycle.removeSession.mockRejectedValueOnce(new Error("delete failed"));
    await expect(removeProjectData("/project", lifecycle)).rejects.toThrow(
      /^The project remains available/,
    );
    expect(lifecycle.removeSession).toHaveBeenCalledTimes(1);
    expect(mocks.logo).not.toHaveBeenCalled();
  });

  it("keeps new work opened during deletion and stops appearance removal", async () => {
    const lifecycle = options();
    lifecycle.assertWorkspaceReady.mockImplementation(() => {
      throw new Error("New work is open");
    });
    await expect(removeProjectData("/project", lifecycle)).rejects.toThrow(
      "New work is open",
    );
    expect(mocks.logo).not.toHaveBeenCalled();
  });

  it("reports failed appearance cleanup and retries remaining data safely", async () => {
    mocks.logo.mockRejectedValueOnce(new Error("image permission denied"));
    await expect(removeProjectData("/project", options())).rejects.toThrow(
      "2 conversations have already been deleted",
    );
    expect(mocks.background).not.toHaveBeenCalled();
    expect(mocks.tabs).not.toHaveBeenCalled();

    mocks.list.mockResolvedValue([]);
    const retry = { ...options(), openSessionIds: [] };
    await removeProjectData("/project", retry);
    expect(retry.removeSession).not.toHaveBeenCalled();
    expect(mocks.tabs).toHaveBeenCalledOnce();
  });

  it("checks for new work again after asynchronous appearance cleanup", async () => {
    const lifecycle = options();
    lifecycle.assertWorkspaceReady
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("New terminal opened");
      });
    await expect(removeProjectData("/project", lifecycle)).rejects.toThrow(
      "New terminal opened",
    );
    expect(mocks.background).toHaveBeenCalledOnce();
    expect(mocks.tabs).not.toHaveBeenCalled();
  });
});
