// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActivitySnapshot,
  recordActivity,
  type ActivityInput,
} from "../lib/activity";
import { REACTION_CLAIMS_KEY } from "../lib/mascotReactions";
import { projectKey } from "../lib/paths";
import { CROSS_ROWS, TICK_ROWS, litPath, projectSigil } from "../lib/dotSigils";
import type { ProjectAppearance } from "../lib/projectAppearance";
import { ProjectMark } from "./ProjectMark";

const APP = "/projects/app";
let root: Root;
let container: HTMLDivElement;
let storage: Map<string, string>;

function appearance(patch: Partial<ProjectAppearance> = {}): ProjectAppearance {
  return {
    key: projectKey(APP),
    label: "app",
    customLabel: null,
    color: "#e06c75",
    colorIndex: null,
    customColor: null,
    automaticColorIndex: 0,
    logoPath: null,
    logoSrc: null,
    mascot: "jelly",
    ...patch,
  } as ProjectAppearance;
}

function turn(id: string, patch: Partial<ActivityInput> = {}): ActivityInput {
  return {
    id,
    sessionId: "s1",
    outcome: "completed",
    title: "Task",
    summary: "",
    cwd: APP,
    harness: "codex",
    model: "gpt-5",
    ...patch,
  };
}

const dots = () => container.querySelector<HTMLElement>(".dot-mark")!;
const lit = () =>
  container.querySelector(".dot-mark-lit")?.getAttribute("d") ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  getActivitySnapshot();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function draw(props: Parameters<typeof ProjectMark>[0]) {
  await act(async () => root.render(createElement(ProjectMark, props)));
}

describe("project marks", () => {
  it("draws the project's sigil in dots, with no colour of its own", async () => {
    await draw({ appearance: appearance() });
    const mark = container.querySelector<HTMLElement>(".project-mark")!;
    expect(mark.dataset.kind).toBe("mark");
    // The jellyfish it saved reads as its sigil.
    expect(dots().dataset.sigil).toBe("bars");
    expect(dots().dataset.state).toBe("still");
    expect(lit()).toBe(litPath(projectSigil("jelly").rows));
    expect(dots().getAttribute("style")).toBeNull();
    expect(container.querySelector("[fill='#e06c75']")).toBeNull();
  });

  it("sweeps a light across it while an agent works", async () => {
    await draw({ appearance: appearance(), active: true });
    expect(
      container.querySelector(".project-mark")?.hasAttribute("data-active"),
    ).toBe(true);
    expect(dots().dataset.state).toBe("working");
    expect(
      container.querySelectorAll(".dot-mark-lit-d").length,
    ).toBeGreaterThan(1);
    expect(container.querySelectorAll(".dot-mark-grid-d")).toHaveLength(9);
  });
});

describe("mark reactions", () => {
  it("turns into a tick with a green dot once when a turn completes, then rests", async () => {
    await draw({ appearance: appearance(), active: true, reacts: true });
    expect(dots().dataset.state).toBe("working");
    await act(async () => void recordActivity(turn("t1")));
    expect(dots().dataset.reaction).toBe("cheer");
    expect(
      container.querySelector(".project-mark")?.getAttribute("data-reaction"),
    ).toBe("cheer");
    // The finished turn stops the sweep; the tick takes its place.
    expect(dots().dataset.state).toBe("done");
    expect(lit()).toBe(litPath(TICK_ROWS));
    expect(container.querySelector(".dot-mark-was")).not.toBeNull();
    expect(container.querySelector(".dot-mark-status")).not.toBeNull();
    expect(dots().style.getPropertyValue("--dot-mark-reaction-ms")).toBe(
      "900ms",
    );
    await act(async () => void vi.advanceTimersByTime(1200));
    expect(dots().dataset.reaction).toBeUndefined();
    // Still drawn as working here: the caller never said the agent stopped.
    expect(dots().dataset.state).toBe("working");
    expect(container.querySelector(".dot-mark-status")).toBeNull();
  });

  it("turns into a cross on failure and dims once on stop", async () => {
    await draw({ appearance: appearance(), reacts: true });
    await act(
      async () => void recordActivity(turn("t1", { outcome: "failed" })),
    );
    expect(dots().dataset.reaction).toBe("slump");
    expect(dots().dataset.state).toBe("error");
    expect(lit()).toBe(litPath(CROSS_ROWS));
    await act(
      async () => void recordActivity(turn("t2", { outcome: "stopped" })),
    );
    expect(dots().dataset.reaction).toBe("shrug");
    // A stop keeps the sigil; only the dots dim once.
    expect(dots().dataset.state).toBe("still");
    expect(lit()).toBe(litPath(projectSigil("jelly").rows));
    expect(container.querySelector(".dot-mark-status")).toBeNull();
  });

  it("restarts the animation for a new turn end", async () => {
    await draw({ appearance: appearance(), reacts: true });
    await act(async () => void recordActivity(turn("t1")));
    const first = dots();
    await act(async () => void recordActivity(turn("t2")));
    expect(dots()).not.toBe(first);
    expect(dots().dataset.reaction).toBe("cheer");
  });

  it("stays still where reactions are not asked for, and for logos", async () => {
    await draw({ appearance: appearance() });
    await act(async () => void recordActivity(turn("t1")));
    expect(dots().dataset.reaction).toBeUndefined();
    // Nothing watched, so nothing was claimed for another window to miss.
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);

    await draw({
      appearance: appearance({ logoSrc: "asset://logo.png" }),
      reacts: true,
    });
    await act(async () => void recordActivity(turn("t2")));
    expect(container.querySelector("img")).not.toBeNull();
    expect(
      container.querySelector(".project-mark")?.getAttribute("data-reaction"),
    ).toBeNull();
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);
  });

  it("reacts only for its own project", async () => {
    await draw({ appearance: appearance(), reacts: true });
    await act(
      async () => void recordActivity(turn("t1", { cwd: "/projects/other" })),
    );
    expect(dots().dataset.reaction).toBeUndefined();
  });
});
