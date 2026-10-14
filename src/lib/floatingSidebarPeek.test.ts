import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSidebarPeek } from "./floatingSidebarPeek";

function peek() {
  const changes: [boolean, boolean][] = [];
  const controller = createSidebarPeek({
    enterDelay: 150,
    leaveDelay: 90,
    onChange: (open, animated) => changes.push([open, animated]),
  });
  controller.setEnabled(true);
  return { controller, changes };
}

describe("floating sidebar peek", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reveals after resting on the edge, not when the pointer passes it", () => {
    const { controller, changes } = peek();
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(149);
    controller.pointer({ inside: false, edge: false });
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([]);
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(150);
    expect(changes).toEqual([[true, true]]);
    expect(controller.open).toBe(true);
  });

  it("stays out over the card and closes after a short grace once the pointer leaves", () => {
    const { controller, changes } = peek();
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(150);
    controller.pointer({ inside: true, edge: false });
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([[true, true]]);
    controller.pointer({ inside: false, edge: false });
    vi.advanceTimersByTime(89);
    // Returning within the grace keeps the card.
    controller.pointer({ inside: true, edge: false });
    vi.advanceTimersByTime(500);
    expect(changes).toEqual([[true, true]]);
    controller.pointer({ inside: false, edge: false });
    vi.advanceTimersByTime(90);
    expect(changes).toEqual([
      [true, true],
      [false, true],
    ]);
  });

  it("keeps the card out for menus, drags and keyboard focus", () => {
    const { controller, changes } = peek();
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(150);
    controller.activity({ interaction: true, focus: false });
    controller.pointer({ inside: false, edge: false });
    vi.advanceTimersByTime(1000);
    expect(controller.open).toBe(true);
    controller.activity({ interaction: false, focus: true });
    vi.advanceTimersByTime(1000);
    expect(controller.open).toBe(true);
    controller.activity({ interaction: false, focus: false });
    vi.advanceTimersByTime(90);
    expect(changes.at(-1)).toEqual([false, true]);
  });

  it("does not reveal while disabled, and dismissing closes at once", () => {
    const { controller, changes } = peek();
    controller.setEnabled(false);
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
    controller.setEnabled(true);
    controller.pointer({ inside: false, edge: false });
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(150);
    controller.pointer({ inside: true, edge: false });
    controller.dismiss(false);
    expect(changes).toEqual([
      [true, true],
      [false, false],
    ]);
    // A dismissal cancels any pending close.
    vi.advanceTimersByTime(1000);
    expect(changes).toHaveLength(2);
  });

  it("disabling cancels a pending reveal but leaves an open card to its owner", () => {
    const { controller, changes } = peek();
    controller.pointer({ inside: false, edge: true });
    controller.setEnabled(false);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([]);
    controller.setEnabled(true);
    controller.reveal();
    controller.setEnabled(false);
    controller.pointer({ inside: false, edge: false });
    vi.advanceTimersByTime(90);
    // Leaving still closes an open card; only new reveals stop.
    expect(changes).toEqual([
      [true, true],
      [false, true],
    ]);
  });

  it("reset forgets the pointer and an open card without reporting", () => {
    const { controller, changes } = peek();
    controller.pointer({ inside: false, edge: true });
    vi.advanceTimersByTime(150);
    controller.reset();
    expect(controller.open).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([[true, true]]);
  });
});
