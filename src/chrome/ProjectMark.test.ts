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
import type { ProjectAppearance } from "../lib/projectAppearance";
import {
  MASCOT_SPARKLE_PATH,
  MASCOT_SWEAT_PATH,
  projectMascot,
} from "../lib/projectMascots";
import { ProjectMark } from "./ProjectMark";
import { ProjectMascot } from "./ProjectMascot";

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
    mascot: "ghost",
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

const svg = () => container.querySelector("svg")!;

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

describe("mark reactions", () => {
  it("hops with a sparkle once when a turn completes, then rests", async () => {
    await draw({ appearance: appearance(), active: true, reacts: true });
    expect(svg().classList.contains("mascot-active")).toBe(true);
    await act(async () => void recordActivity(turn("t1")));
    expect(svg().dataset.reaction).toBe("cheer");
    expect(
      container.querySelector(".project-mark")?.getAttribute("data-reaction"),
    ).toBe("cheer");
    // The finished turn stops the working loop; the reaction takes its place.
    expect(svg().classList.contains("mascot-active")).toBe(false);
    expect(container.querySelector(".mascot-sparkle")?.getAttribute("d")).toBe(
      MASCOT_SPARKLE_PATH,
    );
    expect(svg().style.getPropertyValue("--mascot-reaction-ms")).toBe("900ms");
    await act(async () => void vi.advanceTimersByTime(1200));
    expect(svg().dataset.reaction).toBeUndefined();
    expect(container.querySelector(".mascot-sparkle")).toBeNull();
  });

  it("slumps with a grey drop on failure and blinks on stop", async () => {
    await draw({ appearance: appearance(), reacts: true });
    await act(
      async () => void recordActivity(turn("t1", { outcome: "failed" })),
    );
    expect(svg().dataset.reaction).toBe("slump");
    expect(container.querySelector(".mascot-sweat")?.getAttribute("d")).toBe(
      MASCOT_SWEAT_PATH,
    );
    await act(
      async () => void recordActivity(turn("t2", { outcome: "stopped" })),
    );
    expect(svg().dataset.reaction).toBe("shrug");
    expect(container.querySelector(".mascot-blink")?.getAttribute("d")).toBe(
      projectMascot(APP, "ghost").blinkPath,
    );
  });

  it("restarts the animation for a new turn end", async () => {
    await draw({ appearance: appearance(), reacts: true });
    await act(async () => void recordActivity(turn("t1")));
    const first = svg();
    await act(async () => void recordActivity(turn("t2")));
    expect(svg()).not.toBe(first);
    expect(svg().dataset.reaction).toBe("cheer");
  });

  it("stays still where reactions are not asked for, and for logos", async () => {
    await draw({ appearance: appearance() });
    await act(async () => void recordActivity(turn("t1")));
    expect(svg().dataset.reaction).toBeUndefined();
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
    expect(svg().dataset.reaction).toBeUndefined();
  });
});

describe("ProjectMascot", () => {
  it("keeps its plain frames when not reacting", async () => {
    await act(async () =>
      root.render(createElement(ProjectMascot, { project: APP, active: true })),
    );
    expect(container.querySelectorAll("path")).toHaveLength(2);
    expect(svg().getAttribute("overflow")).toBeNull();
  });

  it("draws reaction overlays outside its box without clipping", async () => {
    await act(async () =>
      root.render(
        createElement(ProjectMascot, {
          project: APP,
          reaction: "cheer",
          reactionId: "t1",
        }),
      ),
    );
    expect(svg().getAttribute("overflow")).toBe("visible");
    expect(svg().getAttribute("shape-rendering")).toBe("crispEdges");
    expect(container.querySelector(".mascot-body path")).not.toBeNull();
  });
});
