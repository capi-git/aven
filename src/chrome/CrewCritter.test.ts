// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectKey } from "../lib/paths";
import { crewMemberTone } from "../lib/markTones";
import { saveTabGroupColor } from "../lib/tabGroups";
import { BotCritter } from "./BotCritter";
import { CrewCritter, CrewCritters } from "./CrewCritter";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`,
  invoke: vi.fn(),
}));

const APP = "/Users/me/Developer/app";
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function draw(element: ReactElement) {
  await act(async () => root.render(element));
}

const tones = () =>
  [...host.querySelectorAll<HTMLElement>(".dot-mark")].map(
    (mark) => mark.dataset.tone ?? "grey",
  );

describe("crew marks", () => {
  it("each take the teammate's own colour, whatever the project's", async () => {
    saveTabGroupColor(projectKey(APP), 4);
    await draw(
      createElement(CrewCritters, {
        path: APP,
        roles: ["builder", "checker", "security", "scout"],
        active: "builder",
        max: 4,
      }),
    );
    expect(tones()).toEqual(["blue", "purple", "pink", "teal"]);
    // The working one sweeps in its colour too.
    expect(
      host.querySelector<HTMLElement>('.dot-mark[data-state="working"]')
        ?.dataset.tone,
    ).toBe("blue");
    await act(async () => saveTabGroupColor(projectKey(APP), 6));
    expect(tones()).toEqual(["blue", "purple", "pink", "teal"]);
  });

  it("never wears a colour that says what's happening", () => {
    for (const [role, mark] of [
      ["builder"],
      ["builder", "designer"],
      ["builder", "tester"],
      ["builder", "scribe"],
      ["builder", "moon"],
      ["checker"],
      ["security"],
      ["scout"],
      ["someone-new"],
    ] as const)
      expect(["yellow", "green", "red"]).not.toContain(
        crewMemberTone(role, mark),
      );
  });

  it("keeps a member's own mark, with a job's colour for a Tester", async () => {
    await draw(
      createElement(CrewCritter, {
        path: APP,
        role: "builder",
        critter: "tester",
      }),
    );
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.dataset.sigil).toBe("tester");
    expect(mark.dataset.tone).toBe("orange");
    // A mark you chose keeps its role's colour.
    await draw(
      createElement(CrewCritter, {
        path: APP,
        role: "checker",
        critter: "moon",
      }),
    );
    expect(tones()).toEqual(["purple"]);
  });

  it("draws the Fixer in its project's colour", async () => {
    saveTabGroupColor(projectKey(APP), 4);
    await draw(createElement(CrewCritter, { path: APP, role: "fixer" }));
    expect(tones()).toEqual(["green"]);
  });

  it("draws a project's bot in the project's colour", async () => {
    saveTabGroupColor(projectKey(APP), 8);
    await draw(createElement(BotCritter, { path: APP }));
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.dataset.sigil).toBe("fixer");
    expect(mark.dataset.tone).toBe("orange");
  });
});
