// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { browserUpdatePaused } from "./browserUpdateState";
import { lockUpdateInput } from "./updateInputLock";
let release: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML =
    '<div id="root"><textarea aria-label="Message"></textarea><button>Send</button></div>';
});
afterEach(() => {
  release?.();
  release = undefined;
  document.body.innerHTML = "";
});

it("blocks typing and portaled edits while the workspace is being installed", () => {
  const composer = document.querySelector("textarea")!;
  composer.focus();
  release = lockUpdateInput();
  expect(browserUpdatePaused()).toBe(true);
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
  expect(document.activeElement?.getAttribute("role")).toBe("alertdialog");
  expect(document.activeElement?.textContent).toContain(
    "Saving and restarting…",
  );
  expect(document.activeElement?.textContent).toContain(
    "Your tabs will reopen after the update.",
  );
  let draftChanged = false;
  composer.addEventListener("input", () => {
    draftChanged = true;
  });
  const editing = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: "x",
  });
  expect(composer.dispatchEvent(editing)).toBe(false);
  composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
  expect(draftChanged).toBe(false);
  const portal = document.createElement("textarea");
  document.body.append(portal);
  expect(
    portal.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, cancelable: true }),
    ),
  ).toBe(false);
  expect(
    composer.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "a",
      }),
    ),
  ).toBe(false);
});

it("restores editing and focus after a failed restart and cleans up idempotently", () => {
  const composer = document.querySelector("textarea")!;
  composer.focus();
  release = lockUpdateInput();
  release();
  release();
  expect(browserUpdatePaused()).toBe(false);
  expect(document.querySelector("[data-update-input-lock]")).toBeNull();
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(composer);
  expect(
    composer.dispatchEvent(
      new InputEvent("beforeinput", { bubbles: true, cancelable: true }),
    ),
  ).toBe(true);
});

it("preserves an existing root inert state", () => {
  document.getElementById("root")!.setAttribute("inert", "");
  release = lockUpdateInput();
  release();
  expect(document.getElementById("root")?.hasAttribute("inert")).toBe(true);
});
