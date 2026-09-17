import { describe, expect, it, vi } from "vitest";
import {
  createDropIndicatorPresenter,
  normalizeDropIndicator,
} from "./useBrowserDropIndicator";

const details = { edge: "tab", kind: "tab", title: "Browser" } as const;
const viewport = { x: 200, y: 100, width: 600, height: 400, scale: 2 };
const area = { left: 260, top: 120, right: 740, bottom: 460 };
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("native drop feedback", () => {
  it("clips the target to its native viewport without depending on pixel scale", () => {
    const expected = { ...details, x: 0.1, y: 0.05, width: 0.8, height: 0.85 };
    expect(normalizeDropIndicator(viewport, area, details)).toEqual(expected);
    expect(
      normalizeDropIndicator({ ...viewport, scale: 0.8 }, area, details),
    ).toEqual(expected);
    expect(
      normalizeDropIndicator(
        viewport,
        { left: 0, top: 0, right: 800, bottom: 700 },
        details,
      ),
    ).toEqual({ ...details, x: 0, y: 0, width: 1, height: 1 });
  });
  it("clears targets outside this browser or with invalid geometry", () => {
    expect(
      normalizeDropIndicator(
        viewport,
        { left: 0, top: 0, right: 100, bottom: 99 },
        details,
      ),
    ).toBeNull();
    expect(
      normalizeDropIndicator(viewport, { ...area, left: NaN }, details),
    ).toBeNull();
    expect(
      normalizeDropIndicator({ ...viewport, width: 0 }, area, details),
    ).toBeNull();
  });
  it("bounds titles without leaving a broken UTF16 surrogate", () => {
    const result = normalizeDropIndicator(viewport, area, {
      ...details,
      title: "a".repeat(159) + "🌊",
    });
    expect(result?.title).toBe("a".repeat(159));
  });
  it("coalesces 1000 destination changes behind one native request and clears after cancellation", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const presenter = createDropIndicatorPresenter(present);
    const value = normalizeDropIndicator(viewport, area, details)!;
    presenter.update(value);
    for (let i = 0; i < 1000; i++)
      presenter.update({ ...value, title: `Tab ${i}` });
    expect(present).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(present).toHaveBeenCalledTimes(2);
    expect(present).toHaveBeenLastCalledWith({ ...value, title: "Tab 999" });
    presenter.update({ ...value, title: "Tab 999" });
    expect(present).toHaveBeenCalledTimes(2);
    presenter.dispose();
    await tick();
    expect(present).toHaveBeenLastCalledWith(null);
    presenter.update(value);
    expect(present).toHaveBeenCalledTimes(3);
  });
  it("never paints queued destinations after an interrupted drag", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const presenter = createDropIndicatorPresenter(present);
    const value = normalizeDropIndicator(viewport, area, details)!;
    presenter.update(value);
    presenter.update({ ...value, edge: "left" });
    presenter.dispose();
    release();
    await tick();
    expect(present.mock.calls).toEqual([[value], [null]]);
  });
  it("does not let a retired owner's delayed clear erase a new owner's identical target", async () => {
    let release!: () => void;
    const present = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const value = normalizeDropIndicator(viewport, area, details)!;
    const first = createDropIndicatorPresenter(present, "same-page");
    first.update(value);
    first.dispose();
    const second = createDropIndicatorPresenter(present, "same-page");
    second.update(value);
    first.dispose();
    first.update(null);
    expect(present).toHaveBeenCalledTimes(1);
    release();
    await tick();
    expect(present.mock.calls).toEqual([[value], [value]]);
    second.dispose();
    await tick();
    expect(present).toHaveBeenLastCalledWith(null);
  });
  it("restores the same target after a fully settled hide and new owner", async () => {
    const present = vi.fn().mockResolvedValue(undefined);
    const value = normalizeDropIndicator(viewport, area, details)!;
    const first = createDropIndicatorPresenter(present, "reappeared-page");
    first.update(value);
    await tick();
    first.dispose();
    await tick();
    const second = createDropIndicatorPresenter(present, "reappeared-page");
    second.update(value);
    await tick();
    expect(present.mock.calls).toEqual([[value], [null], [value]]);
    second.dispose();
    await tick();
  });
});
