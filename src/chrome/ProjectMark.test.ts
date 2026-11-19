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

const orb = () => container.querySelector<HTMLElement>(".agent-mark")!;
const kind = () =>
  container.querySelector<HTMLElement>(".project-mark")?.dataset.kind;

describe("project marks", () => {
  it("draws the project as a still orb, in the project's colour", async () => {
    await draw({ appearance: appearance({ colorIndex: 7 }) });
    expect(kind()).toBe("orb");
    expect(container.querySelector(".stack-mark")).toBeNull();
    expect(orb().dataset.tone).toBe("teal");
    expect(orb().dataset.agent).toBe("still");
    await draw({ appearance: appearance({ automaticColorIndex: 3 }) });
    expect(orb().dataset.tone).toBe("yellow");
    await draw({
      appearance: appearance({ colorIndex: 0, automaticColorIndex: 3 }),
    });
    expect(orb().hasAttribute("data-tone")).toBe(false);
    // Never an inline colour: the theme's tokens draw it.
    expect(container.querySelector("[fill='#e06c75']")).toBeNull();
  });

  it("stays still, open or not, and after a turn ends", async () => {
    await draw({ appearance: appearance(), open: true });
    expect(orb().dataset.agent).toBe("still");
    // A turn's end moves nothing: reactions are the agent's.
    await draw({ appearance: appearance() });
    await act(async () => void recordActivity(turn("t1")));
    expect(orb().hasAttribute("data-reaction")).toBe(false);
    // Nothing watched, so nothing was claimed for another window to miss.
    expect(storage.has(REACTION_CLAIMS_KEY)).toBe(false);
  });

  it("draws only a chosen logo in the sidebar, and nothing otherwise", async () => {
    await draw({ appearance: appearance({ colorIndex: 7 }), logoOnly: true });
    expect(container.querySelector(".project-mark")).toBeNull();
    expect(container.querySelector(".agent-mark")).toBeNull();
    // A logo the person chose still stands before the name.
    await draw({
      appearance: appearance({ logoSrc: "asset://logo.png" }),
      logoOnly: true,
    });
    expect(kind()).toBe("logo");
  });

  it("keeps a logo as it is, open or not", async () => {
    await draw({
      appearance: appearance({ logoSrc: "asset://logo.png" }),
      open: true,
    });
    expect(kind()).toBe("logo");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "asset://logo.png",
    );
    expect(container.querySelector(".agent-mark")).toBeNull();
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
