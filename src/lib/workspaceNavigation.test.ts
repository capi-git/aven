import { describe, expect, it } from "vitest";
import {
  createWorkspaceNavigation,
  recordWorkspaceLocation,
  visitWorkspaceLocation,
  type WorkspaceLocation,
} from "./workspaceNavigation";

const session: WorkspaceLocation = {
  kind: "workspace",
  cwd: "/work",
  profileId: "work",
  surfaceId: "session",
  tabId: "session",
};
describe("workspace destination history", () => {
  it("returns from Settings with only one session and permits Forward", () => {
    const settings: WorkspaceLocation = {
      ...session,
      kind: "settings",
      settingsSection: "general",
    };
    const history = recordWorkspaceLocation(
      createWorkspaceNavigation(session),
      settings,
    );
    const back = visitWorkspaceLocation(history, "back", () => true)!;
    expect(back.current).toEqual(session);
    expect(
      visitWorkspaceLocation(back, "forward", () => true)?.current,
    ).toEqual(settings);
  });
  it("tracks a browser and file independently of the backing task", () => {
    const browser = { ...session, surfaceId: "browser:a" };
    const file = { ...session, paneId: "editor", fileId: "readme" };
    let history = recordWorkspaceLocation(
      createWorkspaceNavigation(session),
      browser,
    );
    history = recordWorkspaceLocation(history, file);
    expect(history.back).toEqual([session, browser]);
  });
  it("skips a closed destination, bounds memory, and clears Forward on a new visit", () => {
    let history = createWorkspaceNavigation(session);
    for (let i = 0; i < 75; i++)
      history = recordWorkspaceLocation(history, {
        ...session,
        surfaceId: String(i),
      });
    expect(history.back).toHaveLength(50);
    const back = visitWorkspaceLocation(
      history,
      "back",
      (place) => place.surfaceId !== "73",
    )!;
    expect(back.current.surfaceId).toBe("72");
    const next = recordWorkspaceLocation(back, { ...session, kind: "home" });
    expect(next.forward).toEqual([]);
    expect(
      recordWorkspaceLocation(next, {
        ...session,
        kind: "home",
        surfaceId: "ignored",
      }),
    ).toBe(next);
  });
});
