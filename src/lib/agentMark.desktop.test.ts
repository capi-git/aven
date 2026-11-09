import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_FACES,
  agentDesktopFaces,
  agentFace,
  type AgentDesktopState,
} from "./agentMark";

/** The faces the desktop bar falls back on, as written in its Rust. */
function nativeDefaults(): Record<AgentDesktopState, string[]> {
  const source = readFileSync("src-tauri/src/desktop_faces.rs", "utf8");
  const face = (state: AgentDesktopState) => {
    const name = `DEFAULT_${state.toUpperCase()}`;
    const block = new RegExp(
      `const ${name}: \\[&str; ROWS\\] = \\[([^\\]]*)\\]`,
    );
    const found = block.exec(source);
    if (!found) throw new Error(`${name} is missing from desktop_faces.rs`);
    return [...found[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  };
  return {
    still: face("still"),
    watching: face("watching"),
    working: face("working"),
    needs: face("needs"),
  };
}

describe("agentDesktopFaces", () => {
  it("is agentFace for each state the desktop shows", () => {
    for (const outfit of [undefined, "headset", "hat", "tick"] as const)
      for (const [state, rows] of Object.entries(agentDesktopFaces(outfit)))
        expect(rows).toEqual(
          AGENT_FACES.large[agentFace(state as AgentDesktopState, outfit)],
        );
  });

  it("gives a teammate its role's face while calm, and everyone's at work", () => {
    expect(agentDesktopFaces("hat")).toEqual({
      still: AGENT_FACES.large.code,
      watching: AGENT_FACES.large.code,
      working: AGENT_FACES.large.narrow,
      needs: AGENT_FACES.large.chevron,
    });
  });

  it("matches the desktop's own faces for a plain chat", () => {
    expect(nativeDefaults()).toEqual(agentDesktopFaces(undefined));
  });
});
