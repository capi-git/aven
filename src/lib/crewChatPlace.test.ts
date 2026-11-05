import { describe, expect, it } from "vitest";
import { crewChatPlace } from "./crewChatPlace";

const chat = {
  harness: "claude",
  model: "claude:sonnet-5",
  runtimeMode: "auto",
  providerSessionId: "p1",
};
const lead = { role: "lead" as const, harness: "claude" as const };
const builder = { role: "builder" as const, harness: "claude" as const };
const model = () => "claude:opus-5.5";
const copy = {
  path: "/data/crews/site",
  branch: "aven/crew/site",
  root: "/Users/me/site",
};

describe("where a helper's chat runs", () => {
  it("lets Avos's first message go in a new Avos, Git or not: it reads your folder until there's a copy", () => {
    // Just met, awake, no copy yet (a folder without Git never gets one).
    expect(crewChatPlace(chat, { on: true }, lead, model)).toBeNull();
  });

  it("brings Avos back to your folder when its copy went away", () => {
    const moved = crewChatPlace(
      { ...chat, worktreeCwd: copy.path },
      { on: true },
      lead,
      model,
    );
    expect(moved).toEqual({
      restart: true,
      chat: {
        ...chat,
        worktreeCwd: undefined,
        providerSessionId: undefined,
        pendingSwitch: undefined,
      },
    });
  });

  it("moves Avos into the copy once there is one", () => {
    const moved = crewChatPlace(chat, { on: true, copy }, lead, model);
    expect(moved).toMatchObject({
      restart: true,
      chat: { worktreeCwd: copy.path, providerSessionId: undefined },
    });
    expect(
      crewChatPlace(
        { ...chat, worktreeCwd: copy.path },
        { on: true, copy },
        lead,
        model,
      ),
    ).toBeNull();
  });

  it("keeps every other helper out until the copy exists, and says why", () => {
    expect(crewChatPlace(chat, { on: true }, builder, model)).toBe(
      "The project's copy isn't ready yet. Try again in a moment.",
    );
    expect(crewChatPlace(chat, { on: false, copy }, lead, model)).toBe(
      "Avos is off. Open Avos to wake it.",
    );
  });
});
