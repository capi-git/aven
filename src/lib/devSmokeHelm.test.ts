// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  closeHelmDialog,
  helmDialogProblem,
  helmStopProblem,
  helmStateWords,
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

describe("a working mark", () => {
  const helm = (html: string, pose = "running") => {
    const element = document.createElement("div");
    element.dataset.pose = pose;
    element.innerHTML = html;
    return element;
  };
  const working =
    '<span class="dot-mark helm-critter" data-state="working"><svg><path class="dot-mark-lit-d"></path></svg></span><div data-helm-say="running"><span role="timer">0:04</span></div>';

  it("sweeps a light across the mark and says for how long", () => {
    expect(
      helmWorkingProblem(helm(working), "dot-mark-sweep", false),
    ).toBeNull();
    expect(helmWorkingProblem(helm(working), "none", true)).toBeNull();
  });

  it("is named when it is not", () => {
    expect(helmWorkingProblem(null, "", false)).toBe(
      "the message box has no helm",
    );
    expect(helmWorkingProblem(helm(working, "rest"), "", false)).toBe(
      "the mark is rest, not running",
    );
    expect(
      helmWorkingProblem(
        helm(working.replace('"working"', '"still"')),
        "",
        false,
      ),
    ).toBe("the mark is not sweeping");
    expect(helmWorkingProblem(helm(working), "none", false)).toBe(
      "the sweep: its animation is none, expected dot-mark-sweep",
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

describe("a failed helm step's diagnostics", () => {
  it("say how the dialog was opened, where the ▶ and the keyboard are, and where the pointer is", () => {
    document.body.innerHTML = `
      <div id="box" data-composer data-helm><div data-helm data-open="keyboard"><div class="helm-perch"><button data-helm-critter aria-label="Message settings"></button></div></div><textarea aria-label="Message"></textarea></div>
      <div data-helm-dialog data-page="main" data-popover-side="top"><button data-helm-row="model" data-active>Model</button><button data-helm-row="files">Files</button></div>`;
    document.querySelector<HTMLTextAreaElement>("textarea")!.focus();
    const words = helmStateWords(document.getElementById("box")!, document);
    expect(words).toContain("open: keyboard");
    expect(words).toContain("dialog: top at");
    expect(words).toContain("page: main");
    expect(words).toContain("▶ on: model");
    expect(words).toContain('focus: textarea[aria-label="Message"]');
    expect(words).toContain("pointer over: neither");
    // Read from the whole document, past the message box's own data-helm.
    expect(helmStateWords(document, document)).toContain("open: keyboard");
  });

  it("say when the dialog is still in its hidden first pass, or gone", () => {
    document.body.innerHTML = `
      <div id="box"><div data-helm></div></div>
      <div style="visibility: hidden"><div data-helm-dialog></div></div>`;
    expect(helmStateWords(document.getElementById("box")!, document)).toContain(
      "dialog: hidden",
    );
    document.body.innerHTML = `<div id="box"><div data-helm></div></div>`;
    const words = helmStateWords(document.getElementById("box")!, document);
    expect(words).toContain("open: no");
    expect(words).toContain("dialog: none");
  });

  it("close an open dialog with Escape, and say when there was none", () => {
    document.body.innerHTML = `<div data-helm-dialog></div>`;
    const keys: string[] = [];
    document
      .querySelector("[data-helm-dialog]")!
      .addEventListener("keydown", (event) =>
        keys.push((event as KeyboardEvent).key),
      );
    expect(closeHelmDialog(document)).toBe(true);
    expect(keys).toEqual(["Escape"]);
    document.body.innerHTML = "";
    expect(closeHelmDialog(document)).toBe(false);
  });
});
