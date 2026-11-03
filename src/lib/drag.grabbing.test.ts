// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { elementBeneathGrab, setGrabbing } from "./drag";

const cover = () => document.querySelector<HTMLElement>("[data-grab-cover]");

describe("the grabbing cursor", () => {
  afterEach(() => {
    setGrabbing(false);
    vi.restoreAllMocks();
  });

  it("is a sheet for the drag's length, and leaves the body's style alone", () => {
    setGrabbing(true);
    expect(cover()?.style.cursor).toBe("grabbing");
    expect(document.body.style.cursor).toBe("");
    setGrabbing(true);
    expect(document.querySelectorAll("[data-grab-cover]")).toHaveLength(1);
    setGrabbing(false);
    expect(cover()).toBeNull();
  });

  it("goes at the next press if a drag never ended", () => {
    setGrabbing(true);
    cover()?.dispatchEvent(new Event("pointerdown"));
    expect(cover()).toBeNull();
  });

  it("finds what is beneath it", () => {
    const pane = document.createElement("div");
    setGrabbing(true);
    const sheet = cover()!;
    document.elementFromPoint = vi.fn(() => sheet);
    document.elementsFromPoint = vi.fn(() => [sheet, pane]);
    expect(elementBeneathGrab(1, 1)).toBe(pane);
    setGrabbing(false);
    document.elementFromPoint = vi.fn(() => pane);
    expect(elementBeneathGrab(1, 1)).toBe(pane);
  });
});
