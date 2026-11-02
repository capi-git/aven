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

describe("a team's Chat or Cards", () => {
  it("opens on its Chat until you choose Cards, for that project only", () => {
    expect(teamView("/Users/me/pom")).toBe("chat");
    const heard = vi.fn();
    const stop = subscribeTeamView(heard);
    setTeamView("/Users/me/pom", "cards");
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teamView("/Users/me/pom")).toBe("cards");
    expect(teamView("/Users/me/pom/")).toBe("cards");
    expect(teamView("/Users/me/notes")).toBe("chat");
    // Kept under Aven's own key, read again after a restart.
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("cards");
    resetTeamViewCache();
    expect(teamView("/Users/me/pom")).toBe("cards");
  });

  it("reads anything else it finds as Chat", () => {
    localStorage.setItem(TEAM_VIEW_KEY, '{"a": "board", "b": 3');
    expect(teamView("a")).toBe("chat");
    localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify({ a: "board" }));
    expect(teamView("a")).toBe("chat");
  });
});
