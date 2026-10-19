// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GETTING_STARTED_KEY,
  loadGettingStarted,
  offerGettingStarted,
} from "../lib/gettingStarted";
import { recordHarnessAvailability } from "../lib/harness/availability";
import { HARNESSES } from "../lib/session";
import {
  useGettingStarted,
  type GettingStarted,
  type GettingStartedInput,
} from "./useGettingStarted";

const SAMPLE =
  "/Users/me/Library/Application Support/Aven/sample-projects/sample-site";
const SITE = "/Users/me/code/site";

let root: Root;
let container: HTMLDivElement;
let values: Map<string, string>;
let latest: GettingStarted;

function Probe(props: GettingStartedInput) {
  latest = useGettingStarted(props);
  return null;
}

const empty: GettingStartedInput = {
  ready: true,
  sessions: [],
  history: [],
  browsers: {},
  shipped: {},
  projects: [],
};

async function render(input: Partial<GettingStartedInput> = {}) {
  await act(async () =>
    root.render(createElement(Probe, { ...empty, ...input })),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  });
  for (const harness of HARNESSES) recordHarnessAvailability(harness, false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const harness of HARNESSES) recordHarnessAvailability(harness, false);
  vi.unstubAllGlobals();
});

const typed = (cwd: string) => ({
  cwd,
  blocks: [{ role: "user" }],
});

describe("Getting started", () => {
  it("shows nothing, and stores nothing, on an install that wasn't offered it", async () => {
    recordHarnessAvailability("claude", true);
    await render({ projects: [{ path: SITE }] });
    expect(latest.card).toBeNull();
    expect(values.has(GETTING_STARTED_KEY)).toBe(false);
  });

  it("waits for the walkthrough to end, ticking what is done meanwhile", async () => {
    offerGettingStarted();
    recordHarnessAvailability("claude", true);
    await render({ ready: false, projects: [{ path: SAMPLE }] });
    expect(latest.card).toBeNull();
    expect(loadGettingStarted().ticked).toEqual(["agent", "project"]);
    await render({ ready: true, projects: [{ path: SAMPLE }] });
    expect(latest.card?.doneCount).toBe(2);
    expect(latest.card?.next).toBe("message");
  });

  it("ticks each step from what really happened, with Start on the next", async () => {
    offerGettingStarted();
    await render();
    expect(latest.card?.next).toBe("agent");
    expect(latest.card?.steps[0].detail).toBe(
      "Install an agent app and sign in",
    );

    recordHarnessAvailability("claude", true);
    await render({ projects: [{ path: SITE }, { path: SAMPLE }] });
    expect(latest.card?.steps[0].detail).toBe("Claude Code is ready");
    // The sample is the project the steps work in.
    expect(latest.target).toBe(SAMPLE);
    expect(latest.card?.steps[1].detail).toBe("sample-site");
    expect(latest.card?.steps[2].detail).toBe("Try “Make the heading bigger”");
    expect(latest.card?.next).toBe("message");

    await render({
      projects: [{ path: SAMPLE }],
      sessions: [typed(SAMPLE)],
    });
    expect(latest.card?.next).toBe("preview");

    await render({
      projects: [{ path: SAMPLE }],
      browsers: { [SAMPLE]: { tabs: [{ url: "http://127.0.0.1:8000/" }] } },
    });
    expect(latest.card?.next).toBe("ship");
    // The chat and the preview are gone again; their ticks stay.
    await render({ projects: [{ path: SAMPLE }] });
    expect(latest.card?.doneCount).toBe(4);
    expect(loadGettingStarted().ticked).toEqual([
      "agent",
      "project",
      "message",
      "preview",
    ]);
  });

  it("works in the first project when there is no sample", async () => {
    offerGettingStarted();
    await render({ projects: [{ path: SITE }] });
    expect(latest.target).toBe(SITE);
    expect(latest.card?.steps[2].detail).toBe(
      "Ask your agent for a small change",
    );
  });

  it("says when all five are done, then is gone for good", async () => {
    offerGettingStarted();
    recordHarnessAvailability("codex", true);
    const all: Partial<GettingStartedInput> = {
      projects: [{ path: SITE }],
      history: [{ cwd: SITE }],
      browsers: { [SITE]: { tabs: [{ url: "http://localhost:3000/" }] } },
      shipped: { chat: { shippedAt: 1 } },
    };
    await render(all);
    expect(latest.card?.allDone).toBe(true);
    expect(loadGettingStarted().completed).toBe(true);
    await act(async () => latest.hide());
    expect(latest.card).toBeNull();
    // A later launch doesn't show it.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(all);
    expect(latest.card).toBeNull();
  });

  it("is gone for good once hidden", async () => {
    offerGettingStarted();
    await render({ projects: [{ path: SITE }] });
    expect(latest.card).not.toBeNull();
    await act(async () => latest.hide());
    expect(latest.card).toBeNull();
    expect(loadGettingStarted().hidden).toBe(true);
  });
});
