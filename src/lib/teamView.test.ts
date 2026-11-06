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
  it("opens on its Chat until you choose another, for that project only", () => {
    expect(teamView("/Users/me/pom")).toBe("chat");
    const heard = vi.fn();
    const stop = subscribeTeamView(heard);
    setTeamView("/Users/me/pom", "notes");
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(teamView("/Users/me/pom")).toBe("notes");
    expect(teamView("/Users/me/pom/")).toBe("notes");
    expect(teamView("/Users/me/notes")).toBe("chat");
    // Kept under Aven's own key, read again after a restart.
    expect(localStorage.getItem(TEAM_VIEW_KEY)).toContain("notes");
    resetTeamViewCache();
    expect(teamView("/Users/me/pom")).toBe("notes");
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

  it("opens the old pages, which This week and sheets took over, on the Chat", () => {
    localStorage.setItem(
      TEAM_VIEW_KEY,
      JSON.stringify({
        a: "overview",
        b: "teammates",
        c: "board",
        d: "schedule",
        e: "notes",
      }),
    );
    expect(["a", "b", "c", "d", "e"].map((key) => teamView(key))).toEqual([
      "chat",
      "chat",
      "chat",
      "chat",
      "notes",
    ]);
    // The real-app check may still show the Board for this session.
    setTeamView("c", "board");
    expect(teamView("c")).toBe("board");
  });
});
