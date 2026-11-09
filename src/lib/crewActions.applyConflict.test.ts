import { describe, expect, it } from "vitest";
import { applyConflictText } from "./crewActions";
import { offersRestack } from "../hooks/useTeamPipeline";

describe("an Apply that clashes with your files", () => {
  it("names a file Avos adds that your folder has outside Git, and offers no update", () => {
    const text = applyConflictText(
      new Error(
        "These changes conflict with edits in your project: error: server.test.js: already exists in working directory",
      ),
    );
    expect(text).toBe(
      "Nothing was applied: Avos's change adds server.test.js, and your folder already has a file by that name that Git doesn't track. Commit or move it aside, then Apply again.",
    );
    // Updating Avos's branch can't help: its copy never sees such files.
    expect(offersRestack(text)).toBe(false);
  });

  it("offers the update for any other clash", () => {
    const text = applyConflictText(
      new Error(
        "These changes conflict with edits in your project: error: patch failed: server.js:12",
      ),
    );
    expect(offersRestack(text)).toBe(true);
  });
});
