import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorage } from "./devSmoke";
import {
  TEAM_VIEW_KEY,
  resetTeamViewCache,
  setTeamView,
  subscribeTeamView,
  teamView,
} from "./teamView";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  resetTeamViewCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTeamViewCache();
});

describe("a team's panel tab", () => {
  it("opens on its Overview until you choose another, for that project only", () => {
    expect(teamView("/Users/me/pom")).toBe("overview");
    const heard = vi.fn();
    const stop = subscribeTeamView(heard);
    setTeamView("/Users/me/pom", "notes");
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teamView("/Users/me/pom")).toBe("notes");
    expect(teamView("/Users/me/pom/")).toBe("notes");
    expect(teamView("/Users/me/notes")).toBe("overview");
    // Kept under Aven's own key, read again after a restart.
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("notes");
    resetTeamViewCache();
    expect(teamView("/Users/me/pom")).toBe("notes");
  });

  it("reads anything else it finds as the Board, the old Cards choice too", () => {
    localStorage.setItem(TEAM_VIEW_KEY, '{"a": "notes", "b": 3');
    expect(teamView("a")).toBe("overview");
    localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify({ a: "cards" }));
    expect(teamView("a")).toBe("overview");
    // The v1 key (Chat or Cards) is left behind: every team opens on its Board.
    localStorage.setItem("aven.teamView.v1", JSON.stringify({ a: "notes" }));
    resetTeamViewCache();
    expect(teamView("a")).toBe("overview");
  });
});
