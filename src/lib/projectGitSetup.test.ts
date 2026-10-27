import { expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ started: true, wroteIgnore: true, files: 3 })),
}));
vi.mock("@tauri-apps/api/core", () => core);

import {
  GIT_SETUP_WORDS,
  botGitNote,
  gitSetupError,
  setUpProjectGit,
} from "./projectGitSetup";

it("sets Git up through Aven's own command, for that one project", async () => {
  await expect(setUpProjectGit("/work/notes")).resolves.toEqual({
    started: true,
    wroteIgnore: true,
    files: 3,
  });
  expect(core.invoke).toHaveBeenCalledExactlyOnceWith("project_git_setup", {
    path: "/work/notes",
  });
});

it("says plainly what Set up Git does, and that nothing leaves the computer", () => {
  expect(botGitNote(true)).toBe(
    "Bots need Git to keep their own copy of your project. Set up Git turns it on for that project on this Mac. Nothing is uploaded.",
  );
  expect(botGitNote(false)).toContain("on this computer.");
  expect(GIT_SETUP_WORDS["no-git"]).toEqual({
    note: "Not using Git yet",
    action: "Set up Git",
    busy: "Setting up Git…",
  });
  expect(GIT_SETUP_WORDS["no-commit"].action).toBe("Make a first save");
});

it("keeps the host's reason to one line", () => {
  expect(
    gitSetupError(new Error("Git isn't installed on this Mac.\nmore")),
  ).toBe("Git isn't installed on this Mac.");
  expect(gitSetupError("")).toBe("Couldn't set up Git.");
  expect(gitSetupError("x".repeat(300))).toHaveLength(240);
});
