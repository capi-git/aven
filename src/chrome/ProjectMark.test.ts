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

const mark = () => container.querySelector<HTMLElement>(".project-mark")!;
const kind = () =>
  container.querySelector<HTMLElement>(".project-mark")?.dataset.kind;

describe("project marks", () => {
  it("draws the project as an orb, in the project's colour", async () => {
    await draw({ appearance: appearance({ colorIndex: 7 }) });
    expect(kind()).toBe("orb");
    expect(container.querySelector(".project-mark-orb")).not.toBeNull();
    expect(mark().dataset.tone).toBe("teal");
    // No dots: the sigil the project saved stays saved, for its agents.
    expect(container.querySelector(".dot-mark")).toBeNull();
    await draw({ appearance: appearance({ automaticColorIndex: 3 }) });
    expect(mark().dataset.tone).toBe("yellow");
    await draw({
      appearance: appearance({ colorIndex: 0, automaticColorIndex: 3 }),
    });
    expect(mark().hasAttribute("data-tone")).toBe(false);
    // Never an inline colour: the theme's tokens draw it.
    expect(mark().hasAttribute("style")).toBe(false);
    expect(container.querySelector("[fill='#e06c75']")).toBeNull();
  });

  it("moves only while an agent works there", async () => {
    await draw({ appearance: appearance() });
    expect(mark().hasAttribute("data-working")).toBe(false);
    await draw({ appearance: appearance(), working: true });
    expect(mark().hasAttribute("data-working")).toBe(true);
    // A turn's end moves nothing: reactions are the agent's own mark's.
    await draw({ appearance: appearance() });
    await act(async () => void recordActivity(turn("t1")));
    expect(mark().hasAttribute("data-reaction")).toBe(false);
    // Nothing watched, so nothing was claimed for another window to miss.
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);
  });

  it("draws only a chosen logo in the sidebar, and nothing otherwise", async () => {
    await draw({ appearance: appearance({ colorIndex: 7 }), logoOnly: true });
    expect(container.querySelector(".project-mark")).toBeNull();
    expect(container.querySelector(".project-mark-orb")).toBeNull();
    // A logo the person chose still stands before the name.
    await draw({
      appearance: appearance({ logoSrc: "asset://logo.png" }),
      logoOnly: true,
    });
    expect(kind()).toBe("logo");
  });

  it("keeps a logo as it is, working or not", async () => {
    await draw({
      appearance: appearance({ logoSrc: "asset://logo.png" }),
      working: true,
    });
    expect(kind()).toBe("logo");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "asset://logo.png",
    );
    expect(container.querySelector(".project-mark-orb")).toBeNull();
    expect(mark().hasAttribute("data-working")).toBe(false);
  });

  it("falls back to the orb when the logo file is gone", async () => {
    await draw({ appearance: appearance({ logoSrc: "asset://gone.png" }) });
    await act(async () => {
      container.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(kind()).toBe("orb");
  });

  it("renders nothing for a folder that isn't a project", async () => {
    await draw({ appearance: null });
    expect(container.innerHTML).toBe("");
  });
});
