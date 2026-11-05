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

const states = () =>
  [...host.querySelectorAll<HTMLElement>(".hopper-mark")].map(
    (mark) => mark.dataset.hopper,
  );

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
    // Every one is Hopper; the working one hops in its colour too.
    expect(host.querySelectorAll(".hopper-mark")).toHaveLength(4);
    expect(
      host.querySelector<HTMLElement>('.hopper-mark[data-hopper="working"]')
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

  it("keeps the colour of a mark chosen before Hopper, orange for a Tester", async () => {
    await draw(
      createElement(CrewCritter, {
        path: APP,
        role: "builder",
        critter: "tester",
      }),
    );
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.classList.contains("hopper-mark")).toBe(true);
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

  it("draws the Fixer and the Lead (Avos) in their project's colour", async () => {
    saveTabGroupColor(projectKey(APP), 4);
    await draw(createElement(CrewCritter, { path: APP, role: "fixer" }));
    expect(tones()).toEqual(["green"]);
    await draw(createElement(CrewCritter, { path: APP, role: "lead" }));
    expect(tones()).toEqual(["green"]);
    await act(async () => saveTabGroupColor(projectKey(APP), 1));
    expect(tones()).toEqual(["blue"]);
  });

  it("stands still unless it has a state, and works when active", async () => {
    await draw(createElement(CrewCritter, { path: APP, role: "checker" }));
    expect(states()).toEqual(["still"]);
    await draw(
      createElement(CrewCritter, { path: APP, role: "checker", active: true }),
    );
    expect(states()).toEqual(["working"]);
    await draw(
      createElement(CrewCritter, {
        path: APP,
        role: "checker",
        active: true,
        state: "needs",
      }),
    );
    expect(states()).toEqual(["needs"]);
  });

  it("draws a project's bot as Hopper in the project's colour, by its word", async () => {
    saveTabGroupColor(projectKey(APP), 8);
    await draw(createElement(BotCritter, { path: APP }));
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.classList.contains("hopper-mark")).toBe(true);
    expect(mark.dataset.tone).toBe("orange");
    expect(states()).toEqual(["still"]);
    for (const [status, state] of [
      ["watching", "watching"],
      ["working", "working"],
      ["needs-you", "needs"],
      ["fix-ready", "resting"],
      ["paused", "still"],
    ] as const) {
      await draw(createElement(BotCritter, { path: APP, status }));
      expect(states()).toEqual([state]);
    }
    await draw(createElement(BotCritter, { path: APP, active: true }));
    expect(states()).toEqual(["working"]);
  });
});
