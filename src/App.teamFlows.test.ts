import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * How the team's flows are wired in the workspace, read from its source:
 * App is too large to render in a test.
 */
const app = readFileSync("src/App.tsx", "utf8");

/** From `anchor` to the end of the hook or callback it starts. */
function block(anchor: string, end = "\n  );\n") {
  const at = app.indexOf(anchor);
  expect(at, anchor).toBeGreaterThan(-1);
  return app.slice(at, app.indexOf(end, at));
}

describe("a teammate's chat", () => {
  it("says why it can't open instead of doing nothing, and the views close only once it has", () => {
    const open = block("const openCrewChat = useCallback(");
    expect(open).toContain("Promise<string | null>");
    expect(open).toContain(
      "if (!teammateChatReady(crew, member.id)) return firstCardChatText(name);",
    );
    expect(open).toContain('return "Turn the team on first.";');
    const workspace = block("installCrewWorkspace({", "\n      }),");
    expect(workspace).toContain(
      "const why = await openCrewChat(path, role);\n          if (!why) closeUtilityViews();\n          return why;",
    );
  });
});

describe("a project you delete or archive", () => {
  it("stops its team before its data goes, and when it's archived", () => {
    const remove = block("const onRemoveProject = useCallback(");
    const stop = remove.indexOf("await stopTeamForProject(normalized);");
    expect(stop).toBeGreaterThan(-1);
    expect(stop).toBeLessThan(remove.indexOf("await removeProjectData("));
    expect(remove).toContain(
      "if (!options.purgeData) await stopTeamForProject(normalized);",
    );
  });
});

describe("New team on a project that needs Git", () => {
  it("asks for Git for a team, and goes on to Build a team once it's set up", () => {
    expect(block("const onAddCrew = useCallback(")).toContain(
      'setBotGitSetup({ path, state: need, for: "team" });',
    );
    expect(block("const onAddBot = useCallback(")).toContain(
      'setBotGitSetup({ path, state: need, for: "bot" });',
    );
    const sheet = block("<BotGitSetupSheet", "/>");
    expect(sheet).toContain("kind={botGitSetup.for}");
    expect(sheet).toContain("if (forTeam) onAddCrew(path);");
  });
});
