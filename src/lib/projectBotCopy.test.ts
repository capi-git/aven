import { expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, args: { cwd: string }) => {
    if (args.cwd === "/work/plain") throw "A bot needs a git repository.";
    if (args.cwd === "/work/empty")
      throw "A bot needs at least one commit in this repository.";
    if (args.cwd === "/work/gone") throw "This project's folder is missing.";
  }),
}));
vi.mock("@tauri-apps/api/core", () => core);

import {
  botProjectState,
  botProjectStates,
  gitSetupNeeded,
} from "./projectBotCopy";

it("tells a project that needs Git from one that can't have a bot", async () => {
  await expect(
    botProjectStates(["/work/app", "/work/plain", "/work/empty", "/work/gone"]),
  ).resolves.toEqual(["ready", "no-git", "no-commit", "unavailable"]);
  expect(core.invoke).toHaveBeenCalledWith("bot_project_ready", {
    cwd: "/work/plain",
  });
  expect(botProjectState(new Error("A bot needs a git repository."))).toBe(
    "no-git",
  );
  expect(botProjectState("Could not run git: not found")).toBe("unavailable");
});

it("Add a bot first offers Git to a project without it, and only then", async () => {
  await expect(gitSetupNeeded("/work/plain")).resolves.toBe("no-git");
  await expect(gitSetupNeeded("/work/empty")).resolves.toBe("no-commit");
  // Ready, or a problem setting up Git wouldn't fix: adding goes ahead and
  // says what is wrong as before.
  await expect(gitSetupNeeded("/work/app")).resolves.toBeNull();
  await expect(gitSetupNeeded("/work/gone")).resolves.toBeNull();
});
