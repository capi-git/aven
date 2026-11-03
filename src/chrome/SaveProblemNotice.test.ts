// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportSaveProblem,
  resetSaveProblems,
  saveProblem,
} from "../lib/saveProblems";
import { SaveProblemNotice } from "./SaveProblemNotice";

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSaveProblems();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resetSaveProblems();
});

describe("the save-problem notice", () => {
  it("shows what can't be saved and why, and goes when dismissed", async () => {
    await act(async () => root.render(createElement(SaveProblemNotice)));
    expect(document.querySelector("[data-save-problem]")).toBeNull();
    await act(async () =>
      reportSaveProblem(
        "aven.crews.v1",
        "your teams",
        "Aven's storage is full.",
      ),
    );
    const notice = document.querySelector<HTMLElement>("[data-save-problem]")!;
    expect(notice.dataset.saveProblem).toBe("aven.crews.v1");
    expect(notice.textContent).toContain(
      "Aven can't save changes to your teams: Aven's storage is full.",
    );
    expect(notice.textContent).toContain("They hold until this window closes.");
    await act(async () =>
      notice
        .querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!
        .click(),
    );
    expect(document.querySelector("[data-save-problem]")).toBeNull();
    expect(saveProblem()).toBeNull();
  });
});
