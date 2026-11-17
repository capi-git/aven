// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  focusOutsideParked,
  noteTabKey,
  outOfReach,
  tabMoving,
} from "./parkedFocus";

const laidOut = () => true;

function stage() {
  document.body.innerHTML = `
    <button id="before">Before</button>
    <div id="front"><textarea id="box"></textarea><button id="send">Send</button></div>
    <div id="parked" hidden><textarea id="other"></textarea><button id="stop">Stop</button></div>
    <button id="after">After</button>
  `;
  const get = (id: string) => document.getElementById(id)!;
  return get;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("focus kept out of a parked chat", () => {
  it("treats anything under [hidden] or [inert] as out of reach", () => {
    const get = stage();
    expect(outOfReach(get("other"))).toBe(true);
    expect(outOfReach(get("box"))).toBe(false);
    get("front").inert = true;
    expect(outOfReach(get("box"))).toBe(true);
  });

  it("hands focus back where it came from", () => {
    const get = stage();
    expect(
      focusOutsideParked(get("other"), get("box"), null, { laidOut }),
    ).toBe(get("box"));
  });

  it("leaves focus nowhere when it came from out of reach", () => {
    const get = stage();
    expect(
      focusOutsideParked(get("other"), get("stop"), null, { laidOut }),
    ).toBe(null);
    expect(focusOutsideParked(get("other"), null, null, { laidOut })).toBe(
      null,
    );
  });

  it("passes a Tab press on to the next control past the parked chat", () => {
    const get = stage();
    expect(
      focusOutsideParked(
        get("other"),
        get("send"),
        { back: false },
        { laidOut },
      ),
    ).toBe(get("after"));
    expect(
      focusOutsideParked(
        get("stop"),
        get("after"),
        { back: true },
        { laidOut },
      ),
    ).toBe(get("send"));
  });

  it("wraps around at either end", () => {
    document.body.innerHTML = `
      <button id="first">First</button>
      <div hidden><button id="parked">Parked</button></div>
    `;
    const first = document.getElementById("first")!;
    const parked = document.getElementById("parked")!;
    expect(
      focusOutsideParked(parked, first, { back: false }, { laidOut }),
    ).toBe(first);
  });

  it("skips controls that are not laid out", () => {
    const get = stage();
    expect(
      focusOutsideParked(
        get("other"),
        get("send"),
        { back: false },
        { laidOut: (element) => element.id !== "after" },
      ),
    ).toBe(get("before"));
  });

  it("notes a Tab press only until the task ends", () => {
    vi.useFakeTimers();
    noteTabKey(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(tabMoving()).toEqual({ back: true });
    vi.runAllTimers();
    expect(tabMoving()).toBe(null);
    noteTabKey(new KeyboardEvent("keydown", { key: "a" }));
    expect(tabMoving()).toBe(null);
  });
});
