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

describe("a team's Board or Chat", () => {
  it("opens on its Board until you choose the Chat, for that project only", () => {
    expect(teamView("/Users/me/pom")).toBe("board");
    const heard = vi.fn();
    const stop = subscribeTeamView(heard);
    setTeamView("/Users/me/pom", "chat");
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teamView("/Users/me/pom")).toBe("chat");
    expect(teamView("/Users/me/pom/")).toBe("chat");
    expect(teamView("/Users/me/notes")).toBe("board");
    // Kept under Aven's own key, read again after a restart.
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("chat");
    resetTeamViewCache();
    expect(teamView("/Users/me/pom")).toBe("chat");
  });

  it("reads anything else it finds as the Board, the old Cards choice too", () => {
    localStorage.setItem(TEAM_VIEW_KEY, '{"a": "chat", "b": 3');
    expect(teamView("a")).toBe("board");
    localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify({ a: "cards" }));
    expect(teamView("a")).toBe("board");
    // The v1 key (Chat or Cards) is left behind: every team opens on its Board.
    localStorage.setItem("aven.teamView.v1", JSON.stringify({ a: "chat" }));
    resetTeamViewCache();
    expect(teamView("a")).toBe("board");
  });
});
