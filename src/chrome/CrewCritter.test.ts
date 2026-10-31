// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectKey } from "../lib/paths";
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
  it("take their crew's project colour, and follow it when it changes", async () => {
    saveTabGroupColor(projectKey(APP), 4);
    await draw(
      createElement(CrewCritters, {
        path: APP,
        roles: ["builder", "checker", "security"],
        active: "builder",
      }),
    );
    expect(tones()).toEqual(["green", "green", "green"]);
    // The working one sweeps in the colour too.
    expect(
      host.querySelector<HTMLElement>('.dot-mark[data-state="working"]')
        ?.dataset.tone,
    ).toBe("green");
    await act(async () => saveTabGroupColor(projectKey(APP), 6));
    expect(tones()).toEqual(["purple", "purple", "purple"]);
    await act(async () => saveTabGroupColor(projectKey(APP), 0));
    expect(tones()).toEqual(["grey", "grey", "grey"]);
  });

  it("keeps a member's own sigil, in the crew's colour", async () => {
    saveTabGroupColor(projectKey(APP), 1);
    await draw(createElement(CrewCritter, { path: APP, role: "scout" }));
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.dataset.sigil).toBe("scout");
    expect(mark.dataset.tone).toBe("blue");
  });

  it("is plain with no project to take a colour from", async () => {
    await draw(createElement(CrewCritter, { role: "builder" }));
    expect(tones()).toEqual(["grey"]);
  });

  it("draws a project's bot in the project's colour", async () => {
    saveTabGroupColor(projectKey(APP), 8);
    await draw(createElement(BotCritter, { path: APP }));
    const mark = host.querySelector<HTMLElement>(".dot-mark")!;
    expect(mark.dataset.sigil).toBe("fixer");
    expect(mark.dataset.tone).toBe("orange");
  });
});
