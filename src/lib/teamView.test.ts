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

describe("what an Avos screen shows", () => {
  it("opens on its Chat; the real-app check's Board is for that project and this session only", () => {
    expect(teamView("/Users/me/pom")).toBe("chat");
    const heard = vi.fn();
    const stop = subscribeTeamView(heard);
    setTeamView("/Users/me/pom", "board");
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teamView("/Users/me/pom")).toBe("board");
    expect(teamView("/Users/me/pom/")).toBe("board");
    expect(teamView("/Users/me/notes")).toBe("chat");
    // Kept under Aven's own key, but after a restart it's the Chat again.
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("board");
    resetTeamViewCache();
    expect(teamView("/Users/me/pom")).toBe("chat");
  });

  it("reads anything else it finds as the Chat, the old Cards choice too", () => {
    localStorage.setItem(TEAM_VIEW_KEY, '{"a": "notes", "b": 3');
    expect(teamView("a")).toBe("chat");
    localStorage.setItem(TEAM_VIEW_KEY, JSON.stringify({ a: "cards" }));
    expect(teamView("a")).toBe("chat");
    // The v1 key (Chat or Cards) is left behind.
    localStorage.setItem("aven.teamView.v1", JSON.stringify({ a: "notes" }));
    resetTeamViewCache();
    expect(teamView("a")).toBe("chat");
  });

  it("opens the old pages and tabs, which Avos's chat, profile and sheets took over, on the Chat", () => {
    const old = [
      "overview",
      "teammates",
      "board",
      "schedule",
      "changes",
      "notes",
      "agents",
    ];
    localStorage.setItem(
      TEAM_VIEW_KEY,
      JSON.stringify(Object.fromEntries(old.map((view) => [view, view]))),
    );
    expect(old.map((key) => teamView(key))).toEqual(old.map(() => "chat"));
    // The real-app check may still show the Board for this session.
    setTeamView("board", "board");
    expect(teamView("board")).toBe("board");
  });
});
