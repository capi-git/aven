import { describe, expect, it } from "vitest";
import {
  crewMemberPagesReachWeb,
  crewMemberSeesPages,
  crewMemberUsesBrowser,
  crewRoleUsesBrowser,
  crewRoleUsesWeb,
  type Crew,
  type CrewAccess,
  type CrewMember,
} from "./crews";

const LEAD: CrewMember = { id: "lead", role: "lead" };
const SCOUT: CrewMember = { id: "scout", role: "scout" };
const OF_AVOS: CrewMember = {
  id: "helper-1",
  role: "helper",
  helperOf: "lead",
};
const OF_SCOUT: CrewMember = {
  id: "helper-2",
  role: "helper",
  helperOf: "scout",
};

const crew = (
  web: CrewAccess["web"],
  more: Partial<Pick<Crew, "planning">> = {},
) => ({
  access: { deletes: true, web, others: "refuse" as const },
  members: [LEAD, SCOUT, { id: "builder", role: "builder" as const }],
  ...more,
});

describe("who looks at pages in Aven's browser", () => {
  it("lets Avos look whenever it may read the web, and never once you turned the web off", () => {
    for (const web of ["builders", "everyone"] as const) {
      expect(crewRoleUsesBrowser(crew(web), "lead")).toBe(true);
      expect(crewMemberSeesPages(crew(web), LEAD)).toBe(true);
    }
    expect(crewRoleUsesBrowser(crew("none"), "lead")).toBe(false);
    expect(crewMemberSeesPages(crew("none"), LEAD)).toBe(false);
    // As it starts, with nothing set: Avos has the web, so it looks.
    expect(crewRoleUsesBrowser({}, "lead")).toBe(true);
  });

  it("lets a helper Avos started look, and no helper anyone else started", () => {
    expect(crewMemberUsesBrowser(crew("builders"), OF_AVOS)).toBe(true);
    expect(crewMemberUsesBrowser(crew("everyone"), OF_SCOUT)).toBe(false);
    expect(crewMemberUsesBrowser(crew("none"), OF_AVOS)).toBe(false);
    // A helper whose starter is unknown (a removed one's chat) never looks.
    expect(crewMemberUsesBrowser(crew("everyone"), { role: "helper" })).toBe(
      false,
    );
    // With no Avos in the team, nobody's helper is Avos's.
    expect(
      crewMemberUsesBrowser({ ...crew("everyone"), members: [SCOUT] }, OF_AVOS),
    ).toBe(false);
  });

  it("gives a helper pages, never the search and fetch tools", () => {
    expect(crewRoleUsesWeb(crew("everyone"), "helper")).toBe(false);
    // Its pages reach the web exactly when Avos's do.
    expect(crewMemberPagesReachWeb(crew("builders"), OF_AVOS)).toBe(true);
    expect(crewMemberPagesReachWeb(crew("none"), OF_AVOS)).toBe(false);
    expect(crewMemberPagesReachWeb(crew("everyone"), OF_SCOUT)).toBe(false);
    expect(crewMemberPagesReachWeb(crew("builders"), LEAD)).toBe(true);
    expect(crewMemberPagesReachWeb(crew("builders"), SCOUT)).toBe(false);
  });

  it("leaves everyone else as Access set them", () => {
    expect(crewRoleUsesBrowser(crew("builders"), "builder")).toBe(true);
    expect(crewRoleUsesBrowser(crew("builders"), "checker")).toBe(true);
    expect(crewRoleUsesBrowser(crew("builders"), "scout")).toBe(false);
    expect(crewRoleUsesBrowser(crew("everyone"), "designer")).toBe(false);
    expect(crewRoleUsesBrowser(crew("none"), "builder")).toBe(false);
  });

  it("gives no pages to one on Codex, or to one planning the goal", () => {
    expect(
      crewMemberSeesPages(crew("everyone"), { ...LEAD, harness: "codex" }),
    ).toBe(false);
    expect(
      crewMemberSeesPages(crew("everyone", { planning: "builder" }), {
        id: "builder",
        role: "builder",
      }),
    ).toBe(false);
  });
});
