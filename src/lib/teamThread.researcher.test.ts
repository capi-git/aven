import { describe, expect, it } from "vitest";
import { crewMemberName, newCrew, type Crew } from "./crews";
import { teamPosts, type TeamPost } from "./teamThread";

const DAY = new Date(2026, 9, 29, 9, 0).getTime();

describe("the Researcher in the team chat", () => {
  it("posts its findings as handed to you", () => {
    const crew: Crew = {
      ...newCrew("/Users/me/aven-site", 1),
      on: true,
      members: [
        { id: "builder", role: "builder" },
        { id: "researcher", role: "researcher", critter: "researcher" },
      ],
      feed: [
        {
          id: "f1",
          at: DAY,
          kind: "start",
          who: "researcher",
          member: "researcher",
          cardId: "q",
          title: "How do others debounce search?",
          text: "Researcher started reading for “How do others debounce search?”",
        },
        {
          id: "f2",
          at: DAY + 60_000,
          kind: "findings",
          who: "researcher",
          member: "researcher",
          cardId: "q",
          title: "How do others debounce search?",
          text: "Researcher read 6 sources for “How do others debounce search?”: About 200 ms.",
        },
      ],
    };
    const posts = teamPosts(crew, (who) => crewMemberName(crew, who));
    expect(posts.map((post) => post.kind)).toEqual(["post", "post"]);
    const [start, findings] = posts as Extract<TeamPost, { kind: "post" }>[];
    expect(start!.author).toMatchObject({
      id: "researcher",
      role: "researcher",
      name: "Researcher",
      critter: "researcher",
    });
    expect(start!.text).toBe(
      "Started reading for “How do others debounce search?”",
    );
    expect(findings!.text).toBe(
      "Read 6 sources for “How do others debounce search?”: About 200 ms.",
    );
    expect(findings!.card).toBe("How do others debounce search?");
    expect(findings!.handoff).toMatchObject({
      from: { id: "researcher" },
      to: "you",
      label: "Findings for you",
    });
  });
});
