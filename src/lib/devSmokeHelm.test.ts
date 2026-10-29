// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  helmDialogProblem,
  helmStopProblem,
  helmWorkingProblem,
  restoringComposer,
} from "./devSmokeHelm";

const rect = (top: number, bottom: number, left = 0, right = 800) => ({
  top,
  bottom,
  left,
  right,
});

describe("the helm's dialog", () => {
  const box = rect(700, 750);
  const field = rect(701, 749, 1, 799);

  it("sits above the message box", () => {
    expect(helmDialogProblem(rect(480, 660, 480, 800), box, field)).toBeNull();
  });

  it("is named when it reaches into the box or over the words", () => {
    expect(helmDialogProblem(rect(560, 720, 480, 800), box, field)).toBe(
      "the dialog reaches 20px into the message box",
    );
  });
});

describe("one Stop", () => {
  const pane = (html: string) => {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element;
  };
  const bubble =
    '<div data-helm-say="running"><button data-helm-stop aria-label="Stop"></button></div>';

  it("is the critter's, in its bubble", () => {
    expect(helmStopProblem(pane(bubble))).toBeNull();
  });

  it("is the team bar's for a lead", () => {
    expect(
      helmStopProblem(pane('<div data-helm-say="running"></div>'), true),
    ).toBeNull();
    expect(helmStopProblem(pane(bubble), true)).toBe(
      "the message box offers 1 Stops, not 0",
    );
  });

  it("names a Working row or a second Stop", () => {
    expect(
      helmStopProblem(pane(`<div class="session-run-status"></div>${bubble}`)),
    ).toBe("the Working row is still above the message box");
    expect(
      helmStopProblem(
        pane(`<button class="session-run-stop">Stop</button>${bubble}`),
      ),
    ).toBe("the run status offers a Stop of its own");
    expect(helmStopProblem(pane('<div data-helm-say="running"></div>'))).toBe(
      "the message box offers 0 Stops, not 1",
    );
  });
});

describe("a working critter", () => {
  const helm = (html: string, pose = "running") => {
    const element = document.createElement("div");
    element.dataset.pose = pose;
    element.innerHTML = html;
    return element;
  };
  const working =
    '<svg><g class="helm-critter-laptop"></g></svg><div data-helm-say="running"><span role="timer">0:04</span></div>';

  it("types at its laptop, stepping its frames, and says for how long", () => {
    expect(helmWorkingProblem(helm(working), "helm-frame-a", false)).toBeNull();
    expect(helmWorkingProblem(helm(working), "none", true)).toBeNull();
  });

  it("is named when it is not", () => {
    expect(helmWorkingProblem(null, "", false)).toBe(
      "the message box has no helm",
    );
    expect(helmWorkingProblem(helm(working, "rest"), "", false)).toBe(
      "the critter is rest, not running",
    );
    expect(helmWorkingProblem(helm(working), "none", false)).toBe(
      "the laptop frames: its animation is none, expected helm-frame-a",
    );
  });
});

describe("a check that zooms and types", () => {
  const cleanup = () => ({
    restoreZoom: vi.fn(async () => undefined),
    closeDialog: vi.fn(),
    clearField: vi.fn(),
  });

  it("leaves the app at its zoom with an empty box when it passes", async () => {
    const steps = cleanup();
    expect(await restoringComposer(steps, async () => "ok")).toBe("ok");
    expect(steps.restoreZoom).toHaveBeenCalledOnce();
    expect(steps.closeDialog).toHaveBeenCalledOnce();
    expect(steps.clearField).toHaveBeenCalledOnce();
  });

  it("does the same when it fails midway, and reports the check's failure", async () => {
    const steps = cleanup();
    steps.restoreZoom.mockRejectedValue(new Error("no webview"));
    await expect(
      restoringComposer(steps, async () => {
        throw new Error("At 80% zoom, line 1 is painted 9px above");
      }),
    ).rejects.toThrow("At 80% zoom, line 1 is painted 9px above");
    expect(steps.restoreZoom).toHaveBeenCalledOnce();
    expect(steps.closeDialog).toHaveBeenCalledOnce();
    expect(steps.clearField).toHaveBeenCalledOnce();
  });

  it("still clears the box when closing the dialog throws", async () => {
    const steps = cleanup();
    steps.closeDialog.mockImplementation(() => {
      throw new Error("gone");
    });
    await expect(restoringComposer(steps, async () => 1)).rejects.toThrow(
      "gone",
    );
    expect(steps.clearField).toHaveBeenCalledOnce();
  });
});
